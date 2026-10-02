import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import {
    Search, PenLine, Sparkles, Trash2, ShieldCheck, Link2, BookOpen,
    ListFilter, ChevronDown, X,
} from "lucide-react";
import { SkillService, AgentService, type SkillSummary } from "@/db";
import { useSkillLibrary, SkillEditor } from "@/components/skills/SkillBrowser";
import SkillCreatePane from "@/components/skills/SkillCreatePane";
import { SourceMark, type SourceKey } from "@/lib/sourceLogos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
    DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { toaster } from "@/compat/ui";
import { SkillSourceBadge } from "@/components/console/SkillSourceBadge";
import { cn } from "@/lib/utils";

/**
 * Agent Skills — the console's skill library. A catalog on the left, a
 * reading/editing pane on the right. New skills start manually (markdown
 * editor) or with AI (the AI Builder chat in skill mode).
 */

const CATEGORY_LABELS: Record<string, string> = {
    valuation: "Valuation",
    fundamentals: "Fundamentals",
    qualitative: "Qualitative",
    market: "Market",
    macro: "Macro",
    custom: "Custom",
};

function sourcesForSkill(skill: SkillSummary): SourceKey[] {
    const out: SourceKey[] = ["voyager"];
    const cat = skill.category;
    if (cat === "valuation" || cat === "fundamentals") out.push("sec", "nse");
    if (cat === "market") out.push("news");
    if (cat === "qualitative") out.push("reddit", "youtube");
    if (cat === "macro") out.push("news", "web");
    return out;
}

type Mode = "inspect" | "create";

