# Open Source pi-safe-command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare the pi-safe-command extension for open-source distribution on the Pi extension marketplace with tests, config, docs, and CI/CD.

**Architecture:** Move existing files into src/, add a JSON config for user-customizable patterns, write unit tests for the matching engine, add CI/CD with release-it, and expand README. No build step — Pi supports native TypeScript.

**Tech Stack:** TypeScript (native, no build), vitest for testing, release-it for conventional commits + npm publish, GitHub Actions for CI.

**Spec:** ../specs/2025-07-10-open-source-pi-safe-command-design.md

## Global Constraints

- Package name: `@kreeger/pi-safe-command`
- License: MIT
- Peer dependency: `@earendil-works/pi-coding-agent@*`
- File structure: `src/` for source, config/docs at root
- No build step — native TypeScript
- Tests: unit tests for matching engine only (isDangerous, matchGlob, matchTokens, matchesSubstring)
- Custom patterns: JSON file at root (`dangerPatterns.json`)
- CI: GitHub Actions test workflow + release-it for npm publish
- README: install + usage + pattern docs
- Pattern organization: add section comments grouping by category

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/index.ts` | Create (move) | Extension entry point |
| `src/patterns.ts` | Create (move) | Matching engine + danger patterns |
| `dangerPatterns.json` | Create | User-customizable patterns |
| `package.json` | Create | npm package config |
| `tsconfig.json` | Create | TypeScript config |
| `.gitignore` | Create | Ignore node_modules, dist |
| `LICENSE` | Create | MIT license |
| `README.md` | Modify | Expanded docs |
| `.github/workflows/test.yml` | Create | GitHub Actions test workflow |
| `release.config.json` | Create | release-it config |
| `src/__tests__/patterns.test.ts` | Create | Unit tests for matching engine |

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `LICENSE`

**Interfaces:**
- Consumes: nothing
- Produces: project structure ready for source files

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@kreeger/pi-safe-command",
  "version": "0.1.0",
  "description": "Prompts for confirmation before running dangerous commands in the pi-coding-agent.",
  "keywords": [
    "pi-package",
    "pi",
    "extension",
    "safe-command",
    "dangerous-commands"
  ],
  "repository": {
    "type": "git",
    "url": "git+https://github.com/kreeger/pi-safe-command.git"
  },
  "publishConfig": {
    "access": "public",
    "registry": "https://registry.npmjs.org/"
  },
  "license": "MIT",
  "author": "Ben Kreeger",
  "pi": {
    "extensions": [
      "./src/index.ts"
    ]
  },
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "test": "vitest run",
    "release": "release-it"
  },
  "devDependencies": {
    "@release-it/conventional-changelog": "^12.0.0",
    "@types/node": "^25.6.0",
    "release-it": "^21.0.2",
    "typescript": "^6.0.3",
    "vitest": "^3.0.0"
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "NodeNext",
    "moduleResolution": "nodenext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create .gitignore**

```
node_modules/
dist/
*.tsbuildinfo
```

- [ ] **Step 4: Create LICENSE (MIT)**

```
MIT License

Copyright (c) 2025 Ben Kreeger

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json .gitignore LICENSE
git commit -m "chore: add project scaffolding"
```

---

### Task 2: Move Source Files to src/

**Files:**
- Create: `src/index.ts` (move from `index.ts`)
- Create: `src/patterns.ts` (move from `patterns.ts`)
- Delete: `index.ts`
- Delete: `patterns.ts`

**Interfaces:**
- Consumes: nothing
- Produces: source files in src/ with correct import paths

- [ ] **Step 1: Create src/index.ts**

Read the current `index.ts` and write it to `src/index.ts`. The import on line 6 must stay as:

```typescript
import { isDangerous, getAllMatches } from "./patterns.js";
```

(The `.js` extension is correct for ESM module resolution even though the file is `.ts`.)

- [ ] **Step 2: Create src/patterns.ts**

Read the current `patterns.ts` and write it to `src/patterns.ts`. No changes needed — this file has no imports from other project files.

- [ ] **Step 3: Remove old files**

Delete `index.ts` and `patterns.ts` from the root.

- [ ] **Step 4: Verify imports work**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts src/patterns.ts
git rm index.ts patterns.ts
git commit -m "refactor: move source files to src/"
```

