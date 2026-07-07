# CrooCred — Demo Video Script (≤5:00 · 1920×1080 · English VO)

> Production: hackathon-video pipeline (playwright screen capture + edge-tts VO + ffmpeg).
> Voice: neutral EN. Copy is vendor-neutral (no model/provider names).
> All footage = live site / live store / real Basescan pages. No mockups except the
> clearly-watermarked sample report (never presented as live).
> Structure: evidence first, code last. Numbers below reflect the board at
> recording time — re-check stats.json before capture.

---

## Scene 0 · Cold open — the problem (0:00–0:30)

**Visual**: CROO Agent Store home, slow scroll over hundreds of agents.
Cut to a listing with big claims. Cut to a Basescan tx list.

**VO**:
"Hundreds of agents. A hundred thousand orders. Every listing says: trust me.
But a listing is just marketing — escrow guarantees *a* delivery, not a *good*
one. When your agent pays another agent and gets garbage back, the money is
already gone. So we stopped trusting listings."

**On-screen text**: `Don't trust the listing.`

## Scene 1 · The thesis — a real receipt (0:30–1:00)

**Visual**: croocred.axiqo.xyz hero — the latest live receipt (RateCard /
price_my_agent): TARGET / PROBE PAID / PAY TX / DELIVER TX / SLA MET /
**CAP: DELIVERED / QUALITY: PASS**. Zoom the two-axis lines.

**VO**:
"CrooCred is a mystery shopper for the agent economy. It buys agents with real
escrowed orders on Base and grades two things separately: did the CAP
lifecycle complete — and was the delivery actually any good. Every claim on
this receipt links to a transaction hash. Trust the receipts."

**On-screen text**: `TRUST THE RECEIPTS.`

## Scene 2 · Live certification, end to end (1:00–2:10) — CORE

**Visual**: terminal, real run: `certify <serviceId> 2` (RateCard capture or
fresh run): negotiation sent → accepted ~5s → order created (tx) → paid (tx)
→ delivered in ~2min → judged → graded. Click through to the report: audit
block (CAP lifecycle / Delivery quality / Final verdict), probe rows, tx links
(click one → Basescan, show the actual transfer), score breakdown, flags.

**VO**:
"One command. CrooCred negotiates over CAP, escrow locks real USDC, the target
delivers, settlement clears — every step leaves a transaction hash. Then the
deliverable itself is judged against what the listing promised, on an anchored
scale where a perfect score doesn't exist: single probes are capped, identical
outputs are capped, and the scale tops out at ninety-eight. An auditor that
hands out hundreds isn't auditing."

**Beat (1:50)**: open the zkzora Receipt Agent report — audit block showing
CAP: DELIVERED / QUALITY: FAIL 4.5/10 / CONDITIONAL · CAUTION.
"CAP proves the delivery happened. It can't prove the delivery was any good —
this agent passed the lifecycle and failed the promise. It can pass CAP all
day; it still won't get certified."

## Scene 3 · The board — an auditor with teeth (2:10–2:50)

**Visual**: homepage metrics (all real numbers), Tested-agents board:
mixed statuses — certified / CERTIFIED · WITH WARNINGS / CONDITIONAL /
NOT CERTIFIED. Hover a "HIRE WITH REVIEW" row and its flag count. Filters
click (Paid only / Flagged). Open a badge SVG; paste embed snippet into a
README preview.

**VO**:
"The board isn't a wall of A-plusses. Certified means both axes passed;
warnings stay visible; weak quality reads conditional; an offline provider
reads avoid. Certified agents get a live badge that updates on every re-check
— judge-verifiable proof their agent actually works, embeddable anywhere."

## Scene 4 · Verdicts — trust after the sale (2:50–3:30)

**Visual**: verdicts.html — the real claim-verdict CAP order (chain order
#118429): deny_claim, quality 85, refund recommendation, evidence hash,
pay/deliver tx links, the DISCLOSED OPERATOR DEMO tag, expandable claim input.

**VO**:
"Certification is trust before the hire. Delivery Verdict is trust after a bad
one: an insurer sends the buyer's request and the seller's output over CAP,
and gets an independent adjudication with an evidence hash — approve, deny, or
manual review. Same delivery, two different questions: our certification judge
scored it four and a half out of ten against the listing's promises, and the
claims adjudicator still denied the refund — because 'below the promise' and
'worth a refund' are different bars. The adjudicator never insures; the
insurer never adjudicates."

## Scene 5 · Evidence & the self-audit (3:30–4:20)

**Visual**: evidence.html — inbound buyers table (external vs the
operator-owned demo buyer highlighted), outbound targets, parent-order tx
receipts, the seed-certification disclosure line. Then the README "edge case
#6" paragraph + the rubric-v2 Discord correction post (blur other users).

**VO**:
"Anti-sybil questions deserve first-class answers: every inbound buyer is
listed, operator-owned relationships are labeled and never counted as organic,
and seed certifications are disclosed as such. And our favorite receipt: early
probes only read one delivery field and mislabeled four real deliveries as
empty. We caught our own bug, re-fetched every delivery, re-judged, and
corrected the grades in public — the whole trail is in git. An auditor that
can't audit itself can't be trusted."

## Scene 6 · Why CAP + close (4:20–4:55)

**Visual**: A2A flow diagram from README → homepage wide shot → GitHub repo →
Agent Store listing → wordmark card (og-image receipt).

**VO**:
"None of this works on a normal API marketplace — no escrow proving money was
at stake, no delivery hashes, no settlement timestamps, no on-chain identity.
CAP proves that something was delivered. CrooCred proves whether it was worth
hiring. Certify your agent, check the board before you hire, or plug the
verdicts into your own stack. The receipts are waiting."

**On-screen text**: `CAP proves it was delivered. CrooCred proves it was worth hiring.`
`croocred.axiqo.xyz · agent: croocred · MIT`

---

## Shot checklist (re-verify numbers on stats.json before capture)
- [ ] Store home scroll (S0)
- [ ] Homepage hero + RateCard receipt zoom, CAP/QUALITY lines (S1)
- [ ] Terminal cert run — RateCard capture replay or one fresh $0.1 cert (S2)
- [ ] Report audit block + Basescan click-through of a real pay tx (S2)
- [ ] zkzora report audit block (CAP DELIVERED / QUALITY FAIL) for the S2 beat
- [ ] Board with mixed statuses + HIRE WITH REVIEW row + filters + badge embed (S3)
- [ ] verdicts.html full card incl. DISCLOSED OPERATOR DEMO tag (S4)
- [ ] evidence.html buyers table + disclosures (S5)
- [ ] README edge-case #6 + rubric-v2 Discord correction post, blur handles (S5)
- [ ] GitHub + Store listing closers (S6)
