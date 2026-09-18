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
 * Convert raw pattern strings into `Pattern` entries, dropping repeats of the
 * same trimmed/lowercased string. The first occurrence wins, so package
 * defaults keep their original spelling and position ahead of user additions.
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
 * Package blocks keep their order, user blocks are appended, and normalized
 * duplicates are dropped. An allow entry never removes or disables a block
 * pattern; it only becomes a command-level exception.
 */
export function resolvePolicy(
  defaults: PolicyDocument,
  user: PolicyDocument | null,
): ResolvedPolicy {
  if (user) assertNoUserConflict(user);

  return {
    allows: toPatterns([...defaults.allow, ...(user?.allow ?? [])]),
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