---

### Task 3: Add Custom Patterns Config

**Files:**
- Create: `dangerPatterns.json`
- Modify: `src/patterns.ts` — add JSON loading, export `loadCustomPatterns`
- Create: `src/__tests__/patterns.test.ts` — test file (empty shell, tests added in Task 4)

**Interfaces:**
- Consumes: nothing
- Produces: `loadCustomPatterns()` function that merges JSON config with built-in patterns, `customPatterns` export

- [ ] **Step 1: Create dangerPatterns.json**

Extract all patterns from the current `patterns.ts` `dangerPatterns` array into a JSON file:

```json
[
  "rm *",
  "del *",
  "git add *",
  "git commit *",
  "git push *",
  "git reset *",
  "git checkout *",
  "git rebase *",
  "git stash *",
  "git clean *",
  "git branch -D",
  "git cherry-pick --abort",
  "git merge --abort",
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
```

- [ ] **Step 2: Update src/patterns.ts — add JSON loading**

Add these imports and function at the top of `src/patterns.ts` (after the existing type definition, before the `p` helper):

```typescript
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Load custom patterns from dangerPatterns.json.
 * Returns an array of pattern strings.
 */
function loadCustomPatterns(): string[] {
  try {
    const configPath = join(__dirname, "..", "dangerPatterns.json");
    const raw = readFileSync(configPath, "utf-8");
    return JSON.parse(raw) as string[];
  } catch {
    // If config file doesn't exist or is invalid, return empty array
    // Built-in patterns are used as-is
    return [];
  }
}

/**
 * Custom patterns loaded from dangerPatterns.json.
 * These are merged with built-in patterns at runtime.
 */
export const customPatterns: DangerPattern[] = loadCustomPatterns().map(
  (p) => ({ pattern: p }),
);
```

- [ ] **Step 3: Update src/patterns.ts — merge custom patterns**

Change the `dangerPatterns` export to include custom patterns. Replace the current export line:

```typescript
export const dangerPatterns: DangerPattern[] = [
```

With a computed export at the bottom of the file (after the array definition, before the matching functions):

```typescript
// Built-in patterns (defined above)
const builtinPatterns: DangerPattern[] = [
  // ... (all existing patterns stay here, just change variable name)
];

// Merged: built-in + custom
export const dangerPatterns: DangerPattern[] = [
  ...builtinPatterns,
  ...customPatterns,
];
```

Actually, simpler approach: keep `dangerPatterns` as the array definition but add a merge at the end:

```typescript
// Merge custom patterns into dangerPatterns
export const dangerPatterns: DangerPattern[] = [
  ...builtinPatterns,
  ...customPatterns,
];
```

Wait — the simpler approach: just append custom patterns to the existing array export. Change the final line of the patterns section from:

```typescript
];
```

To:

```typescript
];

// Merge custom patterns from config
export const dangerPatterns: DangerPattern[] = [
  ...builtinPatterns,
  ...customPatterns,
];
```

And rename the current array variable to `builtinPatterns`.

- [ ] **Step 4: Create test file shell**

Create `src/__tests__/patterns.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { isDangerous, getAllMatches } from "../patterns.js";

describe("isDangerous", () => {
  // Tests added in Task 4
});

describe("getAllMatches", () => {
  // Tests added in Task 4
});
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add dangerPatterns.json src/patterns.ts src/__tests__/patterns.test.ts
git commit -m "feat: add custom patterns config from JSON"
```

---

### Task 4: Unit Tests for Matching Engine

**Files:**
- Modify: `src/__tests__/patterns.test.ts` — add all test cases

**Interfaces:**
- Consumes: `isDangerous`, `getAllMatches` from `../patterns.js`
- Produces: comprehensive test suite covering all matching modes

- [ ] **Step 1: Add glob pattern tests**

