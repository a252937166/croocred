import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Isolate persistence + force the deterministic (no-LLM) paths BEFORE import.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "croocred-test-"));
process.env.LLM_API_KEY = "";

const { parseClaim, judgeClaim } = await import("../src/verdict.js");

const SURETY_SCHEMA = JSON.stringify({
  deliverable: "Hello! Here is your horoscope for today. Mercury is in retrograde.",
  instruction: "You are adjudicating an insurance claim. Decide ONLY whether seller_delivery fulfils buyer_requirement.",
  requirements: "Write a 5-bullet market brief about the USDC stablecoin ecosystem on Base.",
  seller_delivery: "Hello! Here is your horoscope for today. Mercury is in retrograde.",
  buyer_requirement: "Write a 5-bullet market brief about the USDC stablecoin ecosystem on Base.",
});

test("parseClaim reads buyer_request (v1 schema)", () => {
  const c = parseClaim(JSON.stringify({ buyer_request: "write a poem", seller_output: "a poem" }));
  assert.equal(c.buyerRequest, "write a poem");
  assert.equal(c.sellerOutput, "a poem");
  assert.equal(c.structured, true);
});

test("parseClaim reads buyer_requirement (real external integration schema — the parser v1 bug)", () => {
  const c = parseClaim(SURETY_SCHEMA);
  assert.match(c.buyerRequest, /USDC stablecoin ecosystem/);
  assert.match(c.sellerOutput, /horoscope/);
  // the adjudicator meta-instruction must NOT be mistaken for the request
  assert.doesNotMatch(c.buyerRequest, /adjudicating an insurance claim/);
});

test("parseClaim falls back to requirements when no explicit buyer field", () => {
  const c = parseClaim(JSON.stringify({ requirements: "translate to French", deliverable: "Bonjour" }));
  assert.equal(c.buyerRequest, "translate to French");
});

test("parseClaim prefers task over requirements", () => {
  const c = parseClaim(JSON.stringify({ task: "the real task", requirements: "meta text", deliverable: "x" }));
  assert.equal(c.buyerRequest, "the real task");
});

test("parseClaim reads seller_delivery when deliverable absent", () => {
  const c = parseClaim(JSON.stringify({ buyer_request: "r", seller_delivery: "the delivery" }));
  assert.equal(c.sellerOutput, "the delivery");
});

test("parseClaim treats freeform text as unstructured raw", () => {
  const c = parseClaim("my seller sent me garbage, here is the whole story …");
  assert.equal(c.structured, false);
  assert.match(c.raw, /whole story/);
});

test("parseClaim never throws on malformed JSON", () => {
  const c = parseClaim('{"buyer_request": "unterminated');
  assert.equal(c.structured, false);
});

test("judgeClaim gates structured claim missing seller output to manual_review (no LLM guess)", async () => {
  const v = await judgeClaim(JSON.stringify({ buyer_request: "write a brief" }));
  assert.equal(v.verdict, "manual_review");
  assert.equal(v.refund_recommendation, "no_refund");
  assert.match(v.reasons[0], /Insufficient structured evidence/);
});

test("judgeClaim gates structured claim missing buyer request to manual_review", async () => {
  const v = await judgeClaim(JSON.stringify({ some_unknown_field: "?", deliverable: "output only" }));
  assert.equal(v.verdict, "manual_review");
  assert.match(v.reasons[0], /Insufficient structured evidence/);
});

test("judgeClaim with LLM unavailable returns manual_review, never a guessed refund", async () => {
  const v = await judgeClaim(SURETY_SCHEMA);
  assert.equal(v.verdict, "manual_review");
  assert.equal(v.refund_recommendation, "no_refund");
});

test("judgeClaim result carries reproducibility metadata (parser v2)", async () => {
  const v = await judgeClaim(SURETY_SCHEMA);
  assert.equal(v.judge?.parser, "v2");
  assert.match(v.judge?.prompt_sha256 ?? "", /^0x[0-9a-f]{64}$/);
});
