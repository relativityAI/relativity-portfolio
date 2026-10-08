import { useEffect, useMemo, useState } from "react";
import {
    Box, Button, Dialog, Flex, Input, Spinner, Text,
} from "@/compat/ui";
import { MdSearch, MdEdit } from "react-icons/md";
import { SiAgentskills } from "react-icons/si";
import { SkillService, type SkillSummary } from "@/db";
import SkillDraftPane from "@/components/skills/SkillDraftPane";
import SkillCreatePane from "@/components/skills/SkillCreatePane";
import SkillAvatar from "@/components/shared/SkillAvatar";
import { SkillMarkdown } from "@/components/skills/SkillMarkdown";
import { MdAutoAwesome } from "react-icons/md";

/**
 * Skill library browser — one component, two callers.
 *
 * The builder uses it to attach skills; the Agents List uses it read-only so
 * users can read what a skill does before ever using it. The library is never
 * dumped inline: it opens as a full modal with the list on the left and the
 * selected skill's document on the right, so reading a skill never fights the
 * page for scroll space.
 */

const CATEGORY_LABELS: Record<string, string> = {
    valuation: "Valuation",
    fundamentals: "Fundamentals",
    qualitative: "Qualitative",
    market: "Market",
    macro: "Macro",
    custom: "Custom",
};

const categoryLabel = (c: string) => CATEGORY_LABELS[c] || c;

export function useSkillLibrary() {
    const [library, setLibrary] = useState<SkillSummary[]>([]);
    const [loading, setLoading] = useState(true);
    // A failed fetch must never read as "0 skills" — the caller renders an
    // honest error instead of an empty library.
    const [error, setError] = useState(false);

    const reload = () => {
        setLoading(true);
        SkillService.listSkills()
            .then((data) => {
                setLibrary(Array.isArray(data) ? data : []);
                setError(false);
            })
            .catch(() => {
                setLibrary([]);
                setError(true);
            })
            .finally(() => setLoading(false));
    };

    useEffect(reload, []);
    return { library, loading, error, reload, setLibrary };
}

/**
 * One skill's full document, fetched on open. Exported for reuse wherever a
 * single skill needs reading (attached-skill rows, modals, the browser).
 */
/**
 * Editable skill document. Edits validate against the real parser and save
 * through PUT /skills/:id — custom skills update in place; built-ins fork to
 * a user-owned copy that shadows the builtin from then on.
 */
