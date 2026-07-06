# CrooCred — Demo Video Script (≤5:00 · 1920×1080 · English VO)

> Production: hackathon-video pipeline (playwright screen capture + edge-tts VO + ffmpeg).
> Voice: neutral EN. Copy is vendor-neutral (no model/provider names).
> All footage = live site / live store / real Basescan pages. No mockups except the
> clearly-watermarked sample report (never presented as live).

---

## Scene 0 · Cold open — the problem (0:00–0:35)

**Visual**: CROO Agent Store home, slow scroll over 742 agents / 100k orders.
Cut to a listing with big claims. Cut to Basescan tx list.

**VO**:
"Seven hundred agents. A hundred thousand orders. Every listing says: trust me.
But on an agent marketplace, a listing is just marketing — escrow guarantees *a*
delivery, not a *good* one. When your agent pays another agent and gets garbage
back, the money is already gone. So we stopped trusting listings."

**On-screen text**: `Don't trust the listing.`

## Scene 1 · The thesis (0:35–1:00)

**Visual**: croocred.axiqo.xyz hero — receipt renders on the right; camera zooms
the paper receipt: TARGET / PROBE: PAID / PAY TX / RESULT.

**VO**:
"CrooCred is a mystery shopper for the agent economy. It buys agents with real
escrowed orders on Base, measures what actually comes back, and publishes the
receipts. Trust the receipts."

**On-screen text**: `TRUST THE RECEIPTS.`

## Scene 2 · Live certification, end to end (1:00–2:20) — CORE

**Visual**: terminal, real run: `certify <axion-serviceId> 2`. Show log lines as
they happen (may be pre-recorded from the seed batch): negotiation sent →
accepted in ~5s → order created (tx) → paid (tx) → delivered in 86s → judged →
graded. Then click through: the report page — probe rows, tx links (click one →
Basescan, show the actual transfer), score breakdown, flags.

**VO**:
"One command. CrooCred negotiates with the target agent over CAP, the order is
created on-chain, escrow locks real USDC, the target delivers, and settlement
clears — every step leaves a transaction hash. Then the deliverable itself is
judged against what the listing promised. The result is a graded report where
every claim links to Basescan. This is probe evidence no one can fake —
including us."

**Beat (2:00)**: open the zkzora Receipt Agent report — audit block showing
CAP: DELIVERED / QUALITY: FAIL 4.0/10 / CONDITIONAL · CAUTION.
"CAP proves the delivery happened. It can't prove the delivery was any good —
so we grade the two separately. This agent passed the lifecycle and failed
the promise; it can pass CAP all day and it still won't get certified."

## Scene 3 · The leaderboard & badges (2:20–3:00)

**Visual**: homepage metrics (all real numbers), leaderboard with 7+ certified
agents, filters click (Paid only / Flagged). Open a badge SVG; paste embed
snippet into a README preview.

**VO**:
"Every certification lands on a public leaderboard, with paid-probe counts, SLA
measurements and risk flags. Certified agents get a live badge — embed it in a
README or a BUIDL page, and it always shows the latest grade. Buyers check the
board before hiring; builders use the badge as judge-verifiable proof their
agent actually works."

## Scene 4 · The evidence layer — verdicts for insurers (3:00–3:45)

**Visual**: the REAL claim-verdict CAP order (order cd2a0529…, chain order
#118429): show the order page / tx chain (create 0x65eb…, pay 0x44ac…,
deliver 0xf3c5…, clear 0xf09d…), then the delivered verdict JSON
(deny_claim, quality 85, no_refund, evidence hash 0x82aa…). Cut to the
"For insurers & claim agents" section on the site. Note the nuance worth
saying out loud: the same delivery scored 4.5/10 on the certification rubric
(vs the listing promise) but deny_claim on the refund rubric — different
questions, different bars, both independent.

**VO**:
"CrooCred is not an insurer — it's the independent evidence layer. Insurance
agents underwriting bad-delivery risk hire CrooCred as their third-party
adjudicator: send the buyer's request and the seller's delivery, get back a
claim-ready verdict with an evidence hash. The adjudicator never insures; the
insurer never adjudicates. Trust becomes a composable CAP dependency."

## Scene 5 · Why CAP + the bootstrap story (3:45–4:30)

**Visual**: A2A flow diagram from README; then Discord screenshots (blur other
users' avatars/names except consented): the $0.12 sponsorship, the accounting
message. Then the Inspector: paste an agentId, live metadata appears.

**VO**:
"None of this works on a normal API marketplace — no escrow to prove money was
at stake, no delivery hashes, no settlement timestamps, no on-chain identity.
And here's our favorite receipt: this project started with zero dollars in a
region with no on-ramp. A fellow builder sponsored twelve cents; every probe
since has been funded by the network itself, and every cent is accounted for on
the site. An auditor that fakes nothing — because it can't."

## Scene 6 · Close (4:30–4:55)

**Visual**: homepage wide shot → GitHub repo → Agent Store listing → wordmark
card (og-image receipt).

**VO**:
"CrooCred. Live purchase certification for the agent economy. Certify your
agent, check the board before you hire, or plug the verdicts into your own
stack. The receipts are waiting."

**On-screen text**: `croocred.axiqo.xyz · agent: croocred · MIT`

---

## Shot checklist (capture after seed batch completes)
- [ ] Store home scroll (Scene 0)
- [ ] Homepage hero + receipt zoom (S1)
- [ ] Terminal cert run — reuse seed.log replay or run one fresh $0.10 cert live (S2)
- [ ] Report page + Basescan click-through of a real pay tx (S2)
- [ ] zkzora report audit block (CAP DELIVERED / QUALITY FAIL) for the S2 beat
- [ ] Leaderboard + filters + badge embed (S3)
- [ ] verdict CLI live run (S4)
- [ ] Discord sponsorship screenshots — get Red.G's OK or blur handle (S5)
- [ ] Inspector live lookup (S5)
- [ ] GitHub + Store listing closers (S6)
