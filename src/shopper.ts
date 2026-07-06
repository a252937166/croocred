import { AgentClient, type Order } from "@croo-network/sdk";
import { cfg, usdc } from "./config.js";
import { log } from "./log.js";
import type { PublicService } from "./publicApi.js";

/**
 * The shopper is CrooCred's requester side: it places a REAL paid order
 * against a target service and records everything that happens, with
 * timestamps and tx hashes. It never trusts push events — all state is
 * observed by polling getNegotiation/getOrder, so it works alongside the
 * provider daemon (one WebSocket per key) and survives missed events.
 *
 * Known platform failure mode (reported in the hackathon Q&A): accepted
 * orders can stall in `creating`. Every phase therefore has a hard deadline,
 * and a stalled phase produces a structured verdict instead of a hang.
 */

export type RunPhase =
  | "negotiation_sent"
  | "negotiation_accepted"
  | "order_created"
  | "order_paid"
  | "delivered"
  | "settled";

export interface TestRun {
  runIndex: number;
  /**
   * paid — full probe: pay escrow, await delivery, judge output.
   * liveness — zero-cost probe: negotiate, let the provider accept, observe
   *   the on-chain order reach `created`, then cancel before payment. Free
   *   (gas is platform-sponsored) but still produces real on-chain evidence.
   */
  mode: "paid" | "liveness";
  serviceId: string;
  negotiationId?: string;
  orderId?: string;
  chainOrderId?: string;
  // outcome
  ok: boolean;
  failureStage?:
    | "negotiate"
    | "acceptance_timeout"
    | "negotiation_rejected"
    | "order_creation_stalled"
    | "pay"
    | "delivery_timeout"
    | "order_rejected_after_payment"
    | "delivery_fetch"
    | "cancel";
  failureDetail?: string;
  // evidence
  txHashes: { create?: string; pay?: string; deliver?: string; clear?: string };
  pricePaidUsdc?: number;
  // timings (ms)
  tAcceptMs?: number; // negotiation sent -> accepted
  tCreateMs?: number; // accepted -> on-chain order created
  tDeliverMs?: number; // paid -> delivered
  slaMs?: number; // promised SLA window
  slaMet?: boolean;
  // payload
  requestSent: string;
  deliverableType?: string;
  deliverableText?: string;
  contentHash?: string;
  startedAt: string;
  finishedAt?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Global payment mutex. Concurrent payOrder userops from one AA wallet
 * collide on the wallet nonce (documented CROO limitation). Probes within a
 * certification are already sequential; this serializes payments across
 * concurrently-processed parent orders too.
 */
let payQueue: Promise<unknown> = Promise.resolve();
function withPaymentLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = payQueue.then(fn, fn);
  payQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function pollUntil<T>(
  fn: () => Promise<T>,
  done: (v: T) => boolean,
  timeoutMs: number,
  intervalMs = cfg.pollIntervalMs,
): Promise<{ value: T; timedOut: boolean }> {
  const deadline = Date.now() + timeoutMs;
  let last!: T;
  for (;;) {
    try {
      last = await fn();
      if (done(last)) return { value: last, timedOut: false };
    } catch (err) {
      log.debug("poll error (retrying)", String(err));
    }
    if (Date.now() > deadline) return { value: last, timedOut: true };
    await sleep(intervalMs);
  }
}

const TERMINAL_BAD = new Set(["rejected", "expired", "create_failed", "pay_failed"]);

/** The API requires `requirements` to be valid JSON even for text services. */
function asJsonRequirements(input: string): string {
  try {
    JSON.parse(input);
    return input;
  } catch {
    return JSON.stringify(input);
  }
}

/** Shared front half: negotiate → provider accepts → on-chain order `created`. */
async function negotiateToCreated(
  client: AgentClient,
  service: PublicService,
  rawRequirements: string,
  runIndex: number,
  run: TestRun,
): Promise<Order | null> {
  let requirements = asJsonRequirements(rawRequirements);
  // 1+2. Negotiate and await acceptance. Some providers validate that
  // requirements is a JSON *object* (not a JSON string) — on that specific
  // rejection, retry once with an object-wrapped form.
  const t0 = Date.now();
  let negotiationId = "";
  for (let attempt = 1; ; attempt++) {
    try {
      const neg = await client.negotiateOrder({
        serviceId: service.serviceId,
        requirements,
        metadata: JSON.stringify({ source: "croocred", kind: `certification-probe-${run.mode}`, run: runIndex }),
      });
      negotiationId = neg.negotiationId;
      run.negotiationId = negotiationId;
      log.info(`run#${runIndex} negotiation sent`, negotiationId);
    } catch (err) {
      run.failureStage = "negotiate";
      run.failureDetail = String(err);
      return null;
    }

    const acc = await pollUntil(
      () => client.getNegotiation(negotiationId),
      (n) => n.status !== "pending",
      cfg.negotiationTimeoutMs,
    );
    if (acc.timedOut || acc.value?.status === "expired") {
      run.failureStage = "acceptance_timeout";
      run.failureDetail = `negotiation still ${acc.value?.status ?? "pending"} after ${cfg.negotiationTimeoutMs / 1000}s`;
      return null;
    }
    if (acc.value.status === "rejected") {
      const reason = acc.value.rejectReason || "(no reason given)";
      let isObjectForm = false;
      try {
        const parsed: unknown = JSON.parse(requirements);
        isObjectForm = typeof parsed === "object" && parsed !== null;
      } catch {
        /* not JSON at all */
      }
      if (attempt === 1 && !isObjectForm && /json object|cannot unmarshal string/i.test(reason)) {
        requirements = JSON.stringify({ text: rawRequirements });
        log.info(`run#${runIndex} provider wants object requirements — retrying with {"text": …}`);
        continue;
      }
      if (attempt <= 2 && requirements !== "{}" && /unsupported requirement field/i.test(reason)) {
        requirements = "{}";
        log.info(`run#${runIndex} provider rejects our fields — retrying with empty object`);
        continue;
      }
      run.failureStage = "negotiation_rejected";
      run.failureDetail = reason;
      return null;
    }
    break;
  }
  run.tAcceptMs = Date.now() - t0;
  log.info(`run#${runIndex} negotiation accepted in ${run.tAcceptMs}ms`);

  // 3. Wait for the on-chain order to reach `created` (known stall point)
  const tCreate = Date.now();
  const found = await pollUntil(
    () => client.listOrders({ role: "buyer", pageSize: 50 }),
    (orders) => orders?.some((o) => o.negotiationId === negotiationId),
    cfg.orderCreateTimeoutMs,
  );
  let order: Order | undefined = found.value?.find((o) => o.negotiationId === negotiationId);
  if (!order) {
    run.failureStage = "order_creation_stalled";
    run.failureDetail = `no order visible ${cfg.orderCreateTimeoutMs / 1000}s after acceptance`;
    return null;
  }
  run.orderId = order.orderId;

  const created = await pollUntil(
    () => client.getOrder(order!.orderId),
    (o) => o.status !== "creating",
    cfg.orderCreateTimeoutMs,
  );
  order = created.value ?? order;
  run.chainOrderId = order.chainOrderId;
  run.txHashes.create = order.createTxHash || undefined;
  if (created.timedOut || order.status === "create_failed") {
    run.failureStage = "order_creation_stalled";
    run.failureDetail = `order stuck in '${order.status}' (known CAP stall mode)`;
    return null;
  }
  run.tCreateMs = Date.now() - tCreate;
  return order;
}

function newRun(mode: TestRun["mode"], service: PublicService, requirements: string, runIndex: number): TestRun {
  return {
    runIndex,
    mode,
    serviceId: service.serviceId,
    ok: false,
    txHashes: {},
    requestSent: requirements,
    slaMs: service.slaMinutes * 60_000,
    startedAt: new Date().toISOString(),
  };
}

function guardService(service: PublicService, run: TestRun, paid: boolean): boolean {
  if (service.requireFundTransfer) {
    run.failureStage = "negotiate";
    run.failureDetail = "fund-transfer services are out of certification scope";
    return false;
  }
  if (paid && usdc(service.price) > cfg.maxPricePerCallUsdc) {
    run.failureStage = "negotiate";
    run.failureDetail = `price ${usdc(service.price)} exceeds safety cap ${cfg.maxPricePerCallUsdc}`;
    return false;
  }
  return true;
}

/**
 * Zero-cost probe: proves the provider is alive and its CAP integration
 * works up to on-chain order creation, then cancels before any USDC moves.
 * Gas is platform-sponsored, so the whole probe is free — and the created /
 * cancelled order is still verifiable on-chain evidence.
 */
export async function runLivenessProbe(
  client: AgentClient,
  service: PublicService,
  requirements: string,
  runIndex: number,
): Promise<TestRun> {
  const run = newRun("liveness", service, requirements, runIndex);
  const finish = (): TestRun => {
    run.finishedAt = new Date().toISOString();
    return run;
  };
  if (!guardService(service, run, false)) return finish();

  const order = await negotiateToCreated(client, service, requirements, runIndex, run);
  if (!order) return finish();

  try {
    await client.rejectOrder(
      order.orderId,
      "CrooCred liveness probe complete — cancelling unpaid order (no funds were locked). Thanks!",
    );
    run.ok = true;
    log.info(`run#${runIndex} liveness probe OK (accept ${run.tAcceptMs}ms, created on-chain, cancelled unpaid)`);
  } catch (err) {
    // The probe itself succeeded (order reached `created`); cancellation is best-effort.
    run.ok = true;
    run.failureStage = "cancel";
    run.failureDetail = `order created but cancel failed: ${String(err).slice(0, 120)} (order will expire unpaid)`;
    log.warn(`run#${runIndex} liveness cancel failed — order will expire on its own`, String(err));
  }
  return finish();
}

export async function runTestPurchase(
  client: AgentClient,
  service: PublicService,
  requirements: string,
  runIndex: number,
): Promise<TestRun> {
  const run = newRun("paid", service, requirements, runIndex);
  const finish = (): TestRun => {
    run.finishedAt = new Date().toISOString();
    return run;
  };
  if (!guardService(service, run, true)) return finish();

  let order = await negotiateToCreated(client, service, requirements, runIndex, run);
  if (!order) return finish();

  // 4. Pay (escrow lock). payOrder auto-handles USDC approve.
  try {
    const payRes = await withPaymentLock(() => client.payOrder(order!.orderId));
    run.txHashes.pay = payRes.txHash || payRes.order?.payTxHash || undefined;
    // the returned order's price can be an empty string — fall back to the listing
    run.pricePaidUsdc = usdc(payRes.order?.price || service.price);
    log.info(`run#${runIndex} paid`, run.txHashes.pay ?? "(tx pending)");
  } catch (err) {
    run.failureStage = "pay";
    run.failureDetail = String(err);
    return finish();
  }

  // 5. Wait for delivery within the promised SLA (+25% grace)
  const tPaid = Date.now();
  const slaBudget = run.slaMs! * 1.25 + 60_000;
  const del = await pollUntil(
    () => client.getOrder(order!.orderId),
    (o) => ["completed", "rejected", "expired"].includes(o.status),
    slaBudget,
  );
  order = del.value ?? order;
  run.txHashes.deliver = order.deliverTxHash || undefined;
  run.txHashes.clear = order.clearTxHash || undefined;

  if (del.timedOut || order.status === "expired") {
    run.failureStage = "delivery_timeout";
    run.failureDetail = `no delivery within SLA ${service.slaMinutes}min (+grace); escrow auto-refunds`;
    return finish();
  }
  if (order.status === "rejected") {
    run.failureStage = "order_rejected_after_payment";
    run.failureDetail = order.rejectReason || "(provider rejected after payment; escrow refunded)";
    return finish();
  }
  run.tDeliverMs = Date.now() - tPaid;
  run.slaMet = run.tDeliverMs <= run.slaMs!;

  // 6. Fetch deliverable. Schema-typed providers may put the payload in
  // `deliverableSchema` and leave `deliverableText` empty — reading only the
  // text field mislabels a real delivery as empty (caught live, 2026-07-06).
  try {
    const d = await client.getDelivery(order.orderId);
    run.deliverableType = d.deliverableType;
    run.deliverableText = (d.deliverableText ?? "").trim() ? d.deliverableText : d.deliverableSchema ?? "";
    run.contentHash = d.contentHash;
  } catch (err) {
    run.failureStage = "delivery_fetch";
    run.failureDetail = String(err);
    return finish();
  }

  run.ok = true;
  log.info(`run#${runIndex} completed: delivered in ${Math.round(run.tDeliverMs / 1000)}s, SLA ${run.slaMet ? "met" : "MISSED"}`);
  return finish();
}
