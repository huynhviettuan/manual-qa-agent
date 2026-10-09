import { DomainError } from './errors.ts';

export const CASE_STATUSES = [
  'DRAFT',
  'NEEDS_CLARIFICATION',
  'IN_REVIEW',
  'APPROVED',
  'REJECTED',
  'RETIRED',
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const RUN_STATUSES = [
  'QUEUED',
  'POLICY_CHECK',
  'RUNNING',
  'PASSED',
  'FAILED',
  'BLOCKED',
  'INCONCLUSIVE',
  'CANCELLED',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const REVIEW_STATUSES = [
  'OPEN',
  'ASSIGNED',
  'NEEDS_INFO',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

type Machine<S extends string> = Readonly<Record<S, readonly S[]>>;

// Transitions from docs/03-workflows.md.
export const CASE_TRANSITIONS: Machine<CaseStatus> = {
  DRAFT: ['NEEDS_CLARIFICATION', 'IN_REVIEW'],
  NEEDS_CLARIFICATION: ['DRAFT'],
  IN_REVIEW: ['APPROVED', 'REJECTED'],
  APPROVED: ['RETIRED'],
  REJECTED: ['DRAFT'],
  RETIRED: [],
};

export const RUN_TRANSITIONS: Machine<RunStatus> = {
  QUEUED: ['POLICY_CHECK'],
  POLICY_CHECK: ['RUNNING', 'BLOCKED'],
  RUNNING: ['PASSED', 'FAILED', 'BLOCKED', 'INCONCLUSIVE', 'CANCELLED'],
  PASSED: [],
  FAILED: [],
  BLOCKED: [],
  INCONCLUSIVE: [],
  CANCELLED: [],
};

// OPEN -> ASSIGNED is the normal path; OPEN may also be resolved directly by an
// authorized reviewer (implicit self-assignment) or cancelled.
export const REVIEW_TRANSITIONS: Machine<ReviewStatus> = {
  OPEN: ['ASSIGNED', 'APPROVED', 'REJECTED', 'NEEDS_INFO', 'CANCELLED'],
  ASSIGNED: ['APPROVED', 'REJECTED', 'NEEDS_INFO', 'CANCELLED'],
  NEEDS_INFO: ['ASSIGNED', 'CANCELLED'],
  APPROVED: [],
  REJECTED: [],
  CANCELLED: [],
};

function transition<S extends string>(machine: Machine<S>, name: string, from: S, to: S): S {
  if (!machine[from].includes(to)) {
    throw new DomainError('ILLEGAL_TRANSITION', `${name}: ${from} -> ${to} is not allowed`);
  }
  return to;
}

export const transitionCase = (from: CaseStatus, to: CaseStatus) =>
  transition(CASE_TRANSITIONS, 'case', from, to);
export const transitionRun = (from: RunStatus, to: RunStatus) => transition(RUN_TRANSITIONS, 'run', from, to);
export const transitionReview = (from: ReviewStatus, to: ReviewStatus) =>
  transition(REVIEW_TRANSITIONS, 'review', from, to);
