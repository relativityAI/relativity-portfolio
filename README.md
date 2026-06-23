# Relativity AI Portfolio _(relativity-portfolio)_

Every investor has a style. We capture it.

AI powered stock market research.

Relativity AI Portfolio turns an investing style into something called an *investor profile* — a set of rules and guidelines that dictate how a stock should be evaluated. Once the profile is set, the system delegates the research to AI and algorithms. No more endless screen time. No more scattered data. The portfolio does the digging. You do the deciding.

## Background

The name *Relativity* draws inspiration from Einsteins Theory of Relativity. A good investment to one person may be a bad one to another. It is all relative. Relativity AI Portfolio respects that truth — it does not pick stocks for you. It learns how you pick them, then works within those lines.

## Install

### Dependencies

These services are pulled automatically by Docker Compose:

- [Voyager](https://github.com/relativityAI/voyager) — data ingestion
- [Nebula](https://github.com/relativityAI/nebula) — analysis and computation

### Setup

```bash
git clone https://github.com/relativityAI/relativity-portfolio.git
cd relativity-portfolio
docker compose up -d
```

Add `--build` to rebuild images after pulling changes.

This starts the UI (port 5173), Voyager (8001), Nebula (8002), MongoDB (27017), and Mongo Express (8081).

## Usage

Open [http://localhost:5173](http://localhost:5173).

- **Profiles** — Define investor profiles with qualitative and quantitative criteria.
- **Analysis** — Run AI-driven analysis on stocks and view results.
- **Research** — Search and screen equities using exchange data.
- **Portfolios** — Track and snapshot portfolio positions.
- **Data Sources** — Manage integrated data sources.

## Contributing

Questions, bug reports, and feature requests are welcome via [GitHub Issues](https://github.com/relativityAI/relativity-portfolio/issues).

Pull requests are accepted. Keep the code style consistent and pass linting before submitting.

## License

UNLICENSED
