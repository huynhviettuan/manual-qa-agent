// Whether an expected result can be checked by a tester. The readiness stand-in and the draft
// check share the base rules, so "measurable" means the same thing everywhere.

/** Quantifiers and judgements that leave the tester to decide what counts. */
export const VAGUE =
  /\b(quick(ly)?|fast|multiple|several|some|many|few|appropriate(ly)?|user[- ]friendly|reasonable|soon|large|small|etc)\b/i;

/** A number or a quoted message: the readiness rule for an acceptance criterion. */
export const MEASURABLE = /\d|"[^"]+"|'[^']+'|“[^”]+”|‘[^’]+’/;

/** A named state a tester can see without a number or a message (for expected results only). */
const OBSERVABLE_STATE =
  /\b(disabled|enabled|checked|unchecked|selected|empty|locked|unlocked|redirect(?:s|ed)? to|created|deleted|removed|unchanged|refused|rejected|accepted|granted|denied|saved|required|hidden|read-only|inactive|active|archived|pending|approved|cancell?ed|expired)\b/i;

/**
 * An absence a tester can check: something named is not there or did not happen ("No edit action
 * is offered", "nothing is saved", "cannot be typed"). On the Gym CRM session drafts absences were
 * the commonest false flag (ADR-0022).
 */
const OBSERVABLE_ABSENCE =
  /\b(no|not|nothing|none|never|cannot|can't|neither|nor)\b[^.;]{0,80}?\b(shown|offered|listed|exists?|visible|saved|created|sent|changed|appears?|available|returned|requir(?:ed|ing)|typed|entered|edited|selected|reached|granted|allowed|possible)\b/i;

/**
 * A relation between things the tester can read: a value equal to another, a record that becomes
 * or goes to a named place, a recipient ("goes to Admin", "equals the new tier price",
 * "closing = opening + receipts - expenses").
 */
const OBSERVABLE_RELATION =
  /\b(equals?|equal to|the same|same as|matches|becomes|changes to|goes to|moves to|is sent to|receives?|greater than|less than|more than|fewer than|at least|at most|increases by|decreases by|belongs? to)\b|\s=\s/i;

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
  if (
    !MEASURABLE.test(t) &&
    !OBSERVABLE_STATE.test(t) &&
    !OBSERVABLE_ABSENCE.test(t) &&
    !OBSERVABLE_RELATION.test(t)
  ) {
    return `no exact message, value or state in ${quote(t)}`;
  }
  return null;
}
