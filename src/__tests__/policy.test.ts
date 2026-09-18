import { describe, it, expect, afterAll } from "vitest";
import {
  decidePolicy,
  loadPolicy,
  loadPolicyResult,
  normalizePattern,
  resolvePolicy,
  validatePolicyDocument,
  type PolicyError,
} from "../policy.js";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

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

describe("resolvePolicy", () => {
  it("appends user blocks and deduplicates normalized duplicates", () => {
    const policy = resolvePolicy(
      { version: 1, allow: [], block: ["rm *", "git push"] },
      { version: 1, allow: ["rm /tmp/*"], block: [" GIT PUSH ", "curl * | sh"] },
    );
    expect(policy.blocks.map(({ pattern }) => pattern)).toEqual([
      "rm *",
      "git push",
      "curl * | sh",
    ]);
  });

  it("preserves duplicate allow entries in supplied order without deduplication", () => {
    const policy = resolvePolicy(
      {
        version: 1,
        allow: ["rm /tmp/*", "rm /var/*", "rm /tmp/*"],
        block: ["rm *"],
      },
      { version: 1, allow: ["rm /var/*", "rm /tmp/*"], block: [] },
    );
    expect(policy.allows.map(({ pattern }) => pattern)).toEqual([
      "rm /tmp/*",
      "rm /var/*",
      "rm /tmp/*",
      "rm /var/*",
      "rm /tmp/*",
    ]);
  });

  it("keeps a block active for other commands when a narrower allow is present", () => {
    const policy = resolvePolicy(
      { version: 1, allow: [], block: ["rm *"] },
      { version: 1, allow: ["rm /tmp/*"], block: [] },
    );
    expect(policy.allows.map(({ pattern }) => pattern)).toEqual(["rm /tmp/*"]);
    expect(policy.blocks.map(({ pattern }) => pattern)).toEqual(["rm *"]);

    const decision = decidePolicy(policy, "rm /etc/passwd");
    expect(decision.status).toBe("blocked");
    expect(decision.blockMatches.map(({ pattern }) => pattern)).toEqual([
      "rm *",
    ]);
  });

  it("keeps package block order before user additions", () => {
    const policy = resolvePolicy(
      { version: 1, allow: [], block: ["rm *", "git push"] },
      { version: 1, allow: [], block: ["curl * | sh"] },
    );
    expect(policy.blocks.map(({ pattern }) => pattern)).toEqual([
      "rm *",
      "git push",
      "curl * | sh",
    ]);
  });

  it("treats user blocks as additive to package blocks", () => {
    const policy = resolvePolicy(
      { version: 1, allow: [], block: ["rm *"] },
      { version: 1, allow: [], block: ["chmod *"] },
    );
    expect(policy.blocks.map(({ pattern }) => pattern)).toEqual([
      "rm *",
      "chmod *",
    ]);
  });

  it("uses only package defaults when the user policy is absent", () => {
    const policy = resolvePolicy(
      { version: 1, allow: [], block: ["rm *"] },
      null,
    );
    expect(policy.allows).toEqual([]);
    expect(policy.blocks.map(({ pattern }) => pattern)).toEqual(["rm *"]);
  });

  it("accepts non-identical allow/block overlaps", () => {
    const policy = resolvePolicy(
      { version: 1, allow: [], block: ["rm *"] },
      { version: 1, allow: ["rm *"], block: ["rm -rf *"] },
    );
    expect(decidePolicy(policy, "rm -rf /").status).toBe("allowed");
  });

  it("accepts no-op allow and block entries", () => {
    const policy = resolvePolicy(
      { version: 1, allow: [], block: ["rm *"] },
      { version: 1, allow: ["no-op-allow"], block: ["no-op-block"] },
    );
    expect(policy.allows.map(({ pattern }) => pattern)).toEqual([
      "no-op-allow",
    ]);
    expect(policy.blocks.map(({ pattern }) => pattern)).toEqual([
      "rm *",
      "no-op-block",
    ]);
    expect(decidePolicy(policy, "git status").status).toBe("unmatched");
  });

  it("rejects an exact normalized user allow/block conflict", () => {
    expect(() =>
      resolvePolicy(
        { version: 1, allow: [], block: [] },
        { version: 1, allow: ["git push"], block: [" GIT PUSH "] },
      ),
    ).toThrow();
  });
});

