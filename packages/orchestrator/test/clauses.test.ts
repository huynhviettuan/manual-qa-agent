import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, latestRevision, seedProject, type Db, type SeededActors } from '@qa/db';
import { DraftContent, type DraftSet } from '@qa/domain';
import {
  checkReadiness,
  type CallMeta,
  type DraftGenerator,
  type DraftInput,
  type ReadinessClassifier,
  type ReadinessInput,
} from '@qa/llm-adapter';
import { ingestSource } from '@qa/retrieval';
import { submitStory } from '../src/index.ts';

// ADR-0024: one unclear clause no longer holds a whole criterion. The clauses the classifier
// quotes as clear are drafted now; the question stays open for the rest.

const S = { tenantId: 't', projectId: 'p' };
let db: Db;
let a: SeededActors;
const meta: CallMeta = {
  provider: 'fake',
  requestedModel: 'x',
  model: 'x',
  promptVersion: 'readiness-v2',
  inputHash: 'h',
  usage: null,
  latencyMs: 0,
};
const AC =
  'Booking is refused with the message "Hết buổi" when no session is left; a freeze over some days reminds the manager.';

const classifier = (draftableClauses: string[]): ReadinessClassifier => ({
  async classify(input: ReadinessInput) {
    return checkReadiness(input, {
      ok: true,
      value: {
        readiness: 'clarification',
        missingExpectations: ['AC-1: "some days" has no number'],
        clarificationQuestion: 'How many days of freeze remind the manager?',
        citedSourceIds: ['BR-404@v1'],
        confidence: null,
        draftableClauses,
      },
      meta,
    });
  },
});
/** Drafts one case per criterion it is given, citing the source; records what it was asked. */
const asked: DraftInput[] = [];
const generator: DraftGenerator = {
  async generate(input) {
    asked.push(input);
    const cases = input.story.acceptanceCriteria.map((ac) =>
      DraftContent.parse({
        title: `Checks: ${ac.text.slice(0, 40)}`,
        priority: 'P1',
        preconditions: [],
        testData: [],
        steps: [
          {
            action: 'Book with no session left',
            expected: 'Message "Hết buổi"',
            sourceRefs: ['BR-404@v1'],
            testData: '',
          },
        ],
        assumptions: [],
        missingRequirements: [],
        requirementRefs: [`story:${ac.id}`],
        techniques: ['equivalence_partitioning'],
        testTypes: ['negative'],
        module: 'Bookings',
        level: 'api',
      }),
    );
    const value: DraftSet = { designNotes: ['from the clear clauses'], cases, coverageGaps: [] };
    return { ok: true, value, meta: { ...meta, promptVersion: 'draft-v6' } };
  },
};

beforeAll(async () => {
  db = await createTestDb();
  a = await seedProject(db, S);
  await ingestSource(db, a.po, {
    meta: {
      sourceId: 'BR-404',
      version: 'v1',
      sourceType: 'SPECIFICATION',
      trustTier: 'T1',
      approvalStatus: 'APPROVED',
      approvedBy: 'po',
      owner: 'po',
      ruleKeys: [],
      effectiveFrom: new Date('2026-01-01'),
    },
    body: '## AC-1\nA booking needs a session left; otherwise "Hết buổi".',
  });
});
afterAll(() => db.close());

describe('drafting the clear clauses while a question is open (ADR-0024)', () => {
  it('opens the clarification and drafts the quoted clauses against the same sources', async () => {
    const r = await submitStory(
      {
        db,
        classifier: classifier(['Booking is refused with the message "Hết buổi" when no session is left']),
        generator,
      },
      a.qa,
      {
        externalId: 'CL-1',
        title: 'Bookings',
        description: '',
        acceptanceCriteria: [{ id: 'AC-1', text: AC }],
      },
    );
    expect(r.outcome.route).toBe('REVIEW_REQUESTED');
    if (r.outcome.route !== 'REVIEW_REQUESTED') return;
    expect(r.outcome).toMatchObject({
      kind: 'REQUIREMENT_CLARIFICATION',
      question: 'How many days of freeze remind the manager?',
    });
    expect(r.outcome.drafted?.clauses).toEqual([
      'Booking is refused with the message "Hết buổi" when no session is left',
    ]);
    expect(r.outcome.drafted?.caseIds).toHaveLength(1);
    const rev = (await latestRevision(db, S, r.outcome.drafted!.caseIds[0]!))!;
    expect(rev.status).toBe('DRAFT');
    // The generator saw only the clear clause, under the criterion's own id.
    expect(asked.at(-1)!.story.acceptanceCriteria).toEqual([
      { id: 'AC-1', text: 'Booking is refused with the message "Hết buổi" when no session is left' },
    ]);
  });

  it("drops a clause that is not the criterion's own words, and then drafts nothing", async () => {
    const before = asked.length;
    const r = await submitStory(
      { db, classifier: classifier(['Bookings are refused when the contract has no sessions']), generator },
      a.qa,
      {
        externalId: 'CL-2',
        title: 'Bookings',
        description: '',
        acceptanceCriteria: [{ id: 'AC-1', text: AC }],
      },
    );
    expect(r.outcome.route).toBe('REVIEW_REQUESTED');
    if (r.outcome.route !== 'REVIEW_REQUESTED') return;
    expect(r.outcome.drafted).toBeUndefined();
    expect(asked.length).toBe(before);
  });

  it('a "ready" answer that still names draftable clauses is inconsistent', async () => {
    const out = checkReadiness(
      {
        story: {
          externalId: 'x',
          title: 't',
          description: '',
          acceptanceCriteria: [{ id: 'AC-1', text: AC }],
        },
        sources: [],
      },
      {
        ok: true,
        value: {
          readiness: 'ready',
          missingExpectations: [],
          clarificationQuestion: null,
          citedSourceIds: [],
          confidence: null,
          draftableClauses: ['Booking is refused with the message "Hết buổi"'],
        },
        meta,
      },
    );
    expect(out).toMatchObject({ ok: false, failure: 'INCONSISTENT' });
  });
});
