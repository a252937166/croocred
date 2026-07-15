import { AgentClient } from "@croo-network/sdk";
import { cfg, usdc } from "./config.js";
import { log } from "./log.js";
import { resolveTarget } from "./publicApi.js";
import { runTestPurchase, runLivenessProbe, type TestRun } from "./shopper.js";
import { synthesizeProbeInput, judgeDeliverable, type QualityVerdict } from "./judge.js";
import { computeScore } from "./score.js";
import { chooseProbeMode } from "./balance.js";
import {
  buildRecord,
  saveRecord,
  newCertId,
  deliverablePayload,
  lastKnownGoodProbe,
  type CertRecord,
} from "./report.js";

/** The listing tells buyers to send structured data (a schema, or a text
 *  hint that spells out JSON fields) — a generic prose probe would violate it. */
function wantsStructuredInput(service: { requirementType: string; requirementText: string }): boolean {
  return service.requirementType === "schema" || /json|schema|\{/i.test(service.requirementText ?? "");
}

/**
 * The full certification pipeline:
 *   resolve target listing → synthesize probe input → N sequential paid
 *   test orders → judge each deliverable → aggregate score → persist record.
 *
 * Sequential on purpose: concurrent PayOrder calls from one AA wallet
 * collide on the wallet nonce (documented CROO limitation).
 */
export async function certify(
  client: AgentClient,
  targetId: string,
  opts: {
    runs?: number;
    soldVia?: CertRecord["soldVia"];
    mode?: "paid" | "liveness";
    /** Buyer-supplied probe input (e.g. a sample file URL) — skips LLM synthesis. */
    probeInput?: string;
  } = {},
): Promise<CertRecord> {
  const { agent, service } = await resolveTarget(targetId);
  let runsWanted = Math.max(1, Math.min(3, opts.runs ?? cfg.runsPerCert));

  const budget = usdc(service.price) * runsWanted;
  const mode = opts.mode ?? (await chooseProbeMode(budget));
  if (mode === "liveness") runsWanted = 1; // one polite zero-cost probe, never spam cancellations

  log.info(`certifying "${agent.name}" / "${service.name}" (${usdc(service.price)} USDC, SLA ${service.slaMinutes}m, ${runsWanted} ${mode} probe(s))`);

  if (mode === "paid" && budget > cfg.maxBudgetPerCertUsdc) {
    throw new Error(
      `certification budget ${budget.toFixed(2)} USDC exceeds cap ${cfg.maxBudgetPerCertUsdc}; ` +
        `lower RUNS_PER_CERT or raise MAX_BUDGET_PER_CERT_USDC`,
    );
  }

  // Probe input precedence: buyer-supplied > last known-good for this service
  // (keeps re-check grades comparable and survives synthesis outages) > fresh
  // LLM synthesis. The generic fallback is refused when the listing declares
  // structured input — grading an agent on a contract-violating probe produces
  // a false AVOID (real re-check order 872cecda, 2026-07-14).
  let probeInput: string;
  let provenance: CertRecord["probeProvenance"];
  const reusable = opts.probeInput?.trim() ? null : lastKnownGoodProbe(service.serviceId);
  if (opts.probeInput?.trim()) {
    probeInput = opts.probeInput.trim();
    provenance = "buyer";
  } else if (reusable) {
    probeInput = reusable.input;
    provenance = "reused";
    log.info(`probe input reused from ${reusable.fromCertId}`);
  } else {
    const synth = await synthesizeProbeInput(agent, service);
    probeInput = synth.input;
    provenance = synth.provenance;
    if (provenance === "fallback" && wantsStructuredInput(service)) {
      throw new Error(
        `probe synthesis unavailable and "${service.name}" declares structured input — ` +
          "refusing to grade on a contract-violating probe; re-order with a probe in \"note\" or retry later",
      );
    }
  }
  log.info(`probe input (${provenance}):`, probeInput.slice(0, 200));

  const runs: TestRun[] = [];
  const verdicts: QualityVerdict[] = [];
  for (let i = 0; i < runsWanted; i++) {
    // Vary the input per probe (only when freshly synthesized): identical
    // inputs make identical outputs uninformative — with distinct inputs,
    // identical outputs are strong evidence of a canned response. Buyer and
    // reused probes stay fixed so runs (and re-checks) are comparable.
    const input =
      i === 0 || provenance !== "synthesized"
        ? probeInput
        : (await synthesizeProbeInput(agent, service)).input;
    if (i > 0 && input !== probeInput) log.info(`probe input #${i + 1}:`, input.slice(0, 160));
    const run =
      mode === "paid"
        ? await runTestPurchase(client, service, input, i + 1)
        : await runLivenessProbe(client, service, input, i + 1);
    runs.push(run);
    verdicts.push(
      mode === "paid"
        ? await judgeDeliverable(agent, service, run)
        : {
            assessed: false,
            score: null,
            matchesPromise: null,
            issues: [],
            summary: "liveness probe — no payment made, delivery quality not assessed",
          },
    );
    // If the very first probe can't even negotiate, don't burn more attempts.
    if (i === 0 && ["negotiate", "acceptance_timeout"].includes(run.failureStage ?? "") && runsWanted > 1) {
      log.warn("first probe failed before payment — recording single-probe verdict");
      break;
    }
  }

  const score = computeScore(agent, service, runs, verdicts);
  const rec = buildRecord(newCertId(agent.agentId), agent, service, runs, verdicts, score, opts.soldVia);
  rec.probeProvenance = provenance;
  const file = saveRecord(rec);
  log.info(`certification done: ${rec.certId} grade=${score.grade} score=${score.score} spent=$${rec.spentUsdc.toFixed(2)} → ${file}`);
  return rec;
}

export { deliverablePayload };
