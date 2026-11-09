import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
    FileText, FilePlus, Folder, FolderPlus, ChevronRight, Trash2,
} from "lucide-react";
import { SkillService, type SkillSummary } from "@/db";
import {
    buildTree, defaultSkillFiles, deletePath, parentDir,
    type SkillFiles, type TreeNode,
} from "@/lib/skillFiles";
import { getSkillTags, setSkillTags } from "@/lib/skillTags";
import { Button } from "@/components/ui/button";
import { toaster } from "@/compat/ui";
import { cn } from "@/lib/utils";

/**
 * Skill workspace — a navigable file tree next to a plain editor, the same
 * UI for viewing an existing skill and for creating a new one.
 *
 * Left: the skill's directory (SKILL.md, references/, assets/, …) with
 * add/delete for folders and files. Right: the selected file's content.
 * SKILL.md can't be deleted; a new skill starts from the default template
 * plus the spec's standard folders. Edits live in one in-memory map, so
 * switching files never loses unsaved work — Save commits the whole tree.
 */

interface SkillWorkspaceProps {
    /** Absent → create mode (template tree, saved via POST). */
    skill?: SkillSummary | null;
    library: SkillSummary[];
    onCancel: () => void;
    onSaved: (skill: SkillSummary) => void;
}

interface SkillIssue {
    line: number;
    message: string;
    severity: string;
}

/** Validate a user-typed file/folder name: no path separators, no dot paths. */
function cleanName(raw: string): string | null {
    const name = raw.trim();
    if (!name || name === "." || name === "..") return null;
    if (name.includes("/") || name.includes("\\")) return null;
    return name;
}

