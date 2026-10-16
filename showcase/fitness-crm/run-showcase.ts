// Runs the Gym CRM showcase end to end and writes results/results.json plus evidence screenshots.
// Requires a running Gym CRM (GYM_URL, default http://localhost:3410) and QA_SECRET_GYM_PASSWORD.
// The AI is the keyless stand-in unless QA_LIVE_LLM=1 (billed). See showcase/fitness-crm/PLAN.md.
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createTestDb,
  getRun,
  latestTriage,
  listEvidence,
  listRevisions,
  seedProject,
  upsertEnvironment,
  workflowUsage,
} from '../../packages/db/src/index.ts';
import type { DomainError } from '../../packages/domain/src/index.ts';
import { LocalEvidenceStore } from '../../packages/evidence/src/index.ts';
import { PlaywrightExecutor } from '../../packages/execution/src/index.ts';
import { createProvidersFromEnv } from '../../packages/llm-adapter/src/index.ts';
import {
  addSuiteCases,
  buildReproduction,
  createSuite,
  getRunReport,
  getSuiteDetail,
  getSuiteRunReport,
  minReadyConfidenceFromEnv,
  projectMetrics,
  proposeExecutable,
  requestRun,
  reviewExecutable,
  runSuite,
  submitStory,
  workOnce,
  type RunDeps,
} from '../../packages/orchestrator/src/index.ts';
import { ingestDirectory } from '../../packages/retrieval/src/index.ts';
import { reviewTestCase } from '../../packages/review/src/index.ts';
import { CASES, SUITE_NAME } from './suite-definition.ts';

const HERE = 'showcase/fitness-crm';
const OUT = join(HERE, 'results');
const GYM_URL = process.env.GYM_URL ?? 'http://localhost:3410';
const password = process.env.QA_SECRET_GYM_PASSWORD;
if (!password) throw new Error('Set QA_SECRET_GYM_PASSWORD to the Gym CRM demo password');
const errorText = (e: unknown) =>
  `${(e as DomainError).code ?? ''} ${(e as Error).message ?? String(e)}`.trim();

const scope = { tenantId: 'showcase', projectId: 'gym' };
const db = await createTestDb();
const a = await seedProject(db, scope);
const host = new URL(GYM_URL).host;
for (const [id, kind] of [
  ['staging', 'staging'],
  ['production', 'production'],
] as const) {
  await upsertEnvironment(db, scope, {
    id,
    kind,
    allowedActions: ['draft', 'execute'],
    baseUrl: GYM_URL,
    allowedHosts: [host],
  });
}
const ingested = await ingestDirectory(db, a.po, join(HERE, 'sources'));

const providers = createProvidersFromEnv();
const deps = {
  db,
  classifier: providers.classifier,
  generator: providers.generator,
  minReadyConfidence: minReadyConfidenceFromEnv(),
  decisionCacheTtlMs: null,
};
const tokensOf = async (workflowId: string) =>
  (await workflowUsage(db, scope, workflowId)).usage.reduce(
    (s, u) => s + Number(u.inputTokens) + Number(u.outputTokens),
    0,
  );

// --- 1. Requirements review: readiness of every acceptance criterion (plus split follow-ups)
const readiness = [];
const storyFiles = [
  ...(await readdir(join(HERE, 'stories'))).sort().map((f) => join(HERE, 'stories', f)),
  ...(await readdir(join(HERE, 'stories-followup'))).sort().map((f) => join(HERE, 'stories-followup', f)),
];
for (const path of storyFiles) {
  const story = JSON.parse(await readFile(path, 'utf8'));
  const ac = story.acceptanceCriteria[0];
  const r = await submitStory(deps, a.qa, story);
  const o = r.outcome;
  readiness.push({
    story: story.externalId,
    followUp: path.includes('stories-followup') ? story.description : null,
    ac: ac.id,
    criterion: ac.text,
    route: o.route,
    sourceRefs: 'sourceRefs' in o ? o.sourceRefs : [],
    question: o.route === 'REVIEW_REQUESTED' ? o.question : null,
    reason: o.route === 'REVIEW_REQUESTED' ? o.reason : o.route === 'DENIED' ? o.reasons.join(', ') : null,
    tokens: await tokensOf(r.workflowId),
  });
}
console.error(`requirements review: ${readiness.length} stories`);

