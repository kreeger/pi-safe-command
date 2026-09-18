/**
 * Safe Command Extension
 *
 * Prompts for confirmation before running dangerous commands.
 * The effective allow/block policy is loaded at startup from the package
 * `settings.json` plus an optional user settings file. If the policy cannot be
 * loaded the extension fails closed and blocks every bash call.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDangerous, setDangerPatterns } from "./patterns.js";
import {
  decidePolicy,
  loadPolicyResult,
  type Pattern,
  type PolicyLoadResult,
} from "./policy.js";

const POLICY_INVALID_REASON =
  "[SafeCommand] Blocked: policy configuration is invalid";

const allowedCommands = new Set<string>();

const notify = (
  ctx: {
    ui: { notify: (msg: string, type?: "info" | "warning" | "error") => void };
  },
  msg: string,
  type: "info" | "warning" | "error" = "info",
) => ctx.ui.notify(`[SafeCommand] ${msg}`, type);

// --- Matching ---

/**
 * Lines listing the block patterns that matched after the first one, using the
 * same diagnostic style as the confirmation prompt. Empty when there is at most
 * one match, so callers can spread the result unconditionally.
 */
function additionalMatchLines(blockMatches: Pattern[]): string[] {
  if (blockMatches.length <= 1) return [];
  return [
    "",
    `Also matches ${blockMatches.length - 1} other pattern(s):`,
    ...blockMatches.slice(1).map((m) => `  • ${m.pattern}`),
  ];
}

async function handleDangerousCommand(
  command: string,
  blockMatches: Pattern[],
  ctx: Parameters<Parameters<ExtensionAPI["on"]>[1]>[1],
): Promise<{ block: boolean; reason?: string }> {
  if (!ctx.hasUI) {
    console.warn(
      `[SafeCommand] Warning: running dangerous command without confirmation: ${command}`,
    );
    return { block: false };
  }

  const display = command.trim().replace(/\s+/g, " ");
  const lines = [
    "⚠️ Dangerous Command",
    "",
    `${display.slice(0, 80)}${display.length > 80 ? "..." : ""}`,
    ...additionalMatchLines(blockMatches),
    "",
    "Allow?",
  ];

  const choice = await ctx.ui.select(lines.join("\n"), [
    "Allow (once)",
    "Allow (session)",
    "Block",
  ]);

  switch (choice) {
    case "Allow (once)":
      notify(ctx, "Allowed (once)", "info");
      return { block: false };
    case "Allow (session)":
      allowedCommands.add(command);
      notify(ctx, "Allowed for session", "info");
      return { block: false };
    default:
      notify(ctx, "Blocked", "warning");
      return { block: true, reason: "[SafeCommand] Blocked by user" };
  }
}

// --- Extension ---

export default function (pi: ExtensionAPI) {
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
  const policyResult: PolicyLoadResult = loadPolicyResult(
    packageSettingsPath,
    userSettingsPath,
  );

  if (policyResult.ok) {
    setDangerPatterns(policyResult.policy.blocks);
  } else {
    console.error(
      `[SafeCommand] Invalid policy configuration: ${policyResult.error.message}`,
    );
  }

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash") return undefined;

    // Fail closed before inspecting the command so an invalid policy blocks
    // every bash call, including empty, whitespace-only, or malformed input.
    if (!policyResult.ok) {
      return { block: true, reason: POLICY_INVALID_REASON };
    }

    const raw = event.input.command;
    if (typeof raw !== "string") return undefined;
    const command = raw.trim();
    if (!command) return undefined;

    if (allowedCommands.has(command)) {
      notify(ctx, "Running allowed command");
      return { block: false };
    }

    const decision = decidePolicy(policyResult.policy, command);
    if (decision.status === "unmatched") return undefined;
    if (decision.status === "allowed") {
      notify(ctx, "Allowed by user preference", "info");
      return { block: false };
    }

    return handleDangerousCommand(command, decision.blockMatches, ctx);
  });

  pi.registerCommand("clear-allowed", {
    description: "Clear the session's allowed commands list",
    handler: async (_args, ctx) => {
      allowedCommands.clear();
      notify(ctx, "Allowed commands cleared");
    },
  });

  pi.registerCommand("test-pattern", {
    description: "Test if a command matches dangerous patterns",
    getArgumentCompletions: () => [
      { value: "rm -rf /", label: "Test rm -rf /" },
    ],
    handler: async (args, ctx) => {
      if (!args) {
        notify(ctx, "Usage: /test-pattern <command>", "warning");
        return;
      }
      if (!policyResult.ok) {
        notify(
          ctx,
          `Policy configuration error: ${policyResult.error.message}`,
          "error",
        );
        return;
      }

      const decision = decidePolicy(policyResult.policy, args);
      if (decision.status === "allowed") {
        const suppressed = decision.blockMatches.map((m) => m.pattern);
        notify(
          ctx,
          `Allowed by user preference: ${args}${
            suppressed.length > 0
              ? ` (suppressed block patterns: ${suppressed.join(", ")})`
              : ""
          }`,
          "info",
        );
        return;
      }
      if (decision.status === "blocked") {
        ctx.ui.notify(
          [
            `[SafeCommand] MATCH: "${decision.blockMatches[0]?.pattern}"`,
            ...additionalMatchLines(decision.blockMatches),
          ].join("\n"),
          "warning",
        );
        return;
      }
      ctx.ui.notify(`[SafeCommand] No match for: ${args}`, "info");
    },
  });
}

export { isDangerous };
