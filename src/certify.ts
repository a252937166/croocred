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
  type CertRecord,
} from "./report.js";

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

  const probeInput = opts.probeInput?.trim() || (await synthesizeProbeInput(agent, service));
  log.info(`probe input${opts.probeInput ? " (buyer-supplied)" : ""}:`, probeInput.slice(0, 200));

  const runs: TestRun[] = [];
  const verdicts: QualityVerdict[] = [];
  for (let i = 0; i < runsWanted; i++) {
    // Vary the input per probe (unless buyer-supplied): identical inputs make
    // identical outputs uninformative — with distinct inputs, identical
    // outputs are strong evidence of a canned response.
    const input =
      i === 0 || opts.probeInput?.trim() ? probeInput : await synthesizeProbeInput(agent, service);
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
  const file = saveRecord(rec);
  log.info(`certification done: ${rec.certId} grade=${score.grade} score=${score.score} spent=$${rec.spentUsdc.toFixed(2)} → ${file}`);
  return rec;
}

export { deliverablePayload };
