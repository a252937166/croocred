# DoraHacks BUIDL 提交草稿（croocred）

> 提交人操作（用户）：dorahacks.io → Submit BUIDL → 按下表填写。
> Logo：必须用户原生上传（用 site-assets/favicon-64.png 的原图或重导 512px 版）。
> 惯例：Team = solo · Category = Crypto/Web3（解锁子标签）· Is AI Agent = Yes。

---

**BUIDL Name**: CrooCred

**Tagline**: Live purchase certification for the agent economy — don't trust the listing, trust the receipts.

**Tracks**（最多 2）: Data & Verification Agents（主）+ Developer Tooling Agents（副）

**Category**: Crypto/Web3 · 子标签: Crypto-AI, Base, Infra/API · Is AI Agent: Yes

**Links**:
- GitHub: https://github.com/a252937166/croocred
- Live: https://croocred.axiqo.xyz
- Agent Store: https://agent.croo.network/agents/ec1bc7f5-4429-46d9-8d9f-72423dabfdf2
- Demo video: https://youtu.be/J0rXME936TA (public, 1080p, 4:13 — v5)

**Contact**: 微信 a252937166（DoraHacks Contact 首选）

---

## Description（正文，纯英文 — 与 DoraHacks 线上一致，2026-07-11 更新）

**DEMO VIDEO (4:13):** https://youtu.be/J0rXME936TA · **Live dashboard:**
https://croocred.axiqo.xyz · **Deadline metrics snapshot** (orders ≤ deadline,
zero post-deadline padding): https://croocred.axiqo.xyz/api/stats-submission.json ·
**Judge Quick Verify:**
https://github.com/a252937166/croocred/blob/master/docs/judge-quick-verify.md ·
Submission snapshot `dab1310` + full post-deadline change log:
https://github.com/a252937166/croocred/blob/master/docs/submission-freeze.md

### The problem

On an agent marketplace, a listing is marketing. CAP's escrow guarantees *a*
delivery — not a *good* one. When your agent pays another agent and gets
garbage back, the money has already settled. 742 agents, 100k+ orders, and no
way to know which listings are real before you spend.

### What CrooCred does

CrooCred is a paid CAP agent that audits other agents **by buying them**:

1. **Certify Agent — Live Test-Buy ($0.5)** — real escrowed probe orders
   against the target, measuring negotiation acceptance, on-chain order
   creation, SLA compliance and deliverable quality vs. the listing promise →
   graded A–F report where every claim links to a Basescan tx + a live SVG
   badge for the agent's README/BUIDL page + a public leaderboard entry.
2. **Re-Check ($0.1)** — single-probe refresh of grade/badge/board.
3. **Delivery Verdict — Claim Review ($0.02)** — the zero-capital service:
   independent adjudication for insured CAP hires. Insurers send
   buyer_request + seller_output, get a claim-ready verdict
   (approve/deny/manual_review, quality score, refund recommendation, sha256
   evidence hash). CrooCred is the evidence layer, not an insurer — built to be
   the "independent verifier from another team" that claim products require.

Probe tiers are honestly labeled: **paid** (full escrow+delivery+settlement
evidence, grades A–F) vs **liveness** (negotiation + on-chain order creation,
cancelled unpaid, capped at C). Samples/specimens are watermarked and never
counted in metrics or feeds.

### Real receipts (all verifiable — deadline-cutoff figures)

- **34 paid probes across 15 target agents from different teams**, $2.92 of
  real USDC spent on Base mainnet — every order id and tx hash in
  /api/certs-full.json and the repo's evidence/ directory. All 34 probes and
  all 6 verdict orders predate the submission deadline:
  /api/stats-submission.json is the immutable cutoff snapshot, and
  post-deadline activity is excluded from every claim here. Board at cutoff: 8
  certified (HIRE), 6 conditional, 1 not certified (offline provider). Surety —
  an "insurer" competitor we test-bought (coopetition over CAP) — and PayGuard,
  graded against the builder's own test case, land at B · CONDITIONAL under the
  hardened rubric rather than a rubber-stamp A.
- **Organic buyers, not just probes**: eight external buyer agents ordered
  over CAP and the daemon served them end-to-end with zero operator input —
  e.g. a builder Re-Checked their own agent ($0.10, accepted in 4.3s, probe
  delivered in 122s, report + badge delivered back on-chain), and an external
  insurance agent (Surety) integrated Claim Review as a paid dependency — 5
  external verdict orders from that one integration partner (6 verdict orders
  total across 2 buyer wallets — reported as one real integration, not six
  customers). A single operator-demo wallet is openly labeled and never counted
  as organic adoption (8 external + 1 disclosed demo = 9 unique buyer wallets;
  see /evidence.html). Each report's "sold via CAP order" row carries the
  buyer's pay tx and our deliver tx. 23 of 32 certification records are
  disclosed operator-funded seed audits — real paid probes, never presented as
  organic demand.
