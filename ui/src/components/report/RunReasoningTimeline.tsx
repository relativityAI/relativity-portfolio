/**
 * RunReasoningTimeline — the live agent-reasoning feed for harness runs.
 *
 * Renders the enriched trace (harness/errors.ts + tools/describe.ts produce
 * the human summaries; canvas/run.ts emits phase markers) as a phased
 * timeline: one section per pipeline phase, one row per action with a lucide
 * icon, human label, and time spent. Thinking deltas render as expandable
 * italic blocks. Rows stay stable across polls — tool results resolve into
 * their pending call row by tool_call_id.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Flex, Text, Spinner } from "@chakra-ui/react";
import {
    Brain,
    CheckCircle2,
    ClipboardList,
    Database,
    FileText,
    FlaskConical,
    FolderTree,
    Gauge,
    Globe,
    Info,
    Layers,
    Newspaper,
    NotebookPen,
    PenLine,
    Search,
    XCircle,
    type LucideIcon,
} from "lucide-react";
import type { TraceEvent } from "@/pages/shared/TracePanel";

/* ─── Row model ─────────────────────────────────────────────────────────── */

type Status = "running" | "ok" | "error";

interface ActionRow {
    kind: "action";
    id: string;
    Icon: LucideIcon;
    label: string;
    status: Status;
    durationMs?: number;
    detail?: string;
    error?: string;
}
interface ThinkingRow {
    kind: "thinking";
    text: string;
}
interface NoteRow {
    kind: "note";
    text: string;
}
type Row = ActionRow | ThinkingRow | NoteRow;

interface Group {
    label: string;
    detail?: string;
    Icon: LucideIcon;
    rows: Row[];
}

const PHASE_META: Record<string, { Icon: LucideIcon; label: string }> = {
    plan: { Icon: ClipboardList, label: "Planning" },
    research: { Icon: FlaskConical, label: "Researching" },
    compose: { Icon: PenLine, label: "Writing sections" },
    assemble: { Icon: Layers, label: "Assembling" },
};

function toolMeta(tool: string, summary?: string): { Icon: LucideIcon; label: string } {
    if (tool.startsWith("fs_write")) return { Icon: NotebookPen, label: summary || "Writing to the workspace" };
    if (tool.startsWith("fs_read")) return { Icon: FileText, label: summary || "Reading workspace file" };
    if (tool.startsWith("fs_grep")) return { Icon: Search, label: summary || "Searching the workspace" };
    if (tool.startsWith("fs_ls")) return { Icon: FolderTree, label: summary || "Listing workspace files" };
    if (/news|headline/i.test(tool)) return { Icon: Newspaper, label: summary || "Fetching news" };
    if (/search|web|tavily/i.test(tool)) return { Icon: Globe, label: summary || "Web search" };
    if (/score|decision|rank/i.test(tool)) return { Icon: Gauge, label: summary || tool };
    if (/price|candle|indicator|technical|financial|fundamental|ohlc/i.test(tool)) return { Icon: Database, label: summary || "Fetching market data" };
    return { Icon: Database, label: summary || tool.replace(/_/g, " ") };
}

