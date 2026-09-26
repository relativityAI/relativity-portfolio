// Server-side agent identity for PDF reports.
//
// Mirrors ui/src/lib/agentIdentity.ts so the PDF carries the same
// avatar + colour the user sees in the app: same seed precedence
// (_id → id → name), same FNV-1a hash, same 11-hue palette, same
// sepia close-up Notionists portrait on a tinted chip. The portrait is
// rasterized to PNG with resvg (same pipeline as report charts) so
// pdfmake can embed it.
import { createAvatar } from "@dicebear/core";
import * as notionists from "@dicebear/notionists";
import { Resvg } from "@resvg/resvg-js";

export interface AgentSeedLike {
    _id?: string;
    id?: string;
    name?: string;
}

export const IDENTITY_FALLBACK_SEED = "agent";

export function hashSeed(input: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

// Keep in sync with the UI palette (light theme values — print is "light").
const PALETTE: { color: string; tint: string }[] = [
    { color: "#9C4141", tint: "#F2E4E4" }, // oxblood
    { color: "#A65E33", tint: "#F3E7DD" }, // rust
    { color: "#8F7028", tint: "#EFE9D8" }, // ochre
    { color: "#6B7028", tint: "#EAEBDB" }, // olive
    { color: "#3E6B5A", tint: "#E1EBE6" }, // pine
    { color: "#2F6B6B", tint: "#E0EBEB" }, // teal
    { color: "#46618C", tint: "#E3E8F0" }, // steel
    { color: "#565A94", tint: "#E7E8F1" }, // indigo
    { color: "#7A4E82", tint: "#EEE6F0" }, // plum
    { color: "#A04E66", tint: "#F4E5EA" }, // rosewood
    { color: "#7A5A3E", tint: "#EFE8E0" }, // umber
];

export function agentSeed(agent?: AgentSeedLike | string | null): string {
    if (!agent) return IDENTITY_FALLBACK_SEED;
    if (typeof agent === "string") return agent.trim() || IDENTITY_FALLBACK_SEED;
    return agent._id || agent.id || agent.name?.trim() || IDENTITY_FALLBACK_SEED;
}

export function agentIdentity(seed: string): { color: string; tint: string } {
    return PALETTE[hashSeed(seed) % PALETTE.length];
}

// Sepia wash matching the UI's CSS filter (sepia(0.52) saturate(0.72)
// contrast(0.96)) expressed as an SVG feColorMatrix so resvg applies it.
const SEPIA_FILTER =
    '<filter id="agentIdentitySepia" color-interpolation-filters="sRGB">' +
    '<feColorMatrix type="matrix" values="' +
    "0.55 0.62 0.22 0 0.06  " +
    "0.31 0.55 0.20 0 0.05  " +
    "0.21 0.38 0.15 0 0.04  " +
    "0 0 0 1 0\"/></filter>";

const chipCache = new Map<string, Buffer>();

/**
 * The agent's identity chip (sepia portrait on tinted rounded square)
 * rendered to a PNG buffer at 4x for print sharpness.
 */
export function agentChipPng(seed: string, px = 128): Buffer {
    const cached = chipCache.get(seed);
    if (cached) return cached;

    const { color, tint } = agentIdentity(seed);
    const svg = createAvatar(notionists, { seed, scale: 140, translateY: 6 }).toString();

    // Strip the outer <svg> wrapper so the portrait can be nested inside
    // the chip artwork and scaled to the chip's inner square.
    const inner = svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
    const viewBox = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
    const src = viewBox ? Number(viewBox[1]) || 1744 : 1744;
    const pad = Math.round(px * 0.05); // portrait fills 90% of the chip
    const scale = (px - pad * 2) / src;

    const chip =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}">` +
        `<defs>${SEPIA_FILTER}</defs>` +
        `<rect width="${px}" height="${px}" rx="${Math.round(px * 0.06)}" fill="${tint}"/>` +
        `<rect x="0.5" y="0.5" width="${px - 1}" height="${px - 1}" rx="${Math.round(px * 0.06) - 0.5}" fill="none" stroke="${color}" stroke-opacity="0.38"/>` +
        `<g filter="url(#agentIdentitySepia)"><g transform="translate(${pad} ${pad}) scale(${scale})">${inner}</g></g>` +
        `</svg>`;

    const resvg = new Resvg(chip, { fitTo: { mode: "width", value: px * 4 } });
    const png = Buffer.from(resvg.render().asPng());
    if (chipCache.size < 256) chipCache.set(seed, png);
    return png;
}

/* ─── Model provider chip ──────────────────────────────────────────────── */

import { PROVIDER_ICON_PATHS } from "./providerIcons.js";

const PROVIDER_COLORS: Record<string, string> = {
    openai: "#10A37F",
    anthropic: "#D97757",
    google: "#4285F4",
    gemini: "#4285F4",
    meta: "#0668E1",
    "meta-llama": "#0668E1",
    mistral: "#FA500F",
    mistralai: "#FA500F",
    nvidia: "#76B900",
    ollama: "#16181B",
    perplexity: "#20808D",
};
export function modelProvider(model?: string | null): string {
    const id = (model || "").trim().toLowerCase();
    return id ? id.split("/")[0] : "unknown";
}

function providerInitial(model?: string | null): string {
    const p = modelProvider(model);
    return p === "unknown" ? "M" : p.charAt(0).toUpperCase();
}

const providerCache = new Map<string, Buffer>();

/**
 * The provider's true brand mark (Simple Icons path data, same source as
 * the UI's react-icons) rasterized at 4x for print sharpness. Falls back
 * to a monogram chip only for providers with no mark available.
 */
export function providerChipPng(model: string | undefined | null, px = 96): Buffer {
    const raw = modelProvider(model);
    // Normalize id-prefix variants to the icon/color keys.
    const key = raw === "gemini" ? "google" : raw === "mistralai" ? "mistral" : raw === "meta-llama" ? "meta" : raw;
    const cached = providerCache.get(key);
    if (cached) return cached;

    const color = PROVIDER_COLORS[key] || "#6B7280";
    const iconPath = PROVIDER_ICON_PATHS[key];
    let svg: string;
    if (iconPath) {
        // Brand mark on a white tile, matching the UI's rendering context.
        svg =
            `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}">` +
            `<rect width="${px}" height="${px}" rx="${Math.round(px * 0.14)}" fill="#FFFFFF" stroke="#D9D9D5"/>` +
            `<g transform="scale(${px / 24})"><path d="${iconPath.d}" fill="${color}"/></g>` +
            `</svg>`;
    } else {
        const initial = key === "unknown" ? "M" : key.charAt(0).toUpperCase();
        svg =
            `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}">` +
            `<rect width="${px}" height="${px}" rx="${Math.round(px * 0.14)}" fill="#FFFFFF" stroke="#D9D9D5"/>` +
            `<text x="${px / 2}" y="${Math.round(px * 0.72)}" font-family="Helvetica, Arial, sans-serif" font-size="${Math.round(px * 0.6)}" font-weight="600" fill="${color}" text-anchor="middle">${initial}</text>` +
            `</svg>`;
    }

    const resvg = new Resvg(svg, { fitTo: { mode: "width", value: px * 4 } });
    const png = Buffer.from(resvg.render().asPng());
    if (providerCache.size < 64) providerCache.set(key, png);
    return png;
}
