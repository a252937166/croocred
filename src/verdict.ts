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
}

interface ParsedClaim {
  buyerRequest: string;
  sellerOutput: string;
  successCriteria: string;
  policyId: string | null;
  orderId: string | null;
  raw: string;
}

function parseClaim(requirements: string): ParsedClaim {
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
          buyerRequest: pick("buyer_request", "request", "task", "original_request"),
          sellerOutput: pick("seller_output", "delivery", "deliverable", "output"),
          successCriteria: pick("success_criteria", "expected", "criteria", "expected_format"),
          policyId: pick("policy_id", "policyId") || null,
          orderId: pick("order_id", "orderId") || null,
          raw: text,
        };
      }
      break;
    } catch {
      break;
    }
  }
  // Freeform text: let the adjudicator read it whole.
  return { buyerRequest: "", sellerOutput: "", successCriteria: "", policyId: null, orderId: null, raw: text };
}

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
        temperature: 0.1,
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

export async function judgeClaim(
  requirements: string,
  orderEvidence?: VerdictOrderEvidence,
): Promise<ClaimVerdict> {
  const c = parseClaim(requirements);
  const adjudicatedAt = new Date().toISOString();

  const sellerOutput = c.sellerOutput || "";
  const deterministic: string[] = [];
  if (!c.raw) deterministic.push("empty claim submission");
  if (c.buyerRequest && !sellerOutput) deterministic.push("no seller output provided in the claim");

  const llm = await chatJSON(
    "You are a strict, neutral claims adjudicator for AI-agent service deliveries. " +
      "Given the buyer's original request and the seller's actual delivery, judge whether the delivery " +
      "reasonably satisfies the request. Bad deliveries: empty, off-topic, generic filler, missing explicitly " +
      "requested sections, wrong format when a format was required. Do NOT punish style. " +
      'Reply ONLY JSON: {"verdict":"approve_claim|deny_claim|manual_review","quality_score":0-100,' +
      '"claim_strength":"high|medium|low","reasons":["..."],"missing_requirements":["..."],' +
      '"refund_recommendation":"full_refund|partial_refund|no_refund"}. ' +
      "approve_claim = the buyer's complaint is justified (delivery failed the task). " +
      "deny_claim = the delivery reasonably satisfies the task. " +
      "manual_review = genuinely ambiguous or insufficient information.",
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
  };

  // Persist for the dashboard ("claim verdicts issued" + evidence page).
  try {
    const dir = resolve(cfg.dataDir, "verdicts");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      resolve(dir, `v-${adjudicatedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}-${evidenceHash.slice(2, 8)}.json`),
      JSON.stringify({ input: c.raw.slice(0, 8000), soldVia: orderEvidence ?? null, result }, null, 2),
    );
  } catch (err) {
    log.warn("verdict persist failed", String(err));
  }

  return result;
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
