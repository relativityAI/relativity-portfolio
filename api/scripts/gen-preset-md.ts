/**
 * Generates the canonical preset markdown files from the in-code preset
 * templates. Run after editing presets.ts:
 *
 *   npx tsx scripts/gen-preset-md.ts
 *
 * The committed md files are the authoring surface; mdconfig.test.ts parses
 * them back and asserts they deep-equal the code templates, so the two can
 * never silently drift.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { listPresetTemplates } from "../src/presets.js";
import { serializeMd, type AgentConfig } from "../src/mdconfig.js";

const outDir = fileURLToPath(new URL("../config/presets/", import.meta.url));

for (const { key, preset } of listPresetTemplates()) {
  const agent: AgentConfig = {
    name: preset.name,
    description: preset.description,
    persona: preset.persona,
    configuration: preset.configuration,
    asset_evaluation: preset.asset_evaluation as AgentConfig["asset_evaluation"],
    macro_evaluation: preset.macro_evaluation as AgentConfig["macro_evaluation"],
  };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(`${outDir}${key}.md`, serializeMd(agent));
  console.log(`wrote config/presets/${key}.md`);
}
console.log("done");