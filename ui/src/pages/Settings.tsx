import { useState, useEffect } from "react";
import {
    Flex, Text, Box, Button, Input, VStack, HStack, Field,
    createListCollection, Select, Portal
} from "@chakra-ui/react";
import { MdCheck, MdClose, MdVisibility, MdVisibilityOff, MdWeb, MdSave, MdSatelliteAlt, MdLink } from "react-icons/md";
import { toaster } from "@/components/ui/toaster";
import { DataService, SettingsService } from "@/db";

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

function maskKey(key: string): string {
    if (!key || key.length < 8) return key;
    return key.slice(0, 3) + "****" + key.slice(-4);
}

export default function Settings() {
    const [provider, setProvider] = useState("openai");
    const [apiKey, setApiKey] = useState("");
    const [savedKeys, setSavedKeys] = useState<Record<string, string>>({});
    const [showKey, setShowKey] = useState(false);

    const [tavilyKey, setTavilyKey] = useState("");
    const [showTavily, setShowTavily] = useState(false);

    const [voyagerKey, setVoyagerKey] = useState("");
    const [showVoyagerKey, setShowVoyagerKey] = useState(false);
    const [voyagerHealth, setVoyagerHealth] = useState<{ ok?: boolean; base?: string; keyed?: boolean } | null>(null);

    useEffect(() => {
        SettingsService.getSettings()
            .then((data) => {
                if (data.voyager_key) {
                    setSavedKeys(prev => ({ ...prev, voyager: data.voyager_key! }));
                    setVoyagerKey(data.voyager_key!);
                }
                if (data.llm_keys) {
                    const allKeys: Record<string, string> = {};
                    for (const [k, v] of Object.entries(data.llm_keys)) {
                        allKeys[k] = v;
                    }
                    setSavedKeys(prev => ({ ...prev, ...allKeys }));
                    // Set the first available key as current
                    const firstKey = Object.entries(data.llm_keys)[0];
                    if (firstKey) {
                        setProvider(firstKey[0]);
                        setApiKey(firstKey[1]);
                    }
                }
            })
            .catch(() => {});

        DataService.getVoyagerHealth()
            .then(setVoyagerHealth)
            .catch(() => setVoyagerHealth(null));
    }, []);

    const handleSaveLLM = async () => {
        if (!apiKey.trim()) {
            toaster.create({ title: "API key is empty", type: "error" });
            return;
        }
        try {
            const llmKeys: Record<string, string> = {};
            for (const [k, v] of Object.entries(savedKeys)) {
                if (k !== "voyager" && k !== "tavily") llmKeys[k] = v;
            }
            llmKeys[provider] = apiKey;
            await SettingsService.updateSettings({ llm_keys: llmKeys });
            setSavedKeys(prev => ({ ...prev, [provider]: apiKey }));
            toaster.create({ title: `${providerOptions.items.find(p => p.value === provider)?.label || provider} API key saved`, type: "success" });
        } catch (e: any) {
            toaster.create({ title: `Failed to save: ${e.message}`, type: "error" });
        }
    };

    const handleSaveTavily = async () => {
        if (!tavilyKey.trim()) {
            toaster.create({ title: "Tavily API key is empty", type: "error" });
            return;
        }
        try {
            const llmKeys: Record<string, string> = {};
            for (const [k, v] of Object.entries(savedKeys)) {
                if (k !== "voyager") llmKeys[k] = v;
            }
            llmKeys.tavily = tavilyKey;
            await SettingsService.updateSettings({ llm_keys: llmKeys });
            setSavedKeys(prev => ({ ...prev, tavily: tavilyKey }));
            toaster.create({ title: "Tavily API key saved", type: "success" });
        } catch (e: any) {
            toaster.create({ title: `Failed to save: ${e.message}`, type: "error" });
        }
    };

    const handleClearTavily = async () => {
        try {
            const llmKeys: Record<string, string> = {};
            for (const [k, v] of Object.entries(savedKeys)) {
                if (k !== "voyager" && k !== "tavily") llmKeys[k] = v;
            }
            await SettingsService.updateSettings({ llm_keys: llmKeys });
            setTavilyKey("");
            const { tavily: _, ...rest } = savedKeys;
            setSavedKeys(rest);
            toaster.create({ title: "Tavily API key removed", type: "info" });
        } catch (e: any) {
            toaster.create({ title: `Failed to remove: ${e.message}`, type: "error" });
        }
    };

    const handleSaveVoyager = async () => {
        if (!voyagerKey.trim()) {
            toaster.create({ title: "Voyager API key is empty", type: "error" });
            return;
        }
        try {
            await SettingsService.updateSettings({ voyager_key: voyagerKey.trim() });
            setSavedKeys(prev => ({ ...prev, voyager: voyagerKey.trim() }));
            toaster.create({ title: "Voyager API key saved", type: "success" });
        } catch (e: any) {
            toaster.create({ title: `Failed to save: ${e.message}`, type: "error" });
        }
    };

    const handleClearVoyager = async () => {
        try {
            await SettingsService.updateSettings({ voyager_key: "" });
            setVoyagerKey("");
            const { voyager: _, ...rest } = savedKeys;
            setSavedKeys(rest);
            toaster.create({ title: "Voyager API key removed", type: "info" });
        } catch (e: any) {
            toaster.create({ title: `Failed to remove: ${e.message}`, type: "error" });
        }
    };

    const handleClear = async () => {
        try {
            await SettingsService.updateSettings({ voyager_key: "", llm_keys: {} });
            setVoyagerKey("");
            setSavedKeys({});
            setApiKey("");
            toaster.create({ title: "All API keys cleared", type: "info" });
        } catch (e: any) {
            toaster.create({ title: `Failed to clear: ${e.message}`, type: "error" });
        }
    };

    const providerLabel = (value: string) =>
        value === "voyager"
            ? "Voyager"
            : value === "tavily"
              ? "Tavily"
              : providerOptions.items.find(p => p.value === value)?.label || value;

    return (
        <Box bg="var(--surface-canvas)" minH="100vh">
            <Flex direction="column" gap={6} maxW="1100px" mx="auto" px={6} py={6}>
                {/* Header */}
                <Flex direction="column" gap={1}>
                    <Text fontSize="22px" fontWeight={600} color="var(--ink-primary)">
                        Settings
                    </Text>
                    <Text fontSize="13px" color="var(--ink-secondary)">
                        Manage the API keys used to run analyses.
                    </Text>
                </Flex>

                <Flex
                    direction={{ base: "column", xl: "row" }}
                    gap={6}
                    align="start"
                    wrap="wrap"
                >
                    {/* Panel: API Keys / Model Provider */}
                    <Box
                        bg="var(--surface-panel)"
                        border="1px solid var(--hairline)"
                        borderRadius="2px"
                        p={6}
                        flex="1"
                        minW={{ base: "full", xl: "300px" }}
                    >
                        <Text
                            fontSize="10.5px"
                            fontWeight={500}
                            color="var(--ink-tertiary)"
                            textTransform="uppercase"
                            letterSpacing="0.06em"
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
                            </Field.Root>

                            <HStack gap={2}>
                                <Button
                                    size="sm"
                                    bg="var(--accent-primary)"
                                    color="#fff"
                                    fontWeight={500}
                                    fontSize="13px"
                                    px={4}
                                    _hover={{ opacity: 0.9 }}
                                    borderRadius="3px"
                                    onClick={handleSaveLLM}
                                >
                                    <MdCheck size={14} style={{ marginRight: 4 }} />
                                    Save
                                </Button>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    color="var(--signal-negative)"
                                    borderColor="var(--signal-negative)"
                                    _hover={{ bg: "var(--signal-negative)", color: "#fff" }}
                                    fontWeight={500}
                                    fontSize="13px"
                                    borderRadius="3px"
                                    onClick={handleClear}
                                >
                                    <MdClose size={14} style={{ marginRight: 4 }} />
                                    Clear All
                                </Button>
                            </HStack>
                        </VStack>
                    </Box>

                    {/* Panel: Web Search */}
                    <Box
                        bg="var(--surface-panel)"
                        border="1px solid var(--hairline)"
                        borderRadius="2px"
                        p={6}
                        flex="1"
                        minW={{ base: "full", xl: "280px" }}
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
                                    size="sm"
                                    bg="var(--accent-primary)"
                                    color="#fff"
                                    fontWeight={500}
                                    fontSize="13px"
                                    px={4}
                                    _hover={{ opacity: 0.9 }}
                                    borderRadius="3px"
                                    onClick={handleSaveTavily}
                                >
                                    <MdCheck size={14} style={{ marginRight: 4 }} />
                                    Save
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
                                        onClick={handleClearTavily}
                                    >
                                        <MdClose size={14} style={{ marginRight: 4 }} />
                                        Remove
                                    </Button>
                                )}
                            </HStack>
                        </VStack>
                    </Box>

                    {/* Panel: Voyager API */}
                    <Box
                        bg="var(--surface-panel)"
                        border="1px solid var(--hairline)"
                        borderRadius="2px"
                        p={6}
                        flex="1"
                        minW={{ base: "full", xl: "280px" }}
                    >
                        <Text
                            fontSize="10.5px"
                            fontWeight={500}
                            color="var(--ink-tertiary)"
                            textTransform="uppercase"
                            letterSpacing="0.06em"
                            mb={1}
                        >
                            Voyager API
                        </Text>
                        <Text fontSize="12px" color="var(--ink-tertiary)" mb={3}>
                            Your Voyager key is stored securely on the server. A key is auto-generated on your first login.
                            Use a data:read-scoped key with a low request rate.
                        </Text>

                        <VStack gap={4} align="stretch">
                            {voyagerHealth?.base && (
                                <HStack gap={2} fontSize="12px" color="var(--ink-tertiary)">
                                    <MdLink size={14} color="var(--ink-tertiary)" />
                                    <Text fontFamily="var(--font-mono)" fontSize="12px">
                                        {voyagerHealth.base}
                                    </Text>
                                    {voyagerHealth.keyed === false && (
                                        <Text color="var(--signal-caution)">(no key configured)</Text>
                                    )}
                                </HStack>
                            )}
                            <Field.Root>
                                <Field.Label
                                    fontSize="13px"
                                    fontWeight={500}
                                    color="var(--ink-primary)"
                                >
                                    <HStack gap={1}>
                                        <MdSatelliteAlt size={14} color="var(--ink-tertiary)" />
                                        <Text>API Key</Text>
                                    </HStack>
                                </Field.Label>
                                <HStack gap={2}>
                                    <Input
                                        type={showVoyagerKey ? "text" : "password"}
                                        placeholder="vgr_..."
                                        value={voyagerKey}
                                        onChange={(e) => setVoyagerKey(e.target.value)}
                                        flex={1}
                                        fontFamily="var(--font-mono)"
                                        fontSize="13px"
                                        borderColor="var(--hairline)"
                                        borderRadius="2px"
                                        _focus={{ borderColor: "var(--accent-primary)" }}
                                    />
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        color="var(--ink-tertiary)"
                                        _hover={{ color: "var(--ink-primary)" }}
                                        onClick={() => setShowVoyagerKey(!showVoyagerKey)}
                                    >
                                        {showVoyagerKey ? <MdVisibilityOff size={18} /> : <MdVisibility size={18} />}
                                    </Button>
                                </HStack>
                            </Field.Root>
                            <HStack gap={2}>
                                <Button
                                    size="sm"
                                    bg="var(--accent-primary)"
                                    color="#fff"
                                    fontWeight={500}
                                    fontSize="13px"
                                    px={4}
                                    _hover={{ opacity: 0.9 }}
                                    borderRadius="3px"
                                    onClick={handleSaveVoyager}
                                >
                                    <MdSave size={14} style={{ marginRight: 4 }} />
                                    Save
                                </Button>
                                {savedKeys.voyager && (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        color="var(--signal-negative)"
                                        borderColor="var(--signal-negative)"
                                        _hover={{ bg: "var(--signal-negative)", color: "#fff" }}
                                        fontWeight={500}
                                        fontSize="13px"
                                        borderRadius="3px"
                                        onClick={handleClearVoyager}
                                    >
                                        <MdClose size={14} style={{ marginRight: 4 }} />
                                        Remove
                                    </Button>
                                )}
                            </HStack>
                        </VStack>
                    </Box>
                </Flex>

                {/* Saved Keys */}
                {Object.keys(savedKeys).length > 0 && (
                    <Box
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
                        </Text>
                        <VStack gap={0} align="stretch">
                            {Object.entries(savedKeys).map(([prov, key], i, arr) => (
                                <HStack
                                    key={prov}
                                    justify="space-between"
                                    py={2.5}
                                    px={0}
                                    borderBottom={i < arr.length - 1 ? "1px solid var(--hairline)" : undefined}
                                >
                                    <Text
                                        fontSize="13px"
                                        fontWeight={500}
                                        color="var(--ink-primary)"
                                    >
                                        {providerLabel(prov)}
                                    </Text>
                                    <Text
                                        fontSize="13px"
                                        fontFamily="var(--font-mono)"
                                        color="var(--ink-tertiary)"
                                    >
                                        {maskKey(key)}
                                    </Text>
                                </HStack>
                            ))}
                        </VStack>
                    </Box>
                )}
            </Flex>
        </Box>
    );
}
