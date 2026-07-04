import { mkdirSync, writeFileSync, cpSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cfg } from "../config.js";
import { loadAllRecords, latestPerAgent, type CertRecord } from "../report.js";
import { renderBadge } from "../badge.js";

/**
 * Static site generator. Output layout:
 *   site-dist/index.html          — live leaderboard of certified agents
 *   site-dist/r/<certId>.html     — full evidence report per certification
 *   site-dist/badge/<agentId>.svg — embeddable badge (latest cert wins)
 *   site-dist/api/certs.json      — machine-readable feed
 */

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const GRADE_COLOR: Record<string, string> = {
  A: "#6EE646", B: "#9be15d", C: "#e6c646", D: "#e68a46", F: "#e64646",
};

const basescan = (tx: string): string => `https://basescan.org/tx/${tx}`;

function pageShell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(title)}</title>
<style>
:root{--green:#6EE646;--bg:#0d0d0d;--card:#161616;--line:#262626;--mut:#8a8a8a}
*{box-sizing:border-box;margin:0}
body{background:var(--bg);color:#eee;font:15px/1.6 -apple-system,"Segoe UI",Roboto,sans-serif;padding:32px 16px}
.wrap{max-width:980px;margin:0 auto}
a{color:var(--green);text-decoration:none}a:hover{text-decoration:underline}
h1{font-size:26px;letter-spacing:.5px}h2{font-size:18px;margin:28px 0 12px}
.tag{display:inline-block;border:1px solid var(--green);color:var(--green);border-radius:99px;padding:1px 10px;font-size:11px;letter-spacing:1px;text-transform:uppercase}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin:12px 0}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{padding:9px 10px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--mut);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.6px}
.grade{font:700 18px Menlo,monospace}
.mut{color:var(--mut);font-size:12.5px}
.mono{font-family:Menlo,Consolas,monospace;font-size:12.5px;word-break:break-all}
.flag{color:#e6c646;font-size:13px}
.hdr{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:8px}
img.av{width:44px;height:44px;border-radius:10px;object-fit:cover;border:1px solid var(--line)}
.bar{height:8px;border-radius:4px;background:#222;overflow:hidden}.bar>i{display:block;height:100%;background:var(--green)}
footer{margin-top:40px;color:#555;font-size:12px}
.scroll{overflow-x:auto}
</style></head><body><div class="wrap">${body}
<footer>CrooCred — the underwriter of the agent economy. Every grade is backed by real paid CAP orders on Base mainnet; verify every tx on Basescan. Built for the CROO Agent Hackathon 2026 · MIT.</footer>
</div></body></html>`;
}

function runRows(rec: CertRecord): string {
  return rec.runs
    .map((r, i) => {
      const v = rec.verdicts[i];
      const txs = [
        r.txHashes.pay ? `<a href="${basescan(r.txHashes.pay)}">pay</a>` : "",
        r.txHashes.deliver ? `<a href="${basescan(r.txHashes.deliver)}">deliver</a>` : "",
        r.txHashes.create ? `<a href="${basescan(r.txHashes.create)}">create</a>` : "",
      ].filter(Boolean).join(" · ") || '<span class="mut">—</span>';
      const outcome = r.ok
        ? `✅ delivered in ${Math.round((r.tDeliverMs ?? 0) / 1000)}s ${r.slaMet ? "(SLA met)" : "<b>(SLA missed)</b>"}`
        : `❌ ${esc(r.failureStage ?? "failed")}${r.failureDetail ? ` — <span class="mut">${esc(r.failureDetail.slice(0, 140))}</span>` : ""}`;
      const quality = v?.assessed ? `${v.score}/10` : '<span class="mut">n/a</span>';
      return `<tr><td>#${r.runIndex}</td><td>${outcome}</td><td>${quality}</td><td class="mono">${txs}</td></tr>`;
    })
    .join("\n");
}

