// Runs the Gym CRM showcase end to end and writes results/results.json plus evidence screenshots.
// Requires a running Gym CRM (GYM_URL, default http://localhost:3410) and QA_SECRET_GYM_PASSWORD.
// The AI is the keyless stand-in unless QA_LIVE_LLM=1 (billed). See showcase/fitness-crm/PLAN.md.
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createTestDb,
  latestTriage,
  listEvidence,
  listRevisions,
  seedProject,
  upsertEnvironment,
  workflowUsage,
} from '../../packages/db/src/index.ts';
import { DomainError } from '../../packages/domain/src/index.ts';
import { LocalEvidenceStore } from '../../packages/evidence/src/index.ts';
import { PlaywrightExecutor } from '../../packages/execution/src/index.ts';
import { createProvidersFromEnv } from '../../packages/llm-adapter/src/index.ts';
import {
  buildReproduction,
  getRunReport,
  minReadyConfidenceFromEnv,
  projectMetrics,
  proposeExecutable,
  requestRun,
  reviewExecutable,
  submitStory,
  workOnce,
  type RunDeps,
} from '../../packages/orchestrator/src/index.ts';
import { ingestDirectory } from '../../packages/retrieval/src/index.ts';
import { reviewTestCase } from '../../packages/review/src/index.ts';

const HERE = 'showcase/fitness-crm';
const OUT = join(HERE, 'results');
const GYM_URL = process.env.GYM_URL ?? 'http://localhost:3410';
const password = process.env.QA_SECRET_GYM_PASSWORD;
if (!password) throw new Error('Set QA_SECRET_GYM_PASSWORD to the Gym CRM demo password');

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

// --- Step 3: readiness for every acceptance criterion, then follow-up stories a QA engineer split
// after the agent's review (stories-followup/).
const readiness = [];
const storyFiles = [
  ...(await readdir(join(HERE, 'stories'))).sort().map((f) => join(HERE, 'stories', f)),
  ...(await readdir(join(HERE, 'stories-followup'))).sort().map((f) => join(HERE, 'stories-followup', f)),
];
for (const path of storyFiles) {
  const story = JSON.parse(await readFile(path, 'utf8'));
  const ac = story.acceptanceCriteria[0];
  const r = await submitStory(deps, a.qa, story);
  const usage = await workflowUsage(db, scope, r.workflowId);
  const o = r.outcome;
  const draft =
    o.route === 'DRAFT_CREATED' ? (await listRevisions(db, scope, o.caseId)).at(-1)?.content : undefined;
  readiness.push({
    story: story.externalId,
    followUp: path.includes('stories-followup') ? story.description : null,
    ac: ac.id,
    criterion: ac.text,
    route: o.route,
    caseId: o.route === 'DRAFT_CREATED' ? o.caseId : null,
    sourceRefs: 'sourceRefs' in o ? o.sourceRefs : [],
    question: o.route === 'REVIEW_REQUESTED' ? o.question : null,
    reviewKind: o.route === 'REVIEW_REQUESTED' ? o.kind : null,
    reason: o.route === 'REVIEW_REQUESTED' ? o.reason : o.route === 'DENIED' ? o.reasons.join(', ') : null,
    draft: draft ?? null,
    models: [...new Set(usage.decisions.map((d) => d.model))],
    tokens: usage.usage.reduce((s, u) => s + Number(u.inputTokens) + Number(u.outputTokens), 0),
  });
  console.error(`${story.externalId.padEnd(18)} ${o.route}`);
}

// --- Step 4: browser runs
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

async function drain() {
  while (await workOnce(runDeps, 'showcase-worker')) {
    /* one run per iteration */
  }
}

async function report(runId: string, label: string) {
  const r = await getRunReport(db, scope, runId);
  const dir = join(OUT, 'evidence', label);
  await mkdir(dir, { recursive: true });
  const evidence = [];
  for (const e of await listEvidence(db, scope, runId)) {
    const bytes = await store.get(e.objectKey);
    if (bytes && e.kind === 'screenshot') await writeFile(join(dir, e.name), bytes);
    evidence.push({ kind: e.kind, name: e.name, digest: e.digest });
  }
  const triage = await latestTriage(db, scope, runId);
  return {
    runId,
    status: r.status,
    reason: r.reason,
    assertions: r.assertions,
    blockedRequests: r.blockedRequests,
    evidence,
    triage: triage && {
      suspectedCause: triage.suspectedCause,
      securitySensitive: triage.securitySensitive,
      rationale: triage.rationale,
      reviewId: triage.reviewId,
    },
    reproduction: ['FAILED', 'INCONCLUSIVE'].includes(r.status)
      ? await buildReproduction(db, store, scope, runId)
      : null,
  };
}

