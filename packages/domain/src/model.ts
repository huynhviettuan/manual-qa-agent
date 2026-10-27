import { z } from 'zod';

export const TrustTier = z.enum(['T1', 'T2', 'T3', 'T4']);
export type TrustTier = z.infer<typeof TrustTier>;

export const SourceType = z.enum([
  'ACCEPTANCE_CRITERIA',
  'SPECIFICATION',
  'TEST_CASE',
  'CLARIFICATION',
  'API_CONTRACT',
  'BUG_REPORT',
  'NOTE',
  /** The product's own terms, one per line (option lists, statuses, labels), for the observability check (ADR-0026). */
  'VOCABULARY',
]);
export type SourceType = z.infer<typeof SourceType>;

export const ApprovalStatus = z.enum(['APPROVED', 'UNAPPROVED']);
export type ApprovalStatus = z.infer<typeof ApprovalStatus>;

export const Role = z.enum(['QA_ENGINEER', 'QA_LEAD', 'PRODUCT_OWNER', 'ADMIN', 'AI_AGENT']);
export type Role = z.infer<typeof Role>;

export const EnvironmentKind = z.enum(['test', 'staging', 'production']);
export type EnvironmentKind = z.infer<typeof EnvironmentKind>;

export const Readiness = z.enum(['ready', 'clarification', 'blocked', 'other']);
export type Readiness = z.infer<typeof Readiness>;

/** Every read and write is scoped by the authenticated caller's tenant and project. */
export type TenantScope = { tenantId: string; projectId: string };

/** Server-resolved identity. Roles come from the database, never from the request body. */
export type Actor = {
  id: string;
  tenantId: string;
  projectId: string;
  roles: Role[];
};

export function hasRole(actor: Actor, ...roles: Role[]): boolean {
  return actor.roles.some((r) => roles.includes(r));
}

export const AcceptanceCriterion = z.object({
  id: z.string().min(1),
  text: z.string(),
});
export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterion>;

/** Test-design techniques a draft may name (ADR-0014); the list of the manual-test-design skill. */
export const TestTechnique = z.enum([
  'specification_based',
  'equivalence_partitioning',
  'boundary_value_analysis',
  'decision_table',
  'cause_effect',
  'state_transition',
  'use_case',
  'permission_matrix',
  'pairwise',
  'classification_tree',
  'domain',
  'syntax',
  'metamorphic',
  'scenario',
  'error_guessing',
  'exploratory',
  'checklist',
  'defect_based',
  'attack_based',
]);
export type TestTechnique = z.infer<typeof TestTechnique>;

export const TestType = z.enum([
  'positive',
  'negative',
  'boundary',
  'security',
  'concurrency',
  'end_to_end',
  'regression',
  'ui',
  'accessibility',
]);
export type TestType = z.infer<typeof TestType>;

export const CaseLevel = z.enum(['api', 'ui', 'manual']);
export type CaseLevel = z.infer<typeof CaseLevel>;

const stepOutput = z.object({
  action: z.string(),
  expected: z.string(),
  sourceRefs: z.array(z.string()),
  /** The concrete values this step uses, naming the partition or boundary each represents. */
  testData: z.string(),
  /** A verbatim quote from a cited source that the expected result follows from; "" when none (draft-v6, ADR-0025). */
  evidence: z.string(),
});
const draftFields = {
  title: z.string(),
  priority: z.enum(['P0', 'P1', 'P2', 'P3']),
  preconditions: z.array(z.string()),
  testData: z.array(z.string()),
  assumptions: z.array(z.string()),
  missingRequirements: z.array(z.string()),
};
const designFields = {
  /** Requirements this case verifies, as `story:<AC id>` or `sourceId@version`. */
  requirementRefs: z.array(z.string()),
  techniques: z.array(TestTechnique),
  testTypes: z.array(TestType),
  /** Conditions derived with the techniques: partitions, boundaries, rule columns, transitions. */
  testConditions: z.array(z.string()),
};
const managementFields = {
  /** The product area the case belongs to, as the sources name it. */
  module: z.string(),
  /** Where it could run: through the API, in a browser, or only by hand. */
  level: CaseLevel,
  /** Why it stays manual (empty when `level` is not `manual`). */
  manualReason: z.string(),
};