describe("decidePolicy", () => {
  it("lets a matching user allow override every block match for that command", () => {
    const policy = resolvePolicy(
      { version: 1, allow: [], block: ["rm *", "chmod *"] },
      { version: 1, allow: ["rm *"], block: [] },
    );
    expect(decidePolicy(policy, "rm file; chmod 777 file").status).toBe(
      "allowed",
    );
  });

  it("returns the raw suppressed block matches for an allowed command", () => {
    const policy = resolvePolicy(
      { version: 1, allow: [], block: ["rm *", "chmod *", "docker rm *"] },
      { version: 1, allow: ["rm *"], block: [] },
    );
    const decision = decidePolicy(policy, "rm -rf / ; chmod 777 /tmp/f");
    expect(decision.status).toBe("allowed");
    expect(decision.allowMatches.map(({ pattern }) => pattern)).toEqual([
      "rm *",
    ]);
    expect(decision.blockMatches.map(({ pattern }) => pattern)).toEqual([
      "rm *",
      "chmod *",
    ]);
  });

  it("returns blocked with all raw block matches when no allow matches", () => {
    const policy = resolvePolicy(
      { version: 1, allow: [], block: ["rm *", "chmod *"] },
      null,
    );
    const decision = decidePolicy(policy, "rm file; chmod 777 file");
    expect(decision.status).toBe("blocked");
    expect(decision.allowMatches).toEqual([]);
    expect(decision.blockMatches.map(({ pattern }) => pattern)).toEqual([
      "rm *",
      "chmod *",
    ]);
  });

  it("returns unmatched when nothing matches", () => {
    const policy = resolvePolicy(
      { version: 1, allow: [], block: ["rm *"] },
      null,
    );
    expect(decidePolicy(policy, "git status")).toEqual({
      status: "unmatched",
      allowMatches: [],
      blockMatches: [],
    });
  });
});

