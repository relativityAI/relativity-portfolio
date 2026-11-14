import { beforeEach, describe, expect, it } from "vitest";
import {
    DEFAULT_AGENTS,
    activeDefaultAgentIds,
    saveActiveDefaultAgentIds,
} from "@/lib/defaultAgents";

const KEY = "relativity.active-default-agents";

describe("default agent active set", () => {
    beforeEach(() => localStorage.clear());

    it("defaults to every default agent active", () => {
        expect(activeDefaultAgentIds()).toEqual(new Set(DEFAULT_AGENTS.map((a) => a.id)));
    });

    it("round-trips a saved subset", () => {
        const subset = new Set(DEFAULT_AGENTS.slice(0, 3).map((a) => a.id));
        saveActiveDefaultAgentIds(subset);
        expect(activeDefaultAgentIds()).toEqual(subset);
    });

    it("treats corrupt storage as all-active", () => {
        localStorage.setItem(KEY, "{nope");
        expect(activeDefaultAgentIds().size).toBe(DEFAULT_AGENTS.length);
    });

    it("keeps an explicit empty set empty (all toggled off)", () => {
        saveActiveDefaultAgentIds(new Set());
        expect(activeDefaultAgentIds().size).toBe(0);
    });
});
