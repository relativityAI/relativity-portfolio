import { describe, expect, it } from "vitest";
import {
    agentChipPng,
    agentIdentity,
    agentSeed,
    hashSeed,
    providerChipPng,
} from "../src/agentIdentity.js";

// Mirrors the light-theme palette in ui/src/lib/agentIdentity.ts — the
// PDF must show the same colour the user sees in the app.
const UI_PALETTE = ["#9C4141", "#A65E33", "#8F7028", "#6B7028", "#3E6B5A", "#2F6B6B", "#46618C", "#565A94", "#7A4E82", "#A04E66", "#7A5A3E"];

describe("hashSeed", () => {
    it("is a 32-bit unsigned FNV-1a hash", () => {
        const h = hashSeed("buffett");
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThanOrEqual(0xffffffff);
        expect(hashSeed("buffett")).toBe(h);
        expect(hashSeed("munger")).not.toBe(h);
    });
});

describe("agentSeed", () => {
    it("prefers _id over id over name, with a fallback", () => {
        expect(agentSeed({ _id: "a", id: "b", name: "c" })).toBe("a");
        expect(agentSeed({ id: "b", name: "c" })).toBe("b");
        expect(agentSeed({ name: "c" })).toBe("c");
        expect(agentSeed(undefined)).toBe("agent");
        expect(agentSeed("")).toBe("agent");
    });
});

describe("agentIdentity", () => {
    it("stays in palette range and is stable", () => {
        const a = agentIdentity("seed-x");
        expect(a).toEqual(agentIdentity("seed-x"));
        for (let i = 0; i < 40; i++) {
            const { color } = agentIdentity(`s-${i}`);
            expect(UI_PALETTE).toContain(color);
        }
    });
});

describe("agentChipPng", () => {
    it("renders a PNG and is deterministic per seed", () => {
        const a = agentChipPng("value-investor");
        expect(a.length).toBeGreaterThan(0);
        expect(Buffer.compare(a, agentChipPng("value-investor"))).toBe(0);
        expect(agentChipPng("growth-scout").equals(a)).toBe(false);
        // PNG magic number
        expect(Array.from(a.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    });
});

describe("providerChipPng", () => {
    it("renders a PNG keyed by provider prefix", () => {
        const openai = providerChipPng("openai/gpt-4o");
        expect(Array.from(openai.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
        expect(providerChipPng("openai/gpt-4o-mini").equals(openai)).toBe(true);
        expect(providerChipPng("anthropic/claude-3").equals(openai)).toBe(false);
    });
});
