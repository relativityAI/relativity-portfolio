import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Flex, Text, HStack, Spinner } from "@chakra-ui/react";
import { motion, AnimatePresence } from "motion/react";
import { MdCheck, MdClose, MdOutlineAnalytics } from "react-icons/md";
import { dur, ease } from "@/lib/motion";
import { API_BASE } from "@/db";
import { supabase } from "@/lib/supabase";
import type { TraceEvent } from "@/pages/shared/TracePanel";
import AgentAvatar from "@/components/shared/AgentAvatar";
import { agentIdentity, agentSeed, type AgentSeedLike } from "@/lib/agentIdentity";
import { useColorModeValue } from "@/components/ui/color-mode";
import { summarizeToolResult } from "@/lib/toolResultSummary";

/* ─── Live SSE hook (generic over any trace stream URL) ────────────────── */

function useSseTrace(url: string | undefined, onEvent: (ev: TraceEvent) => void): boolean {
    const [connected, setConnected] = useState(false);
    const cbRef = useRef(onEvent);
    cbRef.current = onEvent;

    useEffect(() => {
        if (!url) return;
        const controller = new AbortController();
        let cancelled = false;

        const connect = async () => {
            try {
                const { data } = await supabase.auth.getSession();
                const token = data.session?.access_token;
                const res = await fetch(`${API_BASE}${url}`, {
                    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
                    signal: controller.signal,
                });
                if (!res.ok || !res.body) {
                    setConnected(false);
                    return;
                }
                setConnected(true);
                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let buffer = "";
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });
                    const frames = buffer.split("\n\n");
                    buffer = frames.pop() || "";
                    for (const frame of frames) {
                        const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
                        if (!dataLine) continue;
                        try {
                            const payload = JSON.parse(dataLine.slice(5).trim());
                            if (payload?.type === "trace" && payload.event) {
                                cbRef.current(payload.event);
                            }
                            if (payload?.type === "ready") setConnected(true);
                        } catch {
                            // ignore malformed frames
                        }
                    }
                }
            } catch {
                if (!cancelled) setConnected(false);
            }
        };

        connect();
        return () => {
            cancelled = true;
            controller.abort();
            setConnected(false);
        };
    }, [url]);

    return connected;
}

/* ─── Activity rows ────────────────────────────────────────────────────── */

type ActivityRow =
    | { kind: "step"; label: string; status: string; duration_ms?: number }
    | { kind: "thought"; text: string }
    | { kind: "tool"; name: string; args?: unknown; status: "running" | "OK" | "ERR"; duration_ms?: number; snippet?: string }
    | { kind: "decision"; score?: number; text?: string }
    | { kind: "log"; text: string };

function buildRows(steps: AgentStep[], events: TraceEvent[]): ActivityRow[] {
    const rows: ActivityRow[] = [];
    for (const st of steps || []) {
        rows.push({ kind: "step", label: st?.label || st?.key || "step", status: st?.status || "pending", duration_ms: st?.duration_ms });
    }
    for (const ev of events) {
        switch (ev.type) {
            case "thought": {
                const last = rows[rows.length - 1];
                if (last?.kind === "thought") {
                    rows[rows.length - 1] = { kind: "thought", text: last.text + (ev.text || "") };
                } else {
                    rows.push({ kind: "thought", text: ev.text || "" });
                }
                break;
            }
            case "tool_call":
                rows.push({ kind: "tool", name: ev.tool || "tool", args: ev.args, status: "running" });
                break;
            case "tool_result": {
                // Resolve the most recent still-running call with the same tool name.
                let idx = -1;
                for (let i = rows.length - 1; i >= 0; i--) {
                    const r = rows[i];
                    if (r.kind === "tool" && r.name === ev.tool && r.status === "running") {
                        idx = i;
                        break;
                    }
                }
                if (idx >= 0) {
                    rows[idx] = {
                        kind: "tool",
                        name: ev.tool || "tool",
                        args: (rows[idx] as { args?: unknown }).args,
                        status: ev.status === "ERR" ? "ERR" : "OK",
                        duration_ms: ev.duration_ms,
                        snippet: summarizeToolResult(ev.result),
                    };
                } else {
                    rows.push({ kind: "log", text: `${ev.tool} → ${ev.status}` });
                }
                break;
            }
            case "decision":
                rows.push({ kind: "decision", score: ev.score, text: ev.text });
                break;
            case "log":
                rows.push({ kind: "log", text: ev.text || "" });
                break;
            default:
                break;
        }
    }
    return rows;
}

