import { jsonResponse, type FakeReply } from './fake-anthropic.ts';
import {
  decodePayload,
  HEURISTIC_MODEL,
  heuristicDecisions,
  heuristicDraft,
  heuristicTriage,
  type PromptPayload,
} from './heuristic.ts';
import type { TriageFacts } from './types.ts';

/**
 * A stand-in for the OpenAI HTTP API (Decisions + Responses), injected into the real SDK client
 * via its `fetch` option so tests exercise the real request/parse/error code paths.
 */

export type OpenAIFakeRequest = {
  endpoint: 'decisions' | 'responses' | 'unknown';
  body: Record<string, unknown>;
  payload: PromptPayload;
  questions: Array<{ name: string; type: string }>;
};
export type OpenAIResponder = (req: OpenAIFakeRequest) => FakeReply | Promise<FakeReply>;

const usage = {
  input_tokens: 400,
  input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
  output_tokens: 20,
  output_tokens_details: { reasoning_tokens: 0 },
  total_tokens: 420,
};

export const choiceAnswer = (name: string, value: string, confidence = 0.9) => ({
  type: 'choice',
  name,
  choice: value,
  confidence,
  probabilities: [{ value, probability: confidence }],
});
export const predicateAnswer = (name: string, probability: number) => ({
  type: 'predicate',
  name,
  probability,
});
export const refusalAnswer = (name: string) => ({ type: 'refusal', name });

export function decisionReply(answers: unknown[], opts: { model?: string } = {}): FakeReply {
  return { body: { answers, model: opts.model ?? 'gpt-6-luna', usage } };
}

export function responsesReply(
  output: unknown,
  opts: { model?: string; rawText?: string; refusal?: string; incompleteReason?: string } = {},
): FakeReply {
  const content = opts.refusal
    ? [{ type: 'refusal', refusal: opts.refusal }]
    : [{ type: 'output_text', text: opts.rawText ?? JSON.stringify(output), annotations: [] }];
  return {
    body: {
      id: 'resp_fake',
      object: 'response',
      created_at: 0,
      model: opts.model ?? 'gpt-mock-draft',
      status: opts.incompleteReason ? 'incomplete' : 'completed',
      incomplete_details: opts.incompleteReason ? { reason: opts.incompleteReason } : null,
      output: [{ type: 'message', id: 'msg_fake', role: 'assistant', status: 'completed', content }],
      usage,
    },
  };
}

export function openaiErrorReply(status: number, type: string): FakeReply {
  return {
    status,
    headers: { 'retry-after-ms': '0' },
    body: { error: { message: `fake ${type}`, type, param: null, code: null } },
  };
}

export function createFakeOpenAIFetch(
  responder: OpenAIResponder,
): typeof fetch & { calls: OpenAIFakeRequest[] } {
  const calls: OpenAIFakeRequest[] = [];
  const fakeFetch = async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(typeof url === 'string' || url instanceof URL ? url : url.url).pathname;
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    const req: OpenAIFakeRequest = {
      endpoint: path.endsWith('/decisions')
        ? 'decisions'
        : path.endsWith('/responses')
          ? 'responses'
          : 'unknown',
      body,
      payload: decodePayload(String(body.input ?? '')),
      questions: (body.questions ?? []) as OpenAIFakeRequest['questions'],
    };
    calls.push(req);
    return jsonResponse(await responder(req));
  };
  return Object.assign(fakeFetch as typeof fetch, { calls });
}

/** Keyless dev/eval mode for the OpenAI provider (see heuristic.ts). */
export const openaiHeuristicResponder: OpenAIResponder = ({ endpoint, payload, questions }) => {
  if (endpoint === 'responses') return responsesReply(heuristicDraft(payload), { model: HEURISTIC_MODEL });
  if (endpoint !== 'decisions') return openaiErrorReply(404, 'not_found');
  if (questions.some((q) => q.name === 'cause')) {
    const t = heuristicTriage(payload as unknown as TriageFacts);
    return decisionReply(
      [choiceAnswer('cause', t.cause, 0.8), predicateAnswer('security', t.securityProbability)],
      {
        model: HEURISTIC_MODEL,
      },
    );
  }
  const h = heuristicDecisions(
    payload,
    questions.map((q) => q.name),
  );
  const answers = questions.map((q) =>
    q.name === 'readiness'
      ? choiceAnswer(q.name, h.readiness, h.confidence)
      : predicateAnswer(q.name, h.yes[q.name] ?? 0),
  );
  return decisionReply(answers, { model: HEURISTIC_MODEL });
};
