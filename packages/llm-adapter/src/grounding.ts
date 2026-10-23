import {
  DraftContent,
  type DraftSet,
  type DraftSetOutput,
  sourceRef,
  unobservableExpectation,
} from '@qa/domain';
import { storyRefs } from './prompts.ts';
import type { DraftInput, ProviderOutcome, ReadinessAssessment, ReadinessInput } from './types.ts';

// Provider-neutral checks applied to every provider's answer. Providers only translate their
// API into these shapes; they never decide what counts as grounded.

export function checkReadiness(
  input: ReadinessInput,
  out: ProviderOutcome<ReadinessAssessment>,
): ProviderOutcome<ReadinessAssessment> {
  if (!out.ok) return out;
  const fail = (failure: 'UNGROUNDED' | 'INCONSISTENT', detail: string) =>
    ({ ok: false, failure, detail, meta: out.meta }) as const;

  const allowed = new Set(input.sources.map((s) => sourceRef(s.sourceId, s.version)));
  const unknown = out.value.citedSourceIds.filter((id) => !allowed.has(id));
  if (unknown.length > 0) return fail('UNGROUNDED', `cited unknown sources: ${unknown.join(', ')}`);

  if (out.value.readiness === 'ready') {
    if (out.value.citedSourceIds.length === 0 && input.sources.length > 0) {
      return fail('UNGROUNDED', 'ready without citing any source');
    }
    // "Ready" while listing missing expectations is self-contradictory; a human decides.
    if (out.value.missingExpectations.length > 0) {
      return fail('INCONSISTENT', `ready but missing: ${out.value.missingExpectations.join('; ')}`);
    }
  }
  return out;
}

export function checkDraftSet(
  input: DraftInput,
  out: ProviderOutcome<DraftSetOutput>,
): ProviderOutcome<DraftSet> {
  if (!out.ok) return out;
  const fail = (failure: 'MALFORMED' | 'UNGROUNDED', detail: string) =>
    ({ ok: false, failure, detail, meta: out.meta }) as const;
  const allowed = new Set([
    ...input.sources.map((s) => sourceRef(s.sourceId, s.version)),
    ...storyRefs(input.story),
  ]);

  const titles = new Set<string>();
  const malformed: string[] = [];
  out.value.cases.forEach((c, n) => {
    if (c.steps.length === 0) malformed.push(`case ${n + 1} has no steps`);
    if (c.techniques.length === 0) malformed.push(`case ${n + 1} names no test-design technique`);
    const title = c.title.trim().toLowerCase();
    if (titles.has(title)) malformed.push(`case ${n + 1} repeats the title "${c.title}"`);
    titles.add(title);
  });
  if (malformed.length > 0) return fail('MALFORMED', malformed.join('; '));

  const ungrounded = out.value.cases.flatMap((c, n) => [
    ...c.steps.flatMap((step, i) =>
      step.sourceRefs.length === 0
        ? [`case ${n + 1} step ${i + 1} has no source`]
        : step.sourceRefs
            .filter((r) => !allowed.has(r))
            .map((r) => `case ${n + 1} step ${i + 1} cites unknown ${r}`),
    ),
    ...c.requirementRefs.filter((r) => !allowed.has(r)).map((r) => `case ${n + 1} traces to unknown ${r}`),
  ]);
  if (ungrounded.length > 0) return fail('UNGROUNDED', ungrounded.join('; '));

  // Coverage is checked in code across the whole set, not taken from the model: an acceptance
  // criterion no case traces and no case reports as missing is surfaced to the reviewer as a gap.
  const traced = new Set(out.value.cases.flatMap((c) => c.requirementRefs));
  const reported = out.value.cases.flatMap((c) => c.missingRequirements);
  const coverageGaps = input.story.acceptanceCriteria
    .filter((ac) => !traced.has(`story:${ac.id}`))
    .filter((ac) => !reported.some((m) => mentions(m, ac.id)))
    .map((ac) => `${ac.id}: not covered by any drafted case (coverage check)`);
  return {
    ...out,
    value: {
      designNotes: out.value.designNotes,
      // An expected result a tester cannot verify as written is flagged, not rejected: the
      // reviewer decides whether to sharpen it or send the story back.
      cases: out.value.cases.map((c) => ({
        ...DraftContent.parse(c),
        reviewFlags: c.steps.flatMap((s, i) => {
          const problem = unobservableExpectation(s.expected);
          return problem ? [`step ${i + 1}: ${problem}`] : [];
        }),
      })),
      coverageGaps,
    },
  };
}

/** Whether text names an id as a whole token, so AC-1 is not found inside AC-10. */
function mentions(text: string, id: string): boolean {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9_-])${escaped}($|[^A-Za-z0-9_-])`).test(text);
}
