// Whether an expected result can be checked by a tester. The readiness stand-in and the draft
// check share the base rules, so "measurable" means the same thing everywhere.

/** Quantifiers and judgements that leave the tester to decide what counts. */
export const VAGUE =
  /\b(quick(ly)?|fast|multiple|several|some|many|few|appropriate(ly)?|user[- ]friendly|reasonable|soon|large|small|etc)\b/i;

/** A number or a quoted message: the readiness rule for an acceptance criterion. */
export const MEASURABLE = /\d|"[^"]+"|'[^']+'|“[^”]+”|‘[^’]+’/;

/** A named state a tester can see without a number or a message (for expected results only). */
const OBSERVABLE_STATE =
  /\b(disabled|enabled|checked|unchecked|selected|empty|locked|unlocked|redirect(?:s|ed)? to|created|deleted|removed|unchanged|refused|rejected|accepted)\b/i;

/** Words that assert success without saying what is observed. */
const UNSPECIFIC = /\b(correctly|properly|successfully|as expected|works?|fine|ok(ay)?|normal(ly)?)\b/i;

/**
 * Why an expected result cannot be verified as written, or null when it can. A result needs an
 * exact message, value or state, and no word that leaves the judgement to the reader.
 */
export function unobservableExpectation(text: string): string | null {
  const t = text.trim();
  const quote = (s: string) => `"${s.length > 80 ? `${s.slice(0, 77)}...` : s}"`;
  if (t.length === 0) return 'the expected result is empty';
  const vague = VAGUE.exec(t) ?? UNSPECIFIC.exec(t);
  if (vague) return `the word "${vague[0]}" leaves the judgement to the tester in ${quote(t)}`;
  if (!MEASURABLE.test(t) && !OBSERVABLE_STATE.test(t)) {
    return `no exact message, value or state in ${quote(t)}`;
  }
  return null;
}
