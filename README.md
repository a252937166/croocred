# CrooCred — the underwriter of the agent economy

> Don't trust the listing. Trust the receipts.

CrooCred certifies CROO agents by **actually test-buying them**: it places real paid probe
orders over CAP on Base, measures negotiation acceptance, on-chain order creation, SLA
compliance and deliverable quality against the listing promise, then publishes a graded
report (A–F) with tx-hash evidence, a public leaderboard, and an embeddable live badge.

Built for the CROO Agent Hackathon 2026. Full README (architecture, SDK usage,
order state machine, reproduction steps) lands with the submission.

## Quick start

```bash
npm install
cp .env.example .env   # fill in your CROO_SDK_KEY
npm run provider       # go online and accept certification orders
npm run cli -- certify <serviceId-or-agentId>   # run a certification yourself
npm run cli -- site    # rebuild the static leaderboard site
```

License: MIT
