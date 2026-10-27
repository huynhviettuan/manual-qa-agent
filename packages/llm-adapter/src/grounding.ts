import {
  DraftContent,
  type DraftSet,
  type DraftSetOutput,
  sourceRef,
  buildVocabulary,
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

  // ADR-0024: a draftable clause must be the criteria's own words; anything else is dropped, so a
  // partial draft never rests on a clause the model invented.
  const criteria = input.story.acceptanceCriteria.map((ac) => fold(ac.text));
  const draftableClauses = (out.value.draftableClauses ?? []).filter((c) => {
    const f = fold(c);
    return f.length >= 8 && criteria.some((t) => t.includes(f));
  });
  if (out.value.readiness === 'ready' && draftableClauses.length > 0) {
    return fail('INCONSISTENT', 'ready but names draftable clauses as if something were waiting');
  }
  out = { ...out, value: { ...out.value, draftableClauses } };
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

const fold = (s: string) =>
  s
    .normalize('NFKC')
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/**
 * ADR-0023: an expected result's `evidence` quote must be in a source the step cites, verbatim up
 * to whitespace, quotes and case. A wrong quote is flagged; a missing one on a `specified` case
 * is flagged too, so the reviewer knows the expectation was not shown to follow from the text.
 */
export function quoteFlags(
  steps: ReadonlyArray<{ expected: string; sourceRefs: string[]; evidence?: string }>,
  sources: ReadonlyArray<{ sourceId: string; version: string; content: string }>,
): string[] {
  const text = new Map(sources.map((s) => [sourceRef(s.sourceId, s.version), fold(s.content)]));
  return steps.flatMap((s, i) => {
    const quote = fold(s.evidence ?? '');
    if (!quote) return [`step ${i + 1}: no quoted evidence for "${s.expected.slice(0, 60)}"`];
    const cited = s.sourceRefs.map((r) => text.get(r) ?? '');
    return cited.some((t) => t.includes(quote))
      ? []
      : [`step ${i + 1}: the quote "${s.evidence!.slice(0, 60)}" is not in the cited sources`];
  });
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
  const vocabulary = buildVocabulary(input.sources.map((s) => s.content));
  return {
    ...out,
    value: {
      designNotes: out.value.designNotes,
      // An expected result a tester cannot verify as written is flagged, not rejected: the
      // reviewer decides whether to sharpen it or send the story back.
      cases: out.value.cases.map((c) => ({
        ...DraftContent.parse(c),
        // Basis is derived, never claimed: any assumption makes the case assumption-based.
        basis: c.assumptions.length > 0 ? ('assumption' as const) : ('specified' as const),
        reviewFlags: [
          ...c.steps.flatMap((s, i) => {
            const problem = unobservableExpectation(s.expected, vocabulary);
            return problem ? [`step ${i + 1}: ${problem}`] : [];
          }),
          ...quoteFlags(c.steps, input.sources),
          ...(c.level === 'manual' && !c.manualReason.trim()
            ? ['no reason given for keeping the case manual']
            : []),
          ...(c.level !== 'manual' && c.manualReason.trim()
            ? [`manualReason given although level is ${c.level}`]
            : []),
        ],
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
