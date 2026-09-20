import type { MouseEvent } from "react";
import { Box, Flex, Text } from "@chakra-ui/react";
import { Helmet } from "react-helmet-async";
import { MdOpenInNew } from "react-icons/md";
import PageHero from "@/components/PageHero";
import { motion, dur, ease } from "@/lib/motion";

interface GuideSection {
    id: string;
    name: string;
    url: string;
    site: string;
    steps: string[];
}

/**
 * One compact card per provider, in the same order the keys appear in
 * Settings (model providers first, web search last).
 */
const SECTIONS: GuideSection[] = [
    {
        id: "openai",
        name: "OpenAI",
        url: "https://platform.openai.com/api-keys",
        site: "platform.openai.com",
        steps: [
            "Sign up or sign in at platform.openai.com.",
            "Open API keys in the left sidebar.",
            "Click Create new secret key, name it, and copy the key.",
            "Paste it under Settings → OpenAI.",
        ],
    },
    {
        id: "gemini",
        name: "Gemini",
        url: "https://aistudio.google.com/apikey",
        site: "aistudio.google.com",
        steps: [
            "Sign in with your Google account at aistudio.google.com.",
            "Accept the terms, then open Get API key.",
            "Click Create API key — a default project and key are created for you.",
            "Copy the key and paste it under Settings → Gemini.",
        ],
    },
    {
        id: "cerebras",
        name: "Cerebras",
        url: "https://cloud.cerebras.ai",
        site: "cloud.cerebras.ai",
        steps: [
            "Create a free account at cloud.cerebras.ai.",
            "Open API Keys in the left navigation.",
            "Click Generate API key, give it a name, and confirm.",
            "Copy the key right away (it's shown only once) and paste it under Settings → Cerebras.",
        ],
    },
    {
        id: "groq",
        name: "Groq",
        url: "https://console.groq.com/keys",
        site: "console.groq.com",
        steps: [
            "Sign up for a free account at console.groq.com.",
            "Open API Keys in the sidebar.",
            "Click Create API Key and copy the generated key.",
            "Paste it under Settings → Groq.",
        ],
    },
    {
        id: "openrouter",
        name: "OpenRouter",
        url: "https://openrouter.ai/keys",
        site: "openrouter.ai",
        steps: [
            "Create a free account at openrouter.ai.",
            "Go to Keys in the dashboard.",
            "Click Create Key — default permissions are fine — then copy it.",
            "Paste it under Settings → OpenRouter. Add credits in the Credits tab to use paid models.",
        ],
    },
    {
        id: "anthropic",
        name: "Anthropic",
        url: "https://console.anthropic.com/settings/keys",
        site: "console.anthropic.com",
        steps: [
            "Sign in at console.anthropic.com.",
            "Open API Keys under Settings.",
            "Click Create Key and copy it.",
            "Paste it under Settings → Anthropic (the API is pay-as-you-go — add credits in Billing if needed).",
        ],
    },
    {
        id: "tavily",
        name: "Tavily",
        url: "https://app.tavily.com",
        site: "app.tavily.com",
        steps: [
            "Sign in — or create a free account — at app.tavily.com.",
            "Copy the key from the API keys section on the dashboard.",
            "Paste it under Settings → Tavily.",
        ],
    },
];

/** Clicking a guide link smooth-scrolls to its section. Falls back to the native anchor jump. */
function scrollToSection(e: MouseEvent<HTMLAnchorElement>) {
    const id = e.currentTarget.getAttribute("href")?.slice(1);
    const el = id ? document.getElementById(id) : null;
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    history.replaceState(null, "", `#${id}`);
}

