import { type DraftContent, sourceRef } from '@qa/domain';
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

export function checkDraft(
  input: DraftInput,
  out: ProviderOutcome<DraftContent>,
): ProviderOutcome<DraftContent> {
  if (!out.ok) return out;
  if (out.value.steps.length === 0) {
    return { ok: false, failure: 'MALFORMED', detail: 'draft has no steps', meta: out.meta };
  }
  const allowed = new Set([
    ...input.sources.map((s) => sourceRef(s.sourceId, s.version)),
    ...storyRefs(input.story),
  ]);
  if (out.value.techniques.length === 0) {
    return {
      ok: false,
      failure: 'MALFORMED',
      detail: 'draft names no test-design technique',
      meta: out.meta,
    };
  }
  const problems = out.value.steps.flatMap((step, i) => {
    if (step.sourceRefs.length === 0) return [`step ${i + 1} has no source`];
    return step.sourceRefs.filter((r) => !allowed.has(r)).map((r) => `step ${i + 1} cites unknown ${r}`);
  });
  problems.push(
    ...out.value.requirementRefs.filter((r) => !allowed.has(r)).map((r) => `traces to unknown ${r}`),
  );
  if (problems.length > 0) {
    return { ok: false, failure: 'UNGROUNDED', detail: problems.join('; '), meta: out.meta };
  }
  // Coverage is checked in code, not taken from the model: an acceptance criterion the draft
  // neither traces nor reports as missing is surfaced to the reviewer as a gap.
  const traced = new Set(out.value.requirementRefs);
  const gaps = input.story.acceptanceCriteria
    .filter((ac) => !traced.has(`story:${ac.id}`))
    .filter((ac) => !out.value.missingRequirements.some((m) => mentions(m, ac.id)))
    .map((ac) => `${ac.id}: not covered by this draft (coverage check)`);
  if (gaps.length === 0) return out;
  return {
    ...out,
    value: { ...out.value, missingRequirements: [...out.value.missingRequirements, ...gaps] },
  };
}

/** Whether text names an id as a whole token, so AC-1 is not found inside AC-10. */
function mentions(text: string, id: string): boolean {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9_-])${escaped}($|[^A-Za-z0-9_-])`).test(text);
}
