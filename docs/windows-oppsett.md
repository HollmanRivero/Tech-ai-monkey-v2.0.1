# Tech AI monkey — Windows-oppsett

> Guide for å kjøre **hele stakken** (agent + web + database) lokalt på Windows 10/11.
> Agentkoden er uendret i logikk — kun de plattformspesifikke bitene (sandkasse,
> binærdeteksjon, tjenester) er tilpasset Windows.

## Oversikt

| Komponent | Port | Hva den trenger |
|---|---|---|
| Ollama (modellmotor) | 11434 | Ollama for Windows + modellen `tech-ai-monkey` |
| Agenten (`eve`) | 2000 | Node 24, bygd `.output/` |
| Web-appen (Next.js) | 3100 | Node 24, PostgreSQL, bygd `.next/` |
| Cloudflare Tunnel (valgfritt) | — | `cloudflared` for å publisere på tech-ai.tech |

Agentens sandkasse kjører nå via **Git Bash** (`C:\Program Files\Git\bin\bash.exe`),
som følger med Git for Windows. Du trenger altså Git for Windows installert.

---

## 1. Installer verktøyene

### Node 24 (minimum — ikke 20/22)

- Last ned LTS fra <https://nodejs.org> (24.x) og installer, eller bruk nvm-windows:
  <https://github.com/coreybutler/nvm-windows/releases>
- Sjekk: `node -v` → `v24.x.x`

### Git for Windows (gir Git Bash til sandkassen)

- <https://git-scm.com/download/win> (velg standardalternativer).
- Sjekk at `C:\Program Files\Git\bin\bash.exe` finnes.

### Ollama

- <https://ollama.com/download/windows> (per-bruker, ingen admin trengs).
- Bygg modellen repoet bruker:

```powershell
ollama pull llama3.2:3b
cd C:\sti\til\tech-ai-monkey
ollama create tech-ai-monkey -f Modelfile.tech-ai-monkey
ollama list   # skal vise tech-ai-monkey
```

### FFmpeg (videoanalyse)

- Last ned en Windows-bygg (f.eks. <https://www.gyan.dev/ffmpeg/builds/>,
  "release essentials") og legg `bin`-mappen på PATH, **eller** pakk ut til
  `C:\ffmpeg` (agenten leter der automatisk), **eller** sett `FFMPEG_DIR` i `.env`.
- Sjekk: `ffmpeg -version` og `ffprobe -version`.

### PostgreSQL

- Installer fra <https://www.postgresql.org/download/windows/> (EDB-installer).
- Husk passordet til `postgres`-superbrukeren — det trengs i punkt 4.

---

## 2. Hemmeligheter

Lag de to filene (de er git-ignored, aldri commit):

```powershell
Copy-Item .env.example .env
New-Item -ItemType File web/.env.local -Force
```

### `.env` (agenten)

```ini
AGENT_API_KEY_SECRET=<lang tilfeldig streng, f.eks. node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
EVE_PUBLIC_URL=http://127.0.0.1:2000
OLLAMA_MODEL=tech-ai-monkey
OLLAMA_BASE_URL=http://127.0.0.1:11434/v1
OLLAMA_API_KEY=auto-rotate
EVE_DEV=1
EVE_PERSIST_SANDBOX=1
```

### `web/.env.local` (web-appen)

```ini
AUTH_SECRET=<node -e "console.log(require('crypto').randomBytes(32).toString('base64'))">
SECRET_KEK=<samme måte, ny verdi>
AGENT_API_KEY_SECRET=<nøyaktig samme som i .env>
EVE_AGENT_URL=http://127.0.0.1:2000
NEXT_PUBLIC_APP_URL=http://127.0.0.1:3100
AUTH_URL=http://127.0.0.1:3100
# DATABASE_URL skrives automatisk av punkt 4.
```

---

## 3. Bygg begge appene

```powershell
powershell -ExecutionPolicy Bypass -File deploy\build.ps1
```

(eller manuelt: `npm.cmd install` + `npm.cmd run build` i rot, så i `web`.)

---

## 4. Database

```powershell
powershell -ExecutionPolicy Bypass -File deploy\setup-db.ps1
```

Skriptet oppretter rollen/databasen, skriver `DATABASE_URL` i `web/.env.local`
og kjører `drizzle-kit push`.

---

## 5. Start alt

```powershell
powershell -ExecutionPolicy Bypass -File deploy\start-all.ps1
```

Rekkefølge: **Ollama → agent → web** (hver avhengig av den forrige).

| Sjekk | Kommando |
|---|---|
| Agent | `curl.exe -s -o NUL -w "%{http_code}" http://127.0.0.1:2000/` |
| Web | `curl.exe -s -o NUL -w "%{http_code}" http://127.0.0.1:3100/download` |

Stopp alt: `powershell -ExecutionPolicy Bypass -File deploy\stop-all.ps1`

---

## 6. (Valgfritt) Publiser på tech-ai.tech med Cloudflare Tunnel

1. Last ned `cloudflared` for Windows: <https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/>
2. `cloudflared tunnel login` — velg sonen tech-ai.tech i nettleseren.
3. Opprett/pek tunnelen og la ingressen peke på `http://localhost:3100`.

Ingen porter må åpnes i ruteren; tunnelen tar HTTPS.

---

## Autostart som Windows-tjenester

For produksjon vil du kjøre agenten og web-appen som Windows-tjenester (i stedet
for konsollvinduer). Bruk **NSSM** (<https://nssm.cc>) eller **WinSW**:

```powershell
nssm install myai-agent  "C:\Program Files\nodejs\node.exe" "C:\sti\til\tech-ai-monkey\node_modules\eve\bin\eve.js start --host 127.0.0.1"
nssm set myai-agent AppDirectory "C:\sti\til\tech-ai-monkey"
nssm set myai-agent AppEnvironmentExtra "PORT=2000"
nssm start myai-agent
```

(Tilsvarende for `myai-web` med `next start -H 127.0.0.1` i `web`-mappa og `PORT=3100`.)

---

## Linux-spesifikt som IKKE trengs på Windows

- `deploy/*.sh` og systemd-tjenestene (`myai-*.service`) brukes ikke lenger —
  de er erstattet av `.ps1`-skriptene over. De ligger igjen for referanse.
- Microsandbox (KVM) trengs ikke: `scripts/patch-eve.mjs` bruker allerede en
  direkte lokal sandkasse, og den er nå gjort Git-Bash-kompatibel på Windows.
