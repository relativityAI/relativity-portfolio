import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    useLocalRuntime,
    type ChatModelAdapter,
    AssistantRuntimeProvider,
    type ThreadMessageLike,
} from "@assistant-ui/react";
import { Thread, makeMarkdownText } from "@assistant-ui/react-ui";
import "@assistant-ui/react-ui/styles/index.css";
import "@assistant-ui/react-ui/styles/markdown.css";
import { Box, Button, Flex, Text, Spinner } from "@/compat/ui";
import { LuX, LuCheck } from "react-icons/lu";
import { BuilderService, VoyagerService, AnalysisService, SettingsService, isServerFreeModel } from "@/db";
import { diffDraft } from "@/lib/draftDiff";
import { draftKey, saveLocalDraft, loadLocalDraft, clearLocalDraft } from "@/lib/autosave";
import { toaster } from "@/compat/ui";
import type { ThreadMessage } from "@assistant-ui/react";

/**
 * The AI draft dock — the co-builder on the official assistant-ui
 * styled package (@assistant-ui/react-ui). The conversation runtime is the
 * same LocalRuntime + ChatModelAdapter over the existing BuilderService
 * endpoint (zero backend changes); the chrome is the official Thread UI.
 */

let msgSeq = 0;
function nextId(prefix: string) {
    return `${prefix}-${++msgSeq}-${Date.now()}`;
}

interface DocFile {
    filename: string;
    char_count: number;
    status: "uploading" | "processing" | "done" | "error";
    error?: string;
}

/** Normalize any draft shape into the v3 agent the form reads. */
function normalizeAgent(a: any): Record<string, unknown> {
    const phil = a?.persona?.philosophy ?? a?.persona?.philosophy_and_mindset ?? a?.philosophy ?? "";
    return {
        name: a?.name || "",
        description: a?.description || "",
        philosophy: phil,
        persona: { philosophy: phil },
        configuration: {
            investment_horizon: a?.configuration?.investment_horizon ?? a?.horizon ?? "",
            risk_appetite: a?.configuration?.risk_appetite ?? a?.risk ?? 5,
        },
        skills: Array.isArray(a?.skills)
            ? a.skills
                .filter((s: any) => s && s.skill_id)
                .map((s: any) => ({
                    skill_id: String(s.skill_id),
                    weight: Math.min(10, Math.max(1, Math.round(Number(s.weight) || 5))),
                }))
            : [],
    };
}

/** Human-readable summary of what a proposal would change. */
function summarizeChanges(prev: Record<string, unknown>, next: Record<string, unknown>): string {
    const lines: string[] = [];
    if (next.name && next.name !== prev.name) lines.push(`rename to “${next.name}”`);
    const prevPhil = (prev.persona as any)?.philosophy || (prev as any).philosophy || "";
    const nextPhil = (next.persona as any)?.philosophy || (next as any).philosophy || "";
    if (nextPhil && nextPhil !== prevPhil) {
        lines.push(nextPhil.length > 120 ? `rewrite the philosophy (“${nextPhil.slice(0, 117)}…”)` : "set the philosophy");
    }
    const pc = prev.configuration as any || {};
    const nc = next.configuration as any || {};
    if (nc.investment_horizon && nc.investment_horizon !== pc.investment_horizon) lines.push(`horizon → ${nc.investment_horizon}`);
    if (nc.risk_appetite != null && nc.risk_appetite !== pc.risk_appetite) lines.push(`risk → ${nc.risk_appetite}/10`);
    const ps = (prev.skills as any[]) || [];
    const ns = (next.skills as any[]) || [];
    const added = ns.filter((s) => !ps.some((p) => p.skill_id === s.skill_id));
    const removed = ps.filter((s) => !ns.some((n) => n.skill_id === s.skill_id));
    const reweighted = ns.filter((n) => {
        const old = ps.find((p) => p.skill_id === n.skill_id);
        return old && old.weight !== n.weight;
    });
    if (added.length) lines.push(`attach ${added.map((s) => s.skill_id).join(", ")}`);
    if (removed.length) lines.push(`remove ${removed.map((s) => s.skill_id).join(", ")}`);
    if (reweighted.length) lines.push(`re-weight ${reweighted.map((s) => `${s.skill_id} → ${s.weight}/10`).join(", ")}`);
    return lines.length ? `This change proposes: ${lines.join("; ")}.` : "This change proposes updates to the agent.";
}

