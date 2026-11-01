/**
 * Research workspace — a per-run in-memory file system (memfs Volume).
 *
 * The workspace is the Context Builder's durable state across sessions:
 * distilled notes, archived source payloads, control files. It never touches
 * disk. Path confinement: every path is normalized and rejected if it escapes
 * the volume root. `compact()` serializes for the DB — raw payloads excluded
 * (the run trace already persists them), per-file and total caps applied.
 */

import { Volume, createFsFromVolume } from "memfs";
import type { IFs } from "memfs";
import { PATHS } from "./paths.js";

const PER_FILE_CAP = 16_384;
const TOTAL_CAP = 400_000;

export class Workspace {
  readonly fs: IFs;
  private readonly vol: Volume;
  private seq = 0;
  private readonly stubList: unknown[] = [];
  private readonly payloadMap = new Map<string, unknown>();

  constructor() {
    this.vol = new Volume();
    this.fs = createFsFromVolume(this.vol);
    for (const d of [PATHS.workspace, PATHS.reportSections, PATHS.kb, PATHS.raw, PATHS.toolOutput]) {
      this.fs.mkdirSync(d, { recursive: true });
    }
  }

  /** Normalize a model-supplied path to a confined absolute path; null when it escapes. */
  normalize(path: string): string | null {
    if (typeof path !== "string" || !path.trim()) return null;
    const out: string[] = [];
    for (const part of path.replace(/\\/g, "/").split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") return null;
      out.push(part);
    }
    if (!out.length) return null;
    return "/" + out.join("/");
  }

  read(path: string): string | null {
    const p = this.normalize(path);
    if (!p) return null;
    try {
      const v = this.fs.readFileSync(p, "utf8");
      return typeof v === "string" ? v : v.toString("utf8");
    } catch {
      return null;
    }
  }

  write(path: string, content: string): { path: string; bytes: number } | null {
    const p = this.normalize(path);
    if (!p) return null;
    this.mkdirp(p.slice(0, p.lastIndexOf("/")) || "/");
    this.fs.writeFileSync(p, content);
    return { path: p, bytes: Buffer.byteLength(content) };
  }

  append(path: string, content: string): { path: string; bytes: number } | null {
    const p = this.normalize(path);
    if (!p) return null;
    this.mkdirp(p.slice(0, p.lastIndexOf("/")) || "/");
    this.fs.appendFileSync(p, content);
    return { path: p, bytes: Buffer.byteLength(content) };
  }

  mkdirp(dir: string): void {
    const p = this.normalize(dir);
    if (!p) return;
    try {
      this.fs.mkdirSync(p, { recursive: true });
    } catch {
      // already exists
    }
  }

  /**
   * Restore a previous run's compacted snapshot (files + source stubs) so a
   * resumed run keeps its notes, plan, and citations. Raw payloads are not in
   * snapshots — the agent re-fetches those with the data tools.
   */
  hydrate(snapshot: Record<string, string>): void {
    if (!snapshot || typeof snapshot !== "object") return;
    for (const [path, content] of Object.entries(snapshot)) {
      if (typeof content !== "string") continue;
      if (path.startsWith(`${PATHS.raw}/`)) continue;
      this.write(path, content);
    }
    const stubRe = new RegExp(`^${PATHS.sources}/[^/]+\\.json$`);
    for (const path of Object.keys(snapshot)) {
      if (!stubRe.test(path)) continue;
      try {
        const stub = JSON.parse(snapshot[path]);
        if (stub && typeof stub === "object" && typeof stub.id === "string") this.stubList.push(stub);
      } catch {
        // unparseable stub — the source is just missing, not fatal
      }
    }
  }

  /** Entry names in a dir; directories get a trailing "/". */
  ls(path: string): string[] {
    const p = this.normalize(path) ?? "/";
    try {
      const base = p === "/" ? "" : p;
      return (this.fs.readdirSync(p) as string[])
        .map((name) => {
          try {
            return this.fs.statSync(`${base}/${name}`).isDirectory() ? `${name}/` : name;
          } catch {
            return name;
          }
        })
        .sort();
    } catch {
      return [];
    }
  }

