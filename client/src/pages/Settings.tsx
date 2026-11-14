import { useState, useEffect } from "react";
import {
    Flex, Text, Box, Button, Input, VStack, InputGroup, Spinner
} from "@chakra-ui/react";
import { Check, Eye, EyeOff, X, Trash2, Plus, Pencil, ExternalLink, Lock, Sun, Moon } from "lucide-react";
import { toaster } from "@/components/ui/toaster";
import { SettingsService } from "@/db";
import { useAuth } from "@/auth/useAuth";
import { useColorMode } from "@/components/ui/color-mode";
import UserAvatar from "@/components/shared/UserAvatar";
import { ModelLogo } from "@/lib/modelLogos";
import { motion, AnimatePresence } from "motion/react";
import { dur, ease } from "@/lib/motion";

// One card per provider. Every provider the backend can actually route a model
// to is listed here — model_id -> provider is a fixed map server-side, so a
// free-text "custom provider" would be stored but never used.
const MODEL_PROVIDERS = [
    { value: "openai", label: "OpenAI", url: "https://platform.openai.com/api-keys" },
    { value: "gemini", label: "Gemini", url: "https://aistudio.google.com/apikey" },
    { value: "cerebras", label: "Cerebras", url: "https://cloud.cerebras.ai" },
    { value: "groq", label: "Groq", url: "https://console.groq.com/keys" },
    { value: "openrouter", label: "OpenRouter", url: "https://openrouter.ai/keys" },
    { value: "anthropic", label: "Anthropic", url: "https://console.anthropic.com/settings/keys" },
    { value: "mistral", label: "Mistral", url: "https://console.mistral.ai/api-keys" },
    { value: "nvidia", label: "NVIDIA", url: "https://build.nvidia.com/settings/api-keys" },
    { value: "cohere", label: "Cohere", url: "https://dashboard.cohere.com/api-keys" },
    { value: "zai", label: "Z.ai", url: "https://z.ai/manage-apikey/apikey-list" },
];

const providerLabel = (value: string) =>
    value === "tavily" ? "Tavily" : MODEL_PROVIDERS.find((p) => p.value === value)?.label || value;

function StatusPill({ connected }: { connected: boolean }) {
    return (
        <Flex
            align="center"
            gap={1.5}
            px={2}
            py={0.5}
            borderRadius="full"
            flexShrink={0}
            alignSelf="flex-start"
            bg={connected ? "color-mix(in srgb, var(--signal-positive) 12%, transparent)" : "var(--surface-recessed)"}
        >
            <Box
                w="6px"
                h="6px"
                borderRadius="full"
                bg={connected ? "var(--signal-positive)" : "var(--ink-tertiary)"}
            />
            <Text fontSize="10.5px" color={connected ? "var(--signal-positive)" : "var(--ink-tertiary)"}>
                {connected ? "Connected" : "Not connected"}
            </Text>
        </Flex>
    );
}

interface ProviderCardProps {
    value: string;
    label: string;
    /** Where to get an API key for this provider — shown as a subtle icon link. */
    url?: string;
    savedKey?: string;
    expanded: boolean;
    onToggle: () => void;
    onSave: (value: string, key: string) => Promise<void>;
    onRemove: (value: string) => Promise<void>;
}

/**
 * One provider card. Collapsed: logo + name + status.
 * Expanded: an EMPTY input (never a saved value), Save/Cancel, and Remove when a key exists.
 */
