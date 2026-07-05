import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cfg } from "../config.js";
import { loadAllRecords, latestPerAgent, type CertRecord } from "../report.js";
import { renderBadge } from "../badge.js";
import { getUsdcBalance } from "../balance.js";
import type { TestRun } from "../shopper.js";

/**
 * Static site generator — an evidence dashboard, not a brochure.
 *
 * Design language: an audit ledger. Dark ink page, monospace data, and one
 * signature element — the till receipt. Every certification probe is a real
 * purchase, so the freshest evidence is rendered as a paper receipt: line
 * items, tx hashes, a grade stamp, a torn edge. When no live data exists yet
 * the receipt renders as a clearly-watermarked SPECIMEN — never fake numbers.
 *
 * Output:
 *   site-dist/index.html          — dashboard (receipt, metrics, leaderboard)
 *   site-dist/r/<certId>.html     — per-certification evidence report
 *   site-dist/badge/<agentId>.svg — embeddable live badge
 *   site-dist/api/certs.json      — machine-readable certifications feed
 *   site-dist/api/stats.json      — aggregate network stats
 */

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const GRADE_COLOR: Record<string, string> = {
  A: "#6EE646", B: "#9be15d", C: "#e4c34a", D: "#e68a46", F: "#e65846",
};

const basescan = (tx: string): string => `https://basescan.org/tx/${tx}`;
const STORE_AGENT_URL = `https://agent.croo.network/agent/${process.env.CROO_AGENT_ID ?? ""}`;
const GITHUB_URL = "https://github.com/a252937166/croocred";
const short = (s: string | undefined, n = 10): string => (s ? `${s.slice(0, n)}…` : "—");

// ---------------------------------------------------------------- shell ----

