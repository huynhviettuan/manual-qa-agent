import type { Fetch } from '@typesafe-ai/sdk';
import { jsonResponse, type FakeReply } from './fake-anthropic.ts';
import { decodePayload, HEURISTIC_MODEL, heuristicDecisions, type PromptPayload } from './heuristic.ts';

/**
 * A stand-in for the TypeSafe HTTP API (`POST /v1/systemone`), injected into the official SDK
 * client via its `fetch` option so tests exercise the real request/retry/error code paths.
 */

export type JevFakeRequest = {
  path: string;
  body: { state?: unknown; model?: string; questions?: Record<string, { type: string }> };
  payload: PromptPayload;
  questionNames: string[];
};
export type JevResponder = (req: JevFakeRequest) => FakeReply | Promise<FakeReply>;

export const jevChoice = (choice: string, confidence = 0.9) => ({
  type: 'choice',
  choice,
  confidence,
  probabilities: { [choice]: confidence },
});
export const jevNoul = (p: number) => ({ type: 'noul', noul: p });

export function jevReply(answers: Record<string, unknown>, opts: { model?: string } = {}): FakeReply {
  return {
    headers: { 'x-typesafe-request-id': 'req_fake' },
    body: { model: opts.model ?? 'jev-1.13.0', answers, usage: { input_tokens: 400, output_tokens: 0 } },
  };
}

export function jevErrorReply(status: number, message = 'fake error'): FakeReply {
  return { status, headers: { 'retry-after-ms': '0' }, body: { detail: message } };
}

export function createFakeJevFetch(responder: JevResponder): Fetch & { calls: JevFakeRequest[] } {
  const calls: JevFakeRequest[] = [];
  const fakeFetch: Fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as JevFakeRequest['body'];
    const req: JevFakeRequest = {
      path: new URL(url).pathname,
      body,
      payload: decodePayload(typeof body.state === 'string' ? body.state : ''),
      questionNames: Object.keys(body.questions ?? {}),
    };
    calls.push(req);
    return jsonResponse(await responder(req));
  };
  return Object.assign(fakeFetch, { calls });
}

/** Keyless dev/eval mode for the Jev readiness provider (see heuristic.ts). */
export const jevHeuristicResponder: JevResponder = ({ path, payload, questionNames }) => {
  if (!path.endsWith('/v1/systemone')) return jevErrorReply(404, 'not found');
  const h = heuristicDecisions(payload, questionNames);
  const answers = Object.fromEntries(
    questionNames.map((name) => [
      name,
      name === 'readiness' ? jevChoice(h.readiness, h.confidence) : jevNoul(h.yes[name] ?? 0),
    ]),
  );
  return jevReply(answers, { model: HEURISTIC_MODEL });
};
