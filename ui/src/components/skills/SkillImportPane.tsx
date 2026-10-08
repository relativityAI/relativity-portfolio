import { useEffect, useMemo, useState } from "react";
import { Download, ExternalLink, RotateCw, Search, X } from "lucide-react";
import { FaGithub } from "react-icons/fa6";
import { SkillRepoService, type RepoSkill, type SkillRepo, type SkillSummary } from "@/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toaster } from "@/compat/ui";
import { cn } from "@/lib/utils";

/**
 * Download skills — browse the configured GitHub repositories, read a skill
 * on GitHub first (external link), then pull it into the user's library.
 * Replaces the grid while open, exactly like SkillCreatePane does.
 */

/** Server-provided message when there is one, else the client-side message. */
function errMsg(e: unknown, fallback: string): string {
    const err = e as { response?: { data?: { error?: string } }; message?: string };
    return err?.response?.data?.error || err?.message || fallback;
}
export default function SkillImportPane({
    library,
    onCancel,
    onSaved,
}: {
    library: SkillSummary[];
    onCancel: () => void;
    onSaved: (skill: SkillSummary) => void;
}) {
    const [repos, setRepos] = useState<SkillRepo[] | null>(null);
    const [repoError, setRepoError] = useState("");
    const [reposAttempt, setReposAttempt] = useState(0);
    const [repoId, setRepoId] = useState("");
    const [listAttempt, setListAttempt] = useState(0);
    const [skillState, setSkillState] = useState<{ forRepo: string; list: RepoSkill[] | null; error: string }>({
        forRepo: "",
        list: null,
        error: "",
    });
    const [query, setQuery] = useState("");
    const [importing, setImporting] = useState<string | null>(null);
    const [added, setAdded] = useState<Record<string, boolean>>({});

    // Loading/error are derived from which repo the state belongs to, so a
    // repo switch shows the skeleton without a synchronous setState in here.
    const skills = skillState.forRepo === repoId ? skillState.list : null;
    const listError = skillState.forRepo === repoId ? skillState.error : "";

    useEffect(() => {
        let cancelled = false;
        SkillRepoService.listRepos()
            .then((rs) => {
                if (cancelled) return;
                setRepos(rs);
                setRepoId((current) => current || rs[0]?.id || "");
            })
            .catch((e) => { if (!cancelled) setRepoError(errMsg(e, "Couldn't load repositories.")); });
        return () => { cancelled = true; };
    }, [reposAttempt]);

    useEffect(() => {
        if (!repoId) return;
        let cancelled = false;
        SkillRepoService.listRepoSkills(repoId)
            .then((list) => { if (!cancelled) setSkillState({ forRepo: repoId, list, error: "" }); })
            .catch((e) => {
                if (!cancelled) setSkillState({ forRepo: repoId, list: null, error: errMsg(e, "Couldn't list skills.") });
            });
        return () => { cancelled = true; };
    }, [repoId, listAttempt]);

    const retryRepos = () => {
        setRepos(null);
        setRepoError("");
        setReposAttempt((n) => n + 1);
    };

    const retryList = () => {
        setSkillState({ forRepo: "", list: null, error: "" });
        setListAttempt((n) => n + 1);
    };

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!skills) return [];
        if (!q) return skills;
        return skills.filter(
            (s) =>
                s.name.toLowerCase().includes(q) ||
                s.id.includes(q) ||
                s.description.toLowerCase().includes(q),
        );
    }, [skills, query]);

    const download = async (s: RepoSkill) => {
        setImporting(s.path);
        try {
            const { skill, repaired } = await SkillRepoService.importSkill(repoId, s.path);
            setAdded((a) => ({ ...a, [s.path]: true }));
            onSaved(skill);
            toaster.create({
                title: `${skill.name} downloaded`,
                description: repaired
                    ? "Saved with small format adjustments so it fits your library."
                    : "Added to your skill library.",
                type: "success",
            });
        } catch (e) {
            toaster.create({
                title: "Couldn't download",
                description: errMsg(e, "The download failed."),
                type: "error",
            });
        } finally {
            setImporting(null);
        }
    };

    const repo = repos?.find((r) => r.id === repoId) || null;

    return (
        <div className="mt-5 max-w-4xl">
            {/* Header */}
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <h2 className="font-app-display text-[24px] leading-tight font-medium tracking-tight text-console-ink">
                        Download skills
                    </h2>
                    <p className="mt-1 max-w-[70ch] text-[13px] text-console-ink-2">
                        Browse a GitHub repository, open any skill to read it first, then download it into
                        your library.
                    </p>
                </div>
                <Button variant="ghost" size="icon" aria-label="Back to the skill library" onClick={onCancel}>
                    <X />
                </Button>
            </div>

            {/* Source repos as chips, with a filter when the list gets long. */}
            <div className="mt-5 flex flex-wrap items-center gap-2">
                <FaGithub aria-hidden="true" className="mr-0.5 size-4 shrink-0 text-console-ink-4" />
                {repos === null && !repoError && (
                    <span className="h-6 w-32 animate-pulse rounded-full bg-console-recessed" aria-hidden />
                )}
                {repos?.map((r) => (
                    <button
                        key={r.id}
                        type="button"
                        onClick={() => setRepoId(r.id)}
                        aria-pressed={repoId === r.id}
                        className={cn(
                            "rounded-full border px-3 py-1 text-xs font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-console-accent/40",
                            repoId === r.id
                                ? "border-console-accent bg-console-surface text-console-ink shadow-console"
                                : "border-border text-console-ink-3",
                        )}
                    >
                        {r.label}
                    </button>
                ))}
                {!!skills?.length && skills.length > 8 && (
                    <div className="relative ml-auto min-w-52">
                        <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-console-ink-4" />
                        <Input
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Filter skills…"
                            aria-label="Filter downloadable skills"
                            className="h-7 pl-8 text-xs"
                        />
                    </div>
                )}
            </div>

            {/* States */}
            {repoError ? (
                <p className="mt-6 text-[13px] text-console-negative">
                    {repoError}{" "}
                    <button type="button" className="underline underline-offset-2" onClick={retryRepos}>
                        Retry
                    </button>
                </p>
            ) : !repoId ? (
                <p className="mt-6 text-[13px] text-console-ink-3">
                    No skill repositories are configured yet.
                </p>
            ) : listError ? (
                <p className="mt-6 text-[13px] text-console-negative">
                    {listError}{" "}
                    <button
                        type="button"
                        className="underline underline-offset-2"
                        onClick={retryList}
                    >
                        Retry
                    </button>
                </p>
            ) : skills === null ? (
                <div className="mt-5 border-t border-border" role="status" aria-label="Loading skills">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="h-[52px] animate-pulse border-b border-border" />
                    ))}
                </div>
            ) : filtered.length === 0 ? (
                <p className="mt-6 text-[13px] text-console-ink-3">
                    {skills.length === 0
                        ? `No SKILL.md files found in ${repo?.label || "this repository"}.`
                        : "No skills match that filter."}
                </p>
            ) : (
                <ul className="mt-5 border-t border-border">
                    {filtered.map((s) => {
                        const have = library.some((x) => x.id === s.id) || !!added[s.path];
                        return (
                            <li
                                key={s.path}
                                className="flex items-center gap-3 border-b border-border py-2.5"
                            >
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-baseline gap-2">
                                        <span className="truncate text-sm font-medium text-console-ink">
                                            {s.name}
                                        </span>
                                        <span className="shrink-0 font-app-mono text-[10px] text-console-ink-4">
                                            {s.id}
                                        </span>
                                    </div>
                                    <p className="truncate text-[12px] leading-snug text-console-ink-3">
                                        {s.description || s.path}
                                    </p>
                                </div>
                                <a
                                    href={s.html_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="rounded-md p-1.5 text-console-ink-4 outline-none transition hover:text-console-accent focus-visible:ring-2 focus-visible:ring-console-accent/40"
                                    title={`Read ${s.name} on GitHub (opens in a new tab)`}
                                >
                                    <ExternalLink aria-hidden="true" className="size-4" />
                                    <span className="sr-only">Read {s.name} on GitHub</span>
                                </a>
                                {have ? (
                                    <span className="w-[92px] shrink-0 text-right text-[10px] font-medium tracking-wide text-console-ink-4 uppercase">
                                        In library
                                    </span>
                                ) : (
                                    <Button
                                        size="xs"
                                        variant="outline"
                                        disabled={importing !== null}
                                        onClick={() => download(s)}
                                    >
                                        <Download aria-hidden="true" />
                                        {importing === s.path ? "Downloading…" : "Download"}
                                    </Button>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}

            {skills !== null && skills.length > 0 && (
                <p className="mt-3 flex items-center gap-1.5 text-[11px] text-console-ink-4">
                    <RotateCw aria-hidden="true" className="size-3" />
                    The repository is re-scanned every few minutes.
                </p>
            )}
        </div>
    );
}
