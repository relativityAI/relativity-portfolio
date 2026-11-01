/**
 * Skill catalog — built-ins shipped on disk plus user-created custom skills.
 *
 * Built-ins are read from `config/skills/<name>/SKILL.md` at the package root
 * (agentskills.io layout), cached after first load. Custom skills sit behind
 * SkillRepository: this module ships a hermetic in-memory implementation
 * (CLI, tests), and the API installs the Supabase adapter (see
 * api/src/harness-adapters.ts) at boot via setSkillRepository. Parsing and
 * validation stay here (they define what a skill IS); storage is the
 * repository's concern.
 */

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { log } from "../log.js";
import { parseSkillMarkdown, type HarnessSkill } from "./loader.js";

const BUILTIN_DIR = join(process.cwd(), "config", "skills");

let builtinCache: HarnessSkill[] | null = null;

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
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    const file = join(dir, "SKILL.md");
    if (existsSync(file)) out.push({ slug: entry, file });
  }
  return out;
}

export function loadBuiltinSkills(): HarnessSkill[] {
  if (builtinCache) return builtinCache;
  const out: HarnessSkill[] = [];
  for (const { slug, file } of builtinSkillFiles()) {
    try {
      const { skill, issues } = parseSkillMarkdown(readFileSync(file, "utf8"), "builtin", slug, join(BUILTIN_DIR, slug));
      if (skill) out.push(skill);
      else log.warn("skills", `builtin skill ${slug} failed to parse: ${issues.map((i) => i.message).join("; ")}`);
    } catch (e: any) {
      log.warn("skills", `builtin skill ${slug} read failed: ${e?.message}`);
    }
  }
  builtinCache = out;
  return out;
}

export function getBuiltinSkill(id: string): HarnessSkill | null {
  return loadBuiltinSkills().find((s) => s.id === id) || null;
}

// ── Custom skills (per-user) — behind SkillRepository ───────────────────────

/** A custom skill as stored: an id and its markdown document. */
export interface CustomSkillRecord {
  skillId: string;
  markdown: string;
  updatedAt?: string;
}

/** Where custom skills live. Two real adapters: Supabase (server) + memory. */
export interface SkillRepository {
  list(userId: string): Promise<CustomSkillRecord[]>;
  get(userId: string, skillId: string): Promise<CustomSkillRecord | null>;
  upsert(userId: string, skillId: string, markdown: string): Promise<void>;
  delete(userId: string, skillId: string): Promise<boolean>;
}

/** Hermetic default — no network, no DB. Good for the CLI and tests. */
export function createMemorySkillRepository(): SkillRepository {
  const rows = new Map<string, CustomSkillRecord>();
  const key = (userId: string, skillId: string) => `${userId}\u0000${skillId}`;

  return {
    async list(userId) {
      return [...rows.entries()].filter(([k]) => k.startsWith(`${userId}\u0000`)).map(([, v]) => v);
    },
    async get(userId, skillId) {
      return rows.get(key(userId, skillId)) ?? null;
    },
    async upsert(userId, skillId, markdown) {
      rows.set(key(userId, skillId), { skillId, markdown, updatedAt: new Date().toISOString() });
    },
    async delete(userId, skillId) {
      return rows.delete(key(userId, skillId));
    },
  };
}

let repository: SkillRepository = createMemorySkillRepository();

/** Install the persistence adapter (called once at server boot). */
export function setSkillRepository(repo: SkillRepository): void {
  repository = repo;
}

export function getSkillRepository(): SkillRepository {
  return repository;
}

function recordToSkill(record: CustomSkillRecord): HarnessSkill | null {
  const { skill } = parseSkillMarkdown(record.markdown, "custom", record.skillId);
  return skill ? { ...skill, id: record.skillId, source: "custom" } : null;
}

// ── Facade — stable call surface; the repository does the work ──────────────

export async function listCustomSkills(userId: string): Promise<HarnessSkill[]> {
  try {
    const records = await repository.list(userId);
    return records.map(recordToSkill).filter((s): s is HarnessSkill => !!s);
  } catch (e: any) {
    log.warn("skills", `list custom skills failed: ${e?.message}`);
    return [];
  }
}

export async function getCustomSkill(userId: string, skillId: string): Promise<HarnessSkill | null> {
  try {
    const record = await repository.get(userId, skillId);
    return record ? recordToSkill(record) : null;
  } catch {
    return null;
  }
}

export async function saveCustomSkill(userId: string, markdown: string): Promise<{ skill: HarnessSkill | null; issues: { message: string }[] }> {
  const { skill, issues } = parseSkillMarkdown(markdown, "custom");
  if (!skill) return { skill: null, issues: issues.map((i) => ({ message: i.message })) };
  await repository.upsert(userId, skill.id, markdown);
  return { skill, issues: [] };
}

export async function deleteCustomSkill(userId: string, skillId: string): Promise<boolean> {
  return repository.delete(userId, skillId);
}

/** Resolve a skill by id for a user: custom first, then builtin. */
export async function resolveSkill(userId: string, skillId: string): Promise<HarnessSkill | null> {
  const custom = await getCustomSkill(userId, skillId);
  if (custom) return custom;
  return getBuiltinSkill(skillId);
}

/** A custom skill may shadow a builtin id; builtins always keep their id. */
export async function listAllSkillsForUser(userId: string): Promise<HarnessSkill[]> {
  const builtins = loadBuiltinSkills();
  const customs = await listCustomSkills(userId);
  const customIds = new Set(customs.map((c) => c.id));
  return [...builtins.filter((b) => !customIds.has(b.id)), ...customs];
}
