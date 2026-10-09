import React from "react";
import { Box, Text, Flex } from "@chakra-ui/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  BarChart,
  Bar,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  AreaChart,
  Area,
  ScatterChart,
  Scatter,
  PieChart,
  Pie,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Legend,
  Cell
} from "recharts";
import { MdFormatQuote, MdInfo, MdCheckCircle, MdWarning, MdError } from "react-icons/md";
import { MarketChart, type MarketChartVariant } from "./MarketChart";

export type ReportBlock =
  | { type: "heading"; level: 2 | 3; text: string }
  | { type: "paragraph"; text: string; citedKeys?: string[] }
  | { type: "table"; title?: string; columns: string[]; rows: (string | number)[][]; sourceKeys: string[] }
  | { type: "chart"; chartType: "bar" | "line" | "radar" | "area" | "scatter" | "pie" | "candlestick"; title?: string; data: Record<string, string | number>[]; sourceKeys: string[] }
  | { type: "callout"; tone: "positive" | "caution" | "negative" | "neutral"; text: string }
  | { type: "quote"; text: string; attribution?: string };

interface ReportBlockRendererProps {
  blocks: ReportBlock[];
  /**
   * Optional map from metric/parameter key → human line ("PE < 20 → 14.2 · score 70")
   * used to render citedKeys/sourceKeys as concrete data-point captions.
   */
  lookup?: Record<string, string>;
}

export function ReportBlockRenderer({ blocks, lookup }: ReportBlockRendererProps) {
  return (
    <Box className="report-container" style={{ fontFamily: "var(--font-body)" }}>
      {blocks.map((block, idx) => (
        <Box key={idx} mb={block.type === "paragraph" ? 3 : block.type === "heading" ? 2 : 5}>
          {renderBlock(block, lookup)}
        </Box>
      ))}
    </Box>
  );
}

function EvidenceNote({ keys, lookup }: { keys?: string[]; lookup?: Record<string, string> }) {
  const resolved = (keys || []).filter((k) => k !== "scored_data");
  if (resolved.length === 0) return null;
  return (
    <Text mt={1.5} fontSize="11px" color="var(--ink-tertiary)" lineHeight="1.4">
      Based on: {resolved.map((k) => lookup?.[k] ?? k).join(" · ")}
    </Text>
  );
}

