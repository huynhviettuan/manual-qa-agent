import {
  decodePayload,
  HEURISTIC_MODEL,
  heuristicAssessment,
  heuristicDraft,
  type PromptPayload,
} from './heuristic.ts';
import { DRAFT_SYSTEM, READINESS_SYSTEM } from './prompts.ts';

/**
 * A stand-in for the Anthropic HTTP API, injected into the real SDK client via its `fetch`
 * option. Tests and keyless local runs exercise the real request/parse/error code paths.
 */

export type FakeRequest = {
  kind: 'readiness' | 'draft' | 'unknown';
  body: Record<string, unknown>;
  payload: PromptPayload;
};

export type FakeReply = { status?: number; body: unknown; headers?: Record<string, string> };
export type Responder = (req: FakeRequest) => FakeReply | Promise<FakeReply>;

export function messageReply(
  output: unknown,
  opts: { model?: string; stopReason?: string; stopDetails?: unknown; rawText?: string } = {},
): FakeReply {
  const text = opts.rawText ?? JSON.stringify(output);
  return {
    body: {
      id: 'msg_fake',
      type: 'message',
      role: 'assistant',
      model: opts.model ?? 'claude-opus-5-5',
      content: opts.stopReason === 'refusal' ? [] : [{ type: 'text', text }],
      stop_reason: opts.stopReason ?? 'end_turn',
      stop_sequence: null,
      stop_details: opts.stopDetails ?? null,
      usage: {
        input_tokens: 400,
        output_tokens: 120,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  };
}

export function errorReply(status: number, type: string): FakeReply {
  return {
    status,
    // Zero retry delay keeps bounded-retry tests fast.
    headers: { 'retry-after-ms': '0' },
    body: { type: 'error', error: { type, message: `fake ${type}` } },
  };
}

export function jsonResponse(reply: FakeReply): Response {
  return new Response(JSON.stringify(reply.body), {
    status: reply.status ?? 200,
    headers: { 'content-type': 'application/json', 'request-id': 'req_fake', ...reply.headers },
  });
}

export function createFakeAnthropicFetch(responder: Responder): typeof fetch & { calls: FakeRequest[] } {
  const calls: FakeRequest[] = [];
  const fakeFetch = async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    const system = String(body.system ?? '');
    const messages = (body.messages ?? []) as Array<{ content: string }>;
    const payload = decodePayload(messages[0]?.content ?? '');
    const kind = system === READINESS_SYSTEM ? 'readiness' : system === DRAFT_SYSTEM ? 'draft' : 'unknown';
    const req: FakeRequest = { kind, body, payload };
    calls.push(req);
    return jsonResponse(await responder(req));
  };
  return Object.assign(fakeFetch as typeof fetch, { calls });
}

/** Keyless dev/eval mode for the Anthropic provider (see heuristic.ts). */
export const heuristicResponder: Responder = ({ kind, payload }) => {
  if (kind === 'readiness')
    return messageReply(heuristicAssessment(payload).assessment, { model: HEURISTIC_MODEL });
  if (kind === 'draft') return messageReply(heuristicDraft(payload), { model: HEURISTIC_MODEL });
  return errorReply(400, 'invalid_request_error');
};
