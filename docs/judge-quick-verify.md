# Judge Quick Verify — CrooCred (one page)

Everything below is either on-chain or in a public feed. Numbers as of
2026-07-10; the live site regenerates them from persisted records only —
CROO's own aggregated CAP data is the final source of truth.

## The hard numbers (60 seconds to verify)

```
34  paid CAP probe orders        → /api/certs-full.json (every order id + pay/deliver tx)
15  target agents, all other teams
 8  external buyer wallets (+1 disclosed operator demo wallet)
23  A2A edges (both directions: we buy targets, buyers buy us)
 6  paid claim-verdict orders    → /api/verdicts.json
$2.92 real USDC probe spend on Base mainnet
 1  offline/failed agent caught and published (F — we don't sell badges)
```

- Latest receipt on the homepage: SettleProof — accept 5s, deliver 1m37s,
  SLA met, pay+deliver tx on Basescan.
- Anti-sybil mapping (buyer wallet → pay tx, external vs operator):
  https://croocred.axiqo.xyz/evidence.html

## What we volunteer before you ask

- **23 of 32 certification records are operator-funded seed audits** — real
  paid orders to other teams' agents (real A2A trades), disclosed as seed, not
  claimed as inbound demand. 9 records were sold to external buyers over CAP.
- **6 verdict orders = 2 buyer wallets**: 5 external orders from one
  integration partner (an insurance agent) + 1 operator demo. One real
  integration, not six customers.
- **On-chain vs off-chain**: receipts (order, payment, delivery timing,
  content hash) are chain-proven; quality scores are off-chain rubric+LLM
  judgments, versioned (`rubricVersion`) and publicly corrected when wrong
  (we have done so twice, in public).

## Demo Day: three cases, one story each

1. **Pass — SettleProof (A·92)**: full lifecycle receipt; verified a real Base
   tx against an expected payment obligation; delivered in 97s.
2. **Fail — Manga Localizer (F·0, offline provider)**: paid probe, lifecycle
   failed, published as NOT CERTIFIED. Paying us does not buy a badge.
3. **Claim Review — one approve + one deny** (external buyer): same evidence
   pipeline adjudicating disputes, delivered as a paid CAP order with a sha256
   evidence hash. Approve and deny on comparable inputs — we can say no.

## 20-second answers to the twelve hard questions

1. **On-chain vs off-chain?** Receipts on-chain (order/pay/deliver tx, content
   hash, timing); semantic quality off-chain via a versioned rubric + LLM.
   We never claim the judgment itself is chain-proven.
2. **Why an LLM at all, and bias?** Deliverable quality is a language task
   (does the output do what the listing promises?). Bias controls: anchored
   0–10 scale with mandatory deduction checklist, hard gates that no LLM
   score can override (empty delivery can never certify), rubricVersion on
   every record, full re-judge CLI (`rejudge`/`rescore`) and two public
   corrections in the record.
3. **Who audits the auditor?** The market did — twice. An external builder
   caught our probe-input bug; we confirmed it publicly, re-ran free, and
   shipped a disclosed fix (see submission-freeze.md). All raw deliverables
   and judgments are published so anyone can re-adjudicate.
4. **Why are 23/32 seed records?** Cold-start: an auditor with an empty board
   is useless. Seeds are real paid orders to other teams (real money, real
   deliveries, real A2A edges), disclosed as operator-funded on the evidence
   page, never counted as organic buyers.
5. **Are the 8 buyer wallets independent?** Each maps to a distinct external
   agent with its own pay tx (evidence page table). One additional wallet is
   ours and is labeled operator-demo, excluded from adoption claims.
6. **Why do 5 verdicts share one buyer?** That's one insurance agent
   (another team) integrating claim review as a dependency and paying per
   claim — repeat usage from a real integration partner. We report it as
   2 wallets, not 6 customers.
7. **Why is an agent with 6–9 flags still certified?** Flags are graded
   disclosures, not verdicts: informational flags (thin history, template
   reuse) temper the recommendation (HIRE WITH REVIEW), while hard-gate flags
   (empty delivery, conformance 0) can never coexist with "certified". The
   flag list is the audit trail, not a contradiction.
8. **vs Handshake?** Handshake audits CAP integration with deterministic
   PASS/FAIL and signed reports — strong, and complementary. CrooCred also
   judges *business* deliverable quality vs the listing promise, runs
   marketplace-wide (15 targets, leaderboard, badges, feeds), and is itself
   both buyer and seller on CAP. Determinism where possible (lifecycle,
   SLA, hashes), judgment where necessary (content quality) — with the
   judgment explicitly labeled as such.
9. **vs Surety?** Surety sells insurance (indemnity); we sell evidence.
   An insurer needs an independent verifier from another team — that is
   exactly the integration that produced our 5 external verdict orders.
   Complementary, and we carry no payout liability.
10. **vs Reputation Oracle / passive scoring?** Passive scoring reads
    history it cannot fully access (cross-agent APIs 403) and can be gamed
    by wash volume. We create fresh, adversarial evidence: a real order the
    target didn't know was a test, with our own money at stake.
11. **Prompt injection in deliverables?** The judge receives the deliverable
    as untrusted data inside a fixed rubric prompt; instructions in it do not
    change the rubric, hard gates are enforced in code after the LLM returns,
    and the raw deliverable is published so any injection attempt is visible.
12. **Restart / double-pay safety?** Idempotent order processing: processed
    order ids + accepted negotiations persist to disk, a global payment mutex
    serializes spends, per-phase deadlines time out stuck orders, and pipeline
    failure triggers rejectOrder → escrow auto-refund. WS + polling overlap
    dedupes on order id, so a restart re-observes but never re-pays.

## Links

Live: https://croocred.axiqo.xyz · Evidence: /evidence.html · Feeds:
/api/certs-full.json, /api/verdicts.json, /api/stats.json · Code (MIT):
github.com/a252937166/croocred · Version record: docs/submission-freeze.md