function renderBlock(block: ReportBlock, lookup?: Record<string, string>) {
  switch (block.type) {
    case "heading":
      return (
        <Text
          as={block.level === 2 ? "h2" : "h3"}
          fontSize={block.level === 2 ? "20px" : "16px"}
          fontFamily="var(--font-display)"
          fontWeight={600}
          color="var(--ink-primary)"
          mt={block.level === 2 ? 4 : 3}
          mb={1.5}
        >
          {block.text}
        </Text>
      );
    case "paragraph":
      return (
        <Text
          as="div"
          fontSize="14px"
          lineHeight="1.6"
          color="var(--ink-secondary)"
          css={{
            "& p": { margin: "0 0 0.6em" },
            "& p:last-of-type": { marginBottom: 0 },
            "& ul, & ol": { margin: "0.5em 0 0.8em", paddingLeft: "1.6em" },
            "& ul": { listStyleType: "disc" },
            "& ol": { listStyleType: "decimal" },
            "& li": { paddingLeft: "0.2em", margin: "0.2em 0" },
            // Markdown headings: Newsreader face, browser-default scale (# 2em, ## 1.5em, ### 1.17em, #### 1em).
            "& h1, & h2, & h3, & h4": { color: "var(--ink-primary)", fontWeight: 600, fontFamily: "var(--font-display)", lineHeight: 1.25, margin: "1em 0 0.4em" },
            "& h1": { fontSize: "2em" },
            "& h2": { fontSize: "1.5em" },
            "& h3": { fontSize: "1.17em" },
            "& h4": { fontSize: "1em" },
            "& table": { borderCollapse: "collapse", display: "block", maxWidth: "100%", overflowX: "auto", margin: "0.8em 0" },
            "& th, & td": { border: "1px solid var(--hairline)", padding: "0.4em 0.65em", textAlign: "left" },
            "& th": { color: "var(--ink-primary)", fontWeight: 600 },
            "& blockquote": { borderLeft: "3px solid var(--hairline)", margin: "0.8em 0", paddingLeft: "1em" },
            // NOTE: no white-space:pre-wrap here — react-markdown emits "\n"
            // text nodes between block elements; pre-wrap renders each one as
            // a visible blank line. Soft line breaks are handled by markdown.
            "& a": { color: "var(--accent-primary)" },
            "& strong": { fontWeight: 600, color: "var(--ink-primary)" },
            "& em": { fontStyle: "italic" },
            "& code": { fontFamily: "var(--font-mono)", fontSize: "0.9em", background: "var(--surface-recessed)", borderRadius: "2px", px: "3px" },
          }}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
          >
            {block.text}
          </ReactMarkdown>
          <EvidenceNote keys={block.citedKeys} lookup={lookup} />
        </Text>
      );
    case "callout": {
      let icon = <MdInfo size={18} />;
      let bg = "var(--surface-recessed)";
      let color = "var(--ink-secondary)";
      let borderLeft = "3px solid var(--hairline)";

      if (block.tone === "positive") {
        icon = <MdCheckCircle size={18} />;
        borderLeft = "3px solid var(--signal-positive)";
        color = "var(--ink-primary)";
      } else if (block.tone === "caution") {
        icon = <MdWarning size={18} />;
        borderLeft = "3px solid var(--signal-caution)";
        color = "var(--ink-primary)";
      } else if (block.tone === "negative") {
        icon = <MdError size={18} />;
        borderLeft = "3px solid var(--signal-negative)";
        color = "var(--ink-primary)";
      }

      return (
        <Flex
          bg={bg}
          p={4}
          borderLeft={borderLeft}
          borderRadius="2px"
          align="flex-start"
          gap={3}
        >
          <Box color={color} mt="2px">{icon}</Box>
          <Text fontSize="13px" color={color} lineHeight="1.5">
            {block.text}
          </Text>
        </Flex>
      );
    }
    case "quote":
      return (
        <Box pl={4} borderLeft="3px solid var(--accent-primary)" py={1}>
          <Text fontSize="14px" fontStyle="italic" color="var(--ink-primary)" lineHeight="1.5">
            {`"${block.text}"`}
          </Text>
          {block.attribution && (
            <Text fontSize="12px" color="var(--ink-tertiary)" mt={2}>
              — {block.attribution}
            </Text>
          )}
        </Box>
      );
    case "table": {
      // Column is "numeric" when every cell is a number → right-aligned,
      // tabular figures (mirrors the reference table demo).
      const numericCol = (c: number) => block.rows.length > 0 && block.rows.every((r) => typeof r[c] === "number");
      return (
        <Box my={6}>
          {block.title && (
            <Text fontSize="13px" fontWeight={600} color="var(--ink-secondary)" mb={2}>
              {block.title}
            </Text>
          )}
          <div className="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  {block.columns.map((col, i) => (
                    <TableHead key={i} className={numericCol(i) ? "text-right" : ""}>{col}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {block.rows.map((row, rIdx) => (
                  <TableRow key={rIdx}>
                    {row.map((cell, cIdx) => (
                      <TableCell
                        key={cIdx}
                        className={cn(
                          cIdx === 0 && "font-medium",
                          numericCol(cIdx) && "text-right tabular-nums"
                        )}
                      >
                        {cell}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <EvidenceNote keys={block.sourceKeys} lookup={lookup} />
        </Box>
      );
    }
    case "chart": {
      // Date-keyed rows are market series (OHLCV, price+SMA, RSI,
      // volume-over-time) — those get the TradingView treatment.
      // Everything else (radar, pie, categorical bars keyed by
      // `name`) stays on recharts.
      const firstRow = block.data?.[0];
      const isMarketSeries = firstRow != null && "date" in firstRow;
      const marketVariant: MarketChartVariant =
        block.chartType === "candlestick" ? "candle" : block.chartType === "bar" ? "volume" : "line";
      // Line/area charts plot straight onto the page — no card chrome.
      const flat = block.chartType === "line" || block.chartType === "area" || (isMarketSeries && marketVariant === "line");
      const inner = (
        <>
          {block.title && (
            <Text fontSize="13px" fontWeight={600} color="var(--ink-primary)" mb={4}>
              {block.title}
            </Text>
          )}
          {isMarketSeries ? (
            <MarketChart data={block.data} variant={marketVariant} height={block.chartType === "candlestick" ? 360 : 320} title={block.title} />
          ) : (
            <Box h={block.chartType === "radar" ? "360px" : "300px"} w="100%">
              <ResponsiveContainer width="100%" height="100%">
                {renderRecharts(block)}
              </ResponsiveContainer>
            </Box>
          )}
          <EvidenceNote keys={block.sourceKeys} lookup={lookup} />
        </>
      );
      return (
        <Box my={6} {...(flat ? {} : { p: 4, border: "1px solid var(--hairline)", borderRadius: "2px", bg: "var(--card)" })}>
          {inner}
        </Box>
      );
    }
    default:
      return null;
  }
}

function renderRecharts(block: Extract<ReportBlock, { type: "chart" }>) {
  const data = block.data || [];
  if (data.length === 0) return <></>;
  
  const keys = Object.keys(data[0]).filter(k => k !== "name" && k !== "label");
  const xAxisKey = Object.keys(data[0]).includes("name") ? "name" : Object.keys(data[0]).includes("label") ? "label" : Object.keys(data[0])[0];
  
  const colors = ["#5B7FDE", "#4C8B6B", "#B8935A", "#8FA0C8", "#B85C5C"];

  switch (block.chartType) {
    case "bar":
      return (
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--hairline)" />
          <XAxis dataKey={xAxisKey} tick={{ fontSize: 11, fill: "var(--ink-tertiary)" }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: "var(--ink-tertiary)" }} axisLine={false} tickLine={false} />
          <RechartsTooltip contentStyle={{ backgroundColor: "var(--surface-floating)", border: "1px solid var(--hairline)", fontSize: "12px", borderRadius: "2px" }} />
          <Legend wrapperStyle={{ fontSize: "11px", color: "var(--ink-tertiary)" }} />
          {keys.map((k, i) => (
            <Bar key={k} dataKey={k} fill={colors[i % colors.length]} radius={[2, 2, 0, 0]} />
          ))}
        </BarChart>
      );
    case "line":
    case "area":
      // Fill under the line: 35% at the line → 8% at the axis (fades,
      // never to zero). Gradient id derives from the color, so duplicate
      // ids across charts always carry identical stops.
      return (
        <AreaChart data={data}>
          <defs>
            {keys.map((k, i) => {
              const c = colors[i % colors.length];
              return (
                <linearGradient key={k} id={`area-${c.slice(1)}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={c} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={c} stopOpacity={0.08} />
                </linearGradient>
              );
            })}
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--hairline)" />
          <XAxis dataKey={xAxisKey} tick={{ fontSize: 11, fill: "var(--ink-tertiary)" }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: "var(--ink-tertiary)" }} axisLine={false} tickLine={false} />
          <RechartsTooltip contentStyle={{ backgroundColor: "var(--surface-floating)", border: "1px solid var(--hairline)", fontSize: "12px", borderRadius: "2px" }} />
          <Legend wrapperStyle={{ fontSize: "11px", color: "var(--ink-tertiary)" }} />
          {keys.map((k, i) => {
            const c = colors[i % colors.length];
            return (
              <Area key={k} type="monotone" dataKey={k} stroke={c} strokeWidth={2} fill={`url(#area-${c.slice(1)})`} dot={{ r: 3 }} activeDot={{ r: 5 }} />
            );
          })}
        </AreaChart>
      );
    case "radar":
      return (
        <RadarChart data={data} outerRadius="80%">
          <PolarGrid stroke="var(--hairline)" />
          <PolarAngleAxis dataKey={xAxisKey} tick={{ fontSize: 10, fill: "var(--ink-secondary)" }} />
          <PolarRadiusAxis angle={30} domain={[0, 'dataMax']} tick={{ fontSize: 10, fill: "var(--ink-tertiary)" }} />
          <RechartsTooltip contentStyle={{ backgroundColor: "var(--surface-floating)", border: "1px solid var(--hairline)", fontSize: "12px", borderRadius: "2px" }} />
          <Legend wrapperStyle={{ fontSize: "11px", color: "var(--ink-tertiary)" }} />
          {keys.map((k, i) => (
            <Radar key={k} name={k} dataKey={k} stroke={colors[i % colors.length]} fill={colors[i % colors.length]} fillOpacity={0.4} />
          ))}
        </RadarChart>
      );
    case "scatter":
      return (
        <ScatterChart>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--hairline)" />
          <XAxis type="number" dataKey={xAxisKey} name={xAxisKey} tick={{ fontSize: 11, fill: "var(--ink-tertiary)" }} axisLine={false} tickLine={false} />
          <YAxis type="number" dataKey={keys[0]} name={keys[0]} tick={{ fontSize: 11, fill: "var(--ink-tertiary)" }} axisLine={false} tickLine={false} />
          <RechartsTooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ backgroundColor: "var(--surface-floating)", border: "1px solid var(--hairline)", fontSize: "12px", borderRadius: "2px" }} />
          <Legend wrapperStyle={{ fontSize: "11px", color: "var(--ink-tertiary)" }} />
          <Scatter name="Data" data={data} fill={colors[0]} />
        </ScatterChart>
      );
    case "pie":
      return (
        <PieChart>
          <Pie data={data} dataKey={keys[0] || "value"} nameKey={xAxisKey} outerRadius="80%" label>
            {data.map((_, i) => (
              <Cell key={i} fill={colors[i % colors.length]} />
            ))}
          </Pie>
          <RechartsTooltip contentStyle={{ backgroundColor: "var(--surface-floating)", border: "1px solid var(--hairline)", fontSize: "12px", borderRadius: "2px" }} />
          <Legend wrapperStyle={{ fontSize: "11px", color: "var(--ink-tertiary)" }} />
        </PieChart>
      );
    default:
      return null;
  }
}
