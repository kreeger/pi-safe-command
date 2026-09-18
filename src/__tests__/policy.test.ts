import { describe, it, expect } from "vitest";
import {
  normalizePattern,
  validatePolicyDocument,
  type PolicyError,
} from "../policy.js";

const POLICY_PATH = "/policy/settings.json";

function captureError(fn: () => unknown): PolicyError {
  try {
    fn();
  } catch (error) {
    return error as PolicyError;
  }
  throw new Error("expected function to throw");
}

describe("validatePolicyDocument", () => {
  it("accepts the version 1 full schema", () => {
    expect(
      validatePolicyDocument(
        { version: 1, allow: ["git push"], block: ["rm *"] },
        POLICY_PATH,
      ),
    ).toEqual({ version: 1, allow: ["git push"], block: ["rm *"] });
  });

  it("accepts empty allow and block arrays", () => {
    expect(
      validatePolicyDocument({ version: 1, allow: [], block: [] }, POLICY_PATH),
    ).toEqual({ version: 1, allow: [], block: [] });
  });

  it.each([
    undefined,
    null,
    [],
    "not an object",
    { version: 0, allow: [], block: [] },
    { version: 1, allow: [], block: [], extra: true },
    { version: 1, allow: "git push", block: [] },
    { version: 1, allow: [""], block: [] },
    { version: 1, allow: ["git push", 42], block: [] },
    { version: 1, allow: [], block: [" "] },
    { version: 1, allow: ["git push"] },
    { version: 1, block: ["rm *"] },
  ])("rejects invalid policy documents: %j", (value) => {
    expect(() => validatePolicyDocument(value, POLICY_PATH)).toThrow();
  });

  it("rejects a sparse allow array instead of skipping its holes", () => {
    const sparseAllow = ["git push", , "rm *"];
    // Guard: confirm the fixture really contains a hole at index 1, so the
    // test cannot pass trivially if the literal ever loses its elision.
    expect(sparseAllow.length).toBe(3);
    expect(1 in sparseAllow).toBe(false);

    const error = captureError(() =>
      validatePolicyDocument(
        { version: 1, allow: sparseAllow, block: [] },
        POLICY_PATH,
      ),
    );
    expect(error.field).toBe("allow");
    expect(error.index).toBe(1);
  });

  it("rejects a sparse block array instead of skipping its holes", () => {
    const sparseBlock: string[] = ["rm *"];
    sparseBlock.length = 3;

    const error = captureError(() =>
      validatePolicyDocument(
        { version: 1, allow: [], block: sparseBlock },
        POLICY_PATH,
      ),
    );
    expect(error.field).toBe("block");
    expect(error.index).toBe(1);
  });

  it("throws an Error with the file path on every failure", () => {
    const cases: unknown[] = [null, { version: 0, allow: [], block: [] }];
    for (const value of cases) {
      const error = captureError(() => validatePolicyDocument(value, POLICY_PATH));
      expect(error).toBeInstanceOf(Error);
      expect(error.filePath).toBe(POLICY_PATH);
      expect(error.message).toContain(POLICY_PATH);
    }
  });

  it("identifies a missing field", () => {
    const error = captureError(() =>
      validatePolicyDocument({ version: 1, allow: [] }, POLICY_PATH),
    );
    expect(error.field).toBe("block");
  });

  it("identifies an unknown field", () => {
    const error = captureError(() =>
      validatePolicyDocument(
        { version: 1, allow: [], block: [], extra: true },
        POLICY_PATH,
      ),
    );
    expect(error.field).toBe("extra");
  });

  it("identifies a wrong version", () => {
    const error = captureError(() =>
      validatePolicyDocument({ version: 2, allow: [], block: [] }, POLICY_PATH),
    );
    expect(error.field).toBe("version");
  });

  it("identifies a non-array field", () => {
    const error = captureError(() =>
      validatePolicyDocument(
        { version: 1, allow: "git push", block: [] },
        POLICY_PATH,
      ),
    );
    expect(error.field).toBe("allow");
  });

  it("identifies an empty string array entry by field and index", () => {
    const error = captureError(() =>
      validatePolicyDocument({ version: 1, allow: [""], block: [] }, POLICY_PATH),
    );
    expect(error.field).toBe("allow");
    expect(error.index).toBe(0);
  });

  it("identifies a whitespace-only array entry by field and index", () => {
    const error = captureError(() =>
      validatePolicyDocument({ version: 1, allow: [], block: [" "] }, POLICY_PATH),
    );
    expect(error.field).toBe("block");
    expect(error.index).toBe(0);
  });

  it("identifies a non-string array entry by field and index", () => {
    const error = captureError(() =>
      validatePolicyDocument(
        { version: 1, allow: ["git push", 42], block: [] },
        POLICY_PATH,
      ),
    );
    expect(error.field).toBe("allow");
    expect(error.index).toBe(1);
  });

  it("preserves valid pattern strings unchanged in the returned document", () => {
    const document = validatePolicyDocument(
      { version: 1, allow: ["  Git Push  "], block: ["rm *"] },
      POLICY_PATH,
    );
    expect(document.allow).toEqual(["  Git Push  "]);
    expect(document.block).toEqual(["rm *"]);
  });

  it("does not accept the old bare-array format", () => {
    expect(() => validatePolicyDocument(["rm *"], POLICY_PATH)).toThrow();
  });
});

describe("normalizePattern", () => {
  it("normalizes only for policy identity checks", () => {
    expect(normalizePattern("  GIT PUSH  ")).toBe("git push");
  });

  it("leaves an already-normalized pattern unchanged", () => {
    expect(normalizePattern("rm *")).toBe("rm *");
  });
});
