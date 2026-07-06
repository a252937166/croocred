import type { CertRecord } from "./report.js";

/**
 * Embeddable SVG badge — the visible artifact agents put in their README /
 * BUIDL page. Regenerated on every certification, served as a static file.
 */

const PALETTE: Record<string, { bg: string; fg: string; label: string }> = {
  A: { bg: "#1a2e16", fg: "#6EE646", label: "CERTIFIED" },
  B: { bg: "#1a2e16", fg: "#9be15d", label: "CERTIFIED" },
  C: { bg: "#2e2a12", fg: "#e6c646", label: "CONDITIONAL" },
  D: { bg: "#2e1a12", fg: "#e68a46", label: "AT RISK" },
  F: { bg: "#2e1212", fg: "#e64646", label: "FAILED" },
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderBadge(rec: CertRecord): string {
  const p = { ...PALETTE[rec.score.grade] };
  // Label follows the verdict, not the grade — a gate-hit record can never
  // wear a better label than its verdict allows.
  if (rec.score.verdict === "conditional") p.label = "CONDITIONAL";
  else if (rec.score.verdict === "not_certified") p.label = rec.score.grade === "F" ? "FAILED" : "NOT CERTIFIED";
  const name = esc(rec.target.agentName.slice(0, 24));
  const date = rec.createdAt.slice(0, 10);
  const probes = rec.runs.filter((r) => r.txHashes.pay).length;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="84" role="img" aria-label="CrooCred ${p.label} grade ${rec.score.grade}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#171717"/><stop offset="1" stop-color="#0d0d0d"/>
    </linearGradient>
  </defs>
  <rect width="360" height="84" rx="14" fill="url(#g)" stroke="${p.fg}" stroke-opacity="0.55" stroke-width="1.5"/>
  <circle cx="42" cy="42" r="24" fill="${p.bg}" stroke="${p.fg}" stroke-width="2"/>
  <text x="42" y="52" font-family="Menlo,Consolas,monospace" font-size="28" font-weight="700" fill="${p.fg}" text-anchor="middle">${rec.score.grade}</text>
  <text x="80" y="30" font-family="-apple-system,Segoe UI,sans-serif" font-size="13" font-weight="700" fill="#f2f2f2">${name}</text>
  <text x="80" y="48" font-family="-apple-system,Segoe UI,sans-serif" font-size="11" fill="${p.fg}">CrooCred ${p.label} · score ${rec.score.score}/100</text>
  <text x="80" y="65" font-family="-apple-system,Segoe UI,sans-serif" font-size="10" fill="#8a8a8a">${probes} paid on-chain probes · ${date} · croocred</text>
  <text x="348" y="65" font-family="Menlo,monospace" font-size="9" fill="#5a5a5a" text-anchor="end">CAP·Base</text>
</svg>`;
}

/** Neutral badge for agents not yet certified (used on directory pages). */
export function renderUncertifiedBadge(agentName: string): string {
  const name = esc(agentName.slice(0, 24));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="84" role="img" aria-label="CrooCred not yet certified">
  <rect width="360" height="84" rx="14" fill="#141414" stroke="#3a3a3a" stroke-width="1.5"/>
  <circle cx="42" cy="42" r="24" fill="#1c1c1c" stroke="#555" stroke-width="2"/>
  <text x="42" y="50" font-family="Menlo,monospace" font-size="22" fill="#777" text-anchor="middle">?</text>
  <text x="80" y="34" font-family="-apple-system,Segoe UI,sans-serif" font-size="13" font-weight="700" fill="#ddd">${name}</text>
  <text x="80" y="56" font-family="-apple-system,Segoe UI,sans-serif" font-size="11" fill="#888">not yet certified — order a CrooCred probe</text>
</svg>`;
}