export default function SkillWorkspace({ skill, library, onCancel, onSaved }: SkillWorkspaceProps) {
    // Create mode starts from the template right away; edit mode loads on mount.
    const [files, setFiles] = useState<SkillFiles | null>(() => (skill ? null : defaultSkillFiles()));
    const [active, setActive] = useState("SKILL.md");
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [issues, setIssues] = useState<SkillIssue[]>([]);
    const [loadError, setLoadError] = useState(false);
    // Raw tag text while typing (commas/whitespace aren't valid tags yet);
    // null means "read the tags back out of the document". Cleared on blur —
    // any click that changes the active file blurs the input first.
    const [tagDraft, setTagDraft] = useState<string | null>(null);

    useEffect(() => {
        if (!skill) return;
        let cancelled = false;
        SkillService.readSkill(skill.id)
            .then((s) => {
                if (cancelled) return;
                const map: SkillFiles = { ...(s.files || {}) };
                if (!map["SKILL.md"]) map["SKILL.md"] = s.markdown || "";
                setFiles(map);
                setActive("SKILL.md");
                setLoadError(false);
            })
            .catch(() => { if (!cancelled) setLoadError(true); });
        return () => { cancelled = true; };
    }, [skill]);

    const tree = useMemo(() => buildTree(files || {}), [files]);
    const content = files?.[active] ?? "";
    const isBinary = content.startsWith("data:");
    const isFolder = active.endsWith("/");
    const folderCount = isFolder
        ? Object.keys(files || {}).filter((k) => k !== active && k.startsWith(active) && !k.endsWith("/")).length
        : 0;

    const toggleDir = (path: string) =>
        setCollapsed((prev) => {
            const next = new Set(prev);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            return next;
        });

    const setActiveFile = (path: string) => {
        setActive(path);
        if (!path.endsWith("/")) {
            // reveal the file's folder if the user collapsed it earlier
            setCollapsed((prev) => {
                const next = new Set(prev);
                parentDir(path).split("/").filter(Boolean).reduce<string>((acc, seg) => {
                    const dir = `${acc}${seg}/`;
                    next.delete(dir);
                    return dir;
                }, "");
                return next;
            });
        }
    };

    /** Where new folders/files land: inside the selected folder, else the
     *  selected file's directory, else the root. */
    const addBase = parentDir(active);

    const addFolder = () => {
        if (!files) return;
        const raw = window.prompt("Folder name", "new-folder");
        if (raw === null) return;
        const name = cleanName(raw);
        if (!name) {
            toaster.create({ title: "Invalid folder name", description: "Use a plain name — no / or ..", type: "error" });
            return;
        }
        const path = `${addBase}${name}/`;
        if (files[path] !== undefined) {
            toaster.create({ title: "Already exists", description: path, type: "error" });
            return;
        }
        setFiles({ ...files, [path]: "" });
        setCollapsed((prev) => { const next = new Set(prev); next.delete(path); return next; });
        setActive(path);
    };

    const addFile = () => {
        if (!files) return;
        const raw = window.prompt("File name", "new-file.md");
        if (raw === null) return;
        const name = cleanName(raw);
        if (!name) {
            toaster.create({ title: "Invalid file name", description: "Use a plain name — no / or ..", type: "error" });
            return;
        }
        const path = `${addBase}${name}`;
        if (files[path] !== undefined) {
            toaster.create({ title: "Already exists", description: path, type: "error" });
            return;
        }
        setFiles({ ...files, [path]: "" });
        setActive(path);
    };

    const remove = (node: TreeNode) => {
        if (!files || node.path === "SKILL.md") return;
        if (node.kind === "dir" && !window.confirm(`Delete ${node.name} and everything inside it?`)) return;
        const next = deletePath(files, node.path);
        setFiles(next);
        const removedPrefix = node.path.endsWith("/") ? node.path : node.path + "/";
        if (active === node.path || active.startsWith(removedPrefix)) setActive("SKILL.md");
    };

    const save = async () => {
        if (!files || saving) return;
        const markdown = files["SKILL.md"] || "";
        setSaving(true);
        setError(null);
        setIssues([]);
        try {
            if (!skill) {
                const id = markdown.match(/^name:\s*(\S+)\s*$/m)?.[1] || "";
                const collision = library.find((s) => s.id === id);
                if (collision && !window.confirm(`A skill named “${collision.name}” (${collision.id}) already exists — saving will overwrite it. Continue?`)) {
                    setSaving(false);
                    return;
                }
            }
            const res = skill
                ? await SkillService.updateSkill(skill.id, markdown, files)
                : await SkillService.saveSkill(markdown, files);
            onSaved(res.skill);
        } catch (e) {
            const data = typeof e === "object" && e !== null && "response" in e
                ? (e as { response?: { data?: { error?: string; issues?: SkillIssue[] } } }).response?.data
                : undefined;
            if (data?.issues) setIssues(data.issues);
            setError(data?.error || (e instanceof Error ? e.message : "Save failed"));
        } finally {
            setSaving(false);
        }
    };

    const renderNodes = (nodes: TreeNode[], depth: number): ReactNode =>
        nodes.map((node) => (
            <li key={node.path}>
                <div
                    className={cn(
                        "group flex items-center gap-1 pr-1",
                        active === node.path ? "bg-console-surface" : "hover:bg-console-surface/60",
                    )}
                    style={{ paddingLeft: 8 + depth * 14 }}
                >
                    <button
                        type="button"
                        onClick={() => {
                            if (node.kind === "dir") {
                                toggleDir(node.path);
                                setActive(node.path);
                            } else {
                                setActiveFile(node.path);
                            }
                        }}
                        className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left focus-visible:outline-none"
                        aria-current={active === node.path}
                    >
                        {node.kind === "dir" ? (
                            <ChevronRight
                                aria-hidden
                                className={cn("size-3.5 shrink-0 text-console-ink-4 transition-transform", !collapsed.has(node.path) && "rotate-90")}
                            />
                        ) : (
                            <FileText aria-hidden className="size-3.5 shrink-0 text-console-ink-4" />
                        )}
                        <span className={cn(
                            "truncate font-app-mono text-[12px]",
                            active === node.path ? "text-console-ink" : "text-console-ink-2",
                        )}>
                            {node.name}
                        </span>
                    </button>
                    {node.path !== "SKILL.md" && (
                        <button
                            type="button"
                            onClick={() => remove(node)}
                            aria-label={`Delete ${node.name}`}
                            className="rounded p-1 text-console-ink-4 opacity-0 transition hover:text-console-negative group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-console-accent/40 focus-visible:outline-none"
                        >
                            <Trash2 className="size-3.5" />
                        </button>
                    )}
                </div>
                {node.kind === "dir" && !collapsed.has(node.path) && node.children.length > 0 && (
                    <ul>{renderNodes(node.children, depth + 1)}</ul>
                )}
            </li>
        ));

    if (loadError) {
        return <p className="py-8 text-[13px] text-console-negative">Couldn&apos;t load this skill&apos;s files.</p>;
    }
    if (files === null) {
        return <p className="py-8 text-[13px] text-console-ink-3" role="status">Loading…</p>;
    }

    return (
        <div className="mt-4 flex min-h-[520px] border border-border bg-console-surface">
            {/* ── File tree ── */}
            <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-console-recessed/40">
                <div className="flex items-center justify-between border-b border-border px-3 py-2">
                    <span className="font-app-mono text-[10px] font-semibold tracking-[0.14em] text-console-ink-3 uppercase">Files</span>
                    <span className="flex gap-0.5">
                        <button
                            type="button"
                            onClick={addFolder}
                            aria-label="New folder"
                            className="rounded p-1 text-console-ink-3 transition hover:bg-console-surface hover:text-console-ink focus-visible:ring-2 focus-visible:ring-console-accent/40 focus-visible:outline-none"
                        >
                            <FolderPlus className="size-3.5" />
                        </button>
                        <button
                            type="button"
                            onClick={addFile}
                            aria-label="New file"
                            className="rounded p-1 text-console-ink-3 transition hover:bg-console-surface hover:text-console-ink focus-visible:ring-2 focus-visible:ring-console-accent/40 focus-visible:outline-none"
                        >
                            <FilePlus className="size-3.5" />
                        </button>
                    </span>
                </div>
                <ul className="flex-1 overflow-y-auto py-1.5">
                    {renderNodes(tree, 0)}
                </ul>
            </aside>

            {/* ── Editor ── */}
            <section className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-center gap-3 border-b border-border px-4 py-2">
                    <span className="min-w-0 flex-1 truncate font-app-mono text-[12px] text-console-ink-2">{active}</span>
                    {active === "SKILL.md" && (
                        <input
                            value={tagDraft ?? getSkillTags(content).join(", ")}
                            onChange={(e) => {
                                setTagDraft(e.target.value);
                                setFiles((prev) => (prev && prev["SKILL.md"] !== undefined
                                    ? { ...prev, "SKILL.md": setSkillTags(prev["SKILL.md"], e.target.value) }
                                    : prev));
                            }}
                            placeholder="tags…"
                            aria-label="Skill tags"
                            spellCheck={false}
                            onBlur={() => setTagDraft(null)}
                            className="h-7 w-44 shrink-0 rounded-[4px] border border-border bg-transparent px-2 font-app-mono text-[11px] text-console-ink-2 placeholder:text-console-ink-4 focus:outline-none focus:ring-2 focus:ring-console-accent/40"
                        />
                    )}
                    {skill?.source === "builtin" && (
                        <span className="font-app-mono text-[10px] tracking-wide text-console-accent">SAVES AS YOUR COPY</span>
                    )}
                    <Button variant="ghost" size="sm" onClick={onCancel} className="text-console-ink-3">Cancel</Button>
                    <Button size="sm" className="rounded-none px-4" disabled={saving} onClick={save}>
                        {saving ? "Saving…" : "Save"}
                    </Button>
                </div>

                <div className="flex-1 overflow-y-auto">
                    {isFolder ? (
                        <p className="px-4 py-6 text-[13px] text-console-ink-3">
                            <Folder aria-hidden className="mr-1.5 inline size-3.5 align-[-2px]" />
                            {folderCount === 0 ? "Empty folder — add a file with the + button." : `${folderCount} file${folderCount === 1 ? "" : "s"} in this folder.`}
                        </p>
                    ) : isBinary ? (
                        <div className="px-4 py-4">
                            <img src={content} alt={active} className="max-h-72 border border-border" />
                            <p className="mt-2 text-[12px] text-console-ink-3">Binary file — preview only.</p>
                        </div>
                    ) : (
                        <textarea
                            value={content}
                            onChange={(e) => setFiles((prev) => (prev ? { ...prev, [active]: e.target.value } : prev))}
                            spellCheck={false}
                            aria-label={`Editing ${active}`}
                            className="min-h-[420px] w-full resize-none bg-transparent px-4 py-3 font-app-mono text-[12.5px] leading-relaxed text-console-ink-2 focus:outline-none"
                        />
                    )}
                </div>

                {(error || issues.length > 0) && (
                    <div className="border-t border-border px-4 py-2">
                        {error && <p className="text-[12px] text-console-negative">{error}</p>}
                        {issues.map((iss, i) => (
                            <p key={i} className="text-[11.5px] text-console-negative">
                                {iss.severity === "error" ? "✗" : "⚠"} line {iss.line}: {iss.message}
                            </p>
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}