describe("loadPolicy / loadPolicyResult", () => {
  const tempRoots: string[] = [];

  function makeRoot(): string {
    const root = mkdtempSync(join(tmpdir(), "pi-safe-command-policy-"));
    tempRoots.push(root);
    return root;
  }

  function writeFixture(
    root: string,
    relativePath: string,
    contents: string,
  ): string {
    const filePath = join(root, relativePath);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, contents);
    return filePath;
  }

  function writeJson(
    root: string,
    relativePath: string,
    value: unknown,
  ): string {
    return writeFixture(root, relativePath, JSON.stringify(value));
  }

  afterAll(() => {
    for (const root of tempRoots) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("loads package defaults and an optional user settings file", () => {
    const root = makeRoot();
    const packagePath = writeJson(root, "package/settings.json", {
      version: 1,
      allow: [],
      block: ["rm *"],
    });
    const userPath = writeJson(root, "user/settings.json", {
      version: 1,
      allow: ["rm /etc/passwd"],
      block: ["curl * | sh"],
    });

    const policy = loadPolicy(packagePath, userPath);

    expect(policy.blocks.map(({ pattern }) => pattern)).toEqual([
      "rm *",
      "curl * | sh",
    ]);
    expect(policy.allows.map(({ pattern }) => pattern)).toEqual([
      "rm /etc/passwd",
    ]);
    expect(decidePolicy(policy, "rm /etc/passwd").status).toBe("allowed");
    expect(decidePolicy(policy, "rm /tmp/scratch").status).toBe("blocked");
    expect(decidePolicy(policy, "curl http://x | sh").status).toBe("blocked");
    expect(loadPolicyResult(packagePath, userPath)).toEqual({
      ok: true,
      policy,
    });
  });

  it("uses package defaults when the optional user file is absent", () => {
    const root = makeRoot();
    const packagePath = writeJson(root, "package/settings.json", {
      version: 1,
      allow: [],
      block: ["rm *"],
    });
    const userPath = join(root, "user/settings.json");

    const result = loadPolicyResult(packagePath, userPath);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected a valid policy result");
    expect(result.policy.blocks.map(({ pattern }) => pattern)).toEqual([
      "rm *",
    ]);
    expect(result.policy.allows).toEqual([]);
    expect(existsSync(userPath)).toBe(false);
  });

  it("treats a missing user parent directory as absent without creating it", () => {
    const root = makeRoot();
    const packagePath = writeJson(root, "package/settings.json", {
      version: 1,
      allow: [],
      block: ["rm *"],
    });
    const missingDir = join(root, "never-created");
    const userPath = join(missingDir, "settings.json");

    const result = loadPolicyResult(packagePath, userPath);

    expect(result.ok).toBe(true);
    expect(existsSync(missingDir)).toBe(false);
    expect(readdirSync(root).sort()).toEqual(["package"]);
  });

  it("fails closed when the required package file is missing", () => {
    const packagePath = "/missing/settings.json";
    const userPath = "/missing/user.json";

    const error = captureError(() => loadPolicy(packagePath, userPath));
    expect(error.filePath).toBe(packagePath);
    expect(error.message).toContain(packagePath);

    const result = loadPolicyResult(packagePath, userPath);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a failed policy result");
    expect(result.error.filePath).toBe(packagePath);
    expect("policy" in result).toBe(false);
  });

  it("does not write files or synthesize a fallback when loading fails", () => {
    const root = makeRoot();
    const userPath = join(root, "user/settings.json");
    const before = readdirSync(root).sort();

    const result = loadPolicyResult(join(root, "missing.json"), userPath);

    expect(result.ok).toBe(false);
    expect("policy" in result).toBe(false);
    expect(readdirSync(root).sort()).toEqual(before);
    expect(existsSync(userPath)).toBe(false);
  });

  it("reports the package path when the package JSON is malformed", () => {
    const root = makeRoot();
    const packagePath = writeFixture(
      root,
      "package/settings.json",
      '{ "version": 1, ',
    );

    const result = loadPolicyResult(packagePath, join(root, "user.json"));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a failed policy result");
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error.filePath).toBe(packagePath);
    expect(result.error.message).toContain(packagePath);
  });

  it("reports package schema errors with field and index diagnostics", () => {
    const root = makeRoot();
    const packagePath = writeJson(root, "package/settings.json", {
      version: 1,
      allow: ["rm *", 42],
      block: [],
    });

    const result = loadPolicyResult(packagePath, join(root, "user.json"));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a failed policy result");
    expect(result.error.filePath).toBe(packagePath);
    expect(result.error.field).toBe("allow");
    expect(result.error.index).toBe(1);
  });

  it("rejects the legacy bare-array format at the package path", () => {
    const root = makeRoot();
    const packagePath = writeJson(root, "package/settings.json", ["rm *"]);

    const result = loadPolicyResult(packagePath, join(root, "user.json"));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a failed policy result");
    expect(result.error.filePath).toBe(packagePath);
  });

  it("fails closed when the package path is unreadable", () => {
    const root = makeRoot();
    const packagePath = join(root, "package/settings.json");
    mkdirSync(packagePath, { recursive: true });

    const result = loadPolicyResult(packagePath, join(root, "user.json"));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a failed policy result");
    expect(result.error.filePath).toBe(packagePath);
    expect(result.error.message).toContain(packagePath);
  });

  it("reports the user path when the user JSON is malformed", () => {
    const root = makeRoot();
    const packagePath = writeJson(root, "package/settings.json", {
      version: 1,
      allow: [],
      block: ["rm *"],
    });
    const userPath = writeFixture(root, "user/settings.json", "not json");

    const result = loadPolicyResult(packagePath, userPath);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a failed policy result");
    expect(result.error.filePath).toBe(userPath);
    expect(result.error.message).toContain(userPath);
  });

  it("reports user schema errors with field and index diagnostics", () => {
    const root = makeRoot();
    const packagePath = writeJson(root, "package/settings.json", {
      version: 1,
      allow: [],
      block: ["rm *"],
    });
    const userPath = writeJson(root, "user/settings.json", {
      version: 1,
      allow: [],
      block: [" "],
    });

    const result = loadPolicyResult(packagePath, userPath);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a failed policy result");
    expect(result.error.filePath).toBe(userPath);
    expect(result.error.field).toBe("block");
    expect(result.error.index).toBe(0);
  });

  it("rejects the legacy bare-array format at the user path", () => {
    const root = makeRoot();
    const packagePath = writeJson(root, "package/settings.json", {
      version: 1,
      allow: [],
      block: ["rm *"],
    });
    const userPath = writeJson(root, "user/settings.json", ["rm *"]);

    const result = loadPolicyResult(packagePath, userPath);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a failed policy result");
    expect(result.error.filePath).toBe(userPath);
  });

  it("fails closed when the user path is unreadable", () => {
    const root = makeRoot();
    const packagePath = writeJson(root, "package/settings.json", {
      version: 1,
      allow: [],
      block: ["rm *"],
    });
    const userPath = join(root, "user/settings.json");
    mkdirSync(userPath, { recursive: true });

    const result = loadPolicyResult(packagePath, userPath);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a failed policy result");
    expect(result.error.filePath).toBe(userPath);
  });

  it("wraps a user allow/block conflict with the user file path", () => {
    const root = makeRoot();
    const packagePath = writeJson(root, "package/settings.json", {
      version: 1,
      allow: [],
      block: [],
    });
    const userPath = writeJson(root, "user/settings.json", {
      version: 1,
      allow: ["git push"],
      block: [" GIT PUSH "],
    });

    const result = loadPolicyResult(packagePath, userPath);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a failed policy result");
    expect(result.error.filePath).toBe(userPath);
    expect(result.error.message).toContain(userPath);
    expect(result.error.message).toContain("GIT PUSH");
  });
});
