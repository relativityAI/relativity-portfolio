import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { LAYOUT_AGENT_SYSTEM_PROMPT } from "../src/prompts.js";

// The library the ui registers lives in ui/src/lib/openui.tsx; its emitted
// JSON Schema is committed so the api prompt can be checked against it without
// importing React. Drift here means the model is told about a component that
// does not exist (or misses one that does).
const spec = JSON.parse(
  readFileSync(resolve(__dirname, "../../ui/src/lib/openui.spec.json"), "utf8"),
) as { $defs?: Record<string, unknown> };

const catalogued = new Set<string>();
for (const line of LAYOUT_AGENT_SYSTEM_PROMPT.split("\n")) {
  const m = /^- (?:root\s*=\s*)?([A-Za-z0-9_]+)\(/.exec(line.trim());
  if (m) catalogued.add(m[1]);
}

describe("layout agent prompt", () => {
  it("documents exactly the components in the ui library spec", () => {
    const library = new Set(Object.keys(spec.$defs ?? {}));
    // SkillScoreCard still exists in the ui so old persisted reports render,
    // but newly generated layouts never carry scores — so the prompt omits it.
    library.delete("SkillScoreCard");
    expect([...catalogued].sort()).toEqual([...library].sort());
  });
});
