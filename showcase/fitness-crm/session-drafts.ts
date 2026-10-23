// ADR-0020: the Gym CRM acceptance-criteria stories drafted by Claude in an interactive Claude Code
// session, through the agent's own prompts and checks. Run it, answer the request files it writes
// under results/session-exchange/, run it again; repeat until nothing is pending. Then it writes
// results/session-drafts.json with the drafts and a comparison against the team's designed cases.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestDb, latestRevision, seedProject } from '../../packages/db/src/index.ts';
import { DraftContent } from '../../packages/domain/src/index.ts';
import { SessionExchangeProvider } from '../../packages/llm-adapter/src/index.ts';
import { submitStory } from '../../packages/orchestrator/src/index.ts';
import { ingestDirectory } from '../../packages/retrieval/src/index.ts';
import { CASES } from './suite/index.ts';

const HERE = 'showcase/fitness-crm';
const EXCHANGE = join(HERE, 'results', 'session-exchange');
const MODEL = 'claude-opus-5-5 (interactive Claude Code session)';

const scope = { tenantId: 'showcase', projectId: 'gym' };
const db = await createTestDb();
const a = await seedProject(db, scope);
await ingestDirectory(db, a.po, join(HERE, 'sources'));
const session = new SessionExchangeProvider({ dir: EXCHANGE, modelLabel: MODEL });
const deps = { db, classifier: session, generator: session, decisionCacheTtlMs: null };

const files = (await readdir(join(HERE, 'stories'))).sort();
const stories = [];
for (const f of files) {
  const story = JSON.parse(await readFile(join(HERE, 'stories', f), 'utf8'));
  const r = await submitStory(deps, a.qa, story);
  const o = r.outcome;
  const ac = story.acceptanceCriteria[0];
  const drafts =
    o.route === 'DRAFT_CREATED'
      ? await Promise.all(
          o.caseIds.map(async (id) => DraftContent.parse((await latestRevision(db, scope, id))!.content)),
        )
      : [];
  const team = CASES.filter((c) => c.requirement.id === ac.id);
  stories.push({
    story: story.externalId,
    criterion: ac.id,
    text: ac.text,
    route: o.route,
    pending:
      o.route === 'REVIEW_REQUESTED' && o.reason.startsWith('GENERATOR_UNAVAILABLE')
        ? 'draft'
        : o.route === 'REVIEW_REQUESTED' && o.reason.includes('UNAVAILABLE')
          ? 'readiness'
          : null,
    question: o.route === 'REVIEW_REQUESTED' ? o.question : null,
    reason: o.route === 'REVIEW_REQUESTED' ? o.reason : null,
    designNotes: o.route === 'DRAFT_CREATED' ? o.designNotes : [],
    missingRequirements: o.route === 'DRAFT_CREATED' ? o.missingRequirements : [],
    drafts: drafts.map((d) => ({
      title: d.title,
      priority: d.priority,
      level: d.level,
      manualReason: d.manualReason,
      basis: d.basis,
      techniques: d.techniques,
      testTypes: d.testTypes,
      testConditions: d.testConditions,
      requirementRefs: d.requirementRefs,
      steps: d.steps.map((s) => ({
        action: s.action,
        expected: s.expected,
        testData: s.testData,
        sourceRefs: s.sourceRefs,
      })),
      assumptions: d.assumptions,
      reviewFlags: d.reviewFlags,
    })),
    team: team.map((c) => ({
      id: c.id,
      title: c.title,
      technique: c.technique,
      steps: c.steps.length,
      automated: Boolean(c.spec),
    })),
  });
}

const pending = stories.filter((s) => s.pending);
const drafted = stories.filter((s) => s.route === 'DRAFT_CREATED');
const allDrafts = drafted.flatMap((s) => s.drafts);
const summary = {
  stories: stories.length,
  drafted: drafted.length,
  clarification: stories.filter((s) => s.route === 'REVIEW_REQUESTED' && !s.pending).length,
  pending: pending.length,
  cases: allDrafts.length,
  steps: allDrafts.reduce((n, d) => n + d.steps.length, 0),
  flaggedCases: allDrafts.filter((d) => d.reviewFlags.length > 0).length,
  automatable: allDrafts.filter((d) => d.level !== 'manual').length,
  techniques: Object.fromEntries(
    [...new Set(allDrafts.flatMap((d) => d.techniques))].map((t) => [
      t,
      allDrafts.filter((d) => d.techniques.includes(t)).length,
    ]),
  ),
  teamCasesOnTheseCriteria: stories.reduce((n, s) => n + s.team.length, 0),
};
await writeFile(
  join(HERE, 'results', 'session-drafts.json'),
  JSON.stringify({ model: MODEL, generatedAt: new Date().toISOString(), summary, stories }, null, 2),
);
console.error(
  pending.length
    ? `${pending.length} stories await an answer (${pending.map((s) => `${s.story}:${s.pending}`).join(', ')}); answer the request files in ${EXCHANGE} and run again`
    : `done: ${summary.drafted}/${summary.stories} drafted, ${summary.cases} cases, ${summary.flaggedCases} flagged`,
);
