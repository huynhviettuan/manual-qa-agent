import { z } from 'zod';

// A tester's request to record a manual execution (ADR-0017); the status is derived in code.

export const ManualStepInput = z.object({
  status: z.enum(['PASSED', 'FAILED', 'BLOCKED', 'SKIPPED']),
  /** What was observed; required where the step failed or was blocked. */
  actual: z.string().max(4000).default(''),
});

export const ManualRunInput = z.object({
  caseId: z.string().min(1).max(100),
  environmentId: z.string().min(1).max(100),
  /** The build under test (commit, tag or version), so a result is never read against the wrong build. */
  build: z.string().max(200).default(''),
  /** When the case was executed as part of a suite run, its id; the suite report then shows the result. */
  suiteRunId: z.string().min(1).max(100).optional(),
  startedAt: z.coerce.date().optional(),
  finishedAt: z.coerce.date().optional(),
  steps: z.array(ManualStepInput).min(1).max(200),
  /** Why the case is blocked, when it is (environment, data, an open defect in the way). */
  reason: z.string().max(2000).default(''),
  notes: z.string().max(4000).default(''),
  /** A defect id in the team's tracker, when the failure was filed. */
  defectRef: z.string().max(200).optional(),
});
export type ManualRunInput = z.infer<typeof ManualRunInput>;
/** The request as a client sends it, before defaults are applied. */
export type ManualRunRequest = z.input<typeof ManualRunInput>;
