import { Box, Text, Flex } from "@/compat/ui"
import { SiAgentskills } from "react-icons/si"
import { TbFileSpreadsheet } from "react-icons/tb"
import { LuDownload } from "react-icons/lu"
import { useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import {
    MdExpandMore,
    MdExpandLess,
    MdDataset,
    MdOutlineWarningAmber,
    MdOutlineDownload,
    MdOutlineOpenInNew,
    MdOutlineCalendarToday,
} from "react-icons/md"
import { SOURCE_DEFS, SourceMark, sourceForTool, FaviconMark, type SourceKey } from "@/lib/sourceLogos"
import { Button } from "@/components/ui/button"
import { AnalysisService } from "@/db"

// SkillResultCard — one skill's report. Design contract:
// 1. Evidence leads. Every claim shows the source it came from; a source with
//    a URL is a real, tool-fetched link (the pipeline strips invented URLs).
// 2. Empty means empty. A skill with no data says so plainly — no fabricated
//    numbers, no decorative placeholders, no verdicts without evidence.
// 3. Raw data is one click away, shown verbatim with its origin — and it must
//    LOOK like source data: branded, structured, visually separate from the
//    analysis above it, never a JSON dump.

interface Citation {
    label?: string;
    source?: string;
    url?: string;
    value?: string;
}

interface RawObservation {
    tool: string;
    args?: string;
    result: string;
    /** The table text the skill model received, verbatim (api/tools.formatToolData). */
    rendered?: string;
    status: string;
    url?: string;
}

interface Block {
    id?: string;
    kind: "text" | "table" | "chart";
    body?: string;
    title?: string;
    dataset_id?: string;
    columns?: string[];
    last_n?: number;
    type?: "line" | "bar" | "scatter";
    x?: string;
    y?: string[];
}

interface SkillOutput {
    skill_id: string;
    skill_name: string;
    category: string;
    weight: number;
    summary?: string;
    analysis?: string;
    rawText?: string;
    blocks?: Block[];
    findings?: { title: string; detail: string; citations?: Citation[] }[];
    verdicts: { anchor?: string; checklist_id?: string; verdict: string; evidence?: string; rationale?: string; citations?: Citation[]; dataset_ids?: string[] }[];
    tools_used?: string[];
    citations?: Citation[];
    raw_observations?: RawObservation[];
    artifacts?: SkillArtifact[];
    error?: string;
    score_0_100?: number | null;
    coverage?: number;
    scored_by?: string;
    score_version?: "v2";
    datasets?: any[];
    total_checklist?: number;
}

interface SkillArtifact {
    id: string;
    skill_id: string;
    kind: string;
    status: "ready" | "partial" | "unavailable";
    recipe: { filename: string; description: string } | null;
    summary: string;
    assumptions: { label: string; value: string; reason: string }[];
    observation_refs: number[];
    note?: string;
}

function SkillSummaryMarkdown({ children }: { children: string }) {
    return (
        <Box
            fontSize="13.5px"
            color="var(--ink-secondary)"
            lineHeight="relaxed"
            css={{
                "& h1, & h2, & h3, & h4": { color: "var(--ink-primary)", fontWeight: 400, fontFamily: "var(--font-display)", lineHeight: 1.3, marginTop: "1em", marginBottom: "0.4em" },
                "& h1": { fontSize: "1.35em" },
                "& h2": { fontSize: "1.2em" },
                "& h3, & h4": { fontSize: "1.05em" },
                "& p": { margin: "0.55em 0" },
                "& ul": { listStyleType: "disc", paddingLeft: "1.5em", margin: "0.55em 0" },
                "& ol": { listStyleType: "decimal", paddingLeft: "1.5em", margin: "0.55em 0" },
                "& li": { paddingLeft: "0.2em", margin: "0.2em 0" },
                "& strong": { color: "var(--ink-primary)", fontWeight: 600 },
                "& blockquote": { borderLeft: "2px solid var(--hairline)", margin: "0.75em 0", paddingLeft: "1em", color: "var(--ink-tertiary)" },
                "& code": { background: "var(--surface-recessed)", borderRadius: "2px", fontFamily: "var(--font-mono)", padding: "0.1em 0.3em" },
                "& pre": { background: "var(--surface-recessed)", borderRadius: "4px", overflowX: "auto", padding: "0.75em" },
                "& pre code": { padding: 0 },
                "& table": { borderCollapse: "collapse", display: "block", overflowX: "auto", width: "100%" },
                "& th, & td": { borderBottom: "1px solid var(--hairline)", padding: "0.4em 0.65em", textAlign: "left" },
                "& a": { color: "var(--accent-primary)", textDecoration: "underline" },
            }}
        >
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                    ol: ({ node: _node, ...props }) => (
                        <ol {...props} style={{ listStyleType: "decimal", paddingLeft: "1.5em", margin: "0.55em 0" }} />
                    ),
                    ul: ({ node: _node, ...props }) => (
                        <ul {...props} style={{ listStyleType: "disc", paddingLeft: "1.5em", margin: "0.55em 0" }} />
                    ),
                }}
            >
                {children}
            </ReactMarkdown>
        </Box>
    )
}

