import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { Blocks, ArrowUp, ArrowDown, X, Plus, Search, Check } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import {
    Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { SkillSourceBadge } from "@/components/console/SkillSourceBadge";
import { SkillService, type SkillSummary } from "@/db";
import { cn } from "@/lib/utils";

export interface AgentSkillRef {
    skill_id: string;
    weight: number;
}

interface SkillsSectionProps {
    skills: AgentSkillRef[];
    skillNames: Record<string, string>;
    onChange: (skills: AgentSkillRef[]) => void;
    onOpenLibrary: () => void;
    onInspect: (skillId: string) => void;
}

/**
 * Inline skill picker — choose from the available skills without leaving the
 * agent settings page. Search, provenance badges, and one-click attach.
 */
function SkillPicker({
    attachedIds,
    onPick,
}: {
    attachedIds: Set<string>;
    onPick: (skill: SkillSummary) => void;
}) {
    const [open, setOpen] = useState(false);
    const [library, setLibrary] = useState<SkillSummary[]>([]);
    const [loading, setLoading] = useState(false);
    const [query, setQuery] = useState("");

    useEffect(() => {
        if (!open || library.length) return;
        setLoading(true);
        SkillService.listSkills()
            .then((data) => setLibrary(Array.isArray(data) ? data : []))
            .catch(() => {})
            .finally(() => setLoading(false));
    }, [open, library.length]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return library;
        return library.filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q));
    }, [library, query]);

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button variant="secondary" size="sm">
                    <Plus /> Add skills
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-96 p-0 overflow-hidden">
                <div className="p-3 pb-2">
                    <div className="relative">
                        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-console-ink-4" />
                        <Input
                            autoFocus
                            className="pl-9"
                            placeholder="Search skills…"
                            aria-label="Search skills to attach"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                        />
                    </div>
                </div>
                <div className="max-h-80 overflow-y-auto px-2 pb-2">
                    {loading ? (
                        <div className="space-y-2 py-2" role="status" aria-label="Loading skills">
                            {Array.from({ length: 5 }).map((_, i) => (
                                <div key={i} className="h-11 animate-pulse rounded-xl bg-console-recessed" />
                            ))}
                        </div>
                    ) : filtered.length === 0 ? (
                        <p className="px-2 py-6 text-center text-[13px] text-console-ink-3">
                            {library.length === 0 ? "The skill library is empty." : "No skills match that search."}
                        </p>
                    ) : (
                        filtered.map((s) => {
                            const attached = attachedIds.has(s.id);
                            return (
                                <button
                                    key={s.id}
                                    disabled={attached}
                                    onClick={() => { onPick(s); }}
                                    aria-label={attached ? `${s.name} already attached` : `Attach ${s.name}`}
                                    className={cn(
                                        "flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition-colors outline-none",
                                        attached
                                            ? "cursor-default opacity-55"
                                            : "hover:bg-console-recessed/70 focus-visible:ring-2 focus-visible:ring-console-accent/40",
                                    )}
                                >
                                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-console-accent-soft text-console-accent-strong">
                                        <Blocks className="size-4" aria-hidden />
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="flex items-center gap-1.5">
                                            <span className="truncate text-[13px] font-medium text-console-ink">{s.name}</span>
                                            <SkillSourceBadge source={s.source} />
                                        </span>
                                        <span className="mt-0.5 block truncate text-[11px] text-console-ink-3">
                                            {s.description}
                                        </span>
                                    </span>
                                    {attached ? (
                                        <Check className="size-4 shrink-0 text-console-positive" aria-label="Attached" />
                                    ) : (
                                        <Plus className="size-4 shrink-0 text-console-ink-4" />
                                    )}
                                </button>
                            );
                        })
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
}

export default function SkillsSection({
    skills, skillNames, onChange, onOpenLibrary, onInspect,
}: SkillsSectionProps) {
    const totalWeight = useMemo(() => skills.reduce((s, x) => s + (x.weight || 5), 0), [skills]);

    const setWeight = (id: string, weight: number) =>
        onChange(skills.map((s) => (s.skill_id === id ? { ...s, weight } : s)));

    const remove = (id: string) => onChange(skills.filter((s) => s.skill_id !== id));

    const move = (index: number, dir: -1 | 1) => {
        const next = [...skills];
        const target = index + dir;
        if (target < 0 || target >= next.length) return;
        [next[index], next[target]] = [next[target], next[index]];
        onChange(next);
    };

    const pick = (skill: SkillSummary) => {
        onChange([...skills, { skill_id: skill.id, weight: 5 }]);
    };

    const attachedIds = useMemo(() => new Set(skills.map((s) => s.skill_id)), [skills]);

    return (
        <motion.div
            variants={{ animate: { transition: { staggerChildren: 0.04 } } }}
            initial="initial"
            animate="animate"
            className="flex flex-col gap-3"
        >
            {skills.map((ref, i) => {
                const name = skillNames[ref.skill_id] || ref.skill_id;
                const share = totalWeight > 0 ? Math.round(((ref.weight || 5) / totalWeight) * 100) : 0;
                return (
                    <motion.div
                        key={ref.skill_id}
                        variants={{ initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } }}
                        layout
                        transition={{ type: "spring", stiffness: 320, damping: 30 }}
                        className="rounded-2xl bg-console-surface p-4 shadow-console"
                    >
                        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                            {/* Identity */}
                            <div className="flex min-w-0 flex-1 basis-52 items-center gap-3">
                                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-console-accent-soft text-console-accent-strong">
                                    <Blocks className="size-4" aria-hidden />
                                </span>
                                <div className="min-w-0">
                                    <button
                                        className="block max-w-full truncate text-left text-sm font-semibold text-console-ink transition-colors hover:text-console-accent-strong focus-visible:ring-2 focus-visible:ring-console-accent/40 focus-visible:outline-none"
                                        onClick={() => onInspect(ref.skill_id)}
                                    >
                                        {name}
                                    </button>
                                    <p className="text-[11px] text-console-ink-4">
                                        {share}% of score
                                    </p>
                                </div>
                            </div>

                            {/* Weight — shadcn slider, borderless */}
                            <div className="min-w-[160px] flex-1 basis-56">
                                <div className="flex items-center justify-between pb-1.5">
                                    <span className="text-[11px] font-medium text-console-ink-3">
                                        Weight
                                    </span>
                                    <span className="text-xs font-bold tabular-nums text-console-ink-2">
                                        {ref.weight || 5}/10
                                    </span>
                                </div>
                                <Slider
                                    value={[ref.weight || 5]}
                                    onValueChange={(v) => setWeight(ref.skill_id, v[0])}
                                    min={1}
                                    max={10}
                                    step={1}
                                    aria-label={`Weight for ${name}`}
                                />
                            </div>

                            {/* Order + remove */}
                            <div className="flex shrink-0 gap-0.5">
                                <Button variant="ghost" size="iconSm" aria-label={`Move ${name} up`} onClick={() => move(i, -1)} disabled={i === 0}>
                                    <ArrowUp />
                                </Button>
                                <Button variant="ghost" size="iconSm" aria-label={`Move ${name} down`} onClick={() => move(i, 1)} disabled={i === skills.length - 1}>
                                    <ArrowDown />
                                </Button>
                                <Button variant="ghost" size="iconSm" aria-label={`Remove ${name}`} onClick={() => remove(ref.skill_id)}>
                                    <X className="text-console-negative" />
                                </Button>
                            </div>
                        </div>
                    </motion.div>
                );
            })}

            {skills.length === 0 ? (
                <div className="rounded-2xl bg-console-recessed/60 px-5 py-8 text-center">
                    <p className="text-[13px] font-medium text-console-ink">No skills attached</p>
                    <p className="mx-auto mt-1 max-w-sm text-[12.5px] text-console-ink-3">
                        An agent needs at least one skill to score anything. Add one to start.
                    </p>
                </div>
            ) : (
                <p className="text-[11.5px] text-console-ink-3">
                    Weight scales each skill's contribution to the fit score
                    {skills.length > 1 ? ` — shares shown per card (total weight ${totalWeight})` : ""}.
                </p>
            )}

            <div className="-mt-1 flex flex-wrap items-center justify-end gap-1.5">
                <SkillPicker attachedIds={attachedIds} onPick={pick} />
                <Button variant="ghost" size="sm" onClick={onOpenLibrary}>
                    Browse all
                </Button>
            </div>
        </motion.div>
    );
}
