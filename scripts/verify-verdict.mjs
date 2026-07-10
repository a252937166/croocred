#!/usr/bin/env node
/**
 * Recompute a claim verdict's evidence hash from its stored record and compare
 * with the published one — no trust in the dashboard required.
 *
 *   npm run verify-verdict -- evidence/verdicts/v-....json
 *   node scripts/verify-verdict.mjs <record.json> [more.json…]
 *
 * Hash schema croocred-claim-verdict-v1:
 *   sha256( JSON.stringify({ input, verdict, quality, strength,
 *                            reasons, missing, refund, adjudicatedAt }) )
 * with exactly that key order. Caveat: records persist `input` truncated to
 * 8000 chars; if the original claim was longer the recomputation cannot match
 * (flagged below — none of the current records are truncated).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const files = process.argv.slice(2);
if (!files.length) {
  console.error("usage: npm run verify-verdict -- <verdict-record.json> [...]");
  process.exit(2);
}

let failed = 0;
for (const f of files) {
  const rec = JSON.parse(readFileSync(f, "utf8"));
  const r = rec.result ?? {};
  const preimage = JSON.stringify({
    input: rec.input,
    verdict: r.verdict,
    quality: r.quality_score,
    strength: r.claim_strength,
    reasons: r.reasons,
    missing: r.missing_requirements,
    refund: r.refund_recommendation,
    adjudicatedAt: r.adjudicated_at,
  });
  const hash = "0x" + createHash("sha256").update(preimage).digest("hex");
  const ok = hash === r.evidence_hash;
  if (!ok) failed++;
  const trunc = (rec.input ?? "").length >= 8000 ? " (input at 8000-char persistence limit — possible truncation)" : "";
  console.log(`${ok ? "MATCH   " : "MISMATCH"}  ${f}`);
  console.log(`          published: ${r.evidence_hash}`);
  if (!ok) console.log(`          recomputed: ${hash}${trunc}`);
}
process.exit(failed ? 1 : 0);
