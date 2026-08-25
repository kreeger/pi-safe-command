import { describe, it, expect } from "vitest";
import { isDangerous, getAllMatches } from "../patterns.js";

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