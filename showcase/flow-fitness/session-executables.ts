// ADR-0024 through the session exchange (ADR-0020): the agent proposes executable steps for the
// imported Flow Fitness catalogue's API-level cases. Run it: it writes one request per case under
// results/executable-exchange/ and reports them pending; answer the requests in a Claude Code
// session; run it again: the answers go through the executable checks and become PROPOSED
// executables for a person to review. Writes results/executables.json.
// Usage: tsx showcase/flow-fitness/session-executables.ts [path to flow-fitness-qa] [limit=20]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createTestDb, listLatestCases, seedProject } from '../../packages/db/src/index.ts';
import { DraftContent } from '../../packages/domain/src/index.ts';
import { SessionExchangeProvider } from '../../packages/llm-adapter/src/index.ts';
import { importCases, proposeExecutableFromCase } from '../../packages/orchestrator/src/index.ts';
import { ingestSource } from '../../packages/retrieval/src/index.ts';

type Requirement = { id: string; kind: 'FR' | 'BR' | 'AC' | 'DEC' | 'NFR'; text: string; source: string };

const repo = process.argv[2] ?? 'D:/flow-fitness-qa';
const limit = Number(process.argv[3] ?? 20);
const HERE = 'showcase/flow-fitness';
const EXCHANGE = join(HERE, 'results', 'executable-exchange');
const { REQUIREMENTS } = (await import(pathToFileURL(join(repo, 'src/requirements/catalogue.ts')).href)) as {
  REQUIREMENTS: Requirement[];
};

const scope = { tenantId: 'showcase', projectId: 'flow-fitness' };
const db = await createTestDb();
const a = await seedProject(db, scope);
const KIND_TYPE = {
  FR: 'SPECIFICATION',
  BR: 'SPECIFICATION',
  AC: 'ACCEPTANCE_CRITERIA',
  DEC: 'SPECIFICATION',
  NFR: 'SPECIFICATION',
} as const;
for (const kind of ['FR', 'BR', 'AC', 'DEC', 'NFR'] as const) {
  const items = REQUIREMENTS.filter((r) => r.kind === kind);
  if (!items.length) continue;
  await ingestSource(db, a.po, {
    meta: {
      sourceId: `FF-${kind}`,
      version: 'v1',
      sourceType: KIND_TYPE[kind],
      trustTier: 'T1',
      approvalStatus: 'APPROVED',
      approvedBy: 'ff-po',
      owner: 'ff-po',
      ruleKeys: [],
      effectiveFrom: new Date('2026-10-27'),
    },
    body: items.map((r) => `## ${r.id}\n${r.text}\n\n(${r.source})`).join('\n\n'),
  });
}
await importCases(db, a.lead, {
  csv: await readFile(join(repo, 'docs/test-cases.csv'), 'utf8'),
  label: 'flow-fitness-2026-10-27',
  approve: true,
});

// What the environment offers, in words. Credentials are secrets the executor resolves; none here.
const HINTS = [
  'Sign in: POST /api/auth/sign-in/email with { email, password } sets a session cookie; roles: admin, fitness_manager, receptionist, consulting, pt, marketing, accountant (secrets FF_<ROLE>_EMAIL, FF_<ROLE>_PASSWORD).',
  'Admin sign-in also needs a TOTP code (secret FF_ADMIN_TOTP is not available to the executor): prefer other roles where the case allows.',
  'Every API path is under /api/v1; errors answer { code } with a product error code.',
];

const session = new SessionExchangeProvider({
  dir: EXCHANGE,
  modelLabel: 'claude-opus-5-5 (interactive Claude Code session)',
});
const cases = (await listLatestCases(db, scope))
  .map((c) => ({ c, d: DraftContent.parse(c.content) }))
  .filter(({ c, d }) => c.status === 'APPROVED' && d.level === 'api')
  .sort((x, y) => (x.c.code ?? '').localeCompare(y.c.code ?? ''))
  .slice(0, limit);

const results = [];
for (const { c, d } of cases) {
  const r = await proposeExecutableFromCase({ db, executables: session }, a.agent, c.caseId, HINTS);
  results.push({ code: c.code, title: d.title, ...r });
}
const pending = results.filter((r) => !r.proposed && r.failure === 'UNAVAILABLE').length;
const proposed = results.filter((r) => r.proposed);
await mkdir(join(HERE, 'results'), { recursive: true });
await writeFile(
  join(HERE, 'results', 'executables.json'),
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      promptVersion: 'exec-v1',
      cases: cases.length,
      pending,
      proposed: proposed.length,
      proposedWithoutFlags: proposed.filter((r) => r.proposed && r.reviewFlags.length === 0).length,
      refused: results.filter((r) => !r.proposed && r.failure === 'REFUSED').length,
      rejectedByChecks: results.filter((r) => !r.proposed && !['UNAVAILABLE', 'REFUSED'].includes(r.failure))
        .length,
      results,
    },
    null,
    2,
  )}\n`,
);
console.error(
  `${cases.length} API-level cases: ${pending} pending answers, ${proposed.length} proposed (${proposed.filter((r) => r.proposed && r.reviewFlags.length === 0).length} without flags)`,
);
await db.close();
