---
name: kimi-dispatch
description: Intelligently route a task to a Kimi sub-agent. Use when the user wants to delegate work to Kimi, or when a task benefits from parallel AI execution, Kimi's long context, or Chinese-language capabilities.
---

The user wants to run a task via Kimi. Use the `kimi` agent to dispatch it.

Determine the appropriate invocation based on the task:

1. **Read the task** — Understand what's being asked.
2. **Gather context if needed** — If the task references specific files or code, read them first so you can include relevant context in the prompt.
3. **Spawn the kimi agent** — Use the Agent tool with `subagent_type: "kimi"` and a clear, self-contained prompt describing the task. Include any file contents or context Kimi will need.
4. **Return the result** — Present Kimi's output to the user.
