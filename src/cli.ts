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
    default:
      console.log("commands: whoami | search <q> | inspect <id> | services [n] | certify <id> [runs] | buy <serviceId> | demo-buy <serviceId> '<req>' | records | site");
  }
}

main().catch((err) => {
  log.error(String(err));
  process.exit(1);
});
