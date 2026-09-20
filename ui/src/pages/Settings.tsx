import { useState, useEffect } from "react";
import {
    Flex, Text, Box, Button, Input, VStack, HStack, Spinner
} from "@chakra-ui/react";
import { MdCheck, MdVisibility, MdVisibilityOff, MdDelete, MdLockOutline } from "react-icons/md";
import { toaster } from "@/components/ui/toaster";
import { SettingsService } from "@/db";
import PageHero from "@/components/PageHero";
import ConfirmDialog from "@/components/ConfirmDialog";
import { motion, AnimatePresence } from "motion/react";
import { dur, ease } from "@/lib/motion";

// One row per provider, whether or not it has a saved key — the list IS the
// settings. Model providers and the web-search provider share the same row
// component, grouped under two labeled headers.
const MODEL_PROVIDERS = [
    { value: "openai", label: "OpenAI" },
    { value: "gemini", label: "Gemini" },
    { value: "cerebras", label: "Cerebras" },
    { value: "groq", label: "Groq" },
    { value: "openrouter", label: "OpenRouter" },
    { value: "anthropic", label: "Anthropic" },
];

interface ProviderRowProps {
    value: string;
    label: string;
    savedKey?: string;
    expanded: boolean;
    onToggle: () => void;
    onSave: (value: string, key: string) => Promise<void>;
    onRemove: (value: string) => Promise<void>;
}

/**
 * One provider row. Collapsed: name + status pill + masked key.
 * Expanded: an EMPTY input (never the mask — a masked value can never be
 * accidentally re-submitted), Save/Cancel, and Remove when a key exists.
 */