function buildGroups(events: TraceEvent[]): Group[] {
    const groups: Group[] = [];
    let current: Group | null = null;
    const ensure = (): Group => {
        if (!current) {
            current = { label: "", Icon: Info, rows: [] };
            groups.push(current);
        }
        return current;
    };
    const pending = new Map<string, ActionRow>();

    for (const ev of [...events].sort((a, b) => a.seq - b.seq)) {
        switch (ev.type) {
            case "phase": {
                const meta = PHASE_META[ev.phase ?? ""];
                current = {
                    label: ev.label || meta?.label || ev.phase || "",
                    detail: ev.detail,
                    Icon: meta?.Icon ?? Info,
                    rows: [],
                };
                groups.push(current);
                break;
            }
            case "thought": {
                const text = (ev.text || "").trim();
                // The final compose message is the report JSON — already
                // rendered as the report; never dump it into the feed.
                if (!text || (text.startsWith("{") && text.includes('"schema"'))) break;
                const g = ensure();
                const last = g.rows[g.rows.length - 1];
                if (last?.kind === "thinking") last.text += text;
                else g.rows.push({ kind: "thinking", text });
                break;
            }
            case "tool_call": {
                const g = ensure();
                const { Icon, label } = toolMeta(ev.tool || "", ev.summary);
                const row: ActionRow = {
                    kind: "action",
                    id: ev.tool_call_id || `${ev.tool}-${ev.seq}`,
                    Icon,
                    label,
                    status: "running",
                };
                g.rows.push(row);
                if (ev.tool_call_id) pending.set(ev.tool_call_id, row);
                break;
            }
            case "tool_result": {
                const g = ensure();
                const row =
                    (ev.tool_call_id && pending.get(ev.tool_call_id)) ||
                    (() => {
                        for (let i = g.rows.length - 1; i >= 0; i--) {
                            const r = g.rows[i];
                            if (r.kind === "action" && r.status === "running") return r;
                        }
                        return undefined;
                    })();
                const failed = ev.status === "ERR" || ev.status === "error";
                if (row) {
                    row.status = failed ? "error" : "ok";
                    row.durationMs = ev.duration_ms;
                    if (failed) row.error = ev.summary || "Call failed";
                } else {
                    g.rows.push({ kind: "note", text: `${ev.tool} → ${ev.status}` });
                }
                break;
            }
            case "canvas_block": {
                const g = ensure();
                const done = ev.status === "done";
                g.rows.push({
                    kind: "action",
                    id: ev.tool_call_id || `cb-${ev.seq}`,
                    Icon: done ? CheckCircle2 : XCircle,
                    label: ev.label
                        ? done
                            ? `${ev.label} — ${ev.summary || "section written"}`
                            : `${ev.label} — not written`
                        : ev.summary || (done ? "Section written" : "Section failed"),
                    status: done ? "ok" : "error",
                    durationMs: ev.duration_ms,
                    error: done ? undefined : ev.error,
                });
                break;
            }
            case "decision":
                ensure().rows.push({
                    kind: "note",
                    text: `Decision${ev.score != null ? ` ${Number(ev.score).toFixed(0)}` : ""}${ev.text ? ` — ${ev.text}` : ""}`,
                });
                break;
            case "log":
                if (ev.text?.trim()) ensure().rows.push({ kind: "note", text: ev.text });
                break;
            default:
                break;
        }
    }
    return groups.filter((g) => g.rows.length > 0 || g.label);
}

