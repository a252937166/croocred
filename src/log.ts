import { appendFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { cfg } from "./config.js";

mkdirSync(cfg.dataDir, { recursive: true });
const LOG_FILE = resolve(cfg.dataDir, "croocred.log");

function write(level: string, msg: string, args: unknown[]): void {
  const ts = new Date().toISOString();
  const extra = args.length
    ? " " + args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")
    : "";
  const line = `${ts} [${level}] ${msg}${extra}`;
  console.log(line);
  try {
    appendFileSync(LOG_FILE, line + "\n");
  } catch {
    /* logging must never crash the daemon */
  }
}

export const log = {
  info: (msg: string, ...args: unknown[]) => write("INFO", msg, args),
  warn: (msg: string, ...args: unknown[]) => write("WARN", msg, args),
  error: (msg: string, ...args: unknown[]) => write("ERROR", msg, args),
  debug: (msg: string, ...args: unknown[]) => {
    if (process.env.DEBUG) write("DEBUG", msg, args);
  },
};