/** Readable excerpt of a citation value: strip tool prefixes, keep URLs whole. */
function citeExcerpt(c: { value?: string; label?: string }): string {
  const line = String(c.value || "").trim();
  if (!line) return "";
  const urlMatch = line.match(/^\S+:\s+(https?:\/\/\S+)$/);
  if (urlMatch) return urlMatch[1];
  const idx = line.indexOf(":");
  let out = idx > 0 ? line.slice(idx + 1).trim() : line;
  if (!out) out = line;
  if (out.length > 90) out = `${out.slice(0, 87).trimEnd()}…`;
  return out;
}

/** Derive a readable domain from a real URL for the link label. */
function domainOf(url: string): string {
    try {
        return new URL(url).hostname.replace(/^www\./, "");
    } catch {
        return url;
    }
}

/** Parse a published_date into a short human label ("27 Sep 2026"). */
function shortDate(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) {
        // Not a parseable date — show the raw string, truncated.
        return raw.length > 24 ? `${raw.slice(0, 24)}…` : raw;
    }
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/**
 * A source line under a claim: subtle citation chips — tinted wash, no border.
 * Web citations open the real page (favicon + domain label + external-link
 * glyph); internal citations name the data feed with its branded icon.
 */
function SourceLine({ citations }: { citations?: Citation[] }) {
    const list = (citations || []).filter((c) => c.source || c.url);
    if (!list.length) return null;
    return (
        <Flex gap={2} align="stretch" mt={1.5} ml={0}>
            <Flex gap={1.5} wrap="wrap" align="center">
                {list.map((c, i) => {
                    const valueTitle = [c.source, c.value].filter(Boolean).join(": ") || c.label || c.url || "";
                    if (c.url) {
                        return (
                            <a
                                key={i}
                                href={c.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ textDecoration: "none", display: "inline-flex", maxWidth: "100%" }}
                            >
                                <Flex
                                    align="center"
                                    gap={1}
                                    fontSize="11px"
                                    color="var(--accent, #23747D)"
                                    borderRadius="3px"
                                    px={1.5}
                                    py="2px"
                                    minW={0}
                                    bg="color-mix(in srgb, var(--accent, #23747D) 9%, transparent)"
                                    _hover={{ bg: "color-mix(in srgb, var(--accent, #23747D) 18%, transparent)" }}
                                    title={valueTitle}
                                >
                                    <FaviconMark url={c.url} size={13} />
                                    <Text as="span" truncate maxW="300px" ml="5px">
                                        {c.label || domainOf(c.url)}
                                    </Text>
                                    <MdOutlineOpenInNew size={10} aria-hidden style={{ flexShrink: 0, opacity: 0.7 }} />
                                </Flex>
                            </a>
                        );
                    }
                    const sourceKey = sourceForTool(c.source || "");
                    const excerpt = citeExcerpt(c);
                    return (
                        <Flex
                            key={i}
                            align="center"
                            gap={1.5}
                            fontSize="11px"
                            borderRadius="3px"
                            px={1.5}
                            py="2px"
                            bg="var(--surface-recessed)"
                            minW={0}
                            title={`Figures read from the ${SOURCE_DEFS[sourceKey].full}${c.value ? `: ${c.value}` : ""}`}
                        >
                            <SourceMark source={sourceKey} size={11} muted={sourceKey === "voyager"} />
                            <Text as="span" fontWeight={500} color="var(--ink-secondary)" truncate maxW="180px">
                                {c.label || c.source}
                            </Text>
                            {excerpt && (
                                <Text as="span" color="var(--ink-tertiary)" truncate maxW="220px">
                                    {excerpt}
                                </Text>
                            )}
                        </Flex>
                    );
                })}
            </Flex>
        </Flex>
    );
}

