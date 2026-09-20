import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChakraProvider, createSystem, defaultConfig } from "@chakra-ui/react";
import { HelmetProvider } from "react-helmet-async";
import Guide from "../pages/Guide";

const system = createSystem(defaultConfig);

const PROVIDERS = ["OpenAI", "Gemini", "Cerebras", "Groq", "OpenRouter", "Anthropic", "Tavily"];

function renderGuide() {
    render(
        <HelmetProvider>
            <ChakraProvider value={system}>
                <Guide />
            </ChakraProvider>
        </HelmetProvider>
    );
}

describe("Guide page", () => {
    it("renders the heading and intro", () => {
        renderGuide();
        expect(screen.getByText("Guide")).toBeTruthy();
        expect(screen.getByText(/Getting an API key takes about a minute/)).toBeTruthy();
    });

    it("shows a jump list with an anchor link per provider", () => {
        renderGuide();
        for (const name of PROVIDERS) {
            const link = screen.getByRole("link", { name });
            expect(link.getAttribute("href")).toBe(`#${name.toLowerCase()}`);
        }
    });

    it("renders a section (with steps) and an official site link per provider", () => {
        renderGuide();
        const expectOneOf = (pattern: RegExp) =>
            screen.getAllByText(pattern).length >= 1;

        // One section card per provider, plus the jump-list chip with the same name.
        // The section card is the duplicate, so each name appears at least twice.
        for (const name of PROVIDERS) {
            expect(screen.getAllByText(name).length).toBeGreaterThanOrEqual(2);
        }

        // Every provider has at least one step that mentions the Settings paste step.
        expectOneOf(/Settings → OpenAI/);
        expectOneOf(/Settings → Gemini/);
        expectOneOf(/Settings → Cerebras/);
        expectOneOf(/Settings → Groq/);
        expectOneOf(/Settings → OpenRouter/);
        expectOneOf(/Settings → Anthropic/);
        expectOneOf(/Settings → Tavily/);
    });

    it("points official-site links at the providers' key pages", () => {
        renderGuide();
        expect(screen.getByText("platform.openai.com").closest("a")?.getAttribute("href")).toBe("https://platform.openai.com/api-keys");
        expect(screen.getByText("aistudio.google.com").closest("a")?.getAttribute("href")).toBe("https://aistudio.google.com/apikey");
        expect(screen.getByText("cloud.cerebras.ai").closest("a")?.getAttribute("href")).toBe("https://cloud.cerebras.ai");
        expect(screen.getByText("console.groq.com").closest("a")?.getAttribute("href")).toBe("https://console.groq.com/keys");
        expect(screen.getByText("openrouter.ai").closest("a")?.getAttribute("href")).toBe("https://openrouter.ai/keys");
        expect(screen.getByText("console.anthropic.com").closest("a")?.getAttribute("href")).toBe("https://console.anthropic.com/settings/keys");
        expect(screen.getByText("app.tavily.com").closest("a")?.getAttribute("href")).toBe("https://app.tavily.com");
    });
});