export function SkillEditor({ skill, onSaved, onCancel }: {
    skill: SkillSummary;
    onSaved: (skill: SkillSummary) => void;
    onCancel: () => void;
}) {
    const [md, setMd] = useState<string | null>(null);
    const [issues, setIssues] = useState<{ line: number; message: string; severity: string }[]>([]);
    const [validated, setValidated] = useState(false);
    const [validating, setValidating] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [fixNotice, setFixNotice] = useState<string | null>(null);
    const [loadError, setLoadError] = useState(false);

    useEffect(() => {
        let cancelled = false;
        SkillService.readSkill(skill.id)
            .then((s) => { if (!cancelled) setMd(s.markdown || ""); })
            .catch(() => { if (!cancelled) setLoadError(true); });
        return () => { cancelled = true; };
    }, [skill.id]);

    const hardIssues = issues.filter((i) => i.severity === "error");
    const canSave = !!md?.trim() && hardIssues.length === 0 && !saving;

    const runValidate = async (text: string) => {
        setValidating(true);
        try {
            const res = await SkillService.validateMarkdown(text, skill.id);
            if (typeof res.fixed === "string") {
                // The server repaired the document — apply it so the user
                // reviews the fix rather than the error list.
                const errors = (res.issues || []).filter((i) => i.severity === "error").length;
                setMd(res.fixed);
                setIssues([]);
                setFixNotice(
                    errors > 0
                        ? `✓ We fixed ${errors} issue${errors === 1 ? "" : "s"} in your document — review it, then save.`
                        : "✓ We tidied your document — review it, then save.",
                );
                setValidated(false);
            } else {
                setIssues(res.issues || []);
                setFixNotice(null);
                // The click must visibly answer: a clean check shows an explicit
                // ok, not just the absence of error lines.
                setValidated(!res.issues?.some((i) => i.severity === "error") && !!text.trim());
            }
        } catch {
            setIssues([]);
            setFixNotice(null);
            setValidated(false);
        } finally {
            setValidating(false);
        }
    };

    const save = async () => {
        if (!canSave || !md) return;
        setSaving(true);
        setSaveError(null);
        try {
            const res = await SkillService.updateSkill(skill.id, md);
            onSaved(res.skill);
        } catch (e: any) {
            const serverIssues = e?.response?.data?.issues;
            if (serverIssues?.length) setIssues(serverIssues);
            setSaveError(e?.response?.data?.error || e?.message || "Save failed");
        } finally {
            setSaving(false);
        }
    };

    if (loadError) {
        return <Text fontSize="13px" color="var(--signal-negative)">Couldn&apos;t load this skill&apos;s document for editing.</Text>;
    }
    if (md === null) {
        return <Flex py={4}><Spinner size="sm" /></Flex>;
    }

    return (
        <Flex direction="column" gap={2}>
            <Flex align="center" gap={2} wrap="wrap">
                <Text fontSize="16px" fontWeight={600} color="var(--ink-primary)">Editing: {skill.name}</Text>
                {skill.source === "builtin" && (
                    <Text fontSize="10px" fontFamily="var(--font-mono)" color="var(--accent-primary)">
                        SAVES AS YOUR COPY
                    </Text>
                )}
            </Flex>
            <Text fontSize="12px" color="var(--ink-tertiary)">
                {skill.source === "builtin"
                    ? "Built-in skills can't be changed for everyone — your edit creates a personal copy that this agent (and only you) will use from now on."
                    : "Your skill. Edits apply everywhere this skill is used."}
            </Text>
            <Box
                as="textarea"
                value={md}
                onChange={(e: any) => { setMd(e.target.value); setValidated(false); setFixNotice(null); }}
                onBlur={() => md && runValidate(md)}
                spellCheck={false}
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
            {validated && issues.length === 0 && (
                <Text fontSize="12px" color="var(--signal-positive)" fontWeight={500}>✓ Document is valid — ready to save</Text>
            )}
            {fixNotice && (
                <Text fontSize="12px" color="var(--signal-positive)" fontWeight={500}>{fixNotice}</Text>
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
            {saveError && (
                <Text fontSize="12px" color="var(--signal-negative)">{saveError}</Text>
            )}
            <Flex gap={3.5} justify="flex-end">
                <Button
                    size="sm"
                    variant="ghost"
                    bg="transparent"
                    color="white"
                    fontWeight={400}
                    _hover={{ bg: "transparent", fontWeight: 800 }}
                    _active={{ bg: "transparent" }}
                    transition="font-weight 100ms ease"
                    onClick={onCancel}
                >Cancel</Button>
                <Button
                    size="sm"
                    variant="ghost"
                    bg="transparent"
                    color="white"
                    fontWeight={400}
                    _hover={{ bg: "transparent", fontWeight: 800 }}
                    _active={{ bg: "transparent" }}
                    transition="font-weight 100ms ease"
                    loading={validating}
                    onClick={() => md && runValidate(md)}
                    disabled={!md?.trim()}
                >
                    Validate
                </Button>
                <Button size="sm" variant="outline" className="rounded-full px-4" loading={saving} onClick={save} disabled={!canSave}>
                    Save changes
                </Button>
            </Flex>
        </Flex>
    );
}

export function SkillDetail({ skill, onEdit, onEditWithAi, onDelete }: { skill: SkillSummary; onEdit?: () => void; onEditWithAi?: () => void; onDelete?: () => void }) {
    const [markdown, setMarkdown] = useState<string | null>(null);
    const [error, setError] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setMarkdown(null);
        setError(false);
        SkillService.readSkill(skill.id)
            .then((s) => !cancelled && setMarkdown(s.markdown || ""))
            .catch(() => !cancelled && setError(true));
        return () => { cancelled = true; };
    }, [skill.id]);

    return (
        <Box>
            <Flex align="center" gap={2} mb={1} wrap="wrap">
                <SkillAvatar skill={skill} size={28} />
                <Text fontSize="16px" fontWeight={600} color="var(--ink-primary)">{skill.name}</Text>
                <Text fontSize="11px" fontFamily="var(--font-mono)" color="var(--ink-tertiary)">
                    {categoryLabel(skill.category)} · {skill.id}
                </Text>
                {skill.source === "custom" && (
                    <Text fontSize="10px" fontFamily="var(--font-mono)" color="var(--accent-primary)">
                        YOURS
                    </Text>
                )}
                <Flex ml="auto" gap={1} align="center" flexShrink={0} wrap="wrap" justify="flex-end">
                    {onEditWithAi && (
                        <Button size="xs" variant="ghost" onClick={onEditWithAi} aria-label={`Edit ${skill.name} with AI`}>
                            <MdAutoAwesome size={13} /> Edit with AI
                        </Button>
                    )}
                    {onEdit && (
                        <Button
                            size="xs"
                            variant="ghost"
                            onClick={onEdit}
                            aria-label={`Edit ${skill.name}`}
                        >
                            <MdEdit size={13} /> Edit
                        </Button>
                    )}
                    {onDelete && (
                        <Button size="xs" variant="ghost" colorPalette="red" onClick={onDelete} aria-label={`Delete ${skill.name}`}>
                            Delete
                        </Button>
                    )}
                </Flex>
            </Flex>
            <Text fontSize="13.5px" color="var(--ink-secondary)" lineHeight="relaxed" mb={4}>
                {skill.description}
            </Text>

            {skill.purpose && (
                <Box mb={4}>
                    <Text fontSize="11px" fontFamily="var(--font-mono)" color="var(--ink-tertiary)" mb={1.5} letterSpacing="0.05em">
                        WHAT IT ANALYZES
                    </Text>
                    <Text fontSize="13px" color="var(--ink-secondary)" lineHeight="relaxed" whiteSpace="pre-wrap">
                        {skill.purpose}
                    </Text>
                </Box>
            )}

            {!!skill.anchors?.length && (
                <Box mb={4}>
                    <Text fontSize="11px" fontFamily="var(--font-mono)" color="var(--ink-tertiary)" mb={2} letterSpacing="0.05em">
                        VERDICTS IT RETURNS
                    </Text>
                    <Flex direction="column" gap={1.5}>
                        {skill.anchors.map((a) => (
                            <Flex key={a.label} align="baseline" gap={2}>
                                <Box w="4px" h="4px" borderRadius="full" bg="var(--accent-primary)" flexShrink={0} />
                                <Text fontSize="13px" color="var(--ink-secondary)">{a.label}</Text>
                            </Flex>
                        ))}
                    </Flex>
                </Box>
            )}

            <Text fontSize="11px" fontFamily="var(--font-mono)" color="var(--ink-tertiary)" mb={2} letterSpacing="0.05em">
                SKILL DOCUMENT
            </Text>
            {error ? (
                <Text fontSize="13px" color="var(--signal-negative)">
                    Couldn&apos;t load this skill&apos;s document.
                </Text>
            ) : markdown === null ? (
                <Flex py={4}><Spinner size="sm" /></Flex>
            ) : (
                <SkillMarkdown>{markdown}</SkillMarkdown>
            )}
        </Box>
    );
}

