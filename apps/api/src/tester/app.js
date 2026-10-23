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
    const row = (i) => h`<tr>
      <td>${i.manualRunId || i.status === 'NOT_AUTOMATED' ? `<a class="clickable" href="#/execute/${esc(i.caseId)}?run=${esc(id)}">${esc(i.title)}</a>` : esc(i.title)}
        <div class="muted">${esc(i.caseId)} · ${esc(i.section)}</div></td>
      <td>${pill(i.status)}${i.testerId ? `<div class="muted">by ${esc(i.testerId)}</div>` : ''}</td>
      <td>${esc(i.reason ?? '')}</td>
      <td class="num">${i.durationMs == null ? '' : `${(i.durationMs / 1000).toFixed(1)} s`}</td></tr>`;
    app.innerHTML = h`
      <section class="card" aria-labelledby="h-run">
        <h2 id="h-run">Suite run ${esc(r.id)}</h2>
        <p class="muted">Environment <b>${esc(r.environmentId)}</b> · requested by ${esc(r.requestedBy)} on ${esc(fmtDate(r.createdAt))}</p>
        <p>${pill('PASSED')} ${t.passed} &nbsp; ${pill('FAILED')} ${t.failed} &nbsp; ${pill('BLOCKED')} ${t.blocked} &nbsp; ${pill('INCONCLUSIVE')} ${t.inconclusive}
           &nbsp; <span class="pill NOT_AUTOMATED">manual pending</span> ${t.notAutomated} &nbsp; <span class="muted">recorded by hand: ${t.manualRecorded}</span></p>
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
        <p class="muted">${esc(caseId)} · revision ${rev.revision} ${pill(rev.status)} · ${esc(c.priority)} · ${esc((c.techniques || []).join(', '))}
          ${c.module ? ` · ${esc(c.module)}` : ''} · ${esc(c.level || 'manual')}${c.manualReason ? ` (${esc(c.manualReason)})` : ''}</p>
        ${(c.reviewFlags || []).map((f) => `<p class="flag">⚑ ${esc(f)}</p>`).join('')}
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
      </section>
      <section class="card" aria-labelledby="h-exp">
        <h2 id="h-exp">Exports</h2>
        <p><button id="dl-cases">Download test-cases.csv</button> <button id="dl-trace" class="secondary">Download traceability.csv</button></p>
        <p class="muted">The tester workbook has the team's 20 columns; execution columns come only from recorded runs.</p>
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
    const nav = seg[0] === 'suite-runs' || seg[0] === 'execute' ? 'suites' : seg[0];
    document.querySelector(`[data-nav="${nav}"]`)?.setAttribute('aria-current', 'page');
    try {
      if (seg[0] === 'suite-runs' && seg[1]) await viewSuiteRun(seg[1]);
      else if (seg[0] === 'execute' && seg[1]) await viewExecute(seg[1], params.get('run'));
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
