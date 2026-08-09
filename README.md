# Roganizo

Asistente personal **mono-usuario**: le hablás en lenguaje natural por **Telegram** y organiza
tu vida en **Google Calendar**, **Google Tasks**, notas y recordatorios. Incluye una **web de
solo lectura** (calendario, to-dos, notas y stats) protegida por contraseña — toda modificación
pasa por el bot; nadie más puede tocar nada.

```
Telegram ⇄ grammY ⇄ Agente LLM (OpenRouter, tool-calling)
                        ├─ Google Calendar (eventos, RRULE, huecos libres, conflictos)
                        ├─ Google Tasks (to-dos)
                        └─ SQLite (notas, recordatorios, historial)
Scheduler (60s) → recordatorios + briefing matutino por Telegram
Hono → /oauth/* · /api/* (solo GET, con sesión) · SPA React (diseño "Web A")
```

## Qué sabe hacer

- *"mi horario: lunes 8am ciencias, 9 mates, martes 3pm biología"* → eventos semanales
  recurrentes (con resumen + botones **Confirmar/Cancelar** si son 3 o más).
- *"después de biología quiero estudiar, pero antes 20 min de almuerzo"* → lee el calendario
  y crea todo encadenado.
- *"¿a qué hora me recomendás estudiar el martes?"* → analiza huecos libres reales.
- *"recordame la prueba el martes 28 de septiembre"* → mensaje de Telegram ese día.
- Recordatorios **urgentes** ("insiste hasta que confirme"): aviso con botón "✅ Visto"
  5 minutos **antes** de la hora y, si no confirmás, **te llama por Telegram** (CallMeBot)
  a la hora exacta.
- Detecta solapes de horario y avisa en lugar de crear a ciegas.
- Briefing cada mañana: agenda del día + to-dos + recordatorios.
- Notas y to-dos por chat; todo visible en la web.

## Prerrequisitos (una sola vez)

1. **Bot de Telegram**: hablá con [@BotFather](https://t.me/BotFather) → `/newbot` → guardá el
   token. Tu user ID lo da [@userinfobot](https://t.me/userinfobot).
2. **Google Cloud Console** ([console.cloud.google.com](https://console.cloud.google.com)):
   - Creá un proyecto → habilitá **Google Calendar API** y **Google Tasks API**.
   - *APIs & Services → Credentials → Create credentials → OAuth client ID* (tipo **Web
     application**) con redirect URI `https://TU-DOMINIO/oauth/callback` (en dev:
     `http://localhost:8080/oauth/callback`).
   - En *OAuth consent screen* agregá tu cuenta como **test user** (con eso alcanza; no hace
     falta publicar la app).
3. **OpenRouter**: API key en [openrouter.ai/keys](https://openrouter.ai/keys).

## Desarrollo local

```bash
pnpm install
cp .env.example .env   # completá tus credenciales
pnpm dev               # server + bot en :8080
pnpm dev:web           # SPA con hot-reload en :5173 (proxy a :8080)
```

Primer uso: mandale `/start` al bot → te da el link para conectar Google → listo.

## Deploy en Dokploy

1. Subí este repo a Git (GitHub/GitLab o el Git propio de Dokploy).
2. En Dokploy: **Create Application** → Source: tu repo → Build Type: **Dockerfile**.
3. **Environment**: cargá todas las variables de `.env.example` con valores reales.
   `PUBLIC_URL` = tu dominio (ej: `https://roganizo.tudominio.com`) y acordate de registrar
   `PUBLIC_URL/oauth/callback` en Google.
4. **Volumes / Mounts**: montá un volumen en `/data` (ahí vive la base SQLite).
5. **Domains**: asigná el dominio con HTTPS apuntando al puerto **8080**.
6. Deploy. El bot usa long-polling: no hay que configurar ningún webhook de Telegram.
7. Mandale `/start` al bot y conectá Google desde el link.

## Variables de entorno

| Variable | Qué es |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Token de @BotFather |
| `TELEGRAM_ALLOWED_USER_ID` | Tu user ID numérico — el bot ignora al resto |
| `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` | LLM (default `deepseek/deepseek-v4-flash-0731`) |
| `OPENROUTER_PROVIDER_ORDER` | Providers preferidos en orden, admite variante (default `deepinfra/fp4,baidu`) |
| `OPENROUTER_SORT` | Criterio de fallback: `price` (default), `throughput` o `latency` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth de Google Cloud |
| `PUBLIC_URL` | URL pública (OAuth callback + links del bot) |
| `PORT` | Puerto HTTP (default 8080) |
| `WEB_PASSWORD` | Contraseña de la web read-only |
| `WEB_SESSION_SECRET` | String largo aleatorio para firmar la cookie |
| `CALLMEBOT_USER` | Tu @usuario de Telegram para llamadas de urgencia (vacío = sin llamadas) |
| `TIMEZONE` | Default `America/Santiago` |
| `BRIEFING_TIME` | Hora del briefing `HH:mm` (vacío = desactivado) |
| `DATABASE_PATH` | Default `/data/roganizo.db` en Docker |

## Comandos del bot

- `/start` — bienvenida y conexión con Google si falta
- `/web` — link al panel
- `/reset` — borra la memoria de conversación