/** Approves the drafted case, proposes the spec (QA engineer), approves it (QA lead), runs it. */
async function runSpec(ac: string, spec: unknown, label: string, environmentId = 'staging') {
  const row = readiness.find((r) => r.ac === ac && r.caseId) ?? readiness.find((r) => r.ac === ac);
  if (!row?.caseId) return { label, ac, skipped: `no draft: the agent routed ${ac} to ${row?.route}` };
  try {
    await reviewTestCase(db, a.qa, row.caseId, { decision: 'APPROVE' }).catch((e: unknown) => {
      if (!(e instanceof DomainError && e.code === 'ILLEGAL_TRANSITION')) throw e; // already approved
    });
    const exe = await proposeExecutable(db, a.qa, row.caseId, spec);
    await reviewExecutable(db, a.lead, exe.id, { decision: 'APPROVE' });
    const run = await requestRun(runDeps, a.qa, { caseId: row.caseId, environmentId });
    await drain();
    return { label, ac, environmentId, ...(await report(run.id, label)) };
  } catch (e) {
    return {
      label,
      ac,
      error: e instanceof Error ? `${(e as DomainError).code ?? ''} ${e.message}` : String(e),
    };
  }
}

const specs: Record<string, { storyAc: string; spec: { steps: unknown[] } }> = {};
for (const f of (await readdir(join(HERE, 'specs'))).sort())
  specs[f.replace('.json', '')] = JSON.parse(await readFile(join(HERE, 'specs', f), 'utf8'));

const runs = [];
for (const [label, s] of Object.entries(specs)) {
  const r = await runSpec(s.storyAc, s.spec, label);
  runs.push(r);
  console.error(`${label}: ${'status' in r ? `${r.status} ${r.reason ?? ''}` : (r.skipped ?? r.error)}`);
}

// --- Step 5: triage and safety gates
const runnable = Object.entries(specs).find(([, s]) => readiness.some((r) => r.ac === s.storyAc && r.caseId));
const gates: Array<Record<string, unknown>> = [];
let staged = null;
if (runnable) {
  const [label, s] = runnable;
  const caseId = readiness.find((r) => r.ac === s.storyAc && r.caseId)!.caseId!;
  const attempt = async (name: string, fn: () => Promise<unknown>) => {
    try {
      gates.push({ gate: name, outcome: await fn() });
    } catch (e) {
      gates.push({ gate: name, refused: `${(e as DomainError).code ?? ''} ${(e as Error).message}` });
    }
  };
  await attempt('Same approved test against the production environment', async () => {
    const run = await requestRun(runDeps, a.qa, { caseId, environmentId: 'production' });
    return { status: run.state, reason: run.reason };
  });
  await attempt('A destructive step without a scoped approval', async () => {
    const destructive = {
      steps: [
        ...s.spec.steps,
        {
          id: 'delete-lead',
          type: 'click',
          destructive: true,
          target: { by: 'role', role: 'button', name: 'Xóa', within: { by: 'role', role: 'main' } },
        },
      ],
    };
    const exe = await proposeExecutable(db, a.qa, caseId, destructive);
    await reviewExecutable(db, a.lead, exe.id, { decision: 'APPROVE' });
    const run = await requestRun(runDeps, a.qa, { caseId, environmentId: 'staging' });
    await drain();
    const r = await getRunReport(db, scope, run.id);
    return { status: r.status, reason: r.reason, approvalReview: r.reviewId };
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
    const exe = await proposeExecutable(db, a.qa, caseId, s.spec);
    return reviewExecutable(db, a.qa, exe.id, { decision: 'APPROVE' });
  });

  // Triage: shown on genuine failures above; otherwise one clearly labeled staged failure.
  if (!runs.some((r) => 'status' in r && ['FAILED', 'INCONCLUSIVE'].includes(r.status as string))) {
    const wrong = structuredClone(s.spec);
    const last = wrong.steps.at(-1) as Record<string, unknown>;
    wrong.steps[wrong.steps.length - 1] = {
      id: 'staged-wrong-expectation',
      type: 'expectText',
      // Same element the real assertion checks, so the mismatch is observable (a FAILED verdict).
      target: last.target ?? { by: 'role', role: 'main' },
      text: 'This text is deliberately not on the page (staged failure)',
      sourceRefs: last.sourceRefs ?? [],
    };
    staged = {
      note: `STAGED: ${label} with a deliberately wrong expectation`,
      ...(await runSpec(s.storyAc, wrong, `staged-${label}`)),
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
      runs,
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