export interface CommissionDockProps {
    open: boolean;
    onClose: () => void;
    agent: any;
    agentId: string | null;
    /** Merge an accepted proposal into the shared editor agent state. */
    onApply: (proposal: Record<string, unknown>) => void;
}

/** Tool-call part payload for a draft proposal ("change sheet"). */
interface ProposalArgs {
    proposal: Record<string, unknown>;
    summary: string;
}
interface ProposalResult {
    decision?: "approved" | "discarded";
}

/* ── Markdown renderer for assistant messages (official styled package) ── */
const MarkdownText = makeMarkdownText();

/* ── Change sheet: the in-chat approve/reject card ────────────────────── */
function ProposalSheet(props: any) {
    const { args, result } = props as { args?: ProposalArgs; result?: ProposalResult | null };
    if (!args?.proposal) return null;
    if (result?.decision) {
        return (
            <Box
                className="aui-sheet aui-sheet-decided"
                my={2}
                px={3} py={2}
                border="var(--hairline-w) solid var(--hairline)"
                borderRadius="var(--radius-surface)"
                bg="var(--console-panel)"
            >
                <Text fontSize="11.5px" color={result.decision === "approved" ? "var(--signal-positive)" : "var(--ink-tertiary)"}>
                    {result.decision === "approved"
                        ? "✓ Approved — staged. Review the header, then Apply."
                        : "Discarded — your agent is untouched."}
                </Text>
            </Box>
        );
    }
    return (
        <Box
            className="aui-sheet"
            my={2}
            border="var(--hairline-w) solid color-mix(in srgb, var(--skill-accent) 35%, transparent)"
            borderRadius="var(--radius-surface)"
            bg="color-mix(in srgb, var(--skill-accent) 5%, var(--console-panel))"
            overflow="hidden"
        >
            <Box px={3.5} py={2.5} borderBottom="var(--hairline-w) solid var(--hairline)">
                <Text fontSize="10px" letterSpacing="0.14em" textTransform="uppercase" color="var(--skill-accent)" mb={1}>
                    Proposed changes
                </Text>
                <Text fontSize="12.5px" color="var(--ink-secondary)" lineHeight="1.6">
                    {args.summary}
                </Text>
            </Box>
            <Flex px={3.5} py={2.5} gap={2} justify="flex-end">
                <Button
                    size="xs" variant="ghost"
                    onClick={() => dockActionsRef?.("discard", args)}
                >
                    Discard
                </Button>
                <Button
                    size="xs"
                    bg="var(--skill-accent)" color="#fff"
                    _hover={{ bg: "color-mix(in srgb, var(--skill-accent) 85%, #000)" }}
                    onClick={() => dockActionsRef?.("approve", args)}
                >
                    <LuCheck size={12} /> Approve & stage
                </Button>
            </Flex>
        </Box>
    );
}

/** Bridge so tool-call sheets can reach the dock's approve/discard handler. */
let dockActionsRef: ((action: "approve" | "discard", args: ProposalArgs) => void) | null = null;

