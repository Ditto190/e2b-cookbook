---
title: "Skills"
slug: skills
order: 13
source: https://preview-docs-git-agents-alpha-openai.vercel.app/alphas/agents-api/skills
---

# Skills

Skills are composable, human-readable instructions that give an agent domain-specific context and workflows.

For example, a legal agent can load a redlining skill for contract review or an email-drafting skill for client communication.

To use skills:

1.  **Write skills.** Create Markdown instructions and supporting files.
2.  **Register them.** Expose the skill directory to your agent.
3.  **Use them.** The model loads relevant skills automatically.

## 1\. Write the skills

A skill is a directory containing a `SKILL.md` file and any supporting files the agent might need.

For example, a PR-review skill could look like:

```text
review-pr/
├── SKILL.md
├── references/
│   └── review-guidelines.md
├── scripts/
│   └── check-changes.sh
└── assets/
    └── review-template.md
```

`SKILL.md` contains two parts:

1.  **Front matter** tells the model what the skill does and when it is relevant.
2.  **Instructions** describe how the agent should think about and work through the task.

```markdown
---
name: review-pr
description: Review a pull request using linked task context and repository guidelines.
---

# Review a pull request

1. Search over the relevant Notion and Linear tasks to understand the change.
2. Use GitHub to inspect the pull request and its checks.
3. Apply the criteria in `references/review-guidelines.md`.
4. Run `scripts/check-changes.sh` if additional validation is needed.
5. Call out important issues or make the requested changes.
```

During skill discovery, the model sees the skill’s name and description. It uses that short description to decide whether the skill is relevant, so the description should clearly explain what the skill does and when to use it.

For example, for a legal skill:

```yaml
description: Review and redline vendor agreements using the fallback clauses.
```

is more useful than:

```yaml
description: Helps with legal work.
```

Once the model selects a skill, its instructions can direct the agent to supporting files. Use `references/` for background material, `scripts/` for repeatable actions, and `assets/` for reusable templates.

## 2\. Register the capability directory

Make your skills available inside the sandbox and register the directories that contain them.

These are called **capability directories**.

For example, a sandbox could contain a legal skill and two engineering skills:

```text
/workspace/capabilities/
├── legal/
│   └── contract-redline/
│       ├── SKILL.md
│       └── references/
│           └── fallback-clauses.md
└── engineering/
    ├── review-pr/
    │   ├── SKILL.md
    │   └── references/
    │       └── review-guidelines.md
    └── prepare-release/
        ├── SKILL.md
        └── scripts/
            └── validate-release.sh
```

In the Agents API, register the directories when creating the session:

```json
{
  "agent": {
    "model": "your-model",
    "instructions": "Use the relevant skills to complete the user's task."
  },
  "environment": {
    "type": "self_hosted",
    "workspace_directory": "/workspace",
    "capability_directories": [
      "/workspace/capabilities/legal",
      "/workspace/capabilities/engineering"
    ]
  }
}
```

**SDK**



**Python**

```python
session = await client.sessions.create(
    agent={"model": "gpt-5.6"},
    environment={
        "type": "self_hosted",
        "workspace_directory": "/workspace",
        "capability_directories": [
            "/workspace/capabilities/legal",
            "/workspace/plugins/engineering",
        ],
    },
)
```

**TypeScript**

```typescript
const session = await client.beta.agents.sessions.create({
  agent: { model: "gpt-5.6" },
  environment: {
    type: "self_hosted",
    workspace_directory: "/workspace",
    capability_directories: [
      "/workspace/capabilities/legal",
      "/workspace/plugins/engineering",
    ],
  },
});
```

The paths tell the harness where to look for skills in the sandbox.

### Capability-directory requirements

- Paths must point to directories **inside the sandbox**.
- Paths must be absolute and unique, and cannot contain `.` or `..`.
- A session can register up to 32 capability directories.
- Directories must already exist in the environment.

## 3\. Use the skills

Once the sandbox becomes available, the harness searches the registered directories for `SKILL.md` files. It puts each discovered skill’s name and description into context, roughly as:

```text
Available skills:

- contract-redline: Review and redline vendor agreements using company fallback clauses.
- review-pr: Review a pull request using linked task context and repository guidelines.
- prepare-release: Prepare and validate an engineering release.
```
