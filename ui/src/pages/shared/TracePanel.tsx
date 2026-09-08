import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Flex, Text, HStack, Spinner } from "@chakra-ui/react";
import { MdExpandLess, MdExpandMore } from "react-icons/md";
import { motion, AnimatePresence } from "motion/react";
import { dur, ease } from "@/lib/motion";
import { API_BASE } from "@/db";
import { supabase } from "@/lib/supabase";

export interface TraceEvent {
    seq: number;
    ts: number;
    type: "thought" | "tool_call" | "tool_result" | "decision" | "step" | "log";
    key: string;
    text?: string;
    tool?: string;
    args?: unknown;
    result?: unknown;
    status?: string;
    duration_ms?: number;
    score?: number;
    label?: string;
}

type Segment =
    | { kind: "thought"; text: string }
    | { kind: "tool_call"; tool: string; args: unknown }
    | { kind: "tool_result"; tool: string; status: string; duration_ms?: number; result?: unknown }
    | { kind: "decision"; score?: number; text?: string }
    | { kind: "log"; text: string };

function appendSegment(groups: Record<string, Segment[]>, ev: TraceEvent): Record<string, Segment[]> {
    const group = groups[ev.key] || (groups[ev.key] = []);
    switch (ev.type) {
        case "thought": {
            const last = group[group.length - 1];
            if (last && last.kind === "thought") {
                group[group.length - 1] = { kind: "thought", text: last.text + (ev.text || "") };
            } else {
                group.push({ kind: "thought", text: ev.text || "" });
            }
            break;
        }
        case "tool_call":
            group.push({ kind: "tool_call", tool: ev.tool || "tool", args: ev.args });
            break;
        case "tool_result": {
            const last = group[group.length - 1];
            if (last && last.kind === "tool_call" && last.tool === ev.tool) {
                group[group.length - 1] = {
                    kind: "tool_result",
                    tool: ev.tool || "tool",
                    status: ev.status === "ERR" ? "ERR" : "OK",
                    duration_ms: ev.duration_ms,
                    result: ev.result,
                };
            } else {
                group.push({
                    kind: "tool_result",
                    tool: ev.tool || "tool",
                    status: ev.status === "ERR" ? "ERR" : "OK",
                    duration_ms: ev.duration_ms,
                    result: ev.result,
                });
            }
            break;
        }
        case "decision":
            group.push({ kind: "decision", score: ev.score, text: ev.text });
            break;
        case "log":
            group.push({ kind: "log", text: ev.text || "" });
            break;
        default:
            break;
    }
    return groups;
}

function groupEvents(events: TraceEvent[]): Record<string, Segment[]> {
    const groups: Record<string, Segment[]> = {};
    for (const ev of events) appendSegment(groups, ev);
    return groups;
}

/* ─── Live SSE hook ─────────────────────────────────────────────────────── */

