import type { LayoutTree, LayoutSlot, PlotSpec } from "../types/plots.js";

export function buildLayoutTree(blocks: any[], plotSpecs: PlotSpec[]): LayoutTree {
  const sections: LayoutSlot[] = [];
  const textIds = (blocks || [])
    .map((_, i) => `block-${i}`)
    .filter((id, i) => (blocks[i]?.type === "paragraph" || blocks[i]?.type === "heading" || blocks[i]?.type === "callout" || blocks[i]?.type === "quote"));
  // Simple proximity: put plots after related text blocks if they share context? For now, interleave charts with headings context
  // Prefer placing lightweight plots after their originating chart blocks by index
  let plotIdx = 0;
  for (let i = 0; i < (blocks || []).length; i++) {
    const b = blocks[i];
    sections.push({ type: "text", blockId: `block-${i}`, anchor: b?.type === "heading" ? `h-${i}` : undefined });
    if (b?.type === "chart" && plotIdx < plotSpecs.length) {
      const p = plotSpecs[plotIdx++];
      sections.push({
        type: "plot",
        specId: p.id,
        blockId: `block-${i}`,
        placement: { relativeTo: `block-${i}`, position: "after" },
        caption: p.caption,
        interactive: p.interactive ?? true,
      });
    }
  }
  // Any remaining plots go to end
  for (; plotIdx < plotSpecs.length; plotIdx++) {
    const p = plotSpecs[plotIdx];
    sections.push({
      type: "plot",
      specId: p.id,
      placement: { position: "end" },
      caption: p.caption,
      interactive: p.interactive ?? true,
    });
  }
  return {
    version: 1,
    sections,
    constraints: { maxPlotsPerSection: 2, dedupeBySpecId: true },
  };
}
