import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cfg } from "../config.js";
import { loadAllRecords, latestPerAgent, type CertRecord } from "../report.js";
import { renderBadge } from "../badge.js";

/**
 * Static site generator — an evidence dashboard, not a brochure.
 * Every screen carries verifiable artifacts: order ids, tx hashes, latencies,
 * grades, machine-readable feeds.
 *
 * Output layout:
 *   site-dist/index.html          — metrics + leaderboard + evidence
 *   site-dist/r/<certId>.html     — full per-certification evidence report
 *   site-dist/badge/<agentId>.svg — embeddable badge (latest cert wins)
 *   site-dist/api/certs.json      — machine-readable feed
 */

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const GRADE_COLOR: Record<string, string> = {
  A: "#6EE646", B: "#9be15d", C: "#e6c646", D: "#e68a46", F: "#e64646",
};

const basescan = (tx: string): string => `https://basescan.org/tx/${tx}`;
const STORE_AGENT_URL = `https://agent.croo.network/agent/${process.env.CROO_AGENT_ID ?? ""}`;

function pageShell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(title)}</title>
<style>
:root{--green:#6EE646;--bg:#0d0d0d;--card:#161616;--line:#262626;--mut:#8a8a8a;--amber:#e6c646}
*{box-sizing:border-box;margin:0}
body{background:var(--bg);color:#eee;font:15px/1.6 -apple-system,"Segoe UI",Roboto,sans-serif;padding:32px 16px}
.wrap{max-width:1020px;margin:0 auto}
a{color:var(--green);text-decoration:none}a:hover{text-decoration:underline}
h1{font-size:28px;letter-spacing:.5px}h2{font-size:18px;margin:0 0 12px}
.tag{display:inline-block;border:1px solid var(--green);color:var(--green);border-radius:99px;padding:1px 10px;font-size:11px;letter-spacing:1px;text-transform:uppercase}
.tag.amber{border-color:var(--amber);color:var(--amber)}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin:14px 0}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{padding:9px 10px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--mut);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.6px}
.grade{font:700 18px Menlo,monospace}
.mut{color:var(--mut);font-size:12.5px}
.mono{font-family:Menlo,Consolas,monospace;font-size:12.5px;word-break:break-all}
.flag{color:var(--amber);font-size:13px}
.hdr{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:8px}
img.av{width:44px;height:44px;border-radius:10px;object-fit:cover;border:1px solid var(--line)}
.bar{height:8px;border-radius:4px;background:#222;overflow:hidden}.bar>i{display:block;height:100%;background:var(--green)}
footer{margin-top:40px;color:#555;font-size:12px;line-height:1.7}
.scroll{overflow-x:auto}
.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:14px 0}
.metric{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px}
.metric b{display:block;font:700 22px Menlo,monospace;color:var(--green)}
.metric span{font-size:11.5px;color:var(--mut);text-transform:uppercase;letter-spacing:.5px}
.cta{display:inline-block;background:var(--green);color:#0d0d0d;font-weight:700;border-radius:10px;padding:8px 16px;margin:4px 8px 4px 0}
.cta.ghost{background:transparent;color:var(--green);border:1px solid var(--green)}
.steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}
.step{background:#111;border:1px solid var(--line);border-radius:12px;padding:12px 14px;font-size:13px}
.step b{color:var(--green);font-family:Menlo,monospace}
pre{background:#101010;border:1px solid var(--line);border-radius:10px;padding:12px;font-size:12.5px;overflow-x:auto;font-family:Menlo,Consolas,monospace;line-height:1.5}
.probe-type{font-size:10.5px;border-radius:6px;padding:1px 7px;font-family:Menlo,monospace}
.probe-type.paid{background:#1a2e16;color:var(--green);border:1px solid var(--green)}
.probe-type.liveness{background:#2e2a12;color:var(--amber);border:1px solid var(--amber)}
</style></head><body><div class="wrap">${body}
<footer>CrooCred — live purchase certification for the agent economy. Paid probes are real CAP orders with escrow and settlement on Base mainnet (verify every tx on Basescan); liveness checks exercise negotiation + on-chain order creation without payment and cap grades at C.<br/>
<a href="https://github.com/a252937166/croocred">GitHub (MIT)</a> · <a href="${STORE_AGENT_URL}">Agent Store listing</a> · <a href="${cfg.publicBaseURL}/api/certs.json">API feed</a> · Built for the CROO Agent Hackathon 2026.</footer>
</div></body></html>`;
}

// ---------- aggregate metrics --------------------------------------------

interface Metrics {
  certifiedAgents: number;
  reports: number;
  paidProbes: number;
  livenessProbes: number;
  counterparties: number;
  buyerWallets: number;
  usdcSpent: number;
  medianAcceptS: number | null;
  medianDeliverS: number | null;
  flaggedAgents: number;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function computeMetrics(all: CertRecord[], latest: Map<string, CertRecord>): Metrics {
  const runs = all.flatMap((r) => r.runs);
  const buyers = new Set(all.map((r) => r.soldVia?.requesterAgentId).filter(Boolean));
  return {
    certifiedAgents: latest.size,
    reports: all.length,
    paidProbes: runs.filter((r) => r.mode === "paid" && r.txHashes.pay).length,
    livenessProbes: runs.filter((r) => r.mode === "liveness").length,
    counterparties: new Set(all.map((r) => r.target.agentId)).size + buyers.size,
    buyerWallets: buyers.size,
    usdcSpent: all.reduce((a, r) => a + r.spentUsdc, 0),
    medianAcceptS: median(runs.map((r) => r.tAcceptMs).filter((x): x is number => x !== undefined).map((x) => x / 1000)),
    medianDeliverS: median(runs.map((r) => r.tDeliverMs).filter((x): x is number => x !== undefined).map((x) => x / 1000)),
    flaggedAgents: [...latest.values()].filter((r) => r.score.grade === "D" || r.score.grade === "F").length,
  };
}

const fmtS = (s: number | null): string =>
  s === null ? "—" : s >= 90 ? `${Math.round(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`;

// ---------- report page ----------------------------------------------------

function runRows(rec: CertRecord): string {
  return rec.runs
    .map((r, i) => {
      const v = rec.verdicts[i];
      const txs = [
        r.txHashes.create ? `<a href="${basescan(r.txHashes.create)}">create</a>` : "",
        r.txHashes.pay ? `<a href="${basescan(r.txHashes.pay)}">pay</a>` : "",
        r.txHashes.deliver ? `<a href="${basescan(r.txHashes.deliver)}">deliver</a>` : "",
      ].filter(Boolean).join(" · ") || '<span class="mut">—</span>';
      const outcome = r.ok
        ? r.mode === "paid"
          ? `✅ delivered in ${fmtS((r.tDeliverMs ?? 0) / 1000)} ${r.slaMet ? "(SLA met)" : "<b>(SLA missed)</b>"}`
          : `✅ accepted in ${fmtS((r.tAcceptMs ?? 0) / 1000)}, order created on-chain, cancelled unpaid`
        : `❌ ${esc(r.failureStage ?? "failed")}${r.failureDetail ? ` — <span class="mut">${esc(r.failureDetail.slice(0, 140))}</span>` : ""}`;
      const quality = v?.assessed ? `${v.score}/10` : '<span class="mut">n/a</span>';
      const ids = [
        r.orderId ? `order <span class="mono">${r.orderId.slice(0, 8)}…</span>` : "",
        r.negotiationId ? `neg <span class="mono">${r.negotiationId.slice(0, 8)}…</span>` : "",
      ].filter(Boolean).join(" · ");
      return `<tr>
<td>#${r.runIndex}<br/><span class="probe-type ${r.mode}">${r.mode}</span></td>
<td>${outcome}${ids ? `<div class="mut">${ids}</div>` : ""}</td>
<td>${quality}</td>
<td class="mono">${txs}</td></tr>`;
    })
    .join("\n");
}

function reportPage(rec: CertRecord): string {
  const c = GRADE_COLOR[rec.score.grade];
  const paidCount = rec.runs.filter((r) => r.mode === "paid" && r.txHashes.pay).length;
  const liveCount = rec.runs.filter((r) => r.mode === "liveness").length;
  const evidenceLine =
    paidCount > 0
      ? `CrooCred placed <b>${paidCount} real paid CAP order(s)</b>${liveCount ? ` and ${liveCount} unpaid liveness probe(s)` : ""} against this service on Base mainnet. Total probe spend: $${rec.spentUsdc.toFixed(2)} USDC.`
      : `CrooCred ran <b>${rec.runs.length} unpaid liveness probe(s)</b> against this service (CAP negotiation + on-chain order creation, cancelled before payment — no funds moved). Grades from liveness alone are capped at C.`;
  const livenessOnly = rec.runs.every((r) => r.mode === "liveness");
  const weightScale: Record<string, number> = livenessOnly
    ? { availability: 60, latency: 40, reliability: 1, conformance: 1, quality: 1 }
    : { availability: 32, reliability: 28, latency: 17, conformance: 23, quality: 15 };
  const comp = Object.entries(rec.score.components)
    .filter(([k]) => !livenessOnly || k === "availability" || k === "latency")
    .map(([k, v]) => {
      const max = weightScale[k] ?? 30;
      return `<tr><td style="width:130px">${k}</td><td style="width:60px">${v}</td><td><div class="bar"><i style="width:${Math.min(100, (v / max) * 100)}%"></i></div></td></tr>`;
    })
    .join("");
  const flags = rec.score.flags.length
    ? rec.score.flags.map((f) => `<div class="flag">⚑ ${esc(f)}</div>`).join("")
    : '<div class="mut">no flags raised</div>';
  const recommendation =
    rec.score.verdict === "certified" ? "HIRE — passed live testing"
    : rec.score.verdict === "conditional" ? "CAUTION — partial evidence, see flags"
    : "AVOID — failed live testing";
  const body = `
<div class="hdr">
  ${rec.target.avatar ? `<img class="av" src="${esc(rec.target.avatar)}" alt=""/>` : ""}
  <div><h1>${esc(rec.target.agentName)}</h1>
  <div class="mut">service: ${esc(rec.target.serviceName)} · $${rec.target.priceUsdc.toFixed(2)}/call · SLA ${rec.target.slaMinutes}min</div></div>
  <div style="margin-left:auto;text-align:right">
    <div class="grade" style="color:${c};font-size:34px">${rec.score.grade}</div>
    <div class="mut">${rec.score.score}/100 · ${esc(rec.score.verdict)}</div>
  </div>
</div>
<div class="card"><span class="tag ${paidCount ? "" : "amber"}">${paidCount ? "Live test evidence" : "Liveness check"}</span>
<p style="margin:10px 0 4px">${evidenceLine}</p>
<div class="scroll"><table><tr><th>probe</th><th>outcome</th><th>quality</th><th>on-chain evidence</th></tr>${runRows(rec)}</table></div></div>
<div class="card"><h2>Recommendation</h2><p style="font-weight:700;color:${c}">${recommendation}</p></div>
<div class="card"><h2>Score breakdown</h2><table>${comp}</table></div>
<div class="card"><h2>Risk flags</h2>${flags}</div>
<div class="card"><h2>Listing snapshot at certification time</h2>
<table>
<tr><td>online status</td><td>${esc(rec.target.onlineStatus)}</td></tr>
<tr><td>completed orders (self-reported)</td><td>${esc(rec.target.completedOrders)}</td></tr>
<tr><td>completion rate (self-reported)</td><td>${rec.target.completionRate}%</td></tr>
<tr><td>agent id</td><td class="mono">${rec.target.agentId}</td></tr>
<tr><td>service id</td><td class="mono">${rec.target.serviceId}</td></tr>
<tr><td>certified at</td><td>${rec.createdAt}</td></tr>
<tr><td>cert id</td><td class="mono">${rec.certId}</td></tr>
${rec.soldVia ? `<tr><td>sold via CAP order</td><td class="mono">${rec.soldVia.orderId}</td></tr>` : ""}
</table></div>
<div class="card"><h2>Badge</h2>
<img src="../badge/${rec.target.agentId}.svg" width="360" height="84" alt="badge"/>
<p class="mut" style="margin-top:8px">Embed: <span class="mono">&lt;img src="${cfg.publicBaseURL}/badge/${rec.target.agentId}.svg"/&gt;</span></p></div>
<p><a href="../index.html">← all certified agents</a></p>`;
  return pageShell(`CrooCred report — ${rec.target.agentName}`, body);
}

// ---------- index page -------------------------------------------------------

function leaderboard(latest: Map<string, CertRecord>): string {
  const rows = [...latest.values()]
    .sort((a, b) => b.score.score - a.score.score)
    .map((r, i) => {
      const c = GRADE_COLOR[r.score.grade];
      const paid = r.runs.filter((x) => x.mode === "paid" && x.txHashes.pay).length;
      const live = r.runs.filter((x) => x.mode === "liveness").length;
      const evidence = [paid ? `${paid} paid` : "", live ? `${live} liveness` : ""].filter(Boolean).join(" + ");
      return `<tr>
<td>${i + 1}</td>
<td><b>${esc(r.target.agentName)}</b><div class="mut">${esc(r.target.serviceName)}</div></td>
<td><span class="grade" style="color:${c}">${r.score.grade}</span> <span class="mut">${r.score.score}/100</span></td>
<td>${evidence || "—"}</td>
<td>${r.score.flags.length ? `${r.score.flags.length} ⚑` : "—"}</td>
<td class="mut">${r.createdAt.slice(0, 10)}</td>
<td><a href="r/${r.certId}.html">report</a></td></tr>`;
    })
    .join("\n");

  if (!rows) {
    return `<div class="mut" style="padding:16px">
No certifications published yet — the pipeline is live and the first graded reports land here as soon as probe orders run.
Want to be first? <a href="${STORE_AGENT_URL}">Order a certification on the Agent Store</a>.</div>`;
  }
  return `<div class="scroll"><table><tr><th>#</th><th>agent / service</th><th>grade</th><th>probe evidence</th><th>flags</th><th>date</th><th></th></tr>${rows}</table></div>`;
}

function featuredReport(all: CertRecord[]): string {
  const withPaid = all.find((r) => r.runs.some((x) => x.mode === "paid" && x.txHashes.pay)) ?? all[0];
  if (!withPaid) return "";
  const r0 = withPaid.runs[0];
  return `<div class="card"><h2>Featured evidence report</h2>
<p><b>${esc(withPaid.target.agentName)}</b> — grade <b style="color:${GRADE_COLOR[withPaid.score.grade]}">${withPaid.score.grade}</b> (${withPaid.score.score}/100), ${withPaid.runs.length} probe(s), $${withPaid.spentUsdc.toFixed(2)} spent.
${r0?.txHashes.pay ? `Pay tx: <a class="mono" href="${basescan(r0.txHashes.pay)}">${r0.txHashes.pay.slice(0, 18)}…</a>` : ""}
<a href="r/${withPaid.certId}.html">Full report →</a></p></div>`;
}

function indexPage(all: CertRecord[], latest: Map<string, CertRecord>): string {
  const m = computeMetrics(all, latest);
  const body = `
<div class="hdr"><div style="max-width:720px">
<h1>CrooCred <span class="tag">live purchase certification</span></h1>
<p style="margin:10px 0">CrooCred is a paid CROO CAP agent that audits other agents <b>by buying them</b>. It sends probe orders, waits for delivery, measures SLA, verifies output against the listing promise, grades quality, and publishes a report backed by CAP order ids and Base tx hashes.</p>
<p class="mut">Don't trust the listing. Trust the receipts.</p>
<p style="margin-top:12px">
<a class="cta" href="${STORE_AGENT_URL}">Order a certification</a>
<a class="cta ghost" href="#leaderboard">View reports</a>
<a class="cta ghost" href="api/certs.json">API feed</a>
</p>
</div></div>

<h2 style="margin-top:20px">Live certification network</h2>
<div class="metrics">
<div class="metric"><b>${m.certifiedAgents}</b><span>certified agents</span></div>
<div class="metric"><b>${m.paidProbes}</b><span>paid probes</span></div>
<div class="metric"><b>${m.livenessProbes}</b><span>liveness probes</span></div>
<div class="metric"><b>${m.counterparties}</b><span>unique counterparties</span></div>
<div class="metric"><b>$${m.usdcSpent.toFixed(2)}</b><span>USDC spent on probes</span></div>
<div class="metric"><b>${fmtS(m.medianAcceptS)}</b><span>median accept time</span></div>
<div class="metric"><b>${fmtS(m.medianDeliverS)}</b><span>median delivery time</span></div>
<div class="metric"><b>${m.flaggedAgents}</b><span>risky agents found</span></div>
</div>

<div class="card"><h2>How it works</h2>
<div class="steps">
<div class="step"><b>1 · order</b><br/>A human or agent hires CrooCred via CAP: <span class="mono">{"target":"&lt;serviceId&gt;"}</span></div>
<div class="step"><b>2 · test-buy</b><br/>CrooCred places probe orders against the target agent — negotiation, escrow, delivery</div>
<div class="step"><b>3 · measure</b><br/>Accept latency, on-chain order creation, SLA compliance, deliverable shape — all recorded with tx hashes</div>
<div class="step"><b>4 · judge</b><br/>Deliverable content is graded against what the listing promises</div>
<div class="step"><b>5 · publish</b><br/>Graded A–F report + live badge + leaderboard entry, delivered back over CAP</div>
</div></div>

<div class="card" id="leaderboard"><h2>Certified agents (${m.certifiedAgents})</h2>${leaderboard(latest)}</div>

${featuredReport(all)}

<div class="card"><h2>Probe tiers — what the evidence means</h2>
<table>
<tr><th>tier</th><th>what runs</th><th>what it proves</th><th>grade range</th></tr>
<tr><td><span class="probe-type paid">paid</span></td><td>Real CAP order: negotiate → escrow lock → delivery → settlement, all on Base</td><td>Availability, SLA compliance, deliverable quality — with pay/deliver tx hashes</td><td>A–F</td></tr>
<tr><td><span class="probe-type liveness">liveness</span></td><td>Negotiate → on-chain order creation → cancel before payment (no funds move)</td><td>Provider is alive, accepts orders, CAP integration works</td><td>capped at C</td></tr>
</table></div>

<div class="card"><h2>Badge — proof in your README</h2>
<p>Every certified agent gets a live SVG badge that updates on re-checks:</p>
<pre>&lt;img src="${cfg.publicBaseURL}/badge/&lt;your-agentId&gt;.svg"/&gt;</pre>
<p class="mut">Judges and buyers can click through to the full tx-hash-backed report.</p></div>

<div class="card"><h2>Machine-readable feed</h2>
<p>Other agents consume certifications programmatically — trust as a composable CAP dependency:</p>
<pre>GET ${cfg.publicBaseURL}/api/certs.json
[{ "certId": "...", "agent": "...", "grade": "A", "score": 91,
   "verdict": "certified", "flags": [], "reportUrl": "...", "badgeUrl": "..." }]</pre></div>

<div class="card"><h2>Why this needs CAP</h2>
<p>On a normal API marketplace a reviewer can only read docs and star ratings. On CAP, CrooCred can <b>prove</b> its findings: escrow shows real money at stake, delivery hashes pin what was returned, settlement txs timestamp SLA compliance — and the certification itself is bought and delivered as a CAP order. The auditor is a customer of the market it audits.</p></div>

<p class="mut">${m.reports} certification report(s) issued · agent: <a href="${STORE_AGENT_URL}">croocred on the Agent Store</a> · services: Certify (live test-buy) + Re-Check (refresh badge)</p>`;
  return pageShell("CrooCred — live purchase certification for the agent economy", body);
}

// ---------- build ------------------------------------------------------------

export function buildSite(): string {
  const out = cfg.siteDir;
  mkdirSync(resolve(out, "r"), { recursive: true });
  mkdirSync(resolve(out, "badge"), { recursive: true });
  mkdirSync(resolve(out, "api"), { recursive: true });

  const all = loadAllRecords();
  const latest = latestPerAgent();

  writeFileSync(resolve(out, "index.html"), indexPage(all, latest));
  for (const rec of all) writeFileSync(resolve(out, "r", `${rec.certId}.html`), reportPage(rec));
  for (const [agentId, rec] of latest) writeFileSync(resolve(out, "badge", `${agentId}.svg`), renderBadge(rec));
  writeFileSync(
    resolve(out, "api", "certs.json"),
    JSON.stringify(
      all.map((r) => ({
        certId: r.certId, agent: r.target.agentName, agentId: r.target.agentId,
        service: r.target.serviceName, grade: r.score.grade, score: r.score.score,
        verdict: r.score.verdict,
        paidProbes: r.runs.filter((x) => x.mode === "paid" && x.txHashes.pay).length,
        livenessProbes: r.runs.filter((x) => x.mode === "liveness").length,
        flags: r.score.flags, createdAt: r.createdAt,
        reportUrl: r.reportUrl, badgeUrl: r.badgeUrl,
      })),
      null,
      2,
    ),
  );
  return out;
}

// Allow `npm run site`
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log("site built at", buildSite());
}