function reportPage(rec: CertRecord): string {
  const c = GRADE_COLOR[rec.score.grade];
  const comp = Object.entries(rec.score.components)
    .map(([k, v]) => {
      const max = { availability: 32, reliability: 28, latency: 17, conformance: 23, quality: 15 }[k] ?? 30;
      return `<tr><td style="width:130px">${k}</td><td style="width:60px">${v}</td><td><div class="bar"><i style="width:${Math.min(100, (v / max) * 100)}%"></i></div></td></tr>`;
    })
    .join("");
  const flags = rec.score.flags.length
    ? rec.score.flags.map((f) => `<div class="flag">⚑ ${esc(f)}</div>`).join("")
    : '<div class="mut">no flags raised</div>';
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
<div class="card"><span class="tag">Live test evidence</span>
<p style="margin:10px 0 4px">CrooCred placed <b>${rec.runs.length} real paid order(s)</b> against this service on Base mainnet and measured what actually happened. Total probe spend: $${rec.spentUsdc.toFixed(2)} USDC.</p>
<div class="scroll"><table><tr><th>probe</th><th>outcome</th><th>quality</th><th>on-chain evidence</th></tr>${runRows(rec)}</table></div></div>
<div class="card"><h2 style="margin-top:0">Score breakdown</h2><table>${comp}</table></div>
<div class="card"><h2 style="margin-top:0">Risk flags</h2>${flags}</div>
<div class="card"><h2 style="margin-top:0">Listing snapshot at certification time</h2>
<table>
<tr><td>online status</td><td>${esc(rec.target.onlineStatus)}</td></tr>
<tr><td>completed orders (self-reported)</td><td>${esc(rec.target.completedOrders)}</td></tr>
<tr><td>completion rate</td><td>${rec.target.completionRate}%</td></tr>
<tr><td>agent id</td><td class="mono">${rec.target.agentId}</td></tr>
<tr><td>service id</td><td class="mono">${rec.target.serviceId}</td></tr>
<tr><td>certified at</td><td>${rec.createdAt}</td></tr>
<tr><td>cert id</td><td class="mono">${rec.certId}</td></tr>
</table></div>
<div class="card"><h2 style="margin-top:0">Badge</h2>
<img src="../badge/${rec.target.agentId}.svg" width="360" height="84" alt="badge"/>
<p class="mut" style="margin-top:8px">Embed: <span class="mono">&lt;img src="${cfg.publicBaseURL}/badge/${rec.target.agentId}.svg"/&gt;</span></p></div>
<p><a href="../index.html">← all certified agents</a></p>`;
  return pageShell(`CrooCred report — ${rec.target.agentName}`, body);
}

function indexPage(latest: Map<string, CertRecord>, all: CertRecord[]): string {
  const rows = [...latest.values()]
    .sort((a, b) => b.score.score - a.score.score)
    .map((r, i) => {
      const c = GRADE_COLOR[r.score.grade];
      return `<tr>
<td>${i + 1}</td>
<td><b>${esc(r.target.agentName)}</b><div class="mut">${esc(r.target.serviceName)}</div></td>
<td><span class="grade" style="color:${c}">${r.score.grade}</span> <span class="mut">${r.score.score}/100</span></td>
<td>${r.runs.filter((x) => x.txHashes.pay).length} paid probes</td>
<td>${r.score.flags.length ? `${r.score.flags.length} ⚑` : "—"}</td>
<td class="mut">${r.createdAt.slice(0, 10)}</td>
<td><a href="r/${r.certId}.html">report</a></td></tr>`;
    })
    .join("\n");
  const body = `
<div class="hdr"><div>
<h1>CrooCred <span class="tag">agent trust, test-bought</span></h1>
<p class="mut" style="max-width:640px">Before your agent hires another agent, ask CrooCred. We place <b>real paid orders</b> against CROO agents, measure acceptance, SLA compliance and output quality, and publish the evidence — every probe settles on Base and links to Basescan.</p>
</div></div>
<div class="card">
<h2 style="margin-top:0">Certified agents (${latest.size})</h2>
<div class="scroll"><table><tr><th>#</th><th>agent / service</th><th>grade</th><th>evidence</th><th>flags</th><th>date</th><th></th></tr>
${rows || '<tr><td colspan="7" class="mut">no certifications yet — the first reports land here shortly</td></tr>'}
</table></div></div>
<div class="card"><h2 style="margin-top:0">Get certified / hire us</h2>
<p>CrooCred is itself a paid CAP agent. Order a certification from the <a href="https://agent.croo.network/">CROO Agent Store</a> (search “CrooCred”): send <span class="mono">{"target": "&lt;your serviceId&gt;"}</span> and receive a graded, tx-hash-backed report plus a live badge for your README.</p>
<p class="mut">${all.length} certification(s) issued so far · feed: <a href="api/certs.json">api/certs.json</a></p></div>`;
  return pageShell("CrooCred — agent trust, test-bought", body);
}

export function buildSite(): string {
  const out = cfg.siteDir;
  mkdirSync(resolve(out, "r"), { recursive: true });
  mkdirSync(resolve(out, "badge"), { recursive: true });
  mkdirSync(resolve(out, "api"), { recursive: true });

  const all = loadAllRecords();
  const latest = latestPerAgent();

  writeFileSync(resolve(out, "index.html"), indexPage(latest, all));
  for (const rec of all) writeFileSync(resolve(out, "r", `${rec.certId}.html`), reportPage(rec));
  for (const [agentId, rec] of latest) writeFileSync(resolve(out, "badge", `${agentId}.svg`), renderBadge(rec));
  writeFileSync(
    resolve(out, "api", "certs.json"),
    JSON.stringify(
      all.map((r) => ({
        certId: r.certId, agent: r.target.agentName, agentId: r.target.agentId,
        service: r.target.serviceName, grade: r.score.grade, score: r.score.score,
        verdict: r.score.verdict, flags: r.score.flags, createdAt: r.createdAt,
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
