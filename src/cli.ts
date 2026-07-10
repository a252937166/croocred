import { AgentClient } from "@croo-network/sdk";
import { cfg, usdc } from "./config.js";
import { log } from "./log.js";
import { certify } from "./certify.js";
import { getPublicAgent, getPublicService, searchAgents, listPublicServices } from "./publicApi.js";
import { buildSite } from "./site/build.js";
import { loadAllRecords } from "./report.js";

/**
 * Operator CLI.
 *
 *   npm run cli -- whoami                 # verify key + show visible orders
 *   npm run cli -- search <query>         # search public store
 *   npm run cli -- inspect <id>           # public metadata for agent/service
 *   npm run cli -- certify <id> [runs]    # run a certification (spends USDC!)
 *   npm run cli -- buy <serviceId>        # single probe purchase, no scoring
 *   npm run cli -- records                # list stored certifications
 *   npm run cli -- site                   # rebuild static site
 *   npm run cli -- demo-buy <serviceId> '<requirements>'   # TestPilot buys a service (e.g. ours)
 */

const [, , cmd, ...args] = process.argv;

const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const mainClient = () =>
  new AgentClient({ baseURL: cfg.apiURL, wsURL: cfg.wsURL, logger: quiet }, cfg.sdkKey);
const buyerClient = () => {
  if (!cfg.buyerSdkKey) throw new Error("CROO_BUYER_SDK_KEY not set");
  return new AgentClient({ baseURL: cfg.apiURL, wsURL: cfg.wsURL, logger: quiet }, cfg.buyerSdkKey);
};

