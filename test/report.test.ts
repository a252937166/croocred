import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Point the data dir at a fixture tmpdir BEFORE report.ts (via config.ts)
// reads DATA_DIR, then import dynamically.
const dataDir = mkdtempSync(join(tmpdir(), "croocred-report-test-"));
process.env.DATA_DIR = dataDir;

type AnyRec = Record<string, unknown>;
function rec(over: AnyRec): AnyRec {
  return {
    certId: over.certId,
    createdAt: over.createdAt,
    target: { agentId: "agent-1", agentName: "A", serviceId: "svc-1", serviceName: "S", priceUsdc: 0.1, slaMinutes: 10, onlineStatus: "online", completedOrders: "1", completionRate: 100, avatar: "" },
    score: { grade: "B", score: 80, verdict: "certified", recommendation: "HIRE", components: {}, flags: [], rubricVersion: 2 },
    runs: [{ runIndex: 1, mode: "paid", serviceId: "svc-1", ok: true, txHashes: { pay: "0x1" }, requestSent: "default probe" }],
    verdicts: [{ assessed: true, score: 7, matchesPromise: true, issues: [], summary: "" }],
    spentUsdc: 0.1,
    reportUrl: "",
    badgeUrl: "",
    ...over,
  };
}

let report: typeof import("../src/report.js");
before(async () => {
  mkdirSync(join(dataDir, "certs"), { recursive: true });
  const put = (r: AnyRec) => writeFileSync(join(dataDir, "certs", `${r.certId}.json`), JSON.stringify(r));

  // agent-1 / svc-1 history, oldest → newest:
  put(rec({ certId: "cc-old-buyer", createdAt: "2026-07-10T00:00:00Z", probeProvenance: "buyer", runs: [{ runIndex: 1, mode: "paid", serviceId: "svc-1", ok: true, txHashes: { pay: "0x1" }, requestSent: "good buyer probe" }] }));
  put(rec({ certId: "cc-mid-fallback", createdAt: "2026-07-12T00:00:00Z", probeProvenance: "fallback", verdicts: [{ assessed: true, score: 1, matchesPromise: false, issues: [], summary: "" }], runs: [{ runIndex: 1, mode: "paid", serviceId: "svc-1", ok: true, txHashes: { pay: "0x2" }, requestSent: "generic fallback probe" }] }));
  put(rec({
    certId: "cc-new-invalid", createdAt: "2026-07-14T00:00:00Z",
    score: { grade: "D", score: 54, verdict: "not_certified", recommendation: "AVOID", components: {}, flags: [], rubricVersion: 2 },
    invalidated: { at: "2026-07-15T00:00:00Z", reason: "probe violated the listing's input contract" },
    runs: [{ runIndex: 1, mode: "paid", serviceId: "svc-1", ok: true, txHashes: { pay: "0x3" }, requestSent: "generic fallback probe" }],
  }));

  // agent-2: only record is invalidated → agent must vanish from the board.
  put(rec({
    certId: "cc-a2-invalid", createdAt: "2026-07-13T00:00:00Z",
    target: { agentId: "agent-2", agentName: "B", serviceId: "svc-2", serviceName: "S2", priceUsdc: 0.1, slaMinutes: 10, onlineStatus: "online", completedOrders: "1", completionRate: 100, avatar: "" },
    invalidated: { at: "2026-07-15T00:00:00Z", reason: "x" },
  }));

  // agent-3: pre-v2 record (no provenance) whose delivery engaged (quality 6).
  put(rec({
    certId: "cc-a3-legacy", createdAt: "2026-07-13T12:00:00Z",
    target: { agentId: "agent-3", agentName: "C", serviceId: "svc-3", serviceName: "S3", priceUsdc: 0.1, slaMinutes: 10, onlineStatus: "online", completedOrders: "1", completionRate: 100, avatar: "" },
    verdicts: [{ assessed: true, score: 6, matchesPromise: true, issues: [], summary: "" }],
    runs: [{ runIndex: 1, mode: "paid", serviceId: "svc-3", ok: true, txHashes: { pay: "0x4" }, requestSent: "legacy engaged probe" }],
  }));

  report = await import("../src/report.js");
});

test("latestPerAgent skips invalidated records", () => {
  const latest = report.latestPerAgent();
  assert.equal(latest.get("agent-1")?.certId, "cc-mid-fallback"); // newest non-invalidated
  assert.equal(latest.has("agent-2"), false); // only record invalidated → no badge
});

test("lastKnownGoodProbe skips invalidated and fallback probes, finds buyer probe", () => {
  const probe = report.lastKnownGoodProbe("svc-1");
  assert.equal(probe?.fromCertId, "cc-old-buyer");
  assert.equal(probe?.input, "good buyer probe");
});

test("lastKnownGoodProbe trusts a pre-v2 record when the delivery engaged", () => {
  const probe = report.lastKnownGoodProbe("svc-3");
  assert.equal(probe?.fromCertId, "cc-a3-legacy");
});

test("lastKnownGoodProbe returns null for unknown services", () => {
  assert.equal(report.lastKnownGoodProbe("svc-none"), null);
});