export interface SkillBrowserProps {
    library: SkillSummary[];
    loading: boolean;
    /** True when the library fetch failed — rendered as an error, never "0 skills". */
    error?: boolean;
    /** Hide the attach controls — the Agents List is read-only. */
    readOnly?: boolean;
    onDraftClick?: () => void;
    /** Show the manual (markdown) authoring path alongside the AI draft. */
    allowManualCreate?: boolean;
    /** Attached skill ids get an "Added" state and an unattach control. */
    attachedIds?: Set<string>;
    onToggle?: (id: string) => void;
    /** Called when the user commits an add from the detail pane. */
    onAdd?: (id: string) => void;
    /** Control the modal from the parent (e.g. an empty-state call to action). */
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    /** Called after a skill edit saves, so parents refresh their library. */
    onSkillSaved?: (skill: SkillSummary) => void;
    /** Called after a skill is deleted, so parents refresh their library. */
    onSkillDeleted?: (id: string) => void;
    /** Whether a Tavily key is configured — enables web search in the draft pane. */
    hasWebSearch?: boolean;
    /** Open the browser focused on this skill's document (e.g. from a View button). */
    openWithId?: string | null;
}

export default function SkillBrowser({
    library, loading, error: libraryError, readOnly, onDraftClick, attachedIds, onToggle, onAdd,
    open: openProp, onOpenChange, onSkillSaved, hasWebSearch, allowManualCreate, openWithId, onSkillDeleted,
}: SkillBrowserProps) {
    const [openInternal, setOpenInternal] = useState(false);
    const open = openProp ?? openInternal;
    const setOpen = (v: boolean) => {
        setOpenInternal(v);
        onOpenChange?.(v);
    };
    const [query, setQuery] = useState("");
    const [category, setCategory] = useState("all");
    const [selected, setSelected] = useState<SkillSummary | null>(null);
    const [editing, setEditing] = useState(false);
    // Drafting replaces the right-hand reading pane (no separate popup).
    const [drafting, setDrafting] = useState(false);
    // Manual markdown authoring — same pane slot, AI-free path.
    const [creating, setCreating] = useState(false);
    // AI editing an existing skill — the same chat, seeded from its document.
    const [aiEditing, setAiEditing] = useState(false);
    // Delete confirmation lives inside this dialog (no second popup).
    const [deleting, setDeleting] = useState(false);

    // Reset the selection each time the browser opens so it always lands on
    // the list, never a stale skill from a previous session.
    useEffect(() => {
        if (open) {
            setSelected(openWithId ? library.find((s) => s.id === openWithId) || null : null);
            setEditing(false); setDrafting(false); setCreating(false); setAiEditing(false); setDeleting(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, openWithId]);

    // Selecting a different skill always leaves editor/draft/delete modes.
    useEffect(() => {
        setEditing(false); setAiEditing(false); setDeleting(false);
    }, [selected?.id]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return library.filter((s) => {
            if (category !== "all" && s.category !== category) return false;
            if (!q) return true;
            return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q);
        });
    }, [library, query, category]);

    const categories = useMemo(
        () => ["all", ...Array.from(new Set(library.map((s) => s.category)))],
        [library],
    );

    return (
        <>
            {/* Collapsed by default — the library is opt-in, not dumped on the page. */}
            <Button size="sm" variant="surface" onClick={() => setOpen(true)}>
                <SiAgentskills aria-hidden />{" "}
                {libraryError
                    ? "Browse skills (couldn't load — click to retry)"
                    : `Browse ${library.length} skill${library.length === 1 ? "" : "s"}`}
            </Button>

            <Dialog.Root
            open={open}
            onOpenChange={(e) => setOpen(e.open)}
            // "lg" + explicit dims (NOT size="full", whose built-in 100vw/100vh
            // content styles can push the footer below the viewport fold).
            size="lg"
            scrollBehavior="inside"
            closeOnEsc
            closeOnInteractOutside={false}
        >
            <Dialog.Backdrop />
            <Dialog.Positioner p={{ base: 2, md: 6 }}>
                <Dialog.Content
                    bg="var(--surface-panel)"
                    maxW="1100px"
                    w="calc(100vw - 16px)"
                    maxH="calc(100dvh - 32px)"
                    h="calc(100dvh - 32px)"
                    display="flex"
                    flexDirection="column"
                    overflow="hidden"
                    borderRadius="8px"
                    my="auto"
                >
                    <Dialog.Header px={5} py={3.5} borderBottom="var(--hairline-w) solid var(--hairline)" flexShrink={0}>
                        <Flex justify="space-between" align="center" w="full" gap={3}>
                            <Box>
                                <Text fontSize="15px" fontWeight={600} color="var(--ink-primary)" display="flex" alignItems="center" gap={1.5}>
                                    <SiAgentskills aria-hidden /> Skill library
                                </Text>
                                <Text fontSize="12px" color="var(--ink-tertiary)" fontWeight={400}>
                                    Every skill an agent can run. Click one to read what it analyzes.
                                </Text>
                            </Box>
                            <Dialog.CloseTrigger asChild>
                                <Button size="sm" variant="subtle" aria-label="Close skill library">Close</Button>
                            </Dialog.CloseTrigger>
                        </Flex>
                    </Dialog.Header>

                    <Dialog.Body flex={1} minH={0} p={0} display="flex" overflow="hidden">
                        {/* Left: searchable list. Right: the selected skill's document. */}
                        <Flex
                            direction="column"
                            w={{ base: "100%", md: "360px" }}
                            flexShrink={0}
                            borderRight={{ md: "var(--hairline-w) solid var(--hairline)" }}
                            minH={0}
                            display={selected ? { base: "none", md: "flex" } : "flex"}
                        >
                            <Box px={4} pt={3} pb={2} flexShrink={0}>
                                <Flex gap={2} mb={2.5} wrap="wrap">
                                    {categories.map((c) => (
                                        <Box
                                            key={c}
                                            as="button"
                                            px={2.5}
                                            py={1}
                                            borderRadius="full"
                                            fontSize="11.5px"
                                            fontWeight={category === c ? 600 : 400}
                                            color={category === c ? "var(--ink-primary)" : "var(--ink-tertiary)"}
                                            bg={category === c ? "var(--surface-recessed)" : "transparent"}
                                            border="1px solid"
                                            borderColor={category === c ? "var(--hairline)" : "transparent"}
                                            cursor="pointer"
                                            _hover={{ color: "var(--ink-primary)" }}
                                            onClick={() => setCategory(c)}
                                        >
                                            {c === "all" ? "All" : categoryLabel(c)}
                                        </Box>
                                    ))}
                                </Flex>
                                <Box position="relative">
                                    <Box position="absolute" left={3} top="50%" transform="translateY(-50%)" color="var(--ink-tertiary)" pointerEvents="none">
                                        <MdSearch />
                                    </Box>
                                    <Input
                                        placeholder="Search skills…"
                                        aria-label="Search skills"
                                        size="sm"
                                        pl={9}
                                        value={query}
                                        onChange={(e) => setQuery(e.target.value)}
                                    />
                                </Box>
                            </Box>

                            <Box flex={1} minH={0} overflowY="auto" px={3} pb={3}>
                                {loading ? (
                                    <Flex role="status" aria-label="Loading skill library" justify="center" py={10}><Spinner /></Flex>
                                ) : (
                                    <Flex direction="column" gap={1}>
                                        {filtered.map((s) => {
                                            const isAttached = !!attachedIds?.has(s.id);
                                            const isSelected = selected?.id === s.id;
                                            return (
                                                <Box
                                                    key={s.id}
                                                    as="button"
                                                    textAlign="left"
                                                    p={3}
                                                    borderRadius="6px"
                                                    border="1px solid"
                                                    borderColor={isSelected ? "var(--accent-primary)" : "transparent"}
                                                    bg={isSelected ? "var(--surface-recessed)" : "transparent"}
                                                    cursor="pointer"
                                                    _hover={{ bg: "var(--surface-recessed)" }}
                                                    onClick={() => { setSelected(s); setDrafting(false); setCreating(false); setEditing(false); }}
                                                >
                                                    <Flex align="center" gap={2} mb={0.5} wrap="wrap">
                                                        <SkillAvatar skill={s} size={20} />
                                                        <Text fontSize="13.5px" fontWeight={600} color="var(--ink-primary)">{s.name}</Text>
                                                        <Text fontSize="10px" fontFamily="var(--font-mono)" color="var(--ink-tertiary)">
                                                            {categoryLabel(s.category)}
                                                        </Text>
                                                        {s.source === "custom" && (
                                                            <Text fontSize="10px" fontFamily="var(--font-mono)" color="var(--accent-primary)">YOURS</Text>
                                                        )}
                                                        {isAttached && (
                                                            <Text fontSize="10px" fontFamily="var(--font-mono)" color="var(--signal-positive)">ATTACHED</Text>
                                                        )}
                                                    </Flex>
                                                    <Text fontSize="12px" color="var(--ink-tertiary)" lineClamp={2} fontWeight={400}>
                                                        {s.description}
                                                    </Text>
                                                    {!readOnly && (
                                                        <Flex gap={2} mt={2}>
                                                            {/* A real button: keyboard-activatable and announced —
                                                                the click-only span used to be invisible to both. */}
                                                            <Button
                                                                size="xs"
                                                                variant="outline"
                                                                colorPalette={isAttached ? "red" : "blue"}
                                                                minH="24px"
                                                                minW="24px"
                                                                px={2}
                                                                aria-pressed={isAttached}
                                                                onClick={(e: any) => {
                                                                    e.stopPropagation();
                                                                    onToggle?.(s.id);
                                                                }}
                                                            >
                                                                {isAttached ? "Remove" : "Add to agent"}
                                                            </Button>
                                                        </Flex>
                                                    )}
                                                </Box>
                                            );
                                        })}
                                        {filtered.length === 0 && (
                                            libraryError ? (
                                                <Text fontSize="13px" color="var(--signal-negative)" py={4}>
                                                    The skill library could not be loaded. Close this dialog and reopen it to retry.
                                                </Text>
                                            ) : (
                                                <Text fontSize="13px" color="var(--ink-tertiary)" py={4}>
                                                    No skills match that search.
                                                </Text>
                                            )
                                        )}
                                    </Flex>
                                )}
                            </Box>

                            {(onDraftClick || allowManualCreate) && (
                                <Box px={3} py={3} borderTop="var(--hairline-w) solid var(--hairline)" flexShrink={0}>
                                    <Flex direction="column" gap={2}>
                                        {onDraftClick && (
                                            <Button
                                                size="sm"
                                                variant={drafting ? "solid" : "outline"}
                                                colorPalette={drafting ? "teal" : undefined}
                                                w="full"
                                                onClick={() => { setDrafting(true); setCreating(false); setSelected(null); setEditing(false); }}
                                            >
                                                <SiAgentskills aria-hidden /> Draft a new skill with AI
                                            </Button>
                                        )}
                                        {allowManualCreate && (
                                            <Button
                                                size="sm"
                                                variant={creating ? "solid" : "outline"}
                                                colorPalette={creating ? "teal" : undefined}
                                                w="full"
                                                onClick={() => { setCreating(true); setDrafting(false); setSelected(null); setEditing(false); }}
                                            >
                                                <MdEdit aria-hidden /> Create a skill manually
                                            </Button>
                                        )}
                                    </Flex>
                                </Box>
                            )}
                        </Flex>

                        {/* Right pane: the selected skill, its editor, the AI
                            draft chat, or the manual markdown author. Full-width
                            on mobile with a back button, side-by-side on desktop. */}
                        <Flex
                            flex={1}
                            minH={0}
                            display={{ base: selected || drafting || creating ? "flex" : "none", md: selected || drafting || creating ? "flex" : "none" }}
                            direction="column"
                        >
                            {drafting || aiEditing ? (
                                <Box flex={1} minH={0} overflowY="auto" px={5} py={4}>
                                    <SkillDraftPane
                                        key={aiEditing ? `edit-${selected?.id}` : "draft"}
                                        skill={aiEditing ? selected : null}
                                        hasWebSearch={hasWebSearch}
                                        onDeleted={(id) => {
                                            setAiEditing(false);
                                            setSelected(null);
                                            onSkillDeleted?.(id);
                                        }}
                                        onCancel={() => { setDrafting(false); setAiEditing(false); }}
                                        onSaved={(skill) => {
                                            setDrafting(false);
                                            setAiEditing(false);
                                            setSelected(skill);
                                            onSkillSaved?.(skill);
                                        }}
                                    />
                                </Box>
                            ) : creating ? (
                                <Box flex={1} minH={0} overflowY="auto" px={5} py={4}>
                                    <SkillCreatePane
                                        library={library}
                                        onCancel={() => setCreating(false)}
                                        onSaved={(skill) => {
                                            setCreating(false);
                                            setSelected(skill);
                                            onSkillSaved?.(skill);
                                        }}
                                    />
                                </Box>
                            ) : selected && (
                                <>
                                    <Flex px={5} pt={3} flexShrink={0} display={{ base: "flex", md: "none" }}>
                                        <Button size="xs" variant="ghost" onClick={() => { setSelected(null); setEditing(false); }}>← All skills</Button>
                                    </Flex>
                                    <Box flex={1} minH={0} overflowY="auto" px={5} py={4}>
                                        {editing ? (
                                            <SkillEditor
                                                skill={selected}
                                                onCancel={() => setEditing(false)}
                                                onSaved={(saved) => {
                                                    setEditing(false);
                                                    setSelected(saved);
                                                    onSkillSaved?.(saved);
                                                }}
                                            />
                                        ) : (
                                            <SkillDetail
                                                skill={selected}
                                                onEdit={() => setEditing(true)}
                                                onEditWithAi={onDraftClick ? () => { setAiEditing(true); } : undefined}
                                                onDelete={selected.source === "custom" && !readOnly ? () => setDeleting(true) : undefined}
                                            />
                                        )}
                                    </Box>
                                    {!readOnly && onAdd && (
                                        <Box px={5} py={3} borderTop="var(--hairline-w) solid var(--hairline)" flexShrink={0}>
                                            {attachedIds?.has(selected.id) ? (
                                                <Button
                                                    size="sm"
                                                    variant="subtle"
                                                    onClick={() => { onToggle?.(selected.id); }}
                                                >
                                                    Remove from agent
                                                </Button>
                                            ) : (
                                                <Button
                                                    size="sm"
                                                    variant="solid"
                                                    colorPalette="teal"
                                                    onClick={() => { onAdd(selected.id); setOpen(false); }}
                                                >
                                                    Add to agent
                                                </Button>
                                            )}
                                            {deleting && (
                                                <Flex mt={2.5} align="center" justify="space-between" gap={2} bg="var(--surface-recessed)" border="var(--hairline-w) solid var(--hairline)" borderRadius="6px" px={3} py={2} className="chat-msg">
                                                    <Text fontSize="12px" color="var(--ink-secondary)" flex={1} minW={0}>
                                                        Delete “{selected.name}” permanently? Agents using it lose this skill.
                                                    </Text>
                                                    <Flex gap={1.5} flexShrink={0}>
                                                        <Button size="xs" variant="ghost" onClick={() => setDeleting(false)}>Cancel</Button>
                                                        <Button
                                                            size="xs"
                                                            colorPalette="red"
                                                            onClick={() => {
                                                                SkillService.deleteSkill(selected.id).then(() => {
                                                                    setDeleting(false);
                                                                    setSelected(null);
                                                                    onSkillDeleted?.(selected.id);
                                                                });
                                                            }}
                                                        >
                                                            Delete
                                                        </Button>
                                                    </Flex>
                                                </Flex>
                                            )}
                                        </Box>
                                    )}
                                </>
                            )}
                        </Flex>

                        {/* Desktop empty state for the reading pane. */}
                        {!selected && !drafting && !creating && !aiEditing && (
                            <Flex
                                flex={1}
                                display={{ base: "none", md: "flex" }}
                                align="center"
                                justify="center"
                            >
                                <Text fontSize="13px" color="var(--ink-tertiary)">
                                    Select a skill to read its purpose, method, and verdict anchors.
                                </Text>
                            </Flex>
                        )}
                    </Dialog.Body>
                </Dialog.Content>
            </Dialog.Positioner>
        </Dialog.Root>
        </>
    );
}