// --- 2. Test cases: agent draft -> QA revision -> QA lead approval -> executable (second person)
const cases = [];
for (const c of CASES) {
  const submit = (text: string) =>
    submitStory(deps, a.qa, {
      externalId: `GYM-${c.id}`,
      title: c.title,
      description: `${c.id} (${c.section})`,
      acceptanceCriteria: [{ id: c.requirement.id, text }],
    });
  const started = performance.now();
  let r = await submit(c.requirement.statement);
  // The agent may ask for a narrower story (e.g. too much matching context); a QA engineer narrows it.
  const firstAsk = r.outcome.route === 'REVIEW_REQUESTED' ? r.outcome.question : null;
  if (firstAsk && c.narrowedStatement) r = await submit(c.narrowedStatement);
  const draftMs = Math.round(performance.now() - started);
  const entry: Record<string, unknown> = {
    id: c.id,
    section: c.section,
    priority: c.priority,
    title: c.title,
    requirement: c.requirement,
    automated: Boolean(c.spec),
    manualReason: c.manualReason ?? null,
    draftMs,
    tokens: await tokensOf(r.workflowId),
    agentRoute: r.outcome.route,
    agentAskedFirst: firstAsk,
    narrowedStatement: firstAsk && c.narrowedStatement ? c.narrowedStatement : null,
  };
  cases.push(entry);
  if (r.outcome.route !== 'DRAFT_CREATED') {
    entry.agentQuestion = r.outcome.route === 'REVIEW_REQUESTED' ? r.outcome.question : null;
    continue;
  }
  const caseId = r.outcome.caseId;
  const refs = r.outcome.sourceRefs;
  entry.caseId = caseId;
  entry.sourceRefs = refs;
  entry.agentDraft = (await listRevisions(db, scope, caseId)).at(-1)?.content;
  await reviewTestCase(db, a.qa, caseId, {
    decision: 'EDIT',
    content: {
      title: `${c.id} ${c.title}`,
      priority: c.priority,
      preconditions: c.preconditions,
      testData: [],
      steps: c.steps.map((s) => ({ ...s, sourceRefs: refs })),
      assumptions: [],
      missingRequirements: [],
    },
    reason: 'QA revision of the agent draft',
  });
  await reviewTestCase(db, a.lead, caseId, { decision: 'APPROVE' });
  if (c.spec) {
    try {
      const exe = await proposeExecutable(db, a.qa, caseId, c.spec);
      await reviewExecutable(db, a.lead, exe.id, { decision: 'APPROVE' });
    } catch (e) {
      entry.specError = errorText(e);
    }
  }
}
console.error(`cases: ${cases.filter((c) => c.caseId).length}/${CASES.length} drafted and approved`);

// --- 3. Suite management
const suite = await createSuite(db, a.qa, {
  name: SUITE_NAME,
  description: 'Core Gym CRM flows: sign-in and access, leads, customers and contracts, PT booking, money.',
});
await addSuiteCases(
  db,
  a.qa,
  suite.id,
  cases.filter((c) => c.caseId).map((c) => ({ caseId: c.caseId as string, section: c.section as string })),
);
const suiteDetail = await getSuiteDetail(db, scope, suite.id);

// --- 4. Run the suite (twice, to check the results are repeatable)
await rm(join(OUT, 'evidence'), { recursive: true, force: true });
const store = new LocalEvidenceStore('.showcase-evidence');
const runDeps: RunDeps = {
  db,
  executor: new PlaywrightExecutor({
    channel: process.env.QA_BROWSER_CHANNEL || undefined,
    stepTimeoutMs: 10_000,
  }),
  store,
  secrets: (name) => (name === 'GYM_PASSWORD' ? password : undefined),
  triager: providers.triager,
};
const drain = async () => {
  while (await workOnce(runDeps, 'showcase-worker')) {
    /* one run per iteration */
  }
};
const idOf = new Map(cases.filter((c) => c.caseId).map((c) => [c.caseId as string, c.id as string]));

async function runDetail(runId: string, label: string, keepScreenshots: boolean) {
  const r = await getRunReport(db, scope, runId);
  const evidence = await listEvidence(db, scope, runId);
  const assertionSteps = new Set((r.assertions as Array<{ stepId: string }>).map((x) => x.stepId));
  const screenshots: string[] = [];
  if (keepScreenshots) {
    const dir = join(OUT, 'evidence', label);
    await mkdir(dir, { recursive: true });
    for (const e of evidence) {
      const step = e.name.replace(/^\d+-/, '').replace(/\.png$/, '');
      if (e.kind !== 'screenshot' || !(assertionSteps.has(step) || step.endsWith('-error'))) continue;
      const bytes = await store.get(e.objectKey);
      if (bytes) {
        await writeFile(join(dir, e.name), bytes);
        screenshots.push(e.name);
      }
    }
  }
  const triage = await latestTriage(db, scope, runId);
  return {
    runId,
    status: r.status,
    reason: r.reason,
    assertions: r.assertions,
    evidenceCount: evidence.length,
    screenshots,
    triage: triage && {
      suspectedCause: triage.suspectedCause,
      securitySensitive: triage.securitySensitive,
      rationale: triage.rationale,
    },
    reproduction: ['FAILED', 'INCONCLUSIVE'].includes(r.status)
      ? await buildReproduction(db, store, scope, runId)
      : null,
  };
}

