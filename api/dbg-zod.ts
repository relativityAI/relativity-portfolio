import { z } from "zod";
const base = z.object({ verdicts: z.array(z.object({ a: z.string() })).default([]) });
const shape = base.shape.verdicts;
console.log("innerType:", typeof shape.innerType);
const only = z.object({ verdicts: shape.innerType().min(1) });
console.log("valid:", only.safeParse({ verdicts: [{ a: "x" }] }).success);
console.log("empty invalid:", only.safeParse({ verdicts: [] }).success);
