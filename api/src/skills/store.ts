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
      const { skill, issues } = parseSkillMarkdown(md, "builtin");
      if (skill) {
        // Spec: name must match the containing directory.
        if (skill.id !== slug)
          log.warn("skills", `builtin ${slug}: frontmatter name "${skill.id}" != directory name — using "${slug}"`);
        out.push({ ...skill, id: slug });
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
  created_at?: string;
  updated_at?: string;
}

function rowToDefinition(row: CustomSkillRow): SkillDefinition | null {
  const { skill } = parseSkillMarkdown(row.markdown, "custom");
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

export async function saveCustomSkill(userId: string, markdown: string): Promise<{ skill: SkillDefinition | null; issues: SkillIssue[] }> {
  const { skill, issues } = parseSkillMarkdown(markdown, "custom");
  if (!skill) return { skill: null, issues };
  const db = getDb();
  const { error } = await db.from("skills").upsert(
    { user_id: userId, skill_id: skill.id, markdown, updated_at: new Date().toISOString() },
    { onConflict: "user_id,skill_id" },
  );
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
