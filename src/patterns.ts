/**
 * Dangerous Command Patterns
 *
 * Easy to extend! Just add patterns using p(pattern).
 * Glob tokens (* ?) use position-flexible prefix matching.
 * Literal patterns use token-level matching (word boundaries).
 *
 * Matching modes:
 * - Glob:  pattern starts with token P, command has P as a prefix of any token →
 *         remaining pattern tokens must match the corresponding remaining command
 *         tokens. This catches `sudo rm -rf /` matching `rm *`.
 * - Literal: tokens must match 1:1. Special chars (= -- ;) ensure precision.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Pattern type
export type DangerPattern = {
  pattern: string;
};

// Short helper to create patterns
const p = (pattern: string): DangerPattern => ({ pattern });

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Load custom patterns from dangerPatterns.json.
 * Returns an array of non-empty trimmed pattern strings.
 * Returns [] on parse error, non-array input, or empty strings.
 */
function loadCustomPatterns(): string[] {
  try {
    const configPath = join(__dirname, "..", "dangerPatterns.json");
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p: unknown) => typeof p === "string" && p.trim());
  } catch {
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

// ============================================================================
// PATTERNS - Add new patterns here!
// ============================================================================

const builtinPatterns: DangerPattern[] = [
  // ============================================================================
  // FILE DELETION
  // ============================================================================
  p("rm *"),
  p("del *"),

  // ============================================================================
  // GIT
  // ============================================================================
  p("git push"),
  p("git reset *"),
  p("git clean *"),
  p("git branch -D"),

  // ============================================================================
  // PERMISSIONS
  // ============================================================================
  p("chmod *"),
  p("chown *"),

  // ============================================================================
  // USER MANAGEMENT
  // ============================================================================
  p("userdel"),
  p("groupdel"),

  // ============================================================================
  // FILESYSTEM
  // ============================================================================
  p("mkfs"),
  p("dd if="),

  // ============================================================================
  // FORK BOMB
  // ============================================================================
  p(":(){ :|:& };"),

  // ============================================================================
  // DOCKER
  // ============================================================================
  p("docker rm *"),
  p("docker rmi *"),
  p("docker stop *"),
  p("docker kill *"),
  p("docker system prune"),
  p("docker-compose down"),

  // ============================================================================
  // KUBERNETES
  // ============================================================================
  p("kubectl delete *"),
  p("kubectl apply *"),

  // ============================================================================
  // PACKAGE MANAGERS
  // ============================================================================
  p("apt install *"),
  p("apt remove *"),
  p("apt-get *"),
  p("yum"),
  p("dnf"),
  p("pacman -Rscn"),
  p("npm uninstall *"),
  p("npm rm *"),
  p("npm exec *"),
  p("npm publish"),
  p("pip uninstall *"),

  // ============================================================================
  // REMOTE SCRIPT EXECUTION
  // ============================================================================
  p("curl * | sh"),
  p("wget * | sh"),

  // ============================================================================
  // NETWORK/SECURITY
  // ============================================================================
  p("iptables -F"),
  p("iptables -P INPUT ACCEPT"),
  p("ufw disable"),
  p("sshd"),
  p("crontab -r"),
  p("crontab -e"),

  // ============================================================================
  // RESOURCE EXHAUSTION
  // ============================================================================
  p("yes *"),

  // ============================================================================
  // DATABASE
  // ============================================================================
  p("DROP DATABASE"),
  p("DROP TABLE"),
  p("TRUNCATE TABLE"),
  p("redis-cli FLUSHDB"),
  p("redis-cli FLUSHALL"),
  p("mongo --eval *"),
];

// Merge custom patterns from config (deduped against builtins)
export const dangerPatterns: DangerPattern[] = [
  ...builtinPatterns,
  ...customPatterns.filter(
    (cp) => !builtinPatterns.some((bp) => bp.pattern === cp.pattern),
  ),
];

// ============================================================================
// MATCHING
// ============================================================================

/**
 * Returns true if the pattern contains glob wildcards (* or ?).
 */
function isGlobPattern(pattern: string): boolean {
  return pattern.includes("*") || pattern.includes("?");
}

/**
 * Tokenize for glob patterns, splitting | and & into separate tokens.
 * Also splits tokens containing * into prefix + wildcard markers.
 * e.g. "curl * | sh" → ["curl", "*", "|", "sh"]  (note: * split into its own token)
 *     "curl http://x | sh" → ["curl", "http://x", "|", "sh"]
 */
function tokenizeForGlob(command: string): string[] {
  const result: string[] = [];
  for (const raw of command.split(/\s+/)) {
    let current = "";
    for (const ch of raw) {
      if (ch === "|" || ch === "&") {
        if (current) result.push(current);
        result.push(ch);
        current = "";
      } else if (ch === "*") {
        if (current) result.push(current);
        result.push("*");
        current = "";
      } else {
        current += ch;
      }
    }
    if (current) result.push(current);
  }
  return result;
}

type ShellToken =
  | { kind: "word"; value: string; quoted: boolean }
  | { kind: "operator"; value: string };

const shellOperators = new Set([";", "&", "&&", "|", "||", "(", ")", "{", "}"]);

/**
 * Tokenize only the shell syntax needed to find command boundaries.
 * Quotes are removed from word values but marked so quoted command names
 * cannot be mistaken for commands. This is not a shell interpreter.
 */
function tokenizeShell(command: string): ShellToken[] {
  const tokens: ShellToken[] = [];
  let value = "";
  let quoted = false;
  let quote: "'" | '"' | null = null;

  const flushWord = () => {
    if (value) tokens.push({ kind: "word", value, quoted });
    value = "";
    quoted = false;
  };

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];

    if (quote) {
      if (ch === quote) {
        quote = null;
      } else if (ch === "\\" && quote === '"' && i + 1 < command.length) {
        value += command[++i];
      } else {
        value += ch;
      }
      quoted = true;
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      quoted = true;
      continue;
    }
    if (ch === "\\" && i + 1 < command.length) {
      value += command[++i];
      quoted = true;
      continue;
    }
    if (/\s/.test(ch)) {
      flushWord();
      continue;
    }

    const twoCharacterOperator = command.slice(i, i + 2);
    if (shellOperators.has(twoCharacterOperator)) {
      flushWord();
      tokens.push({ kind: "operator", value: twoCharacterOperator });
      i++;
      continue;
    }
    if (shellOperators.has(ch)) {
      flushWord();
      tokens.push({ kind: "operator", value: ch });
      continue;
    }

    value += ch;
  }

  flushWord();
  return tokens;
}