function mmss(totalSec: number): string {
    const m = Math.floor(totalSec / 60);
    const s = Math.floor(totalSec % 60);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function toolArgsSummary(args: unknown): string {
    if (args == null) return "";
    try {
        const o = args as Record<string, unknown>;
        if (typeof o === "object" && !Array.isArray(o)) {
            return Object.entries(o)
                .filter(([, v]) => v != null && v !== "" && typeof v !== "object")
                .map(([k, v]) => `${k}=${v}`)
                .join("  ");
        }
        return JSON.stringify(args);
    } catch {
        return "";
    }
}

/* ─── Row renderer ─────────────────────────────────────────────────────── */

function Row({ row, active }: { row: ActivityRow; active: boolean }) {
    switch (row.kind) {
        case "step":
            return (
                <Flex align="flex-start" gap={2} py={0.5} minW={0}>
                    <Flex w="14px" justify="center" flexShrink={0} mt="2px">
                        {row.status === "completed" || row.status === "success" ? (
                            <MdCheck size={11} color="var(--signal-positive)" />
                        ) : row.status === "failed" || row.status === "error" ? (
                            <MdClose size={11} color="var(--signal-negative)" />
                        ) : row.status === "running" ? (
                            <Spinner size="xs" color="var(--accent-primary)" />
                        ) : (
                            <Box w="6px" h="6px" borderRadius="50%" border="1px solid var(--hairline)" />
                        )}
                    </Flex>
                    <Text fontSize="12px" lineHeight="1.5" color={row.status === "running" ? "var(--ink-primary)" : "var(--ink-secondary)"} minW={0}>
                        {row.label}
                        {typeof row.duration_ms === "number" && row.status !== "running"
                            ? `  ·  ${(row.duration_ms / 1000).toFixed(1)}s`
                            : ""}
                    </Text>
                </Flex>
            );
        case "thought":
            return (
                <Flex align="flex-start" gap={2} py={0.5} minW={0}>
                    <Box w="14px" flexShrink={0} mt="2px" textAlign="center" color="var(--ink-tertiary)" fontSize="10px">
                        {active ? "●" : ""}
                    </Box>
                    <Text
                        fontSize="11.5px"
                        lineHeight="1.5"
                        color="var(--ink-secondary)"
                        fontStyle="italic"
                        whiteSpace="pre-wrap"
                        wordBreak="break-word"
                        minW={0}
                    >
                        {row.text.length > 900 ? row.text.slice(0, 900) + "…" : row.text}
                    </Text>
                </Flex>
            );
        case "tool":
            return (
                <Flex align="flex-start" gap={2} py={0.5} minW={0}>
                    <Flex w="14px" justify="center" flexShrink={0} mt="3px">
                        {row.status === "running" ? (
                            <Spinner size="xs" color="var(--accent-primary)" borderWidth="2px" />
                        ) : row.status === "OK" ? (
                            <MdCheck size={11} color="var(--signal-positive)" />
                        ) : (
                            <MdClose size={11} color="var(--signal-negative)" />
                        )}
                    </Flex>
                    <Flex direction="column" minW={0} flex={1}>
                        <HStack gap={1.5} align="center" minW={0}>
                            <Text fontSize="11px" fontFamily="var(--font-mono)" color="var(--accent-primary)" fontWeight={600} flexShrink={0}>
                                {row.status === "OK" ? "✓" : row.status === "ERR" ? "✗" : "·"} {row.name}
                            </Text>
                            {typeof row.duration_ms === "number" && row.status !== "running" && (
                                <Text fontSize="10.5px" fontFamily="var(--font-tabular)" color="var(--ink-tertiary)" flexShrink={0}>
                                    {(row.duration_ms / 1000).toFixed(1)}s
                                </Text>
                            )}
                        </HStack>
                        {row.args != null && (
                            <Text fontSize="10.5px" fontFamily="var(--font-mono)" color="var(--ink-tertiary)" wordBreak="break-all" mt={0.5}>
                                {toolArgsSummary(row.args)}
                            </Text>
                        )}
                        {row.snippet && (
                            <Text fontSize="10.5px" fontFamily="var(--font-mono)" color="var(--ink-tertiary)" lineClamp={2} mt={0.5} opacity={0.85}>
                                {row.snippet.length > 300 ? row.snippet.slice(0, 300) + "…" : row.snippet}
                            </Text>
                        )}
                    </Flex>
                </Flex>
            );
        case "decision":
            return (
                <Flex align="center" gap={2} py={0.5}>
                    <Flex w="14px" justify="center" flexShrink={0}>
                        <MdOutlineAnalytics size={11} color="var(--ink-secondary)" />
                    </Flex>
                    <Text fontSize="11px" fontWeight={600} fontFamily="var(--font-mono)" color="var(--ink-primary)">
                        Decision
                    </Text>
                    {row.score != null && (
                        <Text fontSize="11px" fontFamily="var(--font-tabular)" color="var(--ink-primary)">
                            {Number(row.score).toFixed(1)}
                        </Text>
                    )}
                    {row.text && <Text fontSize="11px" color="var(--signal-caution)">{row.text}</Text>}
                </Flex>
            );
        default:
            return (
                <Text fontSize="10.5px" color="var(--ink-tertiary)" py={0.5}>
                    {row.text}
                </Text>
            );
    }
}

/* ─── Component ────────────────────────────────────────────────────────── */

export interface AgentStep {
    key?: string;
    label?: string;
    status?: string;
    duration_ms?: number;
}

interface AgentActivityProps {
    title: string;
    subtitle?: string;
    /** Agent identity — renders the agent's chip in the header. */
    agent?: AgentSeedLike | string;
    /** SSE endpoint (relative to API_BASE) for live events. */
    streamUrl?: string;
    /** Static trace events (used when not streaming). */
    events?: TraceEvent[];
    steps?: AgentStep[];
    /** Epoch (ms) the work started — drives the running timer. */
    startedAt?: number;
    active?: boolean;
    /** Max height of the scrollable activity list (px). Default 252. */
    maxHeight?: number;
}

export default function AgentActivity({
    title,
    subtitle,
    agent,
    streamUrl,
    events,
    steps = [],
    startedAt,
    active,
    maxHeight = 252,
}: AgentActivityProps) {
    const [live, setLive] = useState<TraceEvent[]>([]);
    const [elapsed, setElapsed] = useState(0);
    const scroller = useRef<HTMLDivElement>(null);
    const startRef = useRef(0);

    const onEvent = useCallback((ev: TraceEvent) => {
        setLive((prev) => [...prev, ev]);
    }, []);
    const connected = useSseTrace(streamUrl, onEvent);

    useEffect(() => {
        if (!active || !startedAt) return;
        startRef.current = Date.now();
        const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - startRef.current) / 1000)));
        tick();
        const interval = setInterval(tick, 1000);
        return () => clearInterval(interval);
    }, [active, startedAt]);

    const all = useMemo(() => (streamUrl ? live : events ?? []), [streamUrl, live, events]);
    const rows = useMemo(() => buildRows(steps, all), [steps, all]);

    useEffect(() => {
        if (active && scroller.current) {
            scroller.current.scrollTop = scroller.current.scrollHeight;
        }
    }, [rows.length, active]);

    const statusLabel = active
        ? connected
            ? "Working…"
            : "Warming up…"
        : all.length
          ? "Finished"
          : "";

    const identity = useMemo(() => agentIdentity(agentSeed(agent)), [agent]);
    const spinColor = useColorModeValue(identity.color.light, identity.color.dark);

    return (
        <Box
            border="1px solid var(--hairline)"
            borderRadius="2px"
            bg="var(--surface-panel)"
            overflow="hidden"
            display="flex"
            flexDirection="column"
        >
            {/* Header */}
            <Flex align="center" gap={2.5} px={3} py={2.5} borderBottom="1px solid var(--hairline)">
                {agent ? (
                    <Flex align="center" gap={1.5} flexShrink={0}>
                        <AgentAvatar agent={agent} size={22} />
                        {active && <Spinner size="xs" borderWidth="2px" color={spinColor} />}
                    </Flex>
                ) : (
                    <Box flexShrink={0}>
                        {active ? (
                            <Spinner size="xs" color="var(--accent-primary)" borderWidth="2px" />
                        ) : (
                            <Box w="7px" h="7px" borderRadius="50%" bg="var(--signal-positive)" />
                        )}
                    </Box>
                )}
                <Flex direction="column" minW={0} flex={1}>
                    <Text fontSize="12.5px" fontWeight={600} color="var(--ink-primary)" truncate>
                        {title}
                    </Text>
                    {subtitle && (
                        <Text fontSize="10.5px" color="var(--ink-tertiary)" truncate>
                            {subtitle}
                        </Text>
                    )}
                </Flex>
                {active && (
                    <Text fontSize="12px" fontFamily="var(--font-tabular)" fontVariantNumeric="tabular-nums" color="var(--ink-tertiary)" flexShrink={0} whiteSpace="nowrap">
                        {mmss(elapsed)}
                    </Text>
                )}
            </Flex>

            {/* Activity list */}
            <Box ref={scroller} maxH={`${maxHeight}px`} overflowY="auto" px={3} py={2}>
                {rows.length > 0 && (
                    <AnimatePresence initial={false}>
                        {rows.map((row, i) => (
                            <motion.div
                                key={i}
                                initial={{ opacity: 0, y: -3 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: dur.fast, ease }}
                                layout
                            >
                                <Row row={row} active={!!active} />
                            </motion.div>
                        ))}
                    </AnimatePresence>
                )}
                {rows.length === 0 && (
                    <Flex align="center" gap={2} py={2}>
                        <Spinner size="xs" borderWidth="2px" color="var(--accent-primary)" />
                        <Text fontSize="11.5px" color="var(--ink-tertiary)">
                            {statusLabel}
                        </Text>
                    </Flex>
                )}
            </Box>
        </Box>
    );
}