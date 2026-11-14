/**
 * Human summaries for tool calls.
 *
 * A trace line like `fs_write path=knowledge_base/t1-trend/s3.md content=…`
 * tells a reader nothing. These summaries are what the live timeline shows:
 * "Adding note: Trend and Structure", "Searching workspace: RSI". One place,
 * used by the loop for every tool it executes.
 */

function str(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  return typeof v === "string" && v ? v : "";
}

/** `knowledge_base/t1-trend-and-structure/s3.md` → "Trend and Structure" */
export function kbTaskFromPath(path: string): string {
  const m = path.match(/knowledge_base\/(?:t\d+-)?([^/]+)\/s\d+\.md$/);
  if (!m) return "";
  return m[1]
    .split("-")
    .map((w) => (w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

export function describeToolCall(tool: string, args: unknown): string {
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const symbol = str(a, "symbol");

  switch (tool) {
    case "todo_write":
      return "Updating plan";
    case "fs_write": {
      const path = str(a, "path");
      const task = kbTaskFromPath(path);
      if (task) return `Adding note: ${task}`;
      if (path.startsWith("/workspace/report/sections/")) return "Saving report section";
      if (path === "/workspace/plan.json" || path === "/workspace/plan.md") return "Updating plan";
      return `Writing ${path.replace(/^\//, "")}`;
    }
    case "fs_append": {
      const path = str(a, "path");
      if (path === "/workspace/plan.json" || path === "/workspace/plan.md") return "Updating plan";
      return `Appending to ${path.replace(/^\//, "")}`;
    }
    case "fs_read": {
      const path = str(a, "path");
      if (path.startsWith("/knowledge_base/sources/")) {
        // Readable archive names: KEI_get_price_history_weekly.json → "Reading source: KEI get price history weekly"
        const m = path.match(/\/knowledge_base\/sources\/(?:raw\/)?([^.]+)\.json$/);
        return m ? `Reading source: ${m[1].replace(/_/g, " ")}` : "Reading archived source";
      }
      if (path.startsWith("/index.md")) return "Reading workspace index";
      const task = kbTaskFromPath(path);
      return task ? `Reading note: ${task}` : `Reading ${path.replace(/^\//, "")}`;
    }
    case "fs_ls": {
      const path = str(a, "path");
      if (path.startsWith("/knowledge_base")) return "Listing knowledge base";
      return "Listing workspace files";
    }
    case "fs_grep": {
      const q = str(a, "query");
      return q ? `Searching workspace: ${q.slice(0, 60)}` : "Searching workspace";
    }
    default:
      break;
  }

  if (/price|candle|ohlc/i.test(tool)) return symbol ? `Fetching price history: ${symbol}` : "Fetching price history";
  if (/indicator|rsi|macd|adx|bband|sma|ema/i.test(tool)) return symbol ? `Fetching indicators: ${symbol}` : "Fetching indicators";
  if (/technical/i.test(tool)) return symbol ? `Fetching technicals: ${symbol}` : "Fetching technicals";
  if (/fundamental|financial|balance|income|earning/i.test(tool)) return symbol ? `Fetching fundamentals: ${symbol}` : "Fetching fundamentals";
  if (/news|headline|sentiment/i.test(tool)) return symbol ? `Fetching news: ${symbol}` : "Fetching news";
  if (/search|web/i.test(tool)) {
    const q = str(a, "query");
    return q ? `Web search: ${q.slice(0, 60)}` : "Web search";
  }
  if (/profile|company/i.test(tool)) return symbol ? `Company profile: ${symbol}` : "Company profile";
  const pretty = tool.replace(/_/g, " ");
  return symbol ? `${pretty} (${symbol})` : pretty;
}
