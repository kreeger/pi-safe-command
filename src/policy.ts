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
 */

export type PolicyDocument = {
  version: 1;
  allow: string[];
  block: string[];
};

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
