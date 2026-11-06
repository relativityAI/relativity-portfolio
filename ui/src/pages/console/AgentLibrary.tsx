import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Search, Plus, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { AgentService, SkillService, type SkillSummary } from "@/db";
import AgentAvatar from "@/components/shared/AgentAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toaster } from "@/compat/ui";
import { cn } from "@/lib/utils";
import AgentSkills from "./AgentSkills";

/**
 * Agents & Skills — one workspace page. Top half: agents as a typographic
 * index; a row expands into an inline editor (name, ONE skill, raw-markdown
 * system prompt with debounced autosave) and "New agent" opens the same form
 * in place — there is no separate editor page. Blank name/prompt fields are
 * never persisted: the last saved text is restored on blur, so a stray
 * select-all-delete can't wipe a soul. The skill library sits underneath,
 * unchanged.
 */

interface Agent {
    _id?: string;
    id?: string;
    name: string;
    created_at?: string;
    persona?: { philosophy?: string; philosophy_and_mindset?: string };
    skills?: { skill_id: string; weight: number }[];
}

interface Draft {
    name: string;
    soul: string;
    skill: string;
}

function soulOf(a: Agent): string {
    return a.persona?.philosophy || a.persona?.philosophy_and_mindset || "";
}

function toDraft(a: Agent): Draft {
    return { name: a.name || "", soul: soulOf(a), skill: a.skills?.[0]?.skill_id || "" };
}

/** First sentence of the prompt — the agent's full one-line description. */
function creedOf(a: Agent): string {
    return soulOf(a).replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s/)[0] || "";
}

function formatDate(dateStr?: string): string {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** One skill per agent — native select, the platform's own picker. */
function SkillSelect({ value, onChange, skills }: { value: string; onChange: (id: string) => void; skills: SkillSummary[] }) {
    return (
        <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-label="Agent skill"
            className="h-9 w-full max-w-64 cursor-pointer rounded-none border-[0.5px] border-[color:var(--hairline)] bg-transparent px-2 text-sm text-console-ink shadow-none outline-none focus-visible:ring-1 focus-visible:ring-console-accent/40 dark:bg-transparent"
        >
            <option value="">No skill</option>
            {skills.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
            ))}
        </select>
    );
}

const SOUL_TEXTAREA =
    "min-h-56 w-full resize-y rounded-none border-[0.5px] border-[color:var(--hairline)] bg-transparent px-2.5 py-2 font-mono text-[13px] leading-relaxed shadow-none placeholder:text-console-ink-4 focus-visible:ring-1 focus-visible:ring-console-accent/40 dark:bg-transparent";

const FIELD_INPUT =
    "h-9 rounded-none border-[0.5px] border-[color:var(--hairline)] bg-transparent px-2.5 text-sm shadow-none placeholder:text-console-ink-4 focus-visible:ring-1 focus-visible:ring-console-accent/40 dark:bg-transparent";

