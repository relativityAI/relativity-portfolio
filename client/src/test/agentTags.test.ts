import { beforeEach, describe, expect, it } from "vitest";
import { applyComma, finalTags, putTags, tagsFor } from "@/lib/agentTags";

describe("agent tags", () => {
    beforeEach(() => localStorage.clear());

    it("turns typed text before a comma into a tag and keeps the rest", () => {
        expect(applyComma(["a"], "b, c")).toEqual({ tags: ["a", "b"], text: "c" });
        expect(applyComma([], "momentum")).toEqual({ tags: [], text: "momentum" });
    });

    it("ignores an empty head so a leading comma adds nothing", () => {
        expect(applyComma(["a"], ",b")).toEqual({ tags: ["a"], text: "b" });
        expect(applyComma([], "  ,  x")).toEqual({ tags: [], text: "x" });
    });

    it("counts uncommitted text as one tag on save", () => {
        expect(finalTags(["a"], "b")).toEqual(["a", "b"]);
        expect(finalTags(["a"], "   ")).toEqual(["a"]);
        expect(finalTags([], "solo")).toEqual(["solo"]);
    });

    it("round-trips tags per agent id", () => {
        putTags("agent-1", ["momentum", "nifty"]);
        putTags("agent-2", ["value"]);
        expect(tagsFor("agent-1")).toEqual(["momentum", "nifty"]);
        expect(tagsFor("agent-2")).toEqual(["value"]);
        expect(tagsFor("missing")).toEqual([]);
    });
});
