import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import {
  createActor,
  createApiKey,
  createDbFromEnv,
  assignMissingCaseCodes,
  createProject,
  getActor,
  migrate,
  upsertEnvironment,
  type Db,
} from '@qa/db';
import { DomainError, EnvironmentKind, type Role } from '@qa/domain';
import { createEvidenceStoreFromEnv } from '@qa/evidence';
import { importCases, purgeExpiredEvidence } from '@qa/orchestrator';
import { ingestDirectory, revokeSource } from '@qa/retrieval';
import { runEval } from './eval.ts';

const USAGE = `Usage: pnpm qa <command> [options]

  migrate                                   Apply database migrations
  seed    --tenant T --project P            Create a project, environments and one actor per role;
                                            prints freshly generated API keys once (dev/pilot only)
  ingest  <dir> --tenant T --project P --as ACTOR
                                            Ingest .md/.json source files as the given actor
  revoke  <sourceId@version> --tenant T --project P --as ACTOR
  eval    <fixturesDir>                     Run the labeled evaluation set (in-memory DB;
                                            mocked provider unless QA_LIVE_LLM=1)
  env     <id> --tenant T --project P --kind test|staging|production --base-url URL
          [--actions draft,execute] [--hosts host:port,...] [--preflight-case CASE_ID]
          [--sentinel-case CASE_ID] [--test-hooks /__test__/reset,...]
                                            Configure an execution environment (admin). Runs may
                                            only reach the base URL host plus --hosts; a suite
                                            run executes the preflight case first and blocks
                                            its automated runs unless it passes; the sentinel
                                            case is known to fail there, and a suite run that sees
                                            it pass is reported INCONCLUSIVE
  import  <file.csv> --label L --tenant T --project P --as ACTOR [--approve]
                                            Import a test-case workbook (the 20 export columns);
                                            prints what was imported, skipped and not mapped
  codes   --tenant T --project P            Give a code (MODULE-NNN) to cases created without one
  session                                   List the session-exchange requests still waiting for an
                                            answer (QA_LLM_PROVIDER=session, ADR-0026)
  purge-evidence                            Delete evidence past its retention

Database: DATABASE_URL, or an embedded PGlite database in ./.pglite when unset.`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    tenant: { type: 'string', default: 'local' },
    kind: { type: 'string' },
    'base-url': { type: 'string' },
    actions: { type: 'string', default: 'draft,execute' },
    hosts: { type: 'string', default: '' },
    project: { type: 'string', default: 'pilot' },
    as: { type: 'string' },
    label: { type: 'string' },
    'preflight-case': { type: 'string' },
    'sentinel-case': { type: 'string' },
    'test-hooks': { type: 'string', default: '' },
    approve: { type: 'boolean', default: false },
  },
});
const [command, arg] = positionals;

async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const db = await createDbFromEnv();
  try {
    await migrate(db);
    return await fn(db);
  } finally {
    await db.close();
  }
}

async function actorFor(db: Db) {
  if (!values.as) throw new DomainError('VALIDATION', '--as <actorId> is required');
  const actor = await getActor(db, { tenantId: values.tenant!, projectId: values.project! }, values.as);
  if (!actor)
    throw new DomainError('NOT_FOUND', `actor ${values.as} not found in ${values.tenant}/${values.project}`);
  return actor;
}

const ROLES: Record<string, Role[]> = {
  qa: ['QA_ENGINEER'],
  lead: ['QA_LEAD'],
  po: ['PRODUCT_OWNER'],
  admin: ['ADMIN'],
  // Propose-only identity for AI clients such as the agent tool server (ADR-0011).
  agent: ['AI_AGENT'],
};

