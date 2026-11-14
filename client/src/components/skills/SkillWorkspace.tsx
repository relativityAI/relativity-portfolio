import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
    FileText, FilePlus, Folder, FolderOpen, FolderPlus, ChevronRight, Trash2, Save, X,
    Eye, Code,
} from "lucide-react";
import { SkillService, type SkillSummary } from "@/db";
import {
    buildTree, defaultSkillFiles, deletePath, movePath, parentDir,
    type SkillFiles, type TreeNode,
} from "@/lib/skillFiles";
import { getSkillTags, setSkillTags } from "@/lib/skillTags";
import { SkillMarkdown } from "@/components/skills/SkillMarkdown";
import TagInput from "@/components/shared/TagInput";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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
    /** Rendered at the top of the file navigator — avatar, title, actions. */
    asideHeader?: ReactNode;
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

export default function SkillWorkspace({ skill, library, onCancel, onSaved, asideHeader }: SkillWorkspaceProps) {
    // Create mode starts from the template right away; edit mode loads on mount.
    const [files, setFiles] = useState<SkillFiles | null>(() => (skill ? null : defaultSkillFiles()));
    const [active, setActive] = useState("SKILL.md");
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [issues, setIssues] = useState<SkillIssue[]>([]);
    const [loadError, setLoadError] = useState(false);
    // Uncommitted tag text — flushed into SKILL.md on Save.
    const [tagText, setTagText] = useState("");
    // Inline "new file/folder" box — no modal, no window.prompt.
    const [adding, setAdding] = useState<null | "file" | "folder">(null);
    const [newName, setNewName] = useState("");
    // Drag to rearrange (internal), or drop files in from the desktop.
    const [dragging, setDragging] = useState<string | null>(null);
    const [dropOn, setDropOn] = useState<string | null>(null);
    // Inline "are you sure?" for the row being deleted.
    const [confirmDel, setConfirmDel] = useState<string | null>(null);
    // Highlight while files are dragged in from the desktop.
    const [fileDrag, setFileDrag] = useState(false);
    // Rendered markdown by default; the toggle drops back to raw source.
    const [preview, setPreview] = useState(true);
    // Snapshot of the last loaded/saved tree — anything else is unsaved.
    // Seed it from the starting files (template on create, empty until load).
    const [saved, setSaved] = useState(() => JSON.stringify(files ?? {}));

    const dirty = files !== null && (JSON.stringify(files) !== saved || !!tagText.trim());

    useEffect(() => {
        if (!skill) return;
        let cancelled = false;
        SkillService.readSkill(skill.id)
            .then((s) => {
                if (cancelled) return;
                const map: SkillFiles = { ...(s.files || {}) };
                if (!map["SKILL.md"]) map["SKILL.md"] = s.markdown || "";
                setFiles(map);
                setSaved(JSON.stringify(map));
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
    const canPreview = !isFolder && !isBinary && active.endsWith(".md");
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

    const startAdd = (kind: "file" | "folder") => {
        setAdding(kind);
        setNewName(kind === "folder" ? "new-folder" : "new-file.md");
    };

    const commitAdd = () => {
        if (!files || !adding) return;
        const kind = adding;
        const name = cleanName(newName);
        if (!name) {
            toaster.create({ title: `Invalid ${kind} name`, description: "Use a plain name — no / or ..", type: "error" });
            return;
        }
        const path = kind === "folder" ? `${addBase}${name}/` : `${addBase}${name}`;
        if (files[path] !== undefined) {
            toaster.create({ title: "Already exists", description: path, type: "error" });
            return;
        }
        setFiles({ ...files, [path]: "" });
        if (kind === "folder") setCollapsed((prev) => { const next = new Set(prev); next.delete(path); return next; });
        setActive(path);
        setAdding(null);
    };

    const nameOf = (path: string) => path.split("/").filter(Boolean).pop() || path;

    const moveTo = (from: string, to: string) => {
        if (!files || from === to) return;
        const next = movePath(files, from, to);
        if (next === files) return;
        setFiles(next);
        const fromPrefix = from.endsWith("/") ? from : from + "/";
        if (active === from) setActive(to);
        else if (active.startsWith(fromPrefix)) setActive(to + active.slice(from.length));
    };

    /** Drop on a row: into that folder, or next to that file. */
    const dropRow = (node: TreeNode) => {
        if (dragging) {
            const suffix = dragging.endsWith("/") ? "/" : "";
            const to = node.kind === "dir"
                ? node.path + nameOf(dragging) + suffix
                : parentDir(node.path) + nameOf(dragging) + suffix;
            moveTo(dragging, to);
            if (node.kind === "dir") setCollapsed((prev) => { const n = new Set(prev); n.delete(node.path); return n; });
        }
        setDragging(null);
        setDropOn(null);
    };

    const readFileContent = async (file: File): Promise<string> => {
        const textual = file.type.startsWith("text/")
            || /\.(md|markdown|txt|json|csv|ya?ml|js|jsx|ts|tsx|css|html|py|sh|toml|ini)$/i.test(file.name);
        if (textual) return await file.text();
        return await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result ?? ""));
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
        });
    };

    /** Drop files from the desktop into a folder ("" = root). */
    const importFiles = async (list: FileList, dir: string) => {
        if (!files || !list.length) return;
        const next = { ...files };
        const added: string[] = [];
        let skipped = 0;
        for (const file of Array.from(list)) {
            const path = `${dir}${file.name}`;
            if (next[path] !== undefined || next[`${path}/`] !== undefined) { skipped++; continue; }
            next[path] = await readFileContent(file);
            added.push(path);
        }
        if (!added.length) {
            toaster.create({ title: skipped ? "Already in this skill" : "Nothing to add", type: "error" });
            return;
        }
        setFiles(next);
        setCollapsed((prev) => { const n = new Set(prev); n.delete(dir); return n; });
        setActive(added[0]);
        if (skipped) toaster.create({ title: `Skipped ${skipped} — already in this skill`, type: "info" });
    };

    const remove = (node: TreeNode) => {
        if (!files || node.path === "SKILL.md") return;
        const next = deletePath(files, node.path);
        setFiles(next);
        const removedPrefix = node.path.endsWith("/") ? node.path : node.path + "/";
        if (active === node.path || active.startsWith(removedPrefix)) setActive("SKILL.md");
    };

    const save = async () => {
        if (!files || saving) return;
        // Text still in the tag box becomes one more tag on save.
        let map = files;
        if (tagText.trim() && map["SKILL.md"] !== undefined) {
            const tags = [...getSkillTags(map["SKILL.md"]), tagText.trim()];
            map = { ...map, "SKILL.md": setSkillTags(map["SKILL.md"], tags.join(", ")) };
            setFiles(map);
            setTagText("");
        }
        const markdown = map["SKILL.md"] || "";
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
                ? await SkillService.updateSkill(skill.id, markdown, map)
                : await SkillService.saveSkill(markdown, map);
            setSaved(JSON.stringify(map));
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
                    draggable
                    onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", node.path);
                        e.dataTransfer.effectAllowed = "move";
                        setDragging(node.path);
                    }}
                    onDragEnd={() => { setDragging(null); setDropOn(null); }}
                    onDragOver={(e) => {
                        if (!dragging) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        if (dropOn !== node.path) setDropOn(node.path);
                    }}
                    onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        dropRow(node);
                    }}
                    className={cn(
                        "group flex items-center gap-1 rounded pr-1",
                        active === node.path ? "text-console-ink" : "text-console-ink-2 hover:text-console-ink",
                        dropOn === node.path && "ring-1 ring-console-accent/60",
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
                            <>
                                <ChevronRight
                                    aria-hidden
                                    className={cn("size-3.5 shrink-0 text-console-ink-4 transition-transform", !collapsed.has(node.path) && "rotate-90")}
                                />
                                {collapsed.has(node.path) ? (
                                    <Folder aria-hidden className="size-3.5 shrink-0 text-console-ink-4" />
                                ) : (
                                    <FolderOpen aria-hidden className="size-3.5 shrink-0 text-console-ink-4" />
                                )}
                            </>
                        ) : (
                            <FileText aria-hidden className="size-3.5 shrink-0 text-console-ink-4" />
                        )}
                        <span className="truncate font-app-mono text-[12px]">{node.name}</span>
                    </button>
                    {node.path !== "SKILL.md" && (
                        <button
                            type="button"
                            onClick={() => setConfirmDel(node.path)}
                            aria-label={`Delete ${node.name}`}
                            className="rounded p-1 text-console-ink-4 opacity-0 transition hover:text-console-negative group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-console-accent/40 focus-visible:outline-none"
                        >
                            <Trash2 className="size-3.5" />
                        </button>
                    )}
                </div>
                {confirmDel === node.path && (
                    <div className="my-1 ml-6 flex items-center gap-2 rounded-[6px] border-[0.5px] border-[color:var(--hairline)] px-2 py-1">
                        <span className="min-w-0 flex-1 truncate font-app-body text-[11px] text-console-ink-3">
                            Delete {node.name}{node.kind === "dir" ? " and everything inside it?" : "?"}
                        </span>
                        <button
                            type="button"
                            onClick={() => { remove(node); setConfirmDel(null); }}
                            className="rounded px-1.5 py-0.5 font-app-body text-[11px] text-console-negative transition hover:text-console-ink focus-visible:ring-2 focus-visible:ring-console-accent/40 focus-visible:outline-none"
                        >
                            Delete
                        </button>
                        <button
                            type="button"
                            onClick={() => setConfirmDel(null)}
                            aria-label="Cancel delete"
                            className="rounded p-0.5 text-console-ink-4 transition hover:text-console-ink focus-visible:ring-2 focus-visible:ring-console-accent/40 focus-visible:outline-none"
                        >
                            <X className="size-3" />
                        </button>
                    </div>
                )}
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
        <div className="flex h-full min-h-[520px] overflow-hidden rounded-xl border border-border bg-console-surface">
            {/* ── File tree ── */}
            <aside
                className="flex w-64 shrink-0 flex-col border-r border-border bg-console-surface"
                onDragOver={(e) => {
                    const filesDrag = e.dataTransfer.types.includes("Files");
                    if (dragging || filesDrag) e.preventDefault();
                    if (filesDrag && !fileDrag) setFileDrag(true);
                }}
                onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFileDrag(false);
                }}
                onDrop={(e) => {
                    e.preventDefault();
                    setFileDrag(false);
                    if (dragging) {
                        const suffix = dragging.endsWith("/") ? "/" : "";
                        moveTo(dragging, nameOf(dragging) + suffix);
                        setDragging(null);
                        setDropOn(null);
                        return;
                    }
                    void importFiles(e.dataTransfer.files, addBase);
                }}
            >
                {asideHeader && <div className="border-b border-border px-3 py-2.5">{asideHeader}</div>}
                <div className="flex items-center justify-between border-b border-border px-3 py-2">
                    <span className="font-app-mono text-[10px] font-semibold tracking-[0.14em] text-console-ink-3 uppercase">Files</span>
                    <span className="flex gap-0.5">
                        <button
                            type="button"
                            onClick={() => startAdd("folder")}
                            aria-label="New folder"
                            className="rounded p-1 text-console-ink-3 transition hover:text-console-ink focus-visible:ring-2 focus-visible:ring-console-accent/40 focus-visible:outline-none"
                        >
                            <FolderPlus className="size-3.5" />
                        </button>
                        <button
                            type="button"
                            onClick={() => startAdd("file")}
                            aria-label="New file"
                            className="rounded p-1 text-console-ink-3 transition hover:text-console-ink focus-visible:ring-2 focus-visible:ring-console-accent/40 focus-visible:outline-none"
                        >
                            <FilePlus className="size-3.5" />
                        </button>
                    </span>
                </div>
                {adding && (
                    <div className="border-b border-border px-2 py-1.5">
                        <input
                            autoFocus
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") commitAdd();
                                else if (e.key === "Escape") setAdding(null);
                            }}
                            onBlur={() => setAdding(null)}
                            placeholder={adding === "folder" ? "folder name" : "file name"}
                            aria-label={adding === "folder" ? "New folder name" : "New file name"}
                            className="h-7 w-full rounded-[6px] border-[0.5px] border-[color:var(--hairline)] bg-console-surface px-2 font-app-mono text-[12px] text-console-ink outline-none focus-visible:ring-1 focus-visible:ring-console-accent/40"
                        />
                    </div>
                )}
                <ul className="flex-1 overflow-y-auto py-1.5">
                    {renderNodes(tree, 0)}
                </ul>
                <div
                    className={cn(
                        "border-t border-border px-3 py-2 text-center font-app-body text-[11px] transition-colors",
                        fileDrag ? "text-console-accent" : "text-console-ink-4",
                    )}
                >
                    Drop any file you want
                </div>
            </aside>

            {/* ── Editor ── */}
            <section className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                    <span className="min-w-0 flex-1 truncate font-app-mono text-[12px] text-console-ink-2">{active}</span>
                    {active === "SKILL.md" && (
                        <div className="w-56 shrink-0">
                            <TagInput
                                value={getSkillTags(content)}
                                text={tagText}
                                onText={setTagText}
                                onTags={(tags) => setFiles((prev) => (prev && prev["SKILL.md"] !== undefined
                                    ? { ...prev, "SKILL.md": setSkillTags(prev["SKILL.md"], tags.join(", ")) }
                                    : prev))}
                                className="flex min-h-8 w-full flex-wrap items-center gap-1.5 rounded-[6px] border-[0.5px] border-[color:var(--hairline)] bg-transparent px-2 py-1 focus-within:ring-1 focus-within:ring-console-accent/40"
                            />
                        </div>
                    )}
                    {skill?.source === "builtin" && (
                        <span className="hidden shrink-0 font-app-mono text-[10px] tracking-wide text-console-accent lg:inline">SAVES AS YOUR COPY</span>
                    )}
                    {canPreview && (
                        <ToggleGroup
                            type="single"
                            value={preview ? "rendered" : "source"}
                            onValueChange={(v) => { if (v) setPreview(v === "rendered"); }}
                            aria-label="Markdown view"
                            className="h-8 shrink-0 gap-1 rounded-xl border-0 bg-console-recessed p-1"
                        >
                            <ToggleGroupItem
                                value="rendered"
                                aria-label="Rendered"
                                className="h-6 w-7 flex-none rounded-[8px] border-0 px-0 text-console-ink-3 hover:bg-console-surface/60 hover:text-console-ink data-[state=on]:bg-console-surface data-[state=on]:text-console-ink data-[state=on]:shadow-none"
                            >
                                <Eye className="size-3.5" />
                            </ToggleGroupItem>
                            <ToggleGroupItem
                                value="source"
                                aria-label="Source"
                                className="h-6 w-7 flex-none rounded-[8px] border-0 px-0 text-console-ink-3 hover:bg-console-surface/60 hover:text-console-ink data-[state=on]:bg-console-surface data-[state=on]:text-console-ink data-[state=on]:shadow-none"
                            >
                                <Code className="size-3.5" />
                            </ToggleGroupItem>
                        </ToggleGroup>
                    )}
                    <span className="flex shrink-0 items-center gap-1.5">
                        <span className={cn("size-1.5 rounded-full", dirty ? "bg-console-negative animate-[pulse_3s_ease-in-out_infinite]" : "bg-console-positive")} />
                        <span className="text-[11px] font-medium text-console-ink-3">{dirty ? "Unsaved" : "Saved"}</span>
                    </span>
                    <Button size="sm" className="shrink-0 px-4" disabled={saving} onClick={save}>
                        {saving ? "Saving…" : <><Save size={14} /> Save</>}
                    </Button>
                    <button
                        type="button"
                        onClick={onCancel}
                        aria-label="Close"
                        className="shrink-0 rounded p-1.5 text-console-ink-3 transition hover:text-console-ink focus-visible:ring-2 focus-visible:ring-console-accent/40 focus-visible:outline-none"
                    >
                        <X className="size-4" />
                    </button>
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
                    ) : canPreview && preview ? (
                        <div
                            onClick={() => setPreview(false)}
                            title="Click to edit"
                            className="min-h-[420px] cursor-text px-4 py-3"
                        >
                            <SkillMarkdown>{content}</SkillMarkdown>
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
