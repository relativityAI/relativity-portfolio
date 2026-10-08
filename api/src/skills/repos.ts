/**
 * Skill sources — GitHub repositories listed in config/skill-repos.json.
 *
 * Lists the SKILL.md files a repo ships (name + description peeked from each
 * file's frontmatter) and downloads one on demand into the signed-in user's
 * library. Trust model: hosts, owners and repos come from the config file
 * only; caller input is a repo id (must match a config entry) and a path that
 * must exist in that repo's own tree, so nothing here can be aimed at an
 * arbitrary host.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import pLimit from "p-limit";
import { log } from "../logger.js";
import { humanizeName, peekSkillMeta, slugifySkillName } from "./parse.js";

export interface SkillRepo {
  id: string;
  label: string;
  owner: string;
  repo: string;
  branch?: string; // omit → the repo's default branch
  pathPrefix?: string; // only list SKILL.md files under this prefix
}

export interface RepoSkill {
  id: string;
  name: string;
  description: string;
  path: string;
  html_url: string;
}

const CONFIG_FILE = join(process.cwd(), "config", "skill-repos.json");
const TREE_TTL_MS = 10 * 60_000;
const MAX_SKILL_BYTES = 512 * 1024;
const GH_API = "https://api.github.com";
const GH_RAW = "https://raw.githubusercontent.com";

/** Configured repos. Missing/broken config → empty list (feature hides itself). */
export function listSkillRepos(): SkillRepo[] {
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
    if (!Array.isArray(parsed)) throw new Error("expected a JSON array");
    return parsed.filter(
      (r): r is SkillRepo =>
        !!r && typeof r.id === "string" && typeof r.label === "string" &&
        typeof r.owner === "string" && typeof r.repo === "string",
    );
  } catch (e: any) {
    log.warn("skill-repos", `config unavailable (${e?.message}) — no GitHub skill sources`);
    return [];
  }
}

export function getSkillRepo(id: string): SkillRepo | null {
  return listSkillRepos().find((r) => r.id === id) || null;
}

/** Pure tree filter: SKILL.md blobs under an optional path prefix. Exported for tests. */
export function skillsFromTree(
  tree: { path?: string; type?: string; sha?: string }[],
  pathPrefix = "",
): { path: string; sha: string }[] {
  return tree
    .filter(
      (n) =>
        n.type === "blob" &&
        typeof n.path === "string" &&
        /(^|\/)SKILL\.md$/i.test(n.path) &&
        (!pathPrefix || n.path.startsWith(pathPrefix)),
    )
    .map((n) => ({ path: n.path as string, sha: n.sha || "" }));
}

async function ghJson(url: string): Promise<any> {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "RelativityBot/1.0",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    const rateLimited = res.status === 403 || res.status === 429;
    throw Object.assign(
      new Error(
        rateLimited
          ? "GitHub is rate-limiting this server — set GITHUB_TOKEN to raise the limit."
          : `GitHub responded ${res.status}.`,
      ),
      { status: res.status === 404 ? 404 : 502 },
    );
  }
  return res.json();
}

interface RepoListing {
  branch: string;
  entries: { path: string; sha: string }[];
  at: number;
}

const treeCache = new Map<string, RepoListing>();

async function repoListing(repo: SkillRepo): Promise<RepoListing> {
  const hit = treeCache.get(repo.id);
  if (hit && Date.now() - hit.at < TREE_TTL_MS) return hit;
  const branch =
    repo.branch ||
    String((await ghJson(`${GH_API}/repos/${repo.owner}/${repo.repo}`)).default_branch || "main");
  const data = await ghJson(
    `${GH_API}/repos/${repo.owner}/${repo.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
  );
  const listing: RepoListing = {
    branch,
    entries: skillsFromTree(data.tree || [], repo.pathPrefix || ""),
    at: Date.now(),
  };
  treeCache.set(repo.id, listing);
  return listing;
}

interface CachedMeta {
  sha: string;
  id: string;
  name: string;
  description: string;
}

// Frontmatter peeks cached per path, invalidated by the blob sha so a change
// upstream is picked up while unchanged files are never refetched.
const metaCache = new Map<string, CachedMeta>();

function htmlUrl(repo: SkillRepo, branch: string, path: string): string {
  return `https://github.com/${repo.owner}/${repo.repo}/blob/${branch}/${path}`;
}

async function peekEntry(
  repo: SkillRepo,
  branch: string,
  entry: { path: string; sha: string },
): Promise<RepoSkill> {
  const key = `${repo.id}:${entry.path}`;
  const cached = metaCache.get(key);
  if (cached && cached.sha === entry.sha) {
    return {
      id: cached.id,
      name: cached.name,
      description: cached.description,
      path: entry.path,
      html_url: htmlUrl(repo, branch, entry.path),
    };
  }

  let id = "";
  let name = "";
  let description = "";
  try {
    const res = await fetch(`${GH_RAW}/${repo.owner}/${repo.repo}/${branch}/${entry.path}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`raw ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_SKILL_BYTES) throw new Error("file too large");
    const meta = peekSkillMeta(buf.toString("utf8"));
    if (meta) ({ id, name, description } = meta);
  } catch (e: any) {
    log.warn("skill-repos", `frontmatter peek failed for ${entry.path}: ${e?.message}`);
  }
  if (!id) id = slugifySkillName(entry.path.split("/").at(-2) || "skill");
  if (!name) name = humanizeName(id);

  metaCache.set(key, { sha: entry.sha, id, name, description });
  return { id, name, description, path: entry.path, html_url: htmlUrl(repo, branch, entry.path) };
}

/** Every downloadable skill in a configured repo, sorted by path, deduped by id. */
export async function listRepoSkills(repoId: string): Promise<RepoSkill[]> {
  const repo = getSkillRepo(repoId);
  if (!repo) throw Object.assign(new Error("Unknown skill repository."), { status: 404 });
  const { branch, entries } = await repoListing(repo);
  const limit = pLimit(8);
  const metas = await Promise.all(entries.map((e) => limit(() => peekEntry(repo, branch, e))));
  // Bundled copies of a skill can appear at several paths — one row per skill.
  const byId = new Map<string, RepoSkill>();
  for (const m of metas) if (!byId.has(m.id)) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/** Check a caller-supplied path against the repo's real tree before fetching. */
export async function resolveSkillPath(
  repoId: string,
  path: string,
): Promise<{ repo: SkillRepo; branch: string; path: string } | null> {
  const repo = getSkillRepo(repoId);
  if (!repo) return null;
  if (typeof path !== "string" || path.includes("..") || !/(^|\/)SKILL\.md$/i.test(path)) return null;
  const { branch, entries } = await repoListing(repo);
  const entry = entries.find((e) => e.path === path);
  if (!entry) return null;
  return { repo, branch, path: entry.path };
}

/** Download one skill document. Size-capped; caller has already validated the path. */
export async function fetchSkillMarkdown(
  repo: SkillRepo,
  branch: string,
  path: string,
): Promise<string> {
  const res = await fetch(`${GH_RAW}/${repo.owner}/${repo.repo}/${branch}/${path}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Could not download the skill file (GitHub responded ${res.status}).`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_SKILL_BYTES) throw new Error("That skill file is too large to import.");
  const md = buf.toString("utf8");
  if (!md.trim()) throw new Error("That skill file is empty.");
  return md;
}
