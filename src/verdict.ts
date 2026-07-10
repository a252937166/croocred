import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { cfg } from "./config.js";
import { log } from "./log.js";

/**
 * Delivery Verdict — Claim Review.
 *
 * The zero-probe-capital service: an insurer (or any buyer) sends the
 * original request + the seller's delivery, and CrooCred returns a
 * claim-ready verdict. No outbound purchases required — pure adjudication,
 * reusing the same LLM rubric that grades certification probes.
 */

export interface ClaimVerdict {
  verdict: "approve_claim" | "deny_claim" | "manual_review";
  quality_score: number; // 0-100, quality of the seller's delivery
  claim_strength: "high" | "medium" | "low";
  reasons: string[];
  missing_requirements: string[];
  refund_recommendation: "full_refund" | "partial_refund" | "no_refund";
  evidence_hash: string; // sha256 over (input || verdict core) — commitment
  policy_id: string | null;
  order_id: string | null;
  adjudicated_at: string;
  adjudicator: "croocred";
  note: string;
  /** Reproducibility metadata: exactly which judge produced this verdict. */
  judge?: {
    model: string;
    temperature: number;
    parser: string;
    prompt_sha256: string;
  };
}

export interface ParsedClaim {
  buyerRequest: string;
  sellerOutput: string;
  successCriteria: string;
  policyId: string | null;
  orderId: string | null;
  /** true when the input parsed as a JSON object (schema path, not freeform) */
  structured: boolean;
  raw: string;
}

/** Claim parser v2.
 *  v1 missed the field names a real external integration used
 *  (`buyer_requirement`, `requirements`, `seller_delivery`), so the LLM was
 *  handed an empty BUYER REQUEST and invented tasks that were never asked
 *  (caught by an external pre-judging review, 2026-07-10 — the affected
 *  verdicts are marked invalidated and re-adjudicated, never silently edited).
 *  Alias order: explicit buyer_* names first; `requirements` LAST because it
 *  is the CAP transport field name and the most likely to carry meta text. */
export function parseClaim(requirements: string): ParsedClaim {
  let text = (requirements ?? "").trim();
  // requirements may arrive JSON-encoded (the API demands valid JSON)
  for (let i = 0; i < 2; i++) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed === "string") {
        text = parsed.trim();
        continue;
      }
      if (parsed && typeof parsed === "object") {
        const o = parsed as Record<string, unknown>;
        const pick = (...keys: string[]): string => {
          for (const k of keys) {
            const v = o[k];
            if (typeof v === "string" && v.trim()) return v.trim();
          }
          return "";
        };
        return {
          buyerRequest: pick("buyer_request", "buyer_requirement", "request", "task", "original_request", "requirements"),
          sellerOutput: pick("seller_output", "seller_delivery", "delivery", "deliverable", "output"),
          successCriteria: pick("success_criteria", "expected", "criteria", "expected_format"),
          policyId: pick("policy_id", "policyId") || null,
          orderId: pick("order_id", "orderId") || null,
          structured: true,
          raw: text,
        };
      }
      break;
    } catch {
      break;
    }
  }
  // Freeform text: let the adjudicator read it whole.
  return { buyerRequest: "", sellerOutput: "", successCriteria: "", policyId: null, orderId: null, structured: false, raw: text };
}

const CLAIM_TEMPERATURE = 0.1;

