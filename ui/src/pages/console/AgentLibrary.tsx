import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { Search, Plus, Trash2 } from "lucide-react";
import { AgentService } from "@/db";
import AgentAvatar from "@/components/shared/AgentAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toaster } from "@/compat/ui";

/**
 * Agent Library — the console's default view. Agents render as a typographic
 * index: no cards, no backgrounds — hierarchy comes from Anek Latin weight
 * and size alone, over a hairline rule that marks each entry.
 */

interface Agent {
    _id: string;
    id?: string;
    name: string;
    created_at: string;
    source?: string;
    persona?: { philosophy?: string; philosophy_and_mindset?: string };
    skills?: { skill_id: string; weight: number }[];
}

/** First sentence of the philosophy — the agent's thesis. */
function creedOf(agent: Agent): string {
    const phil = agent.persona?.philosophy || agent.persona?.philosophy_and_mindset || "";
    const first = phil.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s/)[0];
    return first ? (first.length > 140 ? first.slice(0, 137) + "…" : first) : "";
}

function formatDate(dateStr?: string): string {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const ARCHETYPES = [
    {
        key: "value",
        name: "Value hunter",
        line: "Margin of safety above story. Buys what the market misprices and waits.",
        philosophy: "I believe the market frequently misprices patience. I hunt for businesses trading below their intrinsic worth, demand a margin of safety before committing capital, and let compounding do the work. I would rather be approximately right about the long term than precisely right about the quarter.",
    },
    {
        key: "momentum",
        name: "Momentum rider",
        line: "The trend is a fact. Rides strength, cuts weakness fast.",
        philosophy: "I believe price action encodes information the crowd hasn't articulated yet. I ride strength, respect stops without sentiment, and exit weakness fast. My edge is discipline: the trend is my thesis until it breaks.",
    },
    {
        key: "quality",
        name: "Quality compounder",
        line: "Great businesses, held long. Price matters, quality matters more.",
        philosophy: "I believe a few exceptional businesses, held with conviction, outperform constant tinkering. I look for durable moats, honest management, and reinvestment opportunities, and I pay a fair price for quality rather than a cheap price for compromise.",
    },
];

export default function AgentLibrary() {
    const navigate = useNavigate();
    const [agents, setAgents] = useState<Agent[]>([]);
    const [skillNames, setSkillNames] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);
    const [fetchError, setFetchError] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<Agent | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [query, setQuery] = useState("");

    useEffect(() => {
        let cancelled = false;
        AgentService.listAgents()
            .then((agentsData) => {
                if (cancelled) return;
                setAgents(Array.isArray(agentsData) ? agentsData : []);
                setFetchError(!Array.isArray(agentsData));
            })
            .catch(() => { if (!cancelled) { setAgents([]); setFetchError(true); } })
            .finally(() => { if (!cancelled) setLoading(false); });
    }, []);

    useEffect(() => {
        const ids = Array.from(new Set((agents || []).flatMap((a) => (a.skills || []).map((s) => s.skill_id))));
        if (!ids.length) { setSkillNames({}); return; }
        let cancelled = false;
        Promise.all(
            ids.map(async (id) => {
                try {
                    const full = await (await import("@/db")).SkillService.readSkill(id);
                    return [id, full?.name || id] as const;
                } catch { return [id, id] as const; }
            }),
        ).then((pairs) => { if (!cancelled) setSkillNames(Object.fromEntries(pairs)); });
        return () => { cancelled = true; };
    }, [agents]);

    const handleDelete = async (id: string | undefined) => {
        if (!id) return;
        setDeleting(true);
        try {
            await AgentService.deleteAgent(id);
            setDeleteTarget(null);
            setAgents((prev) => prev.filter((a) => (a._id || a.id) !== id));
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

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return agents;
        return agents.filter(
            (a) =>
                a.name?.toLowerCase().includes(q) ||
                creedOf(a).toLowerCase().includes(q) ||
                (a.skills || []).some((s) => (skillNames[s.skill_id] || s.skill_id).toLowerCase().includes(q)),
        );
    }, [agents, query, skillNames]);

    return (
        <div className="w-full py-8">
            {/* Header */}
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <h1 className="text-[28px] font-bold tracking-tight text-console-ink">
                        Agents
                    </h1>
                    <p className="mt-1 text-sm text-console-ink-2">
                        Every analyst you've built — their soul and skills.
                    </p>
                </div>
                <Button size="sm" variant="outline" className="rounded-none px-4" onClick={() => navigate("/my-workspace/agent/new")}>
                    <Plus /> New agent
                </Button>
            </div>

            {/* Search — only when there is something to search */}
            {!loading && agents.length > 5 && (
                <div className="relative mt-6 max-w-sm">
                    <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-console-ink-4" />
                    <Input
                        className="pl-9"
                        placeholder="Search agents, philosophies, skills…"
                        aria-label="Search agents"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                    />
                </div>
            )}

            {loading ? (
                <div className="mt-10 grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-x-10 gap-y-12">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="h-40 animate-pulse rounded-none bg-console-recessed/30" />
                    ))}
                </div>
            ) : fetchError ? (
                <div className="mt-10 rounded-2xl bg-console-surface p-10 text-center shadow-console">
                    <p className="font-semibold text-console-ink">The Agent Console could not reach the server.</p>
                    <p className="mt-1 text-sm text-console-ink-2">
                        The agent API may be unavailable. Reload to try again.
                    </p>
                </div>
            ) : agents.length === 0 ? (
                /* ── Empty state: the invitation + archetype seeds ── */
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                    className="mt-8 rounded-2xl bg-console-surface px-10 py-14 text-center shadow-console"
                >
                    <h2 className="text-2xl font-bold tracking-tight text-console-ink">
                        Every great analyst starts as a blank slate.
                    </h2>
                    <p className="mx-auto mt-2 max-w-[52ch] text-sm text-console-ink-2">
                        Build an agent from nothing, or start from a template — each one is fully editable the moment it exists.
                    </p>
                    <div className="mt-6 flex flex-wrap justify-center gap-3">
                        <Button onClick={() => navigate("/my-workspace/agent/new")}>
                            <Plus /> Create an agent
                        </Button>
                    </div>

                    <div className="mt-10 grid grid-cols-1 gap-3 md:grid-cols-3">
                        {ARCHETYPES.map((a) => (
                            <button
                                key={a.key}
                                className="rounded-xl bg-console-canvas p-5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-console-lift focus-visible:ring-2 focus-visible:ring-console-accent/40 focus-visible:outline-none"
                                onClick={async () => {
                                    try {
                                        const created = await AgentService.createAgent({
                                            name: a.name,
                                            persona: { philosophy: a.philosophy },
                                            skills: [],
                                        });
                                        const newId = created.id || created._id;
                                        toaster.create({
                                            title: `${a.name} created`,
                                            description: "Attach skills in Agent Skills to make it run.",
                                            type: "success",
                                        });
                                        navigate("/my-workspace/agent/" + newId);
                                    } catch (e: any) {
                                        toaster.create({
                                            title: "Couldn't create the agent",
                                            description: e?.response?.data?.error || e?.message || "Please try again.",
                                            type: "error",
                                        });
                                    }
                                }}
                                aria-label={`Create a ${a.name} agent`}
                            >
                                <span className="block text-[15px] font-semibold text-console-ink">{a.name}</span>
                                <span className="mt-1.5 block text-xs leading-relaxed text-console-ink-2">{a.line}</span>
                            </button>
                        ))}
                    </div>
                </motion.div>
            ) : (
                /* ── The roster — a typographic index, no cards ── */
                <div className="mt-10 grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-x-10 gap-y-12">
                    {filtered.length === 0 && (
                        <p className="col-span-full py-6 text-center text-sm text-console-ink-3">
                            No agents match that search.
                        </p>
                    )}
                    {filtered.map((agent) => {
                        const key = agent._id || agent.id || "";
                        const creed = creedOf(agent);
                        const skills = agent.skills || [];
                        return (
                            <motion.div
                                key={key}
                                layout
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.22 }}
                            >
                                <div
                                    role="link"
                                    tabIndex={0}
                                    onClick={() => navigate("/my-workspace/agent/" + key)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("/my-workspace/agent/" + key); }
                                    }}
                                    className="group flex h-full cursor-pointer flex-col pt-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-console-accent/40"
                                >
                                    {/* Identity */}
                                    <div className="flex min-w-0 items-start gap-3">
                                        <AgentAvatar agent={agent} size={40} label={agent.name || "Agent"} />
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate font-app-body text-[26px] leading-[1.05] font-semibold tracking-[-0.015em] text-console-ink">
                                                {agent.name || "Untitled agent"}
                                            </p>
                                            <p className={`mt-1.5 truncate font-app-body text-[14px] leading-snug font-light italic ${creed ? "text-console-ink-2" : "text-console-ink-4"}`}>
                                                “{creed || "No philosophy written yet."}”
                                            </p>
                                        </div>
                                        <Button
                                            variant="ghost"
                                            size="icon-sm"
                                            aria-label={`Delete ${agent.name || "agent"}`}
                                            className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setDeleteTarget(agent);
                                            }}
                                        >
                                            <Trash2 className="text-console-ink-3" />
                                        </Button>
                                    </div>

                                    {/* Skills */}
                                    <div className="mt-6">
                                        <p className="font-app-body text-[10px] font-semibold tracking-[0.16em] text-console-ink-4 uppercase">
                                            Skills
                                        </p>
                                        {skills.length ? (
                                            <p className="mt-1.5 font-app-body text-[12.5px] leading-relaxed font-normal text-console-ink-2">
                                                {skills.map((s) => skillNames[s.skill_id] || s.skill_id).join(" · ")}
                                            </p>
                                        ) : (
                                            <p className="mt-1.5 font-app-body text-[12.5px] font-light italic text-console-ink-4">
                                                None attached
                                            </p>
                                        )}
                                    </div>

                                    {/* Created */}
                                    <p className="mt-auto pt-6 font-app-body text-[11px] font-normal tracking-wide text-console-ink-4">
                                        Created {formatDate(agent.created_at)}
                                    </p>
                                </div>
                            </motion.div>
                        );
                    })}
                </div>
            )}

            <AlertDialog
                open={deleteTarget !== null}
                onOpenChange={(open) => { if (!open && !deleting) setDeleteTarget(null); }}
            >
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
