import React from "react";
import { Box, Text, Table, Flex } from "@chakra-ui/react";
import ReactMarkdown from "react-markdown";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
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

export type ReportBlock =
  | { type: "heading"; level: 2 | 3; text: string }
  | { type: "paragraph"; text: string; citedKeys?: string[] }
  | { type: "table"; title?: string; columns: string[]; rows: (string | number)[][]; sourceKeys: string[] }
  | { type: "chart"; chartType: "bar" | "line" | "radar" | "area" | "scatter" | "pie"; title?: string; data: Record<string, string | number>[]; sourceKeys: string[] }
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
    <Box className="report-container">
      {blocks.map((block, idx) => (
        <Box key={idx} mb={5}>
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
          fontWeight={600}
          color="var(--ink-primary)"
          mt={block.level === 2 ? 6 : 4}
          mb={2}
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
            "& strong": { fontWeight: 600, color: "var(--ink-primary)" },
            "& em": { fontStyle: "italic" },
            "& code": { fontFamily: "var(--font-mono)", fontSize: "0.9em", background: "var(--surface-recessed)", borderRadius: "2px", px: "3px" },
          }}
        >
          <ReactMarkdown
            allowedElements={["p", "strong", "em", "code", "a", "br"]}
            unwrapDisallowed
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
    case "table":
      return (
        <Box my={6}>
          {block.title && (
            <Text fontSize="13px" fontWeight={600} color="var(--ink-secondary)" mb={2}>
              {block.title}
            </Text>
          )}
          <Box border="1px solid var(--hairline)" borderRadius="2px" overflowX="auto">
            <Table.Root size="sm" variant="line">
              <Table.Header bg="var(--surface-recessed)">
                <Table.Row>
                  {block.columns.map((col, i) => (
                    <Table.ColumnHeader
                      key={i}
                      fontSize="11px"
                      fontWeight={500}
                      letterSpacing="0.06em"
                      textTransform="uppercase"
                      color="var(--ink-tertiary)"
                      py={3}
                      px={4}
                    >
                      {col}
                    </Table.ColumnHeader>
                  ))}
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {block.rows.map((row, rIdx) => (
                  <Table.Row key={rIdx} _hover={{ bg: "var(--surface-recessed)" }}>
                    {row.map((cell, cIdx) => (
                      <Table.Cell
                        key={cIdx}
                        fontSize="13px"
                        color="var(--ink-primary)"
                        px={4}
                        py={2.5}
                        fontFamily={typeof cell === "number" ? "var(--font-tabular)" : "inherit"}
                        fontVariantNumeric={typeof cell === "number" ? "tabular-nums" : "normal"}
                      >
                        {cell}
                      </Table.Cell>
                    ))}
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          </Box>
          <EvidenceNote keys={block.sourceKeys} lookup={lookup} />
        </Box>
      );
    case "chart":
      return (
        <Box my={6} p={4} border="1px solid var(--hairline)" borderRadius="2px" bg="var(--surface-panel)">
          {block.title && (
            <Text fontSize="13px" fontWeight={600} color="var(--ink-primary)" mb={4}>
              {block.title}
            </Text>
          )}
          <Box h={block.chartType === "radar" ? "360px" : "300px"} w="100%">
            <ResponsiveContainer width="100%" height="100%">
              {renderRecharts(block)}
            </ResponsiveContainer>
          </Box>
          <EvidenceNote keys={block.sourceKeys} lookup={lookup} />
        </Box>
      );
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
      return (
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--hairline)" />
          <XAxis dataKey={xAxisKey} tick={{ fontSize: 11, fill: "var(--ink-tertiary)" }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: "var(--ink-tertiary)" }} axisLine={false} tickLine={false} />
          <RechartsTooltip contentStyle={{ backgroundColor: "var(--surface-floating)", border: "1px solid var(--hairline)", fontSize: "12px", borderRadius: "2px" }} />
          <Legend wrapperStyle={{ fontSize: "11px", color: "var(--ink-tertiary)" }} />
          {keys.map((k, i) => (
            <Line key={k} type="monotone" dataKey={k} stroke={colors[i % colors.length]} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
          ))}
        </LineChart>
      );
    case "area":
      return (
        <AreaChart data={data}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--hairline)" />
          <XAxis dataKey={xAxisKey} tick={{ fontSize: 11, fill: "var(--ink-tertiary)" }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: "var(--ink-tertiary)" }} axisLine={false} tickLine={false} />
          <RechartsTooltip contentStyle={{ backgroundColor: "var(--surface-floating)", border: "1px solid var(--hairline)", fontSize: "12px", borderRadius: "2px" }} />
          <Legend wrapperStyle={{ fontSize: "11px", color: "var(--ink-tertiary)" }} />
          {keys.map((k, i) => (
            <Area key={k} type="monotone" dataKey={k} fill={colors[i % colors.length]} stroke={colors[i % colors.length]} fillOpacity={0.3} />
          ))}
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
