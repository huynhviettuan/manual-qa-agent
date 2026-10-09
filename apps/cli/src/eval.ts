import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { createTestDb, seedProject, workflowUsage } from '@qa/db';
import { AcceptanceCriterion } from '@qa/domain';
import { createProvidersFromEnv } from '@qa/llm-adapter';
import { minReadyConfidenceFromEnv, submitStory, type WorkflowOutcome } from '@qa/orchestrator';
import { ingestDirectory } from './ingest-dir.ts';

const Label = z.enum([
  'DRAFT',
  'CLARIFICATION',
  'CONFLICT',
  'MISSING_KNOWLEDGE',
  'PROVIDER_FAILURE',
  'DENIED',
]);
type Label = z.infer<typeof Label>;

const LabeledStory = z.object({
  id: z.string(),
  story: z.object({
    externalId: z.string(),
    title: z.string(),
    description: z.string(),
    acceptanceCriteria: z.array(AcceptanceCriterion),
  }),
  expected: Label,
  /** Sources a correct draft must cite (source attribution metric). */
  expectedSourceRefs: z.array(z.string()).default([]),
  notes: z.string().optional(),
});

function labelOf(o: WorkflowOutcome): Label {
  if (o.route === 'DRAFT_CREATED') return 'DRAFT';
  if (o.route === 'DENIED') return 'DENIED';
  return (
    {
      REQUIREMENT_CLARIFICATION: 'CLARIFICATION',
      SOURCE_CONFLICT: 'CONFLICT',
      MISSING_KNOWLEDGE: 'MISSING_KNOWLEDGE',
      PROVIDER_FAILURE: 'PROVIDER_FAILURE',
      ACTION_APPROVAL: 'DENIED',
    } as const
  )[o.kind];
}

const pct = (n: number, d: number) => (d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(0)}%`);

/**
 * Runs labeled stories end to end on a fresh in-memory database. Mandatory gates (docs/10):
 * no false-ready drafts and no non-draft actions. Quantitative thresholds are set by the QA lead.
 */
export async function runEval(dir: string) {
  const db = await createTestDb();
  const scope = { tenantId: 'eval', projectId: 'pilot' };
  const actors = await seedProject(db, scope);
  // A second project with conflicting knowledge proves isolation.
  const other = await seedProject(db, { tenantId: 'eval-other', projectId: 'other' });
  await ingestDirectory(db, actors.po, join(dir, 'sources'));
  await ingestDirectory(db, other.po, join(dir, 'other-project-sources'));

  const providers = createProvidersFromEnv();
  const { live } = providers;
  const deps = {
    db,
    classifier: providers.classifier,
    generator: providers.generator,
    minReadyConfidence: minReadyConfidenceFromEnv(),
  };
  const files = (await readdir(join(dir, 'stories'))).filter((f) => f.endsWith('.json')).sort();

  const rows: Array<{
    id: string;
    expected: Label;
    actual: Label;
    attribution: boolean | null;
    tokens: number;
    nonDraftActions: number;
    leaked: boolean;
  }> = [];
  for (const file of files) {
    const item = LabeledStory.parse(JSON.parse(await readFile(join(dir, 'stories', file), 'utf8')));
    const r = await submitStory(deps, actors.qa, item.story);
    const usage = await workflowUsage(db, scope, r.workflowId);
    const actual = labelOf(r.outcome);
    const refs =
      r.outcome.route === 'DRAFT_CREATED'
        ? r.outcome.sourceRefs
        : 'sourceRefs' in r.outcome
          ? r.outcome.sourceRefs
          : [];
    rows.push({
      id: item.id,
      expected: item.expected,
      actual,
      attribution:
        actual === 'DRAFT' && item.expectedSourceRefs.length > 0
          ? item.expectedSourceRefs.every((s) => refs.includes(s))
          : null,
      tokens: usage.usage.reduce((sum, u) => sum + Number(u.inputTokens) + Number(u.outputTokens), 0),
      nonDraftActions: usage.policyEvaluations.filter((p) => p.actionKind !== 'draft').length,
      leaked: refs.some((ref) => ref.startsWith('OTHER-')),
    });
  }
  await db.close();

  const notReady = rows.filter((r) => r.expected !== 'DRAFT');
  const falseReady = notReady.filter((r) => r.actual === 'DRAFT');
  const attributed = rows.filter((r) => r.attribution !== null);
  const correct = rows.filter((r) => r.expected === r.actual);

  console.log(
    `\nEvaluation: readiness ${providers.providers.readiness}/${providers.models.readiness}, draft ${providers.providers.draft}/${providers.models.draft}, ${
      live ? 'LIVE (billed)' : 'mock heuristic, measures the pipeline, not the model'
    }\n`,
  );
  console.log('story'.padEnd(28), 'expected'.padEnd(18), 'actual'.padEnd(18), 'tokens');
  for (const r of rows) {
    console.log(
      r.id.padEnd(28),
      r.expected.padEnd(18),
      `${r.actual}${r.expected === r.actual ? '' : '  ✗'}`.padEnd(18),
      r.tokens,
    );
  }
  console.log(
    `\naccuracy              ${correct.length}/${rows.length} (${pct(correct.length, rows.length)})`,
  );
  for (const label of Label.options) {
    const predicted = rows.filter((r) => r.actual === label);
    const actual = rows.filter((r) => r.expected === label);
    if (predicted.length + actual.length === 0) continue;
    const tp = rows.filter((r) => r.actual === label && r.expected === label).length;
    console.log(
      `  ${label.padEnd(20)} precision ${pct(tp, predicted.length).padStart(4)}  recall ${pct(tp, actual.length).padStart(4)}`,
    );
  }
  console.log(
    `false-ready rate      ${falseReady.length}/${notReady.length} (${pct(falseReady.length, notReady.length)})`,
  );
  console.log(`source attribution    ${attributed.filter((r) => r.attribution).length}/${attributed.length}`);
  console.log(
    `tokens per workflow   ${(rows.reduce((s, r) => s + r.tokens, 0) / Math.max(rows.length, 1)).toFixed(0)} (provider-reported)`,
  );

  const gates = {
    noFalseReady: falseReady.length === 0,
    noNonDraftActions: rows.every((r) => r.nonDraftActions === 0),
    noCrossProjectLeak: rows.every((r) => !r.leaked),
  };
  console.log(
    `\nmandatory gates       ${Object.entries(gates)
      .map(([k, v]) => `${k}=${v ? 'PASS' : 'FAIL'}`)
      .join('  ')}`,
  );
  return { rows, gates, passedGates: Object.values(gates).every(Boolean) };
}
