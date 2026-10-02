import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
    useLocalRuntime,
    makeAssistantToolUI,
    useAuiEvent,
    type ChatModelAdapter,
    type AssistantRuntime,
    AssistantRuntimeProvider,
    type ThreadMessage,
} from "@assistant-ui/react";
import { Thread } from "@/components/assistant-ui/elements/thread.aui";
import {
    ToolGroupRoot, ToolGroupTrigger, ToolGroupContent,
} from "@/components/assistant-ui/elements/tool-group.aui";
import {
    Sparkles, Bot, Blocks, ArrowRightLeft, FileText, Info, X, Check, ChevronDown, CheckIcon,
} from "lucide-react";
import { BuilderService, SkillService, AnalysisService, SettingsService, isServerFreeModel } from "@/db";
import { diffDraft } from "@/lib/draftDiff";
import { toaster } from "@/compat/ui";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { ModelLogo, providerDisplayName } from "@/lib/modelLogos";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { DocumentAttachmentAdapter } from "@/pages/console/DocumentAttachmentAdapter";

/**
 * AI Builder — one chat, in the console's content area, that builds both
 * agents and skills. Built on the official assistant-ui Thread: markdown,
 * regenerate, copy, edit, attachments — everything the package already does
 * well. Agent changes arrive as in-chat proposal sheets with Approve/Discard
 * buttons; skill drafts render as in-chat save cards.
 */

let msgSeq = 0;
function nextId(prefix: string) {
    return `${prefix}-${++msgSeq}-${Date.now()}`;
}

/** Toast for rejected attachment adds (bad file type, upload failure). */
function AttachmentErrorListener() {
    useAuiEvent("composer.attachmentAddError", ({ message }) => {
        toaster.create({
            title: "Attachment not added",
            description: message.includes("Accepted types:")
                ? "That file type isn't supported. Try a text file (txt, md, csv, json, code…), PDF, or Office document."
                : message,
            type: "error",
        });
    });
    return null;
}

type BuilderMode = "agent" | "skill";

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

/* ── Proposal sheet: the in-chat approve/reject card (agent mode) ──────── */

interface ProposalArgs {
    proposal: Record<string, unknown>;
    summary: string;
}
interface ProposalResult {
    decision?: "approved" | "discarded";
}

/** Bridge so tool-call sheets reach the builder's approve/discard handler. */
let sheetActionsRef: ((action: "approve" | "discard", args: ProposalArgs) => void) | null = null;

function ProposalSheet(props: any) {
    const { args, result } = props as { args?: ProposalArgs; result?: ProposalResult | null };
    if (!args?.proposal) return null;
    if (result?.decision) {
        return (
            <div className="aui-sheet my-2 rounded-xl bg-console-recessed/70 px-3.5 py-2.5">
                <p className={cn(
                    "text-xs font-medium",
                    result.decision === "approved" ? "text-console-positive" : "text-console-ink-3",
                )}>
                    {result.decision === "approved"
                        ? "Approved — staged. Review the summary, then Apply."
                        : "Discarded — your agent is untouched."}
                </p>
            </div>
        );
    }
    return (
        <div className="aui-sheet my-2 overflow-hidden rounded-2xl bg-console-accent-soft/60 shadow-console">
            <div className="px-4 py-3">
                <p className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold tracking-wide text-console-accent-strong">
                    <Bot className="size-3.5" /> Proposed changes
                </p>
                <p className="text-[13px] leading-relaxed text-console-ink-2">{args.summary}</p>
            </div>
            <div className="flex justify-end gap-2 px-4 py-2.5">
                <Button size="xs" variant="ghost" onClick={() => sheetActionsRef?.("discard", args)}>
                    <X /> Discard
                </Button>
                <Button size="xs" onClick={() => sheetActionsRef?.("approve", args)}>
                    <Check /> Approve & stage
                </Button>
            </div>
        </div>
    );
}

