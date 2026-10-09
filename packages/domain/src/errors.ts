export type DomainErrorCode =
  'ILLEGAL_TRANSITION' | 'VALIDATION' | 'NOT_FOUND' | 'FORBIDDEN' | 'CONFLICT' | 'IMMUTABLE';

/** Expected, typed failure surfaced to callers (API maps codes to HTTP statuses). */
export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
