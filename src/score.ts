import type { PublicAgent, PublicService } from "./publicApi.js";
import type { TestRun } from "./shopper.js";
import type { QualityVerdict } from "./judge.js";

/**
 * Scoring model (0-100), rubric v2.
 *
 * Components (weights favor what a hiring agent actually risks):
 *   availability  30  — negotiations answered, orders not stalled/rejected
 *   reliability   25  — paid orders delivered (escrow released, not refunded)
 *   latency       15  — delivery time vs promised SLA
 *   conformance   15  — deliverable shape matches the listing
 *   quality       15  — LLM-judged substance vs promise (redistributed if unassessed)
 *
 * v2 separates two axes that v1 conflated:
 *   capOutcome     — did the CAP lifecycle complete (escrow, delivery, settlement)
 *   qualityOutcome — did the content do what the listing promises
 * A provider can pass CAP and fail quality (paid, delivered… an empty payload).
 * Certification is only earned when BOTH pass. Hard gates below make that
 * impossible to bypass: empty deliverables, conformance 0 or judged quality 0
 * can never produce a "certified / HIRE" report. An audit product must rather
 * under-certify than mislabel a failure as a pass.
 */

export interface CertScore {
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  verdict: "certified" | "conditional" | "not_certified";
  /** CAP lifecycle outcome, independent of content quality. */
  capOutcome: "delivered" | "partial" | "failed" | "created_only";
  /** Judged content quality vs the listing promise, independent of lifecycle. */
  qualityOutcome: "pass" | "weak" | "fail" | "not_assessed";
  recommendation: "HIRE" | "CAUTION" | "AVOID";
  rubricVersion: number;
  components: Record<string, number>;
  flags: string[];
}

const GATE_PREFIX = "rubric gate:";

/**
 * Final scoring stage — pure function over (components, flags, runs, verdicts).
 * Used both by live certifications and by `cli rescore`, which replays stored
 * records through the current rubric (gate flags are stripped first so the
 * operation is idempotent).
 */
