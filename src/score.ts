import type { PublicAgent, PublicService } from "./publicApi.js";
import type { TestRun } from "./shopper.js";
import type { QualityVerdict } from "./judge.js";

/**
 * Scoring model (0-100). Weights favor what a hiring agent actually risks:
 * does the provider respond, deliver on time, and return what was promised.
 *
 *   availability  30  — negotiations answered, orders not stalled/rejected
 *   reliability   25  — paid orders delivered (escrow released, not refunded)
 *   latency       15  — delivery time vs promised SLA
 *   conformance   15  — deliverable shape matches the listing
 *   quality       15  — LLM-judged substance vs promise (redistributed if unassessed)
 */

export interface CertScore {
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  verdict: "certified" | "conditional" | "not_certified";
  components: Record<string, number>;
  flags: string[];
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
  const raw = components.availability + components.latency;
  // Cap at 70 (a C) — liveness alone can never earn an A/B badge.
  const score = Math.min(70, raw);
  const grade = score >= 55 ? "C" : score >= 40 ? "D" : "F";
  return {
    score,
    grade,
    verdict: grade === "C" ? "conditional" : "not_certified",
    components,
    flags: flags.slice(0, 10),
  };
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
  const accepted = runs.filter((r) => !["negotiate", "acceptance_timeout", "negotiation_rejected"].includes(r.failureStage ?? "")).length;
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
  let conformance = 0;
  if (deliveredRuns.length) {
    const okShape = deliveredRuns.filter((r, i) => {
      const v = verdicts[i];
      const shapeIssue = v?.issues.some((s) => /empty deliverable|not valid JSON/i.test(s));
      return !shapeIssue;
    }).length;
    conformance = okShape / deliveredRuns.length;
  }

  // quality: mean LLM score /10 across assessed runs
  const assessed = verdicts.filter((v) => v.assessed && v.score !== null);
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
  const score = Object.values(components).reduce((a, b) => a + b, 0);

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

  const grade = score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : score >= 40 ? "D" : "F";
  const verdict = grade <= "B" ? "certified" : grade === "C" ? "conditional" : "not_certified";

  return { score, grade, verdict: verdict as CertScore["verdict"], components, flags: flags.slice(0, 10) };
}
