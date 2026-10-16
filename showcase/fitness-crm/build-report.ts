// Renders showcase/fitness-crm/results/report.html from results.json, findings.json and the specs.
// Screenshots are referenced relatively (evidence/<run>/<file>.png) and published next to the page.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const HERE = 'showcase/fitness-crm';
const r = JSON.parse(readFileSync(join(HERE, 'results', 'results.json'), 'utf8'));
const findings = JSON.parse(readFileSync(join(HERE, 'findings.json'), 'utf8'));
const specs: Record<string, { steps: Array<Record<string, unknown>> }> = Object.fromEntries(
  readdirSync(join(HERE, 'specs')).map((f) => [
    f.replace('.json', ''),
    JSON.parse(readFileSync(join(HERE, 'specs', f), 'utf8')).spec,
  ]),
);

const esc = (v: unknown) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const verdictClass = (s: string) =>
  ({ PASSED: 'ok', FAILED: 'bad', INCONCLUSIVE: 'warn', BLOCKED: 'warn' })[s] ?? 'muted';
const pill = (text: string, cls: string) => `<span class="pill ${cls}">${esc(text)}</span>`;

type Row = {
  story: string;
  followUp: string | null;
  ac: string;
  criterion: string;
  route: string;
  sourceRefs: string[];
  question: string | null;
  draft: { title: string; steps: Array<{ action: string; expected: string }> } | null;
};
type Run = {
  label: string;
  ac: string;
  status?: string;
  reason?: string;
  skipped?: string;
  error?: string;
  assertions?: Array<{ stepId: string; expected: unknown; actual: unknown; passed: boolean | null }>;
  evidence?: Array<{ kind: string; name: string }>;
  triage?: { suspectedCause: string; securitySensitive: boolean; rationale: string } | null;
  reproduction?: string | null;
};

const readiness: Row[] = r.readiness;
const runs: Run[] = r.runs;
const drafts = readiness.filter((x) => x.route === 'DRAFT_CREATED').length;
const asked = readiness.length - drafts;
const passed = runs.filter((x) => x.status === 'PASSED').length;
const gatesHeld = r.gates.filter(
  (g: { refused?: string; outcome?: { status?: string } }) => g.refused || g.outcome?.status === 'BLOCKED',
).length;
const live: boolean = r.ai.live;

function stepLabel(s: Record<string, unknown>): string {
  const t = s.target as Record<string, unknown> | undefined;
  const what = t ? String(t.name ?? t.label ?? t.text ?? t.role ?? '') : String(s.path ?? '');
  const value = typeof s.value === 'object' && s.value ? '[secret]' : s.value ? `"${s.value}"` : '';
  return `${s.type} ${what}${value ? ` ← ${value}` : ''}${s.text ? ` contains "${s.text}"` : ''}`;
}

function runCard(run: Run): string {
  const row =
    readiness.find((x) => x.ac === run.ac && x.route === 'DRAFT_CREATED') ??
    readiness.find((x) => x.ac === run.ac);
  const shots = (run.evidence ?? []).filter((e) => e.kind === 'screenshot');
  const status = run.status ?? (run.skipped ? 'NOT RUN' : 'ERROR');
  return `<article class="run">
  <header class="run-head">
    <div><p class="eyebrow">${esc(run.ac)} · ${esc(run.label)}</p><h3>${esc(row?.criterion ?? '')}</h3></div>
    ${pill(status, verdictClass(status))}
  </header>
  ${run.skipped || run.error ? `<p class="note">${esc(run.skipped ?? run.error)}</p>` : ''}
  <div class="run-body">
    <div class="col">
      <p class="label">Executable steps (approved by a second person)</p>
      <ol class="steps">${(specs[run.label]?.steps ?? []).map((s) => `<li><code>${esc(stepLabel(s))}</code></li>`).join('')}</ol>
    </div>
    <div class="col">
      <p class="label">Assertions (these decide the verdict)</p>
      <table class="mini"><thead><tr><th>Step</th><th>Expected</th><th>Observed</th><th></th></tr></thead><tbody>
      ${(run.assertions ?? []).map((a) => `<tr><td><code>${esc(a.stepId)}</code></td><td>${esc(a.expected)}</td><td>${esc(a.actual)}</td><td>${a.passed === true ? pill('pass', 'ok') : a.passed === false ? pill('fail', 'bad') : pill('n/a', 'warn')}</td></tr>`).join('')}
      </tbody></table>
    </div>
  </div>
  ${shots.length ? `<div class="shots" role="list">${shots.map((e) => `<figure role="listitem"><img loading="lazy" src="evidence/${esc(run.label)}/${esc(e.name)}" alt="Screenshot ${esc(e.name)} of ${esc(run.label)}"><figcaption>${esc(e.name)}</figcaption></figure>`).join('')}</div>` : ''}
</article>`;
}

