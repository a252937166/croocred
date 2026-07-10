# Manual test matrix — proven by real orders, not mocks

There is no automated test suite in this repo (hackathon scope; `typecheck`
only). What we have instead is stronger in one specific sense: every row below
was exercised by a **real CAP order on Base mainnet**, and the evidence is a
persisted record with tx hashes — not a mock assertion. Rows link to the
public feed (`/api/certs-full.json`) by certId.

| # | Scenario (what could go wrong) | Exercised by (real event) | Observed behavior | Evidence |
| - | --- | --- | --- | --- |
| 1 | Happy path: negotiate→pay→deliver→settle | 34 paid probes across 15 agents | Full lifecycle, receipts persisted | any `cc-*` record |
| 2 | Target provider offline | Manga Localizer probes | `PROVIDER_NOT_ACCEPTING_ORDERS` → F, no spend, published as failure | `cc-0dfd114d-*` |
| 3 | Empty deliverable | Early Axion-line probes | Hard gate: can never read "certified"; grade capped | `cc-a98885cb-*` |
| 4 | Deliverable in `deliverableSchema` not `deliverableText` | 4 real deliveries misread by us | Caught, `rejudge` CLI re-fetched + re-judged, grades corrected publicly | rejudgedAt fields |
| 5 | Provider rejects our probe input (input-shape mismatch) | SettleProof/TraderScan Re-Checks by external buyer | Initially mis-graded F → fixed: `capOutcome: "not_placed"`, excluded from board grade; disclosed publicly | `cc-29e8cca4-20260709073839` |
| 6 | Order stalls in `creating` (platform paymaster) | TraderScan buyer Re-Check | Flagged `order_creation_stalled`, no phantom spend | `cc-0df4b4bf-20260709051317` |
| 7 | Buyer sends target-less order | External buyer's first order | Defaults to certifying the buyer's own agent (no bounce) | provider log 2026-07-07 |
| 8 | Buyer requirements in wrong JSON shape | Multiple targets (Go backends rejecting JSON-strings) | Compatibility retry ladder (text → {"text":…} → {}) | shopper.ts, real retries in logs |
| 9 | Pipeline failure after payment | Forced during smoke tests | `rejectOrder` → escrow auto-refund, never keep money for undelivered work | provider.ts flow |
| 10 | Daemon restart mid-stream | Two production restarts (7/9, 7/10 deploys) | Idempotent: persisted processedOrders + accepted negotiations; WS+polling dedupe by order id; no double-pay (wallet ledger reconciles) | funding.log, journald |
| 11 | Zero-balance wallet (ERC-20 paymaster) | $0 cold-start phase | Detected, probes blocked, root cause filed with CROO team | Q&A thread, config |
| 12 | Concurrent order arrivals | Warranty + madeel91 orders same day | Global payment mutex serializes spends | provider.ts, records |
| 13 | LLM judge drift / over-generosity | v2.1 anchored-scale recalibration | `recalibrate`/`rescore` replayed all records; grades carry rubricVersion | records' rubricVersion=2 |
| 14 | Liveness probe must never certify | All liveness-tier records | Capped at C / created_only by code, not judgment | score.ts gate |

Standing invariants enforced in code (`score.ts` hard gates), independent of
any LLM output: empty delivery ⇒ never certified; conformance 0 ⇒ ≤54 + AVOID;
no paid delivery ⇒ CAP failed (or `not_placed` if our probe was rejected
pre-payment); liveness ⇒ ≤C; score ceiling 98.
