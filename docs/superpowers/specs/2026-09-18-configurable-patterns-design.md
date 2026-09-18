# Configurable Command Patterns

## Status

Design approved in chat. Implementation has not started.

## Goal

Make the safe-command pattern policy configurable through JSON while preserving
the current matcher behavior and no-configuration behavior. The repository will
ship its defaults as JSON. End users will be able to add blocks and create
command-level allow exceptions through a private settings file.

## Non-goals

This change will not add:

- regex, glob, or typed rule schemas beyond the existing pattern syntax;
- project-local policy files;
- a Pi settings API or configurable path option;
- policy reload during a Pi process;
- global removal of a default pattern;
- changes to headless execution behavior;
- changes to the existing confirmation UI or session allow-list;
- an embedded TypeScript copy of the default patterns.

## Policy files

The package root will contain `settings.json`. It is the canonical default
policy and uses the version 1 schema:

```json
{
  "version": 1,
  "allow": [],
  "block": ["rm *"]
}
```

The current built-in pattern strings will move into `block` in their existing
order. `allow` must be present and empty in the shipped file.

The optional private user policy is:

```text
~/.pi/agent/extensions/pi-safe-command/settings.json
```

The path is resolved using the runtime home directory, not a machine-specific
absolute path. The extension will not create the directory or file. If the file
is absent, only the package defaults are used. If it exists, it must use the
same strict version 1 schema:

```json
{
  "version": 1,
  "allow": ["rm /tmp/*"],
  "block": ["curl * | sh"]
}
```

Both files use standard JSON. Comments and trailing commas are invalid. Required
fields are `version`, `allow`, and `block`. Unknown fields are invalid.
`version` must be `1`. Each array entry must be a non-empty string after
trimming.

The existing root `dangerPatterns.json` will be removed. Its old bare-array
format is not accepted at the new fixed user path. Users must migrate any old
custom file to the version 1 object schema.

## Resolution

Policy loading is synchronous and happens once during extension startup. The
policy is immutable for the life of the Pi process.

Resolution order:

1. Load and validate the package-root `settings.json`.
2. If present, load and validate the runtime-home user settings file.
3. Preserve the package block order.
4. Append user block entries after package blocks.
5. Silently deduplicate repeated block strings after trimming and lowercasing.
6. Preserve user allow entries for command-level exception checks.

A user block is additive. A user policy never replaces the shipped defaults. A
user allow is the only weakening mechanism, and it is command-level only:

- if any user allow pattern matches a command, the command is allowed by user
  preference even when multiple block patterns match it;
- the matching default block remains active for other commands;
- no allow entry disables a pattern globally;
- no allow entry removes a user-added block globally.

`isDangerous` and `getAllMatches` remain raw block matchers for compatibility.
They continue to operate on the resolved block list without applying user
allows. A new policy resolver is used by both bash interception and
`/test-pattern` so those two surfaces have identical effective behavior.

The resolver returns an effective status:

- unmatched, when no block pattern matches;
- allowed, when a user allow matches, including the raw block matches that were
  suppressed;
- blocked, when no allow matches and at least one block matches, including the
  first block and any additional matches.

The existing in-memory session allow-list retains priority over JSON policy.
Once the interactive confirmation UI allows a command for the session, that
command continues to run as it does today.

The existing matcher syntax and behavior remain unchanged, including:

- token-prefix and glob matching;
- substring matching for the current special-character patterns;
- shell-aware handling for the exact strings `git push` and `git branch -D`.

Those exact strings receive special Git handling regardless of whether they come
from package defaults or user blocks.

## Validation and failure behavior

Validation occurs before the bash handler is registered. Errors include the file
path and, when possible, the field and array index. Invalid conditions include:

- missing or invalid package `settings.json`;
- malformed JSON;
- wrong version;
- missing or unknown fields;
- non-array `allow` or `block` fields;
- empty or non-string entries;
- an exact normalized string appearing in both user `allow` and user `block`.

Non-identical allow/block overlaps are valid. If both match a command at
runtime, allow wins.

Repeated user block entries, including entries that repeat package defaults, are
silently deduplicated after trim/lowercase normalization. No-op allow and block
entries are valid so users can prepare policy for future defaults or commands.

If policy loading fails, the extension logs one detailed startup error and uses
a fail-closed bash handler that blocks every bash command with a concise
policy-invalid reason. It does not use an empty policy or a TypeScript fallback.
`/test-pattern` remains registered and reports the policy error.

If policy loading succeeds, missing user settings are silent and normal startup
produces no discovery log.

Headless behavior remains unchanged. In a valid policy, dangerous commands in
headless mode still follow the current warning-and-allow behavior. The JSON
change only controls pattern resolution.

## User-facing diagnostics

`/test-pattern` uses the same policy resolver as bash interception:

- no match reports no match;
- blocked commands report the first matching block and additional matching
  patterns using the existing diagnostic style;
- allowed commands report that a user preference allowed the command and list
  the block patterns that would otherwise have matched;
- invalid policy reports the startup policy error.

The existing confirmation prompt, `/clear-allowed`, and session allow-list
behavior remain unchanged.

## Implementation structure

- `settings.json`: new canonical package default policy.
- `dangerPatterns.json`: deleted.
- `src/patterns.ts`: retains matcher implementation and raw block-matching
  exports, but no longer owns the embedded default list or filesystem policy
  loading.
- `src/policy.ts`: loads and validates both JSON files, resolves paths,
  deduplicates blocks, and exposes the policy resolver and invalid-policy
  diagnostics.
- `src/index.ts`: loads policy synchronously, installs the fail-closed handler
  when necessary, and routes bash and `/test-pattern` through the shared
  resolver while preserving session behavior.
- `src/__tests__/patterns.test.ts`: retains matcher regression coverage and
  migrates package policy references.
- new policy tests: cover schemas, loading, missing user settings,
  normalization, deduplication, precedence, diagnostics, and fail-closed startup
  behavior.
- `README.md` and `package.json`: document the new policy files and update
  package assets and migration instructions.

## Verification

Before completion:

1. Format changed Markdown and JSON with the repository Prettier command.
2. Run focused policy and matcher tests.
3. Run `npm test`.
4. Run a TypeScript check if the repository setup supports one; otherwise report
   that no type-check script exists.
5. Inspect the final diff to verify that `dangerPatterns.json` and embedded
   duplicate defaults are gone, and that the new package and user policy
   behavior is documented.
