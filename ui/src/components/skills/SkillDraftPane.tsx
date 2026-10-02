import { useEffect, useRef, useState } from "react";
import {
    Box, Button, Flex, Input, Spinner, Text,
} from "@/compat/ui";
import { LuCopy, LuCheck } from "react-icons/lu";
import { AnalysisService, SettingsService, SkillService, isServerFreeModel, type SkillSummary } from "@/db";

/**
 * Draft-a-skill chat as an embeddable PANE (not a dialog) — it renders in the
 * right-hand reading pane of the skill library browser, exactly where a skill
 * document is normally read. The conversation and the generated document both
 * live in this pane.
 *
 * The same chat also EDITS an existing skill: pass `skill` and the conversation
 * starts from that document — the model revises it across turns and the next
 * save upserts it in place (same id).
 */

export interface SkillDraftPaneProps {
    /** Called after the skill is saved — the pane's parent closes the session. */
    onSaved: (skill: SkillSummary) => void;
    onCancel: () => void;
    /** Whether a Tavily key is configured (web search available). */
    hasWebSearch?: boolean;
    /** Existing skill to revise in chat. Omit for a fresh draft. */
    skill?: SkillSummary | null;
    /** Called when this skill is deleted from the pane, so parents refresh. */
    onDeleted?: (id: string) => void;
}

const EDIT_INTRO = (name: string) =>
    `This is “${name}”. Tell me what to change — tighten a method step, add or remove a verdict anchor, adjust weights, change the charts — and I'll revise the document. Saving updates your skill in place.`;

/** Copy affordance on assistant messages — quiet until hover, confirms with
    a check instead of a toast so the flow never interrupts. */
function CopyMessageButton({ text }: { text: string }) {
    const [copied, setCopied] = useState(false);
    return (
        <Box
            as="button"
            aria-label={copied ? "Copied" : "Copy message"}
            display="inline-flex"
            alignItems="center"
            gap={1}
            alignSelf="flex-start"
            px={1.5}
            py={0.5}
            border="none"
            bg="transparent"
            cursor="pointer"
            color="var(--ink-tertiary)"
            opacity={0.45}
            _hover={{ opacity: 1, color: "var(--ink-secondary)" }}
            _focusVisible={{ outline: "2px solid var(--accent-primary)", outlineOffset: "2px", opacity: 1 }}
            onClick={async () => {
                try {
                    await navigator.clipboard.writeText(text);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1600);
                } catch { /* clipboard unavailable — the text stays visible */ }
            }}
        >
            {copied ? <LuCheck size={11} color="var(--signal-positive)" /> : <LuCopy size={11} />}
            <Text fontSize="10px" fontFamily="var(--font-mono)">{copied ? "copied" : "copy"}</Text>
        </Box>
    );
}