- **Rubric v2 — two axes, hard gates**: every report separates CAP lifecycle
  (escrow/delivery/settlement) from judged content quality. An agent that
  passes CAP but returns an off-promise payload is capped and can never read
  "certified / HIRE" — our first organic customer's agent got exactly that
  treatment (C·69 · CONDITIONAL · CAUTION, with the specific defects listed),
  and the customer got the honest critique as their paid deliverable.
- **The auditor audits itself, in public — twice**: (1) our early probes read
  only CAP's `deliverableText` and mislabeled four real deliveries as empty; we
  caught it, re-judged the recovered payloads and corrected the public board
  (`rubricVersion` + `rejudgedAt` on every record). (2) An external review then
  caught our claim parser missing a real integrator's field names — the four
  affected verdicts were publicly invalidated (kept immutable, struck through,
  original CAP orders unchanged) and re-adjudicated against the actual request;
  the canonical feed (/api/verdicts.json) and the immutable history feed
  (/api/verdicts-history.json) are separated so corrections never inflate order
  counts. Trust infrastructure earns trust by correcting itself with evidence.
- The AI judge reads deliverables for real: it caught a data feed answering in
  the wrong language, and graded a "crypto shill verifier" down for returning
  INSUFFICIENT instead of the promised on-chain verdict. Lifecycle facts are
  chain-proven; semantic quality is an off-chain, versioned, challengeable
  judgment — and every verdict's evidence hash is recomputable
  (`npm run verify-verdict`).
- Bootstrapped from $0 in a region with no fiat on-ramp: a fellow builder's
  $0.12 sponsorship funded the first certification; the full accounting was
  published back to him. We also root-caused the "order stuck in creating"
  issue from the hackathon Q&A (zero-balance wallets vs the ERC-20 paymaster)
  and filed it with the team.

### Why this needs CAP

A normal API marketplace has reviews. CAP has receipts: escrow proves money at
stake, keccak256 delivery hashes pin what was returned, settlement txs
timestamp SLA compliance, and the certification itself is bought and delivered
as a CAP order. The auditor is a paying customer of the market it audits — its
counterparty graph grows with every certification, in both directions.

### Architecture (Node.js + @croo-network/sdk)

provider daemon (WS + polling sweep, idempotent, auto-refund on pipeline
failure) · probe engine (defensive 12-state order machine, per-phase deadlines,
global payment mutex) · LLM judge (probe synthesis + delivery grading +
claim adjudication) · scoring rubric → grade/flags · static evidence dashboard
(receipt UI, leaderboard, badges, JSON feeds incl. canonical + history verdict
feeds) · 21 automated invariant tests (`npm run check`) — full details in the
README, including SDK methods used and 5 CROO edge cases discovered live.

### Links

Site: https://croocred.axiqo.xyz · Code (MIT): github.com/a252937166/croocred ·
Store: agent.croo.network/agents/ec1bc7f5-4429-46d9-8d9f-72423dabfdf2

---

## 提交前核对清单
- [x] 刷新正文数字对齐 live 站（2026-07-08）：12 agents · 29 paid probes · $2.44 USDC · 板 7 certified/4 conditional/1 not certified · 6 external buyers (+1 disclosed demo) · 2 claim verdicts · 18 a2a edges
- [x] 视频上传 YouTube（public, 1080p, 2:56）后回填链接 → https://youtu.be/wcp8gUcTvzo
- [x] DoraHacks Submit BUIDL 已完成（2026-07-08）：CrooCred 提交至 CROO Agent Hackathon，状态 Under Review，Logo=用户手动上传的 receipt 图标；tracks = Data & Verification Agents + Developer Tooling Agents；contact = Telegram @moonri2 + WeChat a252937166。可在 dorahacks.io 该活动页 "Manage Submission" 编辑（judging 前可改）。
- [x] Logo 用户手动上传
- [x] Demo video ≤5min 确认（v5 = 4:13）
- [x] BUIDL 提交后到比赛页 Register/关联
- [x] **2026-07-11 编辑窗口内更新**（DoraHacks 截止 2026-07-12 17:00，页面显示 "1 day left"）：Profile 视频字段 → v5 https://youtu.be/J0rXME936TA（旧 v4 wcp8gUcTvzo 保持 public，submission-freeze.md 双视频披露）；Details 正文整体替换为截止口径数字（34 probes/15 targets/$2.92、板 8-6-1、8 external buyers + 1 demo = 9 wallets、6 verdict orders/2 wallets/1 integration partner、23/32 seed 披露、双重纠错、双 verdict feeds、21 tests），开头加判据链接行（video/dashboard/snapshot/quick-verify/freeze）。已在页面确认 "Saved successfully" 并全文复核无旧数字残留。
