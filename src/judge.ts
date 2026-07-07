import { cfg } from "./config.js";
import { log } from "./log.js";
import type { PublicAgent, PublicService } from "./publicApi.js";
import type { TestRun } from "./shopper.js";

/**
 * LLM duties:
 *  1. Synthesize a realistic test input from the target's own listing
 *     (description + requirement schema) — the probe order.
 *  2. Grade the actual deliverable against what the listing promises.
 *
 * Uses any OpenAI-compatible endpoint (DeepSeek by default). When no key is
 * configured, falls back to deterministic heuristics so the pipeline still
 * completes (quality is then reported as "not assessed").
 */

interface ChatMsg {
  role: "system" | "user";
  content: string;
}

async function chat(messages: ChatMsg[], maxTokens = 900): Promise<string | null> {
  if (!cfg.llmApiKey) return null;
  try {
    const res = await fetch(`${cfg.llmBaseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${cfg.llmApiKey}`,
      },
      body: JSON.stringify({
        model: cfg.llmModel,
        messages,
        max_tokens: maxTokens,
        temperature: 0.2,
      }),
    });
    if (!res.ok) {
      log.warn(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content ?? null;
  } catch (err) {
    log.warn("LLM call failed", String(err));
    return null;
  }
}

function extractJSON<T>(text: string | null): T | null {
  if (!text) return null;
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as T;
  } catch {
    return null;
  }
}

/** Build the probe input we send as `requirements` when test-buying. */
export async function synthesizeProbeInput(
  agent: PublicAgent,
  service: PublicService,
): Promise<string> {
  const schema = service.requirementSchema && service.requirementSchema !== "[]"
    ? service.requirementSchema
    : null;

  // Schema-typed service with an empty schema = expects an empty JSON object.
  if (service.requirementType === "schema" && !schema) return "{}";

  const llm = await chat(
    [
      {
        role: "system",
        content:
          "You generate ONE realistic test request for an AI agent service, acting as a genuine customer. " +
          "Reply with ONLY the request payload, no commentary. " +
          "If a JSON requirement schema is provided, reply with a single JSON object matching it exactly. " +
          "Otherwise reply with one short plain-text request. Keep it answerable and specific. " +
          "CRITICAL: never invent or fabricate resource URLs (images, files, pages) — a made-up URL is " +
          "unfetchable and produces a false failure (learned from a live probe, 2026-07-07). If the service " +
          "needs a resource URL, reuse a concrete sample URL from the listing text verbatim if one exists; " +
          "if none exists, design the request so it does not depend on fetching any URL.",
      },
      {
        role: "user",
        content:
          `Agent: ${agent.name}\nAgent description: ${agent.description.slice(0, 800)}\n` +
          `Service: ${service.name}\nService description: ${service.description.slice(0, 800)}\n` +
          `Requirement type: ${service.requirementType || "none"}\n` +
          (schema ? `Requirement schema (JSON): ${schema}\n` : "") +
          (service.requirementText ? `Requirement hint: ${service.requirementText}\n` : "") +
          "Generate the test request now.",
      },
    ],
    500,
  );

  if (llm) {
    const trimmed = llm.trim().replace(/^```(json)?\s*|\s*```$/g, "");
    if (schema) {
      const parsed = extractJSON<Record<string, unknown>>(trimmed);
      if (parsed) return JSON.stringify(parsed);
    } else if (trimmed.length > 0 && trimmed.length < 2000) {
      return trimmed;
    }
  }

  // Heuristic fallback: satisfy the schema minimally, or send a generic ask.
  if (schema) {
    try {
      const fields = JSON.parse(schema) as { name: string; type?: string; description?: string }[];
      const obj: Record<string, unknown> = {};
      for (const f of fields) {
        obj[f.name] =
          f.type === "number" ? 1 :
          f.type === "boolean" ? true :
          f.type === "array" ? [] :
          f.type === "object" ? {} :
          `test ${f.description ?? f.name}`.slice(0, 100);
      }
      return JSON.stringify(obj);
    } catch {
      /* fall through */
    }
  }
  return `Please demonstrate your service "${service.name}" on a small, representative example. This is a genuine paid evaluation order.`;
}

