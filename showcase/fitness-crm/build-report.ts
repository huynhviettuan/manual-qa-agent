// Renders showcase/fitness-crm/results/report.html from results.json, findings.json, baseline.json and
// the suite definition, and writes results/suite.json for the Excel export (export_xlsx.py).
// Screenshots are referenced relatively (evidence/<case id>/<file>.png).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODULES, SUITE_NAME, TECHNIQUES, type SuiteCase } from './suite/index.ts';

const HERE = 'showcase/fitness-crm';
const r = JSON.parse(readFileSync(join(HERE, 'results', 'results.json'), 'utf8'));
const findings = JSON.parse(readFileSync(join(HERE, 'findings.json'), 'utf8'));
const base = JSON.parse(readFileSync(join(HERE, 'baseline.json'), 'utf8'));
/** Cases whose screenshots are shown in the report (failures are always shown). */
export const SHOWCASED = ['LEAD-18', 'CON-02', 'CON-12', 'RBAC-05B', 'MON-14'];

const esc = (v: unknown) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const cls = (s: string) =>
  ({ PASSED: 'ok', FAILED: 'bad', INCONCLUSIVE: 'warn', BLOCKED: 'warn', 'NOT DRAFTED': 'warn' })[s] ??
  'muted';
const pill = (text: string, c = cls(text)) =>
  `<span class="pill ${c}">${esc(text.replaceAll('_', ' ').toLowerCase())}</span>`;
const fmtMin = (m: number) => (m >= 90 ? `${(m / 60).toFixed(1)} h` : `${Math.round(m)} min`);
const sec = (ms: number) => (ms >= 90_000 ? `${(ms / 60000).toFixed(1)} min` : `${(ms / 1000).toFixed(1)} s`);

type Assertion = { stepId: string; expected: unknown; actual: unknown; passed: boolean | null };
type Item = {
  tc: string;
  status: string;
  reason: string | null;
  runId: string | null;
  durationMs: number | null;
  detail: null | {
    assertions: Assertion[];
    screenshots: string[];
    evidenceCount: number;
    triage: null | { suspectedCause: string; securitySensitive: boolean };
  };
};
type Run = {
  wallMs: number;
  pacingMs: number;
  executionMs: number;
  totals: Record<string, number>;
  items: Item[];
};
type CaseOut = {
  id: string;
  caseId?: string;
  agentRoute: string;
  agentAskedFirst: string | null;
  agentQuestion?: string | null;
  draftMs: number;
  sourceRefs?: string[];
  agentDraft?: { title: string; steps: Array<{ action: string; expected: string }> };
};
type Readiness = {
  story: string;
  criterion: string;
  route: string;
  sourceRefs: string[];
  question: string | null;
  followUp: string | null;
};

const live: boolean = r.ai.live;
const runs: Run[] = r.suiteRuns;
const run1 = runs[0]!;
const run2 = runs.at(-1)!;
const out = new Map<string, CaseOut>((r.cases as CaseOut[]).map((c) => [c.id, c]));
const readiness: Readiness[] = r.readiness;
const all: Array<SuiteCase & { module: string; moduleId: string }> = MODULES.flatMap((m) =>
  m.cases.map((c) => ({ ...c, module: m.name, moduleId: m.id })),
);
const itemOf = (run: Run, id: string) => run.items.find((i) => i.tc === id);
const drafted = (c: SuiteCase) => Boolean(out.get(c.id)?.caseId);
const typeOf = (c: SuiteCase) => (!drafted(c) ? 'NOT DRAFTED' : c.spec ? 'automated' : 'manual');
const statusOf = (c: SuiteCase, run = run2) =>
  drafted(c) && c.spec ? (itemOf(run, c.id)?.status ?? '—') : '—';
const automated = all.filter((c) => c.spec && drafted(c));
const manualLeft = all.length - automated.length;
const notDrafted = all.filter((c) => !drafted(c));
const count = (run: Run, s: string) => automated.filter((c) => statusOf(c, run) === s).length;
const failing = automated.filter((c) => ['FAILED', 'INCONCLUSIVE'].includes(statusOf(c)));
const repeatable = automated.every((c) => statusOf(c, run1) === statusOf(c, run2));
const differing = automated.filter((c) => statusOf(c, run1) !== statusOf(c, run2));

// --- Agent vs manual: the team's baseline; agent figures measured in this run.
const N = all.length;
const manualRunMin = N * base.minutesToRunCaseManually;
const agentManualMin = manualLeft * base.minutesToRunCaseManually;
const execMin = run2.executionMs / 60000;
const agentRunMin = agentManualMin + execMin;
const savedPerRunMin = manualRunMin - agentRunMin;
const perMonth = base.regressionRunsPerMonth;