export function finalizeScore(
  components: Record<string, number>,
  baseFlags: string[],
  runs: TestRun[],
  verdicts: QualityVerdict[],
): CertScore {
  const flags = baseFlags.filter((f) => !f.startsWith(GATE_PREFIX));
  const raw = Object.values(components).reduce((a, b) => a + b, 0);

  // ---- liveness tier: no USDC moved, capped at C, delivery never assessed --
  if (runs.length > 0 && runs.every((r) => r.mode === "liveness")) {
    const score = Math.min(70, raw);
    const grade = score >= 55 ? "C" : score >= 40 ? "D" : "F";
    return {
      score,
      grade,
      verdict: grade === "C" ? "conditional" : "not_certified",
      capOutcome: "created_only",
      qualityOutcome: "not_assessed",
      recommendation: grade === "C" ? "CAUTION" : "AVOID",
      rubricVersion: 2,
      components,
      flags: flags.slice(0, 12),
    };
  }

  const paidRuns = runs.filter((r) => r.txHashes.pay);
  const deliveredRuns = runs.filter((r) => r.ok);
  // Verdicts are parallel to runs; only verdicts of runs that actually
  // delivered say anything about delivery content (a pre-delivery failure
  // yields an "empty" verdict that must not count as an empty delivery).
  const deliveredVerdicts = runs
    .map((r, i) => ({ run: r, v: verdicts[i] }))
    .filter((p) => p.run.ok && p.v)
    .map((p) => p.v);
  const assessed = deliveredVerdicts.filter((v) => v.assessed && v.score !== null);
  const qMean = assessed.length
    ? assessed.reduce((a, v) => a + (v.score ?? 0), 0) / assessed.length
    : null;
  const emptyCount = deliveredVerdicts.filter((v) =>
    v.issues.some((s) => /empty deliverable/i.test(s)),
  ).length;

  const capOutcome: CertScore["capOutcome"] =
    deliveredRuns.length === 0 ? "failed"
    : deliveredRuns.length < paidRuns.length ? "partial"
    : "delivered";

  let score = raw;
  let avoid = false;
  const gate = (cap: number, why: string) => {
    if (score > cap) score = cap;
    flags.unshift(`${GATE_PREFIX} ${why}`);
  };

  // ---- hard gates: a delivery that isn't a delivery -----------------------
  if (deliveredRuns.length === 0) {
    gate(39, "no paid probe was delivered — CAP lifecycle failed");
    avoid = true;
  } else if (emptyCount > 0 && emptyCount >= deliveredRuns.length) {
    gate(39, "every delivered probe returned an empty payload — treated as non-delivery");
    avoid = true;
  } else if (emptyCount > 0) {
    gate(54, `${emptyCount} of ${deliveredRuns.length} delivered probes returned an empty payload`);
    avoid = true;
  }
  if (deliveredRuns.length > 0 && (components.conformance ?? 0) === 0) {
    gate(54, "conformance 0 — deliverable shape never matched the listing");
    avoid = true;
  }

  // ---- quality gates: content vs promise ----------------------------------
  let qualityOutcome: CertScore["qualityOutcome"];
  if (qMean === null) {
    qualityOutcome = deliveredRuns.length ? "not_assessed" : "fail";
    if (deliveredRuns.length)
      gate(69, "delivery quality not judged — certification requires an assessed deliverable");
  } else if (qMean < 3) {
    qualityOutcome = "fail";
    gate(54, `judged quality ${qMean.toFixed(1)}/10 — broken or irrelevant output`);
    avoid = true;
  } else if (qMean < 5) {
    qualityOutcome = "fail";
    gate(69, `judged quality ${qMean.toFixed(1)}/10 — the listing's core promise was not met`);
  } else if (qMean < 7) {
    qualityOutcome = "weak";
    gate(84, `judged quality ${qMean.toFixed(1)}/10 — acceptable, below the bar for an A`);
  } else {
    qualityOutcome = emptyCount > 0 ? "weak" : "pass";
  }

  const grade = score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : score >= 40 ? "D" : "F";
  const verdict: CertScore["verdict"] =
    avoid || grade === "D" || grade === "F" ? "not_certified"
    : grade === "C" || qualityOutcome === "fail" || qualityOutcome === "not_assessed" ? "conditional"
    : "certified";

  const severe = flags.some((f) =>
    /empty deliverable|not valid JSON|stalled|missed SLA|offline at certification/i.test(f),
  );
  const recommendation: CertScore["recommendation"] =
    avoid || verdict === "not_certified" ? "AVOID"
    : verdict === "certified" && qualityOutcome === "pass" && !severe ? "HIRE"
    : "CAUTION";

  return {
    score,
    grade,
    verdict,
    capOutcome,
    qualityOutcome,
    recommendation,
    rubricVersion: 2,
    components,
    flags: flags.slice(0, 12),
  };
}

/**
 * Liveness-tier scoring: no USDC moved, so only responsiveness and CAP
 * integration health are graded. Grade is capped at C ("conditional") —
 * full certification requires paid probes.
 */
function computeLivenessScore(agent: PublicAgent, service: PublicService, runs: TestRun[]): CertScore {
  const flags: string[] = ["liveness-tier certification: paid delivery not assessed (no funds moved)"];
  const attempted = runs.length || 1;
  const created = runs.filter((r) => r.ok).length;
  const availability = created / attempted;

  let latency = 0;
  const acceptTimes = runs.filter((r) => r.tAcceptMs !== undefined).map((r) => r.tAcceptMs!);
  if (acceptTimes.length) {
    const mean = acceptTimes.reduce((a, b) => a + b, 0) / acceptTimes.length;
    latency = mean <= 5_000 ? 1 : mean <= 15_000 ? 0.9 : mean <= 60_000 ? 0.75 : mean <= 300_000 ? 0.5 : 0.2;
  }

  if (agent.onlineStatus !== "online") flags.push("agent listed as offline at certification time");
  if (Number(agent.completedOrders) < 10) flags.push("thin track record (<10 completed orders)");
  if (Number(service.orders7d) === 0) flags.push("no orders in the last 7 days for this service");
  if (runs.some((r) => r.failureStage === "order_creation_stalled"))
    flags.push("order stalled in `creating` (platform-side stall observed)");
  if (runs.some((r) => r.failureStage === "negotiation_rejected"))
    flags.push("provider rejected the probe negotiation");
  if (runs.some((r) => r.failureStage === "acceptance_timeout"))
    flags.push("provider did not respond to the probe negotiation before timeout");

  const components = {
    availability: Math.round(availability * 60),
    latency: Math.round(latency * 40),
    reliability: 0,
    conformance: 0,
    quality: 0,
  };
  return finalizeScore(components, flags, runs, []);
}

