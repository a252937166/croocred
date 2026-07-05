import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { cfg, usdc } from "./config.js";
import type { PublicAgent, PublicService } from "./publicApi.js";
import type { TestRun } from "./shopper.js";
import type { QualityVerdict } from "./judge.js";
import type { CertScore } from "./score.js";

export interface CertRecord {
  certId: string;
  createdAt: string;
  target: {
    agentId: string;
    agentName: string;
    serviceId: string;
    serviceName: string;
    priceUsdc: number;
    slaMinutes: number;
    onlineStatus: string;
    completedOrders: string;
    completionRate: number;
    avatar: string;
  };
  score: CertScore;
  runs: TestRun[];
  verdicts: QualityVerdict[];
  spentUsdc: number;
  reportUrl: string;
  badgeUrl: string;
  /** Order that purchased this certification, when sold via CAP. */
  soldVia?: { orderId: string; requesterAgentId: string };
}

const CERTS_DIR = () => {
  const d = resolve(cfg.dataDir, "certs");
  mkdirSync(d, { recursive: true });
  return d;
};

export function newCertId(agentId: string): string {
  const t = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return `cc-${agentId.slice(0, 8)}-${t}`;
}

export function buildRecord(
  certId: string,
  agent: PublicAgent,
  service: PublicService,
  runs: TestRun[],
  verdicts: QualityVerdict[],
  score: CertScore,
  soldVia?: CertRecord["soldVia"],
): CertRecord {
  return {
    certId,
    createdAt: new Date().toISOString(),
    target: {
      agentId: agent.agentId,
      agentName: agent.name,
      serviceId: service.serviceId,
      serviceName: service.name,
      priceUsdc: usdc(service.price),
      slaMinutes: service.slaMinutes,
      onlineStatus: agent.onlineStatus,
      completedOrders: agent.completedOrders,
      completionRate: agent.completionRate,
      avatar: agent.avatar,
    },
    score,
    runs,
    verdicts,
    spentUsdc: runs.reduce((a, r) => a + (r.pricePaidUsdc ?? 0), 0),
    reportUrl: `${cfg.publicBaseURL}/r/${certId}.html`,
    badgeUrl: `${cfg.publicBaseURL}/badge/${agent.agentId}.svg`,
    soldVia,
  };
}

export function saveRecord(rec: CertRecord): string {
  const file = resolve(CERTS_DIR(), `${rec.certId}.json`);
  writeFileSync(file, JSON.stringify(rec, null, 2));
  return file;
}

export function loadAllRecords(): CertRecord[] {
  const dir = CERTS_DIR();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(resolve(dir, f), "utf8")) as CertRecord)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Latest record per target agent (what the leaderboard and badges show). */
export function latestPerAgent(): Map<string, CertRecord> {
  const m = new Map<string, CertRecord>();
  for (const r of loadAllRecords()) {
    if (!m.has(r.target.agentId)) m.set(r.target.agentId, r);
  }
  return m;
}

/** Compact JSON returned as the CAP deliverable (schema type). */
export function deliverablePayload(rec: CertRecord): Record<string, unknown> {
  return {
    cert_id: rec.certId,
    agent: rec.target.agentName,
    agent_id: rec.target.agentId,
    service: rec.target.serviceName,
    service_id: rec.target.serviceId,
    grade: rec.score.grade,
    score: rec.score.score,
    verdict: rec.score.verdict,
    components: rec.score.components,
    flags: rec.score.flags,
    probes: rec.runs.map((r) => ({
      type: r.mode,
      ok: r.ok,
      failure: r.failureStage ?? null,
      order_id: r.orderId ?? null,
      create_tx: r.txHashes.create ?? null,
      pay_tx: r.txHashes.pay ?? null,
      deliver_tx: r.txHashes.deliver ?? null,
      accept_ms: r.tAcceptMs ?? null,
      deliver_ms: r.tDeliverMs ?? null,
      sla_met: r.slaMet ?? null,
    })),
    evidence_note: rec.runs.some((r) => r.mode === "paid")
      ? "Paid probes are real CAP orders with escrow and settlement on Base mainnet; verify tx hashes on basescan.org"
      : "Liveness probes exercise CAP negotiation and on-chain order creation without payment; grades are capped at C until paid probes run",
    report_url: rec.reportUrl,
    badge_url: rec.badgeUrl,
    certified_at: rec.createdAt,
  };
}
