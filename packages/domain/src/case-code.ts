// ADR-0021: a stable, human code per case (`BKG-010`), the way a team quotes cases in questions,
// bug reports and a regression table. The prefix comes from the case's module; the sequence is
// assigned per project when the case is created and never reused.

const FALLBACK_PREFIX = 'CASE';

/** The module's first word, ASCII letters and digits only, upper-cased, 2–6 characters. */
export function caseCodePrefix(module: string): string {
  const word = module
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .split(/[^A-Za-z0-9]+/)
    .find((w) => w.length >= 2);
  return word ? word.toUpperCase().slice(0, 6) : FALLBACK_PREFIX;
}

export function caseCode(prefix: string, sequence: number): string {
  return `${prefix}-${String(sequence).padStart(3, '0')}`;
}