const html = `<title>Gym CRM QA Showcase</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+Condensed:wght@500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>
/* Layout: a single reading column of report sections; runs as wide cards with a screenshot strip. */
:root {
  --bg: #f6f7f5; --surface: #ffffff; --ink: #18211f; --muted: #5d6965; --line: #d9dfdc; --accent: #0f6b5c;
  --ok: #1d7a43; --ok-bg: #e3f3e8; --bad: #b42318; --bad-bg: #fbe7e5; --warn: #9a5b00; --warn-bg: #fdf0d9;
  --mutedpill-bg: #eceeed;
  --display: "IBM Plex Sans Condensed", "Arial Narrow", system-ui, sans-serif;
  --body: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, "Cascadia Mono", Consolas, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #101614; --surface: #17201d; --ink: #e4ebe8; --muted: #9aa8a3; --line: #2a3632; --accent: #5cc4ae;
  --ok: #6fd394; --ok-bg: #133022; --bad: #ff8a7d; --bad-bg: #3a1714; --warn: #f2b85c; --warn-bg: #36270f; --mutedpill-bg: #24302c;
  color-scheme: dark; } }
:root[data-theme="dark"] {
  --bg: #101614; --surface: #17201d; --ink: #e4ebe8; --muted: #9aa8a3; --line: #2a3632; --accent: #5cc4ae;
  --ok: #6fd394; --ok-bg: #133022; --bad: #ff8a7d; --bad-bg: #3a1714; --warn: #f2b85c; --warn-bg: #36270f; --mutedpill-bg: #24302c;
  color-scheme: dark; }
body { background: var(--bg); color: var(--ink); font: 15px/1.55 var(--body); }
.wrap { max-width: 1080px; margin: 0 auto; padding-block: 40px 64px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); display: grid; gap: 48px; }
h1, h2, h3 { font-family: var(--display); text-wrap: balance; margin: 0; line-height: 1.2; }
h1 { font-size: 2.2rem; font-weight: 600; }
h2 { font-size: 1.45rem; font-weight: 600; }
h3 { font-size: 1.05rem; font-weight: 500; font-family: var(--body); }
p { margin: 0; max-width: 72ch; }
code, .mono { font-family: var(--mono); font-size: 0.85em; }
.eyebrow, .label { font-family: var(--mono); font-size: 0.72rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
section { display: grid; gap: 16px; }
.intro { display: grid; gap: 14px; }
.banner { border: 1px solid var(--warn); background: var(--warn-bg); color: var(--ink); padding: 12px 14px; border-radius: 6px; }
.banner.live { border-color: var(--ok); background: var(--ok-bg); }
.tally { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; }
.tally div { background: var(--surface); border: 1px solid var(--line); border-radius: 6px; padding: 14px; display: grid; gap: 4px; }
.tally strong { font-family: var(--display); font-size: 1.8rem; font-variant-numeric: tabular-nums; line-height: 1; }
.tally span { color: var(--muted); font-size: 0.88rem; }
.pill { display: inline-block; font-family: var(--mono); font-size: 0.72rem; font-weight: 500; padding: 2px 8px; border-radius: 999px; white-space: nowrap; }
.pill.ok { background: var(--ok-bg); color: var(--ok); } .pill.bad { background: var(--bad-bg); color: var(--bad); }
.pill.warn { background: var(--warn-bg); color: var(--warn); } .pill.muted { background: var(--mutedpill-bg); color: var(--muted); }
.run { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 18px; display: grid; gap: 14px; min-width: 0; }
.run-head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
.run-body { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
.col { min-width: 0; display: grid; gap: 8px; align-content: start; }
.steps { margin: 0; padding-left: 1.4em; display: grid; gap: 2px; font-size: 0.86rem; }
.steps code { overflow-wrap: anywhere; }
.note { color: var(--muted); }
.shots { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 6px; }
.shots figure { margin: 0; flex: 0 0 260px; display: grid; gap: 4px; }
.shots img { width: 100%; border: 1px solid var(--line); border-radius: 4px; display: block; }
.shots figcaption { font-family: var(--mono); font-size: 0.7rem; color: var(--muted); }
.tablebox { overflow-x: auto; background: var(--surface); border: 1px solid var(--line); border-radius: 8px; }
table { border-collapse: collapse; width: 100%; font-size: 0.86rem; }
th, td { text-align: left; vertical-align: top; padding: 8px 10px; border-bottom: 1px solid var(--line); }
th { font-family: var(--mono); font-size: 0.7rem; letter-spacing: 0.05em; text-transform: uppercase; color: var(--muted); font-weight: 500; }
tr:last-child td { border-bottom: 0; }
.mini { font-size: 0.82rem; } .mini td { overflow-wrap: anywhere; }
.readiness td:first-child { white-space: nowrap; font-family: var(--mono); font-size: 0.8rem; }
.readiness .crit { min-width: 260px; } .readiness .detail { color: var(--muted); min-width: 220px; }
.findings { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
.findings ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
.findings li { display: grid; gap: 4px; padding-left: 12px; border-left: 2px solid var(--line); }
.findings li strong { font-weight: 600; }
.findings li .pill { justify-self: start; }
.findings li p { color: var(--muted); font-size: 0.9rem; }
pre { margin: 0; background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 14px; overflow-x: auto; font: 0.8rem/1.5 var(--mono); white-space: pre; }
a { color: var(--accent); }
a:focus-visible, .shots:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
@media (max-width: 760px) { .run-body, .findings { grid-template-columns: 1fr; } h1 { font-size: 1.7rem; } }
</style>
<main class="wrap">
  <header class="intro">
    <p class="eyebrow">Manual QA AI Agent · showcase · ${esc(r.generatedAt.slice(0, 10))}</p>
    <h1>Gym CRM QA Showcase</h1>
    <p>The agent read the Gym CRM requirements (business rules BR-101 to BR-702, acceptance criteria AC-01 to AC-30, roles and permissions), judged which criteria are testable, drafted cited test cases, and ran approved tests in a real browser against a separate copy of Gym CRM with its fictional <em>Demo Gym</em> data. Verdicts come only from code assertions; every suggestion from the AI is labeled as one.</p>
    <p class="banner ${live ? 'live' : ''}">${
      live
        ? `AI: live ${esc(r.ai.models.readiness)} (readiness) and ${esc(r.ai.models.draft)} (drafts).`
        : 'AI: keyless stand-in. Readiness verdicts, drafts and triage suggestions below come from a simple deterministic heuristic, not a model, so read them as pipeline output, not AI judgment. Browser verdicts, safety gates and findings do not depend on the AI. A run with live Claude replaces these results.'
    }</p>
  </header>

  <section aria-labelledby="sum">
    <h2 id="sum">Summary</h2>
    <div class="tally">
      <div><strong>${readiness.length}</strong><span>stories checked for readiness (30 criteria + ${readiness.filter((x) => x.followUp).length} split follow-up)</span></div>
      <div><strong>${drafts}</strong><span>cited test drafts; ${asked} sent back to people</span></div>
      <div><strong>${passed} / ${runs.length}</strong><span>browser tests passed against Gym CRM</span></div>
      <div><strong>${gatesHeld} / ${r.gates.length}</strong><span>safety gates held</span></div>
    </div>
  </section>

  <section aria-labelledby="findings">
    <h2 id="findings">What the showcase found</h2>
    <div class="findings">
      <div><p class="label">In the agent (found and fixed during this showcase)</p><ul>${findings.agent.map((f: { title: string; detail: string; status: string }) => `<li><strong>${esc(f.title)}</strong> ${pill(f.status, 'ok')}<p>${esc(f.detail)}</p></li>`).join('')}</ul></div>
      <div><p class="label">About Gym CRM</p><ul>${findings.product.map((f: { title: string; detail: string; kind: string }) => `<li><strong>${esc(f.title)}</strong> ${pill(f.kind, 'muted')}<p>${esc(f.detail)}</p></li>`).join('')}</ul></div>
    </div>
  </section>

  <section aria-labelledby="runs">
    <h2 id="runs">Browser runs</h2>
    <p>Each test signs in through the real login page; the password is passed by reference and masked in screenshots. A QA engineer proposed the steps and a QA lead approved them before anything ran.</p>
    ${runs.map(runCard).join('\n')}
  </section>

  <section aria-labelledby="gates">
    <h2 id="gates">Safety gates</h2>
    <div class="tablebox"><table><thead><tr><th>Attempt</th><th>Outcome</th></tr></thead><tbody>
    ${r.gates.map((g: { gate: string; refused?: string; outcome?: { status: string; reason: string } }) => `<tr><td>${esc(g.gate)}</td><td>${g.refused ? `${pill('refused', 'ok')} <code>${esc(g.refused.split('\n')[0])}</code>` : `${pill(g.outcome!.status, g.outcome!.status === 'BLOCKED' ? 'ok' : 'bad')} <code>${esc(g.outcome!.reason)}</code>`}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="note">"Refused" and "BLOCKED" are the expected, safe outcomes here. The destructive run never started; it waits for a QA lead's approval tied to that exact action and environment.</p>
  </section>

  ${
    r.staged
      ? `<section aria-labelledby="triage">
    <h2 id="triage">Triage of a staged failure</h2>
    <p>All real tests passed, so one test was run with a deliberately wrong expectation to show what happens on failure. ${pill('STAGED', 'warn')}</p>
    <div class="tally">
      <div><strong>${esc(r.staged.status)}</strong><span>verdict, from the assertion (<code>${esc(r.staged.reason)}</code>)</span></div>
      <div><strong>${esc(r.staged.triage?.suspectedCause ?? 'none')}</strong><span>suggested cause (${live ? 'model' : 'stand-in heuristic'}); the true cause is a test issue</span></div>
    </div>
    <p>The suggestion is wrong, and that is the point of the design: a suggested cause never changes the verdict, and nothing is filed in Jira until a person confirms the cause and a QA lead approves the filing. The deterministic reproduction write-up below is built from the step log, with no model involved.</p>
    <pre>${esc(r.staged.reproduction ?? '')}</pre>
  </section>`
      : ''
  }

  <section aria-labelledby="ready">
    <h2 id="ready">Readiness of every acceptance criterion</h2>
    <div class="tablebox"><table class="readiness"><thead><tr><th>Story</th><th>Criterion</th><th>Outcome</th><th>Sources cited or question asked</th></tr></thead><tbody>
    ${readiness.map((x) => `<tr><td>${esc(x.story)}</td><td class="crit">${esc(x.criterion)}${x.followUp ? `<br><span class="note">${esc(x.followUp)}</span>` : ''}</td><td>${x.route === 'DRAFT_CREATED' ? pill('draft', 'ok') : pill('needs people', 'warn')}</td><td class="detail">${x.route === 'DRAFT_CREATED' ? esc(x.sourceRefs.join(', ')) : esc(x.question)}</td></tr>`).join('')}
    </tbody></table></div>
  </section>

  <section aria-labelledby="cost">
    <h2 id="cost">Audit and cost</h2>
    <div class="tally">
      <div><strong>${r.metrics.decisions.total}</strong><span>AI decisions recorded, each with model, prompt version and sources</span></div>
      <div><strong>${(r.metrics.tokens.input + r.metrics.tokens.output).toLocaleString('en-US')}</strong><span>tokens (${live ? 'billed' : 'counted by the stand-in; nothing billed'})</span></div>
      <div><strong>${Object.values(r.metrics.reviews.openByKind as Record<string, number>).reduce((a, b) => a + b, 0)}</strong><span>open reviews: ${esc(
        Object.entries(r.metrics.reviews.openByKind)
          .map(([k, v]) => `${v} ${k.toLowerCase().replaceAll('_', ' ')}`)
          .join(', '),
      )}</span></div>
    </div>
  </section>

  <footer class="note"><p>Reproduce: start a Gym CRM instance, then <code>QA_SECRET_GYM_PASSWORD=… pnpm showcase:gym</code> and <code>pnpm showcase:gym:report</code>. Sources, stories and specs are in <code>showcase/fitness-crm/</code> of the agent repository.</p></footer>
</main>
`;
writeFileSync(join(HERE, 'results', 'report.html'), html);
console.error(`wrote ${join(HERE, 'results', 'report.html')}`);
