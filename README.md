# Relativity AI Portfolio _(relativity-portfolio)_

Every investor has a style. We capture it.

AI powered stock market research.

Relativity AI Portfolio turns an investing style into something called an *investor agent* — a set of rules and guidelines that dictate how a stock should be evaluated. Once the agent is configured, the system delegates the research to AI and algorithms. No more endless screen time. No more scattered data. The portfolio does the digging. You do the deciding.

## Background

The name *Relativity* draws inspiration from Einsteins Theory of Relativity. A good investment to one person may be a bad one to another. It is all relative. Relativity AI Portfolio respects that truth — it does not pick stocks for you. It learns how you pick them, then works within those lines.

## Architecture

- **UI** (`ui/`) — React (Vite + Chakra) frontend on port 5173.
- **API** (`api/`) — in-repo Express + Vercel AI SDK backend on port 8080. Owns agents, runs analyses (quantitative scoring + LLM-driven qualitative agent tool-loop), and exposes the curated model list and metric catalog.
- **[Voyager](https://github.com/relativityAI/voyager)** — hosted data service (`https://voyager-1hpq.onrender.com`) that the API calls directly. The agent checks data availability/freshness and triggers data pull jobs (`POST /pull/trigger`) when data is stale, polling for status until `completed`.
- **Inngest** — durable workflow orchestration for multi-step analysis runs, background polling, and concurrency control.
- **Supabase / Postgres** — persistence for user agents, builder sessions, and analysis runs.

The UI talks only to `/api` (proxied to 8080). LLM and Voyager API keys are held in the browser and forwarded to the API as headers — never persisted server-side. The API forwards your Voyager key to the hosted service as `X-API-Key`.

## Install

### Setup

```bash
git clone https://github.com/relativityAI/relativity-portfolio.git
cd relativity-portfolio
docker compose up -d
```

Add `--build` to rebuild images after pulling changes.

This starts the UI (5173), the API (8080), MongoDB (27017), and Mongo Express (8081). The API targets the hosted Voyager service by default — no local Voyager is required. (A local `voyager` service is still defined in the compose file for self-hosting, but the API's `VOYAGER_URL` defaults to the hosted endpoint.)

For MongoDB Atlas, set the connection string before starting:

```bash
export MONGODB_URL='mongodb+srv://<user>:<password>@<cluster>.mongodb.net/'
export MONGODB_DB_NAME='relativity'
docker compose up -d
```

### Local development

Run MongoDB (e.g. `docker compose up -d mongo`), then:

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
- **Settings** — Store LLM provider API keys (sent to the backend as headers, never persisted server-side) and your Voyager API key. The Voyager endpoint is server-configured (`VOYAGER_URL`); the API reads it through the hosted service and only ever uses read-only endpoints.

## Contributing

Questions, bug reports, and feature requests are welcome via [GitHub Issues](https://github.com/relativityAI/relativity-portfolio/issues).

Pull requests are accepted. Keep the code style consistent and pass linting before submitting.

## License

UNLICENSED
