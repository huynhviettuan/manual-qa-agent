import { describe, expect, it } from 'vitest';
import { ExecutableSpec, weakAssertions, type ExecutableSpecInput } from '../src/index.ts';

// ADR-0023: assertions that pass without claiming much are flagged for the reviewer.

const main = { by: 'role', role: 'main' } as const;
const parse = (spec: ExecutableSpecInput) => ExecutableSpec.parse(spec);

describe('weakAssertions', () => {
  it('accepts an exact assertion that ends the case', () => {
    expect(
      weakAssertions(
        parse({
          steps: [
            { id: 'open', type: 'navigate', path: '/' },
            {
              id: 'title',
              type: 'expectText',
              target: main,
              text: 'Welcome back, QA Tester',
              match: 'exact',
            },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it('flags a short "contains", a status-only API step, and actions after the last assertion', () => {
    const flags = weakAssertions(
      parse({
        steps: [
          { id: 'open', type: 'navigate', path: '/' },
          { id: 'ok', type: 'expectText', target: main, text: 'OK' },
          { id: 'save', type: 'click', target: { by: 'role', role: 'button', name: 'Save' } },
          { id: 'again', type: 'navigate', path: '/next' },
        ],
      }),
    );
    expect(flags).toEqual([
      'step ok: "contains" on the short text "OK" passes on almost any page',
      'steps save, again act after the last assertion; their effect is never checked',
    ]);
    expect(
      weakAssertions(
        parse({
          steps: [{ id: 'ping', type: 'apiRequest', method: 'GET', path: '/api/health', expectStatus: 200 }],
        }),
      ),
    ).toEqual(['step ping: only the status 200 is checked; nothing reads what the request did']);
  });
});