/** Score-band edge color, matching the app's shared 0.7/D4 band semantics. */
function scoreSignalColor(score: number): string {
    if (score >= 70) return "var(--signal-positive)";
    if (score >= 40) return "var(--signal-caution)";
    return "var(--signal-negative)";
}

/** Verdict text + subtle tinted wash per outcome; no border, no surface. */
const VERDICT_TONE: Record<string, { color: string; bg: string; label: string }> = {
    PASS: { color: "var(--signal-positive)", bg: "color-mix(in srgb, var(--signal-positive) 11%, transparent)", label: "Met" },
    PARTIAL: { color: "var(--signal-caution)", bg: "color-mix(in srgb, var(--signal-caution) 11%, transparent)", label: "Partly met" },
    FAIL: { color: "var(--signal-negative)", bg: "color-mix(in srgb, var(--signal-negative) 11%, transparent)", label: "Not met" },
    INSUFFICIENT: { color: "var(--ink-tertiary)", bg: "var(--surface-recessed)", label: "No data" },
};

/**
 * Verdict tag in the app's shared badge vocabulary — the same subtle pill the
 * hero uses for band/coverage: tinted wash, no border, no surface; the
 * outcome is carried by the text color alone.
 */
function VerdictPill({ verdict, flexShrink }: { verdict: string; flexShrink?: number }) {
    const tone = VERDICT_TONE[verdict] ?? { color: "var(--ink-tertiary)", label: verdict, bg: "var(--surface-recessed)" };
    return (
        <Text
            as="span"
            display="inline-block"
            fontSize="11.5px"
            fontWeight={500}
            whiteSpace="nowrap"
            px={2.5}
            py="3px"
            borderRadius="full"
            bg={tone.bg}
            color={tone.color}
            lineHeight={1.2}
            flexShrink={flexShrink as any}
        >
            {tone.label}
        </Text>
    );
}

/**
 * One readable item pulled out of an observation's payload: a web story
 * (title / publisher / date / snippet / link) or a data-feed readout.
 */
interface ParsedItem {
    title: string | null;
    url: string | null;
    date: string | null;
    source: string | null;
    summary: string | null;
    isWeb: boolean;
    fields?: { label: string; value: string }[];
}

function readableKey(key: string): string {
    return key
        .replace(/[_-]+/g, " ")
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/\b\d+\b/g, (n) => `#${Number(n) + 1}`)
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function payloadFields(value: unknown): { label: string; value: string }[] {
    const fields: { label: string; value: string }[] = [];
    const visit = (v: unknown, path: string[] = []): void => {
        if (fields.length >= 24 || v == null) return;
        if (Array.isArray(v)) {
            v.slice(0, 8).forEach((item, i) => visit(item, [...path, String(i)]));
        } else if (typeof v === "object") {
            for (const [key, item] of Object.entries(v as Record<string, unknown>)) visit(item, [...path, key]);
        } else {
            const raw = String(v).trim();
            if (!raw || /^https?:\/\//i.test(raw)) return;
            const label = path.map((part) => /^\d+$/.test(part) ? `#${Number(part) + 1}` : readableKey(part)).join(" · ");
            fields.push({ label, value: raw });
        }
    };
    visit(value);
    return fields;
}

/** Pull a human-readable headline + snippet out of a result payload string. */
function parsePayload(raw: string): { items: ParsedItem[]; keys: string[] } {
    const trimmed = raw.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try {
            const j = JSON.parse(trimmed);
            // web_search / news shapes: { query, results: [...] } or an array.
            const arr: any[] = Array.isArray(j) ? j : Array.isArray(j.results) ? j.results : [];
            if (arr.length > 0) {
                const items: ParsedItem[] = [];
                for (const it of arr.slice(0, 12)) {
                    if (!it || typeof it !== "object") continue;
                    const url = typeof it.url === "string" && /^https?:/i.test(it.url) ? it.url : null;
                    const title = typeof it.title === "string" && it.title.trim() ? it.title.trim() : null;
                    if (!title && !url) continue;
                    const content = typeof it.content === "string" ? it.content.replace(/\s+/g, " ").trim().slice(0, 300) : null;
                    items.push({
                        title,
                        url,
                        date: typeof it.published_date === "string" ? it.published_date : null,
                        source: typeof it.source === "string" ? it.source : null,
                        summary: content,
                        isWeb: !!url,
                    });
                }
                if (items.length > 0) return { items, keys: [] };
            }
            const fields = payloadFields(j);
            if (fields.length > 0) {
                return {
                    items: [{ title: null, url: null, date: null, source: null, summary: null, isWeb: false, fields }],
                    keys: [],
                };
            }
        } catch { /* fall through */ }
    }
    // Data feeds sometimes arrive as flattened "key: value" text instead of JSON.
    const markers = [...trimmed.matchAll(/(?:^|\s)([\w.-]+):\s*/g)];
    if (markers.length) {
        const fields = markers.map((marker, i) => {
            const valueStart = (marker.index || 0) + marker[0].length;
            const valueEnd = markers[i + 1]?.index ?? trimmed.length;
            return {
                label: marker[1].split(".").map(readableKey).join(" · "),
                value: trimmed.slice(valueStart, valueEnd).trim(),
            };
        }).filter((field) => field.value);
        return { items: [{ title: null, url: null, date: null, source: null, summary: null, isWeb: false, fields }], keys: [] };
    }
    return { items: [], keys: [] };
}