  /** Recursive file paths under a dir, capped. */
  listFiles(path = "/", cap = 200): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
      if (out.length >= cap) return;
      for (const entry of this.ls(dir)) {
        if (entry.endsWith("/")) walk((dir === "/" ? "" : dir) + "/" + entry.slice(0, -1));
        else {
          out.push((dir === "/" ? "" : dir) + "/" + entry);
          if (out.length >= cap) return;
        }
      }
    };
    walk(this.normalize(path) ?? "/");
    return out;
  }

  /**
   * System-prompt snapshot: the whole tree with dirs that hold no files
   * labeled EMPTY — the agent sees the layout up front and skips the
   * workspace-tour steps. ponytail: run-start snapshot; mid-run additions
   * surface via the per-step reminders, not here.
   */
  treeMarkdown(): string {
    const files = this.listFiles("/", 300);
    const lines: string[] = [];
    const walk = (dir: string, depth: number): void => {
      if (depth > 4 || lines.length > 60) return;
      const base = dir === "/" ? "" : dir.replace(/\/$/, "");
      for (const entry of this.ls(dir)) {
        const full = `${base}/${entry}`;
        if (entry.endsWith("/")) {
          lines.push(full + (files.some((f) => f.startsWith(full)) ? "" : " — EMPTY"));
          walk(full, depth + 1);
        } else {
          lines.push(full);
        }
      }
    };
    walk("/", 0);
    return lines.join("\n");
  }

  grep(pattern: string, path = "/", cap = 50): { path: string; line: number; text: string }[] {
    let re: RegExp;
    try {
      re = new RegExp(pattern, "i");
    } catch {
      return [];
    }
    const out: { path: string; line: number; text: string }[] = [];
    for (const file of this.listFiles(this.normalize(path) ?? "/", 300)) {
      const text = this.read(file);
      if (text == null) continue;
      text.split("\n").forEach((line, i) => {
        if (out.length < cap && re.test(line)) out.push({ path: file, line: i + 1, text: line.slice(0, 300) });
      });
      if (out.length >= cap) break;
    }
    return out;
  }

  // ── source registry (populated by archiveResult) ──────────────────────────

  nextSourceId(): string {
    this.seq += 1;
    return `src_${String(this.seq).padStart(3, "0")}`;
  }

  registerStub(stub: unknown, payload: unknown): void {
    this.stubList.push(stub);
    const callId = (stub as { callId?: unknown })?.callId;
    if (typeof callId === "string") this.payloadMap.set(callId, payload);
  }

  stubs<T = unknown>(): T[] {
    return this.stubList as T[];
  }

  payloadEntries(): { callId: string; payload: unknown }[] {
    return [...this.payloadMap.entries()].map(([callId, payload]) => ({ callId, payload }));
  }

  // ── serialization ─────────────────────────────────────────────────────────

  toJSON(): Record<string, string> {
    const json = this.vol.toJSON() as Record<string, string | null>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(json)) if (typeof v === "string") out[k] = v;
    return out;
  }

  /** Live KB size: file count and total bytes on the volume. */
  stats(): { files: number; bytes: number } {
    const all = this.toJSON();
    const files = Object.keys(all).length;
    const bytes = Object.values(all).reduce((n, c) => n + c.length, 0);
    return { files, bytes };
  }

  /**
   * Compacted snapshot for the DB: raw payloads excluded (the trace persists
   * them), each file capped at 16KB, total capped at 400KB — report sections
   * dropped first when over (they duplicate the `report` column). Priority:
   * root docs → plan (crash resume) → source stubs → knowledge base → rest.
   */
  compact(): Record<string, string> {
    const rank = (p: string): number => {
      if (!p.slice(1).includes("/")) return 0; // /AGENTS.md, /SOUL.md
      if (p === PATHS.planJson || p === PATHS.planMd) return 1;
      if (p.startsWith(`${PATHS.sources}/`)) return 2;
      if (p.startsWith(`${PATHS.kb}/`)) return 3;
      return 4; // report sections, notes — dropped first
    };
    const keys = Object.keys(this.toJSON())
      .filter((k) => !k.startsWith(`${PATHS.raw}/`))
      .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    const all = this.toJSON();
    const out: Record<string, string> = {};
    let total = 0;
    for (const k of keys) {
      let content = all[k];
      if (content.length > PER_FILE_CAP) content = content.slice(0, PER_FILE_CAP) + `\n…[truncated ${content.length - PER_FILE_CAP} chars]`;
      if (total + content.length > TOTAL_CAP) continue;
      out[k] = content;
      total += content.length;
    }
    return out;
  }
}