function useTraceStream(runId: string, onEvent: (ev: TraceEvent) => void): boolean {
    const [connected, setConnected] = useState(false);
    const cbRef = useRef(onEvent);
    cbRef.current = onEvent;

    useEffect(() => {
        if (!runId) return;
        const controller = new AbortController();
        let cancelled = false;

        const connect = async () => {
            try {
                const { data } = await supabase.auth.getSession();
                const token = data.session?.access_token;
                const res = await fetch(`${API_BASE}/analysis/${encodeURIComponent(runId)}/stream`, {
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
                    // SSE frames are blank-line separated; we only use `data:` lines.
                    const frames = buffer.split("\n\n");
                    buffer = frames.pop() || "";
                    for (const frame of frames) {
                        const dataLine = frame
                            .split("\n")
                            .find((l) => l.startsWith("data:"));
                        if (!dataLine) continue;
                        try {
                            const payload = JSON.parse(dataLine.slice(5).trim());
                            if (payload?.type === "trace" && payload.event) {
                                cbRef.current(payload.event);
                            }
                            if (payload?.type === "ready") setConnected(true);
                        } catch {
                            // Ignore malformed frames
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
    }, [runId]);

    return connected;
}

/* ─── Reasoning block (Claude/DeepSeek-style) ──────────────────────────── */

function ParamBlock({ name, segments, isActive }: { name: string; segments: Segment[]; isActive: boolean }) {
    const [open, setOpen] = useState(isActive || segments.length === 0);

    const firstTool = segments.find((s) => s.kind === "tool_call");
    const lastDecision = [...segments].reverse().find((s) => s.kind === "decision");

    return (
        <Box borderBottom="1px solid var(--hairline)" py={3}>
            <Flex align="center" gap={2}>
                {isActive ? (
                    <Spinner size="xs" borderWidth="2px" color="var(--accent-primary)" flexShrink={0} />
                ) : (
                    <Box w="6px" h="6px" borderRadius="50%" bg="var(--signal-positive)" flexShrink={0} />
                )}
                <Text fontSize="12.5px" fontWeight={500} color="var(--ink-primary)" flex={1} minW={0} truncate>
                    {name}
                </Text>
                {lastDecision && lastDecision.score != null && (
                    <Text
                        fontSize="11.5px"
                        fontFamily="var(--font-tabular)"
                        fontVariantNumeric="tabular-nums"
                        fontWeight={500}
                        color={lastDecision.score >= 70 ? "var(--signal-positive)" : lastDecision.score >= 40 ? "var(--signal-caution)" : "var(--signal-negative)"}
                    >
                        {lastDecision.score.toFixed(1)}
                    </Text>
                )}
                {!lastDecision && firstTool && (
                    <Text fontSize="11px" fontFamily="var(--font-mono)" color="var(--ink-tertiary)" whiteSpace="nowrap">
                        {segments.filter((s) => s.kind === "tool_call").length} tool{segments.filter((s) => s.kind === "tool_call").length > 1 ? "s" : ""}
                    </Text>
                )}
                <Box
                    as="button"
                    onClick={() => setOpen((v) => !v)}
                    aria-label={open ? "Collapse reasoning" : "Expand reasoning"}
                    color="var(--ink-tertiary)"
                    _hover={{ color: "var(--ink-primary)" }}
                    flexShrink={0}
                    p={0.5}
                >
                    {open ? <MdExpandLess size={15} /> : <MdExpandMore size={15} />}
                </Box>
            </Flex>

            <AnimatePresence initial={false}>
                {open && (
                    <motion.div
                        key="body"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: dur.base, ease }}
                        style={{ overflow: "hidden" }}
                    >
                        <Box mt={2} ml={3.5} borderLeft="2px solid var(--hairline)" pl={3}>
                            {segments.map((seg, i) => {
                                if (seg.kind === "thought") {
                                    return (
                                        <Box key={i} fontSize="12px" color="var(--ink-secondary)" lineHeight="relaxed" whiteSpace="pre-wrap" wordBreak="break-word" py={0.5}>
                                            {seg.text}
                                        </Box>
                                    );
                                }
                                if (seg.kind === "tool_call") {
                                    return (
                                        <HStack key={i} gap={2} py={0.5} align="flex-start">
                                            <Text fontSize="11px" fontFamily="var(--font-mono)" color="var(--accent-primary)" flexShrink={0}>
                                                {seg.tool}
                                            </Text>
                                            <Text fontSize="11px" fontFamily="var(--font-mono)" color="var(--ink-tertiary)" wordBreak="break-all">
                                                {seg.args != null && Object.keys(seg.args as object).length > 0 ? JSON.stringify(seg.args) : ""}
                                            </Text>
                                        </HStack>
                                    );
                                }
                                if (seg.kind === "tool_result") {
                                    return (
                                        <HStack key={i} gap={2} py={0.5} align="flex-start">
                                            <Text fontSize="11px" fontFamily="var(--font-mono)" flexShrink={0} color={seg.status === "OK" ? "var(--signal-positive)" : "var(--signal-negative)"}>
                                                {seg.status === "OK" ? "✓" : "✗"} {seg.status}
                                            </Text>
                                            {typeof seg.duration_ms === "number" && (
                                                <Text fontSize="11px" fontFamily="var(--font-mono)" color="var(--ink-tertiary)" flexShrink={0}>
                                                    {(seg.duration_ms / 1000).toFixed(1)}s
                                                </Text>
                                            )}
                                            {typeof seg.result === "string" && (
                                                <Text fontSize="11px" fontFamily="var(--font-mono)" color="var(--ink-tertiary)" noOfLines={2} wordBreak="break-all" minW={0}>
                                                    {seg.result}
                                                </Text>
                                            )}
                                        </HStack>
                                    );
                                }
                                if (seg.kind === "decision") {
                                    return (
                                        <HStack key={i} gap={2} py={0.5}>
                                            <Text fontSize="11px" fontWeight={600} fontFamily="var(--font-mono)" color="var(--ink-primary)">
                                                Score
                                            </Text>
                                            {seg.score != null && <Text fontSize="11px" fontFamily="var(--font-tabular)" color="var(--ink-primary)">{seg.score.toFixed(1)}</Text>}
                                            {seg.text && <Text fontSize="11px" color="var(--signal-negative)">{seg.text}</Text>}
                                        </HStack>
                                    );
                                }
                                return (
                                    <Text key={i} fontSize="11px" color="var(--ink-tertiary)" py={0.5}>
                                        {seg.text}
                                    </Text>
                                );
                            })}
                        </Box>
                    </motion.div>
                )}
            </AnimatePresence>
        </Box>
    );
}

/* ─── Public component ──────────────────────────────────────────────────── */

export function TracePanel({ runId, events }: { runId?: string; events?: TraceEvent[] }) {
    const [live, setLive] = useState<TraceEvent[]>([]);
    const onEvent = useCallback((ev: TraceEvent) => setLive((prev) => [...prev, ev]), []);
    const connected = useTraceStream(runId || "", onEvent);

    const all = useMemo(() => (events?.length ? events : live), [events, live]);
    const groups = useMemo(() => groupEvents(all), [all]);

    const keyNames = Object.keys(groups);
    const lastKey = keyNames.length ? keyNames[keyNames.length - 1] : null;

    if (all.length === 0) {
        return (
            <HStack gap={1.5} py={2}>
                <Spinner size="xs" borderWidth="2px" color="var(--accent-primary)" />
                <Text fontSize="12px" color="var(--ink-tertiary)">
                    {connected ? "Listening for model activity…" : "Waiting for analysis to start…"}
                </Text>
            </HStack>
        );
    }

    return (
        <Box>
            {keyNames.map((key) => (
                <ParamBlock key={key} name={key} segments={groups[key]} isActive={key === lastKey && !!runId} />
            ))}
        </Box>
    );
}