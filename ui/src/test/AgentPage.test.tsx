import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, type ReactNode } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChakraProvider, createSystem, defaultConfig } from "@chakra-ui/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";

const { readAgent } = vi.hoisted(() => ({ readAgent: vi.fn() }));

vi.mock("@/db", () => ({
    AgentService: {
        readAgent,
        updateAgent: vi.fn(),
        validateMd: vi.fn().mockResolvedValue({ issues: [] }),
    },
    VoyagerService: {
        getAvailableMetrics: vi.fn().mockResolvedValue({ fields: [] }),
    },
}));

vi.mock("react-router-dom", async (importOriginal) => {
    const actual = await importOriginal<typeof import("react-router-dom")>();
    return {
        ...actual,
        useParams: () => ({ id: "new" }),
    };
});

vi.mock("../pages/sections/AssetEvalSection", () => ({ default: () => <div>AssetEvalSection</div> }));
vi.mock("../pages/sections/MacroEvalSection", () => ({ default: () => <div>MacroEvalSection</div> }));
vi.mock("../pages/sections/ConfigurationSection", () => ({ default: () => <div>ConfigurationSection</div> }));
vi.mock("../pages/sections/PersonaSection", () => ({ default: () => <div>PersonaSection</div> }));
vi.mock("../pages/AgentOverview", () => ({ default: () => <div>AgentOverview</div> }));
vi.mock("../pages/AgentSidebarNav", () => ({
    StepRail: () => <div>StepRail</div>,
    MobilePills: () => <div>MobilePills</div>,
}));
vi.mock("@/components/builder/DraftWithAiPanel", () => ({ default: () => null }));

import Agent from "../pages/Agent";

const system = createSystem(defaultConfig);

function renderAgent(extraRoutes: { path: string; element: React.ReactNode }[] = []) {
    const router = createMemoryRouter(
        [
            { path: "/agent/:id", element: <Agent /> },
            { path: "/agents", element: <div>AgentsListPage</div> },
            ...extraRoutes,
        ],
        { initialEntries: ["/agent/new"] }
    );
    render(
        <ChakraProvider value={system}>
            <RouterProvider router={router} />
        </ChakraProvider>
    );
    return router;
}

beforeEach(() => {
    readAgent.mockReset();
    localStorage.clear();
});

describe("Agent section markdown, one editing surface", () => {
    it("opens the current section's markdown on toggle, pre-filled from the agent", async () => {
        renderAgent();
        await screen.findByTestId("agent-save");

        // New agents start on the Configuration section — markdown shows its frontmatter.
        await userEvent.click(screen.getByTestId("mode-toggle"));
        const editor = await screen.findByTestId("md-editor");
        const input = screen.getByTestId("md-input") as HTMLTextAreaElement;
        expect(input.value).toContain("risk_appetite: 5");
        expect(within(editor).getByTestId("md-input")).toBeTruthy();
    });

    it("applies section markdown back into the form state", async () => {
        renderAgent();
        await screen.findByTestId("agent-save");
        await userEvent.click(screen.getByTestId("mode-toggle"));
        const input = await screen.findByTestId("md-input");
        await userEvent.clear(input);
        await userEvent.type(
            input,
            "---\nname: Growth\nsource: NSE\ninvestment_horizon: Long-term\nrisk_appetite: 8\n---"
        );
        await userEvent.click(screen.getByTestId("md-apply"));

        // Back in the form, the applied name shows in the name input.
        const nameInput = await screen.findByTestId("agent-name-input");
        expect(nameInput).toHaveValue("Growth");
    });

    it("guards navigation away when there are unsaved changes", async () => {
        const router = renderAgent();
        await screen.findByTestId("agent-save");

        await userEvent.click(screen.getByTestId("agent-name-input"));
        await userEvent.keyboard("Alpha");

        await act(async () => {
            router.navigate("/agents");
            await Promise.resolve();
        });

        const dialog = await screen.findByText("Leave with unsaved changes?");
        expect(dialog).toBeTruthy();

        await userEvent.click(screen.getByRole("button", { name: "Leave" }));
        expect(await screen.findByText("AgentsListPage")).toBeTruthy();
    });
});