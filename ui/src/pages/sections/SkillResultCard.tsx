import { Box, Text, Flex, Badge } from "@/compat/ui"
import { SiAgentskills } from "react-icons/si"
import { useState } from "react"
import {
    MdLink,
    MdExpandMore,
    MdExpandLess,
    MdDataset,
    MdOutlineWarningAmber,
    MdOutlineOpenInNew,
    MdOutlineCalendarToday,
} from "react-icons/md"
import { SOURCE_DEFS, SourceMark, sourceForTool, FaviconMark, type SourceKey } from "@/lib/sourceLogos"

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
    status: string;
    url?: string;
}

interface SkillOutput {
    skill_id: string;
    skill_name: string;
    category: string;
    weight: number;
    findings: { title: string; detail: string; citations?: Citation[] }[];
    verdicts: { anchor: string; verdict: string; evidence: string; citations?: Citation[] }[];
    tools_used?: string[];
    citations?: Citation[];
    raw_observations?: RawObservation[];
    error?: string;
    score_0_100?: number | null;
    coverage?: number;
    scored_by?: string;
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
    YES: { color: "var(--signal-positive)", bg: "color-mix(in srgb, var(--signal-positive) 11%, transparent)", label: "Met" },
    PARTIAL: { color: "var(--signal-caution)", bg: "color-mix(in srgb, var(--signal-caution) 11%, transparent)", label: "Partly met" },
    NO: { color: "var(--signal-negative)", bg: "color-mix(in srgb, var(--signal-negative) 11%, transparent)", label: "Not met" },
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
            // Single-object data feed: one-line key: value readout.
            const flat: string[] = [];
            const visit = (v: unknown, prefix = ""): void => {
                if (flat.length >= 6) return;
                if (v == null || typeof v === "function") return;
                if (typeof v === "object") {
                    for (const [k, val] of Object.entries(v as Record<string, unknown>).slice(0, 10)) {
                        visit(val, prefix ? `${prefix}.${k}` : k);
                    }
                } else if (typeof v === "number" || typeof v === "string") {
                    const sv = String(v);
                    if (sv.length <= 60 && !/^https?:/.test(sv)) flat.push(`${prefix}: ${sv}`);
                }
            };
            visit(j);
            if (flat.length > 0) {
                return {
                    items: [{ title: null, url: null, date: null, source: null, summary: flat.join("   "), isWeb: false }],
                    keys: [],
                };
            }
        } catch { /* fall through */ }
    }
    return { items: [], keys: [] };
}

/**
 * The verbatim record of what the tools returned, rendered as SOURCE DATA —
 * a visually separate, branded section under the analysis. Each observation
 * leads with where it came from (icon + domain/feed), shows readable content
 * (story cards for web results, key readouts for data feeds), and keeps the
 * untouched payload one click away per item.
 */
function SourceDataPanel({ observations }: { observations: RawObservation[] }) {
    const [open, setOpen] = useState(false);
    if (!observations.length) return null;
    const ok = observations.filter((o) => o.status === "ok");
    const empty = observations.filter((o) => o.status !== "ok" && o.status !== "ERR");
    const failed = observations.filter((o) => o.status === "ERR");

    // Distinct source brands actually used, for the header chips.
    const sourceKeys: SourceKey[] = [];
    for (const o of observations) {
        const key = o.url ? ("web" as SourceKey) : sourceForTool(o.tool);
        if (!sourceKeys.includes(key)) sourceKeys.push(key);
    }

    const summary =
        ok.length === 0
            ? "nothing came back"
            : `${ok.length} of ${observations.length} call${observations.length === 1 ? "" : "s"} returned data`;

    return (
        <Box mt={4}>
            <Flex
                as="button"
                onClick={() => setOpen(!open)}
                align="center"
                gap={2}
                w="100%"
                bg="transparent"
                border="none"
                cursor="pointer"
                px={0}
                py={1.5}
                textAlign="left"
                aria-expanded={open}
            >
                <MdDataset size={15} aria-hidden style={{ color: "var(--ink-tertiary)", flexShrink: 0 }} />
                <Text fontSize="12.5px" fontWeight={600} color="var(--ink-primary)" flexShrink={0}>
                    Source data
                </Text>
                <Text fontSize="11.5px" fontWeight={400} color="var(--ink-tertiary)" flex={1} textAlign="left" noOfLines={1}>
                    ({summary}
                    {failed.length > 0 ? ` · ${failed.length} failed` : empty.length > 0 ? ` · ${empty.length} empty` : ""})
                </Text>
                {sourceKeys.slice(0, 4).map((k) => (
                    <SourceMark key={k} source={k} size={13} muted={k === "voyager"} />
                ))}
                {open ? <MdExpandLess size={15} /> : <MdExpandMore size={15} />}
            </Flex>
            {open && (
                <Flex direction="column" gap={3} mt={2}>
                    {observations.map((o, i) => (
                        <ObservationCard key={i} o={o} />
                    ))}
                </Flex>
            )}
        </Box>
    );
}

