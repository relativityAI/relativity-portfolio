import { useState, useEffect } from "react";
import {
    Flex, Text, Box, Button, Input, VStack, HStack, Field, Spinner,
    createListCollection, Select, Portal
} from "@chakra-ui/react";
import { MdCheck, MdClose, MdVisibility, MdVisibilityOff, MdWeb, MdDelete } from "react-icons/md";
import { toaster } from "@/components/ui/toaster";
import { SettingsService } from "@/db";
import { motion, AnimatePresence } from "motion/react";
import { dur, ease } from "@/lib/motion";

const providerOptions = createListCollection({
    items: [
        { label: "OpenAI", value: "openai" },
        { label: "Gemini", value: "gemini" },
        { label: "Cerebras", value: "cerebras" },
        { label: "Groq", value: "groq" },
        { label: "OpenRouter", value: "openrouter" },
        { label: "Anthropic", value: "anthropic" },
    ],
    itemToString: (item: any) => item.label,
    itemToValue: (item: any) => item.value,
});

export default function Settings() {
    const [provider, setProvider] = useState("openai");
    const [apiKey, setApiKey] = useState("");
    const [savedKeys, setSavedKeys] = useState<Record<string, string>>({});
    const [showKey, setShowKey] = useState(false);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState<string | null>(null);

    const [tavilyKey, setTavilyKey] = useState("");
    const [showTavily, setShowTavily] = useState(false);

    useEffect(() => {
        SettingsService.getSettings()
            .then((data) => {
                if (data.llm_keys) {
                    const allKeys: Record<string, string> = {};
                    for (const [k, v] of Object.entries(data.llm_keys)) {
                        allKeys[k] = v;
                    }
                    setSavedKeys(allKeys);
                    // Set the first available key as current
                    const firstKey = Object.entries(data.llm_keys)[0];
                    if (firstKey) {
                        setProvider(firstKey[0]);
                        setApiKey(firstKey[1]);
                    }
                }
            })
            .catch(() => {});
    }, []);

    const handleSaveLLM = async () => {
        if (!apiKey.trim()) {
            toaster.create({ title: "API key is empty", type: "error" });
            return;
        }
        if (apiKey.includes("****")) {
            toaster.create({ title: "That's a masked value — re-type the API key to change it", type: "error" });
            return;
        }
        setSaving(true);
        try {
            await SettingsService.updateSettings({ llm_keys: { [provider]: apiKey } });
            setSavedKeys(prev => ({ ...prev, [provider]: apiKey }));
            toaster.create({ title: `${providerOptions.items.find(p => p.value === provider)?.label || provider} API key saved`, type: "success" });
        } catch (e: any) {
            toaster.create({ title: `Failed to save: ${e.message}`, type: "error" });
        } finally {
            setSaving(false);
        }
    };

    const handleSaveTavily = async () => {
        if (!tavilyKey.trim()) {
            toaster.create({ title: "Tavily API key is empty", type: "error" });
            return;
        }
        setSaving(true);
        try {
            await SettingsService.updateSettings({ llm_keys: { tavily: tavilyKey } });
            setSavedKeys(prev => ({ ...prev, tavily: tavilyKey }));
            toaster.create({ title: "Tavily API key saved", type: "success" });
        } catch (e: any) {
            toaster.create({ title: `Failed to save: ${e.message}`, type: "error" });
        } finally {
            setSaving(false);
        }
    };

    const handleClear = async () => {
        setSaving(true);
        try {
            await SettingsService.updateSettings({ llm_keys: null });
            setSavedKeys({});
            setApiKey("");
            toaster.create({ title: "All API keys cleared", type: "info" });
        } catch (e: any) {
            toaster.create({ title: `Failed to clear: ${e.message}`, type: "error" });
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteKey = async (keyName: string) => {
        setDeleting(keyName);
        try {
            await SettingsService.deleteLLMKey(keyName);
            setSavedKeys(prev => {
                const next = { ...prev };
                delete next[keyName];
                return next;
            });
            if (provider === keyName) {
                setApiKey("");
            }
            toaster.create({ title: `${providerLabel(keyName)} key deleted`, type: "info" });
        } catch (e: any) {
            toaster.create({ title: `Failed to delete: ${e.message}`, type: "error" });
        } finally {
            setDeleting(null);
        }
    };

    const providerLabel = (value: string) =>
        value === "tavily"
              ? "Tavily"
              : providerOptions.items.find(p => p.value === value)?.label || value;

    const hasSavedKeys = Object.keys(savedKeys).length > 0;

    return (
        <Box bg="var(--surface-canvas)" minH="100vh">
            <Flex direction="column" gap={6} maxW="1240px" mx="auto" py={6}>
                {/* Header */}
                <Flex justify="space-between" align={{ base: "flex-start", md: "flex-end" }} gap={3}>
                    <Flex direction="column" gap={1}>
                        <Text fontSize="22px" fontWeight={600} color="var(--ink-primary)">
                            Settings
                        </Text>
                        <Text fontSize="13px" color="var(--ink-secondary)">
                            Manage the API keys used to run analyses.
                        </Text>
                    </Flex>
                    <Text
                        fontSize="11.5px"
                        fontFamily="var(--font-mono)"
                        color="var(--ink-tertiary)"
                        whiteSpace="nowrap"
                    >
                        {Object.keys(savedKeys).length} KEY{Object.keys(savedKeys).length === 1 ? "" : "S"} STORED
                    </Text>
                </Flex>

                <Flex direction={{ base: "column", lg: "row" }} gap={6} align="stretch">
                    {/* Panel: Model Provider */}
                    <Box
                        as={motion.div}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: dur.base, ease }}
                        bg="var(--surface-panel)"
                        border="1px solid var(--hairline)"
                        borderRadius="2px"
                        p={6}
                        flex="1"
                        minW={0}
                    >
                        <Text
                            fontSize="10.5px"
                            fontWeight={500}
                            color="var(--ink-tertiary)"
                            textTransform="uppercase"
                            letterSpacing="0.06em"
                            mb={3}
                        >
                            API Keys
                        </Text>
                        <Text
                            fontSize="12px"
                            color="var(--ink-tertiary)"
                            mt={1}
                            mb={5}
                        >
                            Keys are stored securely on the server, encrypted at rest. Never exposed in the browser.
                        </Text>

                        {/* Group: Model Provider */}
                        <Text
                            fontSize="10.5px"
                            fontWeight={500}
                            color="var(--ink-tertiary)"
                            textTransform="uppercase"
                            letterSpacing="0.06em"
                            mb={3}
                        >
                            Model Provider
                        </Text>

                        <VStack gap={4} align="stretch" mb={6}>
                            <Field.Root>
                                <Field.Label
                                    fontSize="13px"
                                    fontWeight={500}
                                    color="var(--ink-primary)"
                                >
                                    Provider
                                </Field.Label>
                                <Select.Root
                                    collection={providerOptions}
                                    value={[provider]}
                                    onValueChange={(e) => {
                                        setProvider(e.value[0]);
                                        const existing = savedKeys[e.value[0]] || "";
                                        setApiKey(existing);
                                    }}
                                >
                                    <Select.HiddenSelect />
                                    <Select.Control>
                                        <Select.Trigger borderColor="var(--hairline)" borderRadius="2px">
                                            <Select.ValueText placeholder="Select provider" />
                                        </Select.Trigger>
                                        <Select.IndicatorGroup>
                                            <Select.Indicator />
                                        </Select.IndicatorGroup>
                                    </Select.Control>
                                    <Portal>
                                        <Select.Positioner>
                                            <Select.Content>
                                                {providerOptions.items.map((item: any) => (
                                                    <Select.Item item={item} key={item.value}>
                                                        {item.label}
                                                        <Select.ItemIndicator />
                                                    </Select.Item>
                                                ))}
                                            </Select.Content>
                                        </Select.Positioner>
                                    </Portal>
                                </Select.Root>
                            </Field.Root>

                            <Field.Root>
                                <Field.Label
                                    fontSize="13px"
                                    fontWeight={500}
                                    color="var(--ink-primary)"
                                >
                                    API Key
                                </Field.Label>
                                <motion.div
                                    key={provider}
                                    initial={{ opacity: 0, x: -8 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ duration: dur.fast, ease }}
                                >
                                <HStack gap={2}>
                                    <Input
                                        type={showKey ? "text" : "password"}
                                        placeholder={`Enter your ${providerLabel(provider)} API key`}
                                        value={apiKey}
                                        onChange={(e) => setApiKey(e.target.value)}
                                        flex={1}
                                        borderColor="var(--hairline)"
                                        borderRadius="2px"
                                        _focus={{ borderColor: "var(--accent-primary)" }}
                                    />
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        color="var(--ink-tertiary)"
                                        _hover={{ color: "var(--ink-primary)" }}
                                        onClick={() => setShowKey(!showKey)}
                                    >
                                        {showKey ? <MdVisibilityOff size={18} /> : <MdVisibility size={18} />}
                                    </Button>
                                </HStack>
                                </motion.div>
                            </Field.Root>

                            <HStack gap={2}>
                                <Button
                                    as={motion.button}
                                    whileTap={{ scale: 0.97 }}
                                    size="sm"
                                    bg="var(--accent-primary)"
                                    color="#fff"
                                    fontWeight={500}
                                    fontSize="13px"
                                    px={4}
                                    _hover={{ opacity: 0.9 }}
                                    borderRadius="3px"
                                    onClick={handleSaveLLM}
                                    disabled={saving}
                                >
                                    {saving ? <Spinner size="sm" borderWidth="2px" /> : <><MdCheck size={14} style={{ marginRight: 4 }} />Save</>}
                                </Button>
                                <Button
                                    as={motion.button}
                                    whileTap={{ scale: 0.97 }}
                                    size="sm"
                                    variant="outline"
                                    color="var(--signal-negative)"
                                    borderColor="var(--signal-negative)"
                                    _hover={{ bg: "var(--signal-negative)", color: "#fff" }}
                                    fontWeight={500}
                                    fontSize="13px"
                                    borderRadius="3px"
                                    onClick={handleClear}
                                    disabled={saving}
                                >
                                    <MdClose size={14} style={{ marginRight: 4 }} />
                                    Clear All
                                </Button>
                            </HStack>
                        </VStack>
                    </Box>

                    {/* Panel: Web Search */}
                    <Box
                        as={motion.div}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: dur.base, ease, delay: 0.06 }}
                        bg="var(--surface-panel)"
                        border="1px solid var(--hairline)"
                        borderRadius="2px"
                        p={6}
                        flex="1"
                        minW={0}
                    >
                        <Text
                            fontSize="10.5px"
                            fontWeight={500}
                            color="var(--ink-tertiary)"
                            textTransform="uppercase"
                            letterSpacing="0.06em"
                            mb={3}
                        >
                            Web Search
                        </Text>

                        <VStack gap={4} align="stretch">
                            <Field.Root>
                                <Field.Label
                                    fontSize="13px"
                                    fontWeight={500}
                                    color="var(--ink-primary)"
                                >
                                    <HStack gap={1}>
                                        <MdWeb size={14} color="var(--ink-tertiary)" />
                                        <Text>Tavily API Key</Text>
                                    </HStack>
                                </Field.Label>
                                <HStack gap={2}>
                                    <Input
                                        type={showTavily ? "text" : "password"}
                                        placeholder="Enter your Tavily API key"
                                        value={tavilyKey}
                                        onChange={(e) => setTavilyKey(e.target.value)}
                                        flex={1}
                                        borderColor="var(--hairline)"
                                        borderRadius="2px"
                                        _focus={{ borderColor: "var(--accent-primary)" }}
                                    />
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        color="var(--ink-tertiary)"
                                        _hover={{ color: "var(--ink-primary)" }}
                                        onClick={() => setShowTavily(!showTavily)}
                                    >
                                        {showTavily ? <MdVisibilityOff size={18} /> : <MdVisibility size={18} />}
                                    </Button>
                                </HStack>
                            </Field.Root>

                            <HStack gap={2}>
                                <Button
                                    as={motion.button}
                                    whileTap={{ scale: 0.97 }}
                                    size="sm"
                                    bg="var(--accent-primary)"
                                    color="#fff"
                                    fontWeight={500}
                                    fontSize="13px"
                                    px={4}
                                    _hover={{ opacity: 0.9 }}
                                    borderRadius="3px"
                                    onClick={handleSaveTavily}
                                    disabled={saving}
                                >
                                    {saving ? <Spinner size="sm" borderWidth="2px" /> : <><MdCheck size={14} style={{ marginRight: 4 }} />Save</>}
                                </Button>
                                {savedKeys.tavily && (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        color="var(--signal-negative)"
                                        borderColor="var(--signal-negative)"
                                        _hover={{ bg: "var(--signal-negative)", color: "#fff" }}
                                        fontWeight={500}
                                        fontSize="13px"
                                        borderRadius="3px"
                                        onClick={() => handleDeleteKey("tavily")}
                                        disabled={deleting === "tavily"}
                                    >
                                        {deleting === "tavily" ? <Spinner size="sm" borderWidth="2px" /> : <><MdClose size={14} style={{ marginRight: 4 }} />Remove</>}
                                    </Button>
                                )}
                            </HStack>
                        </VStack>
                    </Box>
                </Flex>

                {/* Saved Keys */}
                <AnimatePresence>
                {hasSavedKeys && (
                    <Box
                        as={motion.div}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: dur.base, ease }}
                        bg="var(--surface-panel)"
                        border="1px solid var(--hairline)"
                        borderRadius="2px"
                        p={6}
                    >
                        <Text
                            fontSize="10.5px"
                            fontWeight={500}
                            color="var(--ink-tertiary)"
                            textTransform="uppercase"
                            letterSpacing="0.06em"
                            mb={3}
                        >
                            Saved Keys
                            <Text as="span" fontFamily="var(--font-mono)" ml={2} color="var(--ink-tertiary)">
                                {Object.keys(savedKeys).length}
                            </Text>
                        </Text>
                        <VStack gap={0} align="stretch">
                            {Object.entries(savedKeys).map(([prov, key], i, arr) => (
                                <HStack
                                    as={motion.div}
                                    layout
                                    initial={{ opacity: 0, x: -6 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: 6 }}
                                    transition={{ duration: dur.fast, ease }}
                                    key={prov}
                                    justify="space-between"
                                    py={2.5}
                                    px={0}
                                    borderBottom={i < arr.length - 1 ? "1px solid var(--hairline)" : undefined}
                                >
                                    <HStack gap={3}>
                                        <Text fontSize="13px" fontWeight={500} color="var(--ink-primary)">
                                            {providerLabel(prov)}
                                        </Text>
                                        <Text fontSize="13px" fontFamily="var(--font-mono)" color="var(--ink-tertiary)">
                                            {key}
                                        </Text>
                                    </HStack>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        color="var(--ink-tertiary)"
                                        _hover={{ color: "var(--signal-negative)" }}
                                        onClick={() => handleDeleteKey(prov)}
                                        disabled={deleting === prov}
                                    >
                                        {deleting === prov ? <Spinner size="sm" borderWidth="2px" /> : <MdDelete size={14} />}
                                    </Button>
                                </HStack>
                            ))}
                        </VStack>
                    </Box>
                )}
                </AnimatePresence>
            </Flex>
        </Box>
    );
}
