/**
 * agentskills.io skill loader.
 *
 * A skill is a directory with a SKILL.md: YAML frontmatter (name, description,
 * optional license/compatibility/metadata/allowed-tools) plus an unrestricted
 * Markdown body. The body stays opaque — the runtime never infers a
 * Relativity-specific schema from its prose.
 *
 * Spec: https://agentskills.io/specification
 */

import { parse as parseYaml } from "yaml";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

export const SPEC_NAME_RE = /^(?!.*--)[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
export const SPEC_NAME_ERR =
  "name must be 1-64 chars of lowercase letters, digits and single hyphens (no leading, trailing or doubled hyphen)";

export type SkillSource = "builtin" | "custom";

export interface HarnessSkill {
  id: string;
  name: string;
  description: string;
  category: string;
  version: number;
  source: SkillSource;
  /** Tools this skill may call, from frontmatter allowed-tools. */
  allowedTools: string[];
  /**
   * Frontmatter `citations: inline` — the skill's report-structure forbids
   * footnotes; assembly links [src:…] tokens inline instead of stamping them.
   */
  citations?: "inline";
  /** Markdown body (opaque instructions). */
  body: string;
  /** Skill directory, when it exists on disk (built-ins). */
  dir: string | null;
  /** On-demand reference files, loaded by activation. */
  references: { path: string; text: string }[];
}

export interface SkillIssue {
  line: number;
  message: string;
  severity: "error" | "warn";
}

export interface SkillParseResult {
  skill: HarnessSkill | null;
  issues: SkillIssue[];
}

function readFrontmatter(src: string): { frontmatter: Record<string, unknown>; body: string } {
  const normalized = src.startsWith("\uFEFF") ? src.slice(1) : src;
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) throw new Error("SKILL.md must start with YAML frontmatter delimited by ---");
  const parsed: unknown = parseYaml(match[1]);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("YAML frontmatter must be a mapping");
  }
  return { frontmatter: parsed as Record<string, unknown>, body: match[2] || "" };
}

function humanizeName(name: string): string {
  return name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function readReferences(dir: string): { path: string; text: string }[] {
  const refDir = join(dir, "references");
  if (!existsSync(refDir)) return [];
  const out: { path: string; text: string }[] = [];
  for (const entry of readdirSync(refDir).sort()) {
    const file = join(refDir, entry);
    try {
      if (statSync(file).isFile()) out.push({ path: `references/${entry}`, text: readFileSync(file, "utf8") });
    } catch {
      // unreadable reference — skip
    }
  }
  return out;
}

export function parseSkillMarkdown(
  src: string,
  source: SkillSource = "custom",
  expectedName?: string,
  dir: string | null = null,
): SkillParseResult {
  const issues: SkillIssue[] = [];
  let frontmatter: Record<string, unknown>;
  let body: string;
  try {
    ({ frontmatter, body } = readFrontmatter(src));
  } catch (error) {
    return {
      skill: null,
      issues: [{ line: 1, message: error instanceof Error ? error.message : "Invalid YAML frontmatter", severity: "error" }],
    };
  }

  const name = frontmatter.name;
  const description = frontmatter.description;
  if (typeof name !== "string" || !SPEC_NAME_RE.test(name)) {
    issues.push({ line: 1, message: typeof name === "string" ? SPEC_NAME_ERR : "frontmatter name is required", severity: "error" });
  }
  if (typeof description !== "string" || description.length < 1 || description.length > 1024) {
    issues.push({
      line: 1,
      message: typeof description !== "string" || !description ? "frontmatter description is required" : "description must be 1024 characters or fewer",
      severity: "error",
    });
  }
  if (frontmatter.license !== undefined && typeof frontmatter.license !== "string") {
    issues.push({ line: 1, message: "license must be a string", severity: "error" });
  }
  if (frontmatter.compatibility !== undefined &&
      (typeof frontmatter.compatibility !== "string" || frontmatter.compatibility.length > 500)) {
    issues.push({ line: 1, message: "compatibility must be a string of 500 characters or fewer", severity: "error" });
  }
  if (frontmatter["allowed-tools"] !== undefined && typeof frontmatter["allowed-tools"] !== "string") {
    issues.push({ line: 1, message: "allowed-tools must be a space-separated string", severity: "error" });
  }
  if (frontmatter.citations !== undefined && frontmatter.citations !== "inline" && frontmatter.citations !== "footnotes") {
    issues.push({ line: 1, message: 'citations must be "inline" or "footnotes"', severity: "error" });
  }
  const metadata = frontmatter.metadata;
  if (metadata !== undefined && (!metadata || typeof metadata !== "object" || Array.isArray(metadata) ||
      Object.values(metadata as Record<string, unknown>).some((v) => typeof v !== "string"))) {
    issues.push({ line: 1, message: "metadata must be a map of string keys to string values", severity: "error" });
  }
  if (expectedName && typeof name === "string" && name !== expectedName) {
    issues.push({ line: 1, message: `frontmatter name "${name}" must match skill directory "${expectedName}"`, severity: "error" });
  }

  if (issues.some(({ severity }) => severity === "error")) return { skill: null, issues };

  const fmMetadata = (metadata || {}) as Record<string, string>;
  const allowedTools = typeof frontmatter["allowed-tools"] === "string"
    ? frontmatter["allowed-tools"].split(/\s+/).filter(Boolean)
    : [];
  const skillDir = dir ?? (expectedName ? join(process.cwd(), "config", "skills", expectedName) : null);

  return {
    skill: {
      id: name as string,
      name: fmMetadata.title || humanizeName(name as string),
      description: description as string,
      category: fmMetadata.category || "custom",
      version: Number(fmMetadata.version) > 0 ? Number(fmMetadata.version) : 1,
      source,
      allowedTools,
      ...(frontmatter.citations === "inline" ? { citations: "inline" as const } : {}),
      body: body.trim(),
      dir: skillDir,
      references: skillDir ? readReferences(skillDir) : [],
    },
    issues,
  };
}
