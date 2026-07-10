# Manual test matrix — evidence classes labeled honestly

Most lifecycle scenarios below were exercised by **real Base mainnet CAP
orders** with persisted tx-hash evidence. Operational invariants that cannot
be fully demonstrated through public feeds are supported by code paths and
production logs — and are labeled as such, not claimed as on-chain proof.

There is now also a small automated suite (`npm test`, node:test — 21
invariant tests over the claim parser, the deterministic manual-review gate,
and every scoring hard gate), added post-deadline as a disclosed
safety/fairness measure — not claimed as a submission feature.

Evidence classes: **ON-CHAIN** (public order + tx) · **PUBLIC RECORD**
(persisted record in /api feeds) · **OPS LOG** (private journald/daemon logs)
· **CODE INVARIANT** (enforced in code, now covered by `npm test`).

| # | Scenario (what could go wrong) | Exercised by (real event) | Observed behavior | Evidence · class |
| - | --- | --- | --- | --- |
| 1 | Happy path: negotiate→pay→deliver→settle | 34 paid probes across 15 agents | Full lifecycle, receipts persisted | any `cc-*` record  · **ON-CHAIN** |
| 2 | Target provider offline | Manga Localizer probes | `PROVIDER_NOT_ACCEPTING_ORDERS` → F, no spend, published as failure | `cc-0dfd114d-*`  · **ON-CHAIN** |
| 3 | Empty deliverable | Early Axion-line probes | Hard gate: can never read "certified"; grade capped | `cc-a98885cb-*`  · **PUBLIC RECORD** |
| 4 | Deliverable in `deliverableSchema` not `deliverableText` | 4 real deliveries misread by us | Caught, `rejudge` CLI re-fetched + re-judged, grades corrected publicly | rejudgedAt fields  · **PUBLIC RECORD** |
| 5 | Provider rejects our probe input (input-shape mismatch) | SettleProof/TraderScan Re-Checks by external buyer | Initially mis-graded F → fixed: `capOutcome: "not_placed"`, excluded from board grade; disclosed publicly | `cc-29e8cca4-20260709073839`  · **PUBLIC RECORD** |
| 6 | Order stalls in `creating` (platform paymaster) | TraderScan buyer Re-Check | Flagged `order_creation_stalled`, no phantom spend | `cc-0df4b4bf-20260709051317`  · **PUBLIC RECORD** |
| 7 | Buyer sends target-less order | External buyer's first order | Defaults to certifying the buyer's own agent (no bounce) | provider log 2026-07-07  · **OPS LOG** |
| 8 | Buyer requirements in wrong JSON shape | Multiple targets (Go backends rejecting JSON-strings) | Compatibility retry ladder (text → {"text":…} → {}) | shopper.ts, real retries in logs  · **OPS LOG** |
| 9 | Pipeline failure after payment | Forced during smoke tests | `rejectOrder` → escrow auto-refund, never keep money for undelivered work | provider.ts flow  · **CODE INVARIANT** |
| 10 | Daemon restart mid-stream | Two production restarts (7/9, 7/10 deploys) | Idempotent: persisted processedOrders + accepted negotiations; WS+polling dedupe by order id; no double-pay (wallet ledger reconciles) | funding.log, journald  · **OPS LOG** |
| 11 | Zero-balance wallet (ERC-20 paymaster) | $0 cold-start phase | Detected, probes blocked, root cause filed with CROO team | Q&A thread, config  · **OPS LOG** |
| 12 | Concurrent order arrivals | Warranty + madeel91 orders same day | Global payment mutex serializes spends | provider.ts, records  · **CODE INVARIANT** |
| 13 | LLM judge drift / over-generosity | v2.1 anchored-scale recalibration | `recalibrate`/`rescore` replayed all records; grades carry rubricVersion | records' rubricVersion=2  · **PUBLIC RECORD** |
| 14 | Liveness probe must never certify | All liveness-tier records | Capped at C / created_only by code, not judgment | score.ts gate  · **CODE INVARIANT** |

Standing invariants enforced in code (`score.ts` hard gates), independent of
any LLM output: empty delivery ⇒ never certified; conformance 0 ⇒ ≤54 + AVOID;
no paid delivery ⇒ CAP failed (or `not_placed` if our probe was rejected
pre-payment); liveness ⇒ ≤C; score ceiling 98.