function bars(
  rows: Array<{ label: string; parts: Array<{ value: number; cls: string; text: string }> }>,
  unit: string,
  fmt: (v: number) => string,
) {
  const max = Math.max(...rows.map((row) => row.parts.reduce((s, p) => s + p.value, 0)));
  const width = 660,
    left = 200,
    right = 80,
    barH = 22,
    gap = 12;
  const scale = (width - left - right) / max;
  const height = rows.length * (barH + gap) + 24;
  const body = rows
    .map((row, i) => {
      const y = 6 + i * (barH + gap);
      let x = left;
      const segs = row.parts
        .map((p) => {
          const w = p.value > 0 ? Math.max(p.value * scale, 2) : 0;
          const rect = `<rect x="${x.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="${barH}" class="${p.cls}"><title>${esc(p.text)}</title></rect>`;
          x += w;
          return rect;
        })
        .join('');
      const total = row.parts.reduce((s, p) => s + p.value, 0);
      return `<text x="${left - 10}" y="${y + barH / 2 + 4}" text-anchor="end" class="axis">${esc(row.label)}</text>${segs}<text x="${(x + 8).toFixed(1)}" y="${y + barH / 2 + 4}" class="val">${esc(fmt(total))}</text>`;
    })
    .join('');
  const ticks = [0, max / 2, max]
    .map(
      (t) =>
        `<text x="${(left + t * scale).toFixed(1)}" y="${height - 4}" text-anchor="middle" class="axis">${esc(fmt(t))}${unit}</text>`,
    )
    .join('');
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img">${body}${ticks}</svg>`;
}

const timeChart = bars(
  [
    {
      label: 'Manual (your baseline)',
      parts: [{ value: manualRunMin, cls: 'm', text: `${N} cases × ${base.minutesToRunCaseManually} min` }],
    },
    {
      label: 'With the agent',
      parts: [
        { value: agentManualMin, cls: 'm', text: `${manualLeft} cases still by hand` },
        {
          value: execMin,
          cls: 'a',
          text: `${automated.length} automated cases, measured ${sec(run2.executionMs)}`,
        },
      ],
    },
  ],
  '',
  fmtMin,
);
const techCounts = TECHNIQUES.map((t) => ({
  t,
  n: all.filter((c) => c.technique === t).length,
  a: automated.filter((c) => c.technique === t).length,
}));
const techChart = bars(
  techCounts.map(({ t, n, a }) => ({
    label: t,
    parts: [
      { value: a, cls: 'a', text: `${a} automated` },
      { value: n - a, cls: 'm', text: `${n - a} manual or not drafted` },
    ],
  })),
  '',
  (v) => String(Math.round(v)),
);