function PayloadFields({ fields }: { fields: { label: string; value: string }[] }) {
    return (
        <Flex direction="column" gap={1} px={3} py={2}>
            {fields.map((field, i) => (
                <Flex key={i} gap={2} align="baseline" wrap="wrap">
                    <Text fontSize="11px" fontWeight={600} color="var(--ink-tertiary)" minW="140px">
                        {field.label}
                    </Text>
                    <Text fontSize="12px" color="var(--ink-secondary)" style={{ overflowWrap: "anywhere" }}>
                        {field.value}
                    </Text>
                </Flex>
            ))}
        </Flex>
    );
}

/**
 * A workbook the skill built, offered as a download.
 *
 * One row, like a file attachment. The assumptions and the build note are the
 * interesting part, but printing them costs the row its height and buries the
 * only thing it is for — they are surfaced on hover instead, and the assumptions
 * are editable in the file itself.
 */
function ArtifactCard({ artifact, analysisId }: { artifact: SkillArtifact; analysisId?: string }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // A partial workbook is still a real, downloadable file — only the data behind it is thin.
    const downloadable = !!artifact.recipe && artifact.status !== "unavailable";
    const statusLabel = artifact.status === "ready" ? "Ready" : artifact.status === "partial" ? "Partial" : "Unavailable";
    const statusTone = {
        ready: "text-[var(--signal-positive)]",
        partial: "text-[var(--signal-caution)]",
        unavailable: "text-[var(--signal-negative)]",
    }[artifact.status];

    const download = async () => {
        if (!analysisId || !artifact.recipe) return;
        setBusy(true);
        setError(null);
        try {
            const blob = await AnalysisService.downloadArtifact(analysisId, artifact.id);
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = artifact.recipe.filename;
            a.click();
            URL.revokeObjectURL(url);
        } catch (e: any) {
            setError(e?.response?.data?.error || "Download failed. Try again.");
        } finally {
            setBusy(false);
        }
    };

    return (
        <div
            tabIndex={0}
            className="group mt-3 flex items-center gap-3 rounded-[6px] border border-[var(--hairline)] bg-[var(--surface-panel)] px-3 py-2 transition-[border-color,box-shadow,background-color] duration-150 hover:border-[color-mix(in_srgb,var(--accent-primary)_55%,transparent)] hover:bg-[color-mix(in_srgb,var(--accent-primary)_5%,var(--surface-panel))] hover:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent-primary)_30%,transparent)] focus-visible:border-[var(--accent-primary)] focus-visible:shadow-[inset_0_0_0_1px_var(--accent-primary)] focus-visible:outline-none"
        >
            <span
                className="flex size-9 shrink-0 items-center justify-center rounded-[5px]"
                style={{ background: "color-mix(in srgb, var(--file-sheet) 12%, #EEF4F0)", color: "var(--file-sheet)" }}
            >
                <TbFileSpreadsheet size={18} aria-hidden />
            </span>

            <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-[var(--ink-primary)]">
                {artifact.recipe?.filename ?? statusLabel}
            </span>

            <span className="hidden min-w-0 flex-1 truncate text-[11px] text-[var(--ink-tertiary)] md:block">
                {artifact.summary}
            </span>

            <span className={`shrink-0 text-[10px] font-semibold uppercase tracking-[0.06em] ${statusTone}`}>
                {statusLabel}
            </span>

            {downloadable && (
                <Button
                    variant="secondary"
                    size="sm"
                    loading={busy}
                    disabled={!analysisId}
                    onClick={download}
                    aria-busy={busy}
                    className="border-0 bg-[var(--file-sheet)] text-white hover:bg-[color-mix(in_srgb,var(--file-sheet)_88%,black)]"
                >
                    {!busy && <LuDownload aria-hidden />}
                    Download
                </Button>
            )}

            {error && (
                <span role="alert" className="shrink-0 text-[11px] text-[var(--signal-negative)]">
                    {error}
                </span>
            )}
        </div>
    );
}

