---
name: kimi
description: Dispatch a task to a Kimi sub-agent
arguments:
  - name: task
    description: The task for Kimi to perform
    required: true
---

Use the `kimi` agent to handle the following task. Spawn it with the task description provided as the prompt. Choose flags appropriate to the task complexity:

- Simple question/lookup: use `--quiet`
- Standard task: use `--print --output-format stream-json`
- Complex reasoning/analysis: add `--thinking`
- Open-ended exploration: add `--max-steps-per-turn 15`

Task: $ARGUMENTS
