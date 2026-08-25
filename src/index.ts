/**
 * Safe Command Extension
 *
 * Prompts for confirmation before running dangerous commands.
 * Patterns defined in patterns.ts - easy to extend!
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isDangerous, getAllMatches } from "./patterns.js";

const allowedCommands = new Set<string>();

const notify = (
  ctx: {
    ui: { notify: (msg: string, type?: "info" | "warning" | "error") => void };
  },
  msg: string,
  type: "info" | "warning" | "error" = "info",
) => ctx.ui.notify(`[SafeCommand] ${msg}`, type);

// --- Matching ---

async function handleDangerousCommand(
  command: string,
  ctx: Parameters<Parameters<ExtensionAPI["on"]>[1]>[1],
): Promise<{ block: boolean; reason?: string }> {
  if (allowedCommands.has(command)) {
    notify(ctx, "Running allowed command");
    return { block: false };
  }

  if (!ctx.hasUI) {
    console.warn(
      `[SafeCommand] Warning: running dangerous command without confirmation: ${command}`,
    );
    return { block: false };
  }

  const allMatches = getAllMatches(command);
  const display = command.trim().replace(/\s+/g, " ");
  const lines = [
    "⚠️ Dangerous Command",
    "",
    `${display.slice(0, 80)}${display.length > 80 ? "..." : ""}`,
    ...(allMatches.length > 1
      ? [
          "",
          `Also matches ${allMatches.length - 1} other pattern(s):`,
          ...allMatches
            .slice(1)
            .map((m: { pattern: string }) => `  • ${m.pattern}`),
        ]
      : []),
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
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash") return undefined;
    const raw = event.input.command;
    if (typeof raw !== "string") return undefined;
    const command = raw.trim();
    if (!command) return undefined;

    const matched = isDangerous(command);
    if (!matched) return undefined;

    return handleDangerousCommand(command, ctx);
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
      const matched = isDangerous(args);
      if (matched) {
        ctx.ui.notify(`[SafeCommand] MATCH: "${matched.pattern}"`, "warning");
      } else {
        ctx.ui.notify(`[SafeCommand] No match for: ${args}`, "info");
      }
    },
  });
}

export { isDangerous };