import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";

// Carga .env desde la raíz del repo (sin dependencia extra).
function loadDotEnv() {
  for (const dir of [process.cwd(), path.resolve(process.cwd(), "../..")]) {
    const file = path.join(dir, ".env");
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && m[1] && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2]!.replace(/^["']|["']$/g, "");
      }
    }
    break;
  }
}
loadDotEnv();

const schema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(10),
  TELEGRAM_ALLOWED_USER_ID: z.coerce.number().int(),
  OPENROUTER_API_KEY: z.string().min(10),
  OPENROUTER_MODEL: z.string().default("deepseek/deepseek-v4-flash-0731"),
  // Slugs de providers de OpenRouter en orden de preferencia (admite variante, ej "deepinfra/fp4").
  // Vacío = dejar que OpenRouter elija.
  OPENROUTER_PROVIDER_ORDER: z.string().default("deepinfra/fp4,baidu"),
  // "price" = siempre el más barato entre los disponibles al hacer fallback.
  OPENROUTER_SORT: z.enum(["price", "throughput", "latency"]).default("price"),
  GOOGLE_CLIENT_ID: z.string().min(5),
  GOOGLE_CLIENT_SECRET: z.string().min(5),
  PUBLIC_URL: z.string().url().default("http://localhost:8080"),
  PORT: z.coerce.number().int().default(8080),
  WEB_PASSWORD: z.string().min(4),
  WEB_SESSION_SECRET: z.string().min(16),
  TIMEZONE: z.string().default("America/Santiago"),
  // Usuario de Telegram (@usuario) para llamadas de CallMeBot en recordatorios
  // urgentes no confirmados. Vacío = no llamar (solo reintentos por mensaje).
  CALLMEBOT_USER: z.string().default(""),
  BRIEFING_TIME: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .or(z.literal(""))
    .default("07:30"),
  DATABASE_PATH: z.string().default("./data/roganizo.db"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Config inválida. Revisá tu .env:");
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = parsed.data;
