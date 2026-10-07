import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { Search, Plus, Trash2, Sparkles } from "lucide-react";
import { AgentService } from "@/db";
import AgentAvatar from "@/components/shared/AgentAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toaster } from "@/compat/ui";

/**
 * Agent Library — the console's default view. Every agent renders as a
 * borderless card: identity, thesis, skills, last-run health.
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

interface AnalysisLite {
    agent?: string;
    agent_name?: string;
    status?: string;
    total_score?: number;
    created_at?: string;
    updated_at?: string;
}

/** First sentence of the philosophy — the agent's thesis. */
function creedOf(agent: Agent): string {
    const phil = agent.persona?.philosophy || agent.persona?.philosophy_and_mindset || "";
    const first = phil.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s/)[0];
    return first ? (first.length > 140 ? first.slice(0, 137) + "…" : first) : "";
}

function timeAgo(dateStr?: string): string {
    if (!dateStr) return "";
    const s = Math.max(0, (Date.now() - +new Date(dateStr)) / 1000);
    if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
}

/** Last finished run for an agent, by name match on the analyses list. */
function lastRunOf(agent: Agent, analyses: AnalysisLite[]) {
    const name = agent.name;
    if (!name) return null;
    const mine = analyses.filter(
        (a) => (a.agent_name || a.agent) === name &&
            !["running", "pending", "queued"].includes((a.status || "").toLowerCase()),
    );
    if (!mine.length) return null;
    const latest = mine.reduce((a, b) =>
        +new Date(b.updated_at || b.created_at || 0) > +new Date(a.updated_at || a.created_at || 0) ? b : a,
    );
    const failed = ["failed", "error", "canceled"].includes((latest.status || "").toLowerCase());
    return {
        score: failed ? null : latest.total_score != null ? Number(latest.total_score).toFixed(1) : null,
        failed,
        at: latest.updated_at || latest.created_at,
    };
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
    const [analyses, setAnalyses] = useState<AnalysisLite[]>([]);
    const [skillNames, setSkillNames] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);
    const [fetchError, setFetchError] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<Agent | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [query, setQuery] = useState("");

    useEffect(() => {
        let cancelled = false;
        Promise.all([
            AgentService.listAgents(),
            import("@/db").then(({ AnalysisService }) => AnalysisService.listAnalyses()).catch(() => []),
        ])
            .then(([agentsData, analysesData]) => {
                if (cancelled) return;
                setAgents(Array.isArray(agentsData) ? agentsData : []);
                setAnalyses(Array.isArray(analysesData) ? analysesData : []);
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
        <div className="mx-auto w-full max-w-6xl px-8 py-8">
            {/* Header */}
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <h1 className="text-[28px] font-bold tracking-tight text-console-ink">
                        Agents
                    </h1>
                    <p className="mt-1 text-sm text-console-ink-2">
                        Every analyst you've built — their philosophy and skills.
                    </p>
                </div>
                <Button onClick={() => navigate("/console/agent/new")}>
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
                <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="h-56 animate-pulse rounded-2xl bg-console-surface shadow-console" />
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
                        <Button onClick={() => navigate("/console/agent/new")}>
                            <Plus /> Create an agent
                        </Button>
                        <Button variant="accentSoft" onClick={() => navigate("/console/builder?mode=agent")}>
                            <Sparkles /> Build with AI
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
                                        navigate("/console/agent/" + newId);
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
                /* ── The portfolio — agents as cards in a grid ── */
                <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {filtered.length === 0 && (
                        <p className="col-span-full py-6 text-center text-sm text-console-ink-3">
                            No agents match that search.
                        </p>
                    )}
                    {filtered.map((agent) => {
                        const key = agent._id || agent.id || "";
                        const creed = creedOf(agent);
                        const run = lastRunOf(agent, analyses);
                        const skills = agent.skills || [];
                        return (
                            <motion.div
                                key={key}
                                layout
                                initial={{ opacity: 0, scale: 0.97 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ duration: 0.22 }}
                            >
                                <div
                                    role="link"
                                    tabIndex={0}
                                    onClick={() => navigate("/console/agent/" + key)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("/console/agent/" + key); }
                                    }}
                                    className="group flex h-full cursor-pointer flex-col gap-3 rounded-2xl bg-console-surface p-5 shadow-console transition-all duration-200 hover:-translate-y-0.5 hover:shadow-console-lift focus-visible:ring-2 focus-visible:ring-console-accent/40 focus-visible:outline-none"
                                >
                                    {/* Identity row */}
                                    <div className="flex min-w-0 items-center gap-3">
                                        <AgentAvatar agent={agent} size={44} label={agent.name || "Agent"} />
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate text-[15px] font-bold tracking-tight text-console-ink">
                                                {agent.name || "Untitled agent"}
                                            </p>
                                            {creed ? (
                                                <p className="mt-0.5 truncate text-xs italic text-console-ink-2">
                                                    “{creed}”
                                                </p>
                                            ) : (
                                                <p className="mt-0.5 truncate text-xs italic text-console-ink-4">
                                                    No philosophy written yet.
                                                </p>
                                            )}
                                        </div>
                                        <Button
                                            variant="ghost"
                                            size="iconSm"
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

                                    {/* Skill pills */}
                                    {skills.length ? (
                                        <div className="flex flex-wrap gap-1.5">
                                            {skills.slice(0, 3).map((s) => (
                                                <Badge key={s.skill_id} variant="accent">
                                                    {skillNames[s.skill_id] || s.skill_id}
                                                </Badge>
                                            ))}
                                            {skills.length > 3 && (
                                                <Badge variant="muted">+{skills.length - 3}</Badge>
                                            )}
                                        </div>
                                    ) : (
                                        <p className="text-xs italic text-console-ink-4">No skills attached yet.</p>
                                    )}

                                    {/* Last-run health */}
                                    <div className="mt-auto flex items-end justify-end pt-1">
                                        {run ? (
                                            run.failed ? (
                                                <div className="text-right">
                                                    <p className="text-xs font-semibold text-console-negative">Failed</p>
                                                    <p className="mt-0.5 text-[10px] tabular-nums text-console-ink-4">{timeAgo(run.at)}</p>
                                                </div>
                                            ) : (
                                                <div className="text-right">
                                                    <p className="text-lg leading-tight font-bold tabular-nums text-console-ink">
                                                        {run.score ?? "—"}
                                                    </p>
                                                    <p className="mt-0.5 text-[10px] tabular-nums text-console-ink-4">{timeAgo(run.at)}</p>
                                                </div>
                                            )
                                        ) : (
                                            <p className="text-xs italic text-console-ink-4">Never run</p>
                                        )}
                                    </div>
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
