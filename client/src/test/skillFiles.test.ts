import { describe, it, expect } from "vitest";
import { buildTree, defaultSkillFiles, deletePath, movePath, parentDir, DEFAULT_SKILL_MD } from "../lib/skillFiles";

describe("skill file tree", () => {
    it("starts every new skill with SKILL.md plus the standard folders", () => {
        const files = defaultSkillFiles();
        expect(files["SKILL.md"]).toBe(DEFAULT_SKILL_MD);
        expect(files["references/"]).toBe("");
        expect(files["assets/"]).toBe("");
        expect(DEFAULT_SKILL_MD).toMatch(/^---\nname: my-skill\n/);
    });

    it("groups flat paths into a tree: SKILL.md first, then folders, then files", () => {
        const tree = buildTree({
            "SKILL.md": "x",
            "references/case.md": "y",
            "references/": "",
            "assets/logo.png": "z",
        });
        expect(tree.map((n) => n.path)).toEqual(["SKILL.md", "assets/", "references/"]);
        const refs = tree.find((n) => n.path === "references/")!;
        expect(refs.children.map((n) => n.path)).toEqual(["references/case.md"]);
        const assets = tree.find((n) => n.path === "assets/")!;
        expect(assets.children.map((n) => n.path)).toEqual(["assets/logo.png"]);
    });

    it("keeps empty folders that only exist as markers", () => {
        const tree = buildTree({ "SKILL.md": "x", "scripts/": "" });
        expect(tree.map((n) => n.path)).toEqual(["SKILL.md", "scripts/"]);
        expect(tree[1].children).toEqual([]);
    });

    it("deletes a folder with everything under it but keeps SKILL.md", () => {
        const files = {
            "SKILL.md": "x",
            "references/": "",
            "references/a.md": "1",
            "references/deep/b.md": "2",
            "assets/": "",
        };
        const next = deletePath(files, "references/");
        expect(next).toEqual({ "SKILL.md": "x", "assets/": "" });
    });

    it("deletes a single file without touching its folder marker", () => {
        const next = deletePath({ "SKILL.md": "x", "references/": "", "references/a.md": "1" }, "references/a.md");
        expect(next).toEqual({ "SKILL.md": "x", "references/": "" });
    });

    it("resolves the directory a path lives in", () => {
        expect(parentDir("SKILL.md")).toBe("");
        expect(parentDir("references/a.md")).toBe("references/");
        expect(parentDir("references/")).toBe("references/");
    });
});

describe("movePath", () => {
    it("moves a file into a folder", () => {
        const files = { "SKILL.md": "x", "notes.md": "n", "references/": "", "references/old.md": "o" };
        expect(movePath(files, "notes.md", "references/notes.md")).toEqual({
            "SKILL.md": "x", "references/": "", "references/old.md": "o", "references/notes.md": "n",
        });
    });

    it("moves a folder with everything under it", () => {
        const files = { "SKILL.md": "x", "a/": "", "a/b.md": "1", "a/sub/c.md": "2" };
        expect(movePath(files, "a/", "z/")).toEqual({
            "SKILL.md": "x", "z/": "", "z/b.md": "1", "z/sub/c.md": "2",
        });
    });

    it("refuses to move a folder into itself", () => {
        const files = { "a/": "", "a/b.md": "1" };
        expect(movePath(files, "a/", "a/sub/")).toBe(files);
    });

    it("is a no-op when the path does not change", () => {
        const files = { "SKILL.md": "x" };
        expect(movePath(files, "SKILL.md", "SKILL.md")).toBe(files);
    });
});
