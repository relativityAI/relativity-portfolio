import { describe, it, expect, vi, beforeAll } from "vitest";

beforeAll(() => {
  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (q: string) => ({
        matches: false, media: q, onchange: null,
        addListener: () => {}, removeListener: () => {},
        addEventListener: () => {}, removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
});

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChakraProvider, createSystem, defaultConfig } from "@chakra-ui/react";
import { ThemeProvider } from "next-themes";

vi.mock("@/lib/harnessAgents", () => ({
  HarnessAgentService: {
    list: vi.fn(async () => []),
    listTemplates: vi.fn(async () => [{ id: "default", name: "Research report", description: "" }]),
    create: vi.fn(async (input: Record<string, unknown>) => ({ id: "a1", ...input, allowedTools: [], modelId: null })),
  },
}));

vi.mock("@/db", () => ({
  SkillService: {
    listSkills: vi.fn(async () => [
      { id: "dcf-valuation", name: "DCF Valuation", description: "Intrinsic value", category: "valuation", version: 1, source: "builtin" },
      { id: "technical-analysis", name: "Technical Analysis", description: "Trends", category: "market", version: 1, source: "builtin" },
    ]),
  },
}));

import { AgentsPage } from "../pages/agents/AgentsPage";
import { HarnessAgentService } from "@/lib/harnessAgents";

const create = vi.mocked(HarnessAgentService.create);

const wrap = (n: React.ReactNode) => (
  <ChakraProvider value={createSystem(defaultConfig)}>
    <ThemeProvider attribute="class" defaultTheme="dark">{n}</ThemeProvider>
  </ChakraProvider>
);

describe("AgentsPage", () => {
  it("renders the create form and the available skills", async () => {
    render(wrap(<AgentsPage />));
    expect(screen.getByTestId("agents-page")).toBeInTheDocument();
    expect(screen.getByTestId("agent-form")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("DCF Valuation")).toBeInTheDocument());
    expect(screen.getByText("Technical Analysis")).toBeInTheDocument();
    expect(screen.getByTestId("agents-empty")).toBeInTheDocument();
  });

  it("creates an agent from a name and selected skills", async () => {
    render(wrap(<AgentsPage />));
    await waitFor(() => expect(screen.getByText("DCF Valuation")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("agent-name"), { target: { value: "Buffett Agent" } });
    fireEvent.click(screen.getByLabelText("DCF Valuation"));
    fireEvent.click(screen.getByLabelText("Technical Analysis"));
    fireEvent.click(screen.getByTestId("create-agent"));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const arg = create.mock.calls[0][0] as { name: string; skillIds: string[]; budget: { maxSteps: number } };
    expect(arg.name).toBe("Buffett Agent");
    expect(arg.skillIds.sort()).toEqual(["dcf-valuation", "technical-analysis"]);
    expect(arg.budget.maxSteps).toBe(20);

    await waitFor(() => expect(screen.getByTestId("agent-row")).toBeInTheDocument());
  });

  it("requires a name before creating", async () => {
    render(wrap(<AgentsPage />));
    await waitFor(() => expect(screen.getByText("DCF Valuation")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("create-agent"));
    expect(await screen.findByTestId("agents-error")).toHaveTextContent("Name is required");
  });
});
