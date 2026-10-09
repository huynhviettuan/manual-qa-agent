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
  const problems = out.value.steps.flatMap((step, i) => {
    if (step.sourceRefs.length === 0) return [`step ${i + 1} has no source`];
    return step.sourceRefs.filter((r) => !allowed.has(r)).map((r) => `step ${i + 1} cites unknown ${r}`);
  });
  if (problems.length > 0) {
    return { ok: false, failure: 'UNGROUNDED', detail: problems.join('; '), meta: out.meta };
  }
  return out;
}