function pageShell(title: string, body: string, generatedAt: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(title)}</title>
<meta name="description" content="CrooCred test-buys CROO agents with real CAP orders and publishes graded, tx-hash-backed certification reports."/>
<style>
:root{
  --ink:#0c0e0b;--panel:#13160f;--panel2:#181c12;--line:#272b1f;
  --paper:#f4f1e6;--paper2:#e9e5d4;--paper-ink:#1b1e10;--paper-mut:#6d6a58;
  --green:#6ee646;--amber:#e4c34a;--red:#e65846;--mut:#8b9085;--txt:#e8eae3;
  --mono:"SF Mono",ui-monospace,Menlo,Consolas,"Liberation Mono",monospace;
  --sans:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
}
*{box-sizing:border-box;margin:0}
html{scroll-behavior:smooth}
@media (prefers-reduced-motion: reduce){html{scroll-behavior:auto}*{transition:none!important}}
body{background:var(--ink);color:var(--txt);font:15px/1.65 var(--sans);padding:0 16px 40px}
.wrap{max-width:1060px;margin:0 auto}
a{color:var(--green);text-decoration:none}a:hover{text-decoration:underline}
h2{font:700 13px var(--mono);letter-spacing:2.5px;text-transform:uppercase;color:var(--mut);margin:0 0 14px}
h2 b{color:var(--txt)}
.mono{font-family:var(--mono);font-size:12.5px;word-break:break-all}
.mut{color:var(--mut);font-size:12.5px}
nav{display:flex;align-items:center;gap:18px;padding:18px 0;border-bottom:1px solid var(--line);margin-bottom:34px;flex-wrap:wrap}
.wordmark{font:800 15px var(--mono);letter-spacing:3px;color:var(--txt)}
.wordmark i{font-style:normal;color:var(--green)}
nav .links{margin-left:auto;display:flex;gap:16px;font:12px var(--mono);letter-spacing:.5px}
nav .links a{color:var(--mut)}nav .links a:hover{color:var(--green);text-decoration:none}
.section{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:20px 22px;margin:16px 0}
table{width:100%;border-collapse:collapse;font-size:13.5px}
th,td{padding:9px 10px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--mut);font:600 11px var(--mono);text-transform:uppercase;letter-spacing:1px}
.grade{font:700 18px var(--mono)}
.flag{color:var(--amber);font-size:13px}
.bar{height:8px;border-radius:4px;background:#20241a;overflow:hidden}.bar>i{display:block;height:100%;background:var(--green)}
.scroll{overflow-x:auto}
footer{margin-top:44px;color:#5c6156;font-size:12px;line-height:1.8;border-top:1px solid var(--line);padding-top:18px}
.cta{display:inline-block;background:var(--green);color:#0c0e0b;font:700 13px var(--mono);border-radius:9px;padding:10px 16px;margin:4px 10px 4px 0;border:1px solid var(--green);cursor:pointer}
.cta:hover{text-decoration:none;filter:brightness(1.08)}
.cta.ghost{background:transparent;color:var(--green)}
.probe-type{font:600 10.5px var(--mono);border-radius:6px;padding:1px 7px;white-space:nowrap}
.probe-type.paid{background:#182b12;color:var(--green);border:1px solid #2c5220}
.probe-type.liveness{background:#2b2612;color:var(--amber);border:1px solid #55491c}
pre{background:#0f120b;border:1px solid var(--line);border-radius:10px;padding:13px;font:12.5px/1.55 var(--mono);overflow-x:auto;color:#cfd4c6}
img.av{width:44px;height:44px;border-radius:10px;object-fit:cover;border:1px solid var(--line)}

/* hero */
.hero{display:grid;grid-template-columns:1.15fr .85fr;gap:30px;align-items:start;margin:8px 0 6px}
@media(max-width:860px){.hero{grid-template-columns:1fr}}
.hero h1{font:800 clamp(30px,4.6vw,46px)/1.08 var(--mono);letter-spacing:-.5px;text-transform:uppercase}
.hero h1 .r{color:var(--green)}
.hero p.sub{margin:16px 0 6px;max-width:560px;color:#c9cec0}
.eyebrow{font:600 11px var(--mono);letter-spacing:2.5px;color:var(--mut);text-transform:uppercase;margin-bottom:12px}

/* the receipt — signature element */
.receipt-wrap{display:flex;justify-content:center}
.receipt{position:relative;width:min(360px,100%);background:linear-gradient(178deg,var(--paper) 0%,var(--paper2) 100%);color:var(--paper-ink);font:12.5px/1.7 var(--mono);padding:20px 20px 30px;border-radius:3px 3px 0 0;box-shadow:0 18px 40px rgba(0,0,0,.5),0 2px 0 rgba(255,255,255,.06) inset;
clip-path:polygon(0 0,100% 0,100% calc(100% - 9px),97.5% 100%,95% calc(100% - 9px),92.5% 100%,90% calc(100% - 9px),87.5% 100%,85% calc(100% - 9px),82.5% 100%,80% calc(100% - 9px),77.5% 100%,75% calc(100% - 9px),72.5% 100%,70% calc(100% - 9px),67.5% 100%,65% calc(100% - 9px),62.5% 100%,60% calc(100% - 9px),57.5% 100%,55% calc(100% - 9px),52.5% 100%,50% calc(100% - 9px),47.5% 100%,45% calc(100% - 9px),42.5% 100%,40% calc(100% - 9px),37.5% 100%,35% calc(100% - 9px),32.5% 100%,30% calc(100% - 9px),27.5% 100%,25% calc(100% - 9px),22.5% 100%,20% calc(100% - 9px),17.5% 100%,15% calc(100% - 9px),12.5% 100%,10% calc(100% - 9px),7.5% 100%,5% calc(100% - 9px),2.5% 100%,0 calc(100% - 9px))}
.receipt .rc-head{text-align:center;letter-spacing:1.5px;font-weight:700}
.receipt .rc-sub{text-align:center;color:var(--paper-mut);font-size:10.5px;letter-spacing:1px}
.receipt hr{border:0;border-top:1.5px dashed #b4af97;margin:10px 0}
.receipt .li{display:flex;justify-content:space-between;gap:10px}
.receipt .li span:first-child{color:var(--paper-mut)}
.receipt .li span:last-child{text-align:right;font-weight:600;max-width:60%;word-break:break-all}
.receipt .li a{color:#245c14;text-decoration:underline}
.receipt .total{font-weight:800;font-size:14px}
.receipt .stamp{position:absolute;top:86px;right:14px;border:3px double;border-radius:50%;width:74px;height:74px;display:flex;align-items:center;justify-content:center;font:800 21px var(--mono);transform:rotate(-14deg);opacity:.85;background:rgba(255,255,255,.25)}
.receipt .barcode{margin:12px auto 0;height:30px;width:82%;background:repeating-linear-gradient(90deg,var(--paper-ink) 0 2px,transparent 2px 4px,var(--paper-ink) 4px 7px,transparent 7px 9px,var(--paper-ink) 9px 10px,transparent 10px 13px)}
.receipt.specimen::before{content:"SPECIMEN";position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:800 44px var(--mono);letter-spacing:6px;color:rgba(27,30,16,.10);transform:rotate(-18deg);pointer-events:none}
.rc-ribbon{position:absolute;top:10px;right:-30px;transform:rotate(24deg);background:var(--amber);color:#1b1e10;font:800 9.5px var(--mono);letter-spacing:1px;padding:3px 34px}
.rc-caption{text-align:center;margin-top:12px}
.hint{font:12px var(--mono);margin-top:8px;min-height:18px}
.hint.ok{color:var(--green)}.hint.warn{color:var(--amber)}

/* metrics */
.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(148px,1fr));gap:10px;margin:14px 0}
.metric{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 14px}
.metric b{display:block;font:700 22px var(--mono)}
.metric span{font:600 10.5px var(--mono);color:var(--mut);text-transform:uppercase;letter-spacing:1px}
.metric.zero b{color:#565b50}
.metric.pos b{color:var(--green)}
.metric.warn b{color:var(--amber)}

/* request builder */
.builder{background:var(--panel2);border:1px solid var(--line);border-radius:12px;padding:16px;margin-top:20px}
.builder label{font:600 10.5px var(--mono);color:var(--mut);text-transform:uppercase;letter-spacing:1px;display:block;margin-bottom:6px}
.builder input[type=text]{width:100%;background:#0f120b;border:1px solid var(--line);border-radius:8px;color:var(--txt);font:13px var(--mono);padding:10px 12px;outline:none}
.builder input[type=text]:focus{border-color:var(--green)}
.builder .row{display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap}
.builder .seg{display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden}
.builder .seg button{background:transparent;border:0;color:var(--mut);font:600 12px var(--mono);padding:7px 12px;cursor:pointer}
.builder .seg button.on{background:var(--green);color:#0c0e0b}
.builder pre{margin-top:10px}
.copybtn{background:transparent;border:1px solid var(--green);color:var(--green);font:600 12px var(--mono);border-radius:8px;padding:7px 12px;cursor:pointer}
.copybtn:hover{background:var(--green);color:#0c0e0b}

/* pipeline */
.pipe{display:flex;flex-direction:column;gap:0}
.pipe .st{display:grid;grid-template-columns:44px 1fr;gap:14px;padding:13px 4px;border-bottom:1px dashed var(--line)}
.pipe .st:last-child{border-bottom:0}
.pipe .n{font:800 15px var(--mono);color:var(--green);border:1px solid var(--line);border-radius:8px;width:36px;height:36px;display:flex;align-items:center;justify-content:center;background:var(--panel2)}
.pipe .ev{font:11.5px var(--mono);color:var(--mut);margin-top:3px}
.pipe .ev b{color:#aab0a2;font-weight:600}

/* leaderboard filters */
.filters{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap}
.filters button{background:transparent;border:1px solid var(--line);color:var(--mut);font:600 11.5px var(--mono);border-radius:99px;padding:5px 13px;cursor:pointer}
.filters button.on{border-color:var(--green);color:var(--green)}
tr.hidden{display:none}
.empty-steps{font-size:14px;line-height:2}
.empty-steps .mono{color:var(--green)}
</style></head><body><div class="wrap">
<nav><span class="wordmark"><a href="${cfg.publicBaseURL}/" style="color:inherit;text-decoration:none">CROO<i>CRED</i></a></span>
<div class="links"><a href="${cfg.publicBaseURL}/reports.html">REPORTS</a><a href="${cfg.publicBaseURL}/api.html">API</a><a href="${GITHUB_URL}">GITHUB</a><a href="${STORE_AGENT_URL}">AGENT&nbsp;STORE</a></div></nav>
${body}
<footer>CrooCred — live purchase certification for the agent economy. Paid probes are real CAP orders with escrow and settlement on Base mainnet; liveness checks exercise negotiation + on-chain order creation without payment and cap grades at C. Every tx hash links to Basescan.<br/>
<a href="${GITHUB_URL}">GitHub (MIT)</a> · <a href="${STORE_AGENT_URL}">croocred on the Agent Store</a> · <a href="${cfg.publicBaseURL}/api/certs.json">certs feed</a> · <a href="${cfg.publicBaseURL}/api/stats.json">stats feed</a><br/>
Built for the CROO Agent Hackathon 2026 · page generated ${generatedAt} by the provider daemon.</footer>
</div></body></html>`;
}

// ------------------------------------------------------------- metrics ----

interface Metrics {
  certifiedAgents: number;
  reports: number;
  paidProbes: number;
  livenessProbes: number;
  targetAgents: number;
  buyerAgents: number;
  a2aEdges: number;
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
  const targets = new Set(all.map((r) => r.target.agentId));
  const buyers = new Set(all.map((r) => r.soldVia?.requesterAgentId).filter(Boolean) as string[]);
  return {
    certifiedAgents: latest.size,
    reports: all.length,
    paidProbes: runs.filter((r) => r.mode === "paid" && r.txHashes.pay).length,
    livenessProbes: runs.filter((r) => r.mode === "liveness").length,
    targetAgents: targets.size,
    buyerAgents: buyers.size,
    a2aEdges: targets.size + buyers.size,
    usdcSpent: all.reduce((a, r) => a + r.spentUsdc, 0),
    medianAcceptS: median(runs.map((r) => r.tAcceptMs).filter((x): x is number => x !== undefined).map((x) => x / 1000)),
    medianDeliverS: median(runs.map((r) => r.tDeliverMs).filter((x): x is number => x !== undefined).map((x) => x / 1000)),
    flaggedAgents: [...latest.values()].filter((r) => r.score.grade === "D" || r.score.grade === "F").length,
  };
}

const fmtS = (s: number | null): string =>
  s === null ? "—" : s >= 90 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`;

// ------------------------------------------------------------- receipt ----

function receiptLine(k: string, v: string): string {
  return `<div class="li"><span>${k}</span><span>${v}</span></div>`;
}

/** The signature element: the latest probe rendered as a till receipt. */
function latestReceipt(all: CertRecord[]): string {
  const rec = all.find((r) => r.runs.some((x) => x.txHashes.create || x.txHashes.pay)) ?? all[0];
  const run: TestRun | undefined = rec?.runs.find((x) => x.txHashes.pay) ?? rec?.runs[0];

  if (!rec || !run) {
    return `<div class="receipt-wrap"><div>
<div class="receipt specimen" aria-label="specimen receipt — no live data yet" style="overflow:hidden">
  <div class="rc-ribbon">SPECIMEN · NOT LIVE</div>
  <div class="rc-head">CROOCRED * PURCHASE AUDIT</div>
  <div class="rc-sub">CAP · BASE MAINNET · ESCROWED</div>
  <hr/>
  ${receiptLine("TARGET", "your agent here")}
  ${receiptLine("SERVICE", "—")}
  ${receiptLine("PROBE", "paid")}
  ${receiptLine("ORDER", "—")}
  ${receiptLine("PAY TX", "0x…")}
  ${receiptLine("DELIVER TX", "0x…")}
  ${receiptLine("ACCEPT", "—")}
  ${receiptLine("DELIVERY", "—")}
  ${receiptLine("SLA", "—")}
  <hr/>
  <div class="li total"><span>PROBE SPEND</span><span>$0.00</span></div>
  <div class="barcode"></div>
</div>
<p class="mut rc-caption">Design specimen — not a live certification.<br/>The first real probe prints its receipt here.</p>
</div></div>`;
  }

  const grade = rec.score.grade;
  const c = GRADE_COLOR[grade];
  const result = run.ok ? (run.mode === "paid" ? "PASS" : "ALIVE") : "FAIL";
  const payTx = run.txHashes.pay ? `<a href="${basescan(run.txHashes.pay)}">${short(run.txHashes.pay, 12)}</a>` : "—";
  const delTx = run.txHashes.deliver ? `<a href="${basescan(run.txHashes.deliver)}">${short(run.txHashes.deliver, 12)}</a>` : "—";
  const createTx = run.txHashes.create ? `<a href="${basescan(run.txHashes.create)}">${short(run.txHashes.create, 12)}</a>` : "—";
  return `<div class="receipt-wrap"><div>
<div class="receipt" aria-label="latest certification receipt">
  <div class="rc-head">CROOCRED * PURCHASE AUDIT</div>
  <div class="rc-sub">CAP · BASE MAINNET · ${rec.createdAt.slice(0, 10)}</div>
  <div class="stamp" style="color:${c};border-color:${c}">${grade}</div>
  <hr/>
  ${receiptLine("TARGET", esc(rec.target.agentName.slice(0, 22)))}
  ${receiptLine("SERVICE", esc(rec.target.serviceName.slice(0, 22)))}
  ${receiptLine("PROBE", run.mode.toUpperCase())}
  ${receiptLine("ORDER", short(run.orderId, 12))}
  ${receiptLine("CREATE TX", createTx)}
  ${run.mode === "paid" ? receiptLine("PAY TX", payTx) : ""}
  ${run.mode === "paid" ? receiptLine("DELIVER TX", delTx) : ""}
  ${receiptLine("ACCEPT", fmtS((run.tAcceptMs ?? 0) / 1000))}
  ${run.tDeliverMs !== undefined ? receiptLine("DELIVERY", fmtS(run.tDeliverMs / 1000)) : ""}
  ${receiptLine("SLA", run.slaMet === undefined ? "—" : run.slaMet ? "MET" : "MISSED")}
  ${receiptLine("RESULT", result)}
  <hr/>
  <div class="li total"><span>PROBE SPEND</span><span>$${(run.pricePaidUsdc ?? 0).toFixed(2)}</span></div>
  <div class="barcode"></div>
  <div class="rc-sub" style="margin-top:6px">${esc(rec.certId)}</div>
</div>
<p class="mut rc-caption"><a href="r/${rec.certId}.html">Full evidence report →</a></p>
</div></div>`;
}

// ------------------------------------------------------------ report page --

function runRows(rec: CertRecord): string {
  return rec.runs
    .map((r, i) => {
      const v = rec.verdicts[i];
      const txs = [
        r.txHashes.create ? `<a href="${basescan(r.txHashes.create)}">create</a>` : "",
        r.txHashes.pay ? `<a href="${basescan(r.txHashes.pay)}">pay</a>` : "",
        r.txHashes.deliver ? `<a href="${basescan(r.txHashes.deliver)}">deliver</a>` : "",
        r.txHashes.clear ? `<a href="${basescan(r.txHashes.clear)}">clear</a>` : "",
      ].filter(Boolean).join(" · ") || '<span class="mut">—</span>';
      const outcome = r.ok
        ? r.mode === "paid"
          ? `✅ delivered in ${fmtS((r.tDeliverMs ?? 0) / 1000)} ${r.slaMet ? "(SLA met)" : "<b>(SLA missed)</b>"}`
          : `✅ accepted in ${fmtS((r.tAcceptMs ?? 0) / 1000)}, order created on-chain, cancelled unpaid`
        : `❌ ${esc(r.failureStage ?? "failed")}${r.failureDetail ? ` — <span class="mut">${esc(r.failureDetail.slice(0, 140))}</span>` : ""}`;
      const quality = v?.assessed ? `${v.score}/10` : '<span class="mut">n/a</span>';
      const ids = [
        r.orderId ? `order <span class="mono">${r.orderId}</span>` : "",
        r.negotiationId ? `neg <span class="mono">${r.negotiationId}</span>` : "",
        r.contentHash ? `content hash <span class="mono">${short(r.contentHash, 14)}</span>` : "",
      ].filter(Boolean).join(" · ");
      return `<tr>
<td>#${r.runIndex}<br/><span class="probe-type ${r.mode}">${r.mode}</span></td>
<td>${outcome}${ids ? `<div class="mut" style="margin-top:4px">${ids}</div>` : ""}</td>
<td>${quality}</td>
<td class="mono">${txs}</td></tr>`;
    })
    .join("\n");
}

function reportPage(rec: CertRecord, generatedAt: string): string {
  const c = GRADE_COLOR[rec.score.grade];
  const paidCount = rec.runs.filter((r) => r.mode === "paid" && r.txHashes.pay).length;
  const liveCount = rec.runs.filter((r) => r.mode === "liveness").length;
  const evidenceLine =
    paidCount > 0
      ? `CrooCred placed <b>${paidCount} real paid CAP order(s)</b>${liveCount ? ` and ${liveCount} unpaid liveness probe(s)` : ""} against this service on Base mainnet. Total probe spend: $${rec.spentUsdc.toFixed(2)} USDC.`
      : `CrooCred ran <b>${rec.runs.length} unpaid liveness probe(s)</b> against this service (CAP negotiation + on-chain order creation, cancelled before payment — no funds moved). Grades from liveness alone are capped at C.`;
  const livenessOnly = rec.runs.every((r) => r.mode === "liveness");
  const weightScale: Record<string, number> = livenessOnly
    ? { availability: 60, latency: 40 }
    : { availability: 32, reliability: 28, latency: 17, conformance: 23, quality: 15 };
  const comp = Object.entries(rec.score.components)
    .filter(([k]) => weightScale[k] !== undefined)
    .map(([k, v]) => {
      const max = weightScale[k];
      return `<tr><td style="width:130px">${k}</td><td style="width:60px">${v}</td><td><div class="bar"><i style="width:${Math.min(100, (v / max) * 100)}%"></i></div></td></tr>`;
    })
    .join("");
  const qualityAssessed = rec.verdicts.some((v) => v.assessed);
  const qualityNote = !livenessOnly && !qualityAssessed
    ? `<p class="mut" style="margin-top:8px">Quality assessment: not assessed (LLM judge not configured for this run). Deterministic checks still ran: non-empty deliverable, JSON shape vs listing, filler detection — weights were redistributed accordingly.</p>`
    : "";
  const flags = rec.score.flags.length
    ? rec.score.flags.map((f) => `<div class="flag">⚑ ${esc(f)}</div>`).join("")
    : '<div class="mut">no flags raised</div>';
  const recommendation =
    rec.score.verdict === "certified" ? "HIRE — passed live testing"
    : rec.score.verdict === "conditional" ? "CAUTION — partial evidence, see flags"
    : "AVOID — failed live testing";
  const body = `
<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:8px">
  ${rec.target.avatar ? `<img class="av" src="${esc(rec.target.avatar)}" alt=""/>` : ""}
  <div><h1 style="font:800 24px var(--mono)">${esc(rec.target.agentName)}</h1>
  <div class="mut">service: ${esc(rec.target.serviceName)} · $${rec.target.priceUsdc.toFixed(2)}/call · SLA ${rec.target.slaMinutes}min</div></div>
  <div style="margin-left:auto;text-align:right">
    <div class="grade" style="color:${c};font-size:34px">${rec.score.grade}</div>
    <div class="mut">${rec.score.score}/100 · ${esc(rec.score.verdict)}</div>
  </div>
</div>
<div class="section"><h2>${paidCount ? "Live test evidence" : "Liveness check"}</h2>
<p style="margin:0 0 10px">${evidenceLine}</p>
<div class="scroll"><table><tr><th>probe</th><th>outcome</th><th>quality</th><th>on-chain evidence</th></tr>${runRows(rec)}</table></div></div>
<div class="section"><h2>Recommendation</h2><p style="font:700 15px var(--mono);color:${c}">${recommendation}</p></div>
<div class="section"><h2>Score breakdown</h2><table>${comp}</table>${qualityNote}</div>
<div class="section"><h2>Risk flags</h2>${flags}</div>
<div class="section"><h2>Certification record</h2>
<table>
<tr><td>cert id</td><td class="mono">${rec.certId}</td></tr>
<tr><td>certified at</td><td>${rec.createdAt}</td></tr>
<tr><td>sold via CAP order</td><td class="mono">${rec.soldVia ? `${rec.soldVia.orderId} (buyer agent ${rec.soldVia.requesterAgentId})` : "operator-run seed certification (not sold via CAP)"}</td></tr>
${rec.soldVia?.payTx ? `<tr><td>buyer → CrooCred pay tx</td><td class="mono"><a href="${basescan(rec.soldVia.payTx)}">${rec.soldVia.payTx}</a></td></tr>` : ""}
${rec.soldVia?.deliverTx ? `<tr><td>CrooCred → buyer deliver tx</td><td class="mono"><a href="${basescan(rec.soldVia.deliverTx)}">${rec.soldVia.deliverTx}</a></td></tr>` : ""}
<tr><td>agent id</td><td class="mono">${rec.target.agentId}</td></tr>
<tr><td>service id</td><td class="mono">${rec.target.serviceId}</td></tr>
<tr><td>online status at cert time</td><td>${esc(rec.target.onlineStatus)}</td></tr>
<tr><td>completed orders (self-reported)</td><td>${esc(rec.target.completedOrders)} · ${rec.target.completionRate}% completion</td></tr>
</table></div>
<div class="section"><h2>Claim this badge</h2>
<img src="../badge/${rec.target.agentId}.svg" width="360" height="84" alt="CrooCred badge"/>
<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
<button class="copybtn" data-copy='&lt;img src="${cfg.publicBaseURL}/badge/${rec.target.agentId}.svg" alt="CrooCred ${rec.score.verdict}"/&gt;'>Copy HTML</button>
<button class="copybtn" data-copy="[![CrooCred ${rec.score.verdict}](${cfg.publicBaseURL}/badge/${rec.target.agentId}.svg)](${rec.reportUrl})">Copy Markdown</button>
<button class="copybtn" data-copy="CrooCred ${rec.score.verdict} — grade ${rec.score.grade} (${rec.score.score}/100), live test-buy evidence: ${rec.reportUrl}">Copy DoraHacks text</button>
</div>
<p class="mut" style="margin-top:8px">The badge updates automatically on every re-check; the report link is permanent.</p></div>
<p><a href="../index.html">← all certified agents</a></p>
<script>
document.querySelectorAll('[data-copy]').forEach(function(b){
  b.addEventListener('click',function(){
    navigator.clipboard.writeText(b.getAttribute('data-copy')).then(function(){
      var old=b.textContent;b.textContent='Copied ✓';setTimeout(function(){b.textContent=old;},1500);
    });
  });
});
</script>`;
  return pageShell(`CrooCred report — ${rec.target.agentName}`, body, generatedAt);
}

// ------------------------------------------------------------- index -------

function metricCard(value: string, label: string, tone: "zero" | "pos" | "warn" | "plain"): string {
  return `<div class="metric ${tone}"><b>${value}</b><span>${label}</span></div>`;
}

function leaderboardRows(latest: Map<string, CertRecord>): string {
  const paidCount = (r: CertRecord) => r.runs.filter((x) => x.mode === "paid" && x.txHashes.pay).length;
  return [...latest.values()]
    // paid evidence outranks liveness-only, then recency, then score
    .sort((a, b) =>
      paidCount(b) - paidCount(a) ||
      b.createdAt.localeCompare(a.createdAt) ||
      b.score.score - a.score.score)
    .map((r, i) => {
      const c = GRADE_COLOR[r.score.grade];
      const paid = r.runs.filter((x) => x.mode === "paid" && x.txHashes.pay).length;
      const live = r.runs.filter((x) => x.mode === "liveness").length;
      const risky = r.score.grade === "D" || r.score.grade === "F";
      const delivered = r.runs.filter((x) => x.ok && x.mode === "paid");
      const sla = delivered.length
        ? `${fmtS((delivered[0].tDeliverMs ?? 0) / 1000)} / ${r.target.slaMinutes}m`
        : r.runs.some((x) => x.tAcceptMs !== undefined) ? `accepted ${fmtS((r.runs[0].tAcceptMs ?? 0) / 1000)}` : "—";
      const q = r.verdicts.find((v) => v.assessed);
      return `<tr data-paid="${paid}" data-live="${live}" data-risky="${risky ? 1 : 0}">
<td>${i + 1}</td>
<td><b>${esc(r.target.agentName)}</b><div class="mut">${esc(r.target.serviceName)}</div></td>
<td><span class="grade" style="color:${c}">${r.score.grade}</span> <span class="mut">${r.score.score}</span></td>
<td>${[paid ? `<span class="probe-type paid">${paid} paid</span>` : "", live ? `<span class="probe-type liveness">${live} liveness</span>` : ""].filter(Boolean).join(" ") || "—"}</td>
<td class="mono">${sla}</td>
<td>${q ? `${q.score}/10` : '<span class="mut">n/a</span>'}</td>
<td>${r.score.flags.length ? `<span class="flag">${r.score.flags.length} ⚑</span>` : "—"}</td>
<td><a href="r/${r.certId}.html">report</a></td></tr>`;
    })
    .join("\n");
}

function emptyLeaderboard(): string {
  return `<div class="empty-steps">
<p style="margin-bottom:8px"><b>No live certifications yet.</b> Be the first certified agent:</p>
<p>1 · Copy your serviceId from your <a href="https://agent.croo.network/">Agent Store</a> listing<br/>
2 · Paste it into the payload builder above — it gives you <span class="mono">{"target":"&lt;serviceId&gt;","runs":2}</span><br/>
3 · Order <b>Certify Agent — Live Test-Buy</b> from <a href="${STORE_AGENT_URL}">croocred on the Agent Store</a><br/>
4 · CrooCred test-buys your service and your graded, tx-hash-backed report lands here</p></div>`;
}

const SAMPLE_BADGE = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="84" role="img" aria-label="sample badge — design preview">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#171717"/><stop offset="1" stop-color="#0d0d0d"/></linearGradient></defs>
<rect width="360" height="84" rx="14" fill="url(#g)" stroke="#6EE646" stroke-opacity="0.55" stroke-width="1.5"/>
<circle cx="42" cy="42" r="24" fill="#1a2e16" stroke="#6EE646" stroke-width="2"/>
<text x="42" y="52" font-family="Menlo,monospace" font-size="28" font-weight="700" fill="#6EE646" text-anchor="middle">A</text>
<text x="80" y="30" font-family="sans-serif" font-size="13" font-weight="700" fill="#f2f2f2">YourAgent</text>
<text x="80" y="48" font-family="sans-serif" font-size="11" fill="#6EE646">CrooCred CERTIFIED · score 91/100</text>
<text x="80" y="65" font-family="sans-serif" font-size="10" fill="#8a8a8a">2 paid on-chain probes · SAMPLE — design preview</text>
<text x="348" y="65" font-family="Menlo,monospace" font-size="9" fill="#5a5a5a" text-anchor="end">CAP·Base</text></svg>`;

export interface SystemStatus {
  floatUsdc: number | null;
  probeTier: "paid" | "liveness-only";
  probesAffordable: number | null;
}

function indexPage(all: CertRecord[], latest: Map<string, CertRecord>, generatedAt: string, status: SystemStatus): string {
  const m = computeMetrics(all, latest);
  const rows = leaderboardRows(latest);
  const tone = (n: number, warn = false): "zero" | "pos" | "warn" => (n === 0 ? "zero" : warn ? "warn" : "pos");
  const body = `
<div class="hero">
<div>
  <div class="eyebrow">LIVE PURCHASE CERTIFICATION · CROO CAP · BASE</div>
  <h1>Don't trust the listing.<br/><span class="r">Trust the receipts.</span></h1>
  <p class="sub">CrooCred is a paid CAP agent that audits other agents <b>by buying them</b>: real probe orders, measured SLAs, judged deliverables — published as graded reports where every claim links to an on-chain tx.</p>
  <p style="margin-top:14px">
  <a class="cta" href="${STORE_AGENT_URL}">Order a certification</a>
  <a class="cta ghost" href="#leaderboard">View reports</a>
  </p>

  <div class="builder" id="builder">
    <label for="target-in">Step 1 · Paste target — Agent Store URL, agentId or serviceId</label>
    <input type="text" id="target-in" placeholder="https://agent.croo.network/agent/… or a UUID" spellcheck="false"/>
    <div class="hint" id="target-hint">Accepted: serviceId · agentId · Agent Store URL</div>
    <div class="row">
      <span class="mut">Step 2 · probe runs</span>
      <span class="seg" id="runs-seg"><button data-r="1">1</button><button data-r="2" class="on">2</button><button data-r="3">3</button></span>
      <button class="copybtn" id="copy-payload">Step 3 · Copy CAP payload</button>
      <a class="mut" href="${STORE_AGENT_URL}" style="margin-left:auto">Step 4 · order on the Store →</a>
    </div>
    <pre id="payload-out">{"target":"&lt;paste-your-serviceId&gt;","runs":2}</pre>
    <p class="mut" style="margin-top:8px">Paid probes are selected automatically when CrooCred's wallet covers them; add <span class="mono">"mode":"liveness"</span> to force the free tier. Order this payload on <a href="${STORE_AGENT_URL}">Certify Agent — Live Test-Buy</a>.</p>
  </div>
</div>
${latestReceipt(all)}
</div>

<h2 style="margin-top:26px"><b>Live evidence</b> — persisted certification records only · generated ${generatedAt.slice(0, 16).replace("T", " ")} UTC</h2>
<div class="metrics">
${metricCard(String(m.certifiedAgents), "certified agents", tone(m.certifiedAgents))}
${metricCard(String(m.paidProbes), "paid probes", tone(m.paidProbes))}
${metricCard(String(m.livenessProbes), "liveness checks", m.livenessProbes === 0 ? "zero" : "warn")}
${metricCard(String(m.targetAgents), "target agents tested", tone(m.targetAgents))}
${metricCard(String(m.buyerAgents), "buyer agents", tone(m.buyerAgents))}
${metricCard(String(m.a2aEdges), "a2a edges", tone(m.a2aEdges))}
${metricCard(`$${m.usdcSpent.toFixed(2)}`, "USDC spent on probes", tone(m.usdcSpent > 0 ? 1 : 0))}
${metricCard(fmtS(m.medianDeliverS), "median delivery", m.medianDeliverS === null ? "zero" : "pos")}
${metricCard(String(m.flaggedAgents), "risky agents found", m.flaggedAgents === 0 ? "zero" : "warn")}
</div>

<div class="section"><h2><b>System status</b> — proof this is a running daemon, not a static page</h2>
<div class="scroll"><table>
<tr><td style="width:220px">provider daemon</td><td>online — this page is rebuilt by it after every delivered order</td></tr>
<tr><td>last site build</td><td class="mono">${generatedAt}</td></tr>
<tr><td>probe tier available</td><td>${status.probeTier === "paid" ? `<span class="probe-type paid">paid</span> — float covers ~${status.probesAffordable} probes` : `<span class="probe-type liveness">liveness-only</span> — probe wallet unfunded; paid probes activate automatically once the wallet holds USDC`}</td></tr>
<tr><td>agent listing</td><td><a href="${STORE_AGENT_URL}">croocred on the Agent Store</a> — Certify $0.5 / Re-Check $0.1</td></tr>
</table></div></div>

<div class="section" id="inspector"><h2><b>Inspect a target</b> — free listing check, no order needed</h2>
<div class="builder" style="margin-top:0">
<label for="insp-in">Paste an Agent Store URL, agentId or serviceId — reads CROO's public metadata live</label>
<input type="text" id="insp-in" placeholder="e.g. f57a40f6-be70-4074-8f09-db46cdf51fed" spellcheck="false"/>
<div class="hint" id="insp-hint">The same lookup CrooCred runs before every probe.</div>
<div id="insp-out" style="margin-top:10px"></div>
</div></div>

<div class="section" id="leaderboard"><h2><b>Certified agents</b> (${m.certifiedAgents})</h2>
${rows ? `<div class="filters" id="filters">
<button class="on" data-f="all">All</button>
<button data-f="paid">Paid only</button>
<button data-f="live">Liveness</button>
<button data-f="risky">Flagged</button>
</div>
<div class="scroll"><table id="lb"><tr><th>#</th><th>agent / service</th><th>grade</th><th>evidence</th><th>sla</th><th>quality</th><th>flags</th><th>report</th></tr>${rows}</table></div>` : emptyLeaderboard()}
</div>

<div class="section"><h2><b>How CAP proof works</b> — every step leaves evidence</h2>
<div class="pipe">
<div class="st"><div class="n">1</div><div>Inbound CAP order — buyer → CrooCred, escrow locked<div class="ev">evidence: <b>parent order id · pay tx</b></div></div></div>
<div class="st"><div class="n">2</div><div>Outbound probe order — CrooCred → target agent<div class="ev">evidence: <b>negotiation id · order id · create/pay tx</b></div></div></div>
<div class="st"><div class="n">3</div><div>Delivery observed — target → CrooCred<div class="ev">evidence: <b>deliver tx · keccak256 content hash · delivery latency vs SLA</b></div></div></div>
<div class="st"><div class="n">4</div><div>Quality judged — deterministic checks + LLM rubric vs the listing promise<div class="ev">evidence: <b>score components · flags</b></div></div></div>
<div class="st"><div class="n">5</div><div>Report delivered back over CAP — escrow settles to CrooCred<div class="ev">evidence: <b>report url · badge url · parent deliver tx</b></div></div></div>
</div></div>

<div class="section"><h2><b>Probe tiers</b> — what the evidence means</h2>
<div class="scroll"><table>
<tr><th>tier</th><th>what runs</th><th>what it proves</th><th>grades</th></tr>
<tr><td><span class="probe-type paid">paid</span></td><td>Real CAP order: negotiate → escrow lock → delivery → settlement on Base</td><td>Availability, SLA compliance, deliverable quality — with pay/deliver tx hashes</td><td>A–F</td></tr>
<tr><td><span class="probe-type liveness">liveness</span></td><td>Negotiate → on-chain order creation → cancel before payment (no USDC moves)</td><td>Provider is alive, accepts orders, CAP integration works</td><td>max C</td></tr>
</table></div></div>

<div class="section"><h2><b>Badge</b> — proof in your README</h2>
<div style="display:flex;gap:22px;align-items:center;flex-wrap:wrap">
<div>${SAMPLE_BADGE}<div class="mut" style="margin-top:6px">Sample — design preview, not a live certification.</div></div>
<div style="flex:1;min-width:260px">
<p>After certification, your badge is live at a stable URL and updates on every re-check. Paste your agentId to build your snippet:</p>
<input type="text" id="badge-in" placeholder="your agentId (UUID)" spellcheck="false" style="width:100%;background:#0f120b;border:1px solid var(--line);border-radius:8px;color:var(--txt);font:13px var(--mono);padding:9px 12px;outline:none;margin-bottom:8px"/>
<pre id="badge-snippet">&lt;img src="${cfg.publicBaseURL}/badge/&lt;your-agentId&gt;.svg"/&gt;</pre>
<button class="copybtn" id="copy-badge">Copy snippet</button>
</div></div></div>

<div class="section"><h2><b>Machine-readable feeds</b> — trust as a CAP dependency</h2>
<pre>GET ${cfg.publicBaseURL}/api/certs.json
[{ "certId": "cc-…", "agent": "…", "grade": "A", "score": 91, "verdict": "certified",
   "paidProbes": 2, "livenessProbes": 0, "flags": [], "reportUrl": "…", "badgeUrl": "…" }]

GET ${cfg.publicBaseURL}/api/stats.json
{ "certifiedAgents": ${m.certifiedAgents}, "paidProbes": ${m.paidProbes}, "targetAgents": ${m.targetAgents},
  "buyerAgents": ${m.buyerAgents}, "a2aEdges": ${m.a2aEdges}, "usdcSpent": ${m.usdcSpent.toFixed(2)}, "generatedAt": "${generatedAt}" }

GET ${cfg.publicBaseURL}/api/certs-full.json     — probe-level evidence: every order id + tx hash</pre></div>

<div class="section"><h2><b>Why this needs CAP</b></h2>
<p>On a normal API marketplace a reviewer can only read docs and star ratings. On CAP, CrooCred can <b>prove</b> its findings: escrow shows real money at stake, delivery hashes pin what was returned, settlement txs timestamp SLA compliance — and the certification itself is bought and delivered as a CAP order. The auditor is a paying customer of the market it audits.</p></div>

<script>
(function(){
  var UUID=/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  var runs=2, inp=document.getElementById('target-in'), out=document.getElementById('payload-out'), hint=document.getElementById('target-hint');
  function render(){
    var v=(inp.value||'').trim(), m=v.match(UUID);
    var t=m?m[0]:'<paste-your-serviceId>';
    out.textContent=JSON.stringify({target:t,runs:runs});
    if(!v){hint.textContent='Accepted: serviceId · agentId · Agent Store URL';hint.className='hint';}
    else if(m){hint.textContent='✅ UUID detected — payload ready to copy';hint.className='hint ok';}
    else{hint.textContent='⚠ No UUID found yet — paste an Agent Store URL, agentId, or serviceId';hint.className='hint warn';}
  }
  inp.addEventListener('input',render);
  document.getElementById('runs-seg').addEventListener('click',function(e){
    var b=e.target.closest('button'); if(!b)return;
    runs=+b.dataset.r;
    this.querySelectorAll('button').forEach(function(x){x.classList.toggle('on',x===b);});
    render();
  });
  function copy(btn,text){
    navigator.clipboard.writeText(text).then(function(){
      var old=btn.textContent; btn.textContent='Copied ✓';
      setTimeout(function(){btn.textContent=old;},1500);
    });
  }
  document.getElementById('copy-payload').addEventListener('click',function(){copy(this,out.textContent);});
  var cb=document.getElementById('copy-badge');
  if(cb) cb.addEventListener('click',function(){copy(this,document.getElementById('badge-snippet').textContent);});
  var bi=document.getElementById('badge-in');
  if(bi) bi.addEventListener('input',function(){
    var m=(bi.value||'').match(UUID);
    document.getElementById('badge-snippet').textContent='<img src="${cfg.publicBaseURL}/badge/'+(m?m[0]:'<your-agentId>')+'.svg"/>';
  });

  // Agent Inspector — live lookup against CROO public metadata (CORS-enabled)
  var API='https://api.croo.network/backend/v1/public';
  var ii=document.getElementById('insp-in'), io=document.getElementById('insp-out'), ih=document.getElementById('insp-hint');
  var FLOAT=${status.floatUsdc ?? 0}, CAP=0.2, debounce;
  function usd(x){return '$'+(Number(x)/1e6).toFixed(2);}
  function row(k,v){return '<div class="li" style="display:flex;justify-content:space-between;border-bottom:1px dashed var(--line);padding:4px 0"><span class="mut">'+k+'</span><span style="text-align:right">'+v+'</span></div>';}
  function renderTarget(agent, svc){
    var price=Number(svc.price)/1e6;
    var mode = (FLOAT>=price*2 && price<=CAP) ? '<span class="probe-type paid">paid</span>' : '<span class="probe-type liveness">liveness</span>';
    var capNote = price>CAP ? ' · above CrooCred safety cap $'+CAP.toFixed(2) : '';
    io.innerHTML =
      row('agent', esc2(agent.name)+' · '+(agent.onlineStatus==='online'?'🟢 online':'⚫ '+esc2(agent.onlineStatus||'offline')))+
      row('service', esc2(svc.name))+
      row('price / SLA', usd(svc.price)+' / '+svc.slaMinutes+'min')+
      row('track record', agent.completedOrders+' orders · '+agent.completionRate+'% completion · 7d '+svc.orders7d)+
      row('input type', svc.requirementType||'none')+
      row('recommended probe', mode+capNote)+
      '<div style="margin-top:10px"><button class="copybtn" id="insp-use">Use in wizard ↑</button></div>';
    var ub=document.getElementById('insp-use');
    ub.addEventListener('click',function(){inp.value=svc.serviceId;render();inp.scrollIntoView({behavior:'smooth',block:'center'});});
  }
  function esc2(s){var d=document.createElement('span');d.textContent=String(s||'');return d.innerHTML;}
  function inspect(){
    var m=(ii.value||'').match(UUID);
    if(!m){io.innerHTML='';ih.textContent=(ii.value||'').trim()?'⚠ No UUID found yet':'The same lookup CrooCred runs before every probe.';ih.className='hint '+((ii.value||'').trim()?'warn':'');return;}
    ih.textContent='Looking up…';ih.className='hint';
    var id=m[0];
    fetch(API+'/services/'+id).then(function(r){if(!r.ok)throw 0;return r.json();})
      .then(function(d){return fetch(API+'/agents/'+d.service.agentId).then(function(r){return r.json();}).then(function(a){ih.textContent='✅ serviceId resolved';ih.className='hint ok';renderTarget(a.agent,d.service);});})
      .catch(function(){
        fetch(API+'/agents/'+id).then(function(r){if(!r.ok)throw 0;return r.json();})
          .then(function(a){
            var svcs=(a.agent.services||[]).slice().sort(function(x,y){return Number(x.price)-Number(y.price);});
            if(!svcs.length){ih.textContent='⚠ Agent found but has no services';ih.className='hint warn';io.innerHTML='';return;}
            ih.textContent='✅ agentId resolved — showing cheapest service';ih.className='hint ok';renderTarget(a.agent,svcs[0]);
          })
          .catch(function(){ih.textContent='✖ Not found on the CROO public API';ih.className='hint warn';io.innerHTML='';});
      });
  }
  if(ii){ii.addEventListener('input',function(){clearTimeout(debounce);debounce=setTimeout(inspect,450);});}
  var f=document.getElementById('filters');
  if(f) f.addEventListener('click',function(e){
    var b=e.target.closest('button'); if(!b)return;
    f.querySelectorAll('button').forEach(function(x){x.classList.toggle('on',x===b);});
    var mode=b.dataset.f;
    document.querySelectorAll('#lb tr[data-paid]').forEach(function(tr){
      var show = mode==='all' || (mode==='paid'&&+tr.dataset.paid>0) || (mode==='live'&&+tr.dataset.live>0) || (mode==='risky'&&tr.dataset.risky==='1');
      tr.classList.toggle('hidden',!show);
    });
  });
})();
</script>`;
  return pageShell("CrooCred — live purchase certification for the agent economy", body, generatedAt);
}

// -------------------------------------------------- static extra pages ----

/** Full-structure sample report with unmissable NOT-LIVE marking. */
function sampleReportPage(generatedAt: string): string {
  const banner = `<div style="background:var(--amber);color:#1b1e10;font:800 12px var(--mono);letter-spacing:1.5px;text-align:center;padding:9px;border-radius:10px;margin-bottom:16px">SAMPLE REPORT · NOT A LIVE CERTIFICATION · NOT COUNTED IN METRICS OR FEEDS</div>`;
  const ph = (t: string) => `<span class="mut">${t}</span>`;
  const body = `${banner}
<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:8px">
  <div><h1 style="font:800 24px var(--mono)">ExampleAgent ${ph("(sample)")}</h1>
  <div class="mut">service: example_service · $0.10/call · SLA 30min</div></div>
  <div style="margin-left:auto;text-align:right">
    <div class="grade" style="color:${GRADE_COLOR.B};font-size:34px">B</div>
    <div class="mut">78/100 · certified</div>
  </div>
</div>
<div class="section"><h2>Live test evidence — what a real report contains</h2>
<p style="margin:0 0 10px">CrooCred placed <b>2 real paid CAP order(s)</b> against this service on Base mainnet. Total probe spend: $0.20 USDC. ${ph("(sample values)")}</p>
<div class="scroll"><table><tr><th>probe</th><th>outcome</th><th>quality</th><th>on-chain evidence</th></tr>
<tr><td>#1<br/><span class="probe-type paid">paid</span></td>
<td>✅ delivered in 41s (SLA met)<div class="mut" style="margin-top:4px">order ${ph("ORDER_ID_APPEARS_HERE")} · neg ${ph("NEGOTIATION_ID")} · content hash ${ph("KECCAK256_HASH")}</div></td>
<td>8/10</td><td class="mono">${ph("create · pay · deliver · clear — each links to basescan.org/tx/…")}</td></tr>
<tr><td>#2<br/><span class="probe-type paid">paid</span></td>
<td>✅ delivered in 56s (SLA met)<div class="mut" style="margin-top:4px">order ${ph("ORDER_ID")} · neg ${ph("NEGOTIATION_ID")}</div></td>
<td>7/10</td><td class="mono">${ph("create · pay · deliver · clear tx links")}</td></tr>
</table></div></div>
<div class="section"><h2>Recommendation</h2><p style="font:700 15px var(--mono);color:${GRADE_COLOR.B}">HIRE — passed live testing ${ph("(sample)")}</p></div>
<div class="section"><h2>Score breakdown</h2><table>
<tr><td style="width:130px">availability</td><td style="width:60px">30</td><td><div class="bar"><i style="width:94%"></i></div></td></tr>
<tr><td>reliability</td><td>25</td><td><div class="bar"><i style="width:89%"></i></div></td></tr>
<tr><td>latency</td><td>13</td><td><div class="bar"><i style="width:76%"></i></div></td></tr>
<tr><td>conformance</td><td>15</td><td><div class="bar"><i style="width:65%"></i></div></td></tr>
<tr><td>quality</td><td>11</td><td><div class="bar"><i style="width:73%"></i></div></td></tr>
</table></div>
<div class="section"><h2>Risk flags</h2><div class="flag">⚑ thin track record (&lt;10 completed orders) ${ph("(sample)")}</div></div>
<div class="section"><h2>Certification record</h2>
<table>
<tr><td>cert id</td><td class="mono">${ph("cc-xxxxxxxx-20260705…")}</td></tr>
<tr><td>sold via CAP order</td><td class="mono">${ph("parent ORDER_ID + buyer agent id — or operator-run seed")}</td></tr>
<tr><td>buyer → CrooCred pay tx</td><td class="mono">${ph("0x… links to Basescan")}</td></tr>
<tr><td>CrooCred → buyer deliver tx</td><td class="mono">${ph("0x… links to Basescan")}</td></tr>
</table></div>
<div class="section"><h2>Badge</h2>${SAMPLE_BADGE}<p class="mut" style="margin-top:8px">A live badge updates on every re-check and links back to the report.</p></div>
<p><a href="../reports.html">← reports</a> · <a href="../index.html">home</a></p>`;
  return pageShell("CrooCred — sample evidence report (not live)", body, generatedAt);
}

function reportsPage(all: CertRecord[], latest: Map<string, CertRecord>, generatedAt: string): string {
  const rows = leaderboardRows(latest);
  const live = rows
    ? `<div class="scroll"><table><tr><th>#</th><th>agent / service</th><th>grade</th><th>evidence</th><th>sla</th><th>quality</th><th>flags</th><th>report</th></tr>${rows}</table></div>`
    : `<p class="mut">No live certifications yet — the first graded, tx-hash-backed reports land here as soon as probe orders run.</p>`;
  const body = `
<h1 style="font:800 26px var(--mono);text-transform:uppercase;margin-bottom:14px">Reports</h1>
<div class="section"><h2><b>Live reports</b> (${latest.size})</h2>${live}</div>
<div class="section"><h2><b>Sample report</b></h2>
<p>See exactly what CrooCred publishes after a real CAP test-buy — every field, clearly marked as a sample.</p>
<p style="margin-top:10px"><a class="cta ghost" href="r/sample.html">Open sample report</a></p></div>
<div class="section"><h2><b>Generate your first report</b></h2>
<div class="empty-steps">
<p>1 · Copy your serviceId from your <a href="https://agent.croo.network/">Agent Store</a> listing<br/>
2 · Build the payload on the <a href="index.html#builder">home page wizard</a> — <span class="mono">{"target":"&lt;serviceId&gt;","runs":2}</span><br/>
3 · Order <b>Certify Agent — Live Test-Buy</b> ($0.5) from <a href="${STORE_AGENT_URL}">croocred on the Agent Store</a><br/>
4 · CrooCred test-buys your service and your graded report + live badge appear here</p></div></div>
<p class="mut">${all.length} report(s) issued in total.</p>`;
  return pageShell("CrooCred — certification reports", body, generatedAt);
}

function apiPage(all: CertRecord[], latest: Map<string, CertRecord>, generatedAt: string): string {
  const m = computeMetrics(all, latest);
  const liveCerts = JSON.stringify(
    all.slice(0, 1).map((r) => ({ certId: r.certId, agent: r.target.agentName, grade: r.score.grade, score: r.score.score, verdict: r.score.verdict, reportUrl: r.reportUrl, badgeUrl: r.badgeUrl })),
    null, 2,
  );
  const body = `
<h1 style="font:800 26px var(--mono);text-transform:uppercase;margin-bottom:6px">API</h1>
<p class="mut" style="margin-bottom:14px">Machine-readable trust: other CAP agents query CrooCred before hiring a target. Static JSON, no auth, CORS-open.</p>
<div class="section"><h2><b>Live status</b></h2>
<div class="scroll"><table>
<tr><td style="width:220px">certifications</td><td>${m.reports}</td></tr>
<tr><td>paid probes</td><td>${m.paidProbes}</td></tr>
<tr><td>last generated</td><td class="mono">${generatedAt}</td></tr>
</table></div>
${m.reports === 0 ? '<p class="mut" style="margin-top:8px">No certifications yet — once the first CAP probe runs, these feeds become the machine-readable trust registry.</p>' : ""}</div>
<div class="section"><h2><b>GET /api/stats.json</b> — aggregate network stats</h2>
<pre>curl -s ${cfg.publicBaseURL}/api/stats.json</pre>
<pre>{ "certifiedAgents": ${m.certifiedAgents}, "reports": ${m.reports}, "paidProbes": ${m.paidProbes},
  "livenessProbes": ${m.livenessProbes}, "targetAgents": ${m.targetAgents}, "buyerAgents": ${m.buyerAgents},
  "a2aEdges": ${m.a2aEdges}, "usdcSpent": ${m.usdcSpent.toFixed(2)}, "generatedAt": "${generatedAt}" }</pre>
<p><a href="api/stats.json">raw feed →</a></p></div>
<div class="section"><h2><b>GET /api/certs.json</b> — compact leaderboard feed</h2>
<pre>curl -s ${cfg.publicBaseURL}/api/certs.json</pre>
<pre>${all.length ? esc(liveCerts) : `[]
// empty until the first certification — shape per entry:
// { "certId", "agent", "agentId", "service", "grade", "score", "verdict",
//   "paidProbes", "livenessProbes", "soldViaOrder", "flags", "reportUrl", "badgeUrl" }`}</pre>
<p><a href="api/certs.json">raw feed →</a></p></div>
<div class="section"><h2><b>GET /api/certs-full.json</b> — probe-level evidence</h2>
<p>Every probe's negotiation id, order id, create/pay/deliver/clear tx hashes, latencies, SLA result and content hash — the full receipt chain for machine consumers.</p>
<pre>{ "certId": "cc-…", "target": { … }, "score": { … },
  "soldVia": { "orderId": "…", "payTx": "0x…", "deliverTx": "0x…" },
  "runs": [ { "mode": "paid", "orderId": "…", "createTx": "0x…", "payTx": "0x…",
              "deliverTx": "0x…", "clearTx": "0x…", "acceptMs": 1481,
              "deliverMs": 41000, "slaMet": true, "contentHash": "0x…" } ] }</pre>
<p><a href="api/certs-full.json">raw feed →</a></p></div>
<div class="section"><h2><b>Badges</b> — GET /badge/&lt;agentId&gt;.svg</h2>
<p>Stable per-agent SVG, regenerated on every certification and re-check. Embed it anywhere; it always shows the latest grade.</p></div>`;
  return pageShell("CrooCred — API", body, generatedAt);
}

// ------------------------------------------------------------- build -------

export async function buildSite(): Promise<string> {
  const out = cfg.siteDir;
  mkdirSync(resolve(out, "r"), { recursive: true });
  mkdirSync(resolve(out, "badge"), { recursive: true });
  mkdirSync(resolve(out, "api"), { recursive: true });

  const all = loadAllRecords();
  const latest = latestPerAgent();
  const m = computeMetrics(all, latest);
  const generatedAt = new Date().toISOString();

  // System status: probe-wallet float → paid vs liveness-only (best-effort).
  let status: SystemStatus = { floatUsdc: null, probeTier: "liveness-only", probesAffordable: null };
  const wallet = process.env.CROO_AA_WALLET;
  if (wallet) {
    const bal = await getUsdcBalance(wallet);
    if (bal !== null) {
      status = {
        floatUsdc: bal,
        probeTier: bal >= 0.2 ? "paid" : "liveness-only",
        probesAffordable: Math.floor(bal / 0.1),
      };
    }
  }

  writeFileSync(resolve(out, "index.html"), indexPage(all, latest, generatedAt, status));
  writeFileSync(resolve(out, "reports.html"), reportsPage(all, latest, generatedAt));
  writeFileSync(resolve(out, "api.html"), apiPage(all, latest, generatedAt));
  writeFileSync(resolve(out, "r", "sample.html"), sampleReportPage(generatedAt));
  for (const rec of all) writeFileSync(resolve(out, "r", `${rec.certId}.html`), reportPage(rec, generatedAt));
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
        soldViaOrder: r.soldVia?.orderId ?? null,
        flags: r.score.flags, createdAt: r.createdAt,
        reportUrl: r.reportUrl, badgeUrl: r.badgeUrl,
      })),
      null,
      2,
    ),
  );
  writeFileSync(
    resolve(out, "api", "stats.json"),
    JSON.stringify({ ...m, usdcSpent: Number(m.usdcSpent.toFixed(2)), generatedAt }, null, 2),
  );
  // Full evidence feed: probe-level ids + tx hashes for machine consumers.
  writeFileSync(
    resolve(out, "api", "certs-full.json"),
    JSON.stringify(
      all.map((r) => ({
        certId: r.certId,
        createdAt: r.createdAt,
        target: r.target,
        score: r.score,
        soldVia: r.soldVia ?? null,
        runs: r.runs.map((x) => ({
          mode: x.mode,
          ok: x.ok,
          failureStage: x.failureStage ?? null,
          negotiationId: x.negotiationId ?? null,
          orderId: x.orderId ?? null,
          createTx: x.txHashes.create ?? null,
          payTx: x.txHashes.pay ?? null,
          deliverTx: x.txHashes.deliver ?? null,
          clearTx: x.txHashes.clear ?? null,
          acceptMs: x.tAcceptMs ?? null,
          deliverMs: x.tDeliverMs ?? null,
          slaMet: x.slaMet ?? null,
          contentHash: x.contentHash ?? null,
        })),
        reportUrl: r.reportUrl,
        badgeUrl: r.badgeUrl,
      })),
      null,
      2,
    ),
  );
  return out;
}

// Allow `npm run site`
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildSite().then((out) => console.log("site built at", out));
}
