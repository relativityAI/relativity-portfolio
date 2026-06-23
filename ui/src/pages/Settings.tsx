import { useState, useEffect } from "react";
import {
    Flex, Text, Box, Button, Input, VStack, HStack, Field, Separator,
    createListCollection, Select, Portal
} from "@chakra-ui/react";
import { MdCheck, MdClose, MdVisibility, MdVisibilityOff, MdWeb } from "react-icons/md";
import { toaster } from "@/components/ui/toaster";

const STORAGE_KEYS = {
    llm_provider: "llm_provider",
    llm_api_key: "llm_api_key",
};

const providerOptions = createListCollection({
    items: [
        { label: "OpenAI", value: "openai" },
        { label: "Gemini", value: "gemini" },
        { label: "Cerebras", value: "cerebras" },
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
    const tavilyKeySaved = !!localStorage.getItem("tavily_key");

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
        setSavedKeys(allKeys);

        const savedTavily = localStorage.getItem("tavily_key") || "";
        setTavilyKey(savedTavily);
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
        toaster.create({ title: `${provider} API key saved`, type: "success" });
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

    const handleClear = () => {
        for (const p of providerOptions.items) {
            localStorage.removeItem(`${p.value}_key`);
        }
        localStorage.removeItem(STORAGE_KEYS.llm_provider);
        localStorage.removeItem(STORAGE_KEYS.llm_api_key);
        setSavedKeys({});
        setApiKey("");
        toaster.create({ title: "All API keys cleared", type: "info" });
    };

    return (
        <Flex direction={"column"} gap={4} py={4}>
            <Text textStyle={"3xl"} fontWeight="bold" letterSpacing="tight">
                Settings
            </Text>

            <Box
                bg="bg.subtle"
                border="1px solid"
                borderColor="border"
                rounded="md"
                p={5}
            >
                <VStack gap={4} align="stretch">
                    <Text fontSize="xs" fontWeight="bold" color="fg.subtle" textTransform="uppercase" letterSpacing="widest">
                        API Keys
                    </Text>
                    <Text fontSize="xs" color="fg.muted">
                        Keys are stored in your browser and sent to Nebula as headers. Never stored on any server.
                    </Text>

                    <Field.Root>
                        <Field.Label>LLM Provider</Field.Label>
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
                                <Select.Trigger>
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
                        <Field.Label>LLM API Key</Field.Label>
                        <HStack gap={2}>
                            <Input
                                type={showKey ? "text" : "password"}
                                placeholder={`Enter your ${provider} API key`}
                                value={apiKey}
                                onChange={(e) => setApiKey(e.target.value)}
                                flex={1}
                            />
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setShowKey(!showKey)}
                            >
                                {showKey ? <MdVisibilityOff size={18} /> : <MdVisibility size={18} />}
                            </Button>
                        </HStack>
                    </Field.Root>

                    <Field.Root>
                        <Field.Label>
                            <HStack gap={1}>
                                <MdWeb size={14} />
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
                            />
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setShowTavily(!showTavily)}
                            >
                                {showTavily ? <MdVisibilityOff size={18} /> : <MdVisibility size={18} />}
                            </Button>
                        </HStack>
                    </Field.Root>

                    <HStack gap={2} flexWrap="wrap">
                        <Button onClick={handleSave} colorPalette="blue" size="sm">
                            <MdCheck size={14} />
                            Save LLM Key
                        </Button>
                        <Button onClick={handleSaveTavily} colorPalette="blue" size="sm">
                            <MdCheck size={14} />
                            Save Tavily Key
                        </Button>
                        <Button variant="outline" colorPalette="red" size="sm" onClick={handleClear}>
                            <MdClose size={14} />
                            Clear All
                        </Button>
                        {tavilyKeySaved && (
                            <Button variant="outline" colorPalette="red" size="sm" onClick={handleClearTavily}>
                                <MdClose size={14} />
                                Remove Tavily
                            </Button>
                        )}
                    </HStack>

                    {Object.keys(savedKeys).length > 0 && (
                        <>
                            <Separator borderColor="border" />
                            <Text fontSize="xs" fontWeight="bold" color="fg.subtle" textTransform="uppercase" letterSpacing="widest">
                                Saved Keys
                            </Text>
                            <VStack gap={2} align="stretch">
                                {Object.entries(savedKeys).map(([prov, key]) => (
                                    <HStack key={prov} justify="space-between" p={2} bg="bg.muted" rounded="md">
                                        <Text fontSize="sm" fontWeight="medium" textTransform="capitalize">{prov}</Text>
                                        <Text fontSize="sm" color="fg.muted" fontFamily="mono">{maskKey(key)}</Text>
                                    </HStack>
                                ))}
                            </VStack>
                        </>
                    )}
                </VStack>
            </Box>
        </Flex>
    );
}
