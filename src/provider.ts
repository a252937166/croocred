import { AgentClient, EventType, type Event } from "@croo-network/sdk";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { cfg, usdc } from "./config.js";
import { log } from "./log.js";
import { getPublicService, resolveNameToId } from "./publicApi.js";
import { parseCertificationRequest, type CertificationRequest } from "./certreq.js";
import { certify, deliverablePayload } from "./certify.js";
import { judgeClaim, attachVerdictEvidence } from "./verdict.js";
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
// parseCertificationRequest lives in certreq.ts (pure, unit-tested). Names are
// resolved against the Store here, where I/O belongs.

/**
 * Turn a parsed request whose target is a Store *name* into one with a UUID.
 *  ok       — request is ready (name resolved, or it was already a UUID)
 *  no-match — the name definitively matches nothing on the Store
 * Throws on search-transport failure so a Store outage is never misread as
 * "no such agent" (pipeline fails generically → buyer is auto-refunded).
 */
async function resolveRequestTarget(
  req: CertificationRequest,
  orderId: string,
): Promise<{ kind: "ok"; req: CertificationRequest } | { kind: "no-match" }> {
  if (!req.targetIsName) return { kind: "ok", req };
  let resolved: string | null;
  try {
    resolved = await resolveNameToId(req.target);
  } catch (err) {
    throw new Error(`Store name search failed while resolving "${req.target}": ${String(err).slice(0, 80)}`);
  }
  if (resolved) {
    log.info(`order ${orderId}: resolved target name "${req.target}" → ${resolved}`);
    return { kind: "ok", req: { ...req, target: resolved, targetIsName: undefined } };
  }
  return { kind: "no-match" };
}

// ---------- provider flow ----------------------------------------------------
const serviceNameCache = new Map<string, string>();
async function ownServiceName(serviceId: string): Promise<string> {
  if (!serviceNameCache.has(serviceId)) {
    try {
      serviceNameCache.set(serviceId, (await getPublicService(serviceId)).name);
    } catch {
      return "";
    }
  }
  return serviceNameCache.get(serviceId) ?? "";
}
const isVerdictService = (name: string): boolean => /verdict|claim/i.test(name);
// Axion Clash race rounds (community arena): tiny inbound order, we deliver a
// deterministic ETH-move forecast. Must be intercepted BEFORE the certify
// default — a race order must never trigger outbound probe purchases.
const isRaceService = (name: string): boolean => /axion|race/i.test(name);

/** Fast, deterministic |ETH move| forecast per the Axion race contract:
 *  deliverable is a JSON string with EXACTLY { prediction, rationale },
 *  prediction a positive USD amplitude. Speed beats sophistication, so we
 *  sqrt-time-scale the round's own recentVol instead of calling an LLM. */
function raceForecast(requirements: string | undefined): { prediction: number; rationale: string } {
  let spot = 0, dl = 60, vol = 0;
  try {
    const r = JSON.parse(requirements ?? "{}") as Record<string, unknown>;
    spot = Number(r.spot) || 0;
    dl = Number(r.deadlineSeconds) || 60;
    vol = Number(r.recentVol) || 0;
  } catch {
    /* fall through to the conservative fallback */
  }
  let prediction = vol > 0 ? vol * Math.sqrt(dl / 60) : spot > 0 ? spot * 0.0004 : 0.5;
  prediction = Math.max(0.01, Math.round(prediction * 100) / 100);
  const rationale = vol > 0
    ? `sqrt-time baseline: recent |move| $${vol} scaled to the ${dl}s window`
    : "conservative fallback baseline (round payload carried no recentVol)";
  return { prediction, rationale };
}

async function handleNegotiation(negotiationId: string): Promise<void> {
  if (state.acceptedNegotiations.includes(negotiationId)) return;
  const neg = await client.getNegotiation(negotiationId);
  if (neg.status !== "pending") return;

  const svcName = await ownServiceName(neg.serviceId);
  // Race rounds carry the round payload, not a UUID target — accept as-is.
  if (isRaceService(svcName)) {
    /* no requirements validation: the forecast handler has a safe fallback */
  } else
  // Claim-review orders carry free-form evidence, not a UUID target.
  if (isVerdictService(svcName)) {
    if (!(neg.requirements ?? "").trim()) {
      await client.rejectNegotiation(
        negotiationId,
        "Please include the claim: buyer request + seller output (JSON {\"buyer_request\",\"seller_output\"} or plain text).",
      );
      return;
    }
  } else {
    const req = parseCertificationRequest(neg.requirements);
    if (!req) {
      // No parsable target — don't bounce a paying customer. The most common
      // intent behind a target-less Certify order is "test MY agent", so we
      // default to certifying the buyer's own agent (learned from a real
      // buyer's first order getting rejected, 2026-07-07).
      log.info(`negotiation ${negotiationId}: no parsable target — will default to the buyer's own agent`);
    } else if (req.targetIsName === "key") {
      // Cheapest place to catch a bad name: before the buyer pays. Only a
      // definitive no-match rejects; a search outage lets the order proceed
      // (it re-resolves at order time and auto-refunds on failure).
      try {
        const resolved = await resolveNameToId(req.target);
        if (resolved) {
          log.info(`negotiation ${negotiationId}: target name "${req.target}" → ${resolved}`);
        } else {
          await client.rejectNegotiation(
            negotiationId,
            `No Store agent named "${req.target.slice(0, 60)}" found. Check the exact name on the Agent Store, or send {"target":"<agent uuid>"}.`,
          );
          log.info(`negotiation ${negotiationId} rejected — unresolvable target name "${req.target}"`);
          return;
        }
      } catch (err) {
        log.warn(`negotiation ${negotiationId}: name search unavailable, deferring to order time`, String(err));
      }
    }
  }

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
  log.info(`accepted negotiation ${negotiationId}`);
}