function commandName(token: ShellToken | undefined): string | null {
  if (!token || token.kind !== "word" || token.quoted) return null;
  return token.value.split("/").pop()?.toLowerCase() ?? null;
}

function isCommandStart(tokens: ShellToken[], index: number): boolean {
  if (index === 0) return true;
  const previous = tokens[index - 1];
  if (!previous) return false;
  if (previous.kind === "operator") {
    return true;
  }
  return ["do", "then", "else", "elif", "!"].includes(previous.value);
}

function skipSudoOptions(tokens: ShellToken[], index: number): number {
  while (index < tokens.length) {
    const token = tokens[index];
    if (!token || token.kind !== "word") return index;
    if (token.value === "--") return index + 1;
    if (!token.value.startsWith("-")) return index;
    if (token.value === "-u" || token.value === "--user") index += 2;
    else index++;
  }
  return index;
}

function gitCommandIndex(tokens: ShellToken[], start: number): number | null {
  const initialName = commandName(tokens[start]);
  if (initialName === "git") return start;
  if (initialName !== "sudo") return null;

  const sudoCommand = skipSudoOptions(tokens, start + 1);
  return commandName(tokens[sudoCommand]) === "git" ? sudoCommand : null;
}

function gitSubcommandIndex(tokens: ShellToken[], gitIndex: number): number | null {
  let index = gitIndex + 1;
  while (index < tokens.length) {
    const token = tokens[index];
    if (!token || token.kind !== "word") return null;

    if (["-C", "--git-dir", "--work-tree", "-c", "--exec-path"].includes(token.value)) {
      index += 2;
      continue;
    }
    if (
      token.value.startsWith("--git-dir=") ||
      token.value.startsWith("--work-tree=") ||
      token.value.startsWith("--exec-path=") ||
      (token.value.startsWith("-c") && token.value.length > 2)
    ) {
      index++;
      continue;
    }
    return index;
  }
  return null;
}

