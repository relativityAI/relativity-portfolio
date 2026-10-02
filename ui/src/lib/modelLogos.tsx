import type { ComponentType } from "react";
import { Box, Text } from "@chakra-ui/react";
import { TbBrandOpenai } from "react-icons/tb";
import {
    SiAnthropic,
    SiGooglegemini,
    SiMeta,
    SiMistralai,
    SiNvidia,
    SiOllama,
    SiPerplexity,
} from "react-icons/si";
import grokLogo from "@/assets/llm_grok.svg";
import cohereLogo from "@/assets/llm_cohere.svg";
import openrouterLogo from "@/assets/llm_openrouter.svg";
import groqLogo from "@/assets/llm_groq.svg";
import deepseekLogo from "@/assets/llm_deepseek.svg";
import mistralAiLogo from "@/assets/llm_mistral-ai.svg";
import qwenLogo from "@/assets/llm_qwen.svg";
import zAiLogo from "@/assets/llm_z-ai.svg";
import cerebrasLogo from "@/assets/llm_cerebras.svg";

/**
 * Provider marks for LLM models, keyed by the model-id prefix used
 * across the API (`provider/model-id`). Providers without a mark in
 * react-icons fall back to a monogram chip in the app's own design
 * language, so every model line still reads as branded.
 */

export function modelProvider(model?: string | null): string {
    const id = (model || "").trim().toLowerCase();
    if (!id) return "unknown";
    const prefix = id.split("/")[0];
    if (prefix === "meta-llama" || prefix === "meta") return "meta";
    if (prefix === "gemini" || prefix === "google") return "google";
    if (prefix === "mistralai" || prefix === "mistral") return "mistral";
    if (prefix === "z-ai") return "zai";
    return prefix;
}

interface ProviderVisual {
    label: string;
    Icon?: ComponentType<{ size?: number | string; color?: string }>;
    image?: string;
    color?: string;
    /** currentColor SVG — needs a dark-mode invert to stay visible. */
    invert?: boolean;
}

const PROVIDERS: Record<string, ProviderVisual> = {
    openai: { label: "OpenAI", Icon: TbBrandOpenai, color: "#10A37F" },
    anthropic: { label: "Anthropic", Icon: SiAnthropic, color: "#D97757" },
    google: { label: "Google Gemini", Icon: SiGooglegemini, color: "#4285F4" },
    meta: { label: "Meta Llama", Icon: SiMeta, color: "#0668E1" },
    mistral: { label: "Mistral AI", image: mistralAiLogo },
    nvidia: { label: "NVIDIA", Icon: SiNvidia, color: "#76B900" },
    ollama: { label: "Ollama", Icon: SiOllama },
    perplexity: { label: "Perplexity", Icon: SiPerplexity, color: "#20808D" },
    grok: { label: "Grok", image: grokLogo, invert: true },
    cohere: { label: "Cohere", image: cohereLogo, invert: true },
    openrouter: { label: "OpenRouter", image: openrouterLogo, invert: true },
    groq: { label: "Groq", image: groqLogo, invert: true },
    deepseek: { label: "DeepSeek", image: deepseekLogo },
    qwen: { label: "Qwen", image: qwenLogo, invert: true },
    zai: { label: "Z.AI", image: zAiLogo },
    cerebras: { label: "Cerebras", image: cerebrasLogo, invert: true },
};

const FALLBACK_LABELS: Record<string, string> = {
    groq: "Groq",
    openrouter: "OpenRouter",
    deepseek: "DeepSeek",
    xai: "xAI",
    qwen: "Qwen",
    cerebras: "Cerebras",
    together: "Together AI",
};

export function providerDisplayName(model?: string | null): string {
    const p = modelProvider(model);
    if (PROVIDERS[p]) return PROVIDERS[p].label;
    if (FALLBACK_LABELS[p]) return FALLBACK_LABELS[p];
    if (p === "unknown") return "Model";
    return p.charAt(0).toUpperCase() + p.slice(1);
}

/**
 * The provider's raster/SVG asset for non-React hosts (ECharts tooltip HTML).
 * `invert` mirrors the `.llm-mark` rule for currentColor marks in dark mode.
 */
export function modelLogoAsset(model?: string | null): { src: string; invert?: boolean } | null {
    const vis = PROVIDERS[modelProvider(model)];
    return vis?.image ? { src: vis.image, invert: vis.invert } : null;
}

/**
 * The provider's mark at text size. Falls back to a mono initial chip
 * for providers whose logo isn't available in react-icons.
 */
export function ModelLogo({ model, size = 14 }: { model?: string | null; size?: number }) {
    const p = modelProvider(model);
    const vis = PROVIDERS[p];
    const asset = modelLogoAsset(model);
    if (asset) {
        return (
            <img
                src={asset.src}
                alt=""
                aria-hidden="true"
                className={asset.invert ? "llm-mark" : undefined}
                style={{ width: size, height: size, objectFit: "contain", display: "inline-block", flexShrink: 0 }}
            />
        );
    }
    if (vis?.Icon) {
        const Icon = vis.Icon;
        return <Icon size={size} color={vis.color} aria-hidden />;
    }
    const name = providerDisplayName(model);
    return (
        <Box
            as="span"
            display="inline-flex"
            alignItems="center"
            justifyContent="center"
            flexShrink={0}
            w={`${size + 2}px`}
            h={`${size + 2}px`}
            border="1px solid var(--hairline)"
            borderRadius="2px"
            bg="var(--surface-recessed)"
            aria-hidden
        >
            <Text
                fontSize={`${Math.max(8, Math.round(size * 0.72))}px`}
                fontFamily="var(--font-mono)"
                fontWeight={600}
                color="var(--ink-secondary)"
                lineHeight={1}
            >
                {name.charAt(0).toUpperCase()}
            </Text>
        </Box>
    );
}
