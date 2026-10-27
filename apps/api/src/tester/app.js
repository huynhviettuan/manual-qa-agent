// The tester screen: a thin client over the API (ADR-0019). It holds the tester's own API key in
// sessionStorage for this tab only, sends it on every call, and never computes a verdict: the
// status shown is whatever the API derived from the recorded steps.
(() => {
  const app = document.getElementById('app');
  const who = document.getElementById('who');
  const signout = document.getElementById('signout');
  const KEY = 'qa.tester.apiKey';
  const state = { key: null, me: null };

  // ---- helpers
  const esc = (s) =>
    String(s ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
  const h = (strings, ...vals) => strings.map((s, i) => s + (i < vals.length ? vals[i] : '')).join('');
  const pill = (s) => `<span class="pill ${esc(s)}">${esc(s)}</span>`;
  const fmtDate = (d) => (d ? new Date(d).toLocaleString() : '');
  const el = (id) => document.getElementById(id);

  async function api(method, path, body, raw) {
    const res = await fetch(path, {
      method,
      headers: { 'x-api-key': state.key, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) {
      forget();
      throw new Error('The API key was not accepted.');
    }
    if (raw) return res;
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const issues = json.issues ? `: ${json.issues.map((i) => i.message).join('; ')}` : '';
      throw new Error(`${json.error ?? res.status}${json.message ? `: ${json.message}` : issues}`);
    }
    return json;
  }
  const latestRevision = (detail) => detail.revisions[detail.revisions.length - 1];

  function forget() {
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* storage unavailable (private window): the key lives only in memory */
    }
    state.key = null;
    state.me = null;
    who.textContent = '';
    signout.hidden = true;
    render();
  }
  signout.addEventListener('click', forget);

  // ---- views
  function viewKey(message) {
    app.innerHTML = h`
      <section class="card" aria-labelledby="h-key">
        <h2 id="h-key">Your API key</h2>
        <p class="muted">The key identifies you as the tester of record. It stays in this browser tab only and is sent with each request to this server.</p>
        ${message ? `<div class="error">${esc(message)}</div>` : ''}
        <form id="keyform">
          <label for="key">API key</label>
          <input id="key" type="password" autocomplete="off" required>
          <p><button type="submit">Continue</button></p>
        </form>
      </section>`;
    el('keyform').addEventListener('submit', async (e) => {
      e.preventDefault();
      state.key = el('key').value.trim();
      try {
        state.me = await api('GET', '/api/me');
        try {
          sessionStorage.setItem(KEY, state.key);
        } catch {
          /* storage unavailable (private window): the key lives only in memory */
        }
        who.textContent = `${state.me.actorId} · ${state.me.roles.join(', ')}`;
        signout.hidden = false;
        if (!location.hash || location.hash === '#/') location.hash = '#/suites';
        render();
      } catch (err) {
        state.key = null;
        viewKey(err.message);
      }
    });
  }

  async function viewSuites() {
    const { items } = await api('GET', '/api/suites');
    const runsBySuite = await Promise.all(
      items.map((s) => api('GET', `/api/suites/${s.id}/runs`).then((r) => r.items)),
    );
    app.innerHTML = h`
      <section class="card" aria-labelledby="h-suites">
        <h2 id="h-suites">Suite runs</h2>
        <p class="muted">Pick a run to execute its manual cases. Automated cases show their verdicts; manual cases await your record.</p>
        ${
          items.length === 0
            ? '<p>No suites yet. A QA engineer creates one with <code>POST /api/suites</code>.</p>'
            : items
                .map(
                  (s, i) => h`
          <h3>${esc(s.name)} <span class="muted">· ${s.caseCount} cases</span></h3>
          ${s.description ? `<p class="muted">${esc(s.description)}</p>` : ''}
          ${
            runsBySuite[i].length === 0
              ? '<p class="muted">No runs yet.</p>'
              : `<table><thead><tr><th>Run</th><th>Environment</th><th>Requested</th><th class="num">Manual pending</th><th class="num">Recorded</th></tr></thead><tbody>${runsBySuite[
                  i
                ]
                  .map(
                    (r) => h`<tr>
                  <td><a class="clickable" href="#/suite-runs/${esc(r.id)}">${esc(r.id)}</a></td>
                  <td>${esc(r.environmentId)}</td><td>${esc(fmtDate(r.createdAt))}</td>
                  <td class="num">${r.manualPending}</td><td class="num">${r.manualRecorded}</td></tr>`,
                  )
                  .join('')}</tbody></table>`
          }`,
                )
                .join('')
        }
      </section>`;
  }

  async function viewSuiteRun(id) {
    const r = await api('GET', `/api/suite-runs/${id}`);
    const t = r.totals;
    // ADR-0021: a known bug only labels the verdict; the verdict itself is what was recorded.
    // ADR-0023/0024 marks beside the verdict: never instead of it.
    const marks = (i) =>
      [
        i.failedOutsideKnownBug
          ? `<div class="flag">Failed outside known bug ${esc(i.knownBug)} (at step ${esc(i.failedStep || '?')})</div>`
          : '',
        i.knownBugUnbound && i.knownBug
          ? '<div class="muted">Known bug unbound: every failure counts as expected</div>'
          : '',
        i.unstable ? '<div class="flag">Unstable: verdicts differed on this environment and build</div>' : '',
        i.unproven ? '<div class="flag">Unproven: P0 result by hand with no evidence</div>' : '',
        i.rows
          ? `<div class="muted">Rows: ${i.rows.total - i.rows.failed} / ${i.rows.total} passed</div>`
          : '',
        i.assertions != null ? `<div class="muted">${i.assertions} assertion(s)</div>` : '',
      ].join('');
    const bugNote = (i) =>
      i.expectedFailure
        ? `<div class="flag">Expected: known bug ${esc(i.knownBug)}${i.knownBugUnbound ? '' : ` at step ${esc(i.failedStep || '?')}`}</div>`
        : i.retestNeeded
          ? `<div class="flag">Passed with known bug ${esc(i.knownBug)}: retest and clear the mark</div>`
          : i.knownBug
            ? `<div class="muted">Known bug ${esc(i.knownBug)}</div>`
            : '';
    const row = (i) => h`<tr>
      <td>${i.manualRunId || i.status === 'NOT_AUTOMATED' ? `<a class="clickable" href="#/execute/${esc(i.caseId)}?run=${esc(id)}">${esc(i.title)}</a>` : esc(i.title)}
        <div class="muted">${esc(i.code || i.caseId)} · ${esc(i.section)}</div></td>
      <td>${pill(i.status)}${i.testerId ? `<div class="muted">by ${esc(i.testerId)}</div>` : ''}${bugNote(i)}${marks(i)}</td>
      <td>${esc(i.reason ?? '')}</td>
      <td class="num">${i.durationMs == null ? '' : `${(i.durationMs / 1000).toFixed(1)} s`}</td></tr>`;
    app.innerHTML = h`
      <section class="card" aria-labelledby="h-run">
        <h2 id="h-run">Suite run ${esc(r.id)}</h2>
        <p class="muted">Environment <b>${esc(r.environmentId)}</b>${r.build ? ` · build <b>${esc(r.build)}</b>` : ''} · requested by ${esc(r.requestedBy)} on ${esc(fmtDate(r.createdAt))}</p>
        ${r.status === 'BLOCKED' ? `<div class="error">Blocked before anything ran: ${esc(r.reason)}. Fix the environment and request the run again.</div>` : ''}
        ${
          r.detection === 'NOT_PROVEN'
            ? '<div class="error">Inconclusive as a whole: the sentinel case passed, so this run was not shown to detect a failure. The verdicts below are as recorded.</div>'
            : r.detection === 'PROVEN'
              ? '<p class="ok">Detection proven: the sentinel case failed as it should.</p>'
              : r.detection === 'PENDING'
                ? '<p class="muted">Sentinel still running.</p>'
                : ''
        }
        ${r.preflight ? `<p class="muted">Preflight ${esc(r.preflight.caseId)}: ${pill(r.preflight.status)}${r.preflight.reason ? ` ${esc(r.preflight.reason)}` : ''}</p>` : ''}
        <p>${pill('PASSED')} ${t.passed} &nbsp; ${pill('FAILED')} ${t.failed}${t.expectedFailures ? ` <span class="muted">(${t.expectedFailures} on known bugs)</span>` : ''} &nbsp; ${pill('BLOCKED')} ${t.blocked} &nbsp; ${pill('INCONCLUSIVE')} ${t.inconclusive}
           &nbsp; <span class="pill NOT_AUTOMATED">manual pending</span> ${t.notAutomated} &nbsp; <span class="muted">recorded by hand: ${t.manualRecorded}</span>${t.retestNeeded ? ` &nbsp; <span class="flag">${t.retestNeeded} to retest (known bug passed)</span>` : ''}</p>
        <table><thead><tr><th>Case</th><th>Status</th><th>Reason</th><th class="num">Time</th></tr></thead>
          <tbody>${r.items.map(row).join('')}</tbody></table>
      </section>`;
  }

  async function viewExecute(caseId, suiteRunId) {
    const [detail, history] = await Promise.all([
      api('GET', `/api/test-cases/${caseId}`),
      api('GET', `/api/test-cases/${caseId}/manual-runs`).then((x) => x.items),
    ]);
    const rev = latestRevision(detail);
    const c = rev.content;
    const approved = rev.status === 'APPROVED';
    const choices = (i) =>
      ['PASSED', 'FAILED', 'BLOCKED', 'SKIPPED']
        .map(
          (s) =>
            h`<label><input type="radio" name="s${i}" value="${s}" ${s === 'PASSED' ? 'checked' : ''}> ${s.charAt(0) + s.slice(1).toLowerCase()}</label>`,
        )
        .join('');
    app.innerHTML = h`
      <section class="card" aria-labelledby="h-case">
        <p><a class="clickable" href="${suiteRunId ? `#/suite-runs/${esc(suiteRunId)}` : '#/suites'}">← back</a></p>
        <h2 id="h-case">${esc(c.title)}</h2>
        <p class="muted">${esc(detail.code || caseId)} · revision ${rev.revision} ${pill(rev.status)} · ${esc(c.priority)} · ${esc((c.techniques || []).join(', '))}
          ${c.module ? ` · ${esc(c.module)}` : ''} · ${esc(c.level || 'manual')}${c.manualReason ? ` (${esc(c.manualReason)})` : ''}</p>
        ${(c.reviewFlags || []).map((f) => `<p class="flag">⚑ ${esc(f)}</p>`).join('')}
        <form id="bugform" class="row" aria-label="Known bug">
          <div><label for="knownbug">Known bug (an open defect that blocks the expected result)</label>
            <input id="knownbug" type="text" placeholder="BUG-041" value="${esc(detail.knownBug || '')}"></div>
          <div><label for="bugsteps">Steps it breaks (numbers or step ids, comma-separated; empty = unbound)</label>
            <input id="bugsteps" type="text" placeholder="2" value="${esc((detail.knownBugSteps || []).join(', '))}"></div>
          <div><label>&nbsp;</label><button type="submit" class="secondary">${detail.knownBug ? 'Update' : 'Mark'}</button>
            ${detail.knownBug ? '<button type="button" id="clearbug" class="secondary">Clear</button>' : ''}</div>
          <div id="bugmsg"></div>
        </form>
        ${c.requirementRefs?.length ? `<p class="muted">Verifies: ${esc(c.requirementRefs.join(', '))}</p>` : ''}
        ${c.preconditions?.length ? `<h3>Preconditions</h3><ul>${c.preconditions.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
        ${c.testData?.length ? `<h3>Test data</h3><ul>${c.testData.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
        ${!approved ? `<div class="error">Only an APPROVED revision can be executed; this one is ${esc(rev.status)}.</div>` : ''}
        <form id="runform" ${approved ? '' : 'hidden'}>
          <h3>Steps</h3>
          ${c.steps
            .map(
              (s, i) => h`<div class="step">
            <div class="what"><div><b>${i + 1}. ${esc(s.action)}</b>${s.testData ? `<div class="muted">Data: ${esc(s.testData)}</div>` : ''}</div>
              <div><span class="muted">Expected:</span> ${esc(s.expected)}</div></div>
            <div class="choices">${choices(i)}</div>
            <label for="a${i}">Actual result (required when failed or blocked)</label>
            <textarea id="a${i}" placeholder="What you saw, exactly: message, value, state"></textarea>
          </div>`,
            )
            .join('')}
          <div class="row">
            <div><label for="env">Environment</label><input id="env" type="text" value="${esc(suiteRunId ? '' : 'staging')}" required></div>
            <div><label for="build">Build (commit, tag or version)</label><input id="build" type="text" placeholder="a981386"></div>
            <div><label for="defect">Defect id (if filed)</label><input id="defect" type="text" placeholder="BUG-025"></div>
          </div>
          <label for="reason">Reason (required when blocked)</label><textarea id="reason"></textarea>
          <label for="notes">Notes</label><textarea id="notes"></textarea>
          <p><button type="submit" id="submit">Record result</button> <span class="muted">The status is derived from the steps by the server.</span></p>
          <div id="result"></div>
        </form>
        <h3>History</h3>
        <div id="history">${renderHistory(history)}</div>
      </section>`;
    // ADR-0021: a reviewer marks the defect; the server checks the role and audits it.
    const markBug = async (bugRef) => {
      try {
        const steps = el('bugsteps')
          .value.split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        const out = await api('POST', `/api/test-cases/${caseId}/known-bug`, { bugRef, steps });
        el('bugmsg').innerHTML =
          `<div class="ok">${out.knownBug ? `Marked: ${esc(out.knownBug)}` : 'Cleared'}</div>`;
        setTimeout(() => viewExecute(caseId, suiteRunId), 600);
      } catch (err) {
        el('bugmsg').innerHTML = `<div class="error">${esc(err.message)}</div>`;
      }
    };
    el('bugform').addEventListener('submit', (e) => {
      e.preventDefault();
      markBug(el('knownbug').value.trim() || null);
    });
    const clearBug = el('clearbug');
    if (clearBug) clearBug.addEventListener('click', () => markBug(null));
    if (suiteRunId) {
      api('GET', `/api/suite-runs/${suiteRunId}`).then((r) => {
        el('env').value = r.environmentId;
      });
    }
    if (!approved) return;
    el('runform').addEventListener('submit', async (e) => {
      e.preventDefault();
      const steps = c.steps.map((_, i) => ({
        status: document.querySelector(`input[name="s${i}"]:checked`).value,
        actual: el(`a${i}`).value.trim(),
      }));
      const body = {
        caseId,
        environmentId: el('env').value.trim(),
        build: el('build').value.trim(),
        steps,
        reason: el('reason').value.trim(),
        notes: el('notes').value.trim(),
        ...(el('defect').value.trim() ? { defectRef: el('defect').value.trim() } : {}),
        ...(suiteRunId ? { suiteRunId } : {}),
      };
      el('submit').disabled = true;
      try {
        const run = await api('POST', '/api/manual-runs', body);
        el('result').innerHTML =
          h`<div class="ok">Recorded as ${pill(run.status)}${run.failedStep ? ` at step ${run.failedStep}` : ''} (${esc(run.id)}).</div>
          <label for="shot">Attach a screenshot or a text file (up to 5 MB)</label>
          <input id="shot" type="file" accept="image/png,image/jpeg,image/webp,text/plain,application/json" multiple>
          <div id="shots" class="thumbs"></div>`;
        el('shot').addEventListener('change', async () => {
          for (const file of el('shot').files) {
            try {
              const b64 = await toBase64(file);
              const ev = await api('POST', `/api/manual-runs/${run.id}/evidence`, {
                name: safeName(file.name),
                contentType: file.type || 'text/plain',
                dataBase64: b64,
              });
              el('shots').insertAdjacentHTML(
                'beforeend',
                `<div class="muted">✓ ${esc(ev.name)} (${ev.sizeBytes} bytes)</div>`,
              );
            } catch (err) {
              el('shots').insertAdjacentHTML(
                'beforeend',
                `<div class="error">${esc(file.name)}: ${esc(err.message)}</div>`,
              );
            }
          }
        });
        el('history').innerHTML = renderHistory(
          (await api('GET', `/api/test-cases/${caseId}/manual-runs`)).items,
        );
      } catch (err) {
        el('result').innerHTML = `<div class="error">${esc(err.message)}</div>`;
        el('submit').disabled = false;
      }
    });
  }

  function renderHistory(items) {
    if (!items.length) return '<p class="muted">Not run yet.</p>';
    return `<table><thead><tr><th>When</th><th>Status</th><th>Build</th><th>Environment</th><th>Tester</th><th>Defect</th></tr></thead><tbody>${items
      .map(
        (
          r,
        ) => h`<tr><td>${esc(fmtDate(r.finishedAt))}</td><td>${pill(r.status)}${r.failedStep ? ` <span class="muted">step ${r.failedStep}</span>` : ''}</td>
        <td>${esc(r.build)}</td><td>${esc(r.environmentId)}</td><td>${esc(r.testerId)}</td><td>${esc(r.defectRef ?? '')}</td></tr>`,
      )
      .join('')}</tbody></table>`;
  }

  // ---- draft review (ADR-0019, amendment): approve, reject or edit; the page never approves on its own.
  const STATUSES = ['DRAFT', 'NEEDS_CLARIFICATION', 'IN_REVIEW', 'APPROVED', 'REJECTED'];

  async function viewDrafts(status) {
    const current = STATUSES.includes(status) ? status : 'DRAFT';
    const { items } = await api('GET', `/api/test-cases?status=${current}`);
    app.innerHTML = h`
      <section class="card" aria-labelledby="h-drafts">
        <h2 id="h-drafts">Cases to review</h2>
        <p class="muted">Drafted by the agent from approved sources. Read each one against its requirements; approve it, send it back with a reason, or edit it. Flags were found in code, not by the model.</p>
        <p>${STATUSES.map((st) => h`<a class="clickable" href="#/drafts?status=${st}" ${st === current ? 'aria-current="page"' : ''}>${st === current ? `<b>${st}</b>` : st}</a>`).join(' · ')}</p>
        ${
          items.length === 0
            ? `<p>No cases in ${esc(current)}.</p>`
            : `<table><thead><tr><th>Case</th><th>Story</th><th>Priority</th><th>Level</th><th>Techniques</th><th>Flags</th></tr></thead><tbody>${items
                .map(
                  (c) => h`<tr>
                <td><a class="clickable" href="#/review/${esc(c.caseId)}">${esc(c.title)}</a><div class="muted">${esc(c.caseId)} · r${c.revision}</div></td>
                <td>${esc(c.story)}</td><td>${esc(c.priority)}</td><td>${esc(c.level)}</td>
                <td class="muted">${esc(c.techniques.join(', '))}</td>
                <td>${c.reviewFlags ? `<span class="flag">⚑ ${c.reviewFlags}</span>` : ''}${c.missingRequirements ? `<span class="flag"> · ${c.missingRequirements} missing</span>` : ''}</td></tr>`,
                )
                .join('')}</tbody></table>`
        }
      </section>`;
  }

  const lines = (xs) => (xs || []).join('\n');
  const splitLines = (v) =>
    v
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean);
  const splitList = (v) =>
    v
      .split(/[,\n]/)
      .map((x) => x.trim())
      .filter(Boolean);

  async function viewReview(caseId) {
    const detail = await api('GET', `/api/test-cases/${caseId}`);
    const rev = latestRevision(detail);
    const c = rev.content;
    const editable = ['DRAFT', 'REJECTED', 'NEEDS_CLARIFICATION'].includes(rev.status);
    const option = (v, cur) => h`<option value="${v}" ${v === cur ? 'selected' : ''}>${v}</option>`;
    app.innerHTML = h`
      <section class="card" aria-labelledby="h-review">
        <p><a class="clickable" href="#/drafts">← cases to review</a></p>
        <h2 id="h-review">${esc(c.title)}</h2>
        <p class="muted">${esc(caseId)} · revision ${rev.revision} ${pill(rev.status)} · story ${esc(detail.storyId)} · basis ${esc(c.basis || 'specified')}</p>
        ${(c.reviewFlags || []).map((f) => `<p class="flag">⚑ ${esc(f)}</p>`).join('')}
        ${(c.missingRequirements || []).map((m) => `<p class="flag">Missing: ${esc(m)}</p>`).join('')}
        <h3>Design</h3>
        <p class="muted">Techniques: ${esc((c.techniques || []).join(', ')) || '—'} · Types: ${esc((c.testTypes || []).join(', ')) || '—'} · Verifies: ${esc((c.requirementRefs || []).join(', ')) || '—'}</p>
        ${c.testConditions?.length ? `<ul>${c.testConditions.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
        <h3>Steps as drafted</h3>
        <table><thead><tr><th>#</th><th>Action</th><th>Expected</th><th>Data</th><th>Sources</th></tr></thead><tbody>${c.steps
          .map(
            (st, i) =>
              h`<tr><td>${i + 1}</td><td>${esc(st.action)}</td><td>${esc(st.expected)}</td><td class="muted">${esc(st.testData || '')}</td><td class="muted">${esc((st.sourceRefs || []).join(', '))}</td></tr>`,
          )
          .join('')}</tbody></table>
        ${c.assumptions?.length ? `<h3>Assumptions</h3><ul>${c.assumptions.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
        <div id="actions" ${rev.status === 'DRAFT' || rev.status === 'IN_REVIEW' ? '' : 'hidden'}>
          <h3>Decision</h3>
          <p><button id="approve">Approve</button> <button id="reject" class="secondary">Reject…</button> <button id="edit" class="secondary" ${editable ? '' : 'disabled'}>Edit…</button></p>
          <div id="reject-box" hidden><label for="reject-reason">Reason for rejecting</label><textarea id="reject-reason"></textarea><p><button id="reject-send" class="secondary">Send back</button></p></div>
          <div id="decision"></div>
        </div>
        <form id="editform" hidden>
          <h3>Edit (saves a new revision in DRAFT)</h3>
          <div class="row">
            <div><label for="e-title">Title</label><input id="e-title" type="text" value="${esc(c.title)}" required></div>
            <div><label for="e-priority">Priority</label><select id="e-priority">${['P0', 'P1', 'P2', 'P3'].map((p) => option(p, c.priority)).join('')}</select></div>
            <div><label for="e-module">Module</label><input id="e-module" type="text" value="${esc(c.module || '')}"></div>
          </div>
          <div class="row">
            <div><label for="e-level">Level</label><select id="e-level">${['api', 'ui', 'manual'].map((p) => option(p, c.level || 'manual')).join('')}</select></div>
            <div><label for="e-reason">Why it stays manual</label><input id="e-reason" type="text" value="${esc(c.manualReason || '')}"></div>
            <div><label for="e-smoke">Smoke set</label><input id="e-smoke" type="checkbox" ${c.smoke ? 'checked' : ''}></div>
          </div>
          <label for="e-pre">Preconditions (one per line)</label><textarea id="e-pre">${esc(lines(c.preconditions))}</textarea>
          <label for="e-data">Test data (one per line)</label><textarea id="e-data">${esc(lines(c.testData))}</textarea>
          <h3>Steps</h3>
          ${c.steps
            .map(
              (
                st,
                i,
              ) => h`<div class="step"><b>Step ${i + 1}</b> <span class="muted">sources: ${esc((st.sourceRefs || []).join(', '))}</span>
              <label for="s-action-${i}">Action</label><textarea id="s-action-${i}">${esc(st.action)}</textarea>
              <label for="s-expected-${i}">Expected (exact message, value or state)</label><textarea id="s-expected-${i}">${esc(st.expected)}</textarea>
              <label for="s-data-${i}">Test data for this step</label><input id="s-data-${i}" type="text" value="${esc(st.testData || '')}"></div>`,
            )
            .join('')}
          <label for="e-assume">Assumptions (one per line)</label><textarea id="e-assume">${esc(lines(c.assumptions))}</textarea>
          <label for="e-questions">Open questions it depends on (review ids, comma-separated)</label><input id="e-questions" type="text" value="${esc((c.openQuestions || []).join(', '))}">
          <label for="e-refs">References (comma-separated)</label><input id="e-refs" type="text" value="${esc((c.refs || []).join(', '))}">
          <label for="e-note">Reason for the edit</label><input id="e-note" type="text">
          <p><button type="submit">Save revision</button> <button type="button" id="edit-cancel" class="secondary">Cancel</button></p>
          <div id="edit-result"></div>
        </form>
      </section>`;

    const decide = async (body) => {
      try {
        const out = await api('POST', `/api/test-cases/${caseId}/review`, body);
        el('decision').innerHTML =
          `<div class="ok">Revision ${out.revision} is now ${esc(out.status)}.</div>`;
        setTimeout(() => viewReview(caseId), 600);
      } catch (err) {
        el('decision').innerHTML = `<div class="error">${esc(err.message)}</div>`;
      }
    };
    el('approve')?.addEventListener('click', () => decide({ decision: 'APPROVE' }));
    el('reject')?.addEventListener('click', () => (el('reject-box').hidden = false));
    el('reject-send')?.addEventListener('click', () =>
      decide({ decision: 'REJECT', reason: el('reject-reason').value.trim() }),
    );
    el('edit')?.addEventListener('click', () => {
      el('editform').hidden = false;
      el('actions').hidden = true;
    });
    el('edit-cancel').addEventListener('click', () => {
      el('editform').hidden = true;
      el('actions').hidden = false;
    });
    el('editform').addEventListener('submit', async (e) => {
      e.preventDefault();
      const content = {
        ...c,
        title: el('e-title').value.trim(),
        priority: el('e-priority').value,
        module: el('e-module').value.trim(),
        level: el('e-level').value,
        manualReason: el('e-reason').value.trim(),
        smoke: el('e-smoke').checked,
        preconditions: splitLines(el('e-pre').value),
        testData: splitLines(el('e-data').value),
        steps: c.steps.map((st, i) => ({
          ...st,
          action: el(`s-action-${i}`).value.trim(),
          expected: el(`s-expected-${i}`).value.trim(),
          testData: el(`s-data-${i}`).value.trim(),
        })),
        assumptions: splitLines(el('e-assume').value),
        openQuestions: splitList(el('e-questions').value),
        refs: splitList(el('e-refs').value),
      };
      content.basis = content.assumptions.length ? 'assumption' : 'specified';
      try {
        const out = await api('POST', `/api/test-cases/${caseId}/review`, {
          decision: 'EDIT',
          content,
          reason: el('e-note').value.trim() || undefined,
        });
        el('edit-result').innerHTML = `<div class="ok">Saved revision ${out.revision}.</div>`;
        setTimeout(() => viewReview(caseId), 600);
      } catch (err) {
        el('edit-result').innerHTML = `<div class="error">${esc(err.message)}</div>`;
      }
    });
  }

  async function viewQuestions() {
    const { items } = await api('GET', '/api/questions');
    app.innerHTML = h`
      <section class="card" aria-labelledby="h-q">
        <h2 id="h-q">Open questions</h2>
        <p class="muted">Each is a clarification the agent asked for. Record what the product does today so the owner can decide; it is an observation, never a requirement.</p>
        ${
          items.length === 0
            ? '<p>No questions.</p>'
            : items
                .map(
                  (q) => h`<div class="step">
          <b>${esc(q.id)}</b> ${pill(q.status)} <span class="muted">· about ${esc(q.about.join(', ') || '—')}${q.story ? ` · story ${esc(q.story)}` : ''}</span>
          <p>${esc(q.question)}</p>
          ${q.cases.length ? `<p class="muted">Cases depending on it: ${q.cases.map((c) => esc(c.caseId)).join(', ')}</p>` : ''}
          <label for="obs-${esc(q.id)}">Current behaviour (observed)</label>
          <textarea id="obs-${esc(q.id)}">${esc(q.currentBehaviour ?? '')}</textarea>
          <p><button class="secondary" data-obs="${esc(q.id)}">Save observation</button> <span id="obs-msg-${esc(q.id)}" class="muted"></span></p>
        </div>`,
                )
                .join('')
        }
      </section>`;
    app.querySelectorAll('button[data-obs]').forEach((b) =>
      b.addEventListener('click', async () => {
        const id = b.dataset.obs;
        try {
          await api('POST', `/api/reviews/${id}/observation`, {
            currentBehaviour: el(`obs-${id}`).value.trim(),
          });
          el(`obs-msg-${id}`).textContent = 'Saved.';
        } catch (err) {
          el(`obs-msg-${id}`).textContent = err.message;
        }
      }),
    );
  }

  async function viewExports() {
    const cov = await api('GET', '/api/coverage');
    const t = cov.totals;
    app.innerHTML = h`
      <section class="card" aria-labelledby="h-cov">
        <h2 id="h-cov">Coverage</h2>
        <table><tbody>
          <tr><th>Sources cited by at least one case</th><td class="num">${t.sourcesCovered} / ${t.sources}</td></tr>
          <tr><th>Acceptance criteria covered</th><td class="num">${t.criteriaCovered} / ${t.criteria}</td></tr>
          <tr><th>Requirement identifiers covered</th><td class="num">${t.identifiersCovered} / ${t.identifiers}</td></tr>
          <tr><th>Cases (approved)</th><td class="num">${t.cases} (${t.approvedCases})</td></tr>
        </tbody></table>
        ${cov.gaps.sources.length ? `<h3>Sources no case cites</h3><p>${cov.gaps.sources.map(esc).join(', ')}</p>` : ''}
        ${cov.gaps.criteria.length ? `<h3>Criteria no case covers</h3><p>${cov.gaps.criteria.map(esc).join(', ')}</p>` : ''}
        ${
          cov.stale.length
            ? `<h3>Stale cases (${cov.stale.length})</h3><p class="muted">Approved against a source version that is no longer active: review each against the current version.</p>
               <table><thead><tr><th>Case</th><th>Cited version</th><th>Now</th></tr></thead><tbody>${cov.stale
                 .map(
                   (
                     s,
                   ) => h`<tr><td><a class="clickable" href="#/execute/${esc(s.caseId)}">${esc(s.title)}</a><div class="muted">${esc(s.code || s.caseId)}</div></td>
                     <td>${s.refs.map((r) => esc(r.ref)).join('<br>')}</td><td>${s.refs.map((r) => esc(r.status)).join('<br>')}</td></tr>`,
                 )
                 .join('')}</tbody></table>`
            : ''
        }
      </section>
      <section class="card" aria-labelledby="h-reg">
        <h2 id="h-reg">Regression scope</h2>
        <form id="regform" class="row"><div><label for="regref">Requirement id, source id or story:AC</label><input id="regref" type="text" placeholder="BR-404"></div>
          <div><label>&nbsp;</label><button type="submit" class="secondary">Show cases</button></div></form>
        <div id="regout"></div>
      </section>
      <section class="card" aria-labelledby="h-exp">
        <h2 id="h-exp">Exports</h2>
        <p><button id="dl-cases">Download test-cases.csv</button> <button id="dl-trace" class="secondary">Download traceability.csv</button> <button id="dl-design" class="secondary">Download test-design.md</button></p>
        <p class="muted">The tester workbook has the team's 20 columns; execution columns come only from recorded runs. The test-design document has the eight sections (analysis, techniques, coverage, traceability, gaps, risk order, regression scope), from the records.</p>
        <div id="dl-msg"></div>
      </section>`;
    const download = async (path, name) => {
      try {
        const res = await api('GET', path, undefined, true);
        if (!res.ok) throw new Error(`${res.status}`);
        const url = URL.createObjectURL(await res.blob());
        const a = Object.assign(document.createElement('a'), { href: url, download: name });
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (err) {
        el('dl-msg').innerHTML = `<div class="error">${esc(err.message)}</div>`;
      }
    };
    el('dl-cases').addEventListener('click', () => download('/api/export/test-cases.csv', 'test-cases.csv'));
    el('dl-trace').addEventListener('click', () =>
      download('/api/export/traceability.csv', 'traceability.csv'),
    );
    el('dl-design').addEventListener('click', () => download('/api/export/test-design.md', 'test-design.md'));
    el('regform').addEventListener('submit', async (e) => {
      e.preventDefault();
      const ref = el('regref').value.trim();
      if (!ref) return;
      try {
        const r = await api('GET', `/api/regression?ref=${encodeURIComponent(ref)}`);
        const list = (title, cs) =>
          cs.length
            ? `<h3>${title} (${cs.length})</h3><ul>${cs.map((c) => h`<li><a class="clickable" href="#/execute/${esc(c.caseId)}">${esc(c.code || c.caseId)}</a> ${esc(c.title)}</li>`).join('')}</ul>`
            : '';
        el('regout').innerHTML =
          `${list('Cases citing ' + esc(ref), r.cited)}${list('All approved P0', r.p0)}${list('Guarding a defect', r.guarding)}${r.caseIds.length ? '' : '<p class="muted">No approved case cites it.</p>'}`;
      } catch (err) {
        el('regout').innerHTML = `<div class="error">${esc(err.message)}</div>`;
      }
    });
  }

  // ---- utilities
  const safeName = (n) => n.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'file';
  const toBase64 = (file) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1]);
      r.onerror = () => reject(new Error('could not read the file'));
      r.readAsDataURL(file);
    });

  // ---- router
  async function render() {
    document.querySelectorAll('[data-nav]').forEach((a) => a.removeAttribute('aria-current'));
    if (!state.key) return viewKey();
    const [path, query] = location.hash.replace(/^#/, '').split('?');
    const params = new URLSearchParams(query || '');
    const seg = path.split('/').filter(Boolean);
    const nav =
      seg[0] === 'suite-runs' || seg[0] === 'execute' ? 'suites' : seg[0] === 'review' ? 'drafts' : seg[0];
    document.querySelector(`[data-nav="${nav}"]`)?.setAttribute('aria-current', 'page');
    try {
      if (seg[0] === 'suite-runs' && seg[1]) await viewSuiteRun(seg[1]);
      else if (seg[0] === 'execute' && seg[1]) await viewExecute(seg[1], params.get('run'));
      else if (seg[0] === 'drafts') await viewDrafts(params.get('status'));
      else if (seg[0] === 'review' && seg[1]) await viewReview(seg[1]);
      else if (seg[0] === 'questions') await viewQuestions();
      else if (seg[0] === 'exports') await viewExports();
      else await viewSuites();
    } catch (err) {
      if (state.key) app.innerHTML = `<div class="error">${esc(err.message)}</div>`;
    }
  }
  window.addEventListener('hashchange', render);

  try {
    state.key = sessionStorage.getItem(KEY);
  } catch {
    /* storage unavailable (private window): the key lives only in memory */
  }
  if (state.key) {
    api('GET', '/api/me')
      .then((me) => {
        state.me = me;
        who.textContent = `${me.actorId} · ${me.roles.join(', ')}`;
        signout.hidden = false;
        render();
      })
      .catch(() => forget());
  } else {
    render();
  }
})();