export function computeScore(
  agent: PublicAgent,
  service: PublicService,
  runs: TestRun[],
  verdicts: QualityVerdict[],
): CertScore {
  if (runs.every((r) => r.mode === "liveness")) return computeLivenessScore(agent, service, runs);
  const flags: string[] = [];
  const attempted = runs.length;
  const paidRuns = runs.filter((r) => r.txHashes.pay);
  const deliveredRuns = runs.filter((r) => r.ok);

  // availability: got past negotiation AND order creation
  const createdRuns = runs.filter(
    (r) => r.ok || ["pay", "delivery_timeout", "order_rejected_after_payment", "delivery_fetch"].includes(r.failureStage ?? ""),
  );
  const availability = attempted ? createdRuns.length / attempted : 0;

  // reliability: of paid orders, how many actually delivered
  const reliability = paidRuns.length ? deliveredRuns.length / paidRuns.length : 0;

  // latency: mean(deliverTime / SLA), clamped; missing → 0
  let latency = 0;
  if (deliveredRuns.length) {
    const ratios = deliveredRuns.map((r) => Math.min(1.5, (r.tDeliverMs ?? 0) / (r.slaMs ?? 1)));
    const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    latency = mean <= 0.25 ? 1 : mean <= 0.5 ? 0.9 : mean <= 0.8 ? 0.75 : mean <= 1.0 ? 0.6 : 0.2;
  }

  // conformance: delivered runs whose payload shape matches the listing
  // (verdicts are parallel to runs — index by run position, not by the
  // delivered subset, or a failed run shifts every later verdict)
  let conformance = 0;
  if (deliveredRuns.length) {
    const okShape = runs.filter((r, i) => {
      if (!r.ok) return false;
      const v = verdicts[i];
      const shapeIssue = v?.issues.some((s) => /empty deliverable|not valid JSON/i.test(s));
      return !shapeIssue;
    }).length;
    conformance = okShape / deliveredRuns.length;
  }

  // quality: mean LLM score /10 across assessed delivered runs
  const assessed = runs
    .map((r, i) => ({ run: r, v: verdicts[i] }))
    .filter((p) => p.run.ok && p.v?.assessed && p.v.score !== null)
    .map((p) => p.v);
  const qualityAssessed = assessed.length > 0;
  const quality = qualityAssessed
    ? assessed.reduce((a, v) => a + (v.score ?? 0), 0) / assessed.length / 10
    : 0;

  const weights = qualityAssessed
    ? { availability: 30, reliability: 25, latency: 15, conformance: 15, quality: 15 }
    : { availability: 32, reliability: 28, latency: 17, conformance: 23, quality: 0 };

  const components = {
    availability: Math.round(availability * weights.availability),
    reliability: Math.round(reliability * weights.reliability),
    latency: Math.round(latency * weights.latency),
    conformance: Math.round(conformance * weights.conformance),
    quality: Math.round(quality * weights.quality),
  };

  // Flags (informational, mirror the hackathon's own risk language)
  if (agent.onlineStatus !== "online") flags.push("agent listed as offline at certification time");
  if (Number(agent.completedOrders) < 10) flags.push("thin track record (<10 completed orders)");
  if (Number(service.orders7d) === 0) flags.push("no orders in the last 7 days for this service");
  if (runs.some((r) => r.failureStage === "order_creation_stalled"))
    flags.push("order stalled in `creating` (platform-side stall observed)");
  if (runs.some((r) => r.failureStage === "delivery_timeout"))
    flags.push("missed SLA on a paid test order (escrow refunded)");
  if (deliveredRuns.length >= 2) {
    const texts = deliveredRuns.map((r) => (r.deliverableText ?? "").trim());
    if (new Set(texts).size === 1 && texts[0].length > 0)
      flags.push("identical deliverable across distinct probes (possible canned output)");
  }
  for (const v of verdicts) for (const i of v.issues) if (!flags.includes(i)) flags.push(i);

  return finalizeScore(components, flags, runs, verdicts);
}