/**
 * The verbatim record of what the tools returned, rendered as SOURCE DATA —
 * a visually separate, branded section under the analysis. Each observation
 * leads with where it came from (icon + domain/feed), shows readable content
 * (story cards for web results, key readouts for data feeds), and keeps the
 * untouched payload one click away per item.
 */
function SourceDataPanel({ observations }: { observations: RawObservation[] }) {
    if (!observations.length) return null;
    const ok = observations.filter((o) => o.status === "ok");
    const empty = observations.filter((o) => o.status !== "ok" && o.status !== "ERR");
    const failed = observations.filter((o) => o.status === "ERR");

    const summary =
        ok.length === 0
            ? "nothing came back"
            : `${ok.length} of ${observations.length} call${observations.length === 1 ? "" : "s"} returned data`;

    return (
        <Box mt={4}>
            <Flex align="center" gap={2} py={1.5}>
                <MdDataset size={15} aria-hidden style={{ color: "var(--ink-tertiary)", flexShrink: 0 }} />
                <Text fontSize="12.5px" fontWeight={600} color="var(--ink-primary)" flexShrink={0}>
                    Source data
                </Text>
                <Text fontSize="11.5px" fontWeight={400} color="var(--ink-tertiary)" flex={1} textAlign="left" noOfLines={1}>
                    ({summary}
                    {failed.length > 0 ? ` · ${failed.length} failed` : empty.length > 0 ? ` · ${empty.length} empty` : ""})
                </Text>
            </Flex>
            <Flex direction="column" gap={2} mt={1}>
                {observations.map((o, i) => (
                    <ObservationCard key={i} o={o} />
                ))}
            </Flex>
        </Box>
    );
}

/** Split a rendered tool payload into monotone text and markdown pipe tables. */
type EvidenceBlock = { kind: "text"; text: string } | { kind: "table"; head: string[]; rows: string[][] };

function evidenceCells(line: string): string[] {
    return line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim().replace(/\\\|/g, "|"));
}

function parseEvidence(text: string): EvidenceBlock[] {
    const lines = text.split("\n");
    const blocks: EvidenceBlock[] = [];
    let buf: string[] = [];
    const flush = () => { if (buf.length) { blocks.push({ kind: "text", text: buf.join("\n") }); buf = []; } };
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const next = lines[i + 1]?.trim() ?? "";
        const isSep = (l: string) => evidenceCells(l).every((c) => /^:?-+:?$/.test(c));
        if (/^\|.*\|$/.test(line) && /^\|.*\|$/.test(next) && isSep(next)) {
            const head = evidenceCells(line);
            const rows: string[][] = [];
            i += 2;
            while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) {
                if (!isSep(lines[i].trim())) rows.push(evidenceCells(lines[i]));
                i++;
            }
            i--;
            flush();
            blocks.push({ kind: "table", head, rows });
        } else {
            buf.push(lines[i]);
        }
    }
    flush();
    return blocks;
}

