import { useEffect, useMemo, useState } from "react";
import { Code2, ListPlus, Plus, Table2, Trash2, X } from "lucide-react";
import { Box, Button, Flex, Text } from "@/compat/ui";
import { SkillService, ToolService, type SkillIssue, type SkillSummary } from "@/db";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button as ConsoleButton } from "@/components/ui/button";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Skill creation — guided form first, markdown for power users.
 *
 * Most users don't write YAML frontmatter. The form collects the same fields
 * the server parses (name, description, category, data tools, purpose,
 * method steps, verdict anchors, charts) and assembles the document via
 * serialize-like assembly. "Markdown" mode edits the raw document directly;
 * edits made there sync back into the form on reload. Validation and saving
 * go through the same /skills endpoints as before — no server change.
 */

const CATEGORIES = ["custom", "valuation", "fundamentals", "qualitative", "market", "macro"];

const CHART_TYPES = ["line", "bar", "candlestick", "radar"] as const;

interface AnchorDraft {
    label: string;
    weight: number;
}

interface ChartDraft {
    type: (typeof CHART_TYPES)[number];
    title: string;
    data: string;
}

export interface FormState {
    name: string;
    description: string;
    category: string;
    tools: string[];
    purpose: string;
    method: string[];
    anchors: AnchorDraft[];
    charts: ChartDraft[];
}

const EMPTY_FORM: FormState = {
    name: "",
    description: "",
    category: "custom",
    tools: ["web_search"],
    purpose: "",
    method: ["Gather the data this skill needs using the tools listed above.", "Assess the evidence against each verdict anchor below.", "Write the verdicts with quotes copied verbatim from tool results."],
    anchors: [{ label: "", weight: 8 }],
    charts: [],
};

/** Spec name rule: lowercase alnum + single hyphens, matching the directory. */
const SPEC_NAME_RE = /^(?!.*--)[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

function slugify(name: string): string {
    const slug = name
        .normalize("NFKD")
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase()
        .slice(0, 64)
        .replace(/-$/, "");
    return slug || "my-skill";
}

/** Build the spec-compliant name for a form state. */
function skillName(f: FormState): string {
    const fromTitle = slugify(f.name);
    return SPEC_NAME_RE.test(fromTitle) ? fromTitle : "my-skill";
}

export function assembleMarkdown(f: FormState, id: string): string {
    const slug = SPEC_NAME_RE.test(id) ? id : skillName(f);
    const title = f.name.trim() || slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    const description = (f.description || "What this skill analyzes, in one line.")
        .replace(/\s*\n\s*/g, " ")
        .slice(0, 1024);
    const lines: string[] = ["---", `name: ${slug}`, `description: ${description}`];
    if (f.tools.length) lines.push(`allowed-tools: ${f.tools.join(" ")}`);
    lines.push("metadata:");
    lines.push(`  title: ${/^[\w][\w &+./'-]*$/.test(title) ? title : `"${title.replace(/"/g, '\\"')}"`}`);
    lines.push(`  category: ${f.category}`);
    lines.push(`  version: "1"`);
    lines.push("---", "");
    lines.push("## Purpose", f.purpose || "What this skill investigates, and what a strong vs weak result looks like.", "");
    lines.push("## Method");
    f.method.filter((m) => m.trim()).forEach((m, i) => lines.push(`${i + 1}. ${m}`));
    if (!f.method.some((m) => m.trim())) lines.push("1. Gather the data this skill needs using the tools listed above.");
    lines.push("");
    if (f.anchors.filter((a) => a.label.trim()).length) {
        lines.push("## Verdict Anchors");
        lines.push(f.anchors.filter((a) => a.label.trim()).map((a) => `- ${a.label.trim()} — weight ${a.weight}`).join("\n"));
        lines.push("");
    }
    if (f.charts.filter((c) => c.title.trim() && c.data.trim()).length) {
        lines.push("## Charts");
        lines.push(f.charts.filter((c) => c.title.trim() && c.data.trim()).map((c) => `- type: ${c.type} | title: ${c.title.trim()} | data: ${c.data.trim()}`).join("\n"));
        lines.push("");
    }
    lines.push("## Output Template");
    lines.push("Summarize the finding in 2-3 sentences, then return one verdict per anchor with evidence quoted from tool results. Never invent numbers: every figure must be copied verbatim from a tool result.");
    return lines.join("\n");
}

