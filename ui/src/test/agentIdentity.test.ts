import { describe, expect, it } from "vitest";
import {
    IDENTITY_FALLBACK_SEED,
    agentAvatarSvg,
    agentIdentity,
    agentSeed,
    hashSeed,
    resolveAgent,
    type AgentSeedLike,
} from "@/lib/agentIdentity";

describe("hashSeed", () => {
    it("is deterministic for the same input", () => {
        expect(hashSeed("agent-123")).toBe(hashSeed("agent-123"));
    });

    it("distinguishes different inputs", () => {
        expect(hashSeed("agent-1")).not.toBe(hashSeed("agent-2"));
    });

    it("returns a 32-bit unsigned integer", () => {
        for (const s of ["", "a", "buffett", "value-investor-99"]) {
            const h = hashSeed(s);
            expect(h).toBeGreaterThanOrEqual(0);
            expect(h).toBeLessThanOrEqual(0xffffffff);
        }
    });
});

describe("agentSeed", () => {
    it("prefers _id over id over name", () => {
        const agent: AgentSeedLike = { _id: "id1", id: "id2", name: "Value Investor" };
        expect(agentSeed(agent)).toBe("id1");

        expect(agentSeed({ id: "id2", name: "Value Investor" })).toBe("id2");
        expect(agentSeed({ name: "Value Investor" })).toBe("Value Investor");
    });

    it("falls back to the default seed for empty agents", () => {
        expect(agentSeed(undefined)).toBe(IDENTITY_FALLBACK_SEED);
        expect(agentSeed(null)).toBe(IDENTITY_FALLBACK_SEED);
        expect(agentSeed({})).toBe(IDENTITY_FALLBACK_SEED);
        expect(agentSeed({ name: "   " })).toBe(IDENTITY_FALLBACK_SEED);
    });

    it("accepts a raw string seed", () => {
        expect(agentSeed("abc")).toBe("abc");
        expect(agentSeed("")).toBe(IDENTITY_FALLBACK_SEED);
    });
});

describe("agentIdentity", () => {
    it("is stable for the same seed", () => {
        expect(agentIdentity("seed-x")).toEqual(agentIdentity("seed-x"));
    });

    it("keeps the identity when an agent is renamed", () => {
        // Color + face derive from the id, not the name.
        const before = agentIdentity(agentSeed({ _id: "stable-id", name: "Old Name" }));
        const after = agentIdentity(agentSeed({ _id: "stable-id", name: "New Name" }));
        expect(after.index).toBe(before.index);
    });

    it("spreads agents across the palette", () => {
        const indexes = new Set<number>();
        for (let i = 0; i < 30; i++) {
            indexes.add(agentIdentity(`agent-${i}`).index);
        }
        // 30 seeds over 11 hues should land on most of them.
        expect(indexes.size).toBeGreaterThanOrEqual(5);
    });

    it("only produces palette indexes in range", () => {
        for (let i = 0; i < 50; i++) {
            const { index } = agentIdentity(`seed-${i}`);
            expect(index).toBeGreaterThanOrEqual(0);
            expect(index).toBeLessThan(11);
        }
    });

    it("provides light and dark variants for every entry", () => {
        for (let i = 0; i < 50; i++) {
            const { color, tint } = agentIdentity(`seed-${i}`);
            for (const theme of ["light", "dark"] as const) {
                expect(color[theme]).toMatch(/^#[0-9A-Fa-f]{6}$/);
                expect(tint[theme]).toMatch(/^#[0-9A-Fa-f]{6}$/);
            }
        }
    });
});

describe("resolveAgent", () => {
    const agents: AgentSeedLike[] = [
        { _id: "mongo-1", name: "Value Investor" },
        { id: "rest-2", name: "Growth Scout" },
    ];

    it("resolves by name, _id, and id", () => {
        expect(resolveAgent("Value Investor", agents)).toBe(agents[0]);
        expect(resolveAgent("mongo-1", agents)).toBe(agents[0]);
        expect(resolveAgent("Growth Scout", agents)).toBe(agents[1]);
        expect(resolveAgent("rest-2", agents)).toBe(agents[1]);
    });

    it("falls back to the raw string when unresolved", () => {
        expect(resolveAgent("deleted-agent", agents)).toBe("deleted-agent");
        expect(resolveAgent(undefined, agents)).toBe(IDENTITY_FALLBACK_SEED);
    });
});

describe("agentAvatarSvg", () => {
    it("returns deterministic inline SVG per seed", () => {
        const a = agentAvatarSvg("agent-abc");
        expect(a).toBe(agentAvatarSvg("agent-abc"));
        expect(a).toContain("<svg");
    });

    it("varies with the seed", () => {
        expect(agentAvatarSvg("agent-abc")).not.toBe(agentAvatarSvg("agent-xyz"));
    });

    it("does not bake in a background color (chip supplies the tint)", () => {
        const svg = agentAvatarSvg("agent-abc");
        // The only filled rect DiceBear emits for a transparent render is
        // the internal viewbox mask (fill="#fff"). Any other filled rect
        // would be a baked-in background fighting the chip tint.
        expect(svg).not.toMatch(/<rect(?![^>]*fill="#fff")[^>]*fill="#/);
    });
});