function screenshots(c: SuiteCase) {
  const d = itemOf(run2, c.id)?.detail;
  if (!d?.screenshots.length) return '';
  return `<div class="shots">${d.screenshots.map((s) => `<figure><img loading="lazy" src="evidence/${esc(c.id)}/${esc(s)}" alt="${esc(c.id)} ${esc(s)}"><figcaption>${esc(s)}</figcaption></figure>`).join('')}</div>`;
}
function assertionTable(c: SuiteCase) {
  const d = itemOf(run2, c.id)?.detail;
  return `<table class="mini"><thead><tr><th>Step</th><th>Expected</th><th>Observed</th><th></th></tr></thead><tbody>${(
    d?.assertions ?? []
  )
    .map(
      (a) =>
        `<tr><td><code>${esc(a.stepId)}</code></td><td>${esc(a.expected)}</td><td>${esc(String(a.actual ?? '').slice(0, 200))}</td><td>${a.passed === true ? pill('pass', 'ok') : a.passed === false ? pill('fail', 'bad') : pill('n/a', 'warn')}</td></tr>`,
    )
    .join('')}</tbody></table>`;
}
function caseRow(c: SuiteCase) {
  const t = typeOf(c);
  const res =
    c.spec && drafted(c)
      ? `${pill(statusOf(c, run1))} ${pill(statusOf(c, run2))}`
      : '<span class="dim">—</span>';
  const dur = itemOf(run2, c.id)?.durationMs;
  return `<tr><td class="mono">${esc(c.id)}</td><td>${esc(c.title)}</td><td>${esc(c.technique)}</td><td class="mono">${esc(c.priority)}</td><td class="mono">${esc(c.requirement.id)}</td><td>${t === 'automated' ? pill('automated', 'acc') : pill(t)}</td><td>${res}</td><td class="num">${dur ? sec(dur) : ''}</td></tr>`;
}
function designTable(d: { technique: string; title: string; columns: string[]; rows: string[][] }) {
  return `<div class="design"><p><b>${esc(d.title)}</b> ${pill(d.technique, 'acc')}</p><div class="tablebox"><table class="mini"><thead><tr>${d.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${d.rows.map((row) => `<tr>${row.map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`;
}

// Automation backlog: which missing capability keeps how many cases manual.
const backlog = new Map<string, SuiteCase[]>();
for (const c of all.filter((x) => !x.spec))
  backlog.set(c.manualReason ?? '', [...(backlog.get(c.manualReason ?? '') ?? []), c]);
const backlogRows = [...backlog.entries()].sort((a, b) => b[1].length - a[1].length);

const reqs = new Map<string, typeof all>();
for (const c of all) reqs.set(c.requirement.id, [...(reqs.get(c.requirement.id) ?? []), c]);

const example = out.get('CON-02') ?? out.get('LEAD-01');
const exampleDef = all.find((c) => c.id === example?.id);

const html = `<title>Gym CRM QA Showcase</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+Condensed:wght@500;600&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;1,400&display=swap">
<style>
/* Layout: one reading column of report sections; large tables live in collapsible, scrollable boxes. */
:root {
  --bg: #f6f7f5; --surface: #ffffff; --ink: #18211f; --muted: #5d6965; --line: #d9dfdc; --accent: #0f6b5c; --accent-bg: #ddefea;
  --ok: #1d7a43; --ok-bg: #e3f3e8; --bad: #b42318; --bad-bg: #fbe7e5; --warn: #9a5b00; --warn-bg: #fdf0d9; --mute-bg: #eceeed;
  --bar-manual: #9aa6a2; --bar-agent: #0f6b5c;
  --display: "IBM Plex Sans Condensed", "Arial Narrow", system-ui, sans-serif;
  --body: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, "Cascadia Mono", Consolas, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #101614; --surface: #17201d; --ink: #e4ebe8; --muted: #9aa8a3; --line: #2a3632; --accent: #5cc4ae; --accent-bg: #163a33;
  --ok: #6fd394; --ok-bg: #133022; --bad: #ff8a7d; --bad-bg: #3a1714; --warn: #f2b85c; --warn-bg: #36270f; --mute-bg: #24302c;
  --bar-manual: #5d6b67; --bar-agent: #5cc4ae; color-scheme: dark; } }
:root[data-theme="dark"] {
  --bg: #101614; --surface: #17201d; --ink: #e4ebe8; --muted: #9aa8a3; --line: #2a3632; --accent: #5cc4ae; --accent-bg: #163a33;
  --ok: #6fd394; --ok-bg: #133022; --bad: #ff8a7d; --bad-bg: #3a1714; --warn: #f2b85c; --warn-bg: #36270f; --mute-bg: #24302c;
  --bar-manual: #5d6b67; --bar-agent: #5cc4ae; color-scheme: dark; }
body { background: var(--bg); color: var(--ink); font: 15px/1.55 var(--body); }
.wrap { max-width: 1120px; margin: 0 auto; padding-block: 40px 64px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); display: grid; gap: 52px; }
h1, h2, h3 { font-family: var(--display); text-wrap: balance; margin: 0; line-height: 1.2; }
h1 { font-size: 2.2rem; font-weight: 600; } h2 { font-size: 1.5rem; font-weight: 600; } h3 { font-size: 1.1rem; font-weight: 600; }
p { margin: 0; max-width: 76ch; }
code, .mono { font-family: var(--mono); font-size: 0.84em; }
.eyebrow, .label { font-family: var(--mono); font-size: 0.72rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
.dim { color: var(--muted); font-size: 0.86rem; }
header.intro, section, .design { display: grid; gap: 14px; min-width: 0; }
nav.toc { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 0.9rem; } nav.toc a { color: var(--accent); }
.banner { border: 1px solid var(--warn); background: var(--warn-bg); padding: 12px 14px; border-radius: 6px; }
.banner.live { border-color: var(--ok); background: var(--ok-bg); }
.tally { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.tally div { background: var(--surface); border: 1px solid var(--line); border-radius: 6px; padding: 14px; display: grid; gap: 4px; align-content: start; }
.tally strong { font-family: var(--display); font-size: 1.8rem; font-variant-numeric: tabular-nums; line-height: 1; }
.tally span { color: var(--muted); font-size: 0.84rem; }
.pill { display: inline-block; font-family: var(--mono); font-size: 0.7rem; font-weight: 500; padding: 2px 8px; border-radius: 999px; white-space: nowrap; }
.pill.ok { background: var(--ok-bg); color: var(--ok); } .pill.bad { background: var(--bad-bg); color: var(--bad); }
.pill.warn { background: var(--warn-bg); color: var(--warn); } .pill.muted { background: var(--mute-bg); color: var(--muted); }
.pill.acc { background: var(--accent-bg); color: var(--accent); }
.tablebox { overflow-x: auto; background: var(--surface); border: 1px solid var(--line); border-radius: 8px; }
table { border-collapse: collapse; width: 100%; font-size: 0.85rem; }
th, td { text-align: left; vertical-align: top; padding: 7px 10px; border-bottom: 1px solid var(--line); }
th { font-family: var(--mono); font-size: 0.68rem; letter-spacing: 0.05em; text-transform: uppercase; color: var(--muted); font-weight: 500; white-space: nowrap; }
tr:last-child td { border-bottom: 0; }
td.num { font-variant-numeric: tabular-nums; white-space: nowrap; text-align: right; }
tr.total td { font-weight: 600; background: var(--bg); }
.mini { font-size: 0.8rem; } .mini td { overflow-wrap: anywhere; }
.chart { width: 100%; max-width: 700px; height: auto; display: block; }
.chart .m { fill: var(--bar-manual); } .chart .a { fill: var(--bar-agent); }
.chart .axis { fill: var(--muted); font: 12px var(--body); } .chart .val { fill: var(--ink); font: 600 13px var(--body); }
.legend { display: flex; gap: 16px; font-size: 0.84rem; color: var(--muted); flex-wrap: wrap; }
.legend i { display: inline-block; width: 12px; height: 12px; border-radius: 2px; vertical-align: -1px; margin-right: 6px; }
.legend .m { background: var(--bar-manual); } .legend .a { background: var(--bar-agent); }
.compare, .pair, .findings, .duo { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.compare > div, .pair > div { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 16px; display: grid; gap: 8px; align-content: start; min-width: 0; }
.compare ul { margin: 0; padding-left: 1.2em; display: grid; gap: 4px; font-size: 0.9rem; }
details.box { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 10px 14px; }
details.box > summary { cursor: pointer; font-weight: 600; }
details.box[open] > summary { margin-bottom: 12px; }
details.box .inner { display: grid; gap: 16px; }
details.box .tablebox { border: 0; border-radius: 0; }
.fail { background: var(--surface); border: 1px solid var(--line); border-left: 3px solid var(--bad); border-radius: 8px; padding: 14px; display: grid; gap: 10px; }
.shots { display: flex; gap: 10px; overflow-x: auto; padding: 6px 0 4px; }
.shots figure { margin: 0; flex: 0 0 280px; display: grid; gap: 4px; }
.shots img { width: 100%; border: 1px solid var(--line); border-radius: 4px; display: block; }
.shots figcaption { font-family: var(--mono); font-size: 0.68rem; color: var(--muted); }
.findings { gap: 24px; }
.findings ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
.findings li { display: grid; gap: 4px; padding-left: 12px; border-left: 2px solid var(--line); }
.findings li .pill { justify-self: start; } .findings li p { color: var(--muted); font-size: 0.88rem; }
.method { margin: 0; padding-left: 1.2em; display: grid; gap: 4px; max-width: 82ch; }
pre { margin: 0; background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 14px; overflow-x: auto; font: 0.78rem/1.5 var(--mono); white-space: pre; }
a { color: var(--accent); } a:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
@media (max-width: 860px) { .tally { grid-template-columns: repeat(2, minmax(0, 1fr)); } .findings, .compare, .pair, .duo { grid-template-columns: 1fr; } h1 { font-size: 1.7rem; } }
</style>
<main class="wrap">
  <header class="intro">
    <p class="eyebrow">Manual QA AI Agent · showcase · ${esc(r.generatedAt.slice(0, 10))}</p>
    <h1>Gym CRM QA Showcase</h1>
    <p>${esc(SUITE_NAME)}: ${N} test cases covering every documented Gym CRM module, designed with ${TECHNIQUES.length} manual test-design techniques and traced to ${reqs.size} requirements in the Gym CRM docs. The agent drafted each case from approved sources, QA revised it and a QA lead approved it. ${automated.length} cases run in a real browser against a separate copy of Gym CRM with its fictional <em>Demo Gym</em> data; verdicts come only from code assertions. The rest are managed as manual cases with the reason they are not automated.</p>
    <p class="banner ${live ? 'live' : ''}">${live ? `AI: live ${esc(r.ai.models.readiness)} (readiness) and ${esc(r.ai.models.draft)} (drafts).` : 'AI: keyless stand-in. Drafts, readiness verdicts and triage suggestions come from a simple deterministic heuristic, not a model. Test design, browser verdicts, the suite, the safety gates and the timing do not depend on the AI. A live Claude run will replace the AI parts.'}</p>
    <nav class="toc" aria-label="Sections"><a href="#summary">Summary</a><a href="#failures">Failures and defects</a><a href="#manual">Agent vs manual</a><a href="#coverage">Coverage</a><a href="#design">Test design</a><a href="#suite">Test suite</a><a href="#backlog">Automation backlog</a><a href="#trace">Traceability</a><a href="#drafting">Drafting</a><a href="#findings">Findings</a><a href="#gates">Safety</a><a href="#method">Method</a></nav>
  </header>

  <section id="summary" aria-labelledby="h-summary">
    <h2 id="h-summary">Summary</h2>
    <div class="tally">
      <div><strong>${N}</strong><span>test cases in ${MODULES.length} modules, ${reqs.size} requirements</span></div>
      <div><strong>${TECHNIQUES.length}</strong><span>design techniques, ${MODULES.reduce((s, m) => s + m.designs.length, 0)} design artifacts</span></div>
      <div><strong>${N - notDrafted.length}</strong><span>drafted by the agent and approved; ${notDrafted.length} sent back</span></div>
      <div><strong>${automated.length}</strong><span>automated (${Math.round((100 * automated.length) / N)}% of the suite)</span></div>
      <div><strong>${count(run2, 'PASSED')}</strong><span>automated cases passed (run 2)</span></div>
      <div><strong>${count(run2, 'FAILED') + count(run2, 'INCONCLUSIVE')}</strong><span>failed or inconclusive (run 2); ${repeatable ? 'both runs identical' : `${differing.length} differ between runs`}</span></div>
      <div><strong>${sec(run2.executionMs)}</strong><span>to execute the automated cases (by hand: ${fmtMin(automated.length * base.minutesToRunCaseManually)})</span></div>
      <div><strong>${fmtMin(savedPerRunMin)}</strong><span>saved per regression run on your numbers (${Math.round((100 * savedPerRunMin) / manualRunMin)}%)</span></div>
    </div>
  </section>

  <section id="failures" aria-labelledby="h-failures">
    <h2 id="h-failures">Failures and defects</h2>
    ${failing.length === 0 ? '<p>No automated case failed.</p>' : `<p>${failing.length} automated case(s) did not pass in run 2. Each is analysed below; a suggested cause is advisory and never changes the verdict.</p>`}
    ${failing
      .map((c) => {
        const it = itemOf(run2, c.id)!;
        return `<div class="fail"><p><span class="mono">${esc(c.id)}</span> <b>${esc(c.title)}</b> ${pill(it.status)} <span class="dim">${esc(it.reason)}</span></p><p class="dim">Requirement ${esc(c.requirement.id)}: ${esc(c.requirement.statement)}</p>${assertionTable(c)}${it.detail?.triage ? `<p class="dim">Suggested cause (${live ? 'model' : 'stand-in'}): ${esc(it.detail.triage.suspectedCause)}${it.detail.triage.securitySensitive ? ', security-sensitive' : ''}. A person confirms the cause before anything is filed.</p>` : ''}${screenshots(c)}</div>`;
      })
      .join('')}
  </section>

  <section id="manual" aria-labelledby="h-manual">
    <h2 id="h-manual">The agent compared with manual testing</h2>
    <p>Your team's baseline: <b>${base.minutesToWriteCase} min</b> to write a case, <b>${base.minutesToRunCaseManually} min</b> to run one by hand, regression <b>weekly</b> (${perMonth} runs a month). Agent figures are measured in this run; anything not measured is labeled.</p>
    <h3>Running the full regression suite</h3>
    ${timeChart}
    <div class="legend"><span><i class="m"></i>Run by hand</span><span><i class="a"></i>Automated by the agent (measured)</span></div>
    <div class="tablebox"><table><thead><tr><th></th><th>Manual</th><th>With the agent</th><th>Difference</th></tr></thead><tbody>
      <tr><td>Per regression run</td><td class="num">${fmtMin(manualRunMin)}</td><td class="num">${fmtMin(agentRunMin)}</td><td class="num">−${fmtMin(savedPerRunMin)}</td></tr>
      <tr><td>Per month (${perMonth} runs)</td><td class="num">${fmtMin(manualRunMin * perMonth)}</td><td class="num">${fmtMin(agentRunMin * perMonth)}</td><td class="num">−${fmtMin(savedPerRunMin * perMonth)}</td></tr>
      <tr><td>Per year</td><td class="num">${Math.round((manualRunMin * perMonth * 12) / 60)} h</td><td class="num">${Math.round((agentRunMin * perMonth * 12) / 60)} h</td><td class="num">−${Math.round((savedPerRunMin * perMonth * 12) / 60)} h</td></tr>
    </tbody></table></div>
    <p class="dim">The ${automated.length} automated cases took ${sec(run2.executionMs)} of browser time (sum of run durations, measured). Gym CRM limits sign-ins to 20 per minute, and each case signs in once, so the suite was paced: wall-clock ${sec(run2.wallMs)}, of which ${sec(run2.pacingMs)} was waiting. Reusing one session per role would remove the wait. The other ${manualLeft} cases are still run by hand at ${base.minutesToRunCaseManually} min each.</p>
    <h3>Writing the test cases</h3>
    <div class="tablebox"><table><thead><tr><th></th><th>Manual</th><th>With the agent</th></tr></thead><tbody>
      <tr><td>Design and write ${N} cases</td><td class="num">${fmtMin(N * base.minutesToWriteCase)}</td><td>Drafting: ${sec((r.cases as CaseOut[]).reduce((s, c) => s + c.draftMs, 0))} ${live ? '(measured)' : 'with the stand-in, not representative of a model'}. Test design (partitions, boundaries, tables, states) was done by QA, as it would be by hand.</td></tr>
      <tr><td>Review and correct drafts</td><td>Included above</td><td>Not measured. In this showcase QA rewrote every draft, so <b>no authoring saving is claimed</b> yet.</td></tr>
      <tr><td>Questions on requirements</td><td>Found while writing, if at all</td><td>Asked up front: ${readiness.filter((x) => x.route !== 'DRAFT_CREATED').length} of ${readiness.length} acceptance-criteria stories and ${notDrafted.length} of ${N} cases were sent back before testing.</td></tr>
    </tbody></table></div>
    <p class="dim">The one-time cost of writing the ${automated.length} executable specs was not timed. At ${fmtMin(savedPerRunMin)} saved per weekly run it pays back after <b>spec hours ÷ ${(savedPerRunMin / 60).toFixed(1)} h</b> weeks: at 20 min per spec (${((automated.length * 20) / 60).toFixed(0)} h), about ${Math.ceil((automated.length * 20) / savedPerRunMin)} weeks; at 45 min per spec, about ${Math.ceil((automated.length * 45) / savedPerRunMin)} weeks. Keeping specs current when the UI changes comes on top.</p>
    <div class="compare">
      <div><h3>Where the agent helps</h3><ul>
        <li>Executes ${automated.length} cases in ${sec(run2.executionMs)} with ${repeatable ? 'identical results in both runs' : 'the results shown'}.</li>
        <li>Evidence for every automated case: screenshots at each assertion, step and network logs, secrets masked.</li>
        <li>Traceability from ${reqs.size} requirements to cases to results, kept automatically.</li>
        <li>Boundary checks that people skip: the 1001-session preview defect was found this way.</li>
        <li>Unsafe actions stopped by policy (${r.gates.length} of ${r.gates.length}).</li>
      </ul></div>
      <div><h3>Where people are still needed</h3><ul>
        <li>${manualLeft} of ${N} cases stay manual; the backlog below shows which executor capability would automate how many.</li>
        <li>Test design itself: choosing partitions, boundaries and tables.</li>
        <li>Reviewing and approving every case and executable (second-person rule).</li>
        <li>Exploratory, visual and usability testing, and judging failure causes.</li>
      </ul></div>
    </div>
  </section>

  <section id="coverage" aria-labelledby="h-coverage">
    <h2 id="h-coverage">Coverage</h2>
    <div class="tablebox"><table><thead><tr><th>Module</th><th>Cases</th><th>Automated</th><th>Manual</th><th>Not drafted</th><th>Passed</th><th>Failed / inconclusive</th><th>Designs</th></tr></thead><tbody>
    ${MODULES.map((m) => {
      const cs = all.filter((c) => c.moduleId === m.id);
      const au = cs.filter((c) => c.spec && drafted(c));
      return `<tr><td>${esc(m.name)}</td><td class="num">${cs.length}</td><td class="num">${au.length}</td><td class="num">${cs.filter((c) => !c.spec && drafted(c)).length}</td><td class="num">${cs.filter((c) => !drafted(c)).length}</td><td class="num">${au.filter((c) => statusOf(c) === 'PASSED').length}</td><td class="num">${au.filter((c) => ['FAILED', 'INCONCLUSIVE'].includes(statusOf(c))).length}</td><td class="num">${m.designs.length}</td></tr>`;
    }).join('')}
    <tr class="total"><td>Total</td><td class="num">${N}</td><td class="num">${automated.length}</td><td class="num">${all.filter((c) => !c.spec && drafted(c)).length}</td><td class="num">${notDrafted.length}</td><td class="num">${count(run2, 'PASSED')}</td><td class="num">${failing.length}</td><td class="num">${MODULES.reduce((s, m) => s + m.designs.length, 0)}</td></tr>
    </tbody></table></div>
    <h3>Cases by design technique</h3>
    ${techChart}
    <div class="legend"><span><i class="a"></i>Automated</span><span><i class="m"></i>Manual or not drafted</span></div>
  </section>

  <section id="design" aria-labelledby="h-design">
    <h2 id="h-design">Test design</h2>
    <p>Each module's cases come from these artifacts. The last column of each table names the cases derived from it, so a reviewer can check that every partition, boundary, rule and transition is covered.</p>
    ${MODULES.map((m) => `<details class="box"><summary>${esc(m.name)} · ${m.designs.length} artifacts</summary><div class="inner">${m.designs.map(designTable).join('')}</div></details>`).join('')}
  </section>

  <section id="suite" aria-labelledby="h-suite">
    <h2 id="h-suite">Test suite</h2>
    <p>Managed in the agent as one suite with sections. Results show suite run 1 and run 2.</p>
    ${MODULES.map(
      (m) =>
        `<details class="box"><summary>${esc(m.name)} · ${m.cases.length} cases</summary><div class="tablebox"><table><thead><tr><th>Case</th><th>Title</th><th>Technique</th><th>Pri.</th><th>Req.</th><th>Type</th><th>Run 1 · Run 2</th><th>Time</th></tr></thead><tbody>${all
          .filter((c) => c.moduleId === m.id)
          .map(caseRow)
          .join('')}</tbody></table></div></details>`,
    ).join('')}
    <h3>Evidence samples</h3>
    ${SHOWCASED.map((id) => all.find((c) => c.id === id))
      .filter((c): c is (typeof all)[number] => Boolean(c && itemOf(run2, c.id)?.detail))
      .map(
        (c) =>
          `<details class="box"><summary><span class="mono">${esc(c.id)}</span> ${esc(c.title)} ${pill(statusOf(c))}</summary><div class="inner">${assertionTable(c)}${screenshots(c)}</div></details>`,
      )
      .join('')}
  </section>

  <section id="backlog" aria-labelledby="h-backlog">
    <h2 id="h-backlog">Automation backlog</h2>
    <p>Why the ${all.filter((c) => !c.spec).length} manual cases are manual, grouped by the missing capability or safety choice. The top rows are the executor features that would automate the most cases.</p>
    <div class="tablebox"><table><thead><tr><th>Reason</th><th>Cases</th><th>Examples</th></tr></thead><tbody>
    ${backlogRows
      .map(
        ([why, cs]) =>
          `<tr><td>${esc(why)}</td><td class="num">${cs.length}</td><td class="mono">${esc(
            cs
              .slice(0, 8)
              .map((c) => c.id)
              .join(', '),
          )}${cs.length > 8 ? ', …' : ''}</td></tr>`,
      )
      .join('')}
    </tbody></table></div>
    ${notDrafted.length ? `<p class="dim">Not drafted (${notDrafted.length}): ${notDrafted.map((c) => `${esc(c.id)} (${esc(out.get(c.id)?.agentQuestion ?? '')})`).join('; ')}</p>` : ''}
  </section>

  <section id="trace" aria-labelledby="h-trace">
    <h2 id="h-trace">Traceability</h2>
    <details class="box"><summary>${reqs.size} requirements → ${N} cases</summary><div class="tablebox"><table><thead><tr><th>Requirement</th><th>Cases</th><th>Results (run 2)</th></tr></thead><tbody>
    ${[...reqs.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([id, cs]) =>
          `<tr><td class="mono">${esc(id)}</td><td class="mono">${esc(cs.map((c) => c.id).join(', '))}</td><td>${cs.map((c) => (c.spec && drafted(c) ? pill(statusOf(c)) : pill(typeOf(c)))).join(' ')}</td></tr>`,
      )
      .join('')}
    </tbody></table></div></details>
  </section>

  <section id="drafting" aria-labelledby="h-drafting">
    <h2 id="h-drafting">How cases were drafted</h2>
    <p>Each case started as a story with one requirement. The agent retrieved approved sources (Gym CRM docs 05, 06, 09 and 14) and drafted a cited case or asked a question. QA revised the draft into the designed case, and a QA lead approved it. Every revision is kept.</p>
    ${
      example?.agentDraft && exampleDef
        ? `<div class="pair">
      <div><p class="label">Agent draft (${live ? 'model' : 'stand-in'}) · ${esc(example.id)}</p><p><b>${esc(example.agentDraft.title)}</b></p>${example.agentDraft.steps.map((s) => `<p>Do: ${esc(s.action)}<br>Expect: ${esc(s.expected)}</p>`).join('')}<p class="dim">Cites ${esc((example.sourceRefs ?? []).join(', '))}</p></div>
      <div><p class="label">Designed case, approved by the QA lead</p><p><b>${esc(exampleDef.id)} ${esc(exampleDef.title)}</b> ${pill(exampleDef.technique, 'acc')}</p>${exampleDef.steps.map((s) => `<p>Do: ${esc(s.action)}<br>Expect: ${esc(s.expected)}</p>`).join('')}</div>
    </div>`
        : ''
    }
    <details class="box"><summary>Requirements review: ${readiness.length - readiness.filter((x) => x.route !== 'DRAFT_CREATED').length} of ${readiness.length} acceptance criteria ready</summary><div class="tablebox"><table><thead><tr><th>Story</th><th>Criterion</th><th>Outcome</th><th>Sources cited or question</th></tr></thead><tbody>
    ${readiness.map((x) => `<tr><td class="mono">${esc(x.story)}</td><td>${esc(x.criterion)}</td><td>${x.route === 'DRAFT_CREATED' ? pill('ready', 'ok') : pill('sent back', 'warn')}</td><td class="dim">${esc(x.route === 'DRAFT_CREATED' ? x.sourceRefs.join(', ') : x.question)}</td></tr>`).join('')}
    </tbody></table></div></details>
  </section>

  <section id="findings" aria-labelledby="h-findings">
    <h2 id="h-findings">Findings</h2>
    <div class="findings">
      <div><p class="label">About Gym CRM</p><ul>${findings.product.map((f: { title: string; detail: string; kind: string }) => `<li><strong>${esc(f.title)}</strong> ${pill(f.kind, f.kind === 'Defect' ? 'bad' : f.kind === 'Confirmed' ? 'ok' : 'muted')}<p>${esc(f.detail)}</p></li>`).join('')}</ul></div>
      <div><p class="label">In the agent</p><ul>${findings.agent.map((f: { title: string; detail: string; status: string }) => `<li><strong>${esc(f.title)}</strong> ${pill(f.status, f.status === 'Open' ? 'warn' : 'ok')}<p>${esc(f.detail)}</p></li>`).join('')}</ul></div>
    </div>
  </section>

  <section id="gates" aria-labelledby="h-gates">
    <h2 id="h-gates">Safety gates and triage</h2>
    <div class="tablebox"><table><thead><tr><th>Attempt</th><th>Outcome</th></tr></thead><tbody>${r.gates.map((g: { gate: string; refused?: string; outcome?: { status: string; reason: string } }) => (g.refused ? `<tr><td>${esc(g.gate)}</td><td>${pill('refused', 'ok')} <code>${esc(g.refused.split('\n')[0])}</code></td></tr>` : `<tr><td>${esc(g.gate)}</td><td>${pill(g.outcome!.status, g.outcome!.status === 'BLOCKED' ? 'ok' : 'bad')} <code>${esc(g.outcome!.reason)}</code></td></tr>`)).join('')}</tbody></table></div>
    ${r.staged ? `<p>A staged failure (${esc(r.staged.tc)} with a deliberately wrong expectation ${pill('staged', 'warn')}) was ${pill(r.staged.status)}; suggested cause ${esc(r.staged.triage?.suspectedCause ?? 'none')}. The cause is the test, so the suggestion is wrong: suggestions never change verdicts, and nothing is filed until a person confirms the cause.</p>` : '<p class="dim">No staged failure was needed: real failures above show triage.</p>'}
  </section>

  <section id="method" aria-labelledby="h-method">
    <h2 id="h-method">Method and limits</h2>
    <ul class="dim method">
      <li>Target: a separate Gym CRM instance (own database and ports), seeded with <code>pnpm db:seed:demo</code>; the developer's own instance was not touched.</li>
      <li>Expected results come from the Gym CRM requirements (docs 05, 06, 09, 14 and decisions), not from the product's behaviour. Where they disagreed, the code was read before calling it a defect.</li>
      <li>Valid boundary values on the lead form are checked without saving (the form is submitted without a channel, so only the channel error may appear), so reruns never collide with earlier data.</li>
      <li>Cases and executable steps were written by Claude Code acting as the QA engineer and approved in the agent by a different user acting as QA lead. Browser locale pinned to en-US.</li>
      <li>${r.metrics.decisions.total} AI decisions and ${(r.metrics.tokens.input + r.metrics.tokens.output).toLocaleString('en-US')} tokens recorded (${live ? 'billed' : 'counted by the stand-in; nothing billed'}).</li>
      <li>The suite is also exported as an Excel workbook for testers (one sheet per module, traceability, test design, live summary formulas): <code>showcase/fitness-crm/results/gym-crm-test-suite.xlsx</code>.</li>
    </ul>
  </section>
</main>
`;
writeFileSync(join(HERE, 'results', 'report.html'), html);
// The suite's structure for the Excel export (export_xlsx.py): modules, design artifacts, cases.
writeFileSync(
  join(HERE, 'results', 'suite.json'),
  JSON.stringify(
    {
      name: SUITE_NAME,
      modules: MODULES.map((m) => ({
        id: m.id,
        name: m.name,
        designs: m.designs,
        cases: m.cases.map(({ spec, ...c }) => ({ ...c, automated: Boolean(spec) })),
      })),
    },
    null,
    2,
  ) + '\n',
);
console.error(`wrote ${join(HERE, 'results', 'report.html')} and suite.json`);
