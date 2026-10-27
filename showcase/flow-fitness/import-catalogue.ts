// ADR-0022 on real data: the Flow Fitness pilot's catalogue (376 cases designed and run by the
// team, docs/test-cases.csv of D:\flow-fitness-qa) imported into the agent as it is, against the
// pilot's own requirement catalogue registered as sources. Writes results/import-report.json and
// results/test-design.md (the agent's design document built from the imported records).
// Usage: tsx showcase/flow-fitness/import-catalogue.ts [path to flow-fitness-qa] (default D:/flow-fitness-qa)
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createTestDb, seedProject } from '../../packages/db/src/index.ts';
import {
  getCoverage,
  importCases,
  parseCsv,
  testDesignMarkdown,
} from '../../packages/orchestrator/src/index.ts';
import { ingestSource } from '../../packages/retrieval/src/index.ts';

type Requirement = { id: string; kind: 'FR' | 'BR' | 'AC' | 'DEC' | 'NFR'; text: string; source: string };

const repo = process.argv[2] ?? 'D:/flow-fitness-qa';
const HERE = 'showcase/flow-fitness';
const { REQUIREMENTS } = (await import(pathToFileURL(join(repo, 'src/requirements/catalogue.ts')).href)) as {
  REQUIREMENTS: Requirement[];
};

const scope = { tenantId: 'showcase', projectId: 'flow-fitness' };
const db = await createTestDb();
const a = await seedProject(db, scope);

// One approved source per requirement kind; each requirement is its own section, so its id is
// an identifier of its chunk and a case citing it resolves to that source.
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

const csv = await readFile(join(repo, 'docs/test-cases.csv'), 'utf8');
const started = Date.now();
const report = await importCases(db, a.qa, { csv, label: 'flow-fitness-2026-10-27', approve: true });
const ms = Date.now() - started;
const again = await importCases(db, a.qa, { csv, label: 'flow-fitness-2026-10-27', approve: true });
const coverage = await getCoverage(db, scope);
// Coverage counts an identifier as covered when any case cites its source; with one source per
// requirement kind that says little, so count the catalogue ids a case cites by name.
const [header, ...rows] = parseCsv(csv);
const refColumn = header!.indexOf('Requirement ID(s)');
const cited = new Set(rows.flatMap((r) => (r[refColumn] ?? '').split(',').map((x) => x.trim())));
const citedIds = REQUIREMENTS.filter((r) => cited.has(r.id)).map((r) => r.id);
const notCited = REQUIREMENTS.filter((r) => !cited.has(r.id)).map((r) => r.id);

const sorted = (m: Record<string, number>) =>
  Object.fromEntries(Object.entries(m).sort((x, y) => y[1] - x[1]));
await mkdir(join(HERE, 'results'), { recursive: true });
await writeFile(
  join(HERE, 'results', 'import-report.json'),
  `${JSON.stringify(
    {
      importedAt: new Date().toISOString(),
      catalogue: { requirements: REQUIREMENTS.length },
      import: {
        rows: report.rows,
        imported: report.imported.length,
        skipped: report.skipped.length,
        rejected: report.rejected,
        status: report.status,
        durationMs: ms,
        unresolvedRefs: sorted(report.unresolvedRefs),
        unmappedTechniques: sorted(report.unmappedTechniques),
        unmappedTestTypes: sorted(report.unmappedTestTypes),
        expectedOnLastStep: report.expectedOnLastStep,
        executionsIgnored: report.executionsIgnored,
      },
      reimport: { imported: again.imported.length, skipped: again.skipped.length },
      catalogueIds: { total: REQUIREMENTS.length, citedByName: citedIds.length, notCited },
      coverage: { totals: coverage.totals, identifiersNotReached: coverage.gaps.identifiers },
    },
    null,
    2,
  )}\n`,
);
await writeFile(join(HERE, 'results', 'test-design.md'), await testDesignMarkdown(db, scope, new Date()));
console.error(
  `${report.rows} rows: ${report.imported.length} imported, ${report.skipped.length} skipped, ${report.rejected.length} rejected in ${ms} ms; ` +
    `re-import: ${again.imported.length} imported, ${again.skipped.length} skipped`,
);
console.error(
  `unresolved ids: ${Object.keys(report.unresolvedRefs).length}; unmapped techniques: ${JSON.stringify(sorted(report.unmappedTechniques))}; ` +
    `catalogue ids cited by name ${citedIds.length}/${REQUIREMENTS.length} (not cited: ${notCited.join(', ') || 'none'})`,
);
await db.close();
