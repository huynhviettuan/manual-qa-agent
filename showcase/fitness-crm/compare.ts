// The agent's session drafts (ADR-0020) against the team's designed cases on the same Gym CRM
// acceptance criteria. The pairing of conditions is a judgement, kept as data in
// comparison/condition-map.json with who made it; this script only checks that the pairing is
// complete (every team case and every agent case placed exactly once) and counts it.
// Writes results/comparison.json. Usage: tsx showcase/fitness-crm/compare.ts
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const HERE = 'showcase/fitness-crm';

type Group = {
  condition: string;
  team: string[];
  agent: string[];
  verdict: 'covered' | 'partial' | 'missed';
  statedInCriterion: boolean;
  note?: string;
};
type Extra = { case: string; statedInCriterion: boolean; note?: string };
type Map = {
  judge: string;
  method: string;
  drafted: Record<string, { groups: Group[]; extras: Extra[]; note?: string }>;
  clarified: Record<
    string,
    {
      team: Array<{ case: string; expectedVerifiable: boolean; note: string }>;
      clearClausesNotDrafted: string[];
    }
  >;
};
type Story = {
  criterion: string;
  route: string;
  drafts: Array<{ title: string }>;
  team: Array<{ id: string; title: string }>;
};

const map = JSON.parse(await readFile(join(HERE, 'comparison', 'condition-map.json'), 'utf8')) as Map;
const drafts = JSON.parse(await readFile(join(HERE, 'results', 'session-drafts.json'), 'utf8')) as {
  model: string;
  stories: Story[];
};

const problems: string[] = [];
const once = (what: string, expected: string[], placed: string[]) => {
  const count = new globalThis.Map<string, number>();
  for (const p of placed) count.set(p, (count.get(p) ?? 0) + 1);
  for (const e of expected)
    if ((count.get(e) ?? 0) !== 1) problems.push(`${what}: ${e} placed ${count.get(e) ?? 0} times`);
  for (const p of count.keys())
    if (!expected.includes(p)) problems.push(`${what}: ${p} is not a case of this criterion`);
};

const groups: Array<Group & { criterion: string }> = [];
const extras: Array<Extra & { criterion: string; title: string }> = [];
const clarified: Array<{
  criterion: string;
  teamCases: number;
  verifiable: number;
  clearClausesNotDrafted: string[];
}> = [];
for (const s of drafts.stories) {
  const teamIds = s.team.map((t) => t.id);
  if (s.route === 'DRAFT_CREATED') {
    const m = map.drafted[s.criterion];
    if (!m) {
      problems.push(`${s.criterion}: drafted but not in the map`);
      continue;
    }
    const agentIds = s.drafts.map((_, i) => `A${i + 1}`);
    once(
      `${s.criterion} team`,
      teamIds,
      m.groups.flatMap((g) => g.team),
    );
    once(`${s.criterion} agent`, agentIds, [
      ...m.groups.flatMap((g) => g.agent),
      ...m.extras.map((x) => x.case),
    ]);
    for (const g of m.groups) {
      if ((g.verdict === 'missed') !== (g.agent.length === 0))
        problems.push(`${s.criterion}: "${g.condition}" verdict and cases disagree`);
      groups.push({ ...g, criterion: s.criterion });
    }
    for (const x of m.extras)
      extras.push({ ...x, criterion: s.criterion, title: s.drafts[Number(x.case.slice(1)) - 1]!.title });
  } else {
    const m = map.clarified[s.criterion];
    if (!m) {
      problems.push(`${s.criterion}: clarified but not in the map`);
      continue;
    }
    once(
      `${s.criterion} team`,
      teamIds,
      m.team.map((t) => t.case),
    );
    clarified.push({
      criterion: s.criterion,
      teamCases: m.team.length,
      verifiable: m.team.filter((t) => t.expectedVerifiable).length,
      clearClausesNotDrafted: m.clearClausesNotDrafted,
    });
  }
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}

const by = (v: Group['verdict']) => groups.filter((g) => g.verdict === v);
const draftedStories = drafts.stories.filter((s) => s.route === 'DRAFT_CREATED');
const summary = {
  judge: map.judge,
  agentModel: drafts.model,
  drafted: {
    criteria: draftedStories.length,
    agentCases: draftedStories.reduce((n, s) => n + s.drafts.length, 0),
    teamCases: draftedStories.reduce((n, s) => n + s.team.length, 0),
    teamConditions: groups.length,
    covered: by('covered').length,
    partial: by('partial').length,
    missed: by('missed').length,
    missedStatedInCriterion: by('missed').filter((g) => g.statedInCriterion).length,
    agentExtraConditions: extras.length,
    agentExtrasStatedInCriterion: extras.filter((x) => x.statedInCriterion).length,
  },
  clarified: {
    criteria: clarified.length,
    teamCases: clarified.reduce((n, c) => n + c.teamCases, 0),
    teamCasesWithVerifiableExpectation: clarified.reduce((n, c) => n + c.verifiable, 0),
    criteriaWithClearClausesNotDrafted: clarified.filter((c) => c.clearClausesNotDrafted.length).length,
    clearClausesNotDrafted: clarified.reduce((n, c) => n + c.clearClausesNotDrafted.length, 0),
  },
};
await writeFile(
  join(HERE, 'results', 'comparison.json'),
  `${JSON.stringify(
    {
      summary,
      missed: by('missed').map(({ criterion, condition, team, statedInCriterion, note }) => ({
        criterion,
        condition,
        team,
        statedInCriterion,
        note,
      })),
      partial: by('partial').map(({ criterion, condition, agent, note }) => ({
        criterion,
        condition,
        agent,
        note,
      })),
      extras,
      clarified,
    },
    null,
    2,
  )}\n`,
);
// ADR-0023: a sample of the pairing for a person to check. Deterministic (every 4th group in
// criterion order), written once; the checker fills `agree` and `note`, and the file is kept.
const samplePath = join(HERE, 'comparison', 'spot-check.json');
const sample = groups
  .filter((_, i) => i % 4 === 0)
  .map((g) => ({
    criterion: g.criterion,
    condition: g.condition,
    team: g.team,
    agent: g.agent,
    verdict: g.verdict,
    agree: null as boolean | null,
    note: '',
  }));
try {
  await readFile(samplePath, 'utf8');
} catch {
  await writeFile(samplePath, `${JSON.stringify({ checker: '', checkedAt: '', sample }, null, 2)}\n`);
}
console.error(JSON.stringify(summary, null, 2));