const suiteRuns = [];
for (let i = 1; i <= 2; i++) {
  // Gym CRM allows 20 sign-ins per minute per IP (by design); each automated case signs in once, so
  // each suite run starts after that window has passed instead of sharing one session.
  await new Promise((resolve) => setTimeout(resolve, 65_000));
  const started = Date.now();
  const requested = await runSuite(runDeps, a.qa, suite.id, { environmentId: 'staging' });
  await drain();
  const wallMs = Date.now() - started;
  const report = await getSuiteRunReport(db, scope, requested.id);
  const items = [];
  for (const item of report.items) {
    const detail = item.runId ? await runDetail(item.runId, idOf.get(item.caseId)!, i === 2) : null;
    items.push({ ...item, tc: idOf.get(item.caseId), detail });
  }
  suiteRuns.push({ id: report.id, wallMs, totals: report.totals, complete: report.complete, items });
  console.error(`suite run ${i}: ${JSON.stringify(report.totals)} in ${Math.round(wallMs / 1000)}s`);
}

// --- 5. Safety gates and a labeled staged failure
const sample = cases.find((c) => c.id === 'TC-10' && c.caseId) ?? cases.find((c) => c.automated && c.caseId);
const gates: Array<Record<string, unknown>> = [];
let staged = null;
if (sample) {
  const caseId = sample.caseId as string;
  const spec = CASES.find((c) => c.id === sample.id)!.spec!;
  const attempt = async (gate: string, fn: () => Promise<unknown>) => {
    try {
      gates.push({ gate, outcome: await fn() });
    } catch (e) {
      gates.push({ gate, refused: errorText(e) });
    }
  };
  await attempt(`${sample.id} against the production environment`, async () => {
    const run = await requestRun(runDeps, a.qa, { caseId, environmentId: 'production' });
    return { status: run.state, reason: run.reason };
  });
  await attempt(`${sample.id} with a destructive step and no scoped approval`, async () => {
    const exe = await proposeExecutable(db, a.qa, caseId, {
      steps: [
        ...spec.steps,
        {
          id: 'delete-lead',
          type: 'click',
          destructive: true,
          target: { by: 'role', role: 'button', name: 'Xóa', within: { by: 'role', role: 'main' } },
        },
      ],
    });
    await reviewExecutable(db, a.lead, exe.id, { decision: 'APPROVE' });
    const run = await requestRun(runDeps, a.qa, { caseId, environmentId: 'staging' });
    await drain();
    const r = (await getRun(db, scope, run.id))!;
    return { status: r.state, reason: r.reason, approvalReview: r.reviewId };
  });
  await attempt('A step navigating to another host', () =>
    proposeExecutable(db, a.qa, caseId, {
      steps: [
        { id: 'leave', type: 'navigate', path: 'https://example.com/' },
        { id: 'check', type: 'expectUrl', path: '/' },
      ],
    }),
  );
  await attempt('The proposer approving their own executable', async () => {
    const exe = await proposeExecutable(db, a.qa, caseId, spec);
    return reviewExecutable(db, a.qa, exe.id, { decision: 'APPROVE' });
  });
  // Restore the real executable for the sample case (the gates above superseded it).
  const exe = await proposeExecutable(db, a.qa, caseId, spec);
  await reviewExecutable(db, a.lead, exe.id, { decision: 'APPROVE' });

  const genuineFailures = suiteRuns
    .at(-1)!
    .items.filter((i) => ['FAILED', 'INCONCLUSIVE'].includes(i.status));
  if (genuineFailures.length === 0) {
    const wrong = structuredClone(spec);
    const last = wrong.steps.at(-1) as Record<string, unknown>;
    wrong.steps[wrong.steps.length - 1] = {
      id: 'staged-wrong-expectation',
      type: 'expectText',
      target: last.target ?? { by: 'role', role: 'main' },
      text: 'This text is deliberately not on the page (staged failure)',
    };
    const staging = await proposeExecutable(db, a.qa, caseId, wrong);
    await reviewExecutable(db, a.lead, staging.id, { decision: 'APPROVE' });
    const run = await requestRun(runDeps, a.qa, { caseId, environmentId: 'staging' });
    await drain();
    staged = {
      note: `STAGED: ${sample.id} with a deliberately wrong expectation`,
      tc: sample.id,
      ...(await runDetail(run.id, `staged-${sample.id}`, true)),
    };
  }
}

const metrics = await projectMetrics(db, scope, 7);
await mkdir(OUT, { recursive: true });
await writeFile(
  join(OUT, 'results.json'),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      target: { url: GYM_URL, product: 'Gym CRM (fitness-crm sample, demo data)' },
      ai: { live: providers.live, models: providers.models },
      sources: ingested.map((s) => ({
        source: `${s.sourceId}@${s.version}`,
        trusted: s.trusted,
        chunks: s.chunks,
      })),
      readiness,
      cases,
      suite: suiteDetail,
      suiteRuns,
      gates,
      staged,
      metrics,
    },
    null,
    2,
  ) + '\n',
);
await db.close();
console.error(`wrote ${join(OUT, 'results.json')}`);
