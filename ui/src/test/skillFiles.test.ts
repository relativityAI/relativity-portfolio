import { describe, it, expect } from "vitest";
import { buildTree, defaultSkillFiles, deletePath, parentDir, DEFAULT_SKILL_MD } from "../lib/skillFiles";

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
