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

## Security Note

This extension provides **heuristic prompt-assist, not a security boundary**. It:

- **Can be evaded** — `/bin/rm -rf /`, `bash -c "rm -rf /"`, and other path/invocation tricks bypass pattern matching
- **Has false negatives** — not every destructive command is covered (`find . -delete`, `shred -u f`, `truncate -s 0 f`, `cat f > /dev/sda`, etc.)
- **Has false positives** — routine commands like `git add *`, `chmod *`, `apt-get *` will trigger prompts
- **Bypasses in headless mode** — when no UI is available (`!ctx.hasUI`), commands run with only a `console.warn`

Treat it as a safety net for common mistakes, not a guarantee.

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