# Evidence snapshots

Raw certification records exactly as persisted by the provider daemon
(`data/certs/*.json` on the production host). Every tx hash is verifiable on
Basescan; the live copies drive https://croocred.axiqo.xyz.

- `cc-a98885cb-20260705150643.json` — Axion, liveness probe (create tx on Base, cancelled unpaid by design)
- `cc-a98885cb-20260705152813.json` — Axion, PAID probe: pay tx
  `0x599d4f21841e2aee650f7347ee437fd6a8b409bc1ada119cca381da9bd1acfde`,
  delivered in 86s (SLA met) — deliverable came back empty, which the judge
  flagged; the full report is the first real defect caught by a paid probe.