function fmtDur(ms: number): string {
    if (ms < 1000) return `${Math.max(1, Math.round(ms))}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    const m = Math.floor(ms / 60_000);
    const s = Math.round((ms % 60_000) / 1000);
    return `${m}m ${String(s).padStart(2, "0")}s`;
}

/* ─── Thinking block ────────────────────────────────────────────────────── */

const COLLAPSED_MAX = 240;

function ThinkingBlock({ text }: { text: string }) {
    const [open, setOpen] = useState(false);
    const long = text.length > COLLAPSED_MAX;
    const shown = open || !long ? text : `${text.slice(0, COLLAPSED_MAX)}…`;
    return (
        <Flex align="flex-start" gap={2.5} py={1} pl={0.5}>
            <Box mt="3px" color="var(--ink-tertiary)" flexShrink={0}>
                <Brain size={13} />
            </Box>
            <Box minW={0} flex={1}>
                <Text fontSize="11px" fontWeight={600} color="var(--ink-tertiary)" letterSpacing="0.04em" textTransform="uppercase" mb={0.5}>
                    Thinking
                </Text>
                <Text fontSize="12.5px" lineHeight={1.6} color="var(--ink-secondary)" fontStyle="italic" whiteSpace="pre-wrap" wordBreak="break-word">
                    {shown}
                </Text>
                {long && (
                    <Text
                        as="button"
                        onClick={() => setOpen((v) => !v)}
                        fontSize="11.5px"
                        color="var(--accent-primary)"
                        mt={0.5}
                        bg="none"
                        border="none"
                        p={0}
                        cursor="pointer"
                        _hover={{ textDecoration: "underline" }}
                    >
                        {open ? "Show less" : "Show more"}
                    </Text>
                )}
            </Box>
        </Flex>
    );
}

/* ─── Action row ────────────────────────────────────────────────────────── */

function ActionItem({ row }: { row: ActionRow }) {
    const { Icon, status, label, durationMs, detail, error } = row;
    const iconColor =
        status === "error" ? "var(--signal-negative)" : status === "ok" ? "var(--signal-positive)" : "var(--accent-primary)";
    return (
        <Flex align="flex-start" gap={2.5} py={1}>
            <Box mt="2px" flexShrink={0} color={iconColor} display="flex" alignItems="center">
                {status === "running" ? <Spinner size="xs" borderWidth="2px" color="var(--accent-primary)" /> : <Icon size={14} />}
            </Box>
            <Box minW={0} flex={1}>
                <Flex align="baseline" justify="space-between" gap={3}>
                    <Text fontSize="13px" lineHeight={1.5} color={status === "running" ? "var(--ink-primary)" : "var(--ink-primary)"} fontWeight={status === "running" ? 500 : 400} minW={0}>
                        {label}
                    </Text>
                    {typeof durationMs === "number" && status !== "running" && (
                        <Text fontSize="11px" fontFamily="var(--font-tabular, ui-monospace, monospace)" fontVariantNumeric="tabular-nums" color="var(--ink-tertiary)" flexShrink={0}>
                            {fmtDur(durationMs)}
                        </Text>
                    )}
                </Flex>
                {error && (
                    <Text fontSize="12px" color="var(--signal-negative)" mt={0.5} lineHeight={1.5}>
                        {error}
                    </Text>
                )}
                {detail && (
                    <Text fontSize="11.5px" fontFamily="var(--font-mono, ui-monospace, monospace)" color="var(--ink-tertiary)" mt={0.5} noOfLines={1}>
                        {detail}
                    </Text>
                )}
            </Box>
        </Flex>
    );
}

/* ─── Component ─────────────────────────────────────────────────────────── */

export interface RunReasoningTimelineProps {
    /** Persisted or live trace events (snake_case legacy shape). */
    events: TraceEvent[];
    /** True while the run is still going — keeps the last row spinning. */
    active?: boolean;
}

export default function RunReasoningTimeline({ events, active }: RunReasoningTimelineProps) {
    const groups = useMemo(() => buildGroups(events), [events]);
    const scroller = useRef<HTMLDivElement>(null);

    // Fixed-height feed that pins to the latest agent step on every trace
    // update — the page itself never scrolls to follow the run.
    useEffect(() => {
        const el = scroller.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [events]);

    return (
        <Box ref={scroller} h="480px" overflowY="auto" overscrollBehavior="contain" pr={1}>
            {!groups.length && (
                <Flex align="center" gap={2} py={2}>
                    <Spinner size="xs" borderWidth="2px" color="var(--accent-primary)" />
                    <Text fontSize="12.5px" color="var(--ink-tertiary)">{active ? "Starting…" : "No activity recorded"}</Text>
                </Flex>
            )}
            {groups.map((g, gi) => {
                const Icon = g.Icon;
                return (
                    <Box key={`${g.label}-${gi}`} mt={gi === 0 ? 0 : 6}>
                        {g.label && (
                            <Flex align="center" gap={2} mb={1.5}>
                                <Icon size={13} color="var(--ink-tertiary)" />
                                <Text fontSize="11px" fontWeight={600} letterSpacing="0.07em" textTransform="uppercase" color="var(--ink-secondary)">
                                    {g.label}
                                </Text>
                                {g.detail && (
                                    <Text fontSize="11.5px" color="var(--ink-tertiary)" minW={0} truncate flex={1}>
                                        {g.detail}
                                    </Text>
                                )}
                            </Flex>
                        )}
                        <Box pl={g.label ? 1 : 0}>
                            {g.rows.map((row, ri) => {
                                if (row.kind === "thinking") return <ThinkingBlock key={ri} text={row.text} />;
                                if (row.kind === "note")
                                    return (
                                        <Flex key={ri} align="flex-start" gap={2.5} py={0.5}>
                                            <Box mt="5px" w="4px" h="4px" borderRadius="50%" bg="var(--hairline)" flexShrink={0} />
                                            <Text fontSize="12px" lineHeight={1.55} color="var(--ink-tertiary)" minW={0}>
                                                {row.text}
                                            </Text>
                                        </Flex>
                                    );
                                return <ActionItem key={row.id} row={row} />;
                            })}
                        </Box>
                    </Box>
                );
            })}
            {active && (
                <Flex align="center" gap={2} mt={4} pl={1}>
                    <Spinner size="xs" borderWidth="2px" color="var(--accent-primary)" />
                    <Text fontSize="12px" color="var(--ink-tertiary)">Working…</Text>
                </Flex>
            )}
        </Box>
    );
}
