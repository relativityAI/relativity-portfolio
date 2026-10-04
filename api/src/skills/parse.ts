/**
 * Minimal Agent Skills format validation.
 *
 * A skill is a SKILL.md document with YAML frontmatter and an unrestricted
 * Markdown body. The body is kept verbatim; the runtime must not infer a
 * Relativity-specific schema from its headings or prose.
 */

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { SkillCategory, SkillDefinition } from "./types.js";

/** Agent Skills `name`: 1-64 lowercase letters/digits/single hyphens. */
export const SPEC_NAME_RE = /^(?!.*--)[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
export const SPEC_NAME_ERR =
  "name must be 1-64 chars of lowercase letters, digits and single hyphens (no leading, trailing or doubled hyphen)";

export function slugifySkillName(input: string): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 64)
    .replace(/-$/, "");
  return slug || "custom-skill";
}

export interface SkillIssue {
  line: number;
  message: string;
  severity: "error" | "warn";
}

export interface SkillParseResult {
  skill: SkillDefinition | null;
  issues: SkillIssue[];
  opaque: { heading: string; text: string }[];
  extraFrontmatter: [string, string][];
}

function humanizeName(name: string): string {
  return name.replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
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

export function parseSkillMarkdown(
  src: string,
  source: "builtin" | "custom" = "custom",
  expectedName?: string,
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
      opaque: [],
      extraFrontmatter: [],
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
  const metadata = frontmatter.metadata;
  if (metadata !== undefined && (!metadata || typeof metadata !== "object" || Array.isArray(metadata) ||
      Object.values(metadata as Record<string, unknown>).some((value) => typeof value !== "string"))) {
    issues.push({ line: 1, message: "metadata must be a map of string keys to string values", severity: "error" });
  }
  if (expectedName && typeof name === "string" && name !== expectedName) {
    issues.push({ line: 1, message: `frontmatter name "${name}" must match skill directory "${expectedName}"`, severity: "error" });
  }

  const opaque = body.split(/(?=^##\s+)/m).flatMap((section) => {
    const heading = section.match(/^##\s+(.+?)\s*$/m)?.[1];
    return heading ? [{ heading, text: section.replace(/^##\s+.+?\s*\r?\n/, "").trim() }] : [];
  });
  const extraFrontmatter = Object.entries(frontmatter)
    .filter(([key]) => !["name", "description", "license", "compatibility", "allowed-tools", "metadata"].includes(key))
    .map(([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value)] as [string, string]);

  if (issues.some(({ severity }) => severity === "error")) {
    return { skill: null, issues, opaque, extraFrontmatter };
  }

  const fmMetadata = (metadata || {}) as Record<string, string>;
  const slug = name as string;
  const category = (fmMetadata.category && ["valuation", "fundamentals", "qualitative", "market", "macro", "custom"].includes(fmMetadata.category)
    ? fmMetadata.category
    : "custom") as SkillCategory;

  return {
    skill: {
      id: slug,
      name: fmMetadata.title || humanizeName(slug),
      description: description as string,
      category,
      version: Number(fmMetadata.version) > 0 ? Number(fmMetadata.version) : 1,
      purpose: body.trim(),
      // Skill prose remains opaque. The agent chooses whether and how to use
      // available tools; the loader does not extract a tool schema from it.
      data: [],
      method: [],
      source,
      markdown: src,
    },
    issues,
    opaque,
    extraFrontmatter,
  };
}

/** Keep a skill's original frontmatter and body byte-for-byte when available. */
export function serializeSkill(skill: SkillDefinition): string {
  if (skill.markdown) return skill.markdown;
  const frontmatter: Record<string, unknown> = {
    name: SPEC_NAME_RE.test(skill.id) ? skill.id : slugifySkillName(skill.id),
    description: skill.description,
  };
  if (skill.data.length) frontmatter["allowed-tools"] = skill.data.join(" ");
  if (skill.name !== humanizeName(String(frontmatter.name))) frontmatter.metadata = { title: skill.name };
  return `---\n${stringifyYaml(frontmatter).trimEnd()}\n---\n\n${skill.purpose || ""}`;
}

/** Frontmatter-only peek for listing. */
export function peekSkillMeta(src: string): { id: string; name: string; description: string; category: string } | null {
  try {
    const { frontmatter } = readFrontmatter(src);
    const id = typeof frontmatter.name === "string" ? frontmatter.name : "";
    if (!id) return null;
    const metadata = frontmatter.metadata && typeof frontmatter.metadata === "object"
      ? frontmatter.metadata as Record<string, unknown>
      : {};
    return {
      id,
      name: typeof metadata.title === "string" ? metadata.title : humanizeName(id),
      description: typeof frontmatter.description === "string" ? frontmatter.description : "",
      category: typeof metadata.category === "string" ? metadata.category : "custom",
    };
  } catch {
    return null;
  }
}
