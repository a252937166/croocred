import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Minimal .env loader — no external dependency. Real env vars win. */
function loadDotEnv(): void {
  const file = resolve(ROOT, ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const [, key, raw] = m;
    if (process.env[key] !== undefined) continue;
    process.env[key] = raw.replace(/^["']|["']$/g, "");
  }
}
loadDotEnv();

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name} (set it in ${ROOT}/.env)`);
  return v;
}

export const cfg = {
  root: ROOT,
  apiURL: process.env.CROO_API_URL ?? "https://api.croo.network",
  wsURL: process.env.CROO_WS_URL ?? "wss://api.croo.network/ws",
  get sdkKey(): string {
    return req("CROO_SDK_KEY");
  },
  /** Optional second key used only by demo/self-test flows. */
  buyerSdkKey: process.env.CROO_BUYER_SDK_KEY ?? "",

  // LLM (OpenAI-compatible; DeepSeek works out of the box)
  llmBaseURL: process.env.LLM_BASE_URL ?? "https://api.deepseek.com",
  llmApiKey: process.env.LLM_API_KEY ?? "",
  llmModel: process.env.LLM_MODEL ?? "deepseek-chat",

  // Safety rails for test purchases
  // 0.2 keeps a 0.5 USDC certification profitable at RUNS_PER_CERT=2
  maxPricePerCallUsdc: Number(process.env.MAX_PRICE_PER_CALL_USDC ?? "0.2"),
  maxBudgetPerCertUsdc: Number(process.env.MAX_BUDGET_PER_CERT_USDC ?? "1.2"),
  runsPerCert: Number(process.env.RUNS_PER_CERT ?? "2"),

  // Timeouts (ms)
  negotiationTimeoutMs: Number(process.env.NEGOTIATION_TIMEOUT_MS ?? 5 * 60_000),
  orderCreateTimeoutMs: Number(process.env.ORDER_CREATE_TIMEOUT_MS ?? 6 * 60_000),
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 4_000),

  dataDir: process.env.DATA_DIR ?? resolve(ROOT, "data"),
  siteDir: process.env.SITE_DIR ?? resolve(ROOT, "site-dist"),
  publicBaseURL: process.env.PUBLIC_BASE_URL ?? "https://croocred.axiqo.xyz",
};

export const USDC_DECIMALS = 6;
export const usdc = (baseUnits: string | number | bigint): number =>
  Number(baseUnits) / 10 ** USDC_DECIMALS;
export const fmtUsdc = (baseUnits: string | number | bigint): string =>
  `$${usdc(baseUnits).toFixed(2)}`;
