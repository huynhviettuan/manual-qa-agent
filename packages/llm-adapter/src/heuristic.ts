import type { DraftContent } from '@qa/domain';
import type { ReadinessAssessment, SuspectedCause, TriageFacts } from './types.ts';

/** The decoded `<untrusted_data>` payload every provider receives (see prompts.ts). */
export type PromptPayload = {
  story: {
    id: string;
    title: string;
    description: string;
    acceptanceCriteria: Array<{ id: string; text: string }>;
  };
  sources: Array<{ ref: string; trustTier: string; content: string }>;
};

export const HEURISTIC_MODEL = 'mock-heuristic-v1';

const VAGUE =
  /\b(quick(ly)?|fast|multiple|several|some|many|few|appropriate(ly)?|user[- ]friendly|reasonable|soon|large|small|etc)\b/i;
const MEASURABLE = /\d|"[^"]+"|'[^']+'/;

/**
 * Deterministic stand-in for a model, used when QA_LIVE_LLM is not set. An acceptance criterion
 * counts as measurable if it (or a source mentioning its ID) contains a number or a quoted
 * message and it avoids vague quantifiers. It is NOT a model; it lets the pipeline, policy and
 * audit trail run end to end without credentials, behind each provider's real SDK code path.
 */
export function heuristicAssessment(payload: PromptPayload): {
  assessment: Omit<ReadinessAssessment, 'confidence'>;
  measurableAcIds: string[];
} {
  const { story, sources } = payload;
  if (sources.length === 0) {
    return {
      assessment: {
        readiness: 'blocked',
        missingExpectations: ['No approved sources'],
        clarificationQuestion: null,
        citedSourceIds: [],
      },
      measurableAcIds: [],
    };
  }
  const missing: string[] = [];
  const measurableAcIds: string[] = [];
  const cited = new Set<string>();
  for (const ac of story.acceptanceCriteria) {
    const support = sources.filter((s) => s.content.includes(ac.id));
    support.forEach((s) => cited.add(s.ref));
    const resolvedBySource = support.some((s) => MEASURABLE.test(s.content.replaceAll(ac.id, '')));
    const measurable = MEASURABLE.test(ac.text.replaceAll(ac.id, '')) && !VAGUE.test(ac.text);
    if (measurable || resolvedBySource) measurableAcIds.push(ac.id);
    else missing.push(`${ac.id}: expected result is not measurable ("${ac.text}")`);
  }
  if (cited.size === 0) sources.forEach((s) => cited.add(s.ref));
  const ready = missing.length === 0;
  return {
    assessment: {
      readiness: ready ? 'ready' : 'clarification',
      missingExpectations: missing,
      clarificationQuestion: ready
        ? null
        : `Please specify the exact, measurable expected behaviour for: ${missing.map((m) => m.split(':')[0]).join(', ')}.`,
      citedSourceIds: [...cited],
    },
    measurableAcIds,
  };
}

export function heuristicDraft(payload: PromptPayload): DraftContent {
  const { story, sources } = payload;
  return {
    title: `Verify ${story.title}`,
    priority: 'P1',
    preconditions: ['Test account exists in the target environment'],
    testData: ['Synthetic test user'],
    steps: story.acceptanceCriteria.map((ac) => {
      const support = sources.filter((s) => s.content.includes(ac.id));
      return {
        action: `Exercise ${ac.id}: ${ac.text}`,
        // First measurable line across supporting sources, ignoring the AC id itself.
        expected:
          support
            .flatMap((s) => s.content.split('\n'))
            .find((l) => MEASURABLE.test(l.replaceAll(ac.id, ''))) ?? ac.text,
        sourceRefs: support.length > 0 ? support.map((s) => s.ref) : [`story:${ac.id}`],
      };
    }),
    assumptions: [],
    missingRequirements: [],
  };
}

/** Extracts the JSON payload from a `<untrusted_data>` block (see prompts.userMessage). */
export function decodePayload(text: string): PromptPayload {
  const match = /<untrusted_data>\n([\s\S]*)\n<\/untrusted_data>/.exec(text);
  return JSON.parse(match?.[1] ?? '{}') as PromptPayload;
}

/** Heuristic typed answers for decision APIs, keyed by the question names in decision-readiness.ts. */
export function heuristicDecisions(payload: PromptPayload, questionNames: string[]) {
  const { assessment, measurableAcIds } = heuristicAssessment(payload);
  const yes: Record<string, number> = {};
  for (const name of questionNames) {
    const [kind, index] = name.split('_');
    if (kind === 'ac') {
      const ac = payload.story.acceptanceCriteria[Number(index)];
      yes[name] = ac && measurableAcIds.includes(ac.id) ? 0.9 : 0.1;
    } else if (kind === 'src') {
      const src = payload.sources[Number(index)];
      yes[name] = src && assessment.citedSourceIds.includes(src.ref) ? 0.9 : 0.1;
    }
  }
  return { readiness: assessment.readiness, confidence: 0.9, yes };
}

const SECURITY_TERMS =
  /password|passwd|token|auth|permission|forbidden|account|not found|session|login|sign[ -]?in|credential|unauthori|admin|\brole\b(?!=)|privilege|\baccess\b/i;

/**
 * Heuristic triage for keyless dev/eval runs (not a model): server errors or infrastructure
 * reasons -> ENVIRONMENT; step errors / unevaluated assertions -> TEST_ISSUE; an observed
 * different value -> PRODUCT_DEFECT; otherwise UNKNOWN. Security terms in the failing step escalate.
 */
export function heuristicTriage(facts: TriageFacts): {
  cause: SuspectedCause;
  securityProbability: number;
} {
  const step = facts.failingStep;
  const text = [step?.description, step?.expected, step?.actual, facts.reason].map(String).join(' ');
  // An expected 401/403 that did not happen is an authorization check by definition.
  const authzExpectation = step?.expected === 401 || step?.expected === 403;
  const securityProbability = SECURITY_TERMS.test(text) || authzExpectation ? 0.8 : 0.05;
  if (/EVIDENCE_UNAVAILABLE|EXECUTOR_CRASHED|LEASE_LOST/.test(facts.reason) || facts.httpErrors.length > 0) {
    return { cause: 'ENVIRONMENT', securityProbability };
  }
  if (facts.verdict === 'INCONCLUSIVE' || facts.stepErrors.length > 0)
    return { cause: 'TEST_ISSUE', securityProbability };
  if (step && step.actual !== null && step.actual !== undefined)
    return { cause: 'PRODUCT_DEFECT', securityProbability };
  return { cause: 'UNKNOWN', securityProbability };
}
