import { test } from "node:test";
import assert from "node:assert/strict";
import { finalizeScore } from "../src/score.js";
import type { TestRun } from "../src/shopper.js";
import type { QualityVerdict } from "../src/judge.js";

// Minimal builders — only the fields finalizeScore actually reads.
const run = (o: Partial<TestRun>): TestRun =>
  ({ mode: "paid", ok: true, txHashes: { pay: "0xpay" }, ...o }) as TestRun;
const verdict = (o: Partial<QualityVerdict>): QualityVerdict =>
  ({ assessed: true, score: 8, issues: [], ...o }) as QualityVerdict;

const GOOD = { availability: 25, reliability: 25, latency: 10, conformance: 15, quality: 25 };

test("empty delivery can never be certified", () => {
  const s = finalizeScore(GOOD, [], [run({})], [verdict({ score: 8, issues: ["empty deliverable"] })]);
  assert.notEqual(s.verdict, "certified");
  assert.equal(s.recommendation, "AVOID");
  assert.ok(s.score <= 54);
});

test("liveness-only runs are capped at C / created_only", () => {
  const s = finalizeScore({ availability: 60, latency: 40 }, [],
    [run({ mode: "liveness", txHashes: {} as TestRun["txHashes"] })], []);
  assert.equal(s.capOutcome, "created_only");
  assert.ok(["C", "D", "F"].includes(s.grade));
  assert.ok(s.score <= 70);
});

test("probe rejected before payment → not_placed, never a damning F on the agent", () => {
  const s = finalizeScore({ availability: 0 }, [],
    [run({ ok: false, txHashes: {} as TestRun["txHashes"], failureStage: "negotiation_rejected" })], []);
  assert.equal(s.capOutcome, "not_placed");
  assert.equal(s.qualityOutcome, "not_assessed");
  assert.equal(s.recommendation, "CAUTION"); // explicitly NOT "AVOID"
});

test("single paid probe caps the score at 92", () => {
  const s = finalizeScore(GOOD, [], [run({})], [verdict({ score: 10 })]);
  assert.ok(s.score <= 92);
});

test("identical output across probes caps the score at 88", () => {
  const s = finalizeScore(GOOD, ["identical deliverable across distinct probes (possible canned output)"],
    [run({}), run({})], [verdict({ score: 10 }), verdict({ score: 10 })]);
  assert.ok(s.score <= 88);
});

test("unassessed quality can never reach HIRE", () => {
  const s = finalizeScore(GOOD, [], [run({}), run({})],
    [verdict({ assessed: false, score: null }), verdict({ assessed: false, score: null })]);
  assert.ok(s.score <= 69);
  assert.notEqual(s.recommendation, "HIRE");
});

test("judged quality 0 can never certify or HIRE", () => {
  const s = finalizeScore(GOOD, [], [run({}), run({})],
    [verdict({ score: 0 }), verdict({ score: 0 })]);
  assert.notEqual(s.verdict, "certified");
  assert.notEqual(s.recommendation, "HIRE");
});

test("conformance 0 on delivered runs gates to ≤54 + AVOID", () => {
  const s = finalizeScore({ ...GOOD, conformance: 0 }, [], [run({}), run({})],
    [verdict({ score: 8 }), verdict({ score: 8 })]);
  assert.ok(s.score <= 54);
  assert.equal(s.recommendation, "AVOID");
});

test("an auditor never hands out a perfect 100", () => {
  const s = finalizeScore({ availability: 40, reliability: 40, latency: 20, conformance: 20, quality: 30 },
    [], [run({}), run({}), run({})], [verdict({ score: 10 }), verdict({ score: 10 }), verdict({ score: 10 })]);
  assert.ok(s.score <= 98);
});

test("a failed run's verdict never poisons delivered-run quality (index pairing)", () => {
  const s = finalizeScore(GOOD, [],
    [run({ ok: false, txHashes: {} as TestRun["txHashes"], failureStage: "delivery_timeout" }), run({})],
    [verdict({ score: 0, issues: ["empty deliverable"] }), verdict({ score: 9 })]);
  // the empty-deliverable verdict belongs to the FAILED run → must not trigger the empty gate
  assert.ok(!s.flags.some((f) => /returned an empty payload/.test(f)));
});