/** The exact table text the model received — tables rendered, the rest verbatim. */
function RenderedEvidence({ text }: { text: string }) {
    const blocks = parseEvidence(text);
    return (
        <Flex direction="column" gap={2} px={3} py={2} maxH={420} overflow="auto">
            {blocks.map((b, i) =>
                b.kind === "text" ? (
                    <Text key={i} as="pre" m={0} fontSize="11px" lineHeight="1.55" color="var(--ink-tertiary)" fontFamily="var(--font-mono)" whiteSpace="pre-wrap">
                        {b.text}
                    </Text>
                ) : (
                    <Box key={i} overflowX="auto">
                        <Box as="table" style={{ borderCollapse: "collapse", width: "100%" }}>
                            <Box as="thead">
                                <Box as="tr">
                                    {b.head.map((c, j) => (
                                        <Box as="th" key={j} style={{ textAlign: "left", padding: "4px 6px", borderBottom: "1px solid var(--hairline)", fontSize: "10.5px", color: "var(--ink-tertiary)", whiteSpace: "nowrap" }}>
                                            {c}
                                        </Box>
                                    ))}
                                </Box>
                            </Box>
                            <Box as="tbody">
                                {b.rows.map((r, j) => (
                                    <Box as="tr" key={j}>
                                        {r.map((c, k) => (
                                            <Box as="td" key={k} style={{ padding: "4px 6px", fontSize: "11.5px", color: "var(--ink-secondary)", borderBottom: "1px solid var(--hairline)", whiteSpace: "nowrap" }}>
                                                {c}
                                            </Box>
                                        ))}
                                    </Box>
                                ))}
                            </Box>
                        </Box>
                    </Box>
                ),
            )}
        </Flex>
    );
}

