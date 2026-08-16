import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Reads KEY=value pairs from a .env file without adding a dependency, mirroring
 * what the server does. Existing environment variables always win, so an MCP
 * client that passes `env` in its config overrides whatever is on disk.
 */
function loadDotEnv(file: string) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[1] && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2]!.replace(/^["']|["']$/g, "");
    }
  }
}

// apps/mcp/.env first (it is the one meant to point at the deployed instance),
// then the repo root .env so a local checkout works with no extra setup.
const here = path.dirname(fileURLToPath(import.meta.url));
const mcpRoot = path.resolve(here, "..");
loadDotEnv(path.join(mcpRoot, ".env"));
loadDotEnv(path.resolve(mcpRoot, "../..", ".env"));

export interface McpConfig {
  /** Base URL of the Roganizo instance, no trailing slash. */
  url: string;
  /** Web password. Undefined means every authenticated tool will say so. */
  password: string | undefined;
}

export function readConfig(): McpConfig {
  const url = (process.env.ROGANIZO_URL ?? "http://localhost:8080").replace(/\/+$/, "");
  // WEB_PASSWORD is the key the server itself uses: falling back to it makes a
  // local checkout work, but a deployed instance needs its own ROGANIZO_PASSWORD.
  const password = process.env.ROGANIZO_PASSWORD || process.env.WEB_PASSWORD || undefined;
  return { url, password };
}
