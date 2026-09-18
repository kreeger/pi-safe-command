/**
 * Safe-command policy schema and validation.
 *
 * Both the package default policy and the optional user policy use the same
 * strict version 1 JSON schema:
 *
 *   { "version": 1, "allow": [], "block": [] }
 *
 * Standard JSON only — comments, trailing commas, unknown fields, coercible
 * values, and the legacy bare-array format are all rejected.
 *
 * Resolution (`resolvePolicy`) merges a validated package default document
 * with an optional validated user document and exposes the effective command
 * decision through `decidePolicy`.
 */

import { readFileSync } from "node:fs";
import { matches } from "./patterns.js";

export type PolicyDocument = {
  version: 1;
  allow: string[];
  block: string[];
};

/** A single effective pattern entry. */
export type Pattern = { pattern: string };

/** The effective allow/block lists after merging package and user policies. */
export type ResolvedPolicy = {
  allows: Pattern[];
  blocks: Pattern[];
};

/**
 * The effective decision for one command.
 *
 * - `unmatched`: no allow or block pattern matched.
 * - `allowed`: at least one allow matched; `blockMatches` lists the raw block
 *   patterns that were suppressed for this command.
 * - `blocked`: no allow matched but at least one block did.
 */
export type PolicyDecision =
  | { status: "unmatched"; allowMatches: Pattern[]; blockMatches: Pattern[] }
  | { status: "allowed"; allowMatches: Pattern[]; blockMatches: Pattern[] }
  | { status: "blocked"; allowMatches: Pattern[]; blockMatches: Pattern[] };

export type PolicyError = Error & {
  filePath: string;
  field?: string;
  index?: number;
};

/**
 * Result of loading the policy files. A failure carries the detailed
 * `PolicyError` so callers can install a fail-closed path without catching an
 * untyped exception.
 */
export type PolicyLoadResult =
  | { ok: true; policy: ResolvedPolicy }
  | { ok: false; error: PolicyError };

const POLICY_FIELDS = ["version", "allow", "block"] as const;
type ArrayField = "allow" | "block";

function createPolicyError(
  detail: string,
  filePath: string,
  context: { field?: string; index?: number } = {},
): PolicyError {
  const error = new Error(`Invalid policy at ${filePath}: ${detail}`) as PolicyError;
  error.filePath = filePath;
  if (context.field !== undefined) error.field = context.field;
  if (context.index !== undefined) error.index = context.index;
  return error;
}

export function normalizePattern(pattern: string): string {
  return pattern.trim().toLowerCase();
}

function validatePatternArray(
  value: unknown,
  field: ArrayField,
  filePath: string,
): string[] {
  if (!Array.isArray(value)) {
    throw createPolicyError(`"${field}" must be an array`, filePath, { field });
  }

  // Iterate by index rather than using `value.map`, which skips holes in a
  // sparse array and would silently accept hole entries.
  const entries: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry: unknown = value[index];
    if (typeof entry !== "string" || entry.trim() === "") {
      throw createPolicyError(`"${field}[${index}]" must be a non-empty string`, filePath, {
        field,
        index,
      });
    }
    entries.push(entry);
  }
  return entries;
}

export function validatePolicyDocument(value: unknown, filePath: string): PolicyDocument {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw createPolicyError("policy must be a JSON object", filePath);
  }

  const record = value as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if (!(POLICY_FIELDS as readonly string[]).includes(key)) {
      throw createPolicyError(`unknown field "${key}"`, filePath, { field: key });
    }
  }

  for (const key of POLICY_FIELDS) {
    if (!(key in record)) {
      throw createPolicyError(`missing required field "${key}"`, filePath, { field: key });
    }
  }

  if (record.version !== 1) {
    throw createPolicyError(`"version" must be 1`, filePath, { field: "version" });
  }

  return {
    version: 1,
    allow: validatePatternArray(record.allow, "allow", filePath),
    block: validatePatternArray(record.block, "block", filePath),
  };
}

/**
 * Convert raw block pattern strings into `Pattern` entries, dropping repeats of
 * the same trimmed/lowercased string. The first occurrence wins, so package
 * defaults keep their original spelling and position ahead of user additions.
 * Allowing entries are not passed through here: user allows are preserved in
 * full so command-level exceptions never lose a supplied entry.
 */
