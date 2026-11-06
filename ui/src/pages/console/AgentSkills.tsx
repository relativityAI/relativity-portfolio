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
 * actions share one line on top; the library is stacked below as rows (logo,
 * name and category left; the start of the description right). Opening a
 * skill (or creating one) swaps in the SkillWorkspace: a navigable file
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
            // One skill per agent — attaching replaces whatever was there.
            const skills = [{ skill_id: skill.id, weight: 5 }];
            await AgentService.updateAgent({
                name: agent.name, persona: (agent as any).persona,
                skills, id: agentId, _id: agentId,
            });
            toaster.create({ title: `${skill.name} attached`, description: `It is now the only skill on ${agent.name}.`, type: "success" });
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

        // List view — the library itself, stacked in rows.
        return (
            <>
                {loading ? (
                    <div className="mt-8 flex flex-col gap-4" role="status" aria-label="Loading skills">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <div key={i} className="h-14 animate-pulse rounded-none bg-console-recessed/30" />
                        ))}
                    </div>
                ) : libraryError ? (
                    <p className="mt-6 text-[13px] text-console-negative">
                        The skill library could not be loaded. Reload to retry.
                    </p>
                ) : (
                    <div className="mt-8 flex flex-col">
                        {filtered.length === 0 && (
                            <p className="py-8 text-center text-[13px] text-console-ink-3">
                                {library.length === 0
                                    ? "No skills yet — download one from GitHub or create it manually."
                                    : "No skills match that search."}
                            </p>
                        )}
                        {filtered.map((s) => (
                            <button
                                key={s.id}
                                onClick={() => openSkill(s)}
                                className="group flex flex-wrap items-start gap-x-5 gap-y-2 py-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-console-accent/40"
                            >
                                <SkillAvatar skill={s} size={40} round />
                                {/* Left: logo, name, category */}
                                <span className="flex min-w-0 shrink flex-col gap-1">
                                    <span className="block truncate font-app-body text-[26px] leading-[1.05] tracking-[-0.015em] text-console-ink">
                                        {s.name}
                                    </span>
                                    <span className="block font-app-body text-[12px] font-normal text-console-ink-4">
                                        {CATEGORY_LABELS[s.category] || s.category} · v{s.version}
                                    </span>
                                </span>
                                {/* Right: the start of the description */}
                                <span className="ml-auto min-w-0 max-w-full sm:max-w-[55%] sm:text-right">
                                    <span className="line-clamp-2 font-app-body text-[14px] leading-snug font-light text-console-ink-2">
                                        {s.description}
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
        <div className="w-full py-8">
            {isDetail && (
                <Button variant="ghost" onClick={backToGrid} className="-ml-2 mb-2 text-base text-console-ink-2">
                    <ArrowLeft /> All skills
                </Button>
            )}
            {isDetail ? (
                <>
                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                        <div className="flex min-w-0 items-center gap-2.5">
                            <SkillAvatar skill={selected!} size={36} round />
                            <h1 className="font-app-display min-w-0 truncate text-[40px] font-normal tracking-tight text-console-ink">
                                {selected!.name}
                            </h1>
                            <SkillSourceBadge source={selected!.source} />
                        </div>
                        <div className="ml-auto flex shrink-0 items-center gap-2">
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
                                        <DropdownMenuItem key={a.id || a._id} onClick={() => attach(selected!, (a.id || a._id)!)}>
                                            {a.name}
                                        </DropdownMenuItem>
                                    ))}
                                </DropdownMenuContent>
                            </DropdownMenu>
                            {selected!.source === "custom" && (
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label="Delete skill"
                                    onClick={async () => {
                                        try {
                                            await SkillService.deleteSkill(selected!.id);
                                            setLibrary((lib) => lib.filter((s) => s.id !== selected!.id));
                                            backToGrid();
                                        } catch (e: any) {
                                            toaster.create({ title: "Couldn't delete", description: e?.message, type: "error" });
                                        }
                                    }}
                                >
                                    <Trash2 />
                                </Button>
                            )}
                        </div>
                    </div>
                    <p className="mt-1 text-sm text-console-ink-2">
                        {`${CATEGORY_LABELS[selected!.category] || selected!.category} · v${selected!.version} · ${selected!.id}`}
                    </p>
                </>
            ) : (
                /* One line: title, search, actions — all aligned. */
                <div className="flex flex-wrap items-center gap-3">
                    <h1 className="font-app-display shrink-0 text-[30px] leading-none font-normal tracking-tight text-console-ink">
                        Skills
                    </h1>
                    {mode === "inspect" && (
                        <>
                            <div className="flex min-w-56 max-w-md flex-1 items-stretch">
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="outline" aria-label="Filter by category" className="rounded-l-[6px] rounded-r-none border-r-0 px-2.5">
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
                                        className="h-9 rounded-l-none rounded-r-[6px] border-l-0 pl-9"
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
                                        className="ml-1.5 rounded-[6px]"
                                        onClick={() => { setQuery(""); setCategory("all"); }}
                                    >
                                        <X aria-hidden="true" />
                                    </Button>
                                )}
                            </div>
                            <div className="ml-auto flex shrink-0 items-center gap-2">
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
                            </div>
                        </>
                    )}
                </div>
            )}

            {body}
        </div>
    );
}
