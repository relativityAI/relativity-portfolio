import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import {
    Search, PenLine, Trash2, ShieldCheck, Link2,
    ListFilter, ChevronDown, X, ArrowLeft,
} from "lucide-react";
import { SkillService, AgentService, type SkillSummary } from "@/db";
import { useSkillLibrary, SkillEditor } from "@/components/skills/SkillBrowser";
import SkillAvatar from "@/components/shared/SkillAvatar";
import SkillCreatePane from "@/components/skills/SkillCreatePane";
import { SourceMark, type SourceKey } from "@/lib/sourceLogos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { toaster } from "@/compat/ui";
import { SkillSourceBadge } from "@/components/console/SkillSourceBadge";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import SyntaxHighlighter from "react-syntax-highlighter";
import { atomDark } from "react-syntax-highlighter/dist/esm/styles/prism";

/**
 * Agent Skills — one full-width console page. Title, search and the create
 * actions sit on top; the library is a grid of compact cards below. Opening a
 * skill takes over the main pane as a document (editable in place), so
 * nothing scrolls separately from the rest of the console.
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

/** Section heading with the pencil that says "this section is editable". */
function SectionHead({ children, onEdit }: { children: ReactNode; onEdit: () => void }) {
    return (
        <h3 className="mb-2 flex items-center gap-1 text-xs font-medium text-console-ink-3">
            {children}
            <button
                type="button"
                onClick={onEdit}
                aria-label="Edit this section"
                className="rounded p-0.5 text-console-ink-4 opacity-60 transition hover:bg-console-recessed hover:text-console-accent-strong focus-visible:ring-2 focus-visible:ring-console-accent/40 focus-visible:outline-none"
            >
                <PenLine className="size-3" />
            </button>
        </h3>
    );
}