/** One tool observation as a source-data card. */
function ObservationCard({ o }: { o: RawObservation }) {
    const [open, setOpen] = useState(false);
    const parsed = parsePayload(o.result || "");
    const rendered = o.status === "ok" && o.rendered?.trim() ? o.rendered.trim() : "";
    const sourceKey = o.url && parsed.items.length === 0 ? ("web" as SourceKey) : sourceForTool(o.tool);
    const headerLabel = o.url && parsed.items.length === 0 ? domainOf(o.url) : SOURCE_DEFS[sourceKey].label;
    const argsFields = o.args ? payloadFields((() => { try { return JSON.parse(o.args!); } catch { return null; } })()) : [];
    const ok = o.status === "ok";

    return (
        <Box bg="var(--surface-panel)" borderRadius="10px" overflow="hidden">
            {/* Facsimile header: where this piece of data came from — quiet
                typography, no borders. */}
            <Flex
                as="button"
                onClick={() => setOpen(!open)}
                gap={2}
                align="center"
                wrap="wrap"
                px={3}
                py={2.5}
                w="100%"
                textAlign="left"
                bg="transparent"
                border="none"
                cursor="pointer"
                aria-expanded={open}
            >
                <SourceMark source={sourceKey} size={13} muted={sourceKey === "voyager"} />
                <Text as="span" fontSize="11.5px" fontWeight={600} color="var(--ink-primary)">
                    {headerLabel}
                </Text>
                <Text
                    as="span"
                    fontSize="10px"
                    fontFamily="var(--font-mono)"
                    color="var(--ink-secondary)"
                    title="Tool called"
                >
                    {readableKey(o.tool)}
                </Text>
                <Text
                    fontSize="10.5px"
                    fontFamily="var(--font-mono)"
                    color={ok ? "var(--signal-positive)" : o.status === "ERR" ? "var(--signal-negative)" : "var(--ink-tertiary)"}
                    ml="auto"
                >
                    {ok ? "returned" : o.status === "ERR" ? "failed" : "empty"}
                </Text>
                {open ? <MdExpandLess size={15} /> : <MdExpandMore size={15} />}
            </Flex>

            {open && <>
            {argsFields.length > 0 && <PayloadFields fields={argsFields} />}
            {/* Readable content: the exact LLM table when stored, else story cards for web results, readouts for feeds */}
            {ok && rendered ? (
                <RenderedEvidence text={rendered} />
            ) : ok && parsed.items.length > 0 ? (
                <Flex direction="column" gap={0}>
                    {parsed.items.map((it, j) => (
                        <Box
                            key={j}
                            px={3}
                            pb={2}
                            pt={j === 0 ? 0 : 2}
                        >
                            <Flex align="baseline" gap={2} wrap="wrap">
                                {it.url ? (
                                    <a href={it.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none", minWidth: 0 }}>
                                        <Text
                                            as="span"
                                            fontSize="12.5px"
                                            fontWeight={600}
                                            color="var(--accent, #23747D)"
                                            lineHeight="1.45"
                                            _hover={{ textDecoration: "underline" }}
                                        >
                                            {it.title || domainOf(it.url)}
                                        </Text>
                                    </a>
                                ) : (
                                    it.title && (
                                        <Text as="span" fontSize="12.5px" fontWeight={600} color="var(--ink-primary)">
                                            {it.title}
                                        </Text>
                                    )
                                )}
                            </Flex>
                            <Flex align="center" gap={2} mt={0.5} wrap="wrap">
                                {it.source && (
                                    <Text as="span" fontSize="10.5px" color="var(--ink-tertiary)">
                                        {it.source}
                                    </Text>
                                )}
                                {it.url && !it.source && (
                                    <Text as="span" fontSize="10.5px" color="var(--ink-tertiary)" display="inline-flex" alignItems="center" gap={1.5}>
                                        <FaviconMark url={it.url} size={12} />
                                        {domainOf(it.url)}
                                    </Text>
                                )}
                                {it.date && (
                                    <Flex as="span" align="center" gap={0.5} fontSize="10.5px" color="var(--ink-tertiary)">
                                        <MdOutlineCalendarToday size={9} aria-hidden />
                                        {shortDate(it.date)}
                                    </Flex>
                                )}
                            </Flex>
                            {it.summary && (
                                <Text fontSize="12px" color="var(--ink-secondary)" lineHeight="relaxed" mt={1}>
                                    {it.summary}
                                </Text>
                            )}
                            {it.fields && <PayloadFields fields={it.fields} />}
                        </Box>
                    ))}
                </Flex>
            ) : (
                (ok || !ok) && (
                    <Box px={3} py={2}>
                        <Text fontSize="12px" color="var(--ink-tertiary)" lineHeight="relaxed">
                            {ok
                                ? "Returned a payload that could not be parsed into readable fields."
                                : o.status === "ERR"
                                  ? "This call failed — nothing came back from the source."
                                  : "This call returned no data."}
                        </Text>
                    </Box>
                )
            )}

            </>}
        </Box>
    );
}

/** The honest empty state: said plainly in type alone — amber headline, gray body. */
function NoDataNote({ message }: { message: string }) {
    return (
        <Box py={2}>
            <Flex gap={1.5} align="center">
                <MdOutlineWarningAmber size={13} aria-hidden style={{ color: "var(--signal-caution)", flexShrink: 0 }} />
                <Text fontSize="13px" fontWeight={600} color="var(--signal-caution)">
                    No real data reached this skill
                </Text>
            </Flex>
            <Text fontSize="12.5px" color="var(--ink-tertiary)" mt={1} lineHeight="relaxed" maxW="75ch">
                {message}
            </Text>
        </Box>
    );
}


function renderBlock(b: Block, datasets?: any[]) {
    if (b.kind === "text") {
        return (
            <Box py={1}>
                <Text fontSize="13.5px" color="var(--ink-secondary)" lineHeight="relaxed" whiteSpace="pre-wrap">
                    {b.body}
                </Text>
            </Box>
        )
    }
    if (b.kind === "table") {
        const ds = datasets?.find((d) => d.id === b.dataset_id)
        const cols = b.columns || ds?.columns?.map((c: any) => c.name) || []
        const rows = ((ds?.data || []) as any[]).slice(-(b.last_n || 30))
        return (
            <Box py={2} overflowX="auto">
                <Text fontSize="12px" fontWeight={600} color="var(--ink-primary)" mb={1}>{b.title}</Text>
                <Box as="table" style={{ borderCollapse: "collapse", width: "100%" }}>
                    <Box as="thead">
                        <Box as="tr">
                            {cols.map((col, i) => (
                                <Box as="th" key={i} style={{ textAlign: "left", padding: "4px 6px", borderBottom: "1px solid var(--hairline)", fontSize: "11px", color: "var(--ink-tertiary)" }}>
                                    {col}
                                </Box>
                            ))}
                        </Box>
                    </Box>
                    <Box as="tbody">
                        {rows.map((r, i) => (
                            <Box as="tr" key={i}>
                                {cols.map((col, j) => (
                                    <Box as="td" key={j} style={{ padding: "4px 6px", fontSize: "12px", color: "var(--ink-secondary)", borderBottom: "1px solid var(--hairline)" }}>
                                        {String(r?.[col] ?? "")}
                                    </Box>
                                ))}
                            </Box>
                        ))}
                    </Box>
                </Box>
            </Box>
        )
    }
    if (b.kind === "chart") {
        const ds = datasets?.find((d) => d.id === b.dataset_id)
        const dataRows = ((ds?.data || []) as any[])
        const cols = [b.x, ...(b.y || [])]
        return (
            <Box py={2}>
                <Text fontSize="12px" fontWeight={600} color="var(--ink-primary)" mb={1}>{b.title}</Text>
                <Box bg="var(--surface-recessed)" p={2} borderRadius="4px">
                    <Text fontSize="11px" color="var(--ink-tertiary)">
                        [{b.type}] chart using {cols.join(", ")} ({dataRows.length} rows)
                    </Text>
                </Box>
            </Box>
        )
    }
    return null
}

export default function SkillResultCard({ output, analysisId }: { output: SkillOutput; analysisId?: string }) {
    const scored = typeof output.score_0_100 === "number";
    const hasAnalysis = !!output.analysis?.trim();
    const summaryOnly = output.scored_by === "summary" || hasAnalysis || (output.findings || []).some((f) => f.title === "Skill summary");
    const hasError = !!output.error;
    const hasVerdicts = (output.verdicts || []).length > 0;
    const hasFindings = (output.findings || []).length > 0;
    const hasBlocks = (output.blocks || []).length > 0;
    const met = (output.verdicts || []).filter((v) => v.verdict === "PASS").length;
    const total = output.total_checklist ?? (output.verdicts || []).length;
    const showAnchors = hasVerdicts || hasBlocks;
    const showFindings = hasFindings && !hasBlocks;
    const observations = output.raw_observations || [];

    return (
        <Box as="section">
            <Box px={0} py={0}>
                {hasError && (
                    <Box mb={hasVerdicts || hasFindings ? 4 : 0}>
                        <NoDataNote message={output.error!} />
                    </Box>
                )}

                {output.rawText && (
                    <Box mb={4} p={3} bg="var(--surface-recessed)" borderRadius="4px">
                        <Text fontSize="12px" fontFamily="var(--font-mono)" color="var(--ink-secondary)" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                            {output.rawText}
                        </Text>
                    </Box>
                )}

                {/* Prose lives in the report (MarkdownBlock). This card is
                    evidence-only: verdicts, findings, sources, raw data. */}

                {/* Each anchor: quiet rows separated by whitespace alone — the
                    verdict tag and evidence indent make each row legible
                    without a single divider. */}
                {output.blocks && output.blocks.length > 0 ? (
                    <Box mb={showFindings ? 4 : 0} mt={2}>
                        {output.blocks.map((b, i) => (
                            <Box key={b.id || i}>{renderBlock(b, output.datasets)}</Box>
                        ))}
                    </Box>
                ) : showAnchors && (
                    <Box mb={showFindings ? 4 : 0} mt={2}>
                        {output.verdicts.map((v, i) => (
                            <Box key={i} py={2}>
                                <Flex justify="space-between" gap={3} align="baseline">
                                    <Text fontSize="13.5px" fontWeight={500} color="var(--ink-primary)" noOfLines={2}>
                                        {v.anchor || v.checklist_id}
                                    </Text>
                                    <VerdictPill verdict={v.verdict} flexShrink={0} />
                                </Flex>
                                {(v.evidence || v.rationale) && (
                                    <Text fontSize="12.5px" color="var(--ink-tertiary)" mt={1} lineHeight="1.55" maxW="75ch">
                                        {v.evidence || v.rationale}
                                    </Text>
                                )}
                                <SourceLine citations={v.citations} />
                            </Box>
                        ))}
                    </Box>
                )}

                {showFindings && (
                    <Box>
                        <Text
                            fontSize="11px"
                            fontWeight={500}
                            letterSpacing="0.05em"
                            textTransform="uppercase"
                            color="var(--ink-tertiary)"
                            mb={2}
                        >
                            Findings
                        </Text>
                        <Flex direction="column" gap={2.5}>
                            {output.findings.map((f, i) => (
                                <Box key={i}>
                                    <SkillSummaryMarkdown>{f.detail}</SkillSummaryMarkdown>
                                    <SourceLine citations={f.citations} />
                                </Box>
                            ))}
                        </Flex>
                    </Box>
                )}

                {!hasError && !hasVerdicts && !hasFindings && !hasAnalysis && (
                    <NoDataNote message="This skill completed but returned no findings or verdicts — nothing was assessable in the data available." />
                )}

                {(output.artifacts || []).map((a) => (
                    <ArtifactCard key={a.id} artifact={a} analysisId={analysisId} />
                ))}

                <SourceDataPanel observations={observations} />
            </Box>
        </Box>
    );
}
