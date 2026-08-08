import { useState, useEffect } from "react";
import {
    Flex, Text, Box, Button, Input, VStack, HStack, Field,
    createListCollection, Select, Portal
} from "@chakra-ui/react";
import { MdCheck, MdClose, MdVisibility, MdVisibilityOff, MdWeb, MdSave, MdSatelliteAlt, MdLink } from "react-icons/md";
import { toaster } from "@/components/ui/toaster";
import { DataService } from "@/db";

const STORAGE_KEYS = {
    llm_provider: "llm_provider",
    llm_api_key: "llm_api_key",
    voyager_api_key: "voyager_api_key",
};

const providerOptions = createListCollection({
    items: [
        { label: "OpenAI", value: "openai" },
        { label: "Gemini", value: "gemini" },
        { label: "Cerebras", value: "cerebras" },
        { label: "Groq", value: "groq" },
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
        const provider = localStorage.getItem(STORAGE_KEYS.llm_provider) || "openai";
        const key = localStorage.getItem(STORAGE_KEYS.llm_api_key) || "";
        setProvider(provider);
        setApiKey(key);

        const allKeys: Record<string, string> = {};
        for (const p of providerOptions.items) {
            const k = localStorage.getItem(`${p.value}_key`);
            if (k) allKeys[p.value] = k;
        }

        const savedTavily = localStorage.getItem("tavily_key") || "";
        const savedVoyager = localStorage.getItem(STORAGE_KEYS.voyager_api_key) || "";
        if (savedTavily) allKeys.tavily = savedTavily;
        if (savedVoyager) allKeys.voyager = savedVoyager;
        setSavedKeys(allKeys);

        setTavilyKey(savedTavily);

        setVoyagerKey(savedVoyager);

        DataService.getVoyagerHealth()
            .then(setVoyagerHealth)
            .catch(() => setVoyagerHealth(null));
    }, []);

    const handleSave = () => {
        if (!apiKey.trim()) {
            toaster.create({ title: "API key is empty", type: "error" });
            return;
        }
        localStorage.setItem(STORAGE_KEYS.llm_provider, provider);
        localStorage.setItem(STORAGE_KEYS.llm_api_key, apiKey);
        localStorage.setItem(`${provider}_key`, apiKey);

        setSavedKeys(prev => ({ ...prev, [provider]: apiKey }));
        toaster.create({ title: `${providerOptions.items.find(p => p.value === provider)?.label || provider} API key saved`, type: "success" });
    };

    const handleSaveTavily = () => {
        if (!tavilyKey.trim()) {
            toaster.create({ title: "Tavily API key is empty", type: "error" });
            return;
        }
        localStorage.setItem("tavily_key", tavilyKey);
        setSavedKeys(prev => ({ ...prev, tavily: tavilyKey }));
        toaster.create({ title: "Tavily API key saved", type: "success" });
    };

    const handleClearTavily = () => {
        localStorage.removeItem("tavily_key");
        setTavilyKey("");
        const { tavily, ...rest } = savedKeys;
        setSavedKeys(rest);
        toaster.create({ title: "Tavily API key removed", type: "info" });
    };

    const handleSaveVoyager = () => {
        if (!voyagerKey.trim()) {
            toaster.create({ title: "Voyager API key is empty", type: "error" });
            return;
        }
        localStorage.setItem(STORAGE_KEYS.voyager_api_key, voyagerKey.trim());
        setSavedKeys(prev => ({ ...prev, voyager: voyagerKey.trim() }));
        toaster.create({ title: "Voyager API key saved", type: "success" });
    };

    const handleClearVoyager = () => {
        localStorage.removeItem(STORAGE_KEYS.voyager_api_key);
        setVoyagerKey("");
        const { voyager, ...rest } = savedKeys;
        setSavedKeys(rest);
        toaster.create({ title: "Voyager API key removed", type: "info" });
    };

    const handleClear = () => {
        for (const p of providerOptions.items) {
            localStorage.removeItem(`${p.value}_key`);
        }
        localStorage.removeItem(STORAGE_KEYS.llm_provider);
        localStorage.removeItem(STORAGE_KEYS.llm_api_key);
        localStorage.removeItem(STORAGE_KEYS.voyager_api_key);
        setVoyagerKey("");
        setSavedKeys({});
        setApiKey("");
        toaster.create({ title: "All API keys cleared", type: "info" });
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
                        {/* Section: API Keys header + security note */}
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
                            Keys are stored in your browser and sent to the analysis backend as headers. Never stored on any server.
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
                                        const existing = localStorage.getItem(`${e.value[0]}_key`) || "";
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
                                    onClick={handleSave}
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
                            Key is stored in your browser and sent to the analysis backend as a header.
                            Never stored on any server. Use a data:read-scoped key with a low request rate.
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
                                {voyagerKey && (
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