function toPatterns(entries: string[]): Pattern[] {
  const seen = new Set<string>();
  const patterns: Pattern[] = [];
  for (const entry of entries) {
    const key = normalizePattern(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    patterns.push({ pattern: entry });
  }
  return patterns;
}

/**
 * Reject a user policy whose `allow` and `block` contain the same string after
 * normalization. Non-identical overlaps are valid and resolved at runtime by
 * `decidePolicy` (allow wins).
 */
function assertNoUserConflict(user: PolicyDocument): void {
  const allowed = new Set(user.allow.map(normalizePattern));
  for (const block of user.block) {
    if (allowed.has(normalizePattern(block))) {
      throw new Error(
        `Invalid policy: "${block}" cannot appear in both allow and block`,
      );
    }
  }
}

/**
 * Merge validated package defaults with an optional validated user document.
 * Allow entries keep their supplied order and are never deduplicated: package
 * allows precede user allows and every entry is preserved. Package blocks keep
 * their order, user blocks are appended, and normalized duplicates are dropped.
 * An allow entry never removes or disables a block pattern; it only becomes a
 * command-level exception.
 */
export function resolvePolicy(
  defaults: PolicyDocument,
  user: PolicyDocument | null,
): ResolvedPolicy {
  if (user) assertNoUserConflict(user);

  return {
    allows: [...defaults.allow, ...(user?.allow ?? [])].map((pattern) => ({
      pattern,
    })),
    blocks: toPatterns([...defaults.block, ...(user?.block ?? [])]),
  };
}

/**
 * Resolve the effective status for one command.
 *
 * Allows are matched first: any allow match returns `allowed` and reports the
 * raw block matches that were suppressed. Otherwise a non-empty block match
 * returns `blocked`; no matches return `unmatched`.
 */
export function decidePolicy(
  policy: ResolvedPolicy,
  command: string,
): PolicyDecision {
  const allowMatches = policy.allows.filter(({ pattern }) =>
    matches(command, pattern),
  );
  const blockMatches = policy.blocks.filter(({ pattern }) =>
    matches(command, pattern),
  );

  if (allowMatches.length > 0) {
    return { status: "allowed", allowMatches, blockMatches };
  }
  if (blockMatches.length > 0) {
    return { status: "blocked", allowMatches: [], blockMatches };
  }
  return { status: "unmatched", allowMatches: [], blockMatches: [] };
}

/**
 * Read one policy file. `ENOENT` is the only read failure treated as absence:
 * it covers both a missing file and a missing parent directory, and nothing is
 * created. Every other read failure (for example a directory in place of the
 * file) is a `PolicyError` carrying the path. Returns `null` when absent.
 */
function readPolicyFile(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw createPolicyError(
      `unable to read file: ${error instanceof Error ? error.message : String(error)}`,
      filePath,
    );
  }
}

function parsePolicyFile(contents: string, filePath: string): PolicyDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw createPolicyError(
      `malformed JSON: ${error instanceof Error ? error.message : String(error)}`,
      filePath,
    );
  }
  return validatePolicyDocument(parsed, filePath);
}

function loadRequiredPolicyFile(filePath: string): PolicyDocument {
  const contents = readPolicyFile(filePath);
  if (contents === null) {
    throw createPolicyError("file is missing", filePath);
  }
  return parsePolicyFile(contents, filePath);
}

function loadOptionalPolicyFile(filePath: string): PolicyDocument | null {
  const contents = readPolicyFile(filePath);
  return contents === null ? null : parsePolicyFile(contents, filePath);
}

/**
 * Attribute a resolution failure to the user policy. `resolvePolicy` is
 * pathless, and its only failure is a user allow/block conflict, so the user
 * settings path from the loader is the offending file.
 */
function createUserConflictError(
  error: unknown,
  userSettingsPath: string,
): PolicyError {
  const detail = error instanceof Error ? error.message : String(error);
  const policyError = new Error(
    `${detail} (in ${userSettingsPath})`,
  ) as PolicyError;
  policyError.filePath = userSettingsPath;
  return policyError;
}

/**
 * Load the required package policy and the optional user policy, then resolve
 * them into the effective policy.
 *
 * The package file must exist, be readable, be valid JSON, and satisfy the
 * strict version 1 schema. The user file is optional: an absent file (including
 * a missing parent directory) falls back to the package defaults silently, but
 * a present file that is unreadable, malformed, or invalid fails the load
 * instead of being ignored. Every failure throws a `PolicyError` carrying the
 * offending path (plus field/index for schema failures). No fallback policy is
 * synthesized and no file or directory is created or written.
 */
export function loadPolicy(
  packageSettingsPath: string,
  userSettingsPath: string,
): ResolvedPolicy {
  const defaults = loadRequiredPolicyFile(packageSettingsPath);
  const user = loadOptionalPolicyFile(userSettingsPath);

  try {
    return resolvePolicy(defaults, user);
  } catch (error) {
    throw createUserConflictError(error, userSettingsPath);
  }
}

function asPolicyError(error: unknown, filePath: string): PolicyError {
  if (
    error instanceof Error &&
    typeof (error as PolicyError).filePath === "string"
  ) {
    return error as PolicyError;
  }
  return createPolicyError(
    error instanceof Error ? error.message : String(error),
    filePath,
  );
}

/**
 * Fail-closed variant of `loadPolicy`. Never throws: returns the resolved
 * policy or the detailed `PolicyError` for the caller to log and act on.
 */
export function loadPolicyResult(
  packageSettingsPath: string,
  userSettingsPath: string,
): PolicyLoadResult {
  try {
    return {
      ok: true,
      policy: loadPolicy(packageSettingsPath, userSettingsPath),
    };
  } catch (error) {
    return { ok: false, error: asPolicyError(error, packageSettingsPath) };
  }
}
