---
name: kimi-bash-guard
description: Validate Bash commands executed during Kimi agent sessions
---

When a Bash tool call is made within a Kimi agent context, check the command for safety:

**ALLOW** without comment:
- `kimi --print ...`, `kimi --quiet ...`, `kimi --wire ...` (Kimi CLI invocations)
- `git diff`, `git log`, `git status`, `gh pr diff` (read-only git/gh commands)
- `node --test ...`, `npm test`, `npx ...` (test runners)
- Read-only commands (`ls`, `cat`, `head`, `tail`, `wc`, `file`)

**FLAG for review** (output a warning but don't block):
- `git push`, `git commit`, `gh pr create` (actions visible to others)
- `rm`, `rmdir`, commands with `--force` or `-f` flags
- `curl`, `wget` (network requests)
- Any command writing to paths outside the working directory

Respond with a JSON object:
```json
{"decision": "allow"}
```
or
```json
{"decision": "allow", "warning": "This command will push to remote"}
```