export default function SkillDraftPane({ onSaved, onCancel, hasWebSearch, skill, onDeleted }: SkillDraftPaneProps) {
    const [messages, setMessages] = useState<{ role: "assistant" | "user"; content: string }[]>(() =>
        skill
            ? [{ role: "assistant" as const, content: EDIT_INTRO(skill.name) }]
            : [{
                role: "assistant" as const,
                content: "Describe the skill you want. What should it analyze, what data does it need, and what should a YES verdict mean? I'll write the full skill document.",
            }],
    );
    const [input, setInput] = useState("");
    const [busy, setBusy] = useState(false);
    const [draft, setDraft] = useState("");
    const [draftName, setDraftName] = useState("");
    const [showDoc, setShowDoc] = useState(false);
    const [webSearch, setWebSearch] = useState(true);
    const [sources, setSources] = useState<{ title: string; url: string }[]>([]);
    const [availableModels, setAvailableModels] = useState<string[]>([]);
    const [selectedModel, setSelectedModel] = useState("");
    const [modelCheck, setModelCheck] = useState<{ state: "idle" | "checking" | "ok" | "failed"; error?: string; retryable?: boolean }>({ state: "idle" });
    const [checkNonce, setCheckNonce] = useState(0);
    const [saved, setSaved] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    // Editing an existing skill: preload its document so the first AI turn
    // revises it rather than starting from zero.
    useEffect(() => {
        if (!skill) return;
        let cancelled = false;
        SkillService.readSkill(skill.id)
            .then((s) => { if (!cancelled && s.markdown) setDraft(s.markdown); })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [skill]);

    // Pre-flight: the Send button stays disabled until the selected model has
    // actually answered — same rule as the analysis page. A rate-limited or
    // unreachable model must be discovered here, not as a failed draft.
    useEffect(() => {
        if (!selectedModel) return;
        let cancelled = false;
        setModelCheck({ state: "checking" });
        const t = setTimeout(async () => {
            try {
                const res = await AnalysisService.validateModel(selectedModel);
                if (!cancelled) setModelCheck(res.valid ? { state: "ok" } : { state: "failed", error: res.error, retryable: (res as any).retryable });
            } catch (e: any) {
                if (!cancelled) setModelCheck({ state: "failed", error: e?.message || "Model check failed", retryable: true });
            }
        }, 400);
        return () => { cancelled = true; clearTimeout(t); };
    }, [selectedModel, checkNonce]);

    const modelReady = modelCheck.state === "ok";

    // Same model-choice rule as the analysis page and the agent builder:
    // users with their own keys pick from those providers; users without keys
    // only see the server-free free-tier models.
    useEffect(() => {
        Promise.all([
            AnalysisService.getAvailableModels(),
            SettingsService.getSettings().catch(() => ({ llm_keys: {} })),
        ])
            .then(([modelsData, settings]) => {
                const allModels = Array.isArray(modelsData) ? modelsData : [];
                const userProviders = Object.keys(settings?.llm_keys || {}).filter((k) => k !== "tavily");
                const models = userProviders.length > 0
                    ? allModels.filter((m: string) => {
                        const provider = m.split("/")[0];
                        return provider === "ollama" || userProviders.includes(provider);
                    })
                    : allModels.filter((m: string) => isServerFreeModel(m));
                setAvailableModels(models);
                setSelectedModel((prev) => {
                    if (prev && models.includes(prev)) return prev;
                    return models[0] || "";
                });
            })
            .catch(() => {});
    }, []);

    const scrollDown = () => {
        requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }));
    };

    const send = async () => {
        const text = input.trim();
        if (!text || busy || !modelReady) return;
        const next = [...messages, { role: "user" as const, content: text }];
        setMessages(next);
        setInput("");
        setBusy(true);
        setSaved(false);
        scrollDown();
        try {
            const res = await SkillService.draftSkill({
                messages: next,
                requirements: text,
                current_draft: draft,
                web_search: webSearch,
                model_id: selectedModel || undefined,
            });
            setSources(res.search_results || []);
            setMessages([...next, { role: "assistant", content: res.message }]);
            if (res.valid && res.skill_markdown) {
                setDraft(res.skill_markdown);
                setDraftName(res.skill_markdown.match(/^name:\s*(.+)$/m)?.[1]?.trim() || "");
            }
        } catch (e: any) {
            // Prefer the server's classified message (modelcheck names the real
            // problem: bad key, exhausted quota, outage) over axios's generic
            // "status code 502".
            const serverMsg = e?.response?.data?.error;
            const msg = serverMsg || e?.message || String(e);
            setMessages([...next, {
                role: "assistant",
                content: msg.includes("status code")
                    ? `Draft failed: the model didn't respond in time. Check that your API keys are set in Settings, then try again.`
                    : `Draft failed: ${msg}`,
            }]);
            // The pre-flight check may have gone stale (e.g. a rate limit just
            // tripped) — re-verify before the next send.
            setCheckNonce((n) => n + 1);
        } finally {
            setBusy(false);
            scrollDown();
        }
    };

    const save = async () => {
        if (!draft || busy) return;
        setBusy(true);
        try {
            const { skill: savedSkill } = await SkillService.saveSkill(draft);
            setSaved(true);
            onSaved(savedSkill);
        } catch (e: any) {
            const issues = e?.response?.data?.issues;
            setMessages((m) => [
                ...m,
                {
                    role: "assistant",
                    content: issues?.length
                        ? `Validation failed:\n${issues.map((i: any) => `- ${i.message}`).join("\n")}`
                        : `Save failed: ${e?.message || e}`,
                },
            ]);
        } finally {
            setBusy(false);
            scrollDown();
        }
    };

    return (
        <Flex direction="column" h="full" minH={0}>
            {/* Header: title + model row + back */}
            <Box flexShrink={0}>
                <Flex align="center" justify="space-between" gap={2} wrap="wrap">
                    <Text fontSize="16px" fontWeight={600} color="var(--ink-primary)">
                        {skill ? `Edit “${skill.name}” with AI` : "Draft a skill with AI"}
                    </Text>
                    <Button size="xs" variant="ghost" onClick={onCancel}>← Back to library</Button>
                </Flex>

                {availableModels.length > 0 && (
                    <Flex align="center" gap={2} mt={2}>
                        <Text fontSize="10.5px" fontWeight={500} color="var(--ink-tertiary)" textTransform="uppercase" letterSpacing="0.06em" whiteSpace="nowrap">
                            Model
                        </Text>
                        <select
                            value={selectedModel}
                            onChange={(e) => setSelectedModel(e.target.value)}
                            style={{
                                fontSize: "12px",
                                padding: "4px 24px 4px 8px",
                                borderRadius: "4px",
                                border: "var(--hairline-w) solid var(--hairline)",
                                background: "var(--surface-panel)",
                                color: "var(--ink-primary)",
                                cursor: "pointer",
                                appearance: "none",
                                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236B7280' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
                                backgroundRepeat: "no-repeat",
                                backgroundPosition: "right 6px center",
                                maxWidth: "100%",
                                textOverflow: "ellipsis",
                            }}
                        >
                            {availableModels.map((m) => <option key={m} value={m}>{m}</option>)}
                        </select>
                        {modelCheck.state === "checking" && (
                            <Text fontSize="11px" color="var(--ink-tertiary)">Checking access…</Text>
                        )}
                        {modelCheck.state === "failed" && (
                            <Flex align="center" gap={2}>
                                <Text fontSize="11px" color="var(--signal-negative)" lineClamp={1} title={modelCheck.error}>
                                    {modelCheck.error || "Model unavailable"}
                                </Text>
                                <Text
                                    as="button"
                                    fontSize="11px"
                                    color="var(--accent-primary)"
                                    _hover={{ textDecoration: "underline" }}
                                    onClick={() => setCheckNonce((n) => n + 1)}
                                    flexShrink={0}
                                >
                                    Retry
                                </Text>
                            </Flex>
                        )}
                    </Flex>
                )}

                {hasWebSearch && (
                    <Flex as="label" align="center" gap={2} mt={2} cursor="pointer" userSelect="none">
                        <input
                            type="checkbox"
                            checked={webSearch}
                            onChange={(e) => setWebSearch(e.target.checked)}
                            style={{ accentColor: "var(--accent-primary)" }}
                        />
                        <Text fontSize="12px" color="var(--ink-secondary)">
                            Search the web to ground the skill in the real documented method
                        </Text>
                    </Flex>
                )}
            </Box>

            {/* Conversation */}
            <Flex
                ref={scrollRef as any}
                direction="column"
                gap={2.5}
                flex={1}
                minH={0}
                overflowY="auto"
                pr={1}
                mt={3}
            >
                {messages.map((m, i) => (
                    <Flex key={i} direction="column" gap={0.5}
                        alignSelf={m.role === "user" ? "flex-end" : "flex-start"}
                        maxW="85%"
                        className={m.role === "assistant" ? undefined : "chat-msg"}>
                        <Box
                            className={m.role === "assistant" ? "chat-msg" : undefined}
                            alignSelf={m.role === "user" ? "flex-end" : "flex-start"}
                            bg={m.role === "user" ? "teal.solid" : "var(--surface-recessed)"}
                            color={m.role === "user" ? "white" : "var(--ink-secondary)"}
                            px={3}
                            py={2}
                            borderRadius="4px"
                            maxW="100%"
                            fontSize="13px"
                            lineHeight="relaxed"
                            whiteSpace="pre-wrap"
                        >
                            {m.content}
                        </Box>
                        {m.role === "assistant" && m.content.trim() !== "" && (
                            <CopyMessageButton text={m.content} />
                        )}
                    </Flex>
                ))}
                {busy && !draft && (
                    <Flex alignSelf="flex-start" align="center" gap={1.5} className="chat-msg" px={1}>
                        <Spinner size="sm" color="var(--ink-tertiary)" />
                        <Text fontSize="11.5px" className="quest-run-text" color="var(--ink-tertiary)">
                            {skill ? "Revising the document…" : "Writing the skill…"}
                        </Text>
                    </Flex>
                )}

                {sources.length > 0 && (
                    <Box>
                        <Text fontSize="11px" fontFamily="var(--font-mono)" color="var(--ink-tertiary)" mb={1}>
                            SOURCES CONSULTED
                        </Text>
                        <Flex direction="column" gap={0.5}>
                            {sources.slice(0, 5).map((s, i) => (
                                <a
                                    key={i}
                                    href={s.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{
                                        fontSize: "12px",
                                        color: "var(--accent-primary)",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                    }}
                                >
                                    {s.title || s.url}
                                </a>
                            ))}
                        </Flex>
                    </Box>
                )}

                {draft && (
                    <Box border="var(--hairline-w) solid var(--hairline)" borderRadius="6px" overflow="hidden">
                        <Flex align="center" justify="space-between" px={3} py={2} bg="var(--surface-recessed)">
                            <Text fontSize="12.5px" color="var(--ink-secondary)">
                                Valid draft{draftName ? `: ${draftName}` : ""}
                            </Text>
                            <Button size="xs" variant="ghost" onClick={() => setShowDoc((v) => !v)}>
                                {showDoc ? "Hide" : "Preview"}
                            </Button>
                        </Flex>
                        {showDoc && (
                            <Box
                                as="pre"
                                m={0}
                                p={3}
                                fontSize="11.5px"
                                lineHeight="1.6"
                                fontFamily="var(--font-mono)"
                                color="var(--ink-secondary)"
                                whiteSpace="pre-wrap"
                                wordBreak="break-word"
                                maxH="30vh"
                                overflowY="auto"
                            >
                                {draft}
                            </Box>
                        )}
                    </Box>
                )}

                {saved && (
                    <Box className="chat-msg" alignSelf="flex-start" bg="var(--surface-recessed)" border="var(--hairline-w) solid var(--hairline)" borderRadius="8px" px={3} py={2.5} maxW="85%">
                        <Text fontSize="13px" fontWeight={600} color="var(--signal-positive)" mb={0.5}>
                            ✓ Skill saved
                        </Text>
                        <Text fontSize="12.5px" color="var(--ink-tertiary)">
                            {skill ? "Your changes are live — every agent using this skill now runs the updated version." : "It's in your library and ready to attach to an agent."}
                        </Text>
                        {skill && (
                            <Button
                                size="xs"
                                colorPalette="red"
                                variant="outline"
                                mt={2}
                                onClick={() =>
                                    SkillService.deleteSkill(skill.id).then(() => {
                                        onDeleted?.(skill.id);
                                        onCancel();
                                    })
                                }
                            >
                                Delete “{skill.name}”
                            </Button>
                        )}
                    </Box>
                )}
            </Flex>

            {/* Composer */}
            <Flex direction="column" gap={1.5} pt={3} flexShrink={0}>
                {modelCheck.state === "failed" && (
                    <Text fontSize="11px" color="var(--signal-negative)" lineClamp={2}>
                        {modelCheck.error || "Model unavailable"} — pick another model or retry.
                    </Text>
                )}
                <Flex gap={2} w="full">
                    <Input
                        flex={1}
                        size="sm"
                        placeholder={skill ? "e.g. make the dividend anchor weigh more…" : "e.g. a skill that checks dividend sustainability…"}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && send()}
                    />
                    {draft ? (
                        <Button size="sm" variant="solid" colorPalette="teal" onClick={save} loading={busy} flexShrink={0}>
                            {skill ? "Save changes" : "Save skill"}
                        </Button>
                    ) : (
                        <Button
                            size="sm"
                            variant="solid"
                            colorPalette="teal"
                            onClick={send}
                            loading={busy}
                            flexShrink={0}
                            disabled={!modelReady}
                        >
                            Send
                        </Button>
                    )}
                </Flex>
            </Flex>
        </Flex>
    );
}
