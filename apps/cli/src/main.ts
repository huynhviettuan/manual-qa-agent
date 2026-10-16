import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import {
  createActor,
  createApiKey,
  createDbFromEnv,
  createProject,
  getActor,
  migrate,
  upsertEnvironment,
  type Db,
} from '@qa/db';
import { DomainError, EnvironmentKind, type Role } from '@qa/domain';
import { createEvidenceStoreFromEnv } from '@qa/evidence';
import { purgeExpiredEvidence } from '@qa/orchestrator';
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
          [--actions draft,execute] [--hosts host:port,...]
                                            Configure an execution environment (admin). Runs may
                                            only reach the base URL host plus --hosts
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