export interface QualityVerdict {
  assessed: boolean;
  score: number | null; // 0-10
  matchesPromise: boolean | null;
  issues: string[];
  summary: string;
}

/** Grade one deliverable against the listing promise. */
export async function judgeDeliverable(
  agent: PublicAgent,
  service: PublicService,
  run: TestRun,
): Promise<QualityVerdict> {
  const text = (run.deliverableText ?? "").trim();

  // Deterministic pre-checks
  const issues: string[] = [];
  if (!text) issues.push("empty deliverable");
  if (service.deliverableType === "schema") {
    try {
      JSON.parse(text);
    } catch {
      issues.push("deliverable is not valid JSON despite schema deliverable type");
    }
  }
  if (text && /lorem ipsum|as an ai (language )?model/i.test(text)) {
    issues.push("boilerplate/filler content detected");
  }

  const llm = await chat(
    [
      {
        role: "system",
        content:
          "You are a strict quality auditor for paid AI agent services. " +
          "Given a service listing and the deliverable actually returned for a paid test order, " +
          "grade whether the deliverable does what the listing promises. " +
          'Reply with ONLY JSON: {"score": <number, one decimal, 0-10>, "matches_promise": true|false, "issues": ["..."], "summary": "one sentence"}. ' +
          "Anchored scale — most competent services land at 6-8: " +
          "10 = you cannot imagine a materially better deliverable for this request (reserve it; almost never award); " +
          "9 = exceptional depth AND precision, exceeds what the listing promises; " +
          "7-8 = solid professional work, promise fully met with minor gaps; " +
          "5-6 = acceptable, promise mostly met but noticeably thin, generic, or partially unverified; " +
          "3-4 = weak, core promise only partially met; 0-2 = broken/irrelevant/empty. " +
          "Mandatory deductions (apply each that fits, list in issues): key claims left unverified or 'unavailable' (-1 to -2); " +
          "generic/templated content not tailored to the specific request (-1); " +
          "promised output fields, verdicts or formats missing (-1 to -3); " +
          "stale or unsourced data presented as fresh (-1); no sources/evidence where the listing implies them (-1). " +
          "Use one decimal place (e.g. 6.5, 7.5) — never default to a round 8 or 10.",
      },
      {
        role: "user",
        content:
          `SERVICE LISTING\nAgent: ${agent.name}\nService: ${service.name}\n` +
          `Promise: ${service.description.slice(0, 1000)}\n` +
          `Deliverable type promised: ${service.deliverableType}\n\n` +
          `TEST REQUEST SENT\n${run.requestSent.slice(0, 800)}\n\n` +
          `DELIVERABLE RECEIVED (${text.length} chars)\n${text.slice(0, 3500)}`,
      },
    ],
    600,
  );

  const parsed = extractJSON<{
    score?: number;
    matches_promise?: boolean;
    issues?: string[];
    summary?: string;
  }>(llm);

  if (parsed && typeof parsed.score === "number") {
    return {
      assessed: true,
      score: Math.max(0, Math.min(10, Math.round(parsed.score * 10) / 10)),
      matchesPromise: parsed.matches_promise ?? null,
      issues: [...issues, ...(parsed.issues ?? [])].slice(0, 8),
      summary: parsed.summary ?? "",
    };
  }

  return {
    assessed: false,
    score: null,
    matchesPromise: issues.length === 0 ? null : false,
    issues,
    summary: issues.length
      ? `Deterministic checks found: ${issues.join("; ")}`
      : "LLM not configured — only deterministic checks ran (deliverable non-empty and well-formed).",
  };
}