async function main(): Promise<void> {
  switch (cmd) {
    case "whoami": {
      for (const [label, mk] of [["main(CrooCred)", mainClient], ["buyer(TestPilot)", buyerClient]] as const) {
        try {
          const c = mk();
          const [bought, sold, negs] = await Promise.all([
            c.listOrders({ role: "buyer", pageSize: 5 }),
            c.listOrders({ role: "provider", pageSize: 5 }),
            c.listNegotiations({ role: "requester", pageSize: 5 }),
          ]);
          console.log(`${label}: key OK — bought=${bought?.length ?? 0} sold=${sold?.length ?? 0} negs=${negs?.length ?? 0}`);
          const any = bought?.[0] ?? negs?.[0];
          if (any) console.log(`  agent hints: requester=${(any as { requesterAgentId?: string }).requesterAgentId} provider=${(any as { providerAgentId?: string }).providerAgentId}`);
        } catch (err) {
          console.log(`${label}: ${String(err)}`);
        }
      }
      break;
    }
    case "search": {
      const agents = await searchAgents(args.join(" "));
      for (const a of agents.slice(0, 10)) {
        console.log(`${a.name}  [${a.agentId}]  online=${a.onlineStatus} orders=${a.completedOrders}`);
        for (const s of a.services ?? []) {
          console.log(`   - ${s.name}  [${s.serviceId}]  ${usdc(s.price)} USDC, SLA ${s.slaMinutes}m, 7d=${s.orders7d}`);
        }
      }
      break;
    }
    case "inspect": {
      const id = args[0];
      try {
        const a = await getPublicAgent(id);
        console.log(JSON.stringify(a, null, 2));
      } catch {
        console.log(JSON.stringify(await getPublicService(id), null, 2));
      }
      break;
    }
    case "services": {
      const items = await listPublicServices(1, Number(args[0] ?? 30));
      for (const s of items) console.log(`${usdc(s.price).toFixed(2)}  SLA${String(s.slaMinutes).padStart(4)}m  7d=${String(s.orders7d).padStart(4)}  ${s.name}  [${s.serviceId}]`);
      break;
    }
    case "certify": {
      const rec = await certify(mainClient(), args[0], {
        runs: args[1] ? Number(args[1]) : undefined,
        probeInput: args.slice(2).join(" ") || undefined,
      });
      console.log(JSON.stringify({ certId: rec.certId, grade: rec.score.grade, score: rec.score.score, flags: rec.score.flags, spent: rec.spentUsdc }, null, 2));
      await buildSite();
      break;
    }
    case "buy": {
      const { runTestPurchase } = await import("./shopper.js");
      const service = await getPublicService(args[0]);
      const run = await runTestPurchase(mainClient(), service, args[1] ?? "probe: please run a representative example", 1);
      console.log(JSON.stringify(run, null, 2));
      break;
    }
    case "demo-buy": {
      const { runTestPurchase } = await import("./shopper.js");
      const service = await getPublicService(args[0]);
      const run = await runTestPurchase(buyerClient(), service, args[1] ?? "", 1);
      console.log(JSON.stringify(run, null, 2));
      break;
    }
    case "verdict": {
      const { judgeClaim } = await import("./verdict.js");
      const v = await judgeClaim(args.join(" "));
      console.log(JSON.stringify(v, null, 2));
      break;
    }
    case "records": {
      for (const r of loadAllRecords())
        console.log(`${r.createdAt}  ${r.score.grade} ${String(r.score.score).padStart(3)}  ${r.target.agentName} / ${r.target.serviceName}  (${r.certId})`);
      break;
    }
    case "site": {
      console.log("built:", await buildSite());
      break;
    }
    case "rejudge": {
      // Fairness pass: paid runs recorded with an empty deliverable may have
      // delivered real content in the `deliverableSchema` field (shopper read
      // only `deliverableText` before 2026-07-06). Re-fetch each such
      // delivery, recover the payload, re-judge it, recompute the score.
      const { computeScore } = await import("./score.js");
      const { saveRecord } = await import("./report.js");
      const { judgeDeliverable } = await import("./judge.js");
      const { resolveTarget } = await import("./publicApi.js");
      const client = mainClient();
      for (const rec of loadAllRecords()) {
        const emptyPaid = rec.runs.filter(
          (r) => r.mode === "paid" && r.ok && r.orderId && !(r.deliverableText ?? "").trim(),
        );
        if (!emptyPaid.length) continue;
        // Listing context for the judge — live if possible, else the snapshot.
        let agent = {
          agentId: rec.target.agentId, name: rec.target.agentName, description: "",
          onlineStatus: rec.target.onlineStatus, completedOrders: rec.target.completedOrders,
          completionRate: rec.target.completionRate, avatar: rec.target.avatar,
        } as Parameters<typeof judgeDeliverable>[0];
        let service = {
          serviceId: rec.target.serviceId, agentId: rec.target.agentId, name: rec.target.serviceName,
          description: "", price: String(Math.round(rec.target.priceUsdc * 1e6)),
          slaMinutes: rec.target.slaMinutes, requirementType: "", requirementText: "",
          requirementSchema: "", deliverableType: "", deliverableText: "", deliverableSchema: "", orders7d: "",
        } as unknown as Parameters<typeof judgeDeliverable>[1];
        try {
          const t = await resolveTarget(rec.target.serviceId);
          agent = t.agent; service = t.service;
        } catch { /* snapshot fallback */ }
        let changed = false;
        for (let i = 0; i < rec.runs.length; i++) {
          const run = rec.runs[i];
          if (!emptyPaid.includes(run)) continue;
          try {
            const d = await client.getDelivery(run.orderId!);
            const content = ((d.deliverableText ?? "").trim() || (d.deliverableSchema ?? "").trim());
            if (!content) { console.log(`${rec.certId} run#${run.runIndex}: genuinely empty — verdict stands`); continue; }
            run.deliverableText = content;
            run.deliverableType = d.deliverableType;
            rec.verdicts[i] = await judgeDeliverable(agent, service, run);
            changed = true;
            console.log(`${rec.certId} run#${run.runIndex}: recovered ${content.length} chars from schema field → re-judged ${rec.verdicts[i].score}/10`);
          } catch (err) {
            console.log(`${rec.certId} run#${run.runIndex}: refetch failed — ${String(err).slice(0, 90)}`);
          }
        }
        if (changed) {
          rec.score = computeScore(agent, service, rec.runs, rec.verdicts);
          (rec as unknown as Record<string, unknown>).rejudgedAt = new Date().toISOString();
          saveRecord(rec);
          console.log(`  ⇒ ${rec.target.agentName}: ${rec.score.grade}·${rec.score.score} ${rec.score.verdict} → ${rec.score.recommendation}`);
        }
      }
      console.log("site:", await buildSite());
      break;
    }
    case "recalibrate": {
      // Judge-calibration pass: re-run the anchored LLM judge over every
      // delivered paid run's stored deliverable, then recompute under the
      // current weights. Records without judged deliverables just replay
      // through the current rubric.
      const { computeScore, finalizeScore } = await import("./score.js");
      const { saveRecord } = await import("./report.js");
      const { judgeDeliverable } = await import("./judge.js");
      const { resolveTarget } = await import("./publicApi.js");
      for (const rec of loadAllRecords()) {
        const before = `${rec.score.grade}·${rec.score.score}`;
        const judgeable = rec.runs.filter(
          (r) => r.mode === "paid" && r.ok && (r.deliverableText ?? "").trim(),
        );
        if (!judgeable.length) {
          rec.score = finalizeScore(rec.score.components, rec.score.flags, rec.runs, rec.verdicts);
          saveRecord(rec);
          console.log(`${rec.certId}  ${rec.target.agentName.padEnd(22).slice(0, 22)}  ${before} ⇒ ${rec.score.grade}·${rec.score.score} (no judged deliverable)`);
          continue;
        }
        let agent = {
          agentId: rec.target.agentId, name: rec.target.agentName, description: "",
          onlineStatus: rec.target.onlineStatus, completedOrders: rec.target.completedOrders,
          completionRate: rec.target.completionRate, avatar: rec.target.avatar,
        } as Parameters<typeof judgeDeliverable>[0];
        let service = {
          serviceId: rec.target.serviceId, agentId: rec.target.agentId, name: rec.target.serviceName,
          description: "", price: String(Math.round(rec.target.priceUsdc * 1e6)),
          slaMinutes: rec.target.slaMinutes, requirementType: "", requirementText: "",
          requirementSchema: "", deliverableType: "", deliverableText: "", deliverableSchema: "", orders7d: "",
        } as unknown as Parameters<typeof judgeDeliverable>[1];
        try {
          const t = await resolveTarget(rec.target.serviceId);
          agent = t.agent; service = t.service;
        } catch { /* snapshot fallback */ }
        for (let i = 0; i < rec.runs.length; i++) {
          if (!judgeable.includes(rec.runs[i])) continue;
          rec.verdicts[i] = await judgeDeliverable(agent, service, rec.runs[i]);
        }
        rec.score = computeScore(agent, service, rec.runs, rec.verdicts);
        (rec as unknown as Record<string, unknown>).recalibratedAt = new Date().toISOString();
        saveRecord(rec);
        const q = rec.verdicts.filter((v) => v.assessed).map((v) => v.score).join(",");
        console.log(`${rec.certId}  ${rec.target.agentName.padEnd(22).slice(0, 22)}  ${before} ⇒ ${rec.score.grade}·${rec.score.score} ${rec.score.recommendation}  (q: ${q})`);
      }
      console.log("site:", await buildSite());
      break;
    }
    case "reverdict": {
      // Scan stored claim verdicts for records the v1 parser mis-read (no
      // buyer request recognized from a structured claim) and re-adjudicate
      // against the real buyer request. Old records are marked invalidated +
      // supersededBy; nothing is silently edited.
      const { readjudicateVerdictFile } = await import("./verdict.js");
      const { readdirSync: rds } = await import("node:fs");
      const { resolve: rsv } = await import("node:path");
      const { cfg: c2 } = await import("./config.js");
      const vdir = rsv(c2.dataDir, "verdicts");
      const files = args[0] && args[0] !== "scan" ? [args[0]] : rds(vdir).filter((f) => f.endsWith(".json"));
      let corrected = 0;
      for (const f of files) {
        try {
          const res = await readjudicateVerdictFile(f);
          if (res) {
            corrected++;
            console.log(`${f}  ${res.oldHash.slice(0, 12)}… → ${res.newHash.slice(0, 12)}…`);
          }
        } catch (e) {
          console.error(`${f}: ${String(e)}`);
        }
      }
      console.log(`re-adjudicated ${corrected} verdict(s)`);
      console.log("site:", await buildSite());
      break;
    }
    case "rescore": {
      // Replay every stored record through the current rubric (idempotent).
      const { finalizeScore } = await import("./score.js");
      const { saveRecord } = await import("./report.js");
      for (const rec of loadAllRecords()) {
        const before = `${rec.score.grade}·${rec.score.score} ${rec.score.verdict}`;
        rec.score = finalizeScore(rec.score.components, rec.score.flags, rec.runs, rec.verdicts);
        (rec as unknown as Record<string, unknown>).rescoredAt = new Date().toISOString();
        saveRecord(rec);
        const after = `${rec.score.grade}·${rec.score.score} ${rec.score.verdict} → ${rec.score.recommendation}`;
        console.log(`${rec.certId}  ${rec.target.agentName.padEnd(22).slice(0, 22)}  ${before}  ⇒  ${after}`);
      }
      console.log("site:", await buildSite());
      break;
    }
    default:
      console.log("commands: whoami | search <q> | inspect <id> | services [n] | certify <id> [runs] | buy <serviceId> | demo-buy <serviceId> '<req>' | records | rescore | site");
  }
}

main().catch((err) => {
  log.error(String(err));
  process.exit(1);
});