export default function CommissionDock({ open, onClose, agent, agentId, onApply }: CommissionDockProps) {
    const base = useMemo(() => normalizeAgent(agent), [agent]);
    const [isMobile, setIsMobile] = useState(false);
    const [documents, setDocuments] = useState<DocFile[]>([]);
    const [documentTexts, setDocumentTexts] = useState<{ filename: string; text: string }[]>([]);
    const [metrics, setMetrics] = useState<{ id: string; name: string; type: string }[]>([]);
    const [availableModels, setAvailableModels] = useState<string[]>([]);
    const [selectedModel, setSelectedModel] = useState("");
    const [proposal, setProposal] = useState<Record<string, unknown>>(() => base);
    const sessionIdRef = useRef<string>(
        typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `builder-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    const persistKey = agentId ? `${draftKey(agentId)}:commission` : `${draftKey("new")}:commission`;
    const proposalRef = useRef(proposal);
    proposalRef.current = proposal;

    useEffect(() => {
        const check = () => setIsMobile(window.innerWidth < 900);
        check();
        window.addEventListener("resize", check);
        return () => window.removeEventListener("resize", check);
    }, []);

    // Reset the proposal whenever the panel opens against the current agent.
    useEffect(() => {
        if (open) setProposal(normalizeAgent(agent));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // Restore + autosave the conversation to this device.
    type SavedChat = {
        messages: ThreadMessageLike[];
        proposal: Record<string, unknown>;
        documents: DocFile[];
        documentTexts: { filename: string; text: string }[];
    };
    const [initialMessages, setInitialMessages] = useState<ThreadMessageLike[] | undefined>(undefined);
    const restoredRef = useRef(false);
    useEffect(() => {
        if (!open || restoredRef.current) return;
        restoredRef.current = true;
        const saved = loadLocalDraft<SavedChat>(persistKey);
        if (saved?.data?.messages?.length) {
            setInitialMessages(saved.data.messages);
            setProposal({ ...normalizeAgent(agent), ...saved.data.proposal });
            setDocuments(saved.data.documents || []);
            setDocumentTexts(saved.data.documentTexts || []);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const adapterRef = useRef<{ lastMessages: ThreadMessageLike[] } | null>(null);

    useEffect(() => {
        if (!open) return;
        const t = setTimeout(() => {
            saveLocalDraft<SavedChat>(persistKey, {
                messages: adapterRef.current?.lastMessages ?? [],
                proposal: proposalRef.current,
                documents,
                documentTexts,
            });
        }, 600);
        return () => clearTimeout(t);
    }, [open, persistKey, documents, documentTexts]);

    useEffect(() => {
        VoyagerService.getAvailableMetrics("NSE").then((d) => { if (d?.fields) setMetrics(d.fields); }).catch(() => {});
        Promise.all([
            AnalysisService.getAvailableModels(),
            SettingsService.getSettings().catch(() => ({ llm_keys: {} })),
            AnalysisService.getDefaultModel().catch(() => ({ model_id: "" })),
        ])
            .then(([modelsData, settings, def]) => {
                const allModels = Array.isArray(modelsData) ? modelsData : [];
                const keys = Object.keys(settings?.llm_keys || {});
                const userProviders = keys.filter((k) => k !== "tavily");
                const models = userProviders.length > 0
                    ? allModels.filter((m: string) => {
                        const provider = m.split("/")[0];
                        return provider === "ollama" || userProviders.includes(provider);
                    })
                    : allModels.filter((m: string) => isServerFreeModel(m));
                setAvailableModels(models);
                setSelectedModel((prev) => {
                    if (prev && models.includes(prev)) return prev;
                    const recommended = models.includes(def?.model_id || "") ? def.model_id : "";
                    return recommended || models[0] || "";
                });
            })
            .catch(() => {});
    }, []);

    /* ── The adapter: existing endpoint → assistant-ui async generator ── */

    const runDraft = useCallback(async function* (messages: readonly ThreadMessage[]): AsyncGenerator<any, void, unknown> {
        const wire = messages.map((m) => {
            const text = m.content
                .map((p: any) => (p.type === "text" ? p.text : ""))
                .join("")
                .trim();
            return { role: m.role as "user" | "assistant", content: text };
        }).filter((m) => m.content);

        let result: Awaited<ReturnType<typeof BuilderService.draft>>;
        try {
            result = await BuilderService.draft({
                session_id: sessionIdRef.current,
                messages: wire,
                agent_draft: proposalRef.current,
                metrics,
                document_texts: documentTexts,
                user_response: wire[wire.length - 1]?.content,
                model_id: selectedModel || undefined,
            });
        } catch (err: any) {
            const msg = err?.response?.data?.error || err?.message || "The builder could not be reached.";
            yield { content: [{ type: "text" as const, text: `Something went wrong: ${String(msg).slice(0, 300)}` }], status: { reason: "error", type: "incomplete" } as any };
            return;
        }

        const parts: any[] = [{ type: "text" as const, text: result.message }];

        for (const url of result.sources || []) {
            parts.push({ type: "source" as const, sourceType: "url" as const, url, title: url });
        }

        // Draft update → a tool-call part rendered as a change sheet.
        // NOT staged until the user approves the sheet in chat.
        if (result.agent_draft_update) {
            const prev = proposalRef.current;
            const update = result.agent_draft_update;
            const phil =
                (update.philosophy as string) ||
                (update.persona as any)?.philosophy ||
                (prev.persona as any)?.philosophy ||
                (prev.philosophy as string);
            const merged = normalizeAgent({
                ...prev,
                ...update,
                philosophy: phil,
                persona: { philosophy: phil },
                configuration: { ...(prev.configuration as any), ...(update.configuration as any) },
                skills: update.skills ?? prev.skills,
            });
            const changed = Object.keys(update).some((k) => JSON.stringify(update[k]) !== JSON.stringify(prev[k]));
            if (changed) {
                parts.push({
                    type: "tool-call" as const,
                    toolCallId: nextId("proposal"),
                    toolName: "agent_proposal",
                    args: { proposal: merged, summary: summarizeChanges(prev, merged) } satisfies ProposalArgs,
                    result: null,
                });
            }
        }

        yield { content: parts, status: { reason: "unknown", type: "complete" } as any };
    }, [metrics, documentTexts, selectedModel]);

    const adapter: ChatModelAdapter = useMemo(
        () => ({
            run: async function* (options) {
                adapterRef.current = {
                    lastMessages: options.messages.map((m: ThreadMessage) => ({
                        role: m.role,
                        content: m.content
                            .filter((p: any) => p.type === "text")
                            .map((p: any) => ({ type: "text", text: p.text })),
                    })),
                };
                yield* runDraft(options.messages);
            },
        }),
        [runDraft],
    );

    const runtime = useLocalRuntime(adapter, { initialMessages });

    // Sheet decisions from inside the chat. Approve stages the proposal
    // (header's Apply commits it to the workbench); Discard drops it.
    useEffect(() => {
        dockActionsRef = (action, args) => {
            if (action === "approve") {
                setProposal(normalizeAgent(args.proposal));
                toaster.create({ title: "Changes staged", description: "Review the staged changes in the header, then Apply.", type: "success" });
            } else {
                toaster.create({ title: "Changes discarded", type: "info" });
            }
        };
        return () => { dockActionsRef = null; };
    }, []);

    const handleUpload = useCallback(async (files: File[]) => {
        const newDocs: DocFile[] = files.map((f) => ({ filename: f.name, char_count: 0, status: "uploading" as const }));
        setDocuments((prev) => [...prev, ...newDocs]);
        try {
            const result = await BuilderService.uploadDocuments(files);
            const texts = result.documents.map((d) => ({ filename: d.filename, text: d.text }));
            setDocumentTexts((prev) => [...prev, ...texts]);
            setDocuments((prev) => prev.map((d, i) => (i >= prev.length - files.length ? { ...d, char_count: result.documents[i - (prev.length - files.length)]?.char_count ?? 0, status: "done" as const } : d)));
            runtime.thread.append({ role: "assistant", content: `I've read ${texts.map((t) => t.filename).join(", ")}. Tell me what to take from them — or say "build an agent from these documents".` });
        } catch {
            setDocuments((prev) => prev.map((d) => (d.status === "uploading" ? { ...d, status: "error" as const, error: "Upload failed" } : d)));
            toaster.create({ title: "Document upload failed", type: "error" });
        }
    }, [runtime]);

    if (!open) return null;

    const changes = diffDraft(base, proposal);

    const apply = () => {
        onApply(proposal);
        clearLocalDraft(persistKey);
        runtime.thread.reset();
        setProposal(normalizeAgent(agent));
        restoredRef.current = false;
        setInitialMessages(undefined);
        setDocuments([]);
        setDocumentTexts([]);
        toaster.create({ title: "Changes applied to your agent", type: "success" });
    };

    const discardAll = () => {
        setProposal(base);
    };

    const threadConfig = {
        tools: [
            {
                toolName: "agent_proposal",
                component: ProposalSheet,
            },
        ],
        strings: {
            composer: {
                input: { placeholder: "Describe changes to this agent…" },
                send: { tooltip: "Send" },
                cancel: { tooltip: "Stop" },
            },
            assistantMessage: { reload: { tooltip: "Regenerate" }, copy: { tooltip: "Copy" } },
            userMessage: { edit: { tooltip: "Edit" } },
            thread: { scrollToBottom: { tooltip: "Scroll to bottom" } },
        },
        assistantMessage: {
            components: { Text: MarkdownText },
        },
        assistantAvatar: { },
    } as const;

    return (
        <Box
            style={{
                position: "fixed", inset: 0, zIndex: 1300,
                background: isMobile ? "var(--console-canvas)" : "color-mix(in srgb, #000 45%, transparent)",
                display: "flex", flexDirection: isMobile ? "column" : "row", justifyContent: "flex-end",
            }}
            onClick={isMobile ? undefined : onClose}
            data-testid="commission-dock"
        >
            <Box
                onClick={(e: any) => e.stopPropagation()}
                className="commission-dock-panel"
                style={{
                    marginLeft: isMobile ? 0 : "auto",
                    width: isMobile ? "100%" : "min(620px, 100%)",
                    height: "100%",
                    background: "var(--console-canvas)",
                    borderLeft: isMobile ? "none" : "var(--hairline-w) solid var(--hairline)",
                    display: "flex", flexDirection: "column",
                    boxShadow: isMobile ? "none" : "-24px 0 64px rgba(0,0,0,0.35)",
                }}
            >
                <AssistantRuntimeProvider runtime={runtime}>
                    <Flex direction="column" h="full" minH={0}>
                            {/* Header */}
                            <Flex align="center" justify="space-between" px={4} py={2.5} borderBottom="var(--hairline-w) solid var(--hairline)" flexShrink={0}>
                                <Flex align="center" gap={2} minW={0}>
                                    <Text fontSize="15px" fontWeight={700} letterSpacing="-0.01em" color="var(--ink-primary)">
                                        Draft with AI
                                    </Text>
                                    <Text fontSize="11.5px" color="var(--ink-tertiary)" display={{ base: "none", md: "block" }}>
                                        Changes render as sheets you approve — nothing applies silently.
                                    </Text>
                                </Flex>
                                <Flex gap={2} align="center" flexShrink={0}>
                                    {changes.length > 0 && (
                                        <Button size="sm" variant="surface" colorPalette="blue" minH="36px" onClick={apply}>
                                            Apply {changes.length} change{changes.length === 1 ? "" : "s"}
                                        </Button>
                                    )}
                                    {changes.length > 0 && (
                                        <Button size="sm" variant="ghost" minH="36px" onClick={discardAll}>
                                            Discard
                                        </Button>
                                    )}
                                    <Button size="sm" variant="subtle" minH="36px" onClick={onClose} aria-label="Close AI draft">
                                        <LuX size={16} />
                                    </Button>
                                </Flex>
                            </Flex>

                            {/* Model picker */}
                            {availableModels.length > 0 && (
                                <Flex align="center" gap={2} px={4} py={2} borderBottom="var(--hairline-w) solid var(--hairline)" flexShrink={0}>
                                    <Text fontSize="10px" letterSpacing="0.1em" textTransform="uppercase" color="var(--ink-tertiary)">Model</Text>
                                    <select
                                        value={selectedModel}
                                        onChange={(e) => setSelectedModel(e.target.value)}
                                        aria-label="Model"
                                        style={{
                                            fontSize: "12px", padding: "4px 24px 4px 8px", borderRadius: "4px",
                                            border: "var(--hairline-w) solid var(--hairline)", background: "var(--console-panel)",
                                            color: "var(--ink-primary)", cursor: "pointer", maxWidth: "100%",
                                        }}
                                    >
                                        {availableModels.map((m) => <option key={m} value={m}>{m}</option>)}
                                    </select>
                                </Flex>
                            )}

                            {/* The official Thread UI — Thread is itself FC<ThreadConfig>,
                                so the config goes straight on it as props. */}
                            <Box flex={1} minH={0} display="flex" flexDirection="column">
                                <Thread {...(threadConfig as any)} />
                            </Box>
                        </Flex>
                </AssistantRuntimeProvider>

                {/* Attach row + documents */}
                <Flex px={4} py={2} gap={2} borderTop="var(--hairline-w) solid var(--hairline)" bg="var(--console-panel)" align="center" flexShrink={0}>
                    <label style={{ cursor: "pointer", fontSize: "12px", color: "var(--ink-secondary)", display: "flex", alignItems: "center", gap: 6 }}>
                        📎 Attach
                        <input
                            type="file" multiple style={{ display: "none" }}
                            onChange={(e) => {
                                const files = Array.from(e.target.files || []);
                                if (files.length) handleUpload(files);
                                e.target.value = "";
                            }}
                        />
                    </label>
                    <Text fontSize="10.5px" color="var(--ink-tertiary)" ml="auto">
                        Reference documents are read before each turn.
                    </Text>
                </Flex>
                {documents.length > 0 && (
                    <Flex px={4} py={1.5} gap={1.5} wrap="wrap" borderTop="var(--hairline-w) solid var(--hairline)" bg="var(--console-panel)" flexShrink={0}>
                        {documents.map((d, i) => (
                            <Flex key={`${d.filename}-${i}`} align="center" gap={1.5} px={2} py={0.5} border="var(--hairline-w) solid var(--hairline)" borderRadius="full" bg="var(--surface-canvas)">
                                <Text fontSize="11px" color={d.status === "error" ? "var(--signal-negative)" : "var(--ink-secondary)"} maxW="180px" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
                                    {d.status === "uploading" ? `Uploading ${d.filename}…` : d.filename}
                                </Text>
                                {d.status === "uploading" && <Spinner size="xs" />}
                            </Flex>
                        ))}
                    </Flex>
                )}
            </Box>
        </Box>
    );
}