export default function AgentSkills() {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const { library, loading, error: libraryError, setLibrary } = useSkillLibrary();
    const [selected, setSelected] = useState<SkillSummary | null>(null);
    const [markdown, setMarkdown] = useState<string | null>(null);
    const [docError, setDocError] = useState(false);
    const [mode, setMode] = useState<Mode>("inspect");
    const [editing, setEditing] = useState(false);
    const [query, setQuery] = useState("");
    const [category, setCategory] = useState("all");
    const [agents, setAgents] = useState<{ _id?: string; id?: string; name: string; skills?: { skill_id: string; weight: number }[] }[]>([]);
    const [equipping, setEquipping] = useState(false);

    const requestedSkill = searchParams.get("skill");

    // Deep link: /console/skills?skill=<id> (used by the agent settings page).
    // The sidebar link clears the param — that must close the open skill too,
    // otherwise clicking "Agent Skills" while a skill is open goes nowhere.
    useEffect(() => {
        if (requestedSkill && library.length) {
            const s = library.find((x) => x.id === requestedSkill);
            if (s) { setSelected(s); setMode("inspect"); setEditing(false); }
        } else if (!requestedSkill) {
            setSelected(null);
            setEditing(false);
        }
    }, [requestedSkill, library]);

    useEffect(() => {
        AgentService.listAgents()
            .then((data) => { if (Array.isArray(data)) setAgents(data); })
            .catch(() => {});
    }, []);

    useEffect(() => {
        if (!selected || mode !== "inspect" || editing) { setMarkdown(null); return; }
        let cancelled = false;
        setDocError(false);
        SkillService.readSkill(selected.id)
            .then((s) => { if (!cancelled) setMarkdown(s.markdown || ""); })
            .catch(() => { if (!cancelled) setDocError(true); });
        return () => { cancelled = true; };
    }, [selected, mode, editing]);

    const categories = useMemo(() => Array.from(new Set(library.map((s) => s.category))), [library]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return library.filter((s) => {
            if (category !== "all" && s.category !== category) return false;
            if (!q) return true;
            return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q);
        });
    }, [library, query, category]);

    const openSkill = (s: SkillSummary) => {
        setSelected(s);
        setMode("inspect");
        setEditing(false);
        setSearchParams({ skill: s.id }, { replace: true });
    };

    const backToGrid = () => {
        setSelected(null);
        setEditing(false);
        setMode("inspect");
        setSearchParams({}, { replace: true });
    };

    const attach = async (skill: SkillSummary, agentId: string) => {
        const agent = agents.find((a) => (a.id || a._id) === agentId);
        if (!agent) return;
        setEquipping(true);
        try {
            const skills = [...(agent.skills || []).map((s) => ({ skill_id: s.skill_id, weight: s.weight ?? 5 }))];
            if (!skills.some((s) => s.skill_id === skill.id)) skills.push({ skill_id: skill.id, weight: 5 });
            await AgentService.updateAgent({
                name: agent.name, persona: (agent as any).persona,
                skills, id: agentId, _id: agentId,
            });
            toaster.create({ title: `${skill.name} attached`, description: `Added to ${agent.name} at weight 5.`, type: "success" });
            setAgents((prev) => prev.map((a) => ((a.id || a._id) === agentId ? { ...a, skills } : a)));
        } catch (e: any) {
            toaster.create({ title: "Couldn't attach", description: e?.response?.data?.error || e?.message, type: "error" });
        } finally {
            setEquipping(false);
        }
    };

    const startCreate = () => {
        setMode("create");
        setSelected(null);
        setEditing(false);
        setSearchParams({}, { replace: true });
    };

    const isDetail = mode === "inspect" && !!selected;

    /* ── Main pane: create > detail > grid ────────────────────────────── */

    const body = (() => {
        if (mode === "create") {
            return (
                <div className="max-w-4xl">
                    <SkillCreatePane
                        library={library}
                        onCancel={() => setMode("inspect")}
                        onSaved={(skill) => {
                            setLibrary((lib) => [...lib.filter((s) => s.id !== skill.id), skill]);
                            setSelected(skill); setMode("inspect");
                            setSearchParams({ skill: skill.id }, { replace: true });
                        }}
                    />
                </div>
            );
        }

        if (selected) {
            return (
                <div className="max-w-4xl">
                    <AnimatePresence mode="wait" initial={false}>
                        <motion.div
                            key={editing ? `edit-${selected.id}` : `view-${selected.id}`}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.18 }}
                        >
                            {editing ? (
                                <SkillEditor
                                    skill={selected}
                                    onSaved={(s) => {
                                        setLibrary((lib) => lib.map((x) => (x.id === s.id ? s : x)));
                                        setSelected(s);
                                        setEditing(false);
                                    }}
                                    onCancel={() => setEditing(false)}
                                />
                            ) : (
                                <SkillDetail
                                    skill={selected}
                                    markdown={markdown}
                                    docError={docError}
                                    onEdit={() => setEditing(true)}
                                />
                            )}
                        </motion.div>
                    </AnimatePresence>
                </div>
            );
        }

        // Grid view — the library itself.
        return (
            <>
                {/* Search: filter dropdown + input + clear, as one attached group. */}
                <div className="mt-5 flex max-w-md items-stretch">
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

                {loading ? (
                    <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" role="status" aria-label="Loading skills">
                        {Array.from({ length: 8 }).map((_, i) => (
                            <div key={i} className="h-[70px] animate-pulse rounded-xl bg-console-recessed" />
                        ))}
                    </div>
                ) : libraryError ? (
                    <p className="mt-6 text-[13px] text-console-negative">
                        The skill library could not be loaded. Reload to retry.
                    </p>
                ) : (
                    <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {filtered.length === 0 && (
                            <p className="col-span-full py-8 text-center text-[13px] text-console-ink-3">
                                {library.length === 0
                                    ? "No skills yet — create the first one with the buttons above."
                                    : "No skills match that search."}
                            </p>
                        )}
                        {filtered.map((s) => (
                            <button
                                key={s.id}
                                onClick={() => openSkill(s)}
                                className="flex items-start gap-2.5 rounded-xl bg-console-surface p-2.5 text-left shadow-console transition hover:shadow-console-lift focus-visible:ring-2 focus-visible:ring-console-accent/40 focus-visible:outline-none min-h-[60px]"
                            >
                                <SkillAvatar skill={s} size={28} />
                                <span className="min-w-0 flex-1">
                                    <span className="flex items-center gap-1.5">
                                        <span className="min-w-0 truncate text-[12.5px] font-semibold text-console-ink">{s.name}</span>
                                    </span>
                                    <span className="mt-0.5 line-clamp-1 block text-[11px] leading-snug text-console-ink-3">
                                        {s.description}
                                    </span>
                                    <span className="mt-1 block text-[9.5px] font-medium tracking-wide text-console-ink-4 uppercase">
                                        {CATEGORY_LABELS[s.category] || s.category}
                                    </span>
                                </span>
                            </button>
                        ))}
                    </div>
                )}
            </>
        );
    })();

    return (
        <div className="mx-auto w-full max-w-6xl px-8 py-8">
            {/* One toolbar row in every view: nav/title left, contextual
                actions right on the title's baseline, subtitle underneath. */}
            {isDetail && !editing && (
                <Button variant="ghost" size="sm" onClick={backToGrid} className="-ml-2 mb-1.5 text-console-ink-2">
                    <ArrowLeft /> All skills
                </Button>
            )}
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <div className="flex min-w-0 items-center gap-2.5">
                    {selected ? (
                        <>
                            <SkillAvatar skill={selected} size={28} />
                            <h1 className="min-w-0 truncate text-[28px] font-bold tracking-tight text-console-ink">
                                {selected.name}
                            </h1>
                            <SkillSourceBadge source={selected.source} />
                        </>
                    ) : (
                        <h1 className="text-[28px] font-bold tracking-tight text-console-ink">Agent Skills</h1>
                    )}
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-2">
                    {!selected && mode !== "create" && (
                        <>
                            <Button variant="secondary" size="sm" onClick={startCreate}>
                                <PenLine /> New manually
                            </Button>

                        </>
                    )}
                    {isDetail && !editing && (
                        <>
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        disabled={equipping || agents.length === 0}
                                        aria-label="Attach to an agent"
                                    >
                                        <Link2 /> {equipping ? "Attaching…" : "Attach to agent"}
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-56">
                                    {agents.map((a) => (
                                        <DropdownMenuItem key={a.id || a._id} onClick={() => attach(selected, (a.id || a._id)!)}>
                                            {a.name}
                                        </DropdownMenuItem>
                                    ))}
                                </DropdownMenuContent>
                            </DropdownMenu>
                            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                                <PenLine /> Edit
                            </Button>
                            {selected.source === "custom" && (
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label="Delete skill"
                                    onClick={async () => {
                                        try {
                                            await SkillService.deleteSkill(selected.id);
                                            setLibrary((lib) => lib.filter((s) => s.id !== selected.id));
                                            backToGrid();
                                        } catch (e: any) {
                                            toaster.create({ title: "Couldn't delete", description: e?.message, type: "error" });
                                        }
                                    }}
                                >
                                    <Trash2 />
                                </Button>
                            )}
                        </>
                    )}
                </div>
            </div>
            <p className="mt-1 text-sm text-console-ink-2">
                {selected
                    ? `${CATEGORY_LABELS[selected.category] || selected.category} · v${selected.version} · ${selected.id}`
                    : "What your agents know how to measure."}
            </p>

            {body}
        </div>
    );
}

