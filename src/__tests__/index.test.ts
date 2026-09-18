import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import initExtension from "../index.js";

// The extension resolves the user settings path from `homedir()`. Redirect it
// to a per-test temp directory so each case can control the effective policy.
const osState = vi.hoisted(() => ({ home: "" }));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => osState.home };
});

type NotifyType = "info" | "warning" | "error";

type Notification = { message: string; type: NotifyType | undefined };

type FakeCtx = {
  hasUI: boolean;
  notifications: Notification[];
  selects: string[];
  ui: {
    notify: (message: string, type?: NotifyType) => void;
    select: (message: string, options: string[]) => Promise<string | undefined>;
  };
};

function createCtx(
  options: { hasUI?: boolean; choice?: string } = {},
): FakeCtx {
  const notifications: Notification[] = [];
  const selects: string[] = [];
  return {
    hasUI: options.hasUI ?? true,
    notifications,
    selects,
    ui: {
      notify: (message, type) => {
        notifications.push({ message, type });
      },
      select: async (message) => {
        selects.push(message);
        return options.choice;
      },
    },
  };
}

type ToolCallHandler = (event: unknown, ctx: ExtensionContext) => unknown;

type FakeApi = {
  invokeToolCall: (event: unknown, ctx: FakeCtx) => Promise<unknown>;
  runCommand: (name: string, args: string, ctx: FakeCtx) => Promise<void>;
};

function bashEvent(command: unknown): unknown {
  return { type: "tool_call", toolCallId: "call-1", toolName: "bash", input: { command } };
}

let home: string;

function settingsPath(): string {
  return join(
    home,
    ".pi",
    "agent",
    "extensions",
    "pi-safe-command",
    "settings.json",
  );
}

function writeUserSettings(doc: unknown): void {
  mkdirSync(join(home, ".pi", "agent", "extensions", "pi-safe-command"), {
    recursive: true,
  });
  writeFileSync(
    settingsPath(),
    typeof doc === "string" ? doc : JSON.stringify(doc),
  );
}

async function createExtension(): Promise<FakeApi> {
  const handlers = new Map<string, ToolCallHandler>();
  const commands = new Map<
    string,
    { handler: (args: string, ctx: ExtensionContext) => Promise<void> }
  >();
  const api = {
    on: (event: string, handler: ToolCallHandler) => {
      handlers.set(event, handler);
    },
    registerCommand: (
      name: string,
      definition: {
        handler: (args: string, ctx: ExtensionContext) => Promise<void>;
      },
    ) => {
      commands.set(name, definition);
    },
  } as unknown as ExtensionAPI;

  initExtension(api);

  const fake: FakeApi = {
    invokeToolCall: async (event, ctx) =>
      handlers.get("tool_call")?.(event, ctx as unknown as ExtensionContext),
    runCommand: async (name, args, ctx) => {
      await commands
        .get(name)
        ?.handler(args, ctx as unknown as ExtensionContext);
    },
  };

  // `allowedCommands` is module-level state shared across invocations; start
  // every case from an empty session allow-list.
  await fake.runCommand("clear-allowed", "", createCtx());
  return fake;
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "pi-safe-command-index-"));
  osState.home = home;
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("startup policy integration", () => {
  it("uses user allows before prompting for a matching default block", async () => {
    writeUserSettings({ version: 1, allow: ["git push"], block: [] });
    const fake = await createExtension();
    const ctx = createCtx();

    const result = await fake.invokeToolCall(bashEvent("git push"), ctx);

    expect(result).toEqual({ block: false });
    expect(ctx.selects).toHaveLength(0);
    expect(
      ctx.notifications.some((n) => /user preference/i.test(n.message)),
    ).toBe(true);
  });

  it("blocks every bash call and logs one error when startup policy is invalid", async () => {
    writeUserSettings("{ not json");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fake = await createExtension();
    const ctx = createCtx();

    const result = (await fake.invokeToolCall(
      bashEvent("echo hi"),
      ctx,
    )) as { block?: boolean; reason?: string };

    expect(result.block).toBe(true);
    expect(result.reason).toContain("policy configuration is invalid");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]?.[0]).toContain("settings.json");
    errorSpy.mockRestore();
  });

  it("reports the stored policy error from /test-pattern when invalid", async () => {
    writeUserSettings("{ not json");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fake = await createExtension();
    const ctx = createCtx();

    await fake.runCommand("test-pattern", "echo hi", ctx);

    expect(ctx.notifications).toHaveLength(1);
    expect(ctx.notifications[0]?.type).toBe("error");
    expect(ctx.notifications[0]?.message).toContain("settings.json");
    errorSpy.mockRestore();
  });

  it("blocks empty, whitespace, and malformed bash input when startup policy is invalid", async () => {
    writeUserSettings("{ not json");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fake = await createExtension();
    const ctx = createCtx();

    // A bash event whose `input` carries no `command` key is handled without
    // throwing (the non-string guard covers it) but must still fail closed.
    const malformed = {
      type: "tool_call",
      toolCallId: "call-3",
      toolName: "bash",
      input: {},
    };

    for (const event of [bashEvent(""), bashEvent("   "), malformed]) {
      const result = (await fake.invokeToolCall(event, ctx)) as {
        block?: boolean;
        reason?: string;
      };
      expect(result).toEqual({
        block: true,
        reason: "[SafeCommand] Blocked: policy configuration is invalid",
      });
    }
    expect(ctx.selects).toHaveLength(0);
    errorSpy.mockRestore();
  });

  it("still prompts for a dangerous command and honors Allow (once)", async () => {
    const fake = await createExtension();
    const ctx = createCtx({ choice: "Allow (once)" });

    const result = await fake.invokeToolCall(bashEvent("rm -rf /"), ctx);

    expect(result).toEqual({ block: false });
    expect(ctx.selects).toHaveLength(1);
    expect(ctx.selects[0]).toContain("Dangerous Command");
  });

  it("blocks a dangerous command when the user chooses Block", async () => {
    const fake = await createExtension();
    const ctx = createCtx({ choice: "Block" });

    const result = await fake.invokeToolCall(bashEvent("rm -rf /"), ctx);

    expect(result).toEqual({
      block: true,
      reason: "[SafeCommand] Blocked by user",
    });
  });

  it("remembers session-allowed commands without prompting again", async () => {
    const fake = await createExtension();

    const first = createCtx({ choice: "Allow (session)" });
    await fake.invokeToolCall(bashEvent("rm -rf /"), first);
    expect(first.selects).toHaveLength(1);

    const second = createCtx();
    const result = await fake.invokeToolCall(bashEvent("rm -rf /"), second);

    expect(result).toEqual({ block: false });
    expect(second.selects).toHaveLength(0);
    expect(
      second.notifications.some((n) => n.message.includes("allowed command")),
    ).toBe(true);
  });

  it("allows with a console warning when no UI is available", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fake = await createExtension();
    const ctx = createCtx({ hasUI: false });

    const result = await fake.invokeToolCall(bashEvent("rm -rf /"), ctx);

    expect(result).toEqual({ block: false });
    expect(ctx.selects).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it("returns undefined for commands that match no block pattern", async () => {
    const fake = await createExtension();
    const ctx = createCtx();

    const result = await fake.invokeToolCall(bashEvent("echo hello"), ctx);

    expect(result).toBeUndefined();
    expect(ctx.selects).toHaveLength(0);
  });

  it("ignores non-bash tools and non-string commands", async () => {
    const fake = await createExtension();
    const ctx = createCtx();

    expect(
      await fake.invokeToolCall(
        { type: "tool_call", toolCallId: "call-2", toolName: "read", input: {} },
        ctx,
      ),
    ).toBeUndefined();
    expect(await fake.invokeToolCall(bashEvent(undefined), ctx)).toBeUndefined();
    expect(await fake.invokeToolCall(bashEvent(""), ctx)).toBeUndefined();
  });
});

describe("/test-pattern policy reporting", () => {
  it("reports user-preference allow and suppressed blocks", async () => {
    writeUserSettings({ version: 1, allow: ["git push"], block: [] });
    const fake = await createExtension();
    const ctx = createCtx();

    await fake.runCommand("test-pattern", "git push", ctx);

    expect(ctx.notifications).toHaveLength(1);
    expect(ctx.notifications[0]?.message).toMatch(/user preference/i);
    expect(ctx.notifications[0]?.message).toContain("git push");
    expect(ctx.notifications[0]?.message).toContain(
      "suppressed block patterns: git push",
    );
  });

  it("preserves the MATCH output for blocked commands", async () => {
    const fake = await createExtension();
    const ctx = createCtx();

    await fake.runCommand("test-pattern", "rm -rf /", ctx);

    expect(ctx.notifications).toHaveLength(1);
    expect(ctx.notifications[0]?.message).toContain('MATCH: "rm *"');
    expect(ctx.notifications[0]?.type).toBe("warning");
  });

  it("reports the first block match and every additional matching pattern", async () => {
    writeUserSettings({ version: 1, allow: [], block: ["rm -rf /"] });
    const fake = await createExtension();
    const ctx = createCtx();

    await fake.runCommand("test-pattern", "rm -rf /", ctx);

    expect(ctx.notifications).toHaveLength(1);
    const notification = ctx.notifications[0];
    expect(notification?.type).toBe("warning");
    expect(notification?.message).toContain('[SafeCommand] MATCH: "rm *"');
    expect(notification?.message).toContain("Also matches 1 other pattern(s):");
    expect(notification?.message).toContain("• rm -rf /");
  });

  it("reports no match for safe commands", async () => {
    const fake = await createExtension();
    const ctx = createCtx();

    await fake.runCommand("test-pattern", "echo hello", ctx);

    expect(ctx.notifications).toHaveLength(1);
    expect(ctx.notifications[0]?.message).toContain("No match for: echo hello");
  });
});
