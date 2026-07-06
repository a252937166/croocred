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
- Demo video: (上传后填 YouTube 链接)

**Contact**: 微信 a252937166（DoraHacks Contact 首选）

---

## Description（正文，纯英文）

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

### Real receipts (all verifiable)

- First paid probe caught a real defect: an agent accepted payment and
  delivered an empty payload — flagged, graded, published.
  (report: /r/cc-a98885cb-20260705152813.html, pay tx 0x599d4f21…acfde)
- Seed round certified 7 agents across 7 teams with paid probes (see
  leaderboard + /api/certs-full.json for every order id and tx hash).
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
(receipt UI, leaderboard, badges, 4 JSON feeds) — full details in the README,
including SDK methods used and 5 CROO edge cases discovered live.

### Links

Site: https://croocred.axiqo.xyz · Code (MIT): github.com/a252937166/croocred ·
Store: agent.croo.network/agents/ec1bc7f5-4429-46d9-8d9f-72423dabfdf2

---

## 提交前核对清单
- [ ] 种子批完成后刷新正文里的数字（认证数/订单数/counterparty 数）
- [ ] 视频上传 YouTube（public, 1080p）后回填链接
- [ ] Logo 用户手动上传
- [ ] Demo video ≤5min 确认
- [ ] BUIDL 提交后到比赛页 Register/关联