function ProviderCard({ value, label, url, savedKey, expanded, onToggle, onSave, onRemove }: ProviderCardProps) {
    const [draft, setDraft] = useState("");
    const [showKey, setShowKey] = useState(false);
    const [busy, setBusy] = useState(false);
    const [confirmRemove, setConfirmRemove] = useState(false);

    const connected = !!savedKey;

    // Clearing a half-typed draft happens on close rather than in an effect.
    const reset = () => {
        setDraft("");
        setShowKey(false);
        setConfirmRemove(false);
    };
    const close = () => {
        reset();
        onToggle();
    };
    const handleHeaderClick = () => {
        if (expanded) close();
        else onToggle();
    };

    const handleSave = async () => {
        if (!draft.trim()) {
            toaster.create({ title: "API key is empty", type: "error" });
            return;
        }
        setBusy(true);
        try {
            await onSave(value, draft.trim());
            close(); // collapse on success
        } finally {
            setBusy(false);
        }
    };

    const handleRemove = async () => {
        setBusy(true);
        try {
            await onRemove(value);
            close();
        } finally {
            setBusy(false);
        }
    };

    return (
        <Box
            as={motion.div}
            layout
            transition={{ duration: dur.fast, ease }}
            alignSelf="start"
            w="full"
        >
            {/* Header — the whole block toggles the editor */}
            <Flex
                as="button"
                type="button"
                onClick={handleHeaderClick}
                align="center"
                gap={3}
                w="100%"
                textAlign="left"
                cursor="pointer"
                aria-expanded={expanded}
            >
                <Flex w="24px" justify="center" flexShrink={0}>
                    <ModelLogo model={value} size={20} />
                </Flex>
                <Box flex={1} minW={0}>
                    <Flex align="center" gap={1.5} minW={0}>
                        <Text fontSize="13.5px" color="var(--ink-primary)" noOfLines={1}>
                            {label}
                        </Text>
                        {url && (
                            <a
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={`Get your ${label} API key`}
                                aria-label={`Get your ${label} API key`}
                                onClick={(e) => e.stopPropagation()}
                                style={{ display: "flex", color: "var(--ink-tertiary)", flexShrink: 0 }}
                            >
                                <ExternalLink size={13} />
                            </a>
                        )}
                    </Flex>
                    <Box mt={1}>
                        <StatusPill connected={connected} />
                    </Box>
                </Box>
                <Box
                    as="span"
                    display="inline-flex"
                    align="center"
                    gap={1}
                    flexShrink={0}
                    px={2}
                    py={1}
                    borderRadius="2px"
                    fontSize="11.5px"
                    color="var(--accent-primary)"
                    _hover={{ bg: "var(--surface-recessed)" }}
                >
                    {expanded ? <X size={13} /> : connected ? <Pencil size={13} /> : <Plus size={13} />}
                    {expanded ? "Close" : connected ? "Change" : "Add"}
                </Box>
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
                        <Box pt={3}>
                            {confirmRemove ? (
                                <VStack
                                    align="stretch"
                                    gap={2}
                                    p={3}
                                    border="1px solid color-mix(in srgb, var(--signal-negative) 35%, transparent)"
                                    borderRadius="2px"
                                    bg="color-mix(in srgb, var(--signal-negative) 6%, transparent)"
                                >
                                    <Text fontSize="12.5px" color="var(--ink-primary)">
                                        Remove the {label} key? Analyses will stop using it immediately.
                                    </Text>
                                    <Flex gap={2}>
                                        <Button
                                            variant="surface"
                                            colorPalette="red"
                                            flex={1}
                                            borderRadius="full"
                                            onClick={handleRemove}
                                            disabled={busy}
                                        >
                                            {busy ? <Spinner size="sm" borderWidth="2px" /> : <><Trash2 size={16} /> Confirm remove</>}
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            color="var(--ink-secondary)"
                                            borderRadius="full"
                                            px={4}
                                            onClick={() => setConfirmRemove(false)}
                                            disabled={busy}
                                        >
                                            <X size={16} /> Cancel
                                        </Button>
                                    </Flex>
                                </VStack>
                            ) : (
                                <VStack gap={2.5} align="stretch">
                                    <InputGroup
                                        endElement={
                                            <Button
                                                variant="ghost"
                                                aria-label={showKey ? "Hide key" : "Show key"}
                                                color="var(--ink-tertiary)"
                                                borderRadius="full"
                                                _hover={{ color: "var(--ink-primary)" }}
                                                onClick={() => setShowKey((v) => !v)}
                                            >
                                                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                                            </Button>
                                        }
                                        endElementProps={{ px: "4px" }}
                                    >
                                        <Input
                                            type={showKey ? "text" : "password"}
                                            placeholder={connected ? `New ${label} key to replace the saved one` : `Paste your ${label} API key`}
                                            value={draft}
                                            onChange={(e) => setDraft(e.target.value)}
                                            minH="40px"
                                            borderColor="var(--hairline)"
                                            borderRadius="2px"
                                            _focus={{ borderColor: "var(--accent-primary)" }}
                                            onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
                                        />
                                    </InputGroup>
                                    <Flex align="center" gap={2}>
                                        <Button
                                            as={motion.button}
                                            whileTap={{ scale: 0.97 }}
                                            variant="surface"
                                            colorPalette="blue"
                                            borderRadius="full"
                                            px={4}
                                            onClick={handleSave}
                                            disabled={busy || !draft.trim()}
                                        >
                                            {busy ? <Spinner size="sm" borderWidth="2px" /> : <><Check size={16} /> Save key</>}
                                        </Button>
                                        <Button variant="ghost" color="var(--ink-secondary)" borderRadius="full" px={4} onClick={close} disabled={busy}>
                                            <X size={16} /> Cancel
                                        </Button>
                                        {connected && (
                                            <Button
                                                variant="ghost"
                                                color="var(--ink-tertiary)"
                                                _hover={{ color: "var(--signal-negative)" }}
                                                onClick={() => setConfirmRemove(true)}
                                                disabled={busy}
                                                borderRadius="full"
                                                px={4}
                                                ml="auto"
                                            >
                                                <Trash2 size={16} /> Remove
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

function SectionCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
    return (
        <Box
            as={motion.div}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: dur.base, ease }}
            p={{ base: 4, md: 5 }}
        >
            <Text fontSize="13.5px" color="var(--ink-primary)">{title}</Text>
            {subtitle && <Text fontSize="12px" color="var(--ink-tertiary)" mt={0.5}>{subtitle}</Text>}
            <Box mt={4}>{children}</Box>
        </Box>
    );
}

function GridSkeleton() {
    return (
        <Box display="grid" gridTemplateColumns={{ base: "1fr", sm: "repeat(2, 1fr)", xl: "repeat(3, 1fr)" }} gap={5}>
            {[0, 1, 2, 3, 4, 5].map((i) => (
                <Box key={i} h="96px">
                    <Flex gap={3} align="center">
                        <Box boxSize="34px" borderRadius="2px" bg="var(--surface-recessed)" />
                        <Box h="13px" w="90px" borderRadius="2px" bg="var(--surface-recessed)" />
                    </Flex>
                </Box>
            ))}
        </Box>
    );
}

function GroupHeader({ title, purpose }: { title: string; purpose: string }) {
    return (
        <Box mb={3} mt={1}>
            <Text
                fontSize="10.5px"
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

export default function Settings() {
    const { user } = useAuth();
    const { colorMode, setColorMode } = useColorMode();
    const [savedKeys, setSavedKeys] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);
    const [expandedRow, setExpandedRow] = useState<string | null>(null);

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
            toaster.create({ title: `${providerLabel(provider)} API key saved`, type: "success" });
        } catch (e) {
            toaster.create({ title: `Failed to save: ${(e as Error).message}`, type: "error" });
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
            toaster.create({ title: `${providerLabel(keyName)} key removed`, type: "info" });
        } catch (e) {
            toaster.create({ title: `Failed to remove: ${(e as Error).message}`, type: "error" });
        }
    };

    const email = user?.email ?? "";
    const displayName =
        (user?.user_metadata?.name as string | undefined) ??
        (user?.user_metadata?.full_name as string | undefined) ??
        email.split("@")[0] ??
        "User";
    const createdAt = user?.created_at;
    const memberSince = createdAt
        ? new Date(createdAt).toLocaleDateString(undefined, { month: "short", year: "numeric" })
        : null;
    const lastSignIn = user?.last_sign_in_at;
    const lastSignInLabel = lastSignIn
        ? new Date(lastSignIn).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
        : "—";

    const connectedCount = Object.keys(savedKeys).length;
    const isDark = colorMode === "dark";

    const metaRow = (label: string, value: React.ReactNode) => (
        <Flex justify="space-between" gap={3} align="center" py={2} borderBottom="1px solid var(--hairline)" _last={{ borderBottom: "none" }}>
            <Text fontSize="12px" color="var(--ink-tertiary)" flexShrink={0}>{label}</Text>
            <Text fontSize="12px" color="var(--ink-secondary)" fontFamily="var(--font-mono)" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
                {value}
            </Text>
        </Flex>
    );

    return (
        <Box bg="var(--surface-canvas)" minH="100%">
            <Flex direction="column" gap={6} w="full" px={{ base: 4, md: 8 }} py={6}>
                {/* Header — flat masthead, same title/subtitle treatment as the Runs and New Run pages */}
                <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 px-0.5">
                    <h1 className="font-app-display min-w-0 text-[26px] leading-[1.1] font-normal tracking-[-0.02em] text-[var(--ink-primary)] md:text-[30px]">
                        Settings
                    </h1>
                    <Text fontSize="11.5px" color="var(--ink-tertiary)" whiteSpace="nowrap">
                        {connectedCount} KEY{connectedCount === 1 ? "" : "S"} STORED
                    </Text>
                </header>

                {/* Two-column: account rail on the left, keys on the right */}
                <Box display="grid" gridTemplateColumns={{ base: "1fr", lg: "minmax(280px, 340px) 1fr" }} gap={6} alignItems="start">
                    {/* LEFT RAIL */}
                    <VStack gap={6} align="stretch">
                        <SectionCard title="Account">
                            <Flex align="center" gap={4}>
                                <Box border="1px solid var(--hairline)" borderRadius="2px" overflow="hidden" flexShrink={0}>
                                    <UserAvatar seed={email || displayName} size={{ base: 52, md: 60 }} />
                                </Box>
                                <Box minW={0}>
                                    <Text fontSize="15px" color="var(--ink-primary)" noOfLines={1}>
                                        {displayName}
                                    </Text>
                                    <Text fontSize="12.5px" color="var(--ink-tertiary)" noOfLines={1}>{email}</Text>
                                    {memberSince && (
                                        <Text fontSize="11.5px" color="var(--ink-tertiary)" mt={1}>Member since {memberSince}</Text>
                                    )}
                                </Box>
                            </Flex>
                            <Box mt={4}>
                                {metaRow("Last sign-in", lastSignInLabel)}
                            </Box>
                        </SectionCard>

                        <SectionCard title="Appearance" subtitle="Choose how Relativity looks on this device.">
                            <Flex gap={1} p={1} bg="var(--surface-recessed)" borderRadius="2px">
                                {[
                                    { v: "light" as const, icon: Sun, label: "Light" },
                                    { v: "dark" as const, icon: Moon, label: "Dark" },
                                ].map((opt) => {
                                    const active = (opt.v === "dark") === isDark;
                                    return (
                                        <Flex
                                            key={opt.v}
                                            as="button"
                                            type="button"
                                            onClick={() => setColorMode(opt.v)}
                                            align="center"
                                            justify="center"
                                            gap={2}
                                            flex={1}
                                            py={2}
                                            borderRadius="2px"
                                            cursor="pointer"
                                            aria-pressed={active}
                                            bg={active ? "var(--surface-panel)" : "transparent"}
                                            boxShadow={active ? "0 1px 2px rgba(0,0,0,0.08)" : "none"}
                                        >
                                            <opt.icon size={14} color={active ? "var(--accent-primary)" : "var(--ink-tertiary)"} />
                                            <Text fontSize="12.5px" color={active ? "var(--ink-primary)" : "var(--ink-tertiary)"}>
                                                {opt.label}
                                            </Text>
                                        </Flex>
                                    );
                                })}
                            </Flex>
                        </SectionCard>

                        <SectionCard title="Subscription">
                            <Flex align="center" justify="space-between" gap={3}>
                                <Text fontSize="15px" color="var(--ink-primary)">Free</Text>
                                <Flex align="center" gap={1.5} px={2} py={0.5} borderRadius="full" bg="var(--surface-recessed)">
                                    <Box w="6px" h="6px" borderRadius="full" bg="var(--ink-tertiary)" />
                                    <Text fontSize="10.5px" color="var(--ink-tertiary)">Current plan</Text>
                                </Flex>
                            </Flex>
                            <Text fontSize="12px" color="var(--ink-tertiary)" mt={2}>
                                Billing and plan upgrades are under development. You'll be able to manage your subscription here soon.
                            </Text>
                            <Button mt={4} size="sm" minH="36px" variant="subtle" color="var(--ink-tertiary)" borderRadius="full" disabled width="full">
                                <Lock size={14} /> Manage plan · coming soon
                            </Button>
                        </SectionCard>
                    </VStack>

                    {/* RIGHT MAIN — API keys */}
                    <Box
                        as={motion.div}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: dur.base, ease }}
                        p={{ base: 4, md: 6 }}
                    >
                        <Flex align="center" gap={2} mb={5}>
                            <Lock size={14} color="var(--ink-tertiary)" />
                            <Text fontSize="12px" color="var(--ink-tertiary)">
                                Keys are stored securely on the server, encrypted at rest. Never exposed in the browser.
                            </Text>
                        </Flex>

                        {loading ? (
                            <GridSkeleton />
                        ) : (
                            <>
                                <GroupHeader
                                    title="Model Providers"
                                    purpose="Keys here become available as model choices when starting an analysis."
                                />
                                <Box display="grid" gridTemplateColumns={{ base: "1fr", sm: "repeat(2, 1fr)", xl: "repeat(3, 1fr)" }} gap={5} mb={8} alignItems="start">
                                    {MODEL_PROVIDERS.map((p) => (
                                        <ProviderCard
                                            key={p.value}
                                            value={p.value}
                                            label={p.label}
                                            url={p.url}
                                            savedKey={savedKeys[p.value]}
                                            expanded={expandedRow === p.value}
                                            onToggle={() => setExpandedRow((cur) => (cur === p.value ? null : p.value))}
                                            onSave={handleSaveKey}
                                            onRemove={handleRemoveKey}
                                        />
                                    ))}
                                </Box>

                                <GroupHeader
                                    title="Web Search"
                                    purpose="Powers the optional web-search step during analysis."
                                />
                                <Box display="grid" gridTemplateColumns={{ base: "1fr", sm: "repeat(2, 1fr)", xl: "repeat(3, 1fr)" }} gap={5} alignItems="start">
                                    <ProviderCard
                                        value="tavily"
                                        label="Tavily"
                                        url="https://app.tavily.com"
                                        savedKey={savedKeys.tavily}
                                        expanded={expandedRow === "tavily"}
                                        onToggle={() => setExpandedRow((cur) => (cur === "tavily" ? null : "tavily"))}
                                        onSave={handleSaveKey}
                                        onRemove={handleRemoveKey}
                                    />
                                </Box>
                            </>
                        )}
                    </Box>
                </Box>
            </Flex>
        </Box>
    );
}
