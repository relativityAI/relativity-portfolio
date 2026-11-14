/**
 * Skill file-tree helpers for the navigable skill workspace.
 *
 * A skill is a flat path -> content map (the agentskills.io directory
 * layout): SKILL.md at the root plus any nested files. Folder keys end with
 * "/" and hold "" so empty directories survive a round-trip.
 */

export type SkillFiles = Record<string, string>;

/** What every new skill starts with: the SKILL.md template plus the two
 *  standard directories from the agent skill spec. */
export const DEFAULT_SKILL_MD = `---
name: my-skill
description: Describe in one line what this skill does and when an agent should use it.
---

# My Skill

## Purpose

What this skill investigates, why it matters, and what a strong vs. weak result looks like.

## Method

1. Gather the data this skill needs.
2. Assess the evidence.
3. Write the findings with quotes copied verbatim from tool results.
`;

export function defaultSkillFiles(): SkillFiles {
  return {
    "SKILL.md": DEFAULT_SKILL_MD,
    "references/": "",
    "assets/": "",
  };
}

export interface TreeNode {
  /** Display name: "SKILL.md", "references", "chart-details.md". */
  name: string;
  /** Full path; folders keep their trailing "/". */
  path: string;
  kind: "dir" | "file";
  children: TreeNode[];
}

/** Group a flat files map into a sorted tree: SKILL.md pinned first at the
 *  root, then folders, then files, each alphabetically. */
export function buildTree(files: SkillFiles): TreeNode[] {
  const root: TreeNode[] = [];
  const dirs = new Map<string, TreeNode>();

  const getDir = (dirPath: string): TreeNode => {
    const existing = dirs.get(dirPath);
    if (existing) return existing;
    const slash = dirPath.lastIndexOf("/");
    const parent = slash === -1 ? root : getDir(dirPath.slice(0, slash)).children;
    const node: TreeNode = { name: dirPath.slice(slash + 1), path: dirPath + "/", kind: "dir", children: [] };
    dirs.set(dirPath, node);
    parent.push(node);
    return node;
  };

  for (const path of Object.keys(files)) {
    if (path.endsWith("/")) {
      getDir(path.slice(0, -1));
      continue;
    }
    const slash = path.lastIndexOf("/");
    const parent = slash === -1 ? root : getDir(path.slice(0, slash)).children;
    parent.push({ name: path.slice(slash + 1), path, kind: "file", children: [] });
  }

  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.path === "SKILL.md") return -1;
      if (b.path === "SKILL.md") return 1;
      if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach((n) => sort(n.children));
  };
  sort(root);
  return root;
}

/** Remove a file, or a folder and everything under it. */
export function deletePath(files: SkillFiles, path: string): SkillFiles {
  const prefix = path.endsWith("/") ? path : path + "/";
  const out: SkillFiles = {};
  for (const [key, content] of Object.entries(files)) {
    if (key === path || key.startsWith(prefix)) continue;
    out[key] = content;
  }
  return out;
}

/** Move a file, or a folder with everything under it, to a new path.
 *  Order stays alphabetical — the tree is sorted, not sequenced. */
export function movePath(files: SkillFiles, from: string, to: string): SkillFiles {
  if (!to || from === to) return files;
  const prefix = from.endsWith("/") ? from : from + "/";
  // A folder can't land inside itself.
  if (from.endsWith("/") && to.startsWith(prefix)) return files;
  const out: SkillFiles = {};
  for (const [key, content] of Object.entries(files)) {
    if (key === from) out[to] = content;
    else if (key.startsWith(prefix)) out[to + key.slice(from.length)] = content;
    else out[key] = content;
  }
  return out;
}

/** The directory a path lives in ("" for the root), trailing "/" included. */
export function parentDir(path: string): string {
  if (path.endsWith("/")) return path;
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash + 1);
}
