import { describe, expect, it } from 'vitest';
import { quoteFlags } from '../src/grounding.ts';

// ADR-0023: an expected result must be shown to follow from the cited text, by a verbatim quote.

const sources = [
  {
    sourceId: 'BR-404',
    version: 'v1',
    content:
      'A booking needs a session left; otherwise the message “Hết buổi” is shown and nothing is saved.',
  },
];

describe('quoteFlags', () => {
  it('accepts a quote from a cited source, up to whitespace, quote marks and case', () => {
    expect(
      quoteFlags(
        [
          {
            expected: 'Message "Hết buổi"',
            sourceRefs: ['BR-404@v1'],
            evidence: 'the message "Hết buổi" is shown',
          },
          { expected: 'Nothing is saved', sourceRefs: ['BR-404@v1'], evidence: 'NOTHING   is saved' },
        ],
        sources,
      ),
    ).toEqual([]);
  });

  it('flags a missing quote, a quote not in the text, and a quote from a source the step does not cite', () => {
    expect(
      quoteFlags(
        [
          { expected: 'Message "Hết buổi"', sourceRefs: ['BR-404@v1'] },
          { expected: 'Message "Hết buổi tập"', sourceRefs: ['BR-404@v1'], evidence: 'Hết buổi tập' },
          { expected: 'Nothing is saved', sourceRefs: ['BR-999@v1'], evidence: 'nothing is saved' },
        ],
        sources,
      ),
    ).toEqual([
      'step 1: no quoted evidence for "Message "Hết buổi""',
      'step 2: the quote "Hết buổi tập" is not in the cited sources',
      'step 3: the quote "nothing is saved" is not in the cited sources',
    ]);
  });
});