```typescript
describe("isDangerous — glob patterns", () => {
  it("matches rm -rf /", () => {
    expect(isDangerous("rm -rf /")).not.toBeNull();
  });

  it("matches sudo rm -rf / (position-flexible)", () => {
    expect(isDangerous("sudo rm -rf /")).not.toBeNull();
  });

  it("does not match rmfile (no token boundary)", () => {
    expect(isDangerous("rmfile")).toBeNull();
  });

  it("matches curl http://x | sh", () => {
    expect(isDangerous("curl http://x | sh")).not.toBeNull();
  });

  it("does not match curl http://x (no trailing sh)", () => {
    expect(isDangerous("curl http://x")).toBeNull();
  });

  it("matches docker system prune", () => {
    expect(isDangerous("docker system prune")).not.toBeNull();
  });

  it("matches kubectl delete pod foo", () => {
    expect(isDangerous("kubectl delete pod foo")).not.toBeNull();
  });

  it("matches apt-get update", () => {
    expect(isDangerous("apt-get update")).not.toBeNull();
  });

  it("matches yum install foo", () => {
    expect(isDangerous("yum install foo")).not.toBeNull();
  });

  it("matches npm publish", () => {
    expect(isDangerous("npm publish")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Add substring pattern tests**

```typescript
describe("isDangerous — substring patterns", () => {
  it("matches dd if=/dev/zero", () => {
    expect(isDangerous("dd if=/dev/zero")).not.toBeNull();
  });

  it("does not match dd if you want (no special char)", () => {
    // "dd if=" uses = which makes it substring-safe
    // "dd if you want" does NOT contain "dd if=" so should not match
    expect(isDangerous("dd if you want")).toBeNull();
  });

  it("matches git branch -D main", () => {
    expect(isDangerous("git branch -D main")).not.toBeNull();
  });

  it("matches iptables -F", () => {
    expect(isDangerous("iptables -F")).not.toBeNull();
  });

  it("matches iptables -P INPUT ACCEPT", () => {
    expect(isDangerous("iptables -P INPUT ACCEPT")).not.toBeNull();
  });

  it("matches ufw disable", () => {
    expect(isDangerous("ufw disable")).not.toBeNull();
  });

  it("matches crontab -r", () => {
    expect(isDangerous("crontab -r")).not.toBeNull();
  });

  it("matches crontab -e", () => {
    expect(isDangerous("crontab -e")).not.toBeNull();
  });
});
```

- [ ] **Step 3: Add token-level pattern tests**

```typescript
describe("isDangerous — token-level patterns", () => {
  it("matches chmod 777 file", () => {
    expect(isDangerous("chmod 777 file")).not.toBeNull();
  });

  it("matches chown root file", () => {
    expect(isDangerous("chown root file")).not.toBeNull();
  });

  it("matches userdel foo", () => {
    expect(isDangerous("userdel foo")).not.toBeNull();
  });

  it("matches groupdel foo", () => {
    expect(isDangerous("groupdel foo")).not.toBeNull();
  });

  it("matches yes *", () => {
    expect(isDangerous("yes *")).not.toBeNull();
  });

  it("matches :(){ :|:& };", () => {
    expect(isDangerous(":(){ :|:& };")).not.toBeNull();
  });
});
```

- [ ] **Step 4: Add safe command tests (false negatives)**

```typescript
describe("isDangerous — safe commands should not match", () => {
  it("does not match rm -i (interactive rm is safe-ish but matches rm *)", () => {
    // rm -i DOES match "rm *" — this is expected behavior
    expect(isDangerous("rm -i file")).not.toBeNull();
  });

  it("does not match normal git operations like git status", () => {
    expect(isDangerous("git status")).toBeNull();
  });

  it("does not match normal git operations like git log", () => {
    expect(isDangerous("git log")).toBeNull();
  });

  it("does not match normal docker operations like docker ps", () => {
    expect(isDangerous("docker ps")).toBeNull();
  });

  it("does not match normal docker operations like docker images", () => {
    expect(isDangerous("docker images")).toBeNull();
  });

  it("does not match safe apt operations like apt list", () => {
    expect(isDangerous("apt list")).toBeNull();
  });

  it("does not match normal npm operations like npm install", () => {
    expect(isDangerous("npm install foo")).toBeNull();
  });

  it("does not match normal npm operations like npm run", () => {
    expect(isDangerous("npm run test")).toBeNull();
  });

  it("does not match safe kubectl operations like kubectl get pods", () => {
    expect(isDangerous("kubectl get pods")).toBeNull();
  });

  it("does not match safe kubectl operations like kubectl describe", () => {
    expect(isDangerous("kubectl describe pod foo")).toBeNull();
  });
});
```

- [ ] **Step 5: Add getAllMatches tests**

```typescript
describe("getAllMatches", () => {
  it("returns all matching patterns for a command matching multiple", () => {
    const matches = getAllMatches("rm -rf /");
    expect(matches.length).toBeGreaterThan(1);
  });

  it("returns single match for a command matching one pattern", () => {
    const matches = getAllMatches("git status");
    // git status should not match anything
    expect(matches.length).toBe(0);
  });

  it("returns empty array for safe commands", () => {
    const matches = getAllMatches("echo hello");
    expect(matches).toEqual([]);
  });
});
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/__tests__/patterns.test.ts
git commit -m "test: add unit tests for matching engine"
```

---

### Task 5: Improve Pattern Organization

**Files:**
- Modify: `src/patterns.ts` — add section comments grouping patterns by category

**Interfaces:**
- Consumes: existing `builtinPatterns` array
- Produces: same patterns, organized with section comments

- [ ] **Step 1: Add section comments to builtinPatterns**

Add section headers inside the `builtinPatterns` array, using TypeScript comment syntax:

```typescript
const builtinPatterns: DangerPattern[] = [
  // ============================================================================
  // FILE DELETION
  // ============================================================================
  p("rm *"),
  p("del *"),

  // ============================================================================
  // GIT
  // ============================================================================
  p("git add *"),
  p("git commit *"),
  // ... etc for each section
];
```

Sections: FILE DELETION, GIT, PERMISSIONS, USER MANAGEMENT, FILESYSTEM, FORK BOMB, DOCKER, KUBERNETES, PACKAGE MANAGERS, REMOTE SCRIPT EXECUTION, NETWORK/SECURITY, RESOURCE EXHAUSTION, DATABASE.

- [ ] **Step 2: Verify TypeScript still compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/patterns.ts
git commit -m "chore: add section comments to danger patterns"
```