export default function Guide() {
    return (
        <Box bg="var(--surface-canvas)" minH="100%">
            <Helmet>
                <title>Guide | Relativity AI</title>
                <meta
                    name="description"
                    content="Short click-through guides for getting API keys from OpenAI, Gemini, Cerebras, Groq, OpenRouter, Anthropic, and Tavily."
                />
            </Helmet>
            <Flex direction="column" gap={5} maxW="820px" mx="auto" py={6} pb={12}>
                {/* Header */}
                <PageHero>
                    <Flex direction="column" gap={1}>
                        <Text fontSize="22px" fontWeight={600} color="var(--ink-primary)">
                            Guide
                        </Text>
                        <Text fontSize="13px" color="var(--ink-secondary)" maxW="560px">
                            Getting an API key takes about a minute. Pick a provider below, follow the
                            steps, then paste the key in <strong>Settings</strong>.
                        </Text>
                    </Flex>
                </PageHero>

                {/* Jump list — click a link to go straight to that section */}
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: dur.base, ease }}
                >
                    <Box
                        border="1px solid var(--hairline)"
                        borderRadius="2px"
                        bg="var(--surface-panel)"
                        p={{ base: 4, md: 5 }}
                    >
                        <Text
                            fontSize="10.5px"
                            fontWeight={500}
                            color="var(--ink-tertiary)"
                            textTransform="uppercase"
                            letterSpacing="0.06em"
                            mb={3}
                        >
                            Jump to a section
                        </Text>
                        <Flex flexWrap="wrap" gap={2}>
                            {SECTIONS.map((s) => (
                                <a
                                    key={s.id}
                                    href={`#${s.id}`}
                                    onClick={scrollToSection}
                                    style={{ textDecoration: "none" }}
                                >
                                    <Flex
                                        align="center"
                                        px={3}
                                        py={1.5}
                                        borderRadius="full"
                                        border="1px solid var(--hairline)"
                                        bg="var(--surface-recessed)"
                                        fontSize="12.5px"
                                        fontWeight={500}
                                        color="var(--ink-secondary)"
                                        _hover={{ borderColor: "var(--accent-primary)", color: "var(--accent-primary)" }}
                                    >
                                        {s.name}
                                    </Flex>
                                </a>
                            ))}
                        </Flex>
                    </Box>
                </motion.div>

                {/* One compact section per service */}
                <Flex direction="column" gap={4}>
                    {SECTIONS.map((s, i) => (
                        <motion.div
                            key={s.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: dur.base, ease, delay: Math.min(i * 0.04, 0.3) }}
                        >
                            <Box
                                id={s.id}
                                scrollMarginTop={8}
                                border="1px solid var(--hairline)"
                                borderRadius="2px"
                                bg="var(--surface-panel)"
                                p={{ base: 4, md: 5 }}
                            >
                                <Flex align="baseline" justify="space-between" gap={3} mb={3} flexWrap="wrap">
                                    <Text fontSize="16px" fontWeight={600} color="var(--ink-primary)">
                                        {s.name}
                                    </Text>
                                    <a
                                        href={s.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        style={{ textDecoration: "none" }}
                                    >
                                        <Flex
                                            align="center"
                                            gap={1}
                                            fontSize="12px"
                                            fontWeight={500}
                                            color="var(--accent-primary)"
                                            _hover={{ color: "var(--ink-primary)" }}
                                        >
                                            <MdOpenInNew size={13} />
                                            {s.site}
                                        </Flex>
                                    </a>
                                </Flex>
                                <Box as="ol" style={{ margin: 0, paddingLeft: 0, listStyle: "none" }}>
                                    {s.steps.map((step, j) => (
                                        <Flex as="li" key={j} align="flex-start" gap={2.5} py={1.5}>
                                            <Text
                                                fontSize="11px"
                                                fontWeight={600}
                                                fontFamily="var(--font-mono)"
                                                color="var(--accent-primary)"
                                                minW="18px"
                                                mt="1px"
                                            >
                                                {String(j + 1).padStart(2, "0")}
                                            </Text>
                                            <Text fontSize="13.5px" lineHeight="1.45" color="var(--ink-secondary)">
                                                {step}
                                            </Text>
                                        </Flex>
                                    ))}
                                </Box>
                            </Box>
                        </motion.div>
                    ))}
                </Flex>
            </Flex>
        </Box>
    );
}