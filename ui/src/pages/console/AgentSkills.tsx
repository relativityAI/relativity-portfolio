import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import {
    Search, PenLine, Trash2, Link2,
    ListFilter, ChevronDown, X, ArrowLeft, Globe,
} from "lucide-react";
import { SkillService, AgentService, type SkillSummary } from "@/db";
import { useSkillLibrary } from "@/components/skills/SkillBrowser";
import SkillAvatar from "@/components/shared/SkillAvatar";
import SkillWorkspace from "@/components/skills/SkillWorkspace";
import SkillImportPane from "@/components/skills/SkillImportPane";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { toaster } from "@/compat/ui";
import { SkillSourceBadge } from "@/components/console/SkillSourceBadge";
import { cn } from "@/lib/utils";

/**
 * Agent Skills — one full-width console page. Title, search and the create
 * actions sit on top; the library is a grid of compact cards below. Opening
 * a skill (or creating one) swaps in the SkillWorkspace: a navigable file
 * tree beside the editor, so references/ and assets/ are just files you
 * click. Nothing scrolls separately from the rest of the console.
 */

const CATEGORY_LABELS: Record<string, string> = {
    valuation: "Valuation",
    fundamentals: "Fundamentals",
    qualitative: "Qualitative",
    market: "Market",
    macro: "Macro",
    custom: "Custom",
};

type Mode = "inspect" | "create" | "download";