/* ── Skill detail ─────────────────────────────────────────────────────── */

function SkillDetail({
    skill, markdown, docError, onEdit,
}: {
    skill: SkillSummary;
    markdown: string | null;
    docError: boolean;
    onEdit: () => void;
}) {
    return (
        <div className="mt-5 flex flex-col gap-5">
            <p className="max-w-[75ch] text-sm leading-relaxed text-console-ink-2">{skill.description}</p>

            {skill.purpose && (
                <section>
                    <SectionHead onEdit={onEdit}>What it measures</SectionHead>
                    <p className="max-w-[75ch] text-[13px] leading-relaxed whitespace-pre-wrap text-console-ink-2">
                        {skill.purpose}
                    </p>
                </section>
            )}

            {!!skill.anchors?.length && (
                <section>
                    <SectionHead onEdit={onEdit}>
                        <ShieldCheck className="size-3.5" /> Verdicts it returns
                    </SectionHead>
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

            {markdown !== null && !docError && (
                <section>
                    <SectionHead onEdit={onEdit}>Skill document</SectionHead>
                    <div className="prose prose-sm max-w-none dark:prose-invert prose-p:leading-relaxed prose-pre:bg-console-recessed prose-pre:text-console-ink-2 prose-code:bg-console-recessed prose-code:px-1 prose-code:py-0.5 prose-code:rounded">
                        <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                                code({ className, children, ...props }) {
                                    const match = /language-(\w+)/.exec(className || "");
                                    return match ? (
                                        <SyntaxHighlighter
                                            language={match[1]}
                                            PreTag="div"
                                            style={atomDark}
                                            customStyle={{ margin: 0, borderRadius: "0.5rem" }}
                                        >
                                            {String(children).replace(/\n$/, "")}
                                        </SyntaxHighlighter>
                                    ) : (
                                        <code className={className} {...props}>
                                            {children}
                                        </code>
                                    );
                                },
                            }}
                        >
                            {markdown}
                        </ReactMarkdown>
                    </div>
                </section>
            )}
            {docError && (
                <p className="text-[13px] text-console-negative">Couldn't load this skill's document.</p>
            )}
            {markdown === null && (
                <div className="h-24 animate-pulse rounded-xl bg-console-recessed" />
            )}
        </div>
    );
}

/** Exported for the editor route below — the SkillEditor needs wrapping. */
export { SkillEditor };
