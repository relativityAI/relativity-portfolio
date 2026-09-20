/**
 * Deterministic agent identity.
 *
 * Every agent carries a stable visual identity derived purely from its
 * own data — no DB fields, no user setup:
 *
 *  - The seed is the agent's stable id (`_id || id || name`). The same
 *    seed drives BOTH the color and the Notionists portrait, so an
 *    agent looks identical on every screen and across sessions.
 *    Renames don't change the identity; deleting and recreating an
 *    agent (new id) intentionally does.
 *
 *  - Portraits render in sepia (CSS filter in AgentAvatar) so they read
 *    like engraved investor likenesses rather than playful cartoons,
 *    sitting on a muted chip in the agent's color.
 *
 *  - The palette is curated to sit beside the app's monochrome design
 *    system. The system accent blue (--accent-primary) is deliberately
 *    excluded so "blue = UI affordance" never collides with an agent.
 */
import { createAvatar } from "@dicebear/core";
// Import the style package directly — the collection barrel pulls in all
// 30+ styles (~120 kB gz). Only notionists is needed.
import * as notionists from "@dicebear/notionists";

export interface AgentSeedLike {
    _id?: string;
    id?: string;
    name?: string;
}

/** FNV-1a 32-bit hash — stable across sessions, no dependencies. */
export function hashSeed(input: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

interface PaletteEntry {
    /** Accent-capable hue: text, dots, rules, chart strokes. */
    color: { light: string; dark: string };
    /** Chip background behind the sepia portrait. */
    tint: { light: string; dark: string };
}

/**
 * 11 muted, professional hues. Saturation and lightness are held in a
 * narrow band so any agent chip looks at home next to the monochrome UI.
 */
const PALETTE: PaletteEntry[] = [
    { color: { light: "#9C4141", dark: "#D98F8F" }, tint: { light: "#F2E4E4", dark: "#2E2326" } }, // oxblood
    { color: { light: "#A65E33", dark: "#DCA478" }, tint: { light: "#F3E7DD", dark: "#322722" } }, // rust
    { color: { light: "#8F7028", dark: "#CDB061" }, tint: { light: "#EFE9D8", dark: "#2E2A1F" } }, // ochre
    { color: { light: "#6B7028", dark: "#ADAF62" }, tint: { light: "#EAEBDB", dark: "#292B1E" } }, // olive
    { color: { light: "#3E6B5A", dark: "#8FB8A6" }, tint: { light: "#E1EBE6", dark: "#22302B" } }, // pine
    { color: { light: "#2F6B6B", dark: "#83B3B3" }, tint: { light: "#E0EBEB", dark: "#20302F" } }, // teal
    { color: { light: "#46618C", dark: "#93A9CE" }, tint: { light: "#E3E8F0", dark: "#252C3A" } }, // steel
    { color: { light: "#565A94", dark: "#A6A9D8" }, tint: { light: "#E7E8F1", dark: "#2A2C3D" } }, // indigo
    { color: { light: "#7A4E82", dark: "#C29BC9" }, tint: { light: "#EEE6F0", dark: "#2F2734" } }, // plum
    { color: { light: "#A04E66", dark: "#D898AB" }, tint: { light: "#F4E5EA", dark: "#342630" } }, // rosewood
    { color: { light: "#7A5A3E", dark: "#C2A084" }, tint: { light: "#EFE8E0", dark: "#2F2923" } }, // umber
];

export interface AgentIdentity {
    /** Stable identity seed (id preferred over name). */
    seed: string;
    /** Palette index — useful for tests and future chart-series mapping. */
    index: number;
    /** Theme-resolved values (pick with useColorModeValue). */
    color: { light: string; dark: string };
    tint: { light: string; dark: string };
}

export const IDENTITY_FALLBACK_SEED = "agent";

/** Seed precedence: Mongo _id → API id → name → fallback. */
export function agentSeed(agent?: AgentSeedLike | string | null): string {
    if (!agent) return IDENTITY_FALLBACK_SEED;
    if (typeof agent === "string") return agent.trim() || IDENTITY_FALLBACK_SEED;
    return agent._id || agent.id || agent.name?.trim() || IDENTITY_FALLBACK_SEED;
}

export function agentIdentity(seed: string): AgentIdentity {
    const index = hashSeed(seed) % PALETTE.length;
    const entry = PALETTE[index];
    return { seed, index, color: entry.color, tint: entry.tint };
}

/**
 * Resolve a raw agent reference (a name or an id, as stored on
 * analyses) back to the agent object, so identity is keyed on the same
 * stable seed everywhere. Falls back to the raw string when the agent
 * list is unavailable or the agent was deleted — still deterministic.
 */
export function resolveAgent(
    raw: string | undefined | null,
    agents: AgentSeedLike[] = []
): AgentSeedLike | string {
    if (!raw) return IDENTITY_FALLBACK_SEED;
    const hit = agents.find((a) => a.name === raw || a._id === raw || a.id === raw);
    return hit ?? raw;
}

/* ─── Portrait rendering (sepia Notionists, transparent background) ─────── */

const svgCache = new Map<string, string>();

/**
 * Inline SVG string for the agent's portrait. Memoized per seed —
 * DiceBear is deterministic, so the cache never goes stale.
 */
export function agentAvatarSvg(seed: string): string {
    const cached = svgCache.get(seed);
    if (cached) return cached;
    const svg = createAvatar(notionists, {
        seed,
        // Close-up framing: zoom in on the head so the face stays clearly
        // legible at chip sizes, nudged up to keep it centered.
        scale: 140,
        translateY: 6,
        // No backgroundColor → transparent; the chip supplies the tint.
    }).toString();
    if (svgCache.size < 512) svgCache.set(seed, svg);
    return svg;
}
