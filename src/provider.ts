import { AgentClient, EventType, type Event } from "@croo-network/sdk";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { cfg } from "./config.js";
import { log } from "./log.js";
import { getPublicService } from "./publicApi.js";
import { certify, deliverablePayload } from "./certify.js";
import { saveRecord } from "./report.js";
import { buildSite } from "./site/build.js";

/**
 * CrooCred provider daemon — the sell side.
 *
 * Listens for inbound negotiations on CrooCred's own services, accepts them,
 * and on payment runs the certification pipeline (which in turn makes real
 * paid orders to the target agent — the buy side). Delivers the graded
 * report as the CAP deliverable and rebuilds the public site.
 *
 * State handling is event-driven with a polling safety net, and every
 * processed order is persisted so restarts never double-process or
 * double-spend.
 */

const client = new AgentClient({ baseURL: cfg.apiURL, wsURL: cfg.wsURL }, cfg.sdkKey);

// ---------- idempotency store ------------------------------------------------
const STATE_FILE = resolve(cfg.dataDir, "processed.json");
interface DaemonState {
  acceptedNegotiations: string[];
  processedOrders: string[];
}
function loadState(): DaemonState {
  mkdirSync(cfg.dataDir, { recursive: true });
  if (!existsSync(STATE_FILE)) return { acceptedNegotiations: [], processedOrders: [] };
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8")) as DaemonState;
  } catch {
    return { acceptedNegotiations: [], processedOrders: [] };
  }
}
const state = loadState();
const persist = () => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
const busy = new Set<string>();
const acceptAttempts = new Map<string, number>();
const MAX_ACCEPT_ATTEMPTS = 3;

// ---------- request parsing --------------------------------------------------
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export interface CertificationRequest {
  target: string;
  runs?: number;
  mode?: "liveness"; // buyers may downgrade to liveness; paid is balance-gated
  note?: string;
}

/**
 * Parse whatever the buyer sent: {"target": "...", "runs": 2}, a raw UUID,
 * an Agent Store URL, or free text containing any of those. Requirements may
 * arrive double-JSON-encoded (the API requires JSON), so unwrap up to twice.
 */
export function parseCertificationRequest(requirements: string): CertificationRequest | null {
  let text = (requirements ?? "").trim();
  if (!text) return null;

  let obj: Record<string, unknown> | null = null;
  for (let i = 0; i < 2 && obj === null; i++) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed === "string") {
        text = parsed.trim();
      } else if (parsed && typeof parsed === "object") {
        obj = parsed as Record<string, unknown>;
      } else {
        break;
      }
    } catch {
      break;
    }
  }

  let target: string | null = null;
  let runs: number | undefined;
  let mode: CertificationRequest["mode"];
  let note: string | undefined;

  if (obj) {
    for (const k of ["target", "target_id", "service_id", "serviceId", "agent_id", "agentId", "url"]) {
      const v = obj[k];
      if (typeof v === "string" && UUID_RE.test(v)) {
        target = v.match(UUID_RE)![0];
        break;
      }
    }
    if (typeof obj.runs === "number" && Number.isFinite(obj.runs)) {
      runs = Math.max(1, Math.min(3, Math.round(obj.runs)));
    }
    if (obj.mode === "liveness") mode = "liveness";
    if (typeof obj.note === "string") note = obj.note.slice(0, 500);
    if (typeof obj.notes === "string") note = obj.notes.slice(0, 500);
  }
  if (!target) {
    const m = text.match(UUID_RE);
    target = m ? m[0] : null;
  }
  return target ? { target, runs, mode, note } : null;
}

// ---------- provider flow ----------------------------------------------------
async function handleNegotiation(negotiationId: string): Promise<void> {
  if (state.acceptedNegotiations.includes(negotiationId)) return;
  const neg = await client.getNegotiation(negotiationId);
  if (neg.status !== "pending") return;

  const req = parseCertificationRequest(neg.requirements);
  if (!req) {
    await client.rejectNegotiation(
      negotiationId,
      "Please provide the target as a CROO serviceId or agentId (UUID) or an Agent Store URL. Example: {\"target\": \"<service-uuid>\", \"runs\": 2}",
    );
    log.warn(`rejected negotiation ${negotiationId}: no parsable target`);
    return;
  }
  const target = req.target;

  const attempts = (acceptAttempts.get(negotiationId) ?? 0) + 1;
  acceptAttempts.set(negotiationId, attempts);
  try {
    await client.acceptNegotiation(negotiationId);
  } catch (err) {
    const msg = String(err);
    if (attempts >= MAX_ACCEPT_ATTEMPTS) {
      const reason = /no balance of the token/i.test(msg)
        ? "Could not create the on-chain order: your agent wallet needs a small USDC balance (gas is sponsored via an ERC-20 paymaster that draws on wallet balance). Top up and re-order."
        : `Could not create the on-chain order after ${attempts} attempts: ${msg.slice(0, 140)}`;
      await client.rejectNegotiation(negotiationId, reason).catch(() => {});
      state.acceptedNegotiations.push(negotiationId); // stop retrying
      persist();
      log.warn(`negotiation ${negotiationId} rejected after ${attempts} failed accepts`);
      return;
    }
    throw err;
  }
  state.acceptedNegotiations.push(negotiationId);
  persist();
  log.info(`accepted negotiation ${negotiationId} (target ${target})`);
}