async function processPaidOrder(orderId: string): Promise<void> {
  if (state.processedOrders.includes(orderId) || busy.has(orderId)) return;
  busy.add(orderId);
  let defaultedToOwnAgent = false;
  try {
    const order = await client.getOrder(orderId);
    if (order.status !== "paid") return;

    const neg = await client.getNegotiation(order.negotiationId);
    const svcName = await ownServiceName(order.serviceId);

    // Axion race branch: deliver a deterministic forecast immediately.
    // Never falls through to certification (no outbound spend, no probes).
    if (isRaceService(svcName)) {
      const { prediction, rationale } = raceForecast(neg.requirements);
      await client.deliverOrder(orderId, {
        deliverableType: "text",
        deliverableText: JSON.stringify({ prediction, rationale }),
      });
      state.processedOrders.push(orderId);
      persist();
      log.info(`order ${orderId} race forecast delivered: $${prediction}`);
      return;
    }

    // Claim-review branch: pure adjudication, no outbound purchases.
    if (isVerdictService(svcName)) {
      log.info(`order ${orderId} paid — adjudicating claim`);
      const verdict = await judgeClaim(neg.requirements, {
        orderId,
        chainOrderId: (order as { chainOrderId?: string }).chainOrderId,
        requesterAgentId: order.requesterAgentId,
        payTx: (order as { payTxHash?: string }).payTxHash,
        priceUsdc: usdc(order.price),
        operatorDemo: order.requesterAgentId === process.env.CROO_BUYER_AGENT_ID,
      });
      const res = await client.deliverOrder(orderId, {
        deliverableType: "text",
        deliverableText: JSON.stringify(verdict, null, 2),
      });
      const deliverTx = res.txHash || (res as { order?: { deliverTxHash?: string } }).order?.deliverTxHash;
      if (deliverTx) attachVerdictEvidence(verdict.evidence_hash, { deliverTx });
      state.processedOrders.push(orderId);
      persist();
      log.info(`order ${orderId} verdict delivered: ${verdict.verdict} (quality ${verdict.quality_score})`);
      try {
        await buildSite();
      } catch (err) {
        log.warn("site rebuild failed", String(err));
      }
      return;
    }

    let req = parseCertificationRequest(neg.requirements);
    if (req?.targetIsName) {
      const resolution = await resolveRequestTarget(req, orderId);
      if (resolution.kind === "ok") {
        req = resolution.req;
      } else if (req.targetIsName === "key") {
        // The buyer explicitly named a target we can't find — certifying
        // anything else would be delivering the wrong product. Honest reject.
        await client.rejectOrder(
          orderId,
          `No Store agent named "${req.target.slice(0, 60)}" found. Check the exact name on the Agent Store, or send {"target":"<agent uuid>"}. Escrow refunded.`,
        );
        state.processedOrders.push(orderId);
        persist();
        log.info(`order ${orderId} rejected with refund — unresolvable target name "${req.target}"`);
        return;
      } else {
        log.info(`order ${orderId}: bare token "${req.target}" matched no Store agent — using the default`);
        req = null;
      }
    }
    if (!req) {
      // Target-less order: default to certifying the buyer's own agent —
      // that's the overwhelmingly common intent, and a paying customer
      // should never be bounced on a format technicality.
      req = { target: order.requesterAgentId, runs: undefined, mode: undefined, note: undefined };
      defaultedToOwnAgent = true;
      log.info(`order ${orderId}: no parsable target — defaulting to the buyer's own agent ${order.requesterAgentId}`);
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
      probeInput: req.note, // buyers can pin the probe input via "note"
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
      await buildSite();
    } catch (err) {
      log.warn("site rebuild failed", String(err));
    }
  } catch (err) {
    log.error(`order ${orderId} pipeline failed`, String(err));
    // When we defaulted to the buyer's own agent and that agent isn't publicly
    // listed, the generic error reads like OUR outage. Tell the buyer what
    // actually happened and exactly how to re-order (learned from a real
    // buyer failing twice on this, 2026-07-13/14).
    const unlistedOwnAgent = defaultedToOwnAgent && /public\/agents\/.+HTTP 404/.test(String(err));
    const reason = unlistedOwnAgent
      ? `Your requirement had no target I could parse, so I tried your own agent — but it isn't publicly listed on the Store, so there was nothing to certify. Re-order with {"target":"<agent name or uuid>"}. Escrow refunded.`
      : `Certification pipeline failed (${String(err).slice(0, 120)}); escrow refunded.`;
    try {
      await client.rejectOrder(orderId, reason);
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

/** Liveness proof for the dashboard: "online" on the site is only honest if
 *  it is backed by a fresh heartbeat, not by the last static rebuild. Written
 *  every sweep (~45s); the homepage shows "degraded" when it goes stale. */
function writeHeartbeat(): void {
  try {
    const dir = resolve(cfg.siteDir, "api");
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "heartbeat.json"), JSON.stringify({ at: new Date().toISOString(), pid: process.pid }));
  } catch { /* non-fatal */ }
}

async function sweep(): Promise<void> {
  writeHeartbeat();
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