export default function AgentSkills() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { library, loading, error: libraryError, setLibrary } = useSkillLibrary();
    const [selected, setSelected] = useState<SkillSummary | null>(null);
    const [markdown, setMarkdown] = useState<string | null>(null);
    const [docError, setDocError] = useState(false);
    const [mode, setMode] = useState<Mode>("inspect");
    const [query, setQuery] = useState("");
    const [category, setCategory] = useState("all");
    const [agentPickerId, setAgentPickerId] = useState("");
    const [agents, setAgents] = useState<{ _id?: string; id?: string; name: string; skills?: { skill_id: string; weight: number }[] }[]>([]);
    const [equipping, setEquipping] = useState(false);

    const requestedSkill = searchParams.get("skill");

    useEffect(() => {
        if (requestedSkill && library.length) {
            const s = library.find((x) => x.id === requestedSkill);
            if (s) { setSelected(s); setMode("inspect"); }
        }
    }, [requestedSkill, library]);

    useEffect(() => {
        AgentService.listAgents()
            .then((data) => { if (Array.isArray(data)) setAgents(data); })
            .catch(() => {});
    }, []);

    useEffect(() => {
        if (!selected || mode !== "inspect") { setMarkdown(null); return; }
        let cancelled = false;
        setDocError(false);
        SkillService.readSkill(selected.id)
            .then((s) => { if (!cancelled) setMarkdown(s.markdown || ""); })
            .catch(() => { if (!cancelled) setDocError(true); });
        return () => { cancelled = true; };
    }, [selected, mode]);

    const categories = useMemo(() => Array.from(new Set(library.map((s) => s.category))), [library]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return library.filter((s) => {
            if (category !== "all" && s.category !== category) return false;
            if (!q) return true;
            return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q);
        });
    }, [library, query, category]);

    const byCategory = useMemo(() => {
        const groups: Record<string, SkillSummary[]> = {};
        for (const s of filtered) (groups[s.category] ||= []).push(s);
        return groups;
    }, [filtered]);

    const attach = async (skill: SkillSummary) => {
        const agentId = agentPickerId || agents[0]?.id || agents[0]?._id;
        if (!agentId) {
            toaster.create({ title: "No agent selected", description: "Create an agent first, then attach skills to it.", type: "warning" });
            return;
        }
        setEquipping(true);
        try {
            const agent = agents.find((a) => (a.id || a._id) === agentId);
            const skills = [...(agent?.skills || []).map((s) => ({ skill_id: s.skill_id, weight: s.weight ?? 5 }))];
            if (!skills.some((s) => s.skill_id === skill.id)) skills.push({ skill_id: skill.id, weight: 5 });
            await AgentService.updateAgent({
                name: agent?.name, persona: (agent as any)?.persona, configuration: (agent as any)?.configuration,
                skills, id: agentId, _id: agentId,
            });
            toaster.create({ title: `${skill.name} attached`, description: `Added to ${agent?.name || "the agent"} at weight 5.`, type: "success" });
            setAgents((prev) => prev.map((a) => ((a.id || a._id) === agentId ? { ...a, skills } : a)));
        } catch (e: any) {
            toaster.create({ title: "Couldn't attach", description: e?.response?.data?.error || e?.message, type: "error" });
        } finally {
            setEquipping(false);
        }
    };

    /* ── The reading / creating pane ─────────────────────────────────── */

    const detail = (() => {
        if (mode === "create") {
            return (
                <SkillCreatePane
                    library={library}
                    onCancel={() => setMode("inspect")}
                    onSaved={(skill) => {
                        setLibrary((lib) => [...lib.filter((s) => s.id !== skill.id), skill]);
                        setSelected(skill); setMode("inspect");
                    }}
                />
            );
        }
        if (!selected) {
            return (
                <div className="flex h-full flex-col items-center justify-center gap-5 px-6 text-center">
                    <div className="flex flex-col items-center gap-2">
                        <BookOpen className="size-6 text-console-ink-4" aria-hidden />
                        <p className="text-sm text-console-ink-2">Select a skill from the catalog.</p>
                        <p className="text-xs text-console-ink-4">
                            Its method, data sources, and verdict anchors render here.
                        </p>
                    </div>
                    <div className="h-px w-40 bg-console-recessed" aria-hidden />
                    <div className="flex flex-col items-center gap-2">
                        <p className="text-xs font-medium text-console-ink-3">…or create your first skill</p>
                        <div className="flex gap-2">
                            <Button variant="secondary" size="sm" onClick={() => { setMode("create"); setSelected(null); }}>
                                <PenLine /> New manually
                            </Button>
                            <Button variant="accentSoft" size="sm" onClick={() => navigate("/console/builder?mode=skill")}>
                                <Sparkles /> New with AI
                            </Button>
                        </div>
                    </div>
                </div>
            );
        }
        return <SkillDetail skill={selected} markdown={markdown} docError={docError} agents={agents} agentPickerId={agentPickerId} setAgentPickerId={setAgentPickerId} equipping={equipping} onAttach={() => attach(selected)} onEdit={(s) => { setSelected(s); }} onDelete={async (id) => {
            try {
                await SkillService.deleteSkill(id);
                setLibrary((lib) => lib.filter((s) => s.id !== id));
                setSelected(null);
            } catch (e: any) {
                toaster.create({ title: "Couldn't delete", description: e?.message, type: "error" });
            }
        }} />;
    })();

    return (
        <div className="flex h-full min-h-0">
            {/* Left: the catalog */}
            <div
                className={cn(
                    "flex w-[22rem] shrink-0 flex-col",
                    (selected || mode === "create") && "hidden md:flex",
                )}
            >
                <div className="px-5 pt-7 pb-3">
                    <h1 className="text-[22px] font-bold tracking-tight text-console-ink">Agent Skills</h1>
                    <p className="mt-0.5 text-[13px] text-console-ink-2">
                        What your agents know how to measure.
                    </p>
                </div>

                <div className="flex flex-wrap gap-1.5 px-5 pb-2">
                    <Button variant="secondary" size="sm" onClick={() => { setMode("create"); setSelected(null); }}>
                        <PenLine /> New manually
                    </Button>
                    <Button variant="accentSoft" size="sm" onClick={() => navigate("/console/builder?mode=skill")}>
                        <Sparkles /> New with AI
                    </Button>
                </div>

                <div className="px-5 pt-1 pb-2">
                    {/* Search: filter dropdown + input + clear, as one attached group. */}
                    <div className="flex w-full items-stretch">
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" aria-label="Filter by category" className="rounded-r-none border-r-0 px-2.5">
                                    <ListFilter aria-hidden="true" />
                                    <span className="hidden lg:inline">{category === "all" ? "All" : CATEGORY_LABELS[category] || category}</span>
                                    <ChevronDown aria-hidden="true" className="size-3.5 opacity-60" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" className="w-44">
                                {["all", ...categories].map((c) => (
                                    <DropdownMenuItem key={c} onClick={() => setCategory(c)} className={cn(category === c && "bg-accent")}>
                                        {c === "all" ? "All skills" : CATEGORY_LABELS[c] || c}
                                    </DropdownMenuItem>
                                ))}
                            </DropdownMenuContent>
                        </DropdownMenu>
                        <div className="relative flex-1">
                            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-console-ink-4" />
                            <Input
                                className="rounded-l-none border-l-0 pl-9"
                                placeholder="Search skills…"
                                aria-label="Search skills"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                            />
                        </div>
                        {(query || category !== "all") && (
                            <Button
                                variant="outline"
                                size="icon"
                                aria-label="Clear filters"
                                className="ml-1.5 rounded-l-none border-l-0"
                                onClick={() => { setQuery(""); setCategory("all"); }}
                            >
                                <X aria-hidden="true" />
                            </Button>
                        )}
                    </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
                    {loading ? (
                        <div className="space-y-2 py-3" role="status" aria-label="Loading skills">
                            {Array.from({ length: 6 }).map((_, i) => (
                                <div key={i} className="h-12 animate-pulse rounded-xl bg-console-recessed" />
                            ))}
                        </div>
                    ) : libraryError ? (
                        <p className="px-2 py-4 text-[13px] text-console-negative">
                            The skill library could not be loaded. Reload to retry.
                        </p>
                    ) : (
                        <motion.div initial="initial" animate="animate">
                            {Object.entries(byCategory).map(([cat, items]) => (
                                <div key={cat} className="mb-4">
                                    <p className="mb-1.5 px-2 text-[10px] font-medium tracking-wide text-console-ink-4">
                                        {CATEGORY_LABELS[cat] || cat}
                                    </p>
                                    <div className="flex flex-col gap-0.5">
                                        {items.map((s) => {
                                            const isSelected = selected?.id === s.id && mode === "inspect";
                                            return (
                                                <button
                                                    key={s.id}
                                                    onClick={() => { setSelected(s); setMode("inspect"); }}
                                                    aria-current={isSelected || undefined}
                                                    className={cn(
                                                        "relative rounded-xl p-2.5 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-console-accent/40",
                                                        isSelected ? "bg-console-accent-soft" : "hover:bg-console-recessed/70"
                                                    )}
                                                >
                                                    <span className="flex items-center gap-1.5">
                                                        <span className={cn(
                                                            "min-w-0 flex-1 truncate text-[13px] font-medium",
                                                            isSelected ? "text-console-accent-strong" : "text-console-ink"
                                                        )}>
                                                            {s.name}
                                                        </span>
                                                        <SkillSourceBadge source={s.source} />
                                                    </span>
                                                    <span className="mt-0.5 block truncate text-[11px] text-console-ink-3">
                                                        {s.description}
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                            {filtered.length === 0 && (
                                <p className="px-2 py-4 text-[13px] text-console-ink-3">No skills match that search.</p>
                            )}
                        </motion.div>
                    )}
                </div>
            </div>

            {/* Right: the reading / creating pane */}
            <div className="min-w-0 flex-1 overflow-y-auto px-8 pt-7 pb-8">
                <AnimatePresence mode="wait" initial={false}>
                    <motion.div
                        key={mode + (selected?.id || "")}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.18 }}
                        className="mx-auto h-full max-w-3xl"
                    >
                        {detail}
                    </motion.div>
                </AnimatePresence>
            </div>
        </div>
    );
}

/* ── Skill detail ─────────────────────────────────────────────────────── */

function SkillDetail({
    skill, markdown, docError, agents, agentPickerId, setAgentPickerId, equipping, onAttach, onDelete,
}: {
    skill: SkillSummary;
    markdown: string | null;
    docError: boolean;
    agents: { _id?: string; id?: string; name: string }[];
    agentPickerId: string;
    setAgentPickerId: (v: string) => void;
    equipping: boolean;
    onAttach: () => void;
    onDelete: (id: string) => void;
}) {
    return (
        <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-console-ink">
                        <span className="min-w-0 truncate">{skill.name}</span>
                        <SkillSourceBadge source={skill.source} />
                    </h2>
                    <p className="mt-0.5 text-[11px] text-console-ink-4">
                        {CATEGORY_LABELS[skill.category] || skill.category} · v{skill.version} · {skill.id}
                    </p>
                </div>
                {skill.source === "custom" && (
                    <Button variant="ghost" size="sm" onClick={() => onDelete(skill.id)}>
                        <Trash2 /> Delete
                    </Button>
                )}
            </div>

            <p className="max-w-[70ch] text-sm leading-relaxed text-console-ink-2">{skill.description}</p>

            {skill.purpose && (
                <section>
                    <h3 className="mb-1.5 text-xs font-medium text-console-ink-3">What it measures</h3>
                    <p className="max-w-[70ch] text-[13px] leading-relaxed whitespace-pre-wrap text-console-ink-2">
                        {skill.purpose}
                    </p>
                </section>
            )}

            {!!skill.anchors?.length && (
                <section>
                    <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-console-ink-3">
                        <ShieldCheck className="size-3.5" /> Verdicts it returns
                    </h3>
                    <div className="flex flex-col gap-1.5">
                        {skill.anchors.map((a) => (
                            <div key={a.label} className="flex items-center gap-2">
                                <span className="size-1.5 rounded-full bg-console-accent" aria-hidden />
                                <span className="text-[13px] text-console-ink-2">{a.label}</span>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            <section>
                <h3 className="mb-2 text-xs font-medium text-console-ink-3">Draws on</h3>
                <div className="flex flex-wrap gap-2">
                    {sourcesForSkill(skill).map((src) => (
                        <span key={src} className="inline-flex items-center gap-1.5 rounded-full bg-console-recessed px-2.5 py-1">
                            <SourceMark source={src} size={12} />
                            <span className="text-[11px] text-console-ink-2">{src}</span>
                        </span>
                    ))}
                </div>
            </section>

            <Separator />

            {/* Attach to agent */}
            <section>
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-console-ink-3">
                    <Link2 className="size-3.5" /> Attach to an agent
                </h3>
                <div className="flex max-w-md gap-2">
                    <Select value={agentPickerId || undefined} onValueChange={setAgentPickerId}>
                        <SelectTrigger aria-label="Choose agent">
                            <SelectValue placeholder={agents.length ? "Choose an agent" : "No agents yet"} />
                        </SelectTrigger>
                        <SelectContent>
                            {agents.map((a) => (
                                <SelectItem key={a.id || a._id} value={(a.id || a._id)!}>
                                    {a.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Button onClick={onAttach} disabled={equipping || agents.length === 0}>
                        {equipping ? "Attaching…" : "Attach"}
                    </Button>
                </div>
            </section>

            <section>
                <h3 className="mb-2 text-xs font-medium text-console-ink-3">Full document</h3>
                {docError ? (
                    <p className="text-[13px] text-console-negative">Couldn't load this skill's document.</p>
                ) : markdown === null ? (
                    <div className="h-24 animate-pulse rounded-xl bg-console-recessed" />
                ) : (
                    <pre
                        className="max-h-[60vh] overflow-y-auto rounded-2xl bg-console-recessed p-4 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-console-ink-2"
                    >
                        {markdown}
                    </pre>
                )}
            </section>
        </div>
    );
}

/** Exported for the editor route below — the SkillEditor needs wrapping. */
export { SkillEditor };
