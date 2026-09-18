# Configurable Command Patterns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the safe-command defaults to JSON and add a strict, user-level
JSON policy that can add blocks and create command-level allow exceptions
without changing the existing matcher behavior.

**Architecture:** Keep pattern matching in `src/patterns.ts`, but remove its
embedded default list and filesystem loading. Add `src/policy.ts` for strict
policy-file loading, validation, normalization, precedence, and
effective-command resolution. Load one immutable policy synchronously in
`src/index.ts`, use the resolver for both bash interception and `/test-pattern`,
and fail closed if either the required package policy or the optional user
policy is invalid.

**Tech Stack:** Native TypeScript ESM, Node `fs`/`path`/`os`, Vitest, existing
Pi extension API.

**Spec:** `docs/superpowers/specs/2026-09-18-configurable-patterns-design.md`

## Global Constraints

- Preserve the existing matcher syntax and behavior, including shell-aware exact
  `git push` and `git branch -D` handling.
- Use root `settings.json` as the only canonical package default source; do not
  retain an embedded TypeScript default list.
- Use the optional runtime-home file
  `~/.pi/agent/extensions/pi-safe-command/settings.json` as the only user
  override source.
- Both policy files use strict standard JSON with
  `{ "version": 1, "allow": [...], "block": [...] }`; reject unknown fields and
  invalid entries.
- User blocks append to package blocks and are deduplicated after trim/lowercase
  normalization.
- User allows are command-level exceptions checked before all blocks; they never
  disable a pattern globally.
- Load and validate synchronously once at startup. Do not create the user
  directory or file and do not reload during a process.
- Preserve session allow-list behavior and valid-policy headless behavior.
- Invalid policy logs a detailed error, blocks every bash call, and leaves
  `/test-pattern` available to report the policy error.
- Format modified JSON and Markdown with the configured `prettierd` command
  before completion.

---

## File Map

- Create: `settings.json`
  - Version-1 package policy with empty `allow` and the current block strings in
    their current order.
- Delete: `dangerPatterns.json`
  - Remove the old package-root bare-array policy file.
- Create: `src/policy.ts`
  - Policy document types, strict validation, file loading,
    normalization/deduplication, resolved policy construction, and command-level
    decision resolution.
- Create: `src/__tests__/policy.test.ts`
  - Pure policy validation and resolution tests, with temporary filesystem
    fixtures for loading tests.
- Modify: `src/patterns.ts`
  - Remove embedded defaults and old `dangerPatterns.json` loading. Accept the
    resolved block list through the existing raw matching functions without
    changing matcher semantics or public raw-match return shapes.
- Modify: `src/index.ts`
  - Load policy synchronously, install fail-closed behavior when policy loading
    fails, use one resolver for bash and `/test-pattern`, and preserve session
    allow-list behavior.
- Modify: `src/__tests__/patterns.test.ts`
  - Replace old custom-pattern file assertions with assertions against the new
    default policy and preserve all matching regressions.
- Modify: `README.md`
  - Document package defaults, user settings path/schema, precedence,
    validation, migration from `dangerPatterns.json`, and diagnostics.
- Modify: `package.json`
  - Publish root `settings.json` instead of `dangerPatterns.json`; retain
    existing scripts unless a type-check script is explicitly added during
    implementation.

---

### Task 1: Add policy types and strict validation tests

**Files:**

- Create: `src/policy.ts`
- Create: `src/__tests__/policy.test.ts`

**Interfaces:**

- Produces `PolicyDocument` with `version: 1`, `allow: string[]`, and
  `block: string[]`.
- Produces `PolicyError` with `message: string`, `filePath: string`, and
  optional `field: string` and `index: number`.
- Produces
  `validatePolicyDocument(value: unknown, filePath: string): PolicyDocument`.
- Produces `normalizePattern(pattern: string): string`.

- [ ] **Step 1: Write failing validation tests**

Add tests that establish the exact schema contract:

```ts
it("accepts the version 1 full schema", () => {
  expect(
    validatePolicyDocument(
      { version: 1, allow: ["git push"], block: ["rm *"] },
      "/policy/settings.json",
    ),
  ).toEqual({ version: 1, allow: ["git push"], block: ["rm *"] });
});

it.each([
  undefined,
  null,
  [],
  { version: 0, allow: [], block: [] },
  { version: 1, allow: [], block: [], extra: true },
  { version: 1, allow: "git push", block: [] },
  { version: 1, allow: [""], block: [] },
  { version: 1, allow: ["git push", 42], block: [] },
  { version: 1, allow: [], block: [" "] },
])("rejects invalid policy documents: %j", (value) => {
  expect(() =>
    validatePolicyDocument(value, "/policy/settings.json"),
  ).toThrow();
});

it("normalizes only for policy identity checks", () => {
  expect(normalizePattern("  GIT PUSH  ")).toBe("git push");
});
```