/** One tool observation as a source-data card. */
function ObservationCard({ o }: { o: RawObservation }) {
    const [showRaw, setShowRaw] = useState(false);
    const parsed = parsePayload(o.result || "");
    const isWeb = parsed.items.some((it) => it.isWeb) || (!!o.url && parsed.items.length === 0);
    const sourceKey = o.url && parsed.items.length === 0 ? ("web" as SourceKey) : sourceForTool(o.tool);
    const headerLabel = o.url && parsed.items.length === 0 ? domainOf(o.url) : SOURCE_DEFS[sourceKey].label;
    const ok = o.status === "ok";

    return (
        <Box bg="var(--surface-panel)" borderRadius="4px" overflow="hidden">
            {/* Facsimile header: where this piece of data came from — quiet
                typography, no borders. */}
            <Flex gap={2} align="center" wrap="wrap" px={3} py={2}>
                <SourceMark source={sourceKey} size={13} muted={sourceKey === "voyager"} />
                {o.url && parsed.items.length === 0 ? (
                    <a href={o.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none", minWidth: 0 }}>
                        <Text
                            as="span"
                            fontSize="11.5px"
                            fontWeight={600}
                            color="var(--accent, #23747D)"
                            display="inline-flex"
                            alignItems="center"
                            gap={1}
                            _hover={{ textDecoration: "underline" }}
                        >
                            <FaviconMark url={o.url} size={14} />
                            {"\u00A0\u00A0"}
                            {headerLabel}
                            <MdOutlineOpenInNew size={10} aria-hidden style={{ flexShrink: 0 }} />
                        </Text>
                    </a>
                ) : (
                    <Text as="span" fontSize="11.5px" fontWeight={600} color="var(--ink-primary)">
                        {headerLabel}
                    </Text>
                )}
                {!o.url && o.args && (
                    <Text
                        as="span"
                        fontSize="10px"
                        fontFamily="var(--font-mono)"
                        color="var(--ink-tertiary)"
                        whiteSpace="nowrap"
                        overflow="hidden"
                        textOverflow="ellipsis"
                        maxW="300px"
                        display="inline-block"
                        title={o.args}
                    >
                        {o.args}
                    </Text>
                )}
                <Text
                    fontSize="10.5px"
                    fontFamily="var(--font-mono)"
                    color={ok ? "var(--signal-positive)" : o.status === "ERR" ? "var(--signal-negative)" : "var(--ink-tertiary)"}
                    ml="auto"
                >
                    {ok ? "returned" : o.status === "ERR" ? "failed" : "empty"}
                </Text>
            </Flex>

            {/* Readable content: story cards for web results, readouts for feeds */}
            {ok && parsed.items.length > 0 ? (
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
                        </Box>
                    ))}
                </Flex>
            ) : (
                (ok || !ok) && (
                    <Box px={3} py={2}>
                        <Text fontSize="12px" color="var(--ink-tertiary)" lineHeight="relaxed">
                            {ok
                                ? "Returned a payload the summary renderer could not read — open the raw response below."
                                : o.status === "ERR"
                                  ? "This call failed — nothing came back from the source."
                                  : "This call returned no data."}
                        </Text>
                    </Box>
                )
            )}

            {/* Verbatim payload — per-item, never by default */}
            {ok && o.result && (
                <Box px={3} pb={2}>
                    <Flex
                        as="button"
                        onClick={() => setShowRaw(!showRaw)}
                        align="center"
                        gap={1}
                        bg="transparent"
                        border="none"
                        cursor="pointer"
                        p={0}
                        color="var(--ink-tertiary)"
                        _hover={{ color: "var(--ink-secondary)" }}
                        aria-expanded={showRaw}
                    >
                        <MdDataset size={10} aria-hidden />
                        <Text as="span" fontSize="10px" fontFamily="var(--font-mono)">
                            {showRaw ? "hide raw response" : "raw response"}
                        </Text>
                    </Flex>
                    {showRaw && <RawPayload text={o.result} />}
                </Box>
            )}
        </Box>
    );
}

