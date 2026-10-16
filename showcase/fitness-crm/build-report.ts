// Renders showcase/fitness-crm/results/report.html from results.json, findings.json, baseline.json and
// the suite definition. Screenshots are referenced relatively (evidence/<TC>/<file>.png).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CASES } from './suite-definition.ts';

const HERE = 'showcase/fitness-crm';
const r = JSON.parse(readFileSync(join(HERE, 'results', 'results.json'), 'utf8'));
const findings = JSON.parse(readFileSync(join(HERE, 'findings.json'), 'utf8'));
const base = JSON.parse(readFileSync(join(HERE, 'baseline.json'), 'utf8'));

const esc = (v: unknown) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const cls = (s: string) =>
  ({
    PASSED: 'ok',
    FAILED: 'bad',
    INCONCLUSIVE: 'warn',
    BLOCKED: 'warn',
    NOT_AUTOMATED: 'muted',
    'NOT DRAFTED': 'warn',
  })[s] ?? 'muted';
const pill = (text: string, c = cls(text)) =>
  `<span class="pill ${c}">${esc(text.replaceAll('_', ' ').toLowerCase())}</span>`;
const fmtMin = (m: number) => (m >= 90 ? `${(m / 60).toFixed(1)} h` : `${Math.round(m)} min`);
const sec = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

