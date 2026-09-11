import { describe, it, expect } from "vitest";
import { describeInputError, RETRYABLE_ERROR } from "../src/harness.js";

describe("describeInputError", () => {
  it("names the PDF-input limitation so the user can act on it", () => {
    expect(describeInputError({ message: 'Cannot read "KEI-854a1a95.pdf" (this model does not support pdf input)' })).toMatch(/text only/);
    expect(describeInputError({ message: "this model does not support pdf input" })).toMatch(/text only/);
  });

  it("ignores unrelated provider errors", () => {
    expect(describeInputError({ message: "rate limit exceeded" })).toBeUndefined();
    expect(describeInputError({ message: "" })).toBeUndefined();
    expect(describeInputError(undefined)).toBeUndefined();
  });
});

describe("RETRYABLE_ERROR", () => {
  it("covers the empty-stream and transient provider failures we retry on", () => {
    expect(RETRYABLE_ERROR.test("AI_NoOutputGeneratedError: No suitable output part found")).toBe(true);
    expect(RETRYABLE_ERROR.test("rate limit exceeded (429)")).toBe(true);
    expect(RETRYABLE_ERROR.test("429 Resource has been exhausted")).toBe(true);
    expect(RETRYABLE_ERROR.test("received 500 status code")).toBe(true);
  });
});