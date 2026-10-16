// Builds the showcase's agent sources and stories from the Gym CRM documentation, verbatim.
// Usage: tsx showcase/fitness-crm/build-sources.ts [path to fitness-crm] (default D:/fitness-crm)
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const gym = process.argv[2] ?? 'D:/fitness-crm';
const here = 'showcase/fitness-crm';
const doc = (name: string) => readFileSync(join(gym, 'docs', name), 'utf8').replaceAll('\r\n', '\n');

const frontMatter = (sourceId: string, sourceType: string, productArea: string) =>
  [
    '---',
    `sourceId: ${sourceId}`,
    'version: v1',
    `sourceType: ${sourceType}`,
    'trustTier: T1',
    'approvalStatus: APPROVED',
    'approvedBy: gym-po',
    'owner: gym-po',
    `productArea: ${productArea}`,
    'effectiveFrom: 2026-01-01',
    '---',
    '',
  ].join('\n');

/** Splits a document into its `## ` sections: [heading, body]. */
function sections(md: string): Array<[string, string]> {
  return md
    .split(/^## /m)
    .slice(1)
    .map((s) => {
      const [heading, ...rest] = s.split('\n');
      return [heading!.trim(), rest.join('\n').trim()];
    });
}

const slug = (s: string) =>
  s
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** One `# BR-xxx` block per rule (verbatim), so retrieval returns single rules, not whole sections. */
function ruleBlocks(heading: string, body: string): string {
  const blocks: string[] = [];
  for (const line of body.split('\n')) {
    const rule = /^- \*\*(BR-\d+)\*\* (.*)$/.exec(line);
    if (rule) blocks.push(`# ${rule[1]} (${heading})\n${rule[2]}\n`);
    else if (line.trim() && blocks.length > 0) blocks[blocks.length - 1] += `${line.trim()}\n`;
  }
  return blocks.length > 0 ? blocks.join('\n') : `# Business rules: ${heading}\n\n${body}\n`;
}

/** Markdown tables become one block per row, each keeping the header so the row stays readable. */
function tableBlocks(heading: string, body: string): string {
  const rows: string[] = [];
  const prose: string[] = [];
  let header: string[] = [];
  for (const line of body.split('\n')) {
    if (!/^\|.*\|$/.test(line)) {
      header = [];
      if (line.trim()) prose.push(line);
    } else if (header.length === 0) header = [line];
    else if (/^\|[\s:|-]+\|$/.test(line)) header.push(line);
    else rows.push(`# ${heading}: ${line.split('|')[1]!.trim()}\n${header.join('\n')}\n${line}\n`);
  }
  const intro = prose.length > 0 ? [`# Roles and permissions: ${heading}\n\n${prose.join('\n')}\n`] : [];
  return [...intro, ...rows].join('\n');
}

rmSync(join(here, 'sources'), { recursive: true, force: true });
rmSync(join(here, 'stories'), { recursive: true, force: true });
mkdirSync(join(here, 'sources'), { recursive: true });
mkdirSync(join(here, 'stories'), { recursive: true });

// Business rules: one source per section. The "Status of the first brief's rules" section only maps
// old rule ids, some superseded, so it is not a rule source.
const ruleSections = sections(doc('05_BUSINESS_RULES.md')).filter(
  ([h]) => !h.startsWith('Status of the first brief'),
);
for (const [heading, body] of ruleSections) {
  const id = `GYM-BR-${slug(heading)}`;
  writeFileSync(
    join(here, 'sources', `${id.toLowerCase()}.md`),
    frontMatter(id, 'SPECIFICATION', 'gym-crm') + ruleBlocks(heading, body),
  );
}

// Acceptance criteria: the table rows become one `# AC-xx` block each (same text).
const rows = [...doc('14_ACCEPTANCE_CRITERIA.md').matchAll(/^\| (AC-\d+) \| (.+?) \| (.+?) \|$/gm)].map(
  ([, id, text, milestone]) => ({ id: id!, text: text!.trim(), milestone: milestone!.trim() }),
);
writeFileSync(
  join(here, 'sources', 'gym-acceptance-criteria.md'),
  frontMatter('GYM-AC', 'ACCEPTANCE_CRITERIA', 'gym-crm') +
    rows.map((r) => `# ${r.id}\n${r.text} (milestone ${r.milestone})\n`).join('\n'),
);

// Roles and permissions, without the superseded "Status of the first brief's model" section.
const rbac = sections(doc('09_RBAC.md')).filter(([h]) => !h.startsWith('Status of the first brief'));
writeFileSync(
  join(here, 'sources', 'gym-rbac.md'),
  frontMatter('GYM-RBAC', 'SPECIFICATION', 'gym-crm') + rbac.map(([h, b]) => tableBlocks(h, b)).join('\n'),
);

// One story per acceptance criterion, as a product team would file it.
for (const r of rows) {
  const story = {
    externalId: `GYM-${r.id}`,
    title: `Gym CRM ${r.id}`,
    description: `Acceptance criterion ${r.id} of the Gym CRM (milestone ${r.milestone}).`,
    acceptanceCriteria: [{ id: r.id, text: r.text }],
  };
  writeFileSync(join(here, 'stories', `${r.id.toLowerCase()}.json`), JSON.stringify(story, null, 2) + '\n');
}
console.error(`sources: ${ruleSections.length + 2}, stories: ${rows.length}`);