/* ── Skill draft card: the in-chat draft sheet (skill mode) ──────────────
   The draft is the payload — it renders visible by default (collapsed to a
   reasonable height, expandable), with the three decisions the user can
   make: accept & save, improve in chat (sends the draft back as a refine
   prompt), or reject. ── */

interface SkillDraftArgs {
    markdown: string;
    name: string;
    valid: boolean;
}
interface SkillDraftResult {
    decision?: "saved" | "dismissed";
}

let skillSheetRef: ((action: "save" | "dismiss" | "improve") => void) | null = null;
let runtimeRef: AssistantRuntime | null = null;

function SkillDraftSheet(props: any) {
    const { args, result } = props as { args?: SkillDraftArgs; result?: SkillDraftResult | null };
    if (!args?.markdown) return null;
    const [expanded, setExpanded] = useState(false);
    const lines = args.markdown.split("\n").length;

    if (result?.decision) {
        return (
            <div className="aui-sheet my-2 rounded-xl bg-console-recessed/70 px-3.5 py-2.5">
                <p className={cn("text-xs font-medium", result.decision === "saved" ? "text-console-positive" : "text-console-ink-3")}>
                    {result.decision === "saved" ? "✓ Saved to your skill library." : "Dismissed — nothing was saved."}
                </p>
            </div>
        );
    }
    return (
        <div className="aui-sheet my-2 overflow-hidden rounded-2xl bg-console-surface shadow-console">
            <div className="flex items-center justify-between px-4 py-2.5">
                <p className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold text-console-ink">
                    <FileText className="size-4 shrink-0 text-console-accent" />
                    <span className="truncate">Draft skill{args.name ? `: ${args.name}` : ""}</span>
                    <span className="shrink-0 text-[11px] font-normal text-console-ink-4">{lines} lines</span>
                </p>
                <Button size="xs" variant="ghost" onClick={() => setExpanded((v) => !v)}>
                    {expanded ? "Collapse" : "View full"}
                </Button>
            </div>
            {/* The draft itself — always visible, scrollable; expanded removes the cap. */}
            <pre
                className={cn(
                    "overflow-y-auto bg-console-recessed px-4 py-3 font-mono text-[11.5px] leading-relaxed break-words whitespace-pre-wrap text-console-ink-2",
                    expanded ? "max-h-[60vh]" : "max-h-48",
                )}
            >
                {args.markdown}
            </pre>
            <div className="flex flex-wrap items-center justify-end gap-2 px-4 py-2.5">
                <Button size="xs" variant="ghost" onClick={() => skillSheetRef?.("dismiss")}>
                    <X /> Reject
                </Button>
                <Button
                    size="xs"
                    variant="secondary"
                    onClick={() => skillSheetRef?.("improve")}
                    title="Sends the draft back to the chat so you can refine it with follow-up prompts"
                >
                    <Sparkles /> Improve
                </Button>
                <Button size="xs" onClick={() => skillSheetRef?.("save")}>
                    <Check /> Accept & save
                </Button>
            </div>
        </div>
    );
}

/* ── Tool UIs — registered through makeAssistantToolUI, the shape the
      assistant-ui runtime expects for tool-call renderers. ── */
const AgentProposalUI = makeAssistantToolUI({
    toolName: "agent_proposal",
    render: ProposalSheet,
});
const SkillDraftUI = makeAssistantToolUI({
    toolName: "skill_draft",
    render: SkillDraftSheet,
});

/* ── Builder welcome + chats-not-saved note ─────────────────────────── */

function BuilderWelcome() {
    return (
        <div className="aui-thread-welcome-root mb-6 flex flex-col px-2">
            <p className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-2xl font-medium tracking-tight duration-200">
                Let's build. Describe the agent or skill you have in mind.
            </p>
        </div>
    );
}