Also test that errors identify the path and, for bad array entries, the field
and index. Test that a valid pattern string remains unchanged in the returned
document except for the required non-empty validation contract.

- [ ] **Step 2: Run the focused test file and verify it fails**

Run: `npx vitest run src/__tests__/policy.test.ts`

Expected: FAIL because `src/policy.ts` and its validation exports do not exist.

- [ ] **Step 3: Implement the minimal types and validator**

Implement strict object validation in `src/policy.ts`:

```ts
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

export function normalizePattern(pattern: string): string {
  return pattern.trim().toLowerCase();
}

export function validatePolicyDocument(
  value: unknown,
  filePath: string,
): PolicyDocument {
  // Check a non-null, non-array object, exact keys, version === 1,
  // array fields, and non-empty string entries. Throw a PolicyError with
  // filePath/field/index context on the first failure.
}
```

Do not silently coerce values, accept comments, accept trailing commas, or
accept the old bare-array format at this stage.

- [ ] **Step 4: Run the focused tests and verify they pass**

Run: `npx vitest run src/__tests__/policy.test.ts`

Expected: PASS for schema, normalization, and diagnostic tests.

- [ ] **Step 5: Commit**

```bash
git add src/policy.ts src/__tests__/policy.test.ts
git commit -m "test: define strict policy schema"
```

---

### Task 2: Add package defaults and policy resolution tests

**Files:**

- Create: `settings.json`
- Modify: `src/policy.ts`
- Modify: `src/__tests__/policy.test.ts`

**Interfaces:**

- Consumes `PolicyDocument` and `normalizePattern` from Task 1.
- Produces `ResolvedPolicy`:

```ts
export type Pattern = { pattern: string };
export type ResolvedPolicy = {
  allows: Pattern[];
  blocks: Pattern[];
};
export type PolicyDecision =
  | { status: "unmatched"; allowMatches: Pattern[]; blockMatches: Pattern[] }
  | { status: "allowed"; allowMatches: Pattern[]; blockMatches: Pattern[] }
  | { status: "blocked"; allowMatches: Pattern[]; blockMatches: Pattern[] };
```

- Produces
  `resolvePolicy(defaults: PolicyDocument, user: PolicyDocument | null): ResolvedPolicy`
  and `decidePolicy(policy: ResolvedPolicy, command: string): PolicyDecision`.
- `src/policy.ts` may import a matcher predicate from `src/patterns.ts`, but
  avoid a circular import. Prefer moving or exporting the pure
  `matches(command, pattern)` function in a way that keeps `patterns.ts` as the
  matcher owner and lets policy resolution call it.

- [ ] **Step 1: Move the current built-in strings into `settings.json` and write
      policy tests**

Create root `settings.json` with:

```json
{
  "version": 1,
  "allow": [],
  "block": [
    "rm *",
    "del *",
    "git push",
    "git reset *",
    "git clean *",
    "git branch -D",
    "chmod *",
    "chown *",
    "userdel",
    "groupdel",
    "mkfs",
    "dd if=",
    ":(){ :|:& };",
    "docker rm *",
    "docker rmi *",
    "docker stop *",
    "docker kill *",
    "docker system prune",
    "docker-compose down",
    "kubectl delete *",
    "kubectl apply *",
    "apt install *",
    "apt remove *",
    "apt-get *",
    "yum",
    "dnf",
    "pacman -Rscn",
    "npm uninstall *",
    "npm rm *",
    "npm exec *",
    "npm publish",
    "pip uninstall *",
    "curl * | sh",
    "wget * | sh",
    "iptables -F",
    "iptables -P INPUT ACCEPT",
    "ufw disable",
    "sshd",
    "crontab -r",
    "crontab -e",
    "yes *",
    "DROP DATABASE",
    "DROP TABLE",
    "TRUNCATE TABLE",
    "redis-cli FLUSHDB",
    "redis-cli FLUSHALL",
    "mongo --eval *"
  ]
}
```

Before implementation, verify the list against the current `builtinPatterns`
array and preserve every string and its order exactly.

Add tests for:

```ts
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

it("lets a matching user allow override every block match for that command", () => {
  const policy = resolvePolicy(
    { version: 1, allow: [], block: ["rm *", "chmod *"] },
    { version: 1, allow: ["rm *"], block: [] },
  );
  expect(decidePolicy(policy, "rm file; chmod 777 file").status).toBe(
    "allowed",
  );
});

it("rejects an exact normalized user allow/block conflict", () => {
  expect(() =>
    resolvePolicy(
      { version: 1, allow: [], block: [] },
      { version: 1, allow: ["git push"], block: [" GIT PUSH "] },
    ),
  ).toThrow();
});
```

Also test that user blocks are additive, non-identical allow/block overlaps are
accepted, no-op entries are accepted, default order precedes user additions, and
`decidePolicy` returns the raw suppressed block matches for an allowed command.

- [ ] **Step 2: Run the focused policy tests and verify they fail**

Run: `npx vitest run src/__tests__/policy.test.ts`

Expected: FAIL because resolution functions and the JSON default source are not
implemented.

- [ ] **Step 3: Implement resolution and move defaults out of TypeScript**

In `src/patterns.ts`, remove `DangerPattern` construction helpers,
`builtinPatterns`, `customPatterns`, and package-root file loading. Keep the
existing tokenization and matching functions unchanged. Export the pure matcher
needed by policy resolution and keep raw matching exports operating on a
supplied or module-level resolved block list without changing their return
shape.

In `src/policy.ts`, implement:

```ts
export function resolvePolicy(
  defaults: PolicyDocument,
  user: PolicyDocument | null,
): ResolvedPolicy {
  // Validate normalized allow/block conflict, append blocks, and dedupe blocks.
}

export function decidePolicy(
  policy: ResolvedPolicy,
  command: string,
): PolicyDecision {
  // Match allows first. If any allow matches, return allowed with all raw
  // block matches. Otherwise return blocked when blockMatches is non-empty.
}
```

The resolver must not remove or globally disable any block pattern because of an
allow entry.

- [ ] **Step 4: Run policy tests and verify they pass**

Run: `npx vitest run src/__tests__/policy.test.ts`

Expected: PASS, including order, deduplication, precedence, and conflict
behavior.

- [ ] **Step 5: Commit**

```bash
git add settings.json src/policy.ts src/__tests__/policy.test.ts src/patterns.ts
git commit -m "feat: move command policy into JSON"
```

---

### Task 3: Add synchronous file loading and fail-closed startup tests

**Files:**

- Modify: `src/policy.ts`
- Modify: `src/__tests__/policy.test.ts`

**Interfaces:**

- Produces
  `loadPolicy(packageSettingsPath: string, userSettingsPath: string): ResolvedPolicy`.
- Produces `PolicyLoadResult`:

```ts
export type PolicyLoadResult =
  { ok: true; policy: ResolvedPolicy } | { ok: false; error: PolicyError };
```

- Produces
  `loadPolicyResult(packageSettingsPath: string, userSettingsPath: string): PolicyLoadResult`
  so `src/index.ts` can install either the valid policy or a fail-closed path
  without catching untyped exceptions.

- [ ] **Step 1: Write filesystem-loading tests**

Use `mkdtempSync` and `writeFileSync` under the OS temporary directory. Do not
read or write the real home extension directory in tests. Cover:

```ts
it("loads package defaults and an optional user settings file", () => {
  // Write package/settings.json and user/settings.json fixtures.
  // Assert the user block is appended and the user allow is active.
});

it("uses package defaults when the user file is absent", () => {
  // No user file. Assert loadPolicyResult(...).ok is true.
});

it("fails closed when the required package file is missing", () => {
  const result = loadPolicyResult(
    "/missing/settings.json",
    "/missing/user.json",
  );
  expect(result.ok).toBe(false);
});

it("fails closed when the user file is malformed or violates the schema", () => {
  // Write malformed JSON and invalid version-1 objects, assert detailed errors.
});
```

Test that a missing user parent directory is treated the same as an absent user
file, without creating it. Test that user bare arrays are rejected.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `npx vitest run src/__tests__/policy.test.ts`

Expected: FAIL because loading functions do not exist.

- [ ] **Step 3: Implement synchronous loaders**

Use `readFileSync`, `JSON.parse`, and `homedir()`/`join` only at the caller that
computes the default paths. Keep file loading path-parameterized for tests.

Implement these behaviors:

