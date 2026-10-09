# 00 — Product purpose and vision

**Status:** Proposal · **Audience:** Product owner, QA lead, developers and AI coding agents

## Problem statement

Manual QA spends meaningful time translating acceptance criteria into test ideas, looking up existing rules, repeating common workflows, collecting evidence, comparing results and writing summaries. Generic agents can accelerate this work, but they may hallucinate expected behavior, consume unnecessary tokens, or act without clear authority.

## Product vision

Enhance the **existing** Manual QA AI Agent into a context-aware QA assistant that combines:

- **Agent orchestration** for planning and tool use.
- **RAG** for versioned, relevant project knowledge.
- **Decisions API** for structured classification, readiness routing and rubric scoring.
- **Deterministic verification** for objectively testable assertions.
- **Human-in-the-loop** review for ambiguity, uncertainty and risky actions.
- **Controlled knowledge feedback** so only approved findings update the trusted knowledge base.

## Intended users

| Role | Primary need |
| --- | --- |
| Manual QA | Reduce repetitive design, exploration and reporting effort; inspect evidence |
| QA lead | Set policies, approve risky runs, monitor reliability and coverage |
| Product owner / BA | Clarify unknown or conflicting business rules |
| Developer | Reproduce supported issues with reliable logs and steps |
| Platform administrator | Control connectors, environments, budgets and data access |

## Example value proposition

A QA engineer submits a story and acceptance criteria. The platform retrieves **only** applicable versions of prior requirements and tests, suggests scenarios, flags gaps, requests clarification when needed, executes permitted checks (if enabled), and produces an evidence-linked review record. Neither confidence nor retrieved documents can override verified application behavior.

## Success outcomes (hypotheses, not promises)

- Shorter time to draft and review scenarios than a manually measured baseline.
- Higher traceability of tests to approved acceptance criteria.
- Lower median input tokens per comparable task than a no-retrieval baseline.
- Fewer false bug reports and more reproducible failures.
- Humans review fewer routine issues while retaining control over sensitive decisions.

Targets are **not assigned** until the evaluation dataset and initial baseline are collected; see [evaluation](10-evaluation.md).

## In scope for MVP

1. Import/select a user story and acceptance criteria.
2. Ingest reviewed requirements and tests; version, filter and retrieve them.
3. Detect missing or ambiguous expected behavior, with evidence references.
4. Draft traceable manual test cases with manual QA approval.
5. Create a review task if knowledge is missing/conflicting or risk is high.
6. Audit decisions and track usage per workflow.

## Outside MVP / later stages

- Fully autonomous production testing or self-approved destructive operations.
- Automatic acceptance of all AI-generated test cases.
- Bulk auto-filing of bugs without confirmed reproducibility.
- Self-training on unreviewed AI-generated output.
- Unlimited document ingestion, multi-tenant SaaS commercialization, native mobile and desktop coverage.
- Broad browser exploration/auto-fix of application code without explicit authorization.

## Critical principle

**A good agent knows when it lacks authority or evidence.** The platform should make that behavior measurable, auditable and easy for QA to resolve.
