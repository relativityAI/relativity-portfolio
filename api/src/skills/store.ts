/**
 * Skill registry — built-in skills shipped with the API plus user-created
 * custom skills from the `skills` table. Built-ins are read from
 * api/config/skills/<name>/SKILL.md at boot (Agent Skills spec layout);
 * customs are read/written through Supabase.
 */

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { getDb } from "../db.js";
import { log } from "../logger.js";
import { parseSkillMarkdown, serializeSkill, type SkillIssue } from "./parse.js";
import type { SkillDefinition } from "./types.js";

const BUILTIN_DIR = join(process.cwd(), "config", "skills");

let builtinCache: SkillDefinition[] | null = null;

/** Every <slug>/SKILL.md under the builtin root, sorted by slug. */
function builtinSkillFiles(): { slug: string; file: string }[] {
  const out: { slug: string; file: string }[] = [];
  let entries: string[];
  try {
    entries = readdirSync(BUILTIN_DIR);
  } catch (e: any) {
    log.warn("skills", `builtin skills dir unavailable (${e?.message}) — running without built-ins`);
    return out;
  }
  for (const entry of entries.sort()) {
    const dir = join(BUILTIN_DIR, entry);
    let isDir = false;
    try {
      isDir = statSync(dir).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;
    const file = join(dir, "SKILL.md");
    if (existsSync(file)) out.push({ slug: entry, file });
  }
  return out;
}

export function loadBuiltinSkills(): SkillDefinition[] {
  if (builtinCache) return builtinCache;
  const out: SkillDefinition[] = [];
  for (const { slug, file } of builtinSkillFiles()) {
    try {
      const md = readFileSync(file, "utf8");
      const { skill, issues } = parseSkillMarkdown(md, "builtin", slug);
      if (skill) {
        out.push(skill);
      } else {
        log.warn("skills", `builtin skill ${slug} failed to parse: ${issues.map((i) => i.message).join("; ")}`);
      }
    } catch (e: any) {
      log.warn("skills", `builtin skill ${slug} read failed: ${e?.message}`);
    }
  }
  builtinCache = out;
  return out;
}

export function getBuiltinSkill(id: string): SkillDefinition | null {
  return loadBuiltinSkills().find((s) => s.id === id) || null;
}

// ── Custom skills (per-user, Supabase) ────────────────────────────────────

export interface CustomSkillRow {
  id: string;
  user_id: string;
  skill_id: string;
  markdown: string;
  files?: Record<string, string> | null;
  created_at?: string;
  updated_at?: string;
}

/**
 * A skill's directory as a flat path -> content map (agentskills.io layout).
 * Folder keys end with "/" and hold "" so empty dirs (references/, assets/)
 * survive the round-trip; files may be nested at any depth.
 */
export type SkillFiles = Record<string, string>;

/**
 * Validate an untrusted file map from a request body. Returns null when the
 * tree is unusable: SKILL.md must exist and be non-empty, every value must be
 * a string, folders (trailing "/") must be empty, and no path may be absolute
 * or escape the skill directory.
 */
export function normalizeSkillFiles(raw: unknown): SkillFiles | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: SkillFiles = {};
  for (const [path, content] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof content !== "string") return null;
    if (!path || path.startsWith("/") || path.includes("\\")) return null;
    const segments = path.split("/");
    if (path.endsWith("/")) segments.pop(); // the trailing "" is the folder marker
    if (!segments.length || segments.some((s) => s === "" || s === "." || s === "..")) return null;
    if (path.endsWith("/") && content !== "") return null;
    out[path] = content;
  }
  if (!out["SKILL.md"]?.trim()) return null;
  return out;
}

const TEXT_EXTS = new Set([
  "md", "txt", "json", "yaml", "yml", "csv", "ts", "tsx", "js", "jsx",
  "py", "sh", "toml", "ini", "html", "css", "xml", "svg", "sql",
]);
const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", ico: "image/x-icon", pdf: "application/pdf", zip: "application/zip",
};

/** One file: text as utf8, anything else as a base64 data URL (binary-safe). */
function readFileContent(abs: string): string {
  const ext = abs.split(".").pop()?.toLowerCase() || "";
  if (TEXT_EXTS.has(ext)) return readFileSync(abs, "utf8");
  return `data:${MIME[ext] || "application/octet-stream"};base64,${readFileSync(abs).toString("base64")}`;
}