function ProviderRow({ value, label, savedKey, expanded, onToggle, onSave, onRemove }: ProviderRowProps) {
    const [draft, setDraft] = useState("");
    const [showKey, setShowKey] = useState(false);
    const [busy, setBusy] = useState(false);
    const [confirmRemove, setConfirmRemove] = useState(false);

    useEffect(() => {
        if (!expanded) {
            setDraft("");
            setShowKey(false);
            setConfirmRemove(false);
        }
    }, [expanded]);

    const connected = !!savedKey;
    const masked = savedKey || "";

    const handleSave = async () => {
        if (!draft.trim()) {
            toaster.create({ title: "API key is empty", type: "error" });
            return;
        }
        setBusy(true);
        try {
            await onSave(value, draft.trim());
            setDraft("");
            onToggle(); // collapse on success
        } finally {
            setBusy(false);
        }
    };

    const handleRemove = async () => {
        setBusy(true);
        try {
            await onRemove(value);
            setConfirmRemove(false);
        } finally {
            setBusy(false);
        }
    };

    return (
        <Box borderBottom="1px solid var(--hairline)" _last={{ borderBottom: "none" }}>
            {/* Collapsed summary — the whole row is the toggle */}
            <Flex
                as="button"
                type="button"
                onClick={onToggle}
                align="center"
                gap={3}
                w="full"
                py={3}
                minH="44px"
                textAlign="left"
                cursor="pointer"
                aria-expanded={expanded}
            >
                <Text fontSize="13.5px" fontWeight={500} color="var(--ink-primary)" minW="110px" flexShrink={0}>
                    {label}
                </Text>
                <Flex
                    align="center"
                    gap={1.5}
                    px={2}
                    py={0.5}
                    borderRadius="full"
                    flexShrink={0}
                    bg={connected ? "color-mix(in srgb, var(--signal-positive) 12%, transparent)" : "var(--surface-recessed)"}
                >
                    <Box
                        w="6px"
                        h="6px"
                        borderRadius="full"
                        bg={connected ? "var(--signal-positive)" : "var(--ink-tertiary)"}
                    />
                    <Text fontSize="11px" fontWeight={500} color={connected ? "var(--signal-positive)" : "var(--ink-tertiary)"}>
                        {connected ? "Connected" : "Not connected"}
                    </Text>
                </Flex>
                {connected && (
                    <Text
                        fontSize="12px"
                        fontFamily="var(--font-mono)"
                        color="var(--ink-tertiary)"
                        overflow="hidden"
                        textOverflow="ellipsis"
                        whiteSpace="nowrap"
                        display={{ base: "none", sm: "block" }}
                    >
                        {masked}
                    </Text>
                )}
                <Box flex={1} />
                <Text fontSize="11px" color="var(--accent-primary)" fontWeight={500} flexShrink={0}>
                    {expanded ? "Close" : connected ? "Change" : "Add"}
                </Text>
            </Flex>

            {/* Expanded editor */}
            <AnimatePresence initial={false}>
                {expanded && (
                    <Box
                        as={motion.div}
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: dur.base, ease }}
                        overflow="hidden"
                    >
                        <Box pb={4} pl={{ base: 0, sm: 0 }}>
                            {confirmRemove ? (
                                <Flex
                                    align="center"
                                    gap={2}
                                    flexWrap="wrap"
                                    p={3}
                                    border="1px solid color-mix(in srgb, var(--signal-negative) 35%, transparent)"
                                    borderRadius="2px"
                                    bg="color-mix(in srgb, var(--signal-negative) 6%, transparent)"
                                >
                                    <Text fontSize="12.5px" color="var(--ink-primary)" flex="1 1 200px">
                                        Remove the {label} key? Analyses will stop using it immediately.
                                    </Text>
                                    <Button
                                        size="sm"
                                        variant="surface"
                                        colorPalette="red"
                                        minH="36px"
                                        onClick={handleRemove}
                                        disabled={busy}
                                    >
                                        {busy ? <Spinner size="sm" borderWidth="2px" /> : "Confirm remove"}
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="subtle"
                                        minH="36px"
                                        color="var(--ink-secondary)"
                                        onClick={() => setConfirmRemove(false)}
                                        disabled={busy}
                                    >
                                        Cancel
                                    </Button>
                                </Flex>
                            ) : (
                                <VStack gap={3} align="stretch">
                                    <HStack gap={2} align="center" flexWrap={{ base: "wrap", sm: "nowrap" }}>
                                        <Input
                                            type={showKey ? "text" : "password"}
                                            placeholder={connected ? `Type a new ${label} key to replace the saved one` : `Paste your ${label} API key`}
                                            value={draft}
                                            onChange={(e) => setDraft(e.target.value)}
                                            flex="1 1 220px"
                            minH="44px"
                                            borderColor="var(--hairline)"
                                            borderRadius="2px"
                                            _focus={{ borderColor: "var(--accent-primary)" }}
                                            onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
                                        />
                                        <Button
                                            variant="subtle"
                                            aria-label={showKey ? "Hide key" : "Show key"}
                                            minW="44px"
                                            minH="44px"
                                            p={0}
                                            color="var(--ink-tertiary)"
                                            _hover={{ color: "var(--ink-primary)" }}
                                            onClick={() => setShowKey((v) => !v)}
                                        >
                                            {showKey ? <MdVisibilityOff size={18} /> : <MdVisibility size={18} />}
                                        </Button>
                                    </HStack>
                                    <Flex align="center" gap={2} flexWrap="wrap">
                                        <Button
                                            as={motion.button}
                                            whileTap={{ scale: 0.97 }}
                                            size="sm"
                                            minH="36px"
                                            variant="surface"
                                            colorPalette="blue"
                                            px={4}
                                            onClick={handleSave}
                                            disabled={busy || !draft.trim()}
                                        >
                                            {busy ? <Spinner size="sm" borderWidth="2px" /> : <><MdCheck size={14} style={{ marginRight: 4 }} />Save key</>}
                                        </Button>
                                        <Button
                                            size="sm"
                                            minH="36px"
                                            variant="subtle"
                                            color="var(--ink-secondary)"
                                            onClick={onToggle}
                                            disabled={busy}
                                        >
                                            Cancel
                                        </Button>
                                        {connected && (
                                            <Button
                                                size="sm"
                                                minH="36px"
                                                variant="subtle"
                                                color="var(--ink-tertiary)"
                                                _hover={{ color: "var(--signal-negative)" }}
                                                onClick={() => setConfirmRemove(true)}
                                                disabled={busy}
                                                ml="auto"
                                            >
                                                <MdDelete size={14} style={{ marginRight: 4 }} />
                                                Remove
                                            </Button>
                                        )}
                                    </Flex>
                                </VStack>
                            )}
                        </Box>
                    </Box>
                )}
            </AnimatePresence>
        </Box>
    );
}