export default function AgentLibrary() {
    const [searchParams, setSearchParams] = useSearchParams();
    const [agents, setAgents] = useState<Agent[]>([]);
    const [skills, setSkills] = useState<SkillSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [fetchError, setFetchError] = useState(false);
    const [query, setQuery] = useState("");
    const [expanded, setExpanded] = useState<string | null>(null);
    const [draft, setDraft] = useState<Draft | null>(null);
    const [dirty, setDirty] = useState(false);
    const [saving, setSaving] = useState(false);
    const [createOpen, setCreateOpen] = useState(() => searchParams.get("new") === "1");
    const [newDraft, setNewDraft] = useState<Draft>({ name: "", soul: "", skill: "" });
    const [deleteTarget, setDeleteTarget] = useState<Agent | null>(null);
    const [deleting, setDeleting] = useState(false);

    /* ── Load ─────────────────────────────────────────────────────────── */

    useEffect(() => {
        let cancelled = false;
        AgentService.listAgents()
            .then((data) => {
                if (cancelled) return;
                setAgents(Array.isArray(data) ? data : []);
                setFetchError(!Array.isArray(data));
            })
            .catch(() => { if (!cancelled) { setAgents([]); setFetchError(true); } })
            .finally(() => { if (!cancelled) setLoading(false); });
        SkillService.listSkills()
            .then((data) => { if (!cancelled && Array.isArray(data)) setSkills(data); })
            .catch(() => {});
        return () => { cancelled = true; };
    }, []);

    // Old deep links (/my-workspace/agent/:id, builder hand-off) open that row.
    useEffect(() => {
        const want = searchParams.get("agent");
        if (!want || loading) return;
        const a = agents.find((x) => (x.id || x._id) === want);
        if (!a) return;
        setExpanded(want);
        setDraft(toDraft(a));
        setDirty(false);
        setCreateOpen(false);
        setSearchParams({}, { replace: true });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams, agents, loading]);

    const nameOf = (id: string) => skills.find((s) => s.id === id)?.name || id;

    /* ── Inline editor: debounced autosave, never a blank prompt ──────── */

    const saveDraft = async (id: string, d: Draft): Promise<boolean> => {
        if (!d.name.trim() || !d.soul.trim()) return false; // blank → keep the last saved version
        setSaving(true);
        try {
            const payload = {
                id,
                _id: id,
                name: d.name.trim(),
                persona: { philosophy: d.soul },
                skills: d.skill ? [{ skill_id: d.skill, weight: 5 }] : [],
            };
            await AgentService.updateAgent(payload);
            setAgents((prev) =>
                prev.map((a) => ((a.id || a._id) === id ? { ...a, name: payload.name, persona: payload.persona, skills: payload.skills } : a)),
            );
            setDirty(false);
            return true;
        } catch (e: any) {
            toaster.create({
                title: "Couldn't save",
                description: e?.response?.data?.error || e?.message || "Please try again.",
                type: "error",
            });
            return false;
        } finally {
            setSaving(false);
        }
    };

    useEffect(() => {
        if (!dirty || !expanded || !draft) return;
        if (!draft.name.trim() || !draft.soul.trim()) return; // never persist a blank field
        const t = setTimeout(() => { void saveDraft(expanded, draft); }, 700);
        return () => clearTimeout(t);
    }, [dirty, expanded, draft]);

    /** Leaving a blank field puts the last saved text back — raw markdown
     *  stays editable, but an accidental select-all-delete can't stick. */
    const restoreIfBlank = () => {
        if (!expanded || !draft) return;
        if (draft.name.trim() && draft.soul.trim()) return;
        const saved = agents.find((x) => (x.id || x._id) === expanded);
        if (!saved) return;
        const base = toDraft(saved);
        setDraft({
            name: draft.name.trim() ? draft.name : base.name,
            soul: draft.soul.trim() ? draft.soul : base.soul,
            skill: draft.skill,
        });
        toaster.create({
            title: "Blank field restored",
            description: "An agent's name and prompt can't be empty — the last saved text came back.",
            type: "info",
        });
    };

    const patchDraft = (p: Partial<Draft>) => {
        setDraft((d) => (d ? { ...d, ...p } : d));
        setDirty(true);
    };

    const toggleAgent = (a: Agent) => {
        const id = a.id || a._id || "";
        if (expanded === id) {
            // Flush the pending debounce — collapsing must not drop typing.
            if (dirty && draft && draft.name.trim() && draft.soul.trim()) void saveDraft(id, draft);
            setExpanded(null);
            setDraft(null);
            setDirty(false);
        } else {
            setExpanded(id);
            setDraft(toDraft(a));
            setDirty(false);
            setCreateOpen(false);
        }
    };

    /* ── Create (inline mini-form) ────────────────────────────────────── */

    const openCreate = () => {
        setCreateOpen(true);
        setExpanded(null);
        setDraft(null);
        setDirty(false);
        setNewDraft({ name: "", soul: "", skill: skills[0]?.id || "" });
    };

    const adoptAgent = (created: Agent, d: Draft) => {
        const id = created.id || created._id || "";
        if (id) setAgents((prev) => [{ ...created, id, _id: id }, ...prev]);
        setCreateOpen(false);
        setNewDraft({ name: "", soul: "", skill: skills[0]?.id || "" });
        if (id) {
            setExpanded(id);
            setDraft(d);
            setDirty(false);
        }
    };

    const submitCreate = async () => {
        const name = newDraft.name.trim();
        const soul = newDraft.soul.trim();
        if (!name) {
            toaster.create({ title: "Name required", description: "Give this agent a name.", type: "error" });
            return;
        }
        if (!soul) {
            toaster.create({ title: "Prompt required", description: "An agent is its system prompt — write one to create it.", type: "error" });
            return;
        }
        try {
            const created = await AgentService.createAgent({
                name,
                persona: { philosophy: soul },
                skills: newDraft.skill ? [{ skill_id: newDraft.skill, weight: 5 }] : [],
            });
            adoptAgent(created || {}, { name, soul, skill: newDraft.skill });
            toaster.create({ title: "Agent created", type: "success" });
        } catch (e: any) {
            toaster.create({
                title: "Couldn't create the agent",
                description: e?.response?.data?.error || e?.message || "Please try again.",
                type: "error",
            });
        }
    };

    /* ── Delete ───────────────────────────────────────────────────────── */

    const handleDelete = async (id: string | undefined) => {
        if (!id) return;
        setDeleting(true);
        try {
            await AgentService.deleteAgent(id);
            setDeleteTarget(null);
            setAgents((prev) => prev.filter((a) => (a._id || a.id) !== id));
            if (expanded === id) { setExpanded(null); setDraft(null); setDirty(false); }
        } catch (e: any) {
            toaster.create({
                title: "Delete failed",
                description: e?.response?.data?.error || e?.message || "The agent could not be deleted. Please try again.",
                type: "error",
            });
        } finally {
            setDeleting(false);
        }
    };

    /* ── Derived ──────────────────────────────────────────────────────── */

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return agents;
        return agents.filter(
            (a) =>
                a.name?.toLowerCase().includes(q) ||
                creedOf(a).toLowerCase().includes(q) ||
                (a.skills || []).some((s) => nameOf(s.skill_id).toLowerCase().includes(q)),
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [agents, query, skills]);

    const blank = !!draft && (!draft.name.trim() || !draft.soul.trim());
    const saveState = saving
        ? { label: "Saving…", cls: "bg-console-accent animate-pulse" }
        : blank
            ? { label: "Blank — last saved version kept", cls: "bg-console-negative" }
            : dirty
                ? { label: "Unsaved changes", cls: "bg-console-negative" }
                : { label: "Saved", cls: "bg-console-positive" };

    return (
        <div className="w-full py-8">
            {/* Header — title, search, action on one line */}
            <div className="flex flex-wrap items-center gap-3">
                <h1 className="font-app-display shrink-0 text-[30px] leading-none font-normal tracking-tight text-console-ink">
                    Agents
                </h1>
                <div className="relative min-w-56 max-w-md flex-1">
                    <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-console-ink-4" />
                    <Input
                        className="h-9 rounded-[6px] pl-9"
                        placeholder="Search agents, prompts, skills…"
                        aria-label="Search agents"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                    />
                </div>
                <Button
                    size="sm"
                    variant="outline"
                    className="ml-auto rounded-[6px] px-4"
                    onClick={() => (createOpen ? setCreateOpen(false) : openCreate())}
                    data-testid="new-agent"
                >
                    <Plus /> {createOpen ? "Close" : "New agent"}
                </Button>
            </div>

            {/* ── Inline create form ── */}
            {createOpen && (
                <div className="mt-6 w-full bg-console-surface p-5 shadow-console" data-testid="agent-create-form">
                    <div className="flex flex-wrap items-end gap-4">
                        <label className="flex min-w-48 flex-1 flex-col gap-1.5">
                            <span className="font-app-body text-[10px] font-semibold tracking-[0.16em] text-console-ink-4 uppercase">Name</span>
                            <Input
                                value={newDraft.name}
                                onChange={(e) => setNewDraft((d) => ({ ...d, name: e.target.value }))}
                                placeholder="Untitled agent"
                                aria-label="Agent name"
                                className={FIELD_INPUT}
                                data-testid="agent-name-input"
                            />
                        </label>
                        <label className="flex min-w-48 flex-1 flex-col gap-1.5">
                            <span className="font-app-body text-[10px] font-semibold tracking-[0.16em] text-console-ink-4 uppercase">Skill</span>
                            <SkillSelect
                                value={newDraft.skill}
                                onChange={(id) => setNewDraft((d) => ({ ...d, skill: id }))}
                                skills={skills}
                            />
                        </label>
                    </div>
                    <label className="mt-4 flex flex-col gap-1.5">
                        <span className="font-app-body text-[10px] font-semibold tracking-[0.16em] text-console-ink-4 uppercase">
                            System prompt — raw markdown
                        </span>
                        <Textarea
                            value={newDraft.soul}
                            onChange={(e) => setNewDraft((d) => ({ ...d, soul: e.target.value }))}
                            placeholder={"You are an analyst who…\n\n## Beliefs\n- …\n\n## Rules\n- …"}
                            aria-label="Agent system prompt"
                            className={SOUL_TEXTAREA}
                            data-testid="agent-soul-input"
                        />
                    </label>
                    <div className="mt-4 flex items-center gap-2">
                        <Button size="sm" onClick={submitCreate} data-testid="agent-create-submit">
                            Create agent
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setCreateOpen(false)}>
                            Cancel
                        </Button>
                    </div>
                </div>
            )}

            {/* ── Your agents ── */}
            {loading ? (
                <div className="mt-4 space-y-4">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="h-16 animate-pulse rounded-none bg-console-recessed/30" />
                    ))}
                </div>
            ) : fetchError ? (
                <div className="mt-4 rounded-2xl bg-console-surface p-10 text-center shadow-console">
                    <p className="font-semibold text-console-ink">The Agent Console could not reach the server.</p>
                    <p className="mt-1 text-sm text-console-ink-2">The agent API may be unavailable. Reload to try again.</p>
                </div>
            ) : agents.length === 0 ? (
                <div className="mt-4 rounded-2xl bg-console-surface px-10 py-12 text-center shadow-console">
                    <p className="text-lg font-semibold text-console-ink">No agents yet.</p>
                    <p className="mx-auto mt-1.5 max-w-[46ch] text-sm text-console-ink-2">
                        An agent is a system prompt and a skill. Write the prompt and pick a skill to start.
                    </p>
                    <Button className="mt-5" onClick={openCreate}>
                        <Plus /> Create an agent
                    </Button>
                </div>
            ) : (
                <div className="mt-2 w-full">
                    {filtered.length === 0 && (
                        <p className="py-6 text-center text-sm text-console-ink-3">No agents match that search.</p>
                    )}
                    {filtered.map((agent) => {
                        const id = agent._id || agent.id || "";
                        const isOpen = expanded === id && !!draft;
                        const skill = agent.skills?.[0];
                        const creed = creedOf(agent);
                        return (
                            <div key={id} className="py-5">
                                <div className="group flex items-start gap-3">
                                    <button
                                        type="button"
                                        onClick={() => toggleAgent(agent)}
                                        aria-expanded={isOpen}
                                        aria-label={`${isOpen ? "Collapse" : "Edit"} ${agent.name || "agent"}`}
                                        className="flex w-full min-w-0 flex-wrap items-start gap-x-5 gap-y-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-console-accent/40"
                                    >
                                        <AgentAvatar agent={agent} size={40} label={agent.name || "Agent"} />
                                        {/* Left: name over the created date */}
                                        <span className="flex min-w-0 shrink flex-col gap-1">
                                            <span className="block truncate font-app-body text-[22px] leading-[1.1] tracking-[-0.015em] text-console-ink">
                                                {agent.name || "Untitled agent"}
                                            </span>
                                            <span className="block font-app-body text-[12px] font-normal text-console-ink-4">
                                                Created {formatDate(agent.created_at)}
                                            </span>
                                        </span>
                                        {/* Right: the full one-liner + skill */}
                                        <span className="ml-auto flex min-w-0 max-w-full flex-col gap-1 sm:max-w-[55%] sm:text-right">
                                            <span className={`font-app-body text-[14px] leading-snug font-light italic ${creed ? "text-console-ink-2" : "text-console-ink-4"}`}>
                                                “{creed || "No prompt written yet."}”
                                            </span>
                                            <span className="font-app-body text-[12px] font-normal text-console-ink-3">
                                                {skill ? `Skill · ${nameOf(skill.skill_id)}` : "No skill attached"}
                                            </span>
                                        </span>
                                    </button>
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        aria-label={`Delete ${agent.name || "agent"}`}
                                        className="mt-1 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                                        onClick={() => setDeleteTarget(agent)}
                                    >
                                        <Trash2 className="text-console-ink-3" />
                                    </Button>
                                    {isOpen ? <ChevronDown className="mt-2 size-4 shrink-0 text-console-ink-4" /> : <ChevronRight className="mt-2 size-4 shrink-0 text-console-ink-4" />}
                                </div>

                                {isOpen && (
                                    <div className="mt-4 w-full" data-testid="agent-inline-editor">
                                        <div className="flex flex-wrap items-end gap-4">
                                            <label className="flex min-w-44 flex-1 flex-col gap-1.5">
                                                <span className="font-app-body text-[10px] font-semibold tracking-[0.16em] text-console-ink-4 uppercase">Name</span>
                                                <Input
                                                    value={draft!.name}
                                                    onChange={(e) => patchDraft({ name: e.target.value })}
                                                    onBlur={restoreIfBlank}
                                                    placeholder="Untitled agent"
                                                    aria-label="Agent name"
                                                    className={FIELD_INPUT}
                                                />
                                            </label>
                                            <label className="flex min-w-44 flex-1 flex-col gap-1.5">
                                                <span className="font-app-body text-[10px] font-semibold tracking-[0.16em] text-console-ink-4 uppercase">Skill</span>
                                                <SkillSelect value={draft!.skill} onChange={(sid) => patchDraft({ skill: sid })} skills={skills} />
                                            </label>
                                        </div>

                                        <label className="mt-4 flex flex-col gap-1.5">
                                            <span className="flex items-center justify-between font-app-body text-[10px] font-semibold tracking-[0.16em] text-console-ink-4 uppercase">
                                                <span>System prompt — raw markdown</span>
                                                <span className="flex items-center gap-1.5 normal-case tracking-normal">
                                                    <span className={cn("size-1.5 rounded-full", saveState.cls)} />
                                                    <span className="text-[11px] font-medium text-console-ink-3">{saveState.label}</span>
                                                </span>
                                            </span>
                                            <Textarea
                                                value={draft!.soul}
                                                onChange={(e) => patchDraft({ soul: e.target.value })}
                                                onBlur={restoreIfBlank}
                                                aria-label="Agent system prompt"
                                                className={SOUL_TEXTAREA}
                                                data-testid="agent-soul-editor"
                                            />
                                        </label>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* ── Skills, as they are (its own py-8 separates the sections) ── */}
            <div className="mt-10">
                <AgentSkills />
            </div>

            <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open && !deleting) setDeleteTarget(null); }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete agent?</AlertDialogTitle>
                        <AlertDialogDescription>
                            {deleteTarget
                                ? `“${deleteTarget.name || "this agent"}” will be permanently removed and cannot be undone.`
                                : ""}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            disabled={deleting}
                            className="bg-console-negative hover:bg-console-negative/85"
                            onClick={(e) => { e.preventDefault(); handleDelete(deleteTarget?._id || deleteTarget?.id); }}
                        >
                            <Trash2 /> Delete agent
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
