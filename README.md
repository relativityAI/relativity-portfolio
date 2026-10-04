# Relativity AI Portfolio _(relativity-portfolio)_

Every investor has a style. We capture it.

AI powered stock market research.

Relativity AI Portfolio turns an investing style into something called an *investor agent* — a set of rules and guidelines that dictate how a stock should be evaluated. Once the agent is configured, the system delegates the research to AI and algorithms. No more endless screen time. No more scattered data. The portfolio does the digging. You do the deciding.

## Background

The name *Relativity* draws inspiration from Einsteins Theory of Relativity. A good investment to one person may be a bad one to another. It is all relative. Relativity AI Portfolio respects that truth — it does not pick stocks for you. It learns how you pick them, then works within those lines.

## Architecture

- **UI** (`ui/`) — React (Vite + Chakra) frontend on port 5173.
- **API** (`api/`) — in-repo Express + Vercel AI SDK backend on port 8080. Owns agents, skills, and one-call skill summaries, and exposes the curated model list and skill library.
- **[Voyager](https://github.com/relativityAI/voyager)** — hosted data service (`https://voyager-api-0csb.onrender.com`) used by the API for data availability and pull-status checks.
- **Market data** — server-side Yahoo Finance chart client (`api/src/marketdata.ts`) for daily OHLCV + SMA/RSI indicators, powering the technical-analysis skill's candlestick charts.
- **Inngest** — background document ingestion.
- **Supabase / Postgres** — persistence for user agents, custom skills, builder sessions, and analysis runs.

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

This starts the UI (5173) and the API (8080). The API targets the hosted Voyager service by default — no local Voyager is required. Inngest handles background document ingestion when configured.

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

- **New Analysis** — In skill mode, pick a source (SEC/NSE), company, skill, and model. The LLM summarizes the skill using only its definition and the stock identity; no market data or tools are used. Agent runs are currently unavailable.
- **Agents** — Create agents from metadata + investment philosophy + **skills**: attach built-in skills (DCF valuation, moat analysis, technical analysis, …) with per-skill weights, or draft custom skills in the AI chat. Every agent is a set of skills.
- **Skills** — The library ships built-in skills across valuation, fundamentals, qualitative, market, and macro categories. Add them to agents, or write your own by hand or with AI; custom skills validate against the editor's skill format.
- **Analysis** — Browse saved runs and view skill summaries.
- **Settings** — Store LLM provider API keys and your Voyager API key. Keys are stored server-side, encrypted at rest (AES-256-GCM), and never returned unmasked to the browser.

## The skill format

A skill is a markdown document with frontmatter (`id`, `name`, `description`, `category`, `version`) and sections: **Purpose**, **Data** (which tools it may call), **Method** (analysis steps), **Verdict Anchors** (weighted YES/PARTIAL/NO checklist), **Charts** (declarative plot specs), **Output Template**. The LLM gathers evidence and gives verdicts; code computes every score. See `api/config/skills/` for the built-in set and `docs/2026-09-26-analysis-redesign-decisions.md` for the full design rationale.

## Contributing

Questions, bug reports, and feature requests are welcome via [GitHub Issues](https://github.com/relativityAI/relativity-portfolio/issues).

Pull requests are accepted. Keep the code style consistent and pass linting before submitting.

## License

UNLICENSED