async function processPaidOrder(orderId: string): Promise<void> {
  if (state.processedOrders.includes(orderId) || busy.has(orderId)) return;
  busy.add(orderId);
  try {
    const order = await client.getOrder(orderId);
    if (order.status !== "paid") return;

    const neg = await client.getNegotiation(order.negotiationId);
    const req = parseCertificationRequest(neg.requirements);
    if (!req) {
      await client.rejectOrder(orderId, "No parsable certification target; escrow refunded.");
      state.processedOrders.push(orderId);
      persist();
      return;
    }

    // Re-Check style services run a single probe; full certs run cfg.runsPerCert.
    let runs = req.runs ?? cfg.runsPerCert;
    try {
      const ourService = await getPublicService(order.serviceId);
      if (/re-?check|monitor/i.test(ourService.name)) runs = 1;
    } catch {
      /* default runs */
    }

    log.info(`order ${orderId} paid — certifying target ${req.target} (${runs} probes${req.mode ? `, ${req.mode} requested` : ""})`);
    const rec = await certify(client, req.target, {
      runs,
      mode: req.mode,
      soldVia: {
        orderId,
        requesterAgentId: order.requesterAgentId,
        payTx: order.payTxHash || undefined,
      },
    });

    const payload = deliverablePayload(rec);
    let deliverTx: string | undefined;
    try {
      const res = await client.deliverOrder(orderId, {
        deliverableType: "schema",
        deliverableSchema: JSON.stringify(payload),
        deliverableText: JSON.stringify(payload),
      });
      deliverTx = res.txHash || res.order?.deliverTxHash || undefined;
    } catch (err) {
      log.warn("schema delivery failed, falling back to text", String(err));
      const res = await client.deliverOrder(orderId, {
        deliverableType: "text",
        deliverableText: JSON.stringify(payload, null, 2),
      });
      deliverTx = res.txHash || res.order?.deliverTxHash || undefined;
    }
    // Complete the receipt chain: patch the parent deliver tx into the record.
    if (rec.soldVia && deliverTx) {
      rec.soldVia.deliverTx = deliverTx;
      saveRecord(rec);
    }
    state.processedOrders.push(orderId);
    persist();
    log.info(`order ${orderId} delivered: ${rec.certId} grade=${rec.score.grade}`);

    try {
      buildSite();
    } catch (err) {
      log.warn("site rebuild failed", String(err));
    }
  } catch (err) {
    log.error(`order ${orderId} pipeline failed`, String(err));
    try {
      await client.rejectOrder(orderId, `Certification pipeline failed (${String(err).slice(0, 120)}); escrow refunded.`);
      state.processedOrders.push(orderId);
      persist();
      log.info(`order ${orderId} rejected with refund`);
    } catch (rejErr) {
      log.error(`order ${orderId} reject also failed — will retry next sweep`, String(rejErr));
    }
  } finally {
    busy.delete(orderId);
  }
}

// ---------- event wiring + polling safety net --------------------------------
async function sweep(): Promise<void> {
  try {
    const pending = await client.listNegotiations({ role: "provider", status: "pending", pageSize: 20 });
    for (const n of pending ?? []) await handleNegotiation(n.negotiationId).catch((e) => log.error("negotiation handling failed", String(e)));
  } catch (err) {
    log.debug("sweep negotiations failed", String(err));
  }
  try {
    const paid = await client.listOrders({ role: "provider", status: "paid", pageSize: 20 });
    for (const o of paid ?? []) void processPaidOrder(o.orderId);
  } catch (err) {
    log.debug("sweep orders failed", String(err));
  }
}

async function main(): Promise<void> {
  log.info("CrooCred provider daemon starting", { api: cfg.apiURL });

  const stream = await client.connectWebSocket();
  stream.on(EventType.NegotiationCreated, (e: Event) => {
    if (e.negotiation_id) void handleNegotiation(e.negotiation_id).catch((err) => log.error("negotiation handling failed", String(err)));
  });
  stream.on(EventType.OrderPaid, (e: Event) => {
    if (e.order_id) void processPaidOrder(e.order_id);
  });
  stream.onAny((e: Event) => log.debug("event", e.type, e.order_id ?? e.negotiation_id ?? ""));

  await sweep();
  setInterval(() => void sweep(), 45_000);
  log.info("daemon online — waiting for orders");
}

main().catch((err) => {
  log.error("daemon fatal", String(err));
  process.exit(1);
});
