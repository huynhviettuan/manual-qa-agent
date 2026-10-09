import {
  completeTask,
  createOrGetWorkflow,
  createTestCase,
  finishWorkflow,
  getActor,
  getEnvironment,
  getStory,
  getWorkflow,
  getTask,
  insertAuditEvent,
  insertDecisionRecord,
  insertPolicyEvaluation,
  insertStoryVersion,
  insertUsageEvent,
  knowledgeStamp,
  startTask,
  type Db,
  type StoryRow,
} from '@qa/db';
import {
  type AcceptanceCriterion,
  type Actor,
  DomainError,
  hasRole,
  newId,
  type RetrievalResult,
  type TenantScope,
  sourceRef,
} from '@qa/domain';
import type {
  CallMeta,
  DraftGenerator,
  ProviderOutcome,
  ReadinessAssessment,
  ReadinessClassifier,
  StoryInput,
} from '@qa/llm-adapter';
import { silentLogger, type Logger } from '@qa/observability';
import { evaluate, POLICY_VERSION } from '@qa/policy-engine';
import { extractIdentifiers, retrieve } from '@qa/retrieval';
import {
  openReview,
  resolveReview,
  type ResolveInput,
  type ResolveResult,
  type ReviewKind,
} from '@qa/review';

export type OrchestratorDeps = {
  db: Db;
  classifier: ReadinessClassifier;
  generator: DraftGenerator;
  logger?: Logger;
  /** Per-workflow provider token budget (input + output). */
  workflowTokenBudget?: number;
  /** Optional readiness-confidence floor (downgrade only); see policy-engine. */
  minReadyConfidence?: number | null;
};

/** `QA_MIN_READY_CONFIDENCE` in (0, 1]; unset means no floor. */
export function minReadyConfidenceFromEnv(env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = env.QA_MIN_READY_CONFIDENCE;
  if (!raw) return null;
  const value = Number(raw);
  if (!(value > 0 && value <= 1)) {
    throw new DomainError('VALIDATION', `QA_MIN_READY_CONFIDENCE must be in (0, 1], got "${raw}"`);
  }
  return value;
}

export type WorkflowOutcome =
  | {
      route: 'DRAFT_CREATED';
      caseId: string;
      revision: number;
      sourceRefs: string[];
      missingRequirements: string[];
    }
  | {
      route: 'REVIEW_REQUESTED';
      reviewId: string;
      kind: ReviewKind;
      reason: string;
      question: string;
      sourceRefs: string[];
    }
  | { route: 'DENIED'; reasons: string[] };

export type WorkflowResult = {
  workflowId: string;
  correlationId: string;
  storyId: string;
  storyVersion: number;
  deduplicated: boolean;
  outcome: WorkflowOutcome;
};

export type SubmitStoryInput = {
  externalId: string;
  title: string;
  description: string;
  acceptanceCriteria: AcceptanceCriterion[];
  targetRelease?: string | null;
};

export type RunOptions = { environmentId?: string; idempotencyKey?: string; correlationId?: string };

const SUBMITTER_ROLES = ['QA_ENGINEER', 'QA_LEAD', 'PRODUCT_OWNER', 'ADMIN'] as const;

/** Workflow A entry point: persist an immutable story version, then run readiness -> draft or review. */
export async function submitStory(
  deps: OrchestratorDeps,
  actor: Actor,
  input: SubmitStoryInput,
  opts: RunOptions = {},
): Promise<WorkflowResult> {
  if (!hasRole(actor, ...SUBMITTER_ROLES))
    throw new DomainError('FORBIDDEN', `actor ${actor.id} cannot submit stories`);
  const story = await insertStoryVersion(deps.db, actor, {
    externalId: input.externalId,
    title: input.title,
    description: input.description,
    acceptanceCriteria: input.acceptanceCriteria,
    targetRelease: input.targetRelease ?? null,
    createdBy: actor.id,
  });
  return runStoryWorkflow(deps, actor, story.id, opts);
}