async function chatJSON(system: string, user: string): Promise<Record<string, unknown> | null> {
  if (!cfg.llmApiKey) return null;
  try {
    const res = await fetch(`${cfg.llmBaseURL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.llmApiKey}` },
      body: JSON.stringify({
        model: cfg.llmModel,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        max_tokens: 800,
        temperature: CLAIM_TEMPERATURE,
      }),
    });
    if (!res.ok) {
      log.warn(`verdict LLM HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const m = data.choices?.[0]?.message?.content?.match(/\{[\s\S]*\}/);
    return m ? (JSON.parse(m[0]) as Record<string, unknown>) : null;
  } catch (err) {
    log.warn("verdict LLM failed", String(err));
    return null;
  }
}

/** CAP order that purchased this adjudication — the verdict's own receipt. */
export interface VerdictOrderEvidence {
  orderId: string;
  chainOrderId?: string;
  requesterAgentId?: string;
  payTx?: string;
  deliverTx?: string;
  priceUsdc?: number;
  operatorDemo?: boolean;
}

const CLAIM_SYSTEM_PROMPT =
  "You are a strict, neutral claims adjudicator for AI-agent service deliveries. " +
  "Given the buyer's original request and the seller's actual delivery, judge whether the delivery " +
  "reasonably satisfies the request. Bad deliveries: empty, off-topic, generic filler, missing explicitly " +
  "requested sections, wrong format when a format was required. Do NOT punish style. " +
  "Judge ONLY against the buyer request given above — never assume or invent what the task might have been. " +
  'Reply ONLY JSON: {"verdict":"approve_claim|deny_claim|manual_review","quality_score":0-100,' +
  '"claim_strength":"high|medium|low","reasons":["..."],"missing_requirements":["..."],' +
  '"refund_recommendation":"full_refund|partial_refund|no_refund"}. ' +
  "approve_claim = the buyer's complaint is justified (delivery failed the task). " +
  "deny_claim = the delivery reasonably satisfies the task. " +
  "manual_review = genuinely ambiguous or insufficient information.";

const judgeMeta = (): NonNullable<ClaimVerdict["judge"]> => ({
  model: cfg.llmModel,
  temperature: CLAIM_TEMPERATURE,
  parser: "v2",
  prompt_sha256: "0x" + createHash("sha256").update(CLAIM_SYSTEM_PROMPT).digest("hex"),
});

export async function judgeClaim(
  requirements: string,
  orderEvidence?: VerdictOrderEvidence,
  opts?: { supersedes?: string; correction?: string },
): Promise<ClaimVerdict> {
  const c = parseClaim(requirements);
  const adjudicatedAt = new Date().toISOString();

  const sellerOutput = c.sellerOutput || "";
  const deterministic: string[] = [];
  if (!c.raw) deterministic.push("empty claim submission");
  if (c.buyerRequest && !sellerOutput) deterministic.push("no seller output provided in the claim");

  // ---- hard gate: structured claims must carry BOTH sides -----------------
  // A schema submission that parses but lacks the buyer request or the seller
  // output must never reach the LLM — an adjudicator with half the evidence
  // hallucinates the other half (this exact failure shipped once; see the
  // parser v2 note above). Deterministic manual_review, never a guess.
  if (c.structured && (!c.buyerRequest || !sellerOutput)) {
    const missingSide = !c.buyerRequest && !sellerOutput ? "buyer request and seller output"
      : !c.buyerRequest ? "buyer request" : "seller output";
    const reasons = [
      `Insufficient structured evidence for automatic adjudication — the claim JSON parsed but no ${missingSide} field was recognized.`,
      'Recognized buyer-request fields: buyer_request, buyer_requirement, request, task, original_request, requirements. Seller fields: seller_output, seller_delivery, delivery, deliverable, output.',
    ];
    const core = JSON.stringify({ input: c.raw, verdict: "manual_review", quality: 0, strength: "low", reasons, missing: [missingSide], refund: "no_refund", adjudicatedAt });
    const evidenceHash = "0x" + createHash("sha256").update(core).digest("hex");
    const gated: ClaimVerdict = {
      verdict: "manual_review",
      quality_score: 0,
      claim_strength: "low",
      reasons,
      missing_requirements: [missingSide],
      refund_recommendation: "no_refund",
      evidence_hash: evidenceHash,
      policy_id: c.policyId,
      order_id: c.orderId,
      adjudicated_at: adjudicatedAt,
      adjudicator: "croocred",
      note: "Deterministic gate — no LLM was consulted. Resubmit with both sides of the claim for automatic adjudication.",
      judge: judgeMeta(),
    };
    persistVerdict(c.raw, orderEvidence, gated, opts);
    return gated;
  }

  const llm = await chatJSON(
    CLAIM_SYSTEM_PROMPT,
    c.buyerRequest || c.sellerOutput
      ? `BUYER REQUEST:\n${c.buyerRequest.slice(0, 2000)}\n\n` +
        (c.successCriteria ? `SUCCESS CRITERIA:\n${c.successCriteria.slice(0, 800)}\n\n` : "") +
        `SELLER DELIVERY:\n${sellerOutput.slice(0, 4000)}`
      : `CLAIM (freeform):\n${c.raw.slice(0, 6000)}`,
  );

  let verdict: ClaimVerdict["verdict"] = "manual_review";
  let quality = 50;
  let strength: ClaimVerdict["claim_strength"] = "low";
  let reasons: string[] = [];
  let missing: string[] = [];
  let refund: ClaimVerdict["refund_recommendation"] = "no_refund";

  if (llm) {
    const v = String(llm.verdict ?? "");
    if (v === "approve_claim" || v === "deny_claim" || v === "manual_review") verdict = v;
    if (typeof llm.quality_score === "number") quality = Math.max(0, Math.min(100, llm.quality_score));
    const s = String(llm.claim_strength ?? "");
    if (s === "high" || s === "medium" || s === "low") strength = s;
    if (Array.isArray(llm.reasons)) reasons = llm.reasons.map(String).slice(0, 8);
    if (Array.isArray(llm.missing_requirements)) missing = llm.missing_requirements.map(String).slice(0, 8);
    const r = String(llm.refund_recommendation ?? "");
    if (r === "full_refund" || r === "partial_refund" || r === "no_refund") refund = r;
  } else {
    reasons = [...deterministic, "LLM adjudicator unavailable — returning manual_review (never guess on refunds)"];
  }
  reasons = [...new Set([...deterministic, ...reasons])];

  const core = JSON.stringify({ input: c.raw, verdict, quality, strength, reasons, missing, refund, adjudicatedAt });
  const evidenceHash = "0x" + createHash("sha256").update(core).digest("hex");

  const result: ClaimVerdict = {
    verdict,
    quality_score: quality,
    claim_strength: strength,
    reasons,
    missing_requirements: missing,
    refund_recommendation: refund,
    evidence_hash: evidenceHash,
    policy_id: c.policyId,
    order_id: c.orderId,
    adjudicated_at: adjudicatedAt,
    adjudicator: "croocred",
    note: "Independent third-party adjudication by CrooCred. The evidence hash commits to the exact claim input and verdict; verify by re-hashing.",
    judge: judgeMeta(),
  };

  persistVerdict(c.raw, orderEvidence, result, opts);
  return result;
}

/** Persist for the dashboard ("claim verdicts issued" + evidence page). */
function persistVerdict(
  raw: string,
  orderEvidence: VerdictOrderEvidence | undefined,
  result: ClaimVerdict,
  opts?: { supersedes?: string; correction?: string },
): void {
  try {
    const dir = resolve(cfg.dataDir, "verdicts");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      resolve(dir, `v-${result.adjudicated_at.replace(/[-:.TZ]/g, "").slice(0, 14)}-${result.evidence_hash.slice(2, 8)}.json`),
      JSON.stringify({
        input: raw.slice(0, 8000),
        soldVia: orderEvidence ?? null,
        ...(opts?.supersedes ? { supersedes: opts.supersedes, correction: opts.correction ?? "re-adjudication" } : {}),
        result,
      }, null, 2),
    );
  } catch (err) {
    log.warn("verdict persist failed", String(err));
  }
}

/**
 * Re-adjudicate a stored verdict whose original run mis-parsed the claim
 * (parser v1). Never edits the old verdict's content: the old record keeps
 * its evidence hash and CAP order, gains `invalidated` markers, and a new
 * corrected record is written with a `supersedes` link to the old hash.
 * Returns null when the record does not need correction.
 */
export async function readjudicateVerdictFile(fileName: string): Promise<{ oldHash: string; newHash: string } | null> {
  const dir = resolve(cfg.dataDir, "verdicts");
  const p = resolve(dir, fileName);
  const rec = JSON.parse(readFileSync(p, "utf8")) as {
    input?: string;
    soldVia?: VerdictOrderEvidence | null;
    supersedes?: string;
    invalidated?: string;
    result: ClaimVerdict;
  };
  if (rec.invalidated || rec.supersedes || !rec.input) return null;
  // needs correction iff: v1 read no buyer request from a structured claim, v2 does
  const c = parseClaim(rec.input);
  const v1Request = ((): string => {
    try {
      const o = JSON.parse(rec.input) as Record<string, unknown>;
      for (const k of ["buyer_request", "request", "task", "original_request"]) {
        const v = o[k];
        if (typeof v === "string" && v.trim()) return v.trim();
      }
    } catch { /* freeform */ }
    return "";
  })();
  if (!c.structured || v1Request || !c.buyerRequest) return null;

  const corrected = await judgeClaim(rec.input, rec.soldVia ?? undefined, {
    supersedes: rec.result.evidence_hash,
    correction: "parser_v1_missed_buyer_requirement — re-adjudicated against the actual buyer request; original CAP order and evidence hash preserved on the invalidated record",
  });
  const updated = {
    ...rec,
    invalidated: "parser_v1",
    invalidatedAt: new Date().toISOString(),
    supersededBy: corrected.evidence_hash,
    invalidationNote:
      "Parser v1 did not recognize this claim's buyer-request field, so the LLM was adjudicating without the real task. Marked invalid and re-adjudicated (see supersededBy). Disclosed publicly; the CAP order and original evidence hash are unchanged.",
  };
  writeFileSync(p, JSON.stringify(updated, null, 2));
  log.info(`verdict ${fileName} invalidated (parser_v1) → superseded by ${corrected.evidence_hash.slice(0, 10)}…`);
  return { oldHash: rec.result.evidence_hash, newHash: corrected.evidence_hash };
}

/** Patch order evidence (e.g. the deliver tx, known only after delivery) into a persisted verdict. */
export function attachVerdictEvidence(evidenceHash: string, patch: Partial<VerdictOrderEvidence>): void {
  try {
    const dir = resolve(cfg.dataDir, "verdicts");
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(`${evidenceHash.slice(2, 8)}.json`)) continue;
      const p = resolve(dir, f);
      const data = JSON.parse(readFileSync(p, "utf8")) as { soldVia?: Partial<VerdictOrderEvidence> | null };
      data.soldVia = { ...(data.soldVia ?? {}), ...patch };
      writeFileSync(p, JSON.stringify(data, null, 2));
      return;
    }
  } catch (err) {
    log.warn("verdict evidence patch failed", String(err));
  }
}
