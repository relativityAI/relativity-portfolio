# Relativity AI Portfolio _(relativity-portfolio)_

Every investor has a style. We capture it.

AI powered stock market research.

Relativity AI Portfolio turns an investing style into something called an *investor agent* — a set of rules and guidelines that dictate how a stock should be evaluated. Once the agent is configured, the system delegates the research to AI and algorithms. No more endless screen time. No more scattered data. The portfolio does the digging. You do the deciding.

## Background

The name *Relativity* draws inspiration from Einsteins Theory of Relativity. A good investment to one person may be a bad one to another. It is all relative. Relativity AI Portfolio respects that truth — it does not pick stocks for you. It learns how you pick them, then works within those lines.

## Architecture

- **UI** (`ui/`) — React (Vite + Chakra) frontend on port 5173.
- **API** (`api/`) — in-repo Express + Vercel AI SDK backend on port 8080. Owns agents, runs analyses (quantitative scoring + LLM-driven qualitative agent tool-loop), and exposes the curated model list and metric catalog.
- **[Voyager](https://github.com/relativityAI/voyager)** — hosted data service (`https://voyager-api-0csb.onrender.com`) that the API calls directly. The agent checks data availability/freshness and triggers data pull jobs (`POST /pull/trigger`) when data is stale, polling for status until `completed`.
- **Inngest** — durable workflow orchestration for multi-step analysis runs, background polling, and concurrency control.
- **Supabase / Postgres** — persistence for user agents, builder sessions, and analysis runs.

The UI talks only to `/api` (proxied to 8080). LLM and Voyager API keys are stored server-side, encrypted at rest (AES-256-GCM) — they are never persisted in the browser. The API forwards your Voyager key to the hosted service as `X-API-Key`.

## Install

### Setup

The stack requires a Supabase project (Postgres, auth, and key storage) — there is no bundled local database. Configure it before starting:

```bash
git clone https://github.com/relativityAI/relativity-portfolio.git
cd relativity-portfolio
export SUPABASE_PROJECT_URL='https://<project>.supabase.co'
export SUPABASE_URL='https://<project>.supabase.co'
export SUPABASE_SERVICE_ROLE_KEY='<service-role-key>'
export ENCRYPTION_KEY='<64-hex-char key>'
export VITE_SUPABASE_URL='https://<project>.supabase.co'
export VITE_SUPABASE_ANON_KEY='<anon-key>'
docker compose up -d
```

Add `--build` to rebuild images after pulling changes.

This starts the UI (5173) and the API (8080). The API targets the hosted Voyager service by default — no local Voyager is required. Inngest handles run orchestration when `INNGEST_EVENT_KEY` is set; without it, runs execute locally in the API process.

See `api/.env.example` for the full list of supported environment variables (Voyager admin key, optional server-side LLM key pools, Langfuse, etc.).

### Local development

A Supabase project (or its env vars) is required for the API to start, then:

```bash
# API (port 8080)
cd api
cp .env.example .env   # optional
npm install
npm run dev

# UI (port 5173)
cd ui
npm install
npm run dev
```

## Usage

Open [http://localhost:5173](http://localhost:5173).

- **New Analysis** — Pick a source (SEC/NSE), search a company, choose an agent and a model, then run. Data is fetched automatically.
- **Agents** — Create and configure agents with qualitative and quantitative criteria (operators, thresholds, weightage).
- **Analysis** — Browse previous runs and open full reports.
- **Settings** — Store LLM provider API keys and your Voyager API key. Keys are stored server-side, encrypted at rest (AES-256-GCM), and never returned unmasked to the browser. The Voyager endpoint is server-configured (`VOYAGER_URL`); the API reads it through the hosted service and only ever uses read-only endpoints.

## Contributing

Questions, bug reports, and feature requests are welcome via [GitHub Issues](https://github.com/relativityAI/relativity-portfolio/issues).

Pull requests are accepted. Keep the code style consistent and pass linting before submitting.

## License

UNLICENSED
