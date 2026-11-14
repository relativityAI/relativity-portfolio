import { readFileSync } from "node:fs";
import path from "node:path";
import { config } from "./config.js";

export interface StockRow {
  SYMBOL: string;
  NAME: string;
  ticker: string;
  name: string;
  exchange: string;
  source: string;
  country: string;
}

interface CsvData {
  headers: string[];
  rows: Record<string, string>[];
}

function parseCsv(filePath: string): CsvData {
  const text = readFileSync(filePath, "utf8").replace(/\r/g, "");
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  const headers = lines[0].split(",").map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = (values[idx] ?? "").trim();
    });
    if (row[headers[0]]) rows.push(row);
  }
  return { headers, rows };
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

let nseRows: Record<string, string>[] | null = null;
let secRows: Record<string, string>[] | null = null;
let sourceRows: Record<string, string>[] | null = null;

function nse(): Record<string, string>[] {
  if (!nseRows) {
    nseRows = parseCsv(path.join(config.assetsDir, "nse-equities.csv")).rows;
  }
  return nseRows;
}

function sec(): Record<string, string>[] {
  if (!secRows) {
    secRows = parseCsv(path.join(config.assetsDir, "sec-equities.csv")).rows;
  }
  return secRows;
}

function sources(): Record<string, string>[] {
  if (!sourceRows) {
    sourceRows = parseCsv(path.join(config.assetsDir, "sources.csv")).rows;
  }
  return sourceRows;
}

export function getSources(): { SYMBOL: string; NAME: string }[] {
  return sources().map((r) => ({
    SYMBOL: r.SYMBOL || r.ticker || "",
    NAME: r.NAME || r.name || "",
  }));
}

export function searchStocks(query: string, source?: string): StockRow[] {
  const q = (query || "").trim().toLowerCase();
  const matches: StockRow[] = [];
  const wantNse = source === "NSE";
  const wantSec = source === "SEC";
  const both = !source;

  const check = (rows: Record<string, string>[], src: string) => {
    for (const r of rows) {
      const symbol = (r.SYMBOL || r.ticker || "").toLowerCase();
      const name = (r.NAME || r.name || "").toLowerCase();
      if (q && !symbol.includes(q) && !name.includes(q)) continue;
      matches.push({
        SYMBOL: r.SYMBOL || r.ticker || "",
        NAME: r.NAME || r.name || "",
        ticker: r.ticker || r.SYMBOL || "",
        name: r.name || r.NAME || "",
        exchange: r.exchange || (src === "nse" ? "NSE" : ""),
        source: src,
        country: src === "nse" ? "in" : "us",
      });
      if (matches.length >= 25) break;
    }
  };

  if (wantNse || both) {
    check(nse(), "nse");
  }
  if (wantSec || both) {
    check(sec(), "sec");
  }
  return matches.slice(0, 25);
}
