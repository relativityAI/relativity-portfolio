import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SkillMarkdown } from "@/components/skills/SkillMarkdown";

describe("SkillMarkdown", () => {
    it("renders headings, lists, emphasis and strips YAML frontmatter", () => {
        render(
            <SkillMarkdown>
                {`---\nname: test-skill\ndescription: A test\n---\n\n## Purpose\n\nSome **bold** text.\n\n1. First\n2. Second\n`}
            </SkillMarkdown>,
        );
        expect(screen.getByRole("heading", { level: 2, name: "Purpose" })).toBeInTheDocument();
        expect(screen.getByText("bold").tagName).toBe("STRONG");
        expect(screen.getByRole("list")).toBeInTheDocument();
        expect(screen.queryByText(/name: test-skill/)).not.toBeInTheDocument();
    });
});