function GroupHeader({ title, purpose }: { title: string; purpose: string }) {
    return (
        <Box mb={2} mt={1}>
            <Text
                fontSize="10.5px"
                fontWeight={500}
                color="var(--ink-tertiary)"
                textTransform="uppercase"
                letterSpacing="0.06em"
            >
                {title}
            </Text>
            <Text fontSize="12px" color="var(--ink-tertiary)" mt={0.5}>
                {purpose}
            </Text>
        </Box>
    );
}

function ListSkeleton() {
    return (
        <VStack gap={0} align="stretch">
            {[0, 1, 2, 3].map((i) => (
                <Flex key={i} align="center" gap={3} py={3} borderBottom="1px solid var(--hairline)">
                    <Box h="13px" w="110px" borderRadius="2px" bg="var(--surface-recessed)" />
                    <Box h="18px" w="90px" borderRadius="full" bg="var(--surface-recessed)" />
                </Flex>
            ))}
        </VStack>
    );
}

export default function Settings() {
    const [savedKeys, setSavedKeys] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);
    const [expandedRow, setExpandedRow] = useState<string | null>(null);
    const [confirmClearAll, setConfirmClearAll] = useState(false);
    const [clearing, setClearing] = useState(false);

    useEffect(() => {
        SettingsService.getSettings()
            .then((data) => {
                setSavedKeys({ ...(data.llm_keys || {}) });
            })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    const handleSaveKey = async (provider: string, key: string) => {
        try {
            await SettingsService.updateSettings({ llm_keys: { [provider]: key } });
            setSavedKeys((prev) => ({ ...prev, [provider]: key }));
            const label = provider === "tavily" ? "Tavily" : MODEL_PROVIDERS.find((p) => p.value === provider)?.label || provider;
            toaster.create({ title: `${label} API key saved`, type: "success" });
        } catch (e: any) {
            toaster.create({ title: `Failed to save: ${e.message}`, type: "error" });
        }
    };

    const handleRemoveKey = async (keyName: string) => {
        try {
            await SettingsService.deleteLLMKey(keyName);
            setSavedKeys((prev) => {
                const next = { ...prev };
                delete next[keyName];
                return next;
            });
            const label = keyName === "tavily" ? "Tavily" : MODEL_PROVIDERS.find((p) => p.value === keyName)?.label || keyName;
            toaster.create({ title: `${label} key removed`, type: "info" });
        } catch (e: any) {
            toaster.create({ title: `Failed to remove: ${e.message}`, type: "error" });
        }
    };

    const handleClearAll = async () => {
        setClearing(true);
        try {
            await SettingsService.updateSettings({ llm_keys: null });
            setSavedKeys({});
            setExpandedRow(null);
            setConfirmClearAll(false);
            toaster.create({ title: "All API keys removed", type: "info" });
        } catch (e: any) {
            toaster.create({ title: `Failed to remove keys: ${e.message}`, type: "error" });
        } finally {
            setClearing(false);
        }
    };

    const hasSavedKeys = Object.keys(savedKeys).length > 0;
    const connectedCount = Object.keys(savedKeys).length;

    return (
        <Box bg="var(--surface-canvas)" minH="100%">
            <Flex direction="column" gap={6} maxW="1240px" mx="auto" py={6}>
                {/* Header */}
                <PageHero>
                    <Flex justify="space-between" align={{ base: "flex-start", md: "flex-end" }} gap={3}>
                        <Flex direction="column" gap={1}>
                            <Text fontSize="22px" fontWeight={600} color="var(--ink-primary)">
                                Settings
                            </Text>
                            <Text fontSize="13px" color="var(--ink-secondary)">
                                Manage the API keys used to run analyses. Optional — skip them to run on our servers with the default model.
                            </Text>
                        </Flex>
                        <Text
                            fontSize="11.5px"
                            fontFamily="var(--font-mono)"
                            color="var(--ink-tertiary)"
                            whiteSpace="nowrap"
                        >
                            {connectedCount} KEY{connectedCount === 1 ? "" : "S"} STORED
                        </Text>
                    </Flex>
                </PageHero>

                {/* Unified key list */}
                <Box
                    as={motion.div}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: dur.base, ease }}
                    bg="var(--surface-panel)"
                    border="1px solid var(--hairline)"
                    borderRadius="2px"
                    p={{ base: 4, md: 6 }}
                >
                    <Flex align="center" gap={2} mb={4}>
                        <MdLockOutline size={14} color="var(--ink-tertiary)" />
                        <Text fontSize="12px" color="var(--ink-tertiary)">
                            Keys are stored securely on the server, encrypted at rest. Never exposed in the browser.
                        </Text>
                    </Flex>

                    {loading ? (
                        <ListSkeleton />
                    ) : (
                        <>
                            <GroupHeader
                                title="Model Providers"
                                purpose="Keys here become available as model choices when starting an analysis."
                            />
                            <VStack gap={0} align="stretch" mb={6}>
                                {MODEL_PROVIDERS.map((p) => (
                                    <ProviderRow
                                        key={p.value}
                                        value={p.value}
                                        label={p.label}
                                        savedKey={savedKeys[p.value]}
                                        expanded={expandedRow === p.value}
                                        onToggle={() => setExpandedRow((cur) => (cur === p.value ? null : p.value))}
                                        onSave={handleSaveKey}
                                        onRemove={handleRemoveKey}
                                    />
                                ))}
                            </VStack>

                            <GroupHeader
                                title="Web Search"
                                purpose="Powers the optional web-search step during analysis."
                            />
                            <VStack gap={0} align="stretch" mb={hasSavedKeys ? 6 : 0}>
                                <ProviderRow
                                    value="tavily"
                                    label="Tavily"
                                    savedKey={savedKeys.tavily}
                                    expanded={expandedRow === "tavily"}
                                    onToggle={() => setExpandedRow((cur) => (cur === "tavily" ? null : "tavily"))}
                                    onSave={handleSaveKey}
                                    onRemove={handleRemoveKey}
                                />
                            </VStack>

                            {hasSavedKeys && (
                                <Flex justify="flex-end" pt={4} mt={2} borderTop="1px solid var(--hairline)">
                                    <Button
                                        size="sm"
                                        minH="36px"
                                        variant="subtle"
                                        color="var(--ink-tertiary)"
                                        _hover={{ color: "var(--signal-negative)" }}
                                        onClick={() => setConfirmClearAll(true)}
                                        disabled={clearing}
                                    >
                                        <MdDelete size={14} style={{ marginRight: 4 }} />
                                        Remove all keys
                                    </Button>
                                </Flex>
                            )}
                        </>
                    )}
                </Box>
            </Flex>

            <ConfirmDialog
                open={confirmClearAll}
                title="Remove all API keys?"
                message="Every saved provider and web-search key will be deleted. You can re-add them any time, but running analyses will lose access immediately."
                confirmLabel="Remove all"
                onCancel={() => setConfirmClearAll(false)}
                onConfirm={handleClearAll}
            />
        </Box>
    );
}