function containsGitPush(command: string): boolean {
  return containsGitOperation(command, "push");
}

function containsGitBranchDelete(command: string): boolean {
  const tokens = tokenizeShell(command);
  for (let index = 0; index < tokens.length; index++) {
    if (!isCommandStart(tokens, index)) continue;
    const gitIndex = gitCommandIndex(tokens, index);
    if (gitIndex === null) continue;
    const subcommandIndex = gitSubcommandIndex(tokens, gitIndex);
    if (subcommandIndex === null) continue;

    const subcommand = tokens[subcommandIndex];
    const option = tokens[subcommandIndex + 1];
    if (
      subcommand?.kind === "word" &&
      subcommand.value === "branch" &&
      option?.kind === "word" &&
      option.value.startsWith("-D")
    ) {
      return true;
    }
  }
  return false;
}

function containsGitOperation(command: string, operation: string): boolean {
  const tokens = tokenizeShell(command);
  for (let index = 0; index < tokens.length; index++) {
    if (!isCommandStart(tokens, index)) continue;

    const gitIndex = gitCommandIndex(tokens, index);
    if (gitIndex !== null) {
      const subcommandIndex = gitSubcommandIndex(tokens, gitIndex);
      const subcommand = subcommandIndex === null ? null : tokens[subcommandIndex];
      if (subcommand?.kind === "word" && subcommand.value === operation) {
        return true;
      }
      continue;
    }

    const shellName = commandName(tokens[index]);
    if (shellName !== "bash" && shellName !== "sh") continue;
    for (let nestedIndex = index + 1; nestedIndex < tokens.length; nestedIndex++) {
      const nestedToken = tokens[nestedIndex];
      if (nestedToken?.kind === "operator") break;
      if (
        nestedToken?.kind === "word" &&
        nestedToken.value === "-c" &&
        tokens[nestedIndex + 1]?.kind === "word"
      ) {
        if (containsGitOperation(tokens[nestedIndex + 1].value, operation)) return true;
        break;
      }
    }
  }
  return false;
}

/**
 * Position-flexible glob match.
 * - Pattern's first non-wildcard token must be a prefix of some command token.
 * - Remaining pattern tokens match the corresponding subsequent command tokens.
 * - Wildcards (*, ?) each match exactly one command token.
 * - | and & are treated as their own tokens (split from adjacent content).
 *
 * This allows `sudo rm -rf /` to match `rm *` (rm is at position 1, not 0).
 *
 * Examples:
 *   matchGlob("rm *", "rm -rf /")              → true  (rm matches rm at pos 0, * matches -rf)
 *   matchGlob("rm *", "sudo rm -rf /")         → true  (rm matches rm at pos 1, * matches -rf)
 *   matchGlob("rm *", "rmfile")                → false (no token has rm as prefix)
 *   matchGlob("curl * | sh", "curl http://x | sh")      → true
 *   matchGlob("curl * | sh", "curl http://x")            → false (no trailing sh token)
 */
function matchGlob(pattern: string, command: string): boolean {
  const patternTokens = tokenizeForGlob(pattern);
  const commandTokens = tokenizeForGlob(command);

  // Find the first non-wildcard pattern token (the anchor)
  let firstTokenIdx = -1;
  for (let i = 0; i < patternTokens.length; i++) {
    if (patternTokens[i] !== "*" && patternTokens[i] !== "?") {
      firstTokenIdx = i;
      break;
    }
  }
  if (firstTokenIdx === -1) return false;

  const anchor = patternTokens[firstTokenIdx].toLowerCase();

  // Find a command token that starts with the anchor
  let cmdStart = -1;
  for (let i = 0; i < commandTokens.length; i++) {
    if (commandTokens[i].toLowerCase().startsWith(anchor)) {
      cmdStart = i;
      break;
    }
  }
  if (cmdStart === -1) return false;

  // Check remaining pattern tokens against remaining command tokens from cmdStart
  const remainingPattern = patternTokens.slice(firstTokenIdx);
  const remainingCommand = commandTokens.slice(cmdStart);

  if (remainingPattern.length > remainingCommand.length) return false;

  for (let i = 0; i < remainingPattern.length; i++) {
    const pt = remainingPattern[i];
    const ct = remainingCommand[i];

    if (pt === "*") continue;
    if (pt === "?") {
      if (ct.length === 0) return false;
      continue;
    }
    if (!ct.toLowerCase().startsWith(pt.toLowerCase())) return false;
  }

  return true;
}

