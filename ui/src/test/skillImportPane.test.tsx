import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import SkillImportPane from "@/components/skills/SkillImportPane";
import { SkillRepoService, type RepoSkill, type SkillSummary } from "@/db";

vi.mock("@/db", () => ({
    SkillRepoService: {
        listRepos: vi.fn(),
        listRepoSkills: vi.fn(),
        importSkill: vi.fn(),
    },
}));

vi.mock("@/compat/ui", () => ({
    toaster: { create: vi.fn() },
}));

const REPOS = [{ id: "r1", label: "Test Repo", owner: "acme", repo: "skills-repo" }];

const REMOTE_SKILLS: RepoSkill[] = [
    {
        id: "dcf-valuation",
        name: "DCF Valuation",
        description: "Discounted cash flow with sensitivity tables",
        path: "skills/dcf/SKILL.md",
        html_url: "https://github.com/acme/skills-repo/blob/main/skills/dcf/SKILL.md",
    },
    {
        id: "moat-analysis",
        name: "Moat Analysis",
        description: "Rate a company's competitive durable advantage",
        path: "skills/moat/SKILL.md",
        html_url: "https://github.com/acme/skills-repo/blob/main/skills/moat/SKILL.md",
    },
];

const SAVED: SkillSummary = {
    id: "dcf-valuation",
    name: "DCF Valuation",
    description: "Discounted cash flow with sensitivity tables",
    category: "custom",
    version: 1,
    source: "custom",
};

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(SkillRepoService.listRepos).mockResolvedValue(REPOS as any);
    vi.mocked(SkillRepoService.listRepoSkills).mockResolvedValue(REMOTE_SKILLS as any);
});

describe("SkillImportPane", () => {
    it("lists repo skills with a source link that opens in a new tab", async () => {
        render(<SkillImportPane library={[]} onCancel={vi.fn()} onSaved={vi.fn()} />);

        expect(await screen.findByText("DCF Valuation")).toBeInTheDocument();
        expect(screen.getByText("Moat Analysis")).toBeInTheDocument();

        const link = screen.getByRole("link", { name: /read dcf valuation on github/i });
        expect(link).toHaveAttribute("href", REMOTE_SKILLS[0].html_url);
        expect(link).toHaveAttribute("target", "_blank");
    });

    it("downloads a skill into the library and marks it as added", async () => {
        vi.mocked(SkillRepoService.importSkill).mockResolvedValue({ skill: SAVED } as any);
        const onSaved = vi.fn();

        render(<SkillImportPane library={[]} onCancel={vi.fn()} onSaved={onSaved} />);
        const buttons = await screen.findAllByRole("button", { name: /download/i });
        await userEvent.click(buttons[0]);

        await waitFor(() => expect(onSaved).toHaveBeenCalledWith(SAVED));
        expect(SkillRepoService.importSkill).toHaveBeenCalledWith("r1", "skills/dcf/SKILL.md");
        expect(await screen.findByText(/in library/i)).toBeInTheDocument();
    });

    it("shows skills already in the library without a download button", async () => {
        render(<SkillImportPane library={[SAVED]} onCancel={vi.fn()} onSaved={vi.fn()} />);

        expect(await screen.findByText("DCF Valuation")).toBeInTheDocument();
        expect(screen.getAllByRole("button", { name: /download/i })).toHaveLength(1);
        expect(screen.getByText(/in library/i)).toBeInTheDocument();
    });

    it("surfaces list failures with a retry action", async () => {
        vi.mocked(SkillRepoService.listRepoSkills).mockRejectedValueOnce({
            response: { data: { error: "GitHub is rate-limiting this server." } },
        });

        render(<SkillImportPane library={[]} onCancel={vi.fn()} onSaved={vi.fn()} />);
        expect(await screen.findByText(/rate-limiting/i)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    });
});