/** The untouched tool response, in a scrollable mono block. */
function RawPayload({ text }: { text: string }) {
    return (
        <Text
            as="pre"
            fontSize="10px"
            fontFamily="var(--font-mono)"
            color="var(--ink-tertiary)"
            whiteSpace="pre-wrap"
            wordBreak="break-word"
            m={0}
            mt={1.5}
            maxH="200px"
            overflowY="auto"
            bg="var(--surface-recessed)"
            p={2}
            borderRadius="2px"
        >
            {text}
        </Text>
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

export default function SkillResultCard({ output }: { output: SkillOutput }) {
    const scored = typeof output.score_0_100 === "number";
    const hasError = !!output.error;
    const hasVerdicts = (output.verdicts || []).length > 0;
    const hasFindings = (output.findings || []).length > 0;
    const met = (output.verdicts || []).filter((v) => v.verdict === "YES").length;
    const total = (output.verdicts || []).length;
    const showAnchors = hasVerdicts;
    const showFindings = hasFindings;
    const observations = output.raw_observations || [];

    return (
        <Box as="section">
            {/* Chapter header: pure typography — the score's size and signal
                color carry the hierarchy, no rules or accent bars. */}
            <Flex
                justify="space-between"
                align="baseline"
                gap={3}
                wrap="wrap"
                mb={1}
            >
                <Flex gap={3} align="baseline" minW={0} flexWrap="wrap">
                    <Text
                        fontSize="22px"
                        fontWeight={700}
                        fontFamily="var(--font-tabular)"
                        fontVariantNumeric="tabular-nums"
                        lineHeight={1}
                        color={
                            hasError
                                ? "var(--signal-negative)"
                                : scored
                                  ? scoreSignalColor(output.score_0_100)
                                  : "var(--ink-tertiary)"
                        }
                        title={
                            scored
                                ? "Score computed from this skill's anchor verdicts"
                                : hasError
                                  ? "This skill failed before producing a score"
                                  : "No score — this skill had no assessable data"
                        }
                    >
                        {hasError ? "×" : scored ? output.score_0_100 : "N/A"}
                    </Text>
                    <Text fontSize="15px" fontWeight={600} color="var(--ink-primary)">
                        {output.skill_name}
                    </Text>
                    <Text fontSize="11px" fontFamily="var(--font-mono)" color="var(--ink-tertiary)">
                        {output.category}
                    </Text>
                </Flex>
                {total > 0 && (
                    <Text fontSize="11.5px" color="var(--ink-tertiary)" flexShrink={0}>
                        {met} of {total} anchors met
                    </Text>
                )}
            </Flex>

            <Box px={0} py={0}>
                {hasError && (
                    <Box mb={hasVerdicts || hasFindings ? 4 : 0}>
                        <NoDataNote message={output.error!} />
                    </Box>
                )}

                {/* Each anchor: quiet rows separated by whitespace alone — the
                    verdict tag and evidence indent make each row legible
                    without a single divider. */}
                {showAnchors && (
                    <Box mb={showFindings ? 4 : 0} mt={2}>
                        {output.verdicts.map((v, i) => (
                            <Box key={i} py={2}>
                                <Flex justify="space-between" gap={3} align="baseline">
                                    <Text fontSize="13.5px" fontWeight={500} color="var(--ink-primary)" noOfLines={2}>
                                        {v.anchor}
                                    </Text>
                                    <VerdictPill verdict={v.verdict} flexShrink={0} />
                                </Flex>
                                {v.evidence && (
                                    <Text fontSize="12.5px" color="var(--ink-tertiary)" mt={1} lineHeight="1.55" maxW="75ch">
                                        {v.evidence}
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
                                    <Text fontSize="13.5px" color="var(--ink-secondary)" lineHeight="relaxed">
                                        <Text as="span" fontWeight={600} color="var(--ink-primary)">
                                            {f.title}
                                        </Text>
                                        {f.detail ? ` — ${f.detail}` : ""}
                                    </Text>
                                    <SourceLine citations={f.citations} />
                                </Box>
                            ))}
                        </Flex>
                    </Box>
                )}

                {!hasError && !hasVerdicts && !hasFindings && (
                    <NoDataNote message="This skill completed but returned no findings or verdicts — nothing was assessable in the data available." />
                )}

                <SourceDataPanel observations={observations} />
            </Box>
        </Box>
    );
}