export default function AgentSkills() {
    const [searchParams, setSearchParams] = useSearchParams();
    const { library, loading, error: libraryError, setLibrary } = useSkillLibrary();
    const [selected, setSelected] = useState<SkillSummary | null>(null);
    const [mode, setMode] = useState<Mode>("inspect");
    const [query, setQuery] = useState("");
    const [category, setCategory] = useState("all");
    const [agents, setAgents] = useState<{ _id?: string; id?: string; name: string; skills?: { skill_id: string; weight: number }[] }[]>([]);
    const [equipping, setEquipping] = useState(false);

    const requestedSkill = searchParams.get("skill");

    // Deep link: /my-workspace/skills?skill=<id> (used by the agent settings page).
    // The sidebar link clears the param — that must close the open skill too,
    // otherwise clicking "Agent Skills" while a skill is open goes nowhere.
    useEffect(() => {
        if (requestedSkill && library.length) {
            const s = library.find((x) => x.id === requestedSkill);
            if (s) { setSelected(s); setMode("inspect"); }
        } else if (!requestedSkill) {
            setSelected(null);
        }
    }, [requestedSkill, library]);

    useEffect(() => {
        AgentService.listAgents()
            .then((data) => { if (Array.isArray(data)) setAgents(data); })
            .catch(() => {});
    }, []);

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
        setSearchParams({ skill: s.id }, { replace: true });
    };

    const backToGrid = () => {
        setSelected(null);
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
        setSearchParams({}, { replace: true });
    };

    const startDownload = () => {
        setMode("download");
        setSelected(null);
        setSearchParams({}, { replace: true });
    };

    const isDetail = mode === "inspect" && !!selected;

    /* ── Main pane: create > detail > grid ────────────────────────────── */

    const body = (() => {
        if (mode === "create") {
            return (
                <SkillWorkspace
                    library={library}
                    onCancel={() => setMode("inspect")}
                    onSaved={(skill) => {
                        setLibrary((lib) => [...lib.filter((s) => s.id !== skill.id), skill]);
                        setSelected(skill); setMode("inspect");
                        setSearchParams({ skill: skill.id }, { replace: true });
                    }}
                />
            );
        }

        if (mode === "download") {
            return (
                <SkillImportPane
                    library={library}
                    onCancel={() => setMode("inspect")}
                    onSaved={(skill) =>
                        setLibrary((lib) => [...lib.filter((s) => s.id !== skill.id), skill])
                    }
                />
            );
        }

        if (selected) {
            return (
                <AnimatePresence mode="wait" initial={false}>
                    <motion.div
                        key={selected.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.18 }}
                    >
                        <SkillWorkspace
                            key={selected.id}
                            skill={selected}
                            library={library}
                            onCancel={backToGrid}
                            onSaved={(s) => {
                                setLibrary((lib) => lib.map((x) => (x.id === s.id ? s : x)));
                                setSelected(s);
                            }}
                        />
                    </motion.div>
                </AnimatePresence>
            );
        }

        // Grid view — the library itself.
        return (
            <>
                {/* Search: filter dropdown + input + clear, as one full-width group. */}
                <div className="mt-5 flex items-stretch">
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
                    <div className="mt-10 grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-x-10 gap-y-12" role="status" aria-label="Loading skills">
                        {Array.from({ length: 8 }).map((_, i) => (
                            <div key={i} className="h-32 animate-pulse rounded-none bg-console-recessed/30" />
                        ))}
                    </div>
                ) : libraryError ? (
                    <p className="mt-6 text-[13px] text-console-negative">
                        The skill library could not be loaded. Reload to retry.
                    </p>
                ) : (
                    <div className="mt-10 grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-x-10 gap-y-12">
                        {filtered.length === 0 && (
                            <p className="col-span-full py-8 text-center text-[13px] text-console-ink-3">
                                {library.length === 0
                                    ? "No skills yet — download one from GitHub or create it manually."
                                    : "No skills match that search."}
                            </p>
                        )}
                        {filtered.map((s) => (
                            <button
                                key={s.id}
                                onClick={() => openSkill(s)}
                                className="group flex h-full flex-col pt-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-console-accent/40"
                            >
                                <span className="flex min-w-0 items-start gap-3">
                                    <SkillAvatar skill={s} size={40} />
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate font-app-body text-[26px] leading-[1.05] font-semibold tracking-[-0.015em] text-console-ink">
                                            {s.name}
                                        </span>
                                        <span className="mt-1.5 block truncate font-app-body text-[14px] leading-snug font-light text-console-ink-2">
                                            {s.description}
                                        </span>
                                    </span>
                                </span>

                                <span className="mt-6 block">
                                    <span className="block font-app-body text-[10px] font-semibold tracking-[0.16em] text-console-ink-4 uppercase">
                                        Category
                                    </span>
                                    <span className="mt-1.5 block font-app-body text-[12.5px] font-normal text-console-ink-2">
                                        {CATEGORY_LABELS[s.category] || s.category}
                                    </span>
                                </span>

                                <span className="mt-auto block pt-6 font-app-body text-[11px] font-normal tracking-wide text-console-ink-4">
                                    Version {s.version}
                                </span>
                            </button>
                        ))}
                    </div>
                )}
            </>
        );
    })();

    return (
        <div className="w-full py-8">
            {/* One toolbar row in every view: nav/title left, contextual
                actions right on the title's baseline, subtitle underneath. */}
            {isDetail && (
                <Button variant="ghost" size="sm" onClick={backToGrid} className="-ml-2 mb-1.5 text-console-ink-2">
                    <ArrowLeft /> All skills
                </Button>
            )}
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <div className="flex min-w-0 items-center gap-2.5">
                    {selected ? (
                        <>
                            <SkillAvatar skill={selected} size={36} />
                            <h1 className="font-app-display min-w-0 truncate text-[40px] font-medium tracking-tight text-console-ink">
                                {selected.name}
                            </h1>
                            <SkillSourceBadge source={selected.source} />
                        </>
                    ) : (
                        <h1 className="font-app-display text-[30px] font-medium tracking-tight text-console-ink">Agent Skills</h1>
                    )}
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-2">
                    {!selected && mode === "inspect" && (
                        <>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={startCreate}
                                className="bg-transparent font-normal text-console-ink-3 hover:bg-transparent hover:text-console-ink!"
                            >
                                <PenLine /> Create new skill
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={startDownload}
                                className="bg-transparent font-normal text-console-accent hover:bg-transparent hover:text-console-ink!"
                            >
                                <Globe /> Download skills
                            </Button>
                        </>
                    )}
                    {isDetail && (
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
