import "dotenv/config";
const test = async (sym: string) => {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=2y&interval=1d&includePrePost=false`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { "user-agent": "Mozilla/5.0 (compatible; RelativityPortfolio/1.0)" } });
    const j: any = await res.json();
    const r = j.chart?.result?.[0];
    console.log(`${sym}: http=${res.status} candles=${r?.timestamp?.length ?? 0} price=${r?.meta?.regularMarketPrice ?? null} err=${JSON.stringify(j.chart?.error ?? null).slice(0, 120)}`);
  } catch (e: any) {
    console.log(`${sym}: THREW ${e.message}`);
  }
};
await test("GLAND");
await test("GLAND.NS");
await test("RELIANCE.NS");