/** Parse a markdown document back into form fields (best-effort round-trip). */
export function parseMarkdown(md: string): FormState | null {
    const fm = (key: string) => md.match(new RegExp(`^${key}:[ \\t]*(.+)$`, "m"))?.[1]?.trim();
    // Spec: `name` is the slug, the human title lives in metadata.title.
    // Legacy files used `id:` + a title-case `name:`.
    const nested = (key: string) => md.match(new RegExp(`^[ \\t]+${key}:[ \\t]*(.+)$`, "m"))?.[1]?.trim();
    const legacy = !!fm("id");
    const slug = legacy ? fm("id")! : fm("name");
    if (!slug) return null;
    const title = legacy ? fm("name") || "" : nested("title") || fm("name") || "";
    const section = (title: string) => {
        const m = md.match(new RegExp(`## ${title}\\n([\\s\\S]*?)(?=\\n## |$)`));
        return m?.[1]?.trim() || "";
    };
    const data = [
        ...(fm("allowed-tools") || "").split(/[\s,]+/),
        ...section("Data").split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2).trim()),
    ].map((t) => t.replace(/[()]/g, "").trim()).filter(Boolean);
    const method = section("Method").split("\n").map((l) => l.replace(/^\d+\.\s*/, "").trim()).filter(Boolean);
    const anchors = section("Verdict Anchors").split("\n").filter((l) => l.startsWith("- ")).map((l) => {
        const m = l.match(/^- (.+?)\s+—\s+weight\s+(\d+)/);
        return m ? { label: m[1].trim(), weight: Number(m[2]) || 5 } : { label: l.slice(2).trim(), weight: 5 };
    }).filter((a) => a.label);
    const charts = section("Charts").split("\n").filter((l) => l.startsWith("- type:")).map((l) => {
        const parts = Object.fromEntries(l.slice(2).split("|").map((p) => p.split(":").map((s) => s.trim()) as [string, string]).filter((p) => p.length === 2));
        const type = (CHART_TYPES as readonly string[]).includes(parts.type) ? parts.type as (typeof CHART_TYPES)[number] : "line";
        return { type, title: parts.title || "", data: parts.data || "" };
    }).filter((c) => c.title && c.data);
    return {
        name: title || slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        description: fm("description") || "",
        category: nested("category") || fm("category") || "custom",
        tools: [...new Set(data)],
        purpose: section("Purpose"),
        method: method.length ? method : EMPTY_FORM.method,
        anchors: anchors.length ? anchors : [{ label: "", weight: 8 }],
        charts,
    };
}

