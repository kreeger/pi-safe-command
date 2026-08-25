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
  p("git add *"),
  p("git commit *"),
  p("git push *"),
  p("git reset *"),
  p("git checkout *"),
  p("git rebase *"),
  p("git stash *"),
  p("git clean *"),
  p("git branch -D"),
  p("git cherry-pick --abort"),
  p("git merge --abort"),

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
 *   "git branch -D"  matches "git branch -D main"  but not "git branch -Dd"
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