/** Walk a skill directory on disk into the flat map. */
function readSkillDir(dir: string): SkillFiles {
  const out: SkillFiles = {};
  const walk = (rel: string) => {
    let entries: string[];
    try {
      entries = readdirSync(join(dir, rel));
    } catch {
      return;
    }
    for (const entry of entries.sort()) {
      const abs = join(dir, rel, entry);
      const path = rel ? `${rel}/${entry}` : entry;
      let isDir = false;
      try {
        isDir = statSync(abs).isDirectory();
      } catch {
        continue;
      }
      if (isDir) {
        out[path + "/"] = "";
        walk(path);
      } else {
        out[path] = readFileContent(abs);
      }
    }
  };
  walk("");
  return out;
}

/** Files of a built-in skill directory. Null when the slug isn't a builtin. */
export function getBuiltinSkillFiles(slug: string): SkillFiles | null {
  if (!builtinSkillFiles().some((s) => s.slug === slug)) return null;
  return readSkillDir(join(BUILTIN_DIR, slug));
}

/** Files of one custom skill: row.files plus SKILL.md from the markdown column. */
export async function getCustomSkillFiles(userId: string, skillId: string): Promise<SkillFiles | null> {
  const db = getDb();
  const { data, error } = await db.from("skills").select("markdown,files").eq("user_id", userId).eq("skill_id", skillId).maybeSingle();
  if (error || !data) return null;
  const out: SkillFiles = {};
  const rest = data.files;
  if (rest && typeof rest === "object" && !Array.isArray(rest)) {
    for (const [path, content] of Object.entries(rest as Record<string, unknown>)) {
      if (typeof content === "string") out[path] = content;
    }
  }
  out["SKILL.md"] = data.markdown; // the markdown column is authoritative
  return out;
}

function rowToDefinition(row: CustomSkillRow): SkillDefinition | null {
  const { skill } = parseSkillMarkdown(row.markdown, "custom", row.skill_id);
  return skill ? { ...skill, id: row.skill_id, source: "custom" } : null;
}

export async function listCustomSkills(userId: string): Promise<SkillDefinition[]> {
  const db = getDb();
  const { data, error } = await db.from("skills").select("*").eq("user_id", userId).order("created_at", { ascending: true });
  if (error) {
    log.warn("skills", `list custom skills failed: ${error.message}`);
    return [];
  }
  return (data || []).map(rowToDefinition).filter((s): s is SkillDefinition => !!s);
}

export async function getCustomSkill(userId: string, skillId: string): Promise<SkillDefinition | null> {
  const db = getDb();
  const { data, error } = await db.from("skills").select("*").eq("user_id", userId).eq("skill_id", skillId).maybeSingle();
  if (error || !data) return null;
  return rowToDefinition(data as CustomSkillRow);
}

export async function saveCustomSkill(userId: string, markdown: string, files?: SkillFiles): Promise<{ skill: SkillDefinition | null; issues: SkillIssue[] }> {
  const { skill, issues } = parseSkillMarkdown(markdown, "custom");
  if (!skill) return { skill: null, issues };
  const db = getDb();
  const row: { user_id: string; skill_id: string; markdown: string; files?: SkillFiles; updated_at: string } = {
    user_id: userId,
    skill_id: skill.id,
    markdown,
    updated_at: new Date().toISOString(),
  };
  if (files) row.files = { ...files, "SKILL.md": markdown }; // markdown wins over any stale copy
  const { error } = await db.from("skills").upsert(row, { onConflict: "user_id,skill_id" });
  if (error) throw new Error(`Failed to save skill: ${error.message}`);
  return { skill, issues };
}

export async function deleteCustomSkill(userId: string, skillId: string): Promise<boolean> {
  const db = getDb();
  const { error } = await db.from("skills").delete().eq("user_id", userId).eq("skill_id", skillId);
  if (error) throw new Error(`Failed to delete skill: ${error.message}`);
  return true;
}

/** Resolve a skill by id for a user: custom first, then builtin. */
export async function resolveSkill(userId: string, skillId: string): Promise<SkillDefinition | null> {
  const custom = await getCustomSkill(userId, skillId);
  if (custom) return custom;
  return getBuiltinSkill(skillId);
}

/** A custom skill may shadow a builtin id; builtins always keep their id. */
export async function listAllSkillsForUser(userId: string): Promise<SkillDefinition[]> {
  const builtins = loadBuiltinSkills();
  const customs = await listCustomSkills(userId);
  const customIds = new Set(customs.map((c) => c.id));
  return [...builtins.filter((b) => !customIds.has(b.id)), ...customs];
}

export { serializeSkill };