/**
 * What the model must emit for a draft (draft-v2 and later). Every field is required so it maps cleanly
 * onto provider structured-output schemas; business rules are checked in code (grounding.ts).
 */
export const DraftOutput = z.object({
  ...draftFields,
  steps: z.array(stepOutput),
  ...designFields,
  ...managementFields,
});
export type DraftOutput = z.infer<typeof DraftOutput>;

/**
 * Content of a test-case draft revision; also validates reviewer edits. Revisions written
 * before draft-v2 have no test-design fields, so those default to empty.
 */
export const DraftContent = z.object({
  ...draftFields,
  steps: z.array(
    stepOutput.extend({
      testData: z.string().default(''),
      /** A verbatim quote from a cited source that the expected result follows from (ADR-0023). */
      evidence: z.string().default(''),
    }),
  ),
  requirementRefs: designFields.requirementRefs.default([]),
  techniques: designFields.techniques.default([]),
  testTypes: designFields.testTypes.default([]),
  testConditions: designFields.testConditions.default([]),
  module: managementFields.module.default(''),
  level: managementFields.level.default('manual'),
  manualReason: managementFields.manualReason.default(''),
  /** `specified` when every expected result follows from the cited sources; otherwise `assumption` (see `assumptions`). */
  basis: z.enum(['specified', 'assumption']).default('specified'),
  /** Review ids of the open questions this case depends on; until answered it checks today's behaviour. */
  openQuestions: z.array(z.string()).default([]),
  /** Other references: customer feedback, defects, the product's own test ids. */
  refs: z.array(z.string()).default([]),
  /** Part of the per-pull-request smoke set (a QA decision, never the model's). */
  smoke: z.boolean().default(false),
  /** Problems found in code for the reviewer (for example an expected result that cannot be observed). */
  reviewFlags: z.array(z.string()).default([]),
});
export type DraftContent = z.infer<typeof DraftContent>;

/**
 * What the model emits for a story (ADR-0016): the set of cases its acceptance criteria need, one
 * per distinct test condition, with the design they were derived from. Bounded so a set stays
 * reviewable and inside one structured-output response.
 */
export const DraftSetOutput = z.object({
  /** The design in brief: partitions, boundaries, rule columns, states the cases come from. */
  designNotes: z.array(z.string()),
  cases: z.array(DraftOutput).min(1).max(12),
});
export type DraftSetOutput = z.infer<typeof DraftSetOutput>;

/** A checked set as the orchestrator stores it: one test case per entry; gaps are found in code. */
export type DraftSet = { designNotes: string[]; cases: DraftContent[]; coverageGaps: string[] };

export type EvidenceChunk = {
  sourceId: string;
  version: string;
  chunkId: string;
  content: string;
  trustTier: TrustTier;
  /** Retriever-specific ranking signal; not a correctness probability. */
  relevance: number;
};

/** `sourceId@version`, the citation format used in prompts, drafts and reviews. */
export function sourceRef(sourceId: string, version: string): string {
  return `${sourceId}@${version}`;
}

export type RetrievalResult = {
  status: 'OK' | 'NO_TRUSTED_CONTEXT';
  chunks: EvidenceChunk[];
  snapshotId: string;
  usedTokensEstimate: number;
  budgetExceeded: boolean;
  /** Requested identifiers that at least one selected trusted chunk references. */
  coveredIdentifiers: string[];
  gaps: string[];
  contradictions: Array<{ first: string; second: string; ruleKey: string }>;
};

export type NextAction =
  | { type: 'GENERATE_DRAFT'; contextIds: string[] }
  | { type: 'EXECUTE_APPROVED'; caseId: string; approvalId?: string }
  | { type: 'REQUEST_REVIEW'; reason: string; sourceIds: string[] }
  | { type: 'STOP'; reason: string };

export type ActionKind = 'draft' | 'execute' | 'delete' | 'publish_bug';

export type ActionProposal = {
  workflowId: string;
  caseId?: string;
  actorId: string;
  projectId: string;
  environmentId: string;
  kind: ActionKind;
  parameters: Record<string, unknown>;
  knowledgeSnapshotId: string;
};
