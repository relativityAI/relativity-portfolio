import { describe, it, expect, beforeAll } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MenuDropdown, DropdownItem } from "@/pages/shared/AnalysisControls";

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
    if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

function SearchHost() {
    const [q, setQ] = useState("");
    const items = ["TCS", "INFY"].filter((i) => i.includes(q.toUpperCase()));
    return (
        <MenuDropdown
            value="TCS"
            placeholder="Search companies..."
            search={{ value: q, onChange: setQ, placeholder: "Search US stocks" }}
        >
            {(close) => (
                <div>
                    {items.map((i) => (
                        <DropdownItem key={i} label={i} onClick={close} />
                    ))}
                </div>
            )}
        </MenuDropdown>
    );
}

describe("MenuDropdown inline search", () => {
    it("first click lands in the trigger's own input and typing filters", async () => {
        const user = userEvent.setup();
        render(<SearchHost />);

        const input = screen.getByPlaceholderText("Search companies...");
        await user.click(input);

        // In place: same field becomes the search box, panel opens, focus is in it.
        expect(document.activeElement).toBe(input);
        expect(screen.getByRole("listbox")).toBeInTheDocument();
        expect(screen.getByPlaceholderText("Search US stocks")).toBeInTheDocument();

        await user.keyboard("INF");
        expect(screen.getByRole("option", { name: /INFY/ })).toBeInTheDocument();
        expect(screen.queryByRole("option", { name: /TCS/ })).not.toBeInTheDocument();
    });

    it("keeps the selection when closed", () => {
        render(<SearchHost />);
        const input = screen.getByDisplayValue("TCS") as HTMLInputElement;
        expect(input.tagName).toBe("INPUT");
        expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });
});
