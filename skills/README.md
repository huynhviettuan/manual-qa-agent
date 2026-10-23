# QA skills for Claude Code

Three skills the team uses alongside this agent. They are plain folders of Markdown; Claude Code loads a skill when
a request matches its description.

| Skill | Use it for |
| --- | --- |
| [manual-test-design](manual-test-design/SKILL.md) | Which cases to write: techniques, a requirement catalogue, open questions, traceability, regression scope |
| [sdet-framework-architect](sdet-framework-architect/SKILL.md) | How to build the automation: layers, fixtures, teardown, execution reliability, case-driven black-box suites |
| [qa-reporting](qa-reporting/SKILL.md) | Bug reports and test reports: findings, rounds, retests, status at the latest run |

The agent's own draft vocabulary (`TestTechnique`, `TestType` in `packages/domain`) follows `manual-test-design`, so a
case drafted by the agent and a case designed by hand name the same techniques.

## Install

Claude Code reads skills from `~/.claude/skills/<name>`. Point each one at this folder so there is one source:

```powershell
# Windows, from the repository root (a directory junction needs no administrator rights;
# use PowerShell, since Git Bash rewrites mklink's /J switch as a path)
foreach ($s in 'manual-test-design','sdet-framework-architect','qa-reporting') {
  New-Item -ItemType Junction -Path "$env:USERPROFILE\.claude\skills\$s" -Target "$PWD\skills\$s"
}
```

```bash
# macOS or Linux
for s in manual-test-design sdet-framework-architect qa-reporting; do ln -s "$PWD/skills/$s" ~/.claude/skills/$s; done
```

Remove any existing copy of a skill folder first, or the link fails. Edit the skills here and commit; the links pick
the change up at once.

## Trigger evals

Each skill has `evals/trigger-eval.json`: 20 realistic requests, half of which should load the skill and half of
which are near misses that should not. They measure the description, not the body. Run them with the
`skill-creator` plugin's script, which needs the `claude` CLI on the PATH:

```bash
python -m scripts.run_eval --eval-set skills/qa-reporting/evals/trigger-eval.json --skill-path skills/qa-reporting
```

A query that fails in the wrong direction is a reason to change the description, not the query, unless the query
itself was ambiguous.