export default function SkillCreatePane({
    library,
    onCancel,
    onSaved,
}: {
    library: SkillSummary[];
    onCancel: () => void;
    onSaved: (skill: SkillSummary) => void;
}) {
    const [mode, setMode] = useState<"form" | "markdown">("form");
    const [form, setForm] = useState<FormState>(EMPTY_FORM);
    const [md, setMd] = useState<string | null>(null);
    const [tools, setTools] = useState<{ name: string; description: string }[]>([]);
    const [issues, setIssues] = useState<SkillIssue[]>([]);
    const [validating, setValidating] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    useEffect(() => {
        ToolService.getCatalog().then(setTools).catch(() => setTools([]));
    }, []);

    const id = useMemo(() => slugify(form.name), [form.name]);
    const markdown = mode === "markdown" && md !== null ? md : assembleMarkdown(form, id);

    // Form fields drive the id, so an id the user didn't hand-type can't
    // collide accidentally; but keep the same overwrite warning as before.
    const collision = library.find((s) => s.id === id);

    const hardIssues = issues.filter((i) => i.severity === "error");
    const formComplete = form.name.trim() && form.description.trim() && form.anchors.some((a) => a.label.trim());
    const canSave = !!markdown.trim() && (mode === "markdown" || formComplete) && hardIssues.length === 0 && !saving;

    const runValidate = async (text: string) => {
        setValidating(true);
        try {
            const res = await SkillService.validateMarkdown(text);
            setIssues(res.issues || []);
        } catch {
            setIssues([]);
        } finally {
            setValidating(false);
        }
    };

    const switchToMarkdown = () => {
        setMd(markdown);
        setMode("markdown");
    };

    const switchToForm = () => {
        if (md !== null) {
            const parsed = parseMarkdown(md);
            if (parsed) setForm(parsed);
        }
        setMode("form");
    };

    const save = async () => {
        setSaving(true);
        setSaveError(null);
        try {
            const text = markdown;
            await runValidate(text);
            const res = await SkillService.saveSkill(text);
            onSaved(res.skill);
        } catch (e: any) {
            const serverIssues: SkillIssue[] | undefined = e?.response?.data?.issues;
            if (serverIssues?.length) setIssues(serverIssues);
            setSaveError(e?.response?.data?.error || e?.message || "Save failed");
        } finally {
            setSaving(false);
        }
    };

    const patch = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }));

    const toggleTool = (name: string) =>
        patch({ tools: form.tools.includes(name) ? form.tools.filter((t) => t !== name) : [...form.tools, name] });

    return (
        <Flex direction="column" gap={3}>
            <Flex align="center" justify="space-between" gap={2} wrap="wrap">
                <Flex align="center" gap={2}>
                    <Text fontSize="16px" fontWeight={600} color="var(--ink-primary)">
                        {mode === "form" ? "Create a skill" : "Edit skill markdown"}
                    </Text>
                    {mode === "markdown" && (
                        <Text fontSize="10px" fontFamily="var(--font-mono)" color="var(--accent-primary)">MARKDOWN</Text>
                    )}
                </Flex>
                <div className="flex rounded-lg bg-console-recessed p-[3px]">
                    <button
                        type="button"
                        onClick={switchToForm}
                        aria-pressed={mode === "form"}
                        className={cn(
                            "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                            mode === "form" ? "bg-console-surface text-console-ink shadow-console" : "text-console-ink-3 hover:text-console-ink",
                        )}
                    >
                        <ListPlus className="size-3.5" /> Guided form
                    </button>
                    <button
                        type="button"
                        onClick={switchToMarkdown}
                        aria-pressed={mode === "markdown"}
                        className={cn(
                            "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                            mode === "markdown" ? "bg-console-surface text-console-ink shadow-console" : "text-console-ink-3 hover:text-console-ink",
                        )}
                    >
                        <Code2 className="size-3.5" /> Markdown
                    </button>
                </div>
            </Flex>

            {mode === "form" ? (
                <>
                    {collision && (
                        <Text fontSize="12px" color="var(--signal-caution)">
                            ⚠ A skill named “{collision.name}” (id {collision.id}) already exists — saving will
                            overwrite it. Pick a different name to create a new skill instead.
                        </Text>
                    )}

                    <Flex gap={3} wrap="wrap">
                        <Box flex="2" minW="220px">
                            <Text fontSize="11px" fontWeight={600} color="var(--ink-tertiary)" mb={1}>Name</Text>
                            <Input value={form.name} onChange={(e) => patch({ name: e.target.value })} placeholder="Balance Sheet Stress Test" aria-label="Skill name" />
                        </Box>
                        <Box flex="1" minW="140px">
                            <Text fontSize="11px" fontWeight={600} color="var(--ink-tertiary)" mb={1}>Category</Text>
                            <Select value={form.category} onValueChange={(v) => patch({ category: v })}>
                                <SelectTrigger aria-label="Category"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {CATEGORIES.map((c) => (
                                        <SelectItem key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </Box>
                    </Flex>

                    <Box>
                        <Text fontSize="11px" fontWeight={600} color="var(--ink-tertiary)" mb={1}>One-line description</Text>
                        <Input value={form.description} onChange={(e) => patch({ description: e.target.value })} placeholder="Can the company survive its own capital structure?" aria-label="Description" />
                    </Box>

                    {/* ── Data sources: pick from the real tool catalog ── */}
                    <Box>
                        <Text fontSize="11px" fontWeight={600} color="var(--ink-tertiary)" mb={1}>
                            Data sources — the tools this skill may call
                        </Text>
                        <Text fontSize="11px" color="var(--ink-4, var(--ink-tertiary))" mb={2}>
                            Pick what the agent may read while running this skill. Hover a chip for its description.
                        </Text>
                        <Flex gap={1.5} wrap="wrap">
                            {tools.map((t) => {
                                const on = form.tools.includes(t.name);
                                return (
                                    <span key={t.name} title={t.description}>
                                        <button
                                            type="button"
                                            onClick={() => toggleTool(t.name)}
                                            aria-pressed={on}
                                            className={cn(
                                                "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-console-accent/40 focus-visible:outline-none",
                                                on
                                                    ? "bg-console-accent-soft text-console-accent-strong"
                                                    : "bg-console-recessed text-console-ink-3 hover:text-console-ink",
                                            )}
                                        >
                                            {on ? <X className="size-3" aria-hidden /> : <Plus className="size-3" aria-hidden />}
                                            {t.name}
                                        </button>
                                    </span>
                                );
                            })}
                        </Flex>
                        {form.tools.length > 0 && (
                            <Flex gap={1} mt={2} wrap="wrap">
                                {form.tools.map((t) => (
                                    <Badge key={t} variant="accent">{t}</Badge>
                                ))}
                            </Flex>
                        )}
                    </Box>

                    <Box>
                        <Text fontSize="11px" fontWeight={600} color="var(--ink-tertiary)" mb={1}>What it measures</Text>
                        <Textarea
                            value={form.purpose}
                            onChange={(e) => patch({ purpose: e.target.value })}
                            placeholder="What this skill investigates, why it matters for an investment decision, and what a strong vs weak result looks like."
                            aria-label="Purpose"
                            className="min-h-20"
                        />
                    </Box>

                    {/* ── Verdict anchors ── */}
                    <Box>
                        <Text fontSize="11px" fontWeight={600} color="var(--ink-tertiary)" mb={1}>
                            Verdicts it returns — the questions the agent answers
                        </Text>
                        <Flex direction="column" gap={2}>
                            {form.anchors.map((a, i) => (
                                <Flex key={i} gap={2} align="center" wrap="wrap">
                                    <Input
                                        flex="1"
                                        minW="200px"
                                        value={a.label}
                                        onChange={(e) => patch({ anchors: form.anchors.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })}
                                        placeholder={i === 0 ? "Leverage is conservative relative to cash flows" : "A supporting signal"}
                                        aria-label={`Anchor ${i + 1}`}
                                    />
                                    <div className="w-28">
                                        <Select
                                            value={String(a.weight)}
                                            onValueChange={(v) => patch({ anchors: form.anchors.map((x, j) => (j === i ? { ...x, weight: Number(v) } : x)) })}
                                        >
                                            <SelectTrigger aria-label={`Weight for anchor ${i + 1}`}><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                {[2, 3, 5, 8, 10].map((w) => (
                                                    <SelectItem key={w} value={String(w)}>weight {w}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <ConsoleButton
                                        variant="ghost"
                                        size="icon"
                                        aria-label={`Remove anchor ${i + 1}`}
                                        disabled={form.anchors.length === 1}
                                        onClick={() => patch({ anchors: form.anchors.filter((_, j) => j !== i) })}
                                    >
                                        <Trash2 />
                                    </ConsoleButton>
                                </Flex>
                            ))}
                            <ConsoleButton
                                variant="ghost"
                                size="sm"
                                className="self-start"
                                onClick={() => patch({ anchors: [...form.anchors, { label: "", weight: 5 }] })}
                            >
                                <Plus /> Add verdict
                            </ConsoleButton>
                        </Flex>
                    </Box>

                    {/* ── Charts (optional) ── */}
                    <Box>
                        <Text fontSize="11px" fontWeight={600} color="var(--ink-tertiary)" mb={1}>Charts (optional)</Text>
                        {form.charts.length === 0 ? (
                            <Text fontSize="11px" color="var(--ink-tertiary)">
                                None — the report will show the skill's price-context chart by default.
                            </Text>
                        ) : (
                            <Flex direction="column" gap={2}>
                                {form.charts.map((c, i) => (
                                    <Flex key={i} gap={2} align="center" wrap="wrap">
                                        <div className="w-32">
                                            <Select
                                                value={c.type}
                                                onValueChange={(v) => patch({ charts: form.charts.map((x, j) => (j === i ? { ...x, type: v as ChartDraft["type"] } : x)) })}
                                            >
                                                <SelectTrigger aria-label={`Chart ${i + 1} type`}><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    {CHART_TYPES.map((t) => (
                                                        <SelectItem key={t} value={t}>{t}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <Input
                                            flex="1"
                                            minW="160px"
                                            value={c.title}
                                            onChange={(e) => patch({ charts: form.charts.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })}
                                            placeholder="Chart title"
                                            aria-label={`Chart ${i + 1} title`}
                                        />
                                        <Input
                                            flex="1"
                                            minW="140px"
                                            value={c.data}
                                            onChange={(e) => patch({ charts: form.charts.map((x, j) => (j === i ? { ...x, data: e.target.value } : x)) })}
                                            placeholder="series key, e.g. revenue_by_quarter"
                                            aria-label={`Chart ${i + 1} series`}
                                            className="font-mono"
                                        />
                                        <ConsoleButton
                                            variant="ghost"
                                            size="icon"
                                            aria-label={`Remove chart ${i + 1}`}
                                            onClick={() => patch({ charts: form.charts.filter((_, j) => j !== i) })}
                                        >
                                            <Trash2 />
                                        </ConsoleButton>
                                    </Flex>
                                ))}
                            </Flex>
                        )}
                        <ConsoleButton
                            variant="ghost"
                            size="sm"
                            className="mt-1 self-start"
                            onClick={() => patch({ charts: [...form.charts, { type: "line", title: "", data: "" }] })}
                        >
                            <Table2 /> Add chart
                        </ConsoleButton>
                    </Box>
                </>
            ) : (
                <Box
                    as="textarea"
                    value={md ?? ""}
                    onChange={(e: any) => setMd(e.target.value)}
                    onBlur={() => md?.trim() && runValidate(md)}
                    spellCheck={false}
                    aria-label="Skill document (markdown)"
                    fontFamily="var(--font-mono)"
                    fontSize="12px"
                    lineHeight="1.7"
                    color="var(--ink-secondary)"
                    bg="var(--surface-recessed)"
                    border="var(--hairline-w) solid var(--hairline)"
                    borderRadius="6px"
                    p={3}
                    minH="46vh"
                    w="full"
                    resize="vertical"
                    _focus={{ outline: "none", borderColor: "var(--accent-primary)" }}
                />
            )}

            {issues.length > 0 && (
                <Flex direction="column" gap={0.5}>
                    {issues.map((iss, i) => (
                        <Text key={i} fontSize="11.5px" color={iss.severity === "error" ? "var(--signal-negative)" : "var(--signal-caution)"}>
                            {iss.severity === "error" ? "✗" : "⚠"} line {iss.line}: {iss.message}
                        </Text>
                    ))}
                </Flex>
            )}
            {saveError && <Text fontSize="12px" color="var(--signal-negative)">{saveError}</Text>}

            <Flex gap={2} justify="flex-end">
                <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
                <Button
                    size="sm"
                    variant="subtle"
                    loading={validating}
                    onClick={() => runValidate(markdown)}
                    disabled={!markdown.trim()}
                >
                    Validate
                </Button>
                <Button size="sm" variant="solid" colorPalette="teal" loading={saving} onClick={save} disabled={!canSave}>
                    Create skill
                </Button>
            </Flex>
        </Flex>
    );
}
