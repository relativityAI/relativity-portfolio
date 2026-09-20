import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { ChakraProvider, createSystem, defaultConfig } from "@chakra-ui/react";
import MarkdownEditorTab from "../pages/MarkdownEditorTab";

const system = createSystem(defaultConfig);
const wrap = (ui: ReactNode) => render(<ChakraProvider value={system}>{ui}</ChakraProvider>);

describe("MarkdownEditorTab", () => {
    it("renders the current markdown in the editor", () => {
        wrap(
            <MarkdownEditorTab
                md={"---\nname: Warren Buffett\n---"}
                onChange={() => {}}
                issues={[]}
                onValidate={() => {}}
                validating={false}
            />
        );
        expect(screen.getByTestId("md-input")).toHaveValue("---\nname: Warren Buffett\n---");
    });

    it("propagates edits upward", async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        wrap(<MarkdownEditorTab md="a" onChange={onChange} issues={[]} onValidate={() => {}} validating={false} />);
        await user.type(screen.getByTestId("md-input"), "b");
        expect(onChange).toHaveBeenCalledWith(expect.stringContaining("b"));
    });

    it("calls validate on demand", async () => {
        const user = userEvent.setup();
        const onValidate = vi.fn();
        wrap(<MarkdownEditorTab md="---\nname: X\n---" onChange={() => {}} issues={[]} onValidate={onValidate} validating={false} />);
        await user.click(screen.getByTestId("md-validate"));
        expect(onValidate).toHaveBeenCalledTimes(1);
    });

    it("renders issues with line numbers and severity", () => {
        wrap(
            <MarkdownEditorTab
                md=""
                onChange={() => {}}
                onValidate={() => {}}
                validating={false}
                issues={[
                    { line: 1, message: "missing frontmatter", severity: "error" },
                    { line: 7, message: "unknown metric", severity: "warn" },
                ]}
            />
        );
        const issues = screen.getAllByTestId("md-issue");
        expect(issues[0]).toHaveTextContent("L1: missing frontmatter");
        expect(issues[1]).toHaveTextContent("L7: unknown metric");
        expect(screen.getByText(/1 error/)).toBeInTheDocument();
    });
});