type Item = {
  tc: string;
  status: string;
  reason: string | null;
  durationMs: number | null;
  detail: null | {
    assertions: Array<{ stepId: string; expected: unknown; actual: unknown; passed: boolean | null }>;
    screenshots: string[];
    evidenceCount: number;
  };
};
type CaseOut = {
  id: string;
  section: string;
  priority: string;
  title: string;
  requirement: { id: string; statement: string };
  automated: boolean;
  manualReason: string | null;
  draftMs: number;
  tokens: number;
  agentRoute: string;
  agentAskedFirst: string | null;
  narrowedStatement: string | null;
  agentQuestion?: string | null;
  caseId?: string;
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
const cases: CaseOut[] = r.cases;
const readiness: Readiness[] = r.readiness;
const [run1, run2] = r.suiteRuns as Array<{ wallMs: number; totals: Record<string, number>; items: Item[] }>;
const itemOf = (run: { items: Item[] }, tc: string) => run.items.find((i) => i.tc === tc);
const statusOf = (c: CaseOut, run = run2!) =>
  !c.caseId ? 'NOT DRAFTED' : (itemOf(run, c.id)?.status ?? 'NOT_AUTOMATED');
const drafted = cases.filter((c) => c.caseId);
const automated = drafted.filter((c) => c.automated);
const asked = cases.filter((c) => !c.caseId);
const manualLeft = cases.length - automated.length; // manual by design plus cases the agent could not draft
const repeatable = automated.every((c) => statusOf(c, run1) === statusOf(c, run2));
const passedBoth = automated.filter(
  (c) => statusOf(c, run1) === 'PASSED' && statusOf(c, run2) === 'PASSED',
).length;
const sentBack = readiness.filter((x) => x.route !== 'DRAFT_CREATED').length;

// --- Agent vs manual: the team's baseline, with agent figures measured in this run.
const N = cases.length;
const manualAuthorMin = N * base.minutesToWriteCase;
const manualRunMin = N * base.minutesToRunCaseManually;
const agentRunManualMin = manualLeft * base.minutesToRunCaseManually;
const automatedRunMin = run2!.wallMs / 60000;
const agentRunMin = agentRunManualMin + automatedRunMin;
const savedPerRunMin = manualRunMin - agentRunMin;
const perMonth = base.regressionRunsPerMonth;
const draftMsTotal = cases.reduce((s, c) => s + c.draftMs, 0);

/** Horizontal stacked bars on one linear scale; labels name values the bars reach. */
function barChart(
  rows: Array<{ label: string; parts: Array<{ value: number; cls: string; text: string }> }>,
) {
  const max = Math.max(...rows.map((row) => row.parts.reduce((s, p) => s + p.value, 0)));
  const width = 640;
  const left = 170;
  const right = 70;
  const barH = 26;
  const gap = 18;
  const scale = (width - left - right) / max;
  const height = rows.length * (barH + gap) + 26;
  const ticks = [0, Math.round(max / 2), Math.round(max)];
  const bars = rows
    .map((row, i) => {
      const y = 8 + i * (barH + gap);
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
      return `<text x="${left - 10}" y="${y + barH / 2 + 4}" text-anchor="end" class="axis">${esc(row.label)}</text>${segs}<text x="${(x + 8).toFixed(1)}" y="${y + barH / 2 + 4}" class="val">${esc(fmtMin(total))}</text>`;
    })
    .join('');
  const axis = ticks
    .map(
      (t) =>
        `<text x="${(left + t * scale).toFixed(1)}" y="${height - 4}" text-anchor="middle" class="axis">${t} min</text>`,
    )
    .join('');
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Minutes per regression run, manual and with the agent">${bars}${axis}</svg>`;
}

const chart = barChart([
  {
    label: 'Manual (your baseline)',
    parts: [{ value: manualRunMin, cls: 'm', text: `${N} cases × ${base.minutesToRunCaseManually} min` }],
  },
  {
    label: 'With the agent',
    parts: [
      {
        value: agentRunManualMin,
        cls: 'm',
        text: `${manualLeft} cases still manual × ${base.minutesToRunCaseManually} min`,
      },
      {
        value: automatedRunMin,
        cls: 'a',
        text: `${automated.length} automated cases, measured ${sec(run2!.wallMs)}`,
      },
    ],
  },
]);

const sections = [...new Set(CASES.map((c) => c.section))];
const def = new Map(CASES.map((c) => [c.id, c]));

function stepLabel(s: Record<string, unknown>): string {
  const t = s.target as Record<string, unknown> | undefined;
  const what = t ? String(t.name ?? t.label ?? t.text ?? t.role ?? '') : String(s.path ?? '');
  const value = typeof s.value === 'object' && s.value ? '[secret]' : s.value ? `"${s.value}"` : '';
  return `${s.type} ${what}${value ? ` ← ${value}` : ''}${s.text ? ` contains "${s.text}"` : ''}`;
}

function typePill(c: CaseOut) {
  if (!c.caseId) return pill('NOT DRAFTED');
  return c.automated ? pill('automated', 'acc') : pill('manual', 'muted');
}

function caseRow(c: CaseOut) {
  const it = itemOf(run2!, c.id);
  const results =
    c.automated && c.caseId
      ? `${pill(statusOf(c, run1))} ${pill(statusOf(c, run2))}`
      : '<span class="dim">—</span>';
  return `<tr><td class="mono">${esc(c.id)}</td><td>${esc(c.title)}</td><td class="mono">${esc(c.priority)}</td><td class="mono">${esc(c.requirement.id)}</td><td>${typePill(c)}</td><td>${results}</td><td class="num">${it?.durationMs ? sec(it.durationMs) : ''}</td></tr>`;
}

function runCard(c: CaseOut) {
  const it = itemOf(run2!, c.id);
  const d = it?.detail;
  const spec = def.get(c.id)?.spec;
  const assertions = (d?.assertions ?? [])
    .map((a) => {
      const verdict =
        a.passed === true
          ? pill('pass', 'ok')
          : a.passed === false
            ? pill('fail', 'bad')
            : pill('n/a', 'warn');
      return `<tr><td><code>${esc(a.stepId)}</code></td><td>${esc(a.expected)}</td><td>${esc(String(a.actual ?? '').slice(0, 160))}</td><td>${verdict}</td></tr>`;
    })
    .join('');
  const shots = d?.screenshots.length
    ? `<div class="shots">${d.screenshots.map((s) => `<figure><img loading="lazy" src="evidence/${esc(c.id)}/${esc(s)}" alt="${esc(c.id)} screenshot ${esc(s)}"><figcaption>${esc(s)}</figcaption></figure>`).join('')}</div>`
    : '';
  return `<details class="run"><summary><span class="mono">${esc(c.id)}</span> ${esc(c.title)} ${pill(it?.status ?? 'NOT_AUTOMATED')}</summary>
  <div class="run-body">
    <div class="col"><p class="label">Executable steps</p><ol class="steps">${(spec?.steps ?? []).map((s) => `<li><code>${esc(stepLabel(s))}</code></li>`).join('')}</ol></div>
    <div class="col"><p class="label">Assertions (these decide the verdict)</p>
      <table class="mini"><thead><tr><th>Step</th><th>Expected</th><th>Observed</th><th></th></tr></thead><tbody>${assertions}</tbody></table>
      <p class="dim">${d?.evidenceCount ?? 0} evidence files stored (screenshots, step log, network log).</p></div>
  </div>${shots}
</details>`;
}

// Traceability: requirement -> cases and their latest result.
const reqs = new Map<string, CaseOut[]>();
for (const c of cases) reqs.set(c.requirement.id, [...(reqs.get(c.requirement.id) ?? []), c]);
const traceResult = (c: CaseOut) => pill(!c.caseId ? 'NOT DRAFTED' : c.automated ? statusOf(c) : 'manual');

const example = cases.find((c) => c.id === 'TC-01');
const askedFirst = cases.filter((c) => c.agentAskedFirst);

const gateRow = (g: { gate: string; refused?: string; outcome?: { status: string; reason: string } }) =>
  g.refused
    ? `<tr><td>${esc(g.gate)}</td><td>${pill('refused', 'ok')} <code>${esc(g.refused.split('\n')[0])}</code></td></tr>`
    : `<tr><td>${esc(g.gate)}</td><td>${pill(g.outcome!.status, g.outcome!.status === 'BLOCKED' ? 'ok' : 'bad')} <code>${esc(g.outcome!.reason)}</code></td></tr>`;

const html = `<title>Gym CRM QA Showcase</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+Condensed:wght@500;600&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;1,400&display=swap">
<style>
/* Layout: one reading column of report sections; wide tables scroll inside their own boxes. */
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
.wrap { max-width: 1100px; margin: 0 auto; padding-block: 40px 64px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); display: grid; gap: 52px; }
h1, h2, h3 { font-family: var(--display); text-wrap: balance; margin: 0; line-height: 1.2; }
h1 { font-size: 2.2rem; font-weight: 600; } h2 { font-size: 1.5rem; font-weight: 600; } h3 { font-size: 1.1rem; font-weight: 600; }
p { margin: 0; max-width: 74ch; }
code, .mono { font-family: var(--mono); font-size: 0.84em; }
.eyebrow, .label { font-family: var(--mono); font-size: 0.72rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
.dim { color: var(--muted); font-size: 0.86rem; }
header.intro { display: grid; gap: 14px; }
section { display: grid; gap: 16px; min-width: 0; }
nav.toc { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 0.9rem; }
nav.toc a { color: var(--accent); }
.banner { border: 1px solid var(--warn); background: var(--warn-bg); padding: 12px 14px; border-radius: 6px; }
.banner.live { border-color: var(--ok); background: var(--ok-bg); }
.tally { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.tally div { background: var(--surface); border: 1px solid var(--line); border-radius: 6px; padding: 14px; display: grid; gap: 4px; align-content: start; }
.tally strong { font-family: var(--display); font-size: 1.8rem; font-variant-numeric: tabular-nums; line-height: 1; }
.tally span { color: var(--muted); font-size: 0.86rem; }
.pill { display: inline-block; font-family: var(--mono); font-size: 0.7rem; font-weight: 500; padding: 2px 8px; border-radius: 999px; white-space: nowrap; }
.pill.ok { background: var(--ok-bg); color: var(--ok); } .pill.bad { background: var(--bad-bg); color: var(--bad); }
.pill.warn { background: var(--warn-bg); color: var(--warn); } .pill.muted { background: var(--mute-bg); color: var(--muted); }
.pill.acc { background: var(--accent-bg); color: var(--accent); }
.tablebox { overflow-x: auto; background: var(--surface); border: 1px solid var(--line); border-radius: 8px; }
table { border-collapse: collapse; width: 100%; font-size: 0.86rem; }
th, td { text-align: left; vertical-align: top; padding: 8px 10px; border-bottom: 1px solid var(--line); }
th { font-family: var(--mono); font-size: 0.68rem; letter-spacing: 0.05em; text-transform: uppercase; color: var(--muted); font-weight: 500; white-space: nowrap; }
tr:last-child td { border-bottom: 0; }
td.num { font-variant-numeric: tabular-nums; white-space: nowrap; text-align: right; }
tr.sect td { background: var(--bg); font-weight: 600; font-family: var(--display); }
.mini { font-size: 0.8rem; } .mini td { overflow-wrap: anywhere; }
.chart { width: 100%; max-width: 680px; height: auto; display: block; }
.chart .m { fill: var(--bar-manual); } .chart .a { fill: var(--bar-agent); }
.chart .axis { fill: var(--muted); font: 12px var(--body); } .chart .val { fill: var(--ink); font: 600 13px var(--body); }
.legend { display: flex; gap: 16px; font-size: 0.84rem; color: var(--muted); flex-wrap: wrap; }
.legend i { display: inline-block; width: 12px; height: 12px; border-radius: 2px; vertical-align: -1px; margin-right: 6px; }
.legend .m { background: var(--bar-manual); } .legend .a { background: var(--bar-agent); }
.compare, .pair, .findings, .run-body { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.compare > div, .pair > div { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 16px; display: grid; gap: 8px; align-content: start; min-width: 0; }
.pair > div { font-size: 0.88rem; }
.compare ul { margin: 0; padding-left: 1.2em; display: grid; gap: 4px; font-size: 0.9rem; }
details.run { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 10px 14px; }
details.run summary { cursor: pointer; }
details.run[open] summary { margin-bottom: 12px; }
.col { min-width: 0; display: grid; gap: 8px; align-content: start; }
.steps { margin: 0; padding-left: 1.4em; display: grid; gap: 2px; font-size: 0.84rem; } .steps code { overflow-wrap: anywhere; }
.shots { display: flex; gap: 10px; overflow-x: auto; padding: 10px 0 4px; }
.shots figure { margin: 0; flex: 0 0 280px; display: grid; gap: 4px; }
.shots img { width: 100%; border: 1px solid var(--line); border-radius: 4px; display: block; }
.shots figcaption { font-family: var(--mono); font-size: 0.68rem; color: var(--muted); }
.findings { gap: 24px; }
.findings ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
.findings li { display: grid; gap: 4px; padding-left: 12px; border-left: 2px solid var(--line); }
.findings li .pill { justify-self: start; } .findings li p { color: var(--muted); font-size: 0.88rem; }
.method { margin: 0; padding-left: 1.2em; display: grid; gap: 4px; max-width: 80ch; }
pre { margin: 0; background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 14px; overflow-x: auto; font: 0.78rem/1.5 var(--mono); white-space: pre; }
a { color: var(--accent); } a:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
@media (max-width: 760px) { .run-body, .findings, .compare, .pair { grid-template-columns: 1fr; } .tally { grid-template-columns: repeat(2, minmax(0, 1fr)); } h1 { font-size: 1.7rem; } }
</style>
<main class="wrap">
  <header class="intro">
    <p class="eyebrow">Manual QA AI Agent · showcase · ${esc(r.generatedAt.slice(0, 10))}</p>
    <h1>Gym CRM QA Showcase</h1>
    <p>A ${N}-case regression suite for the Gym CRM sample, built and run with the Manual QA AI Agent. Every case traces to a requirement in the Gym CRM docs. The agent drafted the cases, a QA engineer revised them and a QA lead approved them. ${automated.length} cases have executable steps, approved by a second person, and run in a real browser against a separate copy of Gym CRM with its fictional <em>Demo Gym</em> data. Verdicts come only from code assertions.</p>
    <p class="banner ${live ? 'live' : ''}">${
      live
        ? `AI: live ${esc(r.ai.models.readiness)} (readiness) and ${esc(r.ai.models.draft)} (drafts).`
        : 'AI: keyless stand-in. Drafts, readiness verdicts and triage suggestions come from a simple deterministic heuristic, not a model. Browser verdicts, the suite, the safety gates and the timing figures do not depend on the AI. A live Claude run will replace the AI parts.'
    }</p>
    <nav class="toc" aria-label="Sections"><a href="#summary">Summary</a><a href="#manual">Agent vs manual</a><a href="#suite">Test suite</a><a href="#trace">Traceability</a><a href="#runs">Run details</a><a href="#backlog">Manual cases</a><a href="#drafting">Drafting</a><a href="#findings">Findings</a><a href="#gates">Safety</a><a href="#method">Method</a></nav>
  </header>

  <section id="summary" aria-labelledby="h-summary">
    <h2 id="h-summary">Summary</h2>
    <div class="tally">
      <div><strong>${N}</strong><span>test cases written across ${sections.length} modules, covering ${reqs.size} requirements</span></div>
      <div><strong>${drafted.length}</strong><span>in the managed suite; ${asked.length} blocked at drafting (the agent asked)</span></div>
      <div><strong>${passedBoth} / ${automated.length}</strong><span>automated cases passed in both suite runs${repeatable ? ', with identical results' : ''}</span></div>
      <div><strong>${sec(run2!.wallMs)}</strong><span>to run the automated part, unattended (by hand: ${fmtMin(automated.length * base.minutesToRunCaseManually)})</span></div>
      <div><strong>${fmtMin(savedPerRunMin)}</strong><span>saved per regression run on your numbers (${Math.round((100 * savedPerRunMin) / manualRunMin)}%)</span></div>
      <div><strong>${r.gates.length} / ${r.gates.length}</strong><span>unsafe attempts stopped</span></div>
    </div>
  </section>

  <section id="manual" aria-labelledby="h-manual">
    <h2 id="h-manual">The agent compared with manual testing</h2>
    <p>Your team's baseline: <b>${base.minutesToWriteCase} min</b> to write a case, <b>${base.minutesToRunCaseManually} min</b> to run one by hand, regression <b>weekly</b> (${perMonth} runs a month). Agent figures are measured in this run. Anything not measured is labeled as such.</p>
    <h3>Running the regression suite</h3>
    ${chart}
    <div class="legend"><span><i class="m"></i>Run by hand</span><span><i class="a"></i>Automated by the agent (measured)</span></div>
    <div class="tablebox"><table><thead><tr><th></th><th>Manual</th><th>With the agent</th><th>Difference</th></tr></thead><tbody>
      <tr><td>Per regression run</td><td class="num">${fmtMin(manualRunMin)}</td><td class="num">${fmtMin(agentRunMin)}</td><td class="num">−${fmtMin(savedPerRunMin)}</td></tr>
      <tr><td>Per month (${perMonth} runs)</td><td class="num">${fmtMin(manualRunMin * perMonth)}</td><td class="num">${fmtMin(agentRunMin * perMonth)}</td><td class="num">−${fmtMin(savedPerRunMin * perMonth)}</td></tr>
      <tr><td>Per year</td><td class="num">${Math.round((manualRunMin * perMonth * 12) / 60)} h</td><td class="num">${Math.round((agentRunMin * perMonth * 12) / 60)} h</td><td class="num">−${Math.round((savedPerRunMin * perMonth * 12) / 60)} h</td></tr>
    </tbody></table></div>
    <p class="dim">The ${automated.length} automated cases ran in ${sec(run2!.wallMs)} (measured; the first run took ${sec(run1!.wallMs)}). The other ${manualLeft} cases (${N - asked.length - automated.length} manual by design and ${asked.length} the agent could not draft) are still run by hand at ${base.minutesToRunCaseManually} min each. Suite runs are spaced a minute apart because of Gym CRM's sign-in limit; that wait is not counted.</p>

    <h3>Writing the test cases</h3>
    <div class="tablebox"><table><thead><tr><th></th><th>Manual</th><th>With the agent</th></tr></thead><tbody>
      <tr><td>Draft ${N} cases</td><td class="num">${fmtMin(manualAuthorMin)}</td><td>${sec(draftMsTotal)} ${live ? '(measured)' : 'with the stand-in, which is not representative of a model'}</td></tr>
      <tr><td>Review and correct</td><td>Included above</td><td>Not measured. In this showcase QA rewrote every draft (see the example below), so <b>no authoring saving is claimed</b> yet.</td></tr>
      <tr><td>Requirement questions</td><td>Found while writing, if at all</td><td>Asked up front: ${sentBack} of ${readiness.length} requirement stories were sent back before any case was written.</td></tr>
    </tbody></table></div>
    <p class="dim">If reviewing an agent draft takes R minutes, writing costs ${N} × R instead of ${fmtMin(manualAuthorMin)}: ${[10, 15, 20].map((m) => `${m} min gives ${fmtMin(N * m)}`).join(', ')}. These are scenarios, not measurements; the live Claude run is needed to judge draft quality.</p>

    <h3>One-time cost of automation</h3>
    <p>Writing the ${automated.length} executable specs (exploring the UI, choosing locators, debugging) is a real cost that this showcase did not time. At ${fmtMin(savedPerRunMin)} saved per weekly run it pays back after <b>spec hours ÷ ${(savedPerRunMin / 60).toFixed(2)} h</b> weeks: at 30 min per spec (${(automated.length * 0.5).toFixed(1)} h) after about ${Math.ceil((automated.length * 30) / savedPerRunMin)} weeks, at 60 min per spec after about ${Math.ceil((automated.length * 60) / savedPerRunMin)} weeks. Keeping specs current when the UI changes comes on top.</p>

    <div class="compare">
      <div><h3>Where the agent helps</h3><ul>
        <li>The same verdict every run: ${repeatable ? 'both suite runs gave identical results' : 'see the suite table'}, with no tester fatigue.</li>
        <li>Evidence for every case: screenshots at each assertion, step and network logs, with secrets masked.</li>
        <li>Traceability from requirement to case to run result, kept automatically.</li>
        <li>Unsafe actions are stopped by policy, not by memory (${r.gates.length} of ${r.gates.length} here).</li>
        <li>Requirement gaps surface before testing starts.</li>
      </ul></div>
      <div><h3>Where people are still needed</h3><ul>
        <li>${manualLeft} of ${N} cases stay manual: date-relative booking flows, contract creation, money arithmetic.</li>
        <li>Reviewing and approving every case and every executable (the second-person rule).</li>
        <li>Exploratory testing and visual or usability judgement, which the agent does not attempt.</li>
        <li>Confirming failure causes: the agent's suggestion was wrong on the staged failure.</li>
        <li>Preparing sources and keeping specs current when the UI changes.</li>
      </ul></div>
    </div>
  </section>

  <section id="suite" aria-labelledby="h-suite">
    <h2 id="h-suite">Test suite: ${esc(r.suite.name)}</h2>
    <p>${esc(r.suite.description)} The suite is managed in the agent: each case has revisions, an approval status, its requirement references and, if automated, an approved executable. Results show suite run 1 and run 2.</p>
    <div class="tablebox"><table><thead><tr><th>Case</th><th>Title</th><th>Pri.</th><th>Req.</th><th>Type</th><th>Run 1 · Run 2</th><th>Time</th></tr></thead><tbody>
    ${sections
      .map(
        (s) =>
          `<tr class="sect"><td colspan="7">${esc(s)}</td></tr>${cases
            .filter((c) => c.section === s)
            .map(caseRow)
            .join('')}`,
      )
      .join('')}
    </tbody></table></div>
  </section>

  <section id="trace" aria-labelledby="h-trace">
    <h2 id="h-trace">Traceability matrix</h2>
    <div class="tablebox"><table><thead><tr><th>Requirement</th><th>Statement given to the agent</th><th>Cases</th><th>Latest result</th></tr></thead><tbody>
    ${[...reqs.entries()].map(([id, cs]) => `<tr><td class="mono">${esc(id)}</td><td>${esc(cs[0]!.requirement.statement)}</td><td class="mono">${cs.map((c) => esc(c.id)).join(', ')}</td><td>${cs.map(traceResult).join(' ')}</td></tr>`).join('')}
    </tbody></table></div>
  </section>

  <section id="runs" aria-labelledby="h-runs">
    <h2 id="h-runs">Run details</h2>
    <p>Suite run 2. Open a case to see its executable steps, the expected and observed value of each assertion, and the screenshot taken at each assertion.</p>
    ${automated.map(runCard).join('\n')}
  </section>

  <section id="backlog" aria-labelledby="h-backlog">
    <h2 id="h-backlog">Manual cases and why</h2>
    <div class="tablebox"><table><thead><tr><th>Case</th><th>Title</th><th>Why it is not automated</th></tr></thead><tbody>
    ${cases
      .filter((c) => !c.automated || !c.caseId)
      .map(
        (c) =>
          `<tr><td class="mono">${esc(c.id)}</td><td>${esc(c.title)}</td><td>${!c.caseId ? `The agent did not draft it: ${esc(c.agentQuestion ?? '')} (see Findings: keyword retrieval).` : esc(c.manualReason)}</td></tr>`,
      )
      .join('')}
    </tbody></table></div>
    <p class="dim">Most of these need an executor capability that does not exist yet: dates relative to today, or carrying a new record's id from one step to the next. Each would be a reviewed change under ADR-0008.</p>
  </section>

  <section id="drafting" aria-labelledby="h-drafting">
    <h2 id="h-drafting">How cases were drafted</h2>
    <p>Each case started as a story with one requirement. The agent retrieved approved sources and either drafted a cited case or asked a question. QA revised the draft and a QA lead approved it; every revision is kept.</p>
    ${
      example?.agentDraft
        ? `<div class="pair">
      <div><p class="label">Agent draft (${live ? 'model' : 'stand-in'}) · ${esc(example.id)}</p><p><b>${esc(example.agentDraft.title)}</b></p>${example.agentDraft.steps.map((s) => `<p>Do: ${esc(s.action)}<br>Expect: ${esc(s.expected)}</p>`).join('')}<p class="dim">Cites ${esc((example.sourceRefs ?? []).join(', '))}</p></div>
      <div><p class="label">After QA revision, approved by the QA lead</p><p><b>${esc(example.id)} ${esc(example.title)}</b></p>${(def.get(example.id)?.steps ?? []).map((s) => `<p>Do: ${esc(s.action)}<br>Expect: ${esc(s.expected)}</p>`).join('')}</div>
    </div>
    <p class="dim">${live ? 'Compare the draft with the reviewed case.' : "The stand-in's expected result is an unrelated rule (allowed sign-in hours). This is the kind of error the review step exists to catch."}</p>`
        : ''
    }
    ${
      askedFirst.length
        ? `<div class="tablebox"><table><thead><tr><th>Case</th><th>Agent asked</th><th>QA narrowed it to</th><th>Result</th></tr></thead><tbody>
    ${askedFirst.map((c) => `<tr><td class="mono">${esc(c.id)}</td><td>${esc(c.agentAskedFirst)}</td><td>${esc(c.narrowedStatement ?? '—')}</td><td>${c.caseId ? pill('drafted', 'ok') : pill('asked again', 'warn')}</td></tr>`).join('')}
    </tbody></table></div>`
        : ''
    }
    <h3>Requirements review</h3>
    <p>Before writing cases, the agent checked all 30 Gym CRM acceptance criteria plus one split follow-up: ${readiness.length - sentBack} were ready to test and ${sentBack} were sent back.</p>
    <div class="tablebox"><table><thead><tr><th>Story</th><th>Criterion</th><th>Outcome</th><th>Sources cited or question</th></tr></thead><tbody>
    ${readiness.map((x) => `<tr><td class="mono">${esc(x.story)}</td><td>${esc(x.criterion)}${x.followUp ? `<br><span class="dim">${esc(x.followUp)}</span>` : ''}</td><td>${x.route === 'DRAFT_CREATED' ? pill('ready', 'ok') : pill('sent back', 'warn')}</td><td class="dim">${esc(x.route === 'DRAFT_CREATED' ? x.sourceRefs.join(', ') : x.question)}</td></tr>`).join('')}
    </tbody></table></div>
  </section>

  <section id="findings" aria-labelledby="h-findings">
    <h2 id="h-findings">Findings</h2>
    <div class="findings">
      <div><p class="label">In the agent</p><ul>${findings.agent.map((f: { title: string; detail: string; status: string }) => `<li><strong>${esc(f.title)}</strong> ${pill(f.status, f.status === 'Open' ? 'warn' : 'ok')}<p>${esc(f.detail)}</p></li>`).join('')}</ul></div>
      <div><p class="label">About Gym CRM</p><ul>${findings.product.map((f: { title: string; detail: string; kind: string }) => `<li><strong>${esc(f.title)}</strong> ${pill(f.kind, f.kind === 'Confirmed' ? 'ok' : 'muted')}<p>${esc(f.detail)}</p></li>`).join('')}</ul></div>
    </div>
  </section>

  <section id="gates" aria-labelledby="h-gates">
    <h2 id="h-gates">Safety gates and triage</h2>
    <div class="tablebox"><table><thead><tr><th>Attempt</th><th>Outcome</th></tr></thead><tbody>${r.gates.map(gateRow).join('')}</tbody></table></div>
    ${
      r.staged
        ? `<p>All real cases passed, so ${esc(r.staged.tc)} was run once with a deliberately wrong expectation ${pill('staged', 'warn')}. Verdict: ${pill(r.staged.status)}, from the assertion. Suggested cause: <b>${esc(r.staged.triage?.suspectedCause ?? 'none')}</b> (${live ? 'model' : 'stand-in'}), which is wrong: the cause is the test. Suggestions never change verdicts, and nothing is filed until a person confirms the cause and a QA lead approves.</p>
    <pre>${esc(r.staged.reproduction ?? '')}</pre>`
        : ''
    }
  </section>

  <section id="method" aria-labelledby="h-method">
    <h2 id="h-method">Method and limits</h2>
    <ul class="dim method">
      <li>Target: a separate Gym CRM instance (its own database and ports), seeded with <code>pnpm db:seed:demo</code>. The developer's own instance was not touched.</li>
      <li>Sources: Gym CRM docs 05 (business rules), 14 (acceptance criteria) and 09 (roles), word for word, one block per rule; permission rows restated as "granted to" lists.</li>
      <li>Cases and executable steps were written by Claude Code acting as the QA engineer, checked against the real UI, and approved in the agent by a different user acting as QA lead.</li>
      <li>Each automated case signs in through the login page; the password is passed by reference and masked in screenshots. The browser locale is pinned to en-US.</li>
      <li>${r.metrics.decisions.total} AI decisions and ${(r.metrics.tokens.input + r.metrics.tokens.output).toLocaleString('en-US')} tokens were recorded (${live ? 'billed' : 'counted by the stand-in; nothing billed'}).</li>
      <li>Not covered: phone layouts, emails, check-in machines, reports other than the cash book case, and anything that needs a live model.</li>
    </ul>
    <p class="dim">Reproduce: start a Gym CRM instance, then <code>QA_SECRET_GYM_PASSWORD=… pnpm showcase:gym</code> and <code>pnpm showcase:gym:report</code> in the agent repository (<code>showcase/fitness-crm/</code>).</p>
  </section>
</main>
`;
writeFileSync(join(HERE, 'results', 'report.html'), html);
console.error(`wrote ${join(HERE, 'results', 'report.html')}`);