/** Runs (or resumes / deduplicates) the readiness workflow for an existing story version. */
export async function runStoryWorkflow(
  deps: OrchestratorDeps,
  actor: Actor,
  storyId: string,
  opts: RunOptions = {},
): Promise<WorkflowResult> {
  if (!hasRole(actor, ...SUBMITTER_ROLES))
    throw new DomainError('FORBIDDEN', `actor ${actor.id} cannot run workflows`);
  const { db } = deps;
  const scope: TenantScope = { tenantId: actor.tenantId, projectId: actor.projectId };
  const story = await getStory(db, scope, storyId);
  if (!story) throw new DomainError('NOT_FOUND', `story ${storyId} not found`);

  const environmentId = opts.environmentId ?? 'staging';
  const idempotencyKey =
    opts.idempotencyKey ?? `story:${story.id}:env:${environmentId}:kb:${await knowledgeStamp(db, scope)}`;
  const { workflow, created } = await createOrGetWorkflow(db, scope, {
    kind: 'STORY_READINESS',
    storyId: story.id,
    correlationId: opts.correlationId ?? newId('corr'),
    idempotencyKey,
    actorId: actor.id,
  });
  const base = {
    workflowId: workflow.id,
    correlationId: workflow.correlationId,
    storyId: story.id,
    storyVersion: story.version,
  };
  if (!created && workflow.state === 'COMPLETED') {
    return { ...base, deduplicated: true, outcome: workflow.outcome as WorkflowOutcome };
  }

  const log = (deps.logger ?? silentLogger).child({
    correlationId: workflow.correlationId,
    workflowId: workflow.id,
  });
  const ctx: Ctx = {
    deps,
    actor,
    scope,
    story,
    environmentId,
    workflowId: workflow.id,
    correlationId: workflow.correlationId,
    log,
  };
  try {
    const outcome = await execute(ctx);
    await finishWorkflow(db, scope, workflow.id, 'COMPLETED', outcome);
    await insertAuditEvent(db, scope, {
      actorId: actor.id,
      workflowId: workflow.id,
      correlationId: workflow.correlationId,
      actionKind: 'STORY_READINESS',
      actionHash: null,
      target: story.id,
      policyVersion: POLICY_VERSION,
      decisionRecordId: null,
      approvalId: null,
      outcome: outcome.route,
    });
    log.info({ route: outcome.route }, 'workflow completed');
    return { ...base, deduplicated: false, outcome };
  } catch (err) {
    await finishWorkflow(db, scope, workflow.id, 'FAILED', {
      error: err instanceof Error ? err.message : String(err),
    });
    log.error({ err }, 'workflow failed; resubmitting with the same idempotency key resumes it');
    throw err;
  }
}

type Ctx = {
  deps: OrchestratorDeps;
  actor: Actor;
  scope: TenantScope;
  story: StoryRow;
  environmentId: string;
  workflowId: string;
  correlationId: string;
  log: Logger;
};

