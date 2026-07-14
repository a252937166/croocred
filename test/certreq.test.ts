import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCertificationRequest } from "../src/certreq.js";

const UUID = "b3c0b29a-d5a1-4066-ae7c-36ea84f6d231";

// The exact payload of the two real failed reverse orders (2026-07-13/14):
// buyer typed {"target":"VeriClaim"} and the Store UI wrapped it as {"text":…}.
test("store-wrapped name target (real failure 0050caf8/0674d997)", () => {
  const req = parseCertificationRequest('{"text": "{\\"target\\":\\"VeriClaim\\"}"}');
  assert.deepEqual(req, { target: "VeriClaim", targetIsName: "key", runs: undefined, mode: undefined, note: undefined });
});

test("store-wrapped UUID target", () => {
  const req = parseCertificationRequest(`{"text": "{\\"target\\":\\"${UUID}\\"}"}`);
  assert.equal(req?.target, UUID);
  assert.equal(req?.targetIsName, undefined);
});

test("plain object with name target", () => {
  const req = parseCertificationRequest('{"target":"ChainGuard"}');
  assert.equal(req?.target, "ChainGuard");
  assert.equal(req?.targetIsName, "key");
});

test("plain object with UUID target and options", () => {
  const req = parseCertificationRequest(`{"target":"${UUID}","runs":2,"mode":"liveness","note":"hi"}`);
  assert.deepEqual(req, { target: UUID, targetIsName: undefined, runs: 2, mode: "liveness", note: "hi" });
});

test("options survive the wrapper layer", () => {
  const req = parseCertificationRequest(`{"text": "{\\"target\\":\\"${UUID}\\",\\"runs\\":3}"}`);
  assert.equal(req?.target, UUID);
  assert.equal(req?.runs, 3);
});

test("raw UUID string", () => {
  assert.equal(parseCertificationRequest(UUID)?.target, UUID);
});

test("agent store URL", () => {
  const req = parseCertificationRequest(`{"url":"https://store.croo.network/agents/${UUID}"}`);
  assert.equal(req?.target, UUID);
  assert.equal(req?.targetIsName, undefined);
});

test("free text containing a UUID", () => {
  assert.equal(parseCertificationRequest(`please certify ${UUID} thanks`)?.target, UUID);
});

test("bare single-token name is a weak (bare) signal", () => {
  const req = parseCertificationRequest('{"text": "VeriClaim"}');
  assert.equal(req?.target, "VeriClaim");
  assert.equal(req?.targetIsName, "bare");
});

test("multi-word prose is not a name — callers default to the buyer's own agent", () => {
  assert.equal(parseCertificationRequest('{"text": "please certify my agent for me"}'), null);
});

test("empty and blank input", () => {
  assert.equal(parseCertificationRequest(""), null);
  assert.equal(parseCertificationRequest('{"text": ""}'), null);
});

test("UUID found deeper in beats a name found earlier", () => {
  const req = parseCertificationRequest(`{"target":"VeriClaim","text":"{\\"agent_id\\":\\"${UUID}\\"}"}`);
  assert.equal(req?.target, UUID);
  assert.equal(req?.targetIsName, undefined);
});

test("double-encoded JSON string layers unwrap", () => {
  const inner = JSON.stringify({ target: UUID });
  const req = parseCertificationRequest(JSON.stringify(inner));
  assert.equal(req?.target, UUID);
});

test("runs clamp to 1..3", () => {
  assert.equal(parseCertificationRequest(`{"target":"${UUID}","runs":9}`)?.runs, 3);
  assert.equal(parseCertificationRequest(`{"target":"${UUID}","runs":0}`)?.runs, 1);
});
