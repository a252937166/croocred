/**
 * Certification-request parsing — pure, no I/O, unit-testable.
 *
 * What buyers actually send is messy: the Agent Store requirement box wraps
 * whatever they type as {"text":"<typed>"}, buyers paste JSON into that box,
 * and the API itself JSON-encodes the field — so the real request routinely
 * arrives 2–3 layers deep. Learned from a real buyer's reverse order failing
 * twice on 2026-07-13/14: he sent {"target":"VeriClaim"} exactly as told, the
 * store wrapped it, and parser v1 saw "no parsable target".
 */

export const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export interface CertificationRequest {
  /** A UUID, or (when targetIsName is set) a Store agent name to resolve. */
  target: string;
  /**
   * "key"  — the name came from an explicit target field: strong intent,
   *          reject the order if it cannot be resolved.
   * "bare" — the requirement was just a short token: weak intent, fall back
   *          to the buyer's own agent if it cannot be resolved.
   */
  targetIsName?: "key" | "bare";
  runs?: number;
  mode?: "liveness"; // buyers may downgrade to liveness; paid is balance-gated
  note?: string;
}

const TARGET_KEYS = ["target", "target_id", "targetId", "service_id", "serviceId", "agent_id", "agentId", "url"];
const WRAPPER_KEYS = ["text", "requirement", "requirements", "input", "request", "payload"];

/** A plausible Store agent name: short, single line, no JSON/URL syntax. */
function looksLikeName(s: string): boolean {
  const t = s.trim();
  return t.length >= 2 && t.length <= 64 && !/[{}[\]"\n:]/.test(t) && !/^https?\/\//i.test(t);
}

/**
 * Parse whatever the buyer sent: {"target":"<uuid or name>","runs":2}, a raw
 * UUID, an Agent Store URL, free text containing any of those, or all of the
 * above wrapped in {"text": …} / double-JSON-encoded. Returns null only when
 * there is no target signal at all (callers then default to the buyer's own
 * agent — a paying customer is never bounced on a format technicality).
 */
export function parseCertificationRequest(requirements: string): CertificationRequest | null {
  let text = (requirements ?? "").trim();
  if (!text) return null;

  let target: string | null = null;
  let targetIsName: CertificationRequest["targetIsName"];
  let runs: number | undefined;
  let mode: CertificationRequest["mode"];
  let note: string | undefined;

  // Peel nested JSON layers; a UUID target ends the search, a name target is
  // kept but can still be upgraded to a UUID found deeper in.
  for (let depth = 0; depth < 4; depth++) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      break;
    }
    if (typeof parsed === "string") {
      text = parsed.trim();
      continue;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) break;
    const obj = parsed as Record<string, unknown>;

    for (const k of TARGET_KEYS) {
      const v = obj[k];
      if (typeof v !== "string" || !v.trim()) continue;
      const m = v.match(UUID_RE);
      if (m) {
        target = m[0];
        targetIsName = undefined;
        break;
      }
      if (!target && looksLikeName(v)) {
        target = v.trim();
        targetIsName = "key";
      }
    }
    if (typeof obj.runs === "number" && Number.isFinite(obj.runs)) {
      runs = Math.max(1, Math.min(3, Math.round(obj.runs)));
    }
    if (obj.mode === "liveness") mode = "liveness";
    if (typeof obj.note === "string") note = obj.note.slice(0, 500);
    if (typeof obj.notes === "string") note = obj.notes.slice(0, 500);

    if (target && !targetIsName) break; // definitive UUID — done
    const wrapper = WRAPPER_KEYS.map((k) => obj[k]).find(
      (v): v is string => typeof v === "string" && !!v.trim(),
    );
    if (!wrapper) break;
    text = wrapper.trim();
  }

  if (!target) {
    const m = text.match(UUID_RE);
    if (m) target = m[0];
  }
  // A short bare token ("VeriClaim") is worth one resolution attempt; callers
  // fall back to the old default if it doesn't match a Store agent. Multi-word
  // prose ("please certify my agent") is not a name signal.
  if (!target && looksLikeName(text) && text.split(/\s+/).length <= 3) {
    target = text.trim();
    targetIsName = "bare";
  }
  return target ? { target, targetIsName, runs, mode, note } : null;
}