- package file missing, unreadable, malformed, or invalid returns `ok: false`;
- user file absent returns the default policy with no error;
- user file present but unreadable, malformed, or invalid returns `ok: false`;
- JSON parse errors include the file path;
- validation errors retain field/index context;
- no fallback policy is synthesized;
- no filesystem writes occur.

Do not catch and convert a missing package asset into an empty policy.

- [ ] **Step 4: Run the focused tests and verify they pass**

Run: `npx vitest run src/__tests__/policy.test.ts`

Expected: PASS for required package loading, optional user loading, and
fail-closed results.

- [ ] **Step 5: Commit**

```bash
git add src/policy.ts src/__tests__/policy.test.ts
git commit -m "feat: load policies fail closed"
```

---

### Task 4: Integrate policy resolution into the extension

**Files:**

- Modify: `src/index.ts`
- Modify: `src/patterns.ts`
- Create or modify: `src/__tests__/index.test.ts` if the existing test setup
  supports extension handler tests

**Interfaces:**

- Consumes `loadPolicyResult`, `decidePolicy`, and `ResolvedPolicy` from
  `src/policy.ts`.
- `isDangerous` and `getAllMatches` continue returning raw
  `DangerPattern | null` and `DangerPattern[]` values for the effective block
  list.
- The extension initializer must load the package root using a path based on
  `import.meta.url` and the user settings using
  `join(homedir(), ".pi", "agent", "extensions", "pi-safe-command", "settings.json")`.

- [ ] **Step 1: Add integration tests for valid and invalid startup**

Test the observable handler decisions with a minimal fake `ExtensionAPI` and
fake context, or adapt the repository’s existing extension-test conventions if
present. Cover:

```ts
it("uses user allows before prompting for a matching default block", async () => {
  // Configure a temporary user settings file with allow: ["git push"].
  // Invoke the bash tool_call handler for "git push".
  // Assert no confirmation UI is requested and the handler allows it.
});

it("blocks every bash call when startup policy is invalid", async () => {
  // Inject an invalid policy result or point loading at an invalid fixture.
  // Assert the tool_call result blocks and includes a policy-invalid reason.
});
```

Also assert that a valid dangerous command still follows the existing
confirmation choices, session allow-list, and no-UI warning behavior.

- [ ] **Step 2: Run integration tests and verify they fail**

Run: `npx vitest run src/__tests__/index.test.ts`

Expected: FAIL because `src/index.ts` still uses only `isDangerous` and has no
startup policy state.

- [ ] **Step 3: Implement startup loading and shared resolution**

At extension initialization:

```ts
const packageSettingsPath = fileURLToPath(
  new URL("../settings.json", import.meta.url),
);
const userSettingsPath = join(
  homedir(),
  ".pi",
  "agent",
  "extensions",
  "pi-safe-command",
  "settings.json",
);
const policyResult = loadPolicyResult(packageSettingsPath, userSettingsPath);
```

Log one detailed error when `policyResult.ok` is false. Register the bash
handler in both cases:

- invalid policy: block every bash call with
  `[SafeCommand] Blocked: policy configuration is invalid`;
- valid policy: check the existing `allowedCommands` session set first, then
  call `decidePolicy`;
- unmatched: return `undefined` so safe commands proceed;
- allowed by user preference: notify and return `{ block: false }` without
  confirmation;
- blocked: preserve the current confirmation prompt and diagnostic text, using
  the resolver’s block matches.

Update `/test-pattern` to use the same decision. For an allowed command, report
that user preference allowed it and list the suppressed block patterns. For a
blocked command, preserve the current match output. For an invalid policy,
report the stored policy error.

Keep `handleDangerousCommand`’s existing interactive and headless behavior after
it receives a resolved block decision.

- [ ] **Step 4: Run integration and matcher tests and verify they pass**

Run: `npx vitest run src/__tests__/index.test.ts src/__tests__/patterns.test.ts`

Expected: PASS, including allow precedence, invalid startup blocking,
confirmation behavior, session allow behavior, and headless compatibility.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts src/patterns.ts src/__tests__/index.test.ts
 git commit -m "feat: apply configurable policy in extension"
```

---

### Task 5: Migrate matcher tests and remove the old policy file

**Files:**

- Modify: `src/__tests__/patterns.test.ts`
- Delete: `dangerPatterns.json`

**Interfaces:**

- Consumes the policy-backed raw matcher behavior from Tasks 2 and 4.
- Preserves all existing matcher assertions, including Git shell cases and
  representative safe commands.

- [ ] **Step 1: Update the old custom-pattern test**

Remove the assertion that reads `../../dangerPatterns.json` and compares
`customPatterns`. Replace it with a package-policy assertion that reads the new
root `settings.json` and verifies its block list contains the patterns used by
the regression tests, for example:

```ts
it("loads the canonical package policy", () => {
  const configured = JSON.parse(
    readFileSync(new URL("../../settings.json", import.meta.url), "utf8"),
  ) as { version: number; allow: string[]; block: string[] };

  expect(configured.version).toBe(1);
  expect(configured.allow).toEqual([]);
  expect(configured.block).toContain("git push");
  expect(configured.block).toContain("rm *");
});
```

Preserve the existing matching tests rather than rewriting them around new
policy details.

- [ ] **Step 2: Run matcher tests and verify they pass**

Run: `npx vitest run src/__tests__/patterns.test.ts`

Expected: PASS with the old filename and custom-pattern references removed.

- [ ] **Step 3: Delete the old file and verify no code references remain**

Delete `dangerPatterns.json`, then run:

```bash
rg -n "dangerPatterns|customPatterns|builtinPatterns" src README.md package.json
```

Expected: no stale configuration references. Any intentional migration mention
in README should use the old filename only as historical documentation.

- [ ] **Step 4: Run the complete test suite**

Run: `npm test`

Expected: PASS with all matcher, policy, and extension tests green.

- [ ] **Step 5: Commit**

```bash
git add src/__tests__/patterns.test.ts dangerPatterns.json
 git commit -m "test: migrate from legacy pattern file"
```

---

### Task 6: Document and publish the new configuration contract

**Files:**

- Modify: `README.md`
- Modify: `package.json`

**Interfaces:**

- Documents the exact package and user settings schemas and paths implemented in
  Tasks 1–5.
- Publishes `settings.json` and no longer publishes `dangerPatterns.json`.

- [ ] **Step 1: Write the README configuration section**

Replace the old custom-pattern instructions with concrete documentation
containing:

````md
## Configuration

The package ships its default policy in `settings.json`:

```json
{
  "version": 1,
  "allow": [],
  "block": ["rm *", "git push"]
}
```
````

To add blocks or allow specific commands, create:

`~/.pi/agent/extensions/pi-safe-command/settings.json`

```json
{
  "version": 1,
  "allow": ["rm /tmp/*"],
  "block": ["my-dangerous-command"]
}
```

User blocks are appended to the package defaults. A matching user allow is a
command-level exception and takes precedence over all matching pattern blocks
for that command. It does not disable a default pattern globally. The user
settings file is loaded once when Pi starts. Missing means defaults only;
malformed or invalid JSON blocks bash commands until corrected and Pi is
restarted.

````

Document that the old root `dangerPatterns.json` bare-array format is no
longer used and must be migrated to the version-1 object. Document standard
JSON only, strict fields, current matcher syntax, `/test-pattern` diagnostics,
and preserved headless/session behavior.

- [ ] **Step 2: Update package metadata**

Change the `files` array in `package.json` from `dangerPatterns.json` to
`settings.json`. Do not add a build step or dependency. If implementation adds
a type-check script, document and run it; otherwise leave the existing scripts
unchanged.

- [ ] **Step 3: Format Markdown and JSON**

Run:

```bash
PRETTIERD_DEFAULT_CONFIG="$HOME/.config/prettier/config.json" prettierd README.md < README.md > README.md.tmp && mv README.md.tmp README.md
PRETTIERD_DEFAULT_CONFIG="$HOME/.config/prettier/config.json" prettierd settings.json < settings.json > settings.json.tmp && mv settings.json.tmp settings.json
PRETTIERD_DEFAULT_CONFIG="$HOME/.config/prettier/config.json" prettierd package.json < package.json > package.json.tmp && mv package.json.tmp package.json
````

Expected: commands exit successfully and only formatting changes are made beyond
the requested documentation and metadata edits.

- [ ] **Step 4: Run final verification**

Run:

```bash
npm test
npx tsc --noEmit
rg -n "dangerPatterns|customPatterns|builtinPatterns" src README.md package.json settings.json
```

Expected:

- `npm test` passes;
- `npx tsc --noEmit` passes, or its repository/setup limitation is recorded;
- no stale implementation references remain;
- the only historical `dangerPatterns` mention is the documented migration note.

- [ ] **Step 5: Inspect and commit the final diff**

Run: `git diff --check && git status --short && git diff --stat`

Expected: no whitespace errors, intended files only, and the old policy file
deleted.

```bash
git add README.md package.json settings.json
git commit -m "docs: document configurable command policy"
```
