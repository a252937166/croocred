import { cfg } from "./config.js";
import { log } from "./log.js";

/** USDC (Base mainnet) read-only balance check via public RPC. */
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const RPC = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";

export async function getUsdcBalance(address: string): Promise<number | null> {
  try {
    const data = "0x70a08231" + address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [{ to: USDC_BASE, data }, "latest"],
      }),
    });
    const j = (await res.json()) as { result?: string };
    if (!j.result) return null;
    return Number(BigInt(j.result)) / 1e6;
  } catch (err) {
    log.debug("balance check failed", String(err));
    return null;
  }
}

/**
 * Decide probe mode for a certification. PROBE_MODE env forces it; otherwise
 * auto: paid when the CrooCred AA wallet can cover the probes, else liveness.
 */
export async function chooseProbeMode(requiredUsdc: number): Promise<"paid" | "liveness"> {
  const forced = process.env.PROBE_MODE;
  if (forced === "paid" || forced === "liveness") return forced;
  const wallet = process.env.CROO_AA_WALLET;
  if (!wallet) return "liveness";
  const bal = await getUsdcBalance(wallet);
  if (bal === null) return "liveness";
  log.info(`AA wallet ${wallet.slice(0, 8)}… balance $${bal.toFixed(2)}, probes need $${requiredUsdc.toFixed(2)}`);
  return bal >= requiredUsdc ? "paid" : "liveness";
}