try {
  switch (command) {
    case 'migrate': {
      const db = await createDbFromEnv();
      const applied = await migrate(db).finally(() => db.close());
      console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date');
      break;
    }
    case 'seed': {
      if (process.env.NODE_ENV === 'production')
        throw new DomainError('FORBIDDEN', 'seed is disabled in production');
      await withDb(async (db) => {
        const scope = { tenantId: values.tenant!, projectId: values.project! };
        await createProject(db, scope, scope.projectId);
        await upsertEnvironment(db, scope, {
          id: 'staging',
          kind: 'staging',
          allowedActions: ['draft', 'execute'],
        });
        await upsertEnvironment(db, scope, {
          id: 'production',
          kind: 'production',
          allowedActions: ['draft'],
        });
        console.log(
          `Seeded ${scope.tenantId}/${scope.projectId}. API keys (shown once; only hashes are stored):`,
        );
        for (const [name, roles] of Object.entries(ROLES)) {
          const id = `${scope.projectId}-${name}`;
          const key = `qa_${randomBytes(24).toString('base64url')}`;
          await createActor(db, scope, { id, name: id, roles });
          await createApiKey(db, id, key);
          console.log(`  ${id.padEnd(20)} ${roles.join(',').padEnd(14)} ${key}`);
        }
      });
      break;
    }
    case 'ingest': {
      if (!arg) throw new DomainError('VALIDATION', 'ingest needs a directory');
      await withDb(async (db) => {
        const results = await ingestDirectory(db, await actorFor(db), arg);
        for (const r of results) {
          console.log(
            `${r.status.padEnd(9)} ${`${r.sourceId}@${r.version}`.padEnd(32)} ${r.trusted ? 'trusted' : 'UNTRUSTED (T4)'} chunks=${r.chunks} redactions=${r.redactions}`,
          );
        }
      });
      break;
    }
    case 'import': {
      if (!arg) throw new DomainError('VALIDATION', 'import needs a CSV file');
      if (!values.label) throw new DomainError('VALIDATION', '--label is required');
      await withDb(async (db) => {
        const r = await importCases(db, await actorFor(db), {
          csv: await readFile(arg, 'utf8'),
          label: values.label!,
          approve: values.approve,
        });
        console.log(
          `${r.rows} rows: ${r.imported.length} imported as ${r.status}, ${r.skipped.length} skipped, ${r.rejected.length} rejected`,
        );
        for (const x of r.rejected) console.log(`  rejected row ${x.row}: ${x.reason}`);
        const top = (m: Record<string, number>) =>
          Object.entries(m)
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => `${k} (${v})`)
            .join(', ') || 'none';
        console.log(
          `  unresolved requirement ids: ${Object.keys(r.unresolvedRefs).length}: ${top(r.unresolvedRefs)}`,
        );
        console.log(`  unmapped techniques: ${top(r.unmappedTechniques)}`);
        console.log(`  unmapped test types: ${top(r.unmappedTestTypes)}`);
        console.log(`  expected results moved to the last step: ${r.expectedOnLastStep}`);
        console.log(`  execution results not imported: ${r.executionsIgnored}`);
      });
      break;
    }
    case 'session': {
      const { readdir, readFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const dir = process.env.QA_SESSION_EXCHANGE_DIR || './.session-exchange';
      const files = await readdir(dir).catch(() => [] as string[]);
      const pending = files.filter(
        (f) => f.endsWith('.request.json') && !files.includes(f.replace('.request.json', '.answer.json')),
      );
      for (const f of pending.sort()) {
        const req = JSON.parse(await readFile(join(dir, f), 'utf8')) as {
          kind: string;
          promptVersion: string;
          user: string;
        };
        const subject = /"(?:externalId|code|id)":\s*"([^"]+)"/.exec(req.user)?.[1] ?? '';
        console.log(
          `${req.kind.padEnd(11)} ${req.promptVersion.padEnd(13)} ${subject.padEnd(16)} ${f} -> write ${f.replace('.request.json', '.answer.json')}`,
        );
      }
      console.log(
        `${pending.length} request(s) waiting in ${dir}; answered ones are replayed on the next run`,
      );
      break;
    }
    case 'codes': {
      await withDb(async (db) => {
        const done = await assignMissingCaseCodes(db, {
          tenantId: values.tenant!,
          projectId: values.project!,
        });
        for (const c of done) console.log(`${c.code.padEnd(12)} ${c.caseId}`);
        console.log(`${done.length} cases given a code`);
      });
      break;
    }
    case 'revoke': {
      const [sourceId, version] = (arg ?? '').split('@');
      if (!sourceId || !version) throw new DomainError('VALIDATION', 'revoke needs <sourceId@version>');
      await withDb(async (db) => {
        console.log(
          (await revokeSource(db, await actorFor(db), sourceId, version))
            ? 'Revoked'
            : 'Not found or already revoked',
        );
      });
      break;
    }
    case 'env': {
      if (!arg) throw new DomainError('VALIDATION', 'env needs an environment id');
      const kind = EnvironmentKind.parse(values.kind);
      const baseUrl = values['base-url'] ? new URL(values['base-url']) : null;
      if (baseUrl && !['http:', 'https:'].includes(baseUrl.protocol)) {
        throw new DomainError('VALIDATION', '--base-url must be http(s)');
      }
      const actions = values
        .actions!.split(',')
        .map((a) => a.trim())
        .filter(Boolean);
      const hosts = [
        ...new Set([
          ...(baseUrl ? [baseUrl.host] : []),
          ...values
            .hosts!.split(',')
            .map((h) => h.trim())
            .filter(Boolean),
        ]),
      ];
      await withDb((db) =>
        upsertEnvironment(
          db,
          { tenantId: values.tenant!, projectId: values.project! },
          {
            id: arg,
            kind,
            allowedActions: actions,
            baseUrl: baseUrl?.origin ?? null,
            allowedHosts: hosts,
            preflightCaseId: values['preflight-case'] ?? null,
            sentinelCaseId: values['sentinel-case'] ?? null,
            testHookPaths: values['test-hooks']!.split(',')
              .map((p) => p.trim())
              .filter(Boolean),
          },
        ),
      );
      console.log(
        `Environment ${arg} (${kind}): ${baseUrl?.origin ?? 'no target'}; actions=${actions.join(',')}; hosts=${hosts.join(',') || '-'}`,
      );
      if (kind === 'production')
        console.log('Note: policy denies execution in production regardless of this configuration.');
      break;
    }
    case 'purge-evidence': {
      const purged = await withDb((db) => purgeExpiredEvidence(db, createEvidenceStoreFromEnv()));
      console.log(`Purged ${purged} expired evidence object(s)`);
      break;
    }
    case 'eval': {
      const report = await runEval(arg ?? 'eval/fixtures');
      if (!report.passedGates) process.exitCode = 1;
      break;
    }
    default:
      console.log(USAGE);
      if (command) process.exitCode = 1;
  }
} catch (err) {
  console.error(err instanceof DomainError ? `${err.code}: ${err.message}` : err);
  process.exitCode = 1;
}