/** Persisted, resumable step: a step that already succeeded returns its stored result. */
async function step<T>(ctx: Ctx, name: string, fn: () => Promise<T>): Promise<T> {
  const done = await getTask(ctx.deps.db, ctx.workflowId, name);
  if (done?.state === 'SUCCEEDED') return done.result as T;
  const task = await startTask(ctx.deps.db, ctx.workflowId, name);
  try {
    const result = await fn();
    await completeTask(ctx.deps.db, task.id, 'SUCCEEDED', result ?? null);
    return result;
  } catch (err) {
    await completeTask(ctx.deps.db, task.id, 'FAILED', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

function storyInput(story: StoryRow): StoryInput {
  return {
    externalId: story.externalId,
    title: story.title,
    description: story.description,
    acceptanceCriteria: story.acceptanceCriteria,
  };
}

async function requestReview(
  ctx: Ctx,
  kind: ReviewKind,
  reason: string,
  question: string,
  sourceRefs: string[],
  modelSuggestion: unknown = null,
): Promise<WorkflowOutcome> {
  return step(ctx, 'request_review', async () => {
    const review = await openReview(
      ctx.deps.db,
      ctx.scope,
      ctx.actor.id,
      {
        workflowId: ctx.workflowId,
        kind,
        subjectType: 'story',
        subjectId: ctx.story.id,
        question,
        reason,
        sourceRefs,
        recommendedAction: 'PAUSE_SCENARIO',
        modelSuggestion,
        targetEnvironment: ctx.environmentId,
        proposedActionHash: null,
        policyVersion: POLICY_VERSION,
        expiresAt: null,
      },
      ctx.correlationId,
    );
    return { route: 'REVIEW_REQUESTED' as const, reviewId: review.id, kind, reason, question, sourceRefs };
  });
}

async function recordCall(
  ctx: Ctx,
  kind: string,
  out: ProviderOutcome<unknown>,
  retrieval: RetrievalResult,
): Promise<string> {
  const meta: CallMeta = out.meta;
  const id = await insertDecisionRecord(ctx.deps.db, ctx.scope, {
    workflowId: ctx.workflowId,
    kind,
    provider: meta.provider,
    requestedModel: meta.requestedModel,
    model: meta.model,
    promptVersion: meta.promptVersion,
    inputHash: meta.inputHash,
    snapshotId: retrieval.snapshotId,
    sourceRefs: retrieval.chunks.map((c) => sourceRef(c.sourceId, c.version)),
    outcome: out.ok ? 'OK' : out.failure,
    result: out.ok ? out.value : { failure: out.failure, detail: out.detail },
    usage: meta.usage,
    latencyMs: meta.latencyMs,
  });
  await insertUsageEvent(ctx.deps.db, ctx.scope, {
    workflowId: ctx.workflowId,
    component: kind,
    model: meta.model,
    inputTokens: meta.usage?.inputTokens ?? 0,
    outputTokens: meta.usage?.outputTokens ?? 0,
    cacheReadTokens: meta.usage?.cacheReadTokens ?? 0,
    cacheWriteTokens: meta.usage?.cacheWriteTokens ?? 0,
    retrievedTokensEstimate: 0,
    latencyMs: meta.latencyMs,
  });
  ctx.log.info(
    { kind, outcome: out.ok ? 'OK' : out.failure, model: meta.model, usage: meta.usage },
    'provider call',
  );
  return id;
}

async function execute(ctx: Ctx): Promise<WorkflowOutcome> {
  const { db } = ctx.deps;
  const story = ctx.story;

  // 1. Deterministic intake checks (FR-01) before any retrieval or model call.
  const emptyAc = story.acceptanceCriteria.filter((ac) => !ac.text.trim());
  if (story.acceptanceCriteria.length === 0 || emptyAc.length > 0) {
    return requestReview(
      ctx,
      'REQUIREMENT_CLARIFICATION',
      'EMPTY_ACCEPTANCE_CRITERIA',
      story.acceptanceCriteria.length === 0
        ? 'The story has no acceptance criteria. What observable outcomes must be tested?'
        : `Acceptance criteria ${emptyAc.map((a) => a.id).join(', ')} are empty. What is the expected behaviour?`,
      [],
    );
  }

  // 2. Retrieval: full text over the story + exact identifiers; one narrower retry on no match.
  const retrieval = await step(ctx, 'retrieve', async () => {
    const acText = story.acceptanceCriteria.map((a) => `${a.id} ${a.text}`).join('\n');
    const identifiers = [
      ...new Set([...story.acceptanceCriteria.map((a) => a.id), ...extractIdentifiers(acText)]),
    ];
    const first = await retrieve(db, ctx.scope, {
      queryType: 'GENERATE_TEST',
      text: `${story.title}\n${story.description}\n${acText}`,
      focusText: acText,
      identifiers,
      workflowId: ctx.workflowId,
    });
    if (first.status === 'OK') return first;
    return retrieve(db, ctx.scope, {
      queryType: 'GENERATE_TEST',
      text: acText,
      identifiers,
      workflowId: ctx.workflowId,
    });
  });
  const retrievedRefs = retrieval.chunks.map((c) => sourceRef(c.sourceId, c.version));

  // 3. Evidence problems route to humans without spending a model call.
  if (retrieval.contradictions.length > 0) {
    const c = retrieval.contradictions[0]!;
    return requestReview(
      ctx,
      'SOURCE_CONFLICT',
      'SOURCE_CONTRADICTION',
      `Sources ${c.first} and ${c.second} disagree on "${c.ruleKey}". Which one is authoritative?`,
      retrieval.contradictions.flatMap((x) => [x.first, x.second]),
    );
  }
  if (retrieval.budgetExceeded) {
    return requestReview(
      ctx,
      'MISSING_KNOWLEDGE',
      'CONTEXT_BUDGET_EXCEEDED',
      'Relevant sources exceed the context budget; split the story or narrow its acceptance criteria.',
      retrievedRefs,
    );
  }
  if (retrieval.status === 'NO_TRUSTED_CONTEXT') {
    return requestReview(
      ctx,
      'MISSING_KNOWLEDGE',
      'NO_TRUSTED_CONTEXT',
      `No approved source covers this story (${retrieval.gaps.join('; ') || 'no matches'}). Which approved requirement applies?`,
      [],
    );
  }

  // 4. Readiness classification (advisory).
  const classified = await step(ctx, 'classify', async () => {
    const out = await ctx.deps.classifier.classify({ story: storyInput(story), sources: retrieval.chunks });
    const decisionRecordId = await recordCall(ctx, 'readiness', out, retrieval);
    return { out, decisionRecordId };
  });
  const { out } = classified;
  if (!out.ok) {
    return requestReview(
      ctx,
      'PROVIDER_FAILURE',
      `CLASSIFIER_${out.failure}`,
      `Automatic readiness assessment failed (${out.failure}: ${out.detail}). Is this story ready for test design?`,
      retrievedRefs,
    );
  }

  // 5. Deterministic policy decides; the classification is only one input.
  const assessment: ReadinessAssessment = out.value;
  const policy = await step(ctx, 'policy_draft', async () => {
    const environment = await getEnvironment(db, ctx.scope, ctx.environmentId);
    const proposal = {
      kind: 'draft' as const,
      projectId: ctx.scope.projectId,
      environmentId: ctx.environmentId,
      caseId: undefined,
      parameters: { storyId: story.id, snapshotId: retrieval.snapshotId },
    };
    const used = (out.meta.usage?.inputTokens ?? 0) + (out.meta.usage?.outputTokens ?? 0);
    const result = evaluate({
      actor: ctx.actor,
      proposal,
      environment,
      sourcesTrusted: retrieval.chunks.length > 0,
      hasContradiction: retrieval.contradictions.length > 0,
      classifiedReadiness: assessment.readiness,
      grounded: true, // ungrounded citations were already rejected by the adapter
      criteriaCovered: story.acceptanceCriteria.every((ac) => retrieval.coveredIdentifiers.includes(ac.id)),
      confidence: assessment.confidence,
      minReadyConfidence: ctx.deps.minReadyConfidence,
      budget: { usedTokens: used, limitTokens: ctx.deps.workflowTokenBudget ?? 100_000 },
    });
    await insertPolicyEvaluation(db, ctx.scope, {
      workflowId: ctx.workflowId,
      actorId: ctx.actor.id,
      actionKind: proposal.kind,
      actionHash: result.actionHash,
      environmentId: ctx.environmentId,
      policyVersion: result.policyVersion,
      gate: result.gate,
      reasons: result.reasons,
      decisionRecordId: classified.decisionRecordId,
      approvalId: result.approvalId,
    });
    return result;
  });

  if (policy.gate === 'DENY') return { route: 'DENIED', reasons: policy.reasons };
  if (policy.gate !== 'AUTO_PROCEED') {
    const clarify = assessment.readiness === 'clarification';
    return requestReview(
      ctx,
      clarify ? 'REQUIREMENT_CLARIFICATION' : 'MISSING_KNOWLEDGE',
      policy.reasons.join(','),
      assessment.clarificationQuestion ??
        `Readiness is "${assessment.readiness}": ${assessment.missingExpectations.join('; ') || 'needs human triage'}`,
      assessment.citedSourceIds.length > 0 ? assessment.citedSourceIds : retrievedRefs,
      {
        readiness: assessment.readiness,
        missingExpectations: assessment.missingExpectations,
        label: 'suggested',
      },
    );
  }

  // 6. Draft generation, persisted as revision 1 in DRAFT for human review.
  const drafted = await step(ctx, 'generate_draft', async () => {
    const d = await ctx.deps.generator.generate({ story: storyInput(story), sources: retrieval.chunks });
    await recordCall(ctx, 'draft', d, retrieval);
    return d;
  });
  if (!drafted.ok) {
    return requestReview(
      ctx,
      'PROVIDER_FAILURE',
      `GENERATOR_${drafted.failure}`,
      `Draft generation failed (${drafted.failure}: ${drafted.detail}). Please draft this test manually or retry.`,
      retrievedRefs,
    );
  }
  return step(ctx, 'persist_draft', async () => {
    const refs = [...new Set(drafted.value.steps.flatMap((s) => s.sourceRefs))];
    const created = await createTestCase(db, ctx.scope, {
      storyId: story.id,
      workflowId: ctx.workflowId,
      content: drafted.value,
      sourceRefs: refs,
      authorId: ctx.actor.id,
    });
    return {
      route: 'DRAFT_CREATED' as const,
      caseId: created.caseId,
      revision: created.revision,
      sourceRefs: refs,
      missingRequirements: drafted.value.missingRequirements,
    };
  });
}

/**
 * Resolves a review and, when it published new trusted knowledge for a story, re-runs that
 * story's workflow (Workflow C -> A) under a new knowledge stamp.
 */
export async function resolveReviewAndContinue(
  deps: OrchestratorDeps,
  actor: Actor,
  reviewId: string,
  input: ResolveInput,
): Promise<ResolveResult & { rerun: WorkflowResult | null }> {
  const res = await resolveReview(deps.db, actor, reviewId, input);
  let rerun: WorkflowResult | null = null;
  if (res.publishedSource?.trusted && res.review.subjectType === 'story') {
    // Re-run on behalf of whoever submitted the original workflow (the reviewer, e.g. a
    // product owner, may not hold drafting capability).
    const scope = { tenantId: actor.tenantId, projectId: actor.projectId };
    const original = res.review.workflowId ? await getWorkflow(deps.db, scope, res.review.workflowId) : null;
    const submitter = (original && (await getActor(deps.db, scope, original.actorId))) ?? actor;
    rerun = await runStoryWorkflow(deps, submitter, res.review.subjectId, {
      environmentId: res.review.targetEnvironment ?? undefined,
    });
  }
  return { ...res, rerun };
}