export default function AiBuilder() {
    const [searchParams, setSearchParams] = useSearchParams();
    const navigate = useNavigate();

    const modeParam = (searchParams.get("mode") as BuilderMode) || "agent";
    const agentIdParam = searchParams.get("agent");
    const skillIdParam = searchParams.get("skill");
    const mode: BuilderMode = modeParam === "skill" ? "skill" : "agent";

    const [agentContext, setAgentContext] = useState<any>(null);
    const [skillContext, setSkillContext] = useState<SkillSummaryLite | null>(null);
    const [metrics, setMetrics] = useState<{ id: string; name: string; type: string }[]>([]);
    const [availableModels, setAvailableModels] = useState<string[]>([]);
    const [selectedModel, setSelectedModel] = useState("");
    const [webSearch, setWebSearch] = useState(true);
    const [proposal, setProposal] = useState<Record<string, unknown> | null>(null);
    const [skillDraft, setSkillDraft] = useState<SkillDraftArgs | null>(null);
    const [savingSkill, setSavingSkill] = useState(false);

    interface SkillSummaryLite {
        id: string;
        name: string;
        markdown?: string;
    }

    const sessionIdRef = useRef<string>(
        typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `builder-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    const proposalRef = useRef<Record<string, unknown> | null>(proposal);
    proposalRef.current = proposal;
    const skillDraftRef = useRef<SkillDraftArgs | null>(skillDraft);
    skillDraftRef.current = skillDraft;
    const webSearchRef = useRef(webSearch);
    webSearchRef.current = webSearch;

    // Load context: agent draft or existing skill document.
    useEffect(() => {
        let cancelled = false;
        if (mode === "agent") {
            if (!agentIdParam || agentIdParam === "new") { setAgentContext(normalizeAgent({})); return; }
            import("@/db").then(({ AgentService }) => AgentService.readAgent(agentIdParam))
                .then((data) => { if (!cancelled) setAgentContext(normalizeAgent(data)); })
                .catch(() => { if (!cancelled) setAgentContext(normalizeAgent({})); });
        } else {
            if (!skillIdParam) { setSkillContext(null); return; }
            SkillService.readSkill(skillIdParam)
                .then((s) => { if (!cancelled) setSkillContext({ id: s.id || skillIdParam, name: s.name || "", markdown: s.markdown || "" }); })
                .catch(() => { if (!cancelled) setSkillContext(null); });
        }
        return () => { cancelled = true; };
    }, [mode, agentIdParam, skillIdParam]);

    // Reset staged state on context switch.
    useEffect(() => {
        setProposal(mode === "agent" ? agentContext : null);
        setSkillDraft(null);
    }, [mode, agentContext]);

    useEffect(() => {
        if (mode !== "skill") return;
        if (skillContext?.markdown) setSkillDraft({ markdown: skillContext.markdown, name: skillContext.name, valid: true });
    }, [mode, skillContext]);

    useEffect(() => {
        if (mode !== "agent") return;
        import("@/db").then(({ VoyagerService }) => VoyagerService.getAvailableMetrics("NSE"))
            .then((d) => { if (d?.fields) setMetrics(d.fields); })
            .catch(() => {});
    }, [mode]);

    useEffect(() => {
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

    /* ── Agent-mode adapter: BuilderService → assistant-ui generator ───── */

    const runAgentTurn = useCallback(async function* (messages: readonly ThreadMessage[]): AsyncGenerator<any, void, unknown> {
        const wire = messages.map((m) => {
            const text = m.content.map((p: any) => (p.type === "text" ? p.text : "")).join("").trim();
            return { role: m.role as "user" | "assistant", content: text };
        }).filter((m) => m.content);

        let result: Awaited<ReturnType<typeof BuilderService.draft>>;
        try {
            result = await BuilderService.draft({
                session_id: sessionIdRef.current,
                messages: wire,
                agent_draft: proposalRef.current || {},
                metrics,
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
        if (result.agent_draft_update) {
            const prev = proposalRef.current || normalizeAgent({});
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
    }, [metrics, selectedModel]);

    /* ── Skill-mode adapter: SkillService.draftSkill → generator ───────── */

    const runSkillTurn = useCallback(async function* (messages: readonly ThreadMessage[]): AsyncGenerator<any, void, unknown> {
        const wire = messages.map((m) => {
            const text = m.content.map((p: any) => (p.type === "text" ? p.text : "")).join("").trim();
            return { role: m.role as "user" | "assistant", content: text };
        }).filter((m) => m.content);

        try {
            const res = await SkillService.draftSkill({
                messages: wire,
                requirements: wire[wire.length - 1]?.content || "",
                current_draft: skillDraftRef.current?.markdown || "",
                web_search: webSearchRef.current,
                model_id: selectedModel || undefined,
            });
            const parts: any[] = [{ type: "text" as const, text: res.message }];
            if (res.valid && res.skill_markdown) {
                const name = res.skill_markdown.match(/^name:\s*(.+)$/m)?.[1]?.trim() || "";
                setSkillDraft({ markdown: res.skill_markdown, name, valid: true });
                parts.push({
                    type: "tool-call" as const,
                    toolCallId: nextId("skilldraft"),
                    toolName: "skill_draft",
                    args: { markdown: res.skill_markdown, name, valid: true } satisfies SkillDraftArgs,
                    result: null,
                });
            }
            yield { content: parts, status: { reason: "unknown", type: "complete" } as any };
        } catch (e: any) {
            const serverMsg = e?.response?.data?.error;
            const msg = serverMsg || e?.message || String(e);
            yield {
                content: [{
                    type: "text" as const,
                    text: msg.includes("status code")
                        ? "Draft failed: the model didn't respond in time. Check that your API keys are set in Settings, then try again."
                        : `Draft failed: ${msg}`,
                }],
                status: { reason: "error", type: "incomplete" } as any,
            };
        }
    }, [selectedModel]);

    const adapter: ChatModelAdapter = useMemo(
        () => ({
            // run(options) — unwrap the message list for the turn generators.
            run: async function* (options) {
                yield* (mode === "agent" ? runAgentTurn : runSkillTurn)(options.messages);
            },
        }),
        [mode, runAgentTurn, runSkillTurn],
    );

    const runtime = useLocalRuntime(adapter, {
        adapters: useMemo(() => ({ attachments: new DocumentAttachmentAdapter() }), []),
    });
    // The sheet-action bridge lives outside React; keep the latest runtime
    // reachable for composer seeding (e.g. the Improve action).
    runtimeRef = runtime;

    /* ── Sheet actions ─────────────────────────────────────────────────── */

    useEffect(() => {
        sheetActionsRef = (action, args) => {
            if (action === "approve") {
                setProposal(normalizeAgent(args.proposal));
                toaster.create({ title: "Changes staged", description: "Review the summary above the composer, then Apply.", type: "success" });
            } else {
                toaster.create({ title: "Changes discarded", type: "info" });
            }
        };
        return () => { sheetActionsRef = null; };
    }, []);

    useEffect(() => {
        skillSheetRef = (action) => {
            const draft = skillDraftRef.current;
            if (action === "dismiss") {
                setSkillDraft(null);
                return;
            }
            if (action === "improve") {
                // Refine-in-chat: the current draft is already the working
                // baseline (skillDraftRef); the user's next prompt refines it.
                // Seed the composer so the chat stays the single editing surface.
                runtimeRef?.thread.composer.setText("Improve the draft: ");
                return;
            }
            if (!draft) return;
            setSavingSkill(true);
            SkillService.saveSkill(draft.markdown)
                .then(({ skill }) => {
                    setSkillDraft(null);
                    toaster.create({ title: `${skill.name} saved`, description: "It's in your Agent Skills library.", type: "success" });
                })
                .catch((e: any) => {
                    const issues = e?.response?.data?.issues;
                    toaster.create({
                        title: "Save failed",
                        description: issues?.length
                            ? issues.map((i: any) => i.message).join(" · ")
                            : e?.message || "Please try again.",
                        type: "error",
                    });
                })
                .finally(() => setSavingSkill(false));
        };
        return () => { skillSheetRef = null; };
    }, []);

    /* ── Apply staged agent changes ────────────────────────────────────── */

    const applyChanges = () => {
        if (mode !== "agent" || !proposal || !agentIdParam || agentIdParam === "new") return;
        const P = proposal as {
            name?: string;
            philosophy?: string;
            persona?: Record<string, unknown>;
            configuration?: Record<string, unknown>;
            skills?: { skill_id: string; weight: number }[];
        };
        // Fetch fresh, merge, save.
        import("@/db").then(({ AgentService }) => AgentService.readAgent(agentIdParam))
            .then((current) => {
                const merged = {
                    name: P.name || current?.name,
                    persona: P.philosophy
                        ? { philosophy: P.philosophy }
                        : { ...(current?.persona || {}), ...(P.persona || {}) },
                    configuration: { ...(current?.configuration || {}), ...P.configuration },
                    skills: Array.isArray(P.skills) && P.skills.length ? P.skills : (current?.skills || []),
                    id: agentIdParam,
                    _id: agentIdParam,
                };
                return AgentService.updateAgent(merged);
            })
            .then(() => {
                toaster.create({ title: "Changes applied to your agent", type: "success" });
                setProposal(agentContext);
                navigate(`/console/agent/${agentIdParam}`);
            })
            .catch((e: any) => {
                toaster.create({ title: "Couldn't apply", description: e?.message, type: "error" });
            });
    };

    const stagedCount = useMemo(() => {
        if (mode !== "agent" || !proposal) return 0;
        return diffDraft(normalizeAgent(agentContext || {}), proposal).length;
    }, [mode, proposal, agentContext]);

    // Tool renderers mount inside the runtime; the official Thread element
    // renders their output wherever the tool-call parts appear.
    const toolUIs = mode === "agent"
        ? <AgentProposalUI />
        : <SkillDraftUI />;

    return (
        <AssistantRuntimeProvider runtime={runtime}>
            <AttachmentErrorListener />
            <div className="flex h-full min-h-0 flex-col">
                {/* Header: mode switch + model + context */}
                <div className="flex flex-wrap items-center gap-3 px-8 pt-6 pb-3">
                    <div>
                        <h1 className="flex items-center gap-2 text-[22px] font-bold tracking-tight text-console-ink">
                            <Sparkles className="size-5 text-console-accent" />
                            AI Builder
                        </h1>
                        <p className="mt-0.5 text-[13px] text-console-ink-2">
                            {mode === "agent"
                                ? agentContext && (agentContext as any).name
                                    ? `Co-writing “${(agentContext as any).name}”`
                                    : "Co-writing a new agent"
                                : skillContext
                                    ? `Revising “${skillContext.name}”`
                                    : "Designing a new skill"}
                        </p>
                    </div>

                    <div className="ml-auto flex flex-wrap items-center gap-2">
                        {/* Mode switch — animated chips */}
                        <div className="flex rounded-lg bg-console-recessed p-[3px]">
                            {([
                                { key: "agent", label: "Agent", icon: Bot },
                                { key: "skill", label: "Skill", icon: Blocks },
                            ] as const).map((m) => (
                                <button
                                    key={m.key}
                                    onClick={() => {
                                        const next = new URLSearchParams(searchParams);
                                        next.set("mode", m.key);
                                        next.delete("agent");
                                        next.delete("skill");
                                        setSearchParams(next, { replace: true });
                                    }}
                                    aria-pressed={mode === m.key}
                                    className={cn(
                                        "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-console-accent/40",
                                        mode === m.key
                                            ? "bg-console-surface text-console-ink shadow-console"
                                            : "text-console-ink-3 hover:text-console-ink",
                                    )}
                                >
                                    <m.icon className="size-3.5" /> {m.label}
                                </button>
                            ))}
                        </div>

                        {/* Model picker — provider logos + grouped menu */}
                        {availableModels.length > 0 && (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="outline" size="sm" className="w-56 justify-start" aria-label="Model">
                                        {selectedModel ? (
                                            <span className="flex min-w-0 items-center gap-2">
                                                <ModelLogo model={selectedModel} size={14} />
                                                <span className="truncate">{selectedModel}</span>
                                            </span>
                                        ) : (
                                            "Select model"
                                        )}
                                        <ChevronDown className="ml-auto size-3.5" aria-hidden="true" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start" className="max-h-80 w-72 overflow-y-auto">
                                    {(() => {
                                        const groups = new Map<string, string[]>();
                                        for (const m of availableModels) {
                                            const p = (m.split("/")[0] || m).toLowerCase();
                                            if (!groups.has(p)) groups.set(p, []);
                                            groups.get(p)!.push(m);
                                        }
                                        return [...groups.entries()].map(([prefix, models]) => (
                                            <DropdownMenuGroup key={prefix}>
                                                <DropdownMenuLabel className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-console-ink-3">
                                                    <ModelLogo model={prefix} size={12} />
                                                    {providerDisplayName(prefix)}
                                                    <span className="ml-auto font-mono text-[10px] text-console-ink-4">{models.length}</span>
                                                </DropdownMenuLabel>
                                                {models.map((m) => (
                                                    <DropdownMenuItem key={m} onClick={() => setSelectedModel(m)} className="gap-2">
                                                        <ModelLogo model={m} size={14} />
                                                        <span className="min-w-0 flex-1 truncate">{m}</span>
                                                        {m === selectedModel && <CheckIcon aria-hidden="true" className="size-3.5" />}
                                                    </DropdownMenuItem>
                                                ))}
                                            </DropdownMenuGroup>
                                        ));
                                    })()}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        )}

                        {/* Web search toggle (skill mode) */}
                        {mode === "skill" && (
                            <label className="flex cursor-pointer items-center gap-2 text-xs text-console-ink-2">
                                <Switch checked={webSearch} onCheckedChange={setWebSearch} aria-label="Web search" />
                                Web search
                            </label>
                        )}
                    </div>
                </div>

                {/* Staged changes bar (agent mode) */}
                {mode === "agent" && stagedCount > 0 && (
                    <div className="mx-8 mb-2 flex items-center gap-3 rounded-xl bg-console-accent-soft px-4 py-2.5">
                        <Badge variant="accent">{stagedCount} staged change{stagedCount === 1 ? "" : "s"}</Badge>
                        <p className="min-w-0 flex-1 truncate text-xs text-console-ink-2">
                            Approved in chat — review, then apply to the agent.
                        </p>
                        <Button size="xs" variant="ghost" onClick={() => setProposal(agentContext)}>
                            Discard
                        </Button>
                        <Button size="xs" onClick={applyChanges} disabled={!agentIdParam || agentIdParam === "new"}>
                            <ArrowRightLeft /> Apply to agent
                        </Button>
                    </div>
                )}

                {/* In-chat tool renderers (proposal sheets / skill drafts) */}
                {toolUIs}

                {/* The official assistant-ui Thread element — fills the content area.
                    Attachments (agent mode) live in the composer: the paperclip
                    stages files, the DocumentAttachmentAdapter uploads them on send. */}
                <div className="min-h-0 flex-1 px-8">
                    <Thread
                        autoFocus={false}
                        components={{
                            Welcome: BuilderWelcome,
                            // Tool calls in the builder are the payload — proposal
                            // sheets and draft skills must be visible without a
                            // second click, so the group renders open by default.
                            ToolGroup: ({ group, children }) => (
                                <ToolGroupRoot variant="ghost" defaultOpen>
                                    <ToolGroupTrigger count={group.indices.length} active={group.status.type === "running"} />
                                    <ToolGroupContent>{children}</ToolGroupContent>
                                </ToolGroupRoot>
                            ),
                        }}
                    />
                </div>

                {/* Chats are working scratch space, not history: they reset on
                    reload. Approve-and-apply (agents) or save (skills) is the
                    only way to keep work. */}
                <p className="flex items-center justify-center gap-1.5 px-8 pb-2 pt-1 text-center text-[11px] text-console-ink-3">
                    <Info className="size-3" />
                    Chats aren't saved — apply approved changes or save drafts before you leave.
                </p>
            </div>
        </AssistantRuntimeProvider>
    );
}