/**
 * Token-level match for literal patterns.
 * The first (anchor) token must match exactly. Subsequent tokens
 * use prefix matching. The pattern must appear as a contiguous
 * sequence starting at the anchor position in the command.
 *
 * Examples:
 *   matchTokens("userdel", "userdel foo")        → true
 *   matchTokens("userdel", "sudo userdel foo")    → true (anchor scans)
 *   matchTokens("dnf", "dnfoo --help")            → false (anchor must be exact)
 *   matchTokens("chmod", "chmod 777 file")        → true
 */
function matchTokens(pattern: string, command: string): boolean {
  const patternTokens = pattern.split(/\s+/);
  const commandTokens = command.trim().split(/\s+/);

  // Find the first non-empty pattern token (the anchor)
  let firstTokenIdx = -1;
  for (let i = 0; i < patternTokens.length; i++) {
    if (patternTokens[i]) {
      firstTokenIdx = i;
      break;
    }
  }
  if (firstTokenIdx === -1) return false;

  const anchor = patternTokens[firstTokenIdx].toLowerCase();

  // Scan command tokens for the anchor (exact or non-word-separator suffix).
  // Allows mkfs.ext4 to match pattern "mkfs" but blocks dnfoo from matching "dnf".
  let cmdStart = -1;
  for (let i = 0; i < commandTokens.length; i++) {
    const ct = commandTokens[i]?.toLowerCase() ?? "";
    if (ct === anchor || (ct.startsWith(anchor) && /[^a-z0-9]/.test(ct[anchor.length]!))) {
      cmdStart = i;
      break;
    }
  }
  if (cmdStart === -1) return false;

  // Check remaining pattern tokens against remaining command tokens
  const remainingPattern = patternTokens.slice(firstTokenIdx);
  const remainingCommand = commandTokens.slice(cmdStart);

  if (remainingPattern.length > remainingCommand.length) return false;

  for (let i = 0; i < remainingPattern.length; i++) {
    const pt = remainingPattern[i];
    const ct = remainingCommand[i];
    if (!ct?.toLowerCase().startsWith(pt.toLowerCase())) return false;
  }

  return true;
}

/**
 * Substring match for literal patterns with special chars (=, --, ;).
 * The special char ensures no partial-word matches:
 *   "dd if="  matches "dd if=/dev/zero"  but not "dd if you want"
 *   "git branch -D"  matches "git branch -D main"  and "git branch -Dd"
 *     (case-insensitive substring — use glob patterns for stricter matching)
 */
function matchesSubstring(pattern: string, command: string): boolean {
  return command.toLowerCase().includes(pattern.toLowerCase());
}

/**
 * Returns true if a pattern uses special chars (=, --, ;) that ensure
 * substring matching is precise enough (no partial-word false positives).
 */
function isSubstringSafe(pattern: string): boolean {
  return /[=;]| -{1,2}/.test(pattern);
}

/**
 * Match command against a pattern.
 * Glob patterns (containing * or ?) use position-flexible prefix matching.
 * Literal patterns with special chars (=, --, ;) use substring matching.
 * Other literals use token-level prefix matching.
 */
function matches(command: string, pattern: string): boolean {
  if (pattern === "git push") return containsGitPush(command);
  if (pattern === "git branch -D") return containsGitBranchDelete(command);
  if (isGlobPattern(pattern)) {
    return matchGlob(pattern, command);
  }
  if (isSubstringSafe(pattern)) {
    return matchesSubstring(pattern, command);
  }
  return matchTokens(pattern, command);
}

/**
 * Check if a command matches any danger pattern.
 */
export function isDangerous(command: string): DangerPattern | null {
  for (const danger of dangerPatterns) {
    if (matches(command, danger.pattern)) {
      return danger;
    }
  }
  return null;
}

/**
 * Get all matching patterns.
 */
export function getAllMatches(command: string): DangerPattern[] {
  return dangerPatterns.filter(d => matches(command, d.pattern));
}