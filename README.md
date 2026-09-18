# Safe Command Extension

Prompts for confirmation before running dangerous commands in the
pi-coding-agent.

## Installation

Install from npm:

```bash
pi extension install @kreeger/pi-safe-command
```

Or add to your project:

```bash
npm install @kreeger/pi-safe-command
```

## Security Note

This extension provides **heuristic prompt-assist, not a security boundary**.
It:

- **Can be evaded** — `/bin/rm -rf /`, `bash -c "rm -rf /"`, and other
  path/invocation tricks bypass pattern matching
- **Has false negatives** — not every destructive command is covered
  (`find . -delete`, `shred -u f`, `truncate -s 0 f`, `cat f > /dev/sda`, etc.)
- **Has false positives** — routine commands like `chmod *` and `apt-get *` will
  trigger prompts
- **Bypasses in headless mode** — when no UI is available (`!ctx.hasUI`),
  commands run with only a `console.warn`

Treat it as a safety net for common mistakes, not a guarantee.

## Commands

- `/clear-allowed` — Resets the allowed commands list
- `/test-pattern <command>` — Test if a command matches dangerous patterns

## Dangerous Patterns

The extension checks commands against the block patterns in its default policy
(`settings.json`) before execution. User settings can add blocks and allow
command-level exceptions; see [Configuration](#configuration). The shipped
patterns are grouped into categories:

### File Deletion

`rm *`, `del *`

### Git

The extension prompts for direct, parseable Git pushes, including common
executable paths and Git options such as `-C`, `--git-dir`, `--work-tree`, `-c`,
and `--exec-path`. It also finds pushes in focused shell syntax such as
separators, pipelines, subshells, groups, loops, and strings passed to `bash -c`
or `sh -c`.

It also prompts for `git reset`, `git clean`, and forceful branch deletion with
`git branch -D`. It does not prompt for routine Git operations such as
`git add`, `git commit`, `git checkout`, `git rebase`, `git stash`, abort
commands, or non-destructive `git branch -d`.

This matcher does not resolve Git aliases or inspect arbitrary external scripts.
It is a heuristic prompt-assist mechanism, not a security boundary.

### Permissions

`chmod *`, `chown *`

### User Management

`userdel`, `groupdel`

### Filesystem

`mkfs`, `dd if=`

### Fork Bomb

`:(){ :|:& };`

### Docker

`docker rm *`, `docker rmi *`, `docker stop *`, `docker kill *`,
`docker system prune`, `docker-compose down`

### Kubernetes

`kubectl delete *`, `kubectl apply *`

### Package Managers

`apt install *`, `apt remove *`, `apt-get *`, `yum`, `dnf`, `pacman -Rscn`,
`npm uninstall *`, `npm rm *`, `npm exec *`, `npm publish`, `pip uninstall *`

### Remote Script Execution

`curl * | sh`, `wget * | sh`

### Network/Security

`iptables -F`, `iptables -P INPUT ACCEPT`, `ufw disable`, `sshd`, `crontab -r`,
`crontab -e`

### Resource Exhaustion

`yes *`

### Database

`DROP DATABASE`, `DROP TABLE`, `TRUNCATE TABLE`, `redis-cli FLUSHDB`,
`redis-cli FLUSHALL`, `mongo --eval *`

## Configuration

The package ships its default policy in `settings.json`:

```json
{
  "version": 1,
  "allow": [],
  "block": ["rm *", "git push"]
}
```

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

### Schema

Both policy files use standard JSON — comments and trailing commas are invalid.
Each file is a version-1 object with exactly the following fields:

| Field     | Type       | Required | Meaning                                      |
| --------- | ---------- | -------- | -------------------------------------------- |
| `version` | `1`        | yes      | Schema version; must be the number `1`.      |
| `allow`   | `string[]` | yes      | Patterns that allow a matching command.      |
| `block`   | `string[]` | yes      | Patterns that prompt for a matching command. |

Unknown fields are invalid, all three fields are required, and every entry must
be a non-empty string after trimming. The old bare JSON array used by
`dangerPatterns.json` is not accepted.

### Precedence

1. Commands allowed for the session (`Allow (session)`) run without a prompt.
2. A matching user `allow` pattern is a command-level exception and takes
   precedence over every matching `block` pattern for that command. It does not
   disable the block pattern globally.
3. Otherwise, a matching block pattern prompts for confirmation.

User blocks append to the package blocks; repeated block strings are
deduplicated after trimming and lowercasing. No allow entry removes a block
pattern.

### Validation and failure behavior

The policy is validated once at startup, before any bash command runs. Errors
report the offending file path and, when available, the field and array index. A
missing user settings file is silent and the package defaults apply. A malformed
or invalid package or user file fails closed: every bash command is blocked
until the file is fixed and Pi is restarted. The extension never creates the
user directory or settings file.

### Migrating from `dangerPatterns.json`

The old package-root `dangerPatterns.json` bare-array file is no longer read or
published. Move custom patterns into the user settings file as `block` entries
in the version-1 object:

```json
{
  "version": 1,
  "allow": [],
  "block": ["my-dangerous-command"]
}
```

### Pattern Syntax

**Glob patterns** (contain `*` or `?`): Position-flexible prefix matching. The
first non-wildcard token is used as an anchor, and the pattern matches if that
anchor appears anywhere in the command.

Examples:

- `rm *` matches `rm -rf /` and `sudo rm -rf /`
- `curl * | sh` matches `curl http://x | sh`

**Literal patterns** (no wildcards): Token-level prefix matching. Each pattern
token must be a prefix of the corresponding command token.

Examples:

- `chmod *` matches `chmod 777 file`
- `userdel` matches `userdel foo`

**Substring patterns** (contain `=`, `--`, or `;`): Substring matching for
precision.

Examples:

- `dd if=` matches `dd if=/dev/zero` but not `dd if you want`
- `git branch -D` matches `git branch -D main` but not `git branch -Dd`

### Diagnostics

`/test-pattern <command>` runs the same policy resolver as bash interception:

- no match reports that nothing matched;
- a blocked command reports the first matching block pattern and any additional
  matches;
- an allowed command reports that a user preference allowed it and lists the
  block patterns it suppressed;
- an invalid policy reports the startup policy error.

Confirmation prompts, `/clear-allowed`, and the session allow list are
unchanged. In headless mode (`!ctx.hasUI`) a valid policy keeps the existing
warning-and-allow behavior: the command runs with a `console.warn`.

## Session Allow List

- Commands approved via "Allow (once)" are allowed for that execution only
- Commands approved via "Allow (session)" are stored and allowed for the current
  agent session
- Clear the allow list with `/clear-allowed`
- If no UI is available, dangerous commands run without confirmation (with a
  console warning)

## Development

```bash
npm install
npm test
```

## License

MIT — see [LICENSE](LICENSE) for details.