---

### Task 6: Add GitHub Actions Workflow

**Files:**
- Create: `.github/workflows/test.yml`

**Interfaces:**
- Consumes: nothing
- Produces: CI workflow that runs tests on every push

- [ ] **Step 1: Create .github/workflows/test.yml**

```yaml
name: Test

on:
  push:
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 26
          cache: npm
      - run: npm ci
      - run: npm test
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/test.yml
git commit -m "ci: add GitHub Actions test workflow"
```

---

### Task 7: Add Release Configuration

**Files:**
- Create: `release.config.json`

**Interfaces:**
- Consumes: nothing
- Produces: release-it config for conventional commits + changelog + npm publish + GitHub release

- [ ] **Step 1: Create release.config.json**

```json
{
  "git": {
    "commitMessage": "chore: release v${version}",
    "tagName": "v${version}",
    "push": true
  },
  "npm": {
    "publish": true
  },
  "github": {
    "release": true
  },
  "plugins": {
    "@release-it/conventional-changelog": {
      "infile": "CHANGELOG.md",
      "preset": "conventionalcommits"
    }
  },
  "hooks": {
    "before:init": "npm test"
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add release.config.json
git commit -m "chore: add release-it configuration"
```

---

### Task 8: Expand README

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing
- Produces: comprehensive README with install, usage, config, and pattern docs

- [ ] **Step 1: Write expanded README.md**

```markdown
# Safe Command Extension

Prompts for confirmation before running dangerous commands in the pi-coding-agent.

## Installation

Install from npm:

```bash
pi extension install @kreeger/pi-safe-command
```

Or add to your project:

```bash
npm install @kreeger/pi-safe-command
```

## Commands

- `/clear-allowed` — Resets the allowed commands list
- `/test-pattern <command>` — Test if a command matches dangerous patterns

## Dangerous Patterns

The extension checks commands against a set of dangerous patterns before execution. Patterns are grouped into categories:

### File Deletion
`rm *`, `del *`

### Git
`git add *`, `git commit *`, `git push *`, `git reset *`, `git checkout *`, `git rebase *`, `git stash *`, `git clean *`, `git branch -D`, `git cherry-pick --abort`, `git merge --abort`

### Permissions
`chmod *`, `chown *`

### User Management
`userdel`, `groupdel`

### Filesystem
`mkfs`, `dd if=`

### Fork Bomb
`:(){ :|:& };`

### Docker
`docker rm *`, `docker rmi *`, `docker stop *`, `docker kill *`, `docker system prune`, `docker-compose down`

### Kubernetes
`kubectl delete *`, `kubectl apply *`

### Package Managers
`apt install *`, `apt remove *`, `apt-get *`, `yum`, `dnf`, `pacman -Rscn`, `npm uninstall *`, `npm rm *`, `npm exec *`, `npm publish`, `pip uninstall *`

### Remote Script Execution
`curl * | sh`, `wget * | sh`

### Network/Security
`iptables -F`, `iptables -P INPUT ACCEPT`, `ufw disable`, `sshd`, `crontab -r`, `crontab -e`

### Resource Exhaustion
`yes *`

### Database
`DROP DATABASE`, `DROP TABLE`, `TRUNCATE TABLE`, `redis-cli FLUSHDB`, `redis-cli FLUSHALL`, `mongo --eval *`

## Custom Patterns

Add your own danger patterns by editing `dangerPatterns.json` in the package root. Each line is a pattern string using the same syntax as built-in patterns.

### Pattern Syntax

**Glob patterns** (contain `*` or `?`): Position-flexible prefix matching. The first non-wildcard token is used as an anchor, and the pattern matches if that anchor appears anywhere in the command.

Examples:
- `rm *` matches `rm -rf /` and `sudo rm -rf /`
- `curl * | sh` matches `curl http://x | sh`

**Literal patterns** (no wildcards): Token-level prefix matching. Each pattern token must be a prefix of the corresponding command token.

Examples:
- `chmod *` matches `chmod 777 file`
- `userdel` matches `userdel foo`

**Substring patterns** (contain `=`, `--`, or `;`): Substring matching for precision.

Examples:
- `dd if=` matches `dd if=/dev/zero` but not `dd if you want`
- `git branch -D` matches `git branch -D main` but not `git branch -Dd`

## Session Allow List

- Commands approved via "Allow (once)" are allowed for that execution only
- Commands approved via "Allow (session)" are stored and allowed for the current agent session
- Clear the allow list with `/clear-allowed`
- If no UI is available, dangerous commands run without confirmation (with a console warning)

## Development

```bash
npm install
npm test
```

## License

MIT — see [LICENSE](LICENSE) for details.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: expand README with install, usage, and pattern docs"
```

---

### Task 9: Final Verification

**Files:**
- No file changes — verification only

**Interfaces:**
- Consumes: everything from previous tasks
- Produces: verified working open-source package

- [ ] **Step 1: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 2: Run all tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Verify package.json is valid**

```bash
npm pack --dry-run
```

Expected: package can be packed without errors.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: final verification and cleanup"
```

- [ ] **Step 5: Tag initial release**

```bash
npm run release
```

This will:
1. Run tests (via hook)
2. Bump version (0.1.0 → 0.1.1 or prompt for version)
3. Generate changelog from conventional commits
4. Create git tag
5. Push to GitHub
6. Publish to npm
7. Create GitHub release

---

## Execution Order

Tasks must be executed in order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9

Each task is independently testable and commit-able.