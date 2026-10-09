# 10 — Evaluation, quality, cost and observability

**Status:** Proposed measurement plan. No performance claims have been verified yet.

## Evaluation goal

Prove that RAG + Decisions + human review improves QA usefulness **without** making pass/fail less reliable or increasing security risk. Compare against the **existing agent baseline**, not against an imaginary manual process.

## Golden dataset

Start with a human-labeled set of representative user stories, approved rules, expected draft scenarios and ambiguous/contradictory cases from one product feature. Include positive examples, missing AC, outdated spec, source conflicts, misleading defect history, auth/role edge cases, unsafe operations and API/model failures. Keep training/tuning examples separate from holdout evaluation.

## Metrics and how to interpret them

| Metric | Measurement | Caveat |
| --- | --- | --- |
| Readiness classification accuracy | (correct labels / labeled stories) with per-class precision/recall | Accuracy alone hides risky false-ready cases |
| False-ready rate | Ambiguous/unready stories incorrectly classified ready / all ambiguous/unready stories | Key safety metric; review failures manually |
| Retrieval recall@k | Relevant approved source retrieved in top-k / labeled queries | Does not prove grounded use |
| Source attribution accuracy | Generated expected outcomes traceable to correct source/version / sampled outcomes | Version and authorization matter |
| Human review rate | Review-routed workflows / all workflows | Lower is not always better; track missed escalations |
| Verified defect triage precision | Correct candidate defect labels / labels predicted as defect | Use reviewed ground truth |
| Execution stability (P1) | Deterministic test runs with reliable non-flaky result / repeated valid runs | Separate system defects vs test instability |
| Cost per completed case | All provider + infrastructure costs / successfully completed case | Include retrieval, embeddings, Decisions and retries |
| Token usage | Input/output/cached tokens per step and workflow | Compare identical task cohorts |
| Time-to-draft | Median/p95 time from story submission to reviewable draft | Compare equivalent human/agent cases |
| Reviewer workload | Minutes spent per case, override rate, reviewer agreement | Do not force unsafe automation for lower workload |
| Incidents / denied unsafe actions | Counts and severity by policy | High denials can mean attack or misconfiguration |

## Minimum event schema

```json
{
  "traceId": "trace_123",
  "workflowId": "work_123",
  "step": "readiness_decision",
  "model": "claude-opus-5-5",
  "policyVersion": "policy-1",
  "knowledgeSnapshotId": "snapshot_1",
  "inputTokens": 450,
  "outputTokens": 0,
  "cachedTokens": 0,
  "embeddingCostEstimateUsd": 0.0,
  "estimatedProviderCostUsd": null,
  "latencyMs": 125,
  "route": "NEEDS_HUMAN_REVIEW",
  "sourceIds": ["AC-LOGIN-1@v2"]
}
```

Values are **illustrative**, not observed; actual pricing must be read from provider billing/price list at the time.

## Baseline experiment

1. Freeze a labeled evaluation set and test conditions.
2. Run current agent without RAG; record costs, accuracy and reviewer labor.
3. Run same stories with RAG and same model/policy where possible.
4. Run RAG + Decisions readiness routing, with controlled human-review policy.
5. Analyze task quality, safety false-ready rate, token/cost totals and time.
6. Conduct blind QA review of generated cases, then examine failure samples.
7. Report sample size and confidence intervals where meaningful; don't claim success solely from token reduction.

## Acceptance gates (to set after baseline)

- **Mandatory qualitative:** No cross-project leaks, no unapproved destructive execution, no silent hallucination when requirements missing.
- **Quantitative:** QA lead signs off thresholds for false-ready, recall@k, review rate, error recovery and per-task cost based on pilot baseline.
- Do not release an autonomous capability without a separate evaluated permission/safety test plan.

## Monitoring and alerts

Track API availability/429/errors, tool timeouts, retrieval empty rate, confidence distribution drift, source-version conflict rate, review backlog aging, budget overrun, denied actions, and repeated execution failure signatures. Alert on security violations and sudden cost spikes; routine quality issues can go to a weekly QA review.

## Evaluation set maintenance

Human-review corrections with explicit ground-truth status can be proposed for the evaluation dataset. Do not evaluate on the exact same cases used to select thresholds without a holdout set. Version dataset, source snapshot, prompt and policy together to make comparisons reproducible.
