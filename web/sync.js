/* 好队友 sync client — bridges the existing localStorage UI to the backend.
   Design goals:
   - Non-breaking: pages keep reading/writing localStorage (fast, offline).
   - When logged in + a server is reachable, mirror config & documents to it.
   - On static hosting with no backend, silently stays in local-only mode.
   Exposes window.HDY for the shell (login UI) and pages. */
(function () {
  const LS = {
    token: 'hdy.auth.token', me: 'hdy.auth.me',
    form: 'hdy.formbuilder.v1', flow: 'hdy.flow.v1',
    inst: 'hdy.instances.v1', notif: 'hdy.notif.v1', user: 'hdy.user.v1',
  };
  // API base: same-origin by default; override with ?api= or localStorage hdy.api
  const API = (new URLSearchParams(location.search).get('api'))
    || localStorage.getItem('hdy.api')
    || (location.protocol.startsWith('http') ? location.origin : '');

  const read = (k, f) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? f : v; } catch (e) { return f; } };
  const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const token = () => localStorage.getItem(LS.token);
  const bumpSync = () => { try { localStorage.setItem('hdy.sync', Date.now() + '.' + Math.random()); } catch (e) {} };

  async function apiFetch(pathname, opts = {}) {
    if (!API) throw new Error('no-server');
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    const t = token(); if (t) headers['Authorization'] = 'Bearer ' + t;
    const res = await fetch(API + '/api' + pathname, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { status: res.status, data });
    return data;
  }

  const HDY = {
    API,
    isAuthed() { return !!token(); },
    me() { return read(LS.me, null); },
    online() { return !!API; },
    // actually probe the backend (used to decide whether to show the login gate)
    async ping() {
      if (!API) return false;
      try {
        const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 2500);
        const res = await fetch(API + '/api/health', { signal: ctrl.signal });
        clearTimeout(t); return res.ok;
      } catch (e) { return false; }
    },

    async signup(payload) { const r = await apiFetch('/auth/signup', { method: 'POST', body: payload }); afterAuth(r); return r; },
    async login(payload) { const r = await apiFetch('/auth/login', { method: 'POST', body: payload }); afterAuth(r); return r; },
    logout() { localStorage.removeItem(LS.token); localStorage.removeItem(LS.me); bumpSync(); },

    // pull server state into localStorage (so the existing UI just works)
    async pull() {
      if (!this.isAuthed()) return;
      const cfg = await apiFetch('/config');
      if (cfg.form) write(LS.form, stripMeta(cfg.form));
      if (cfg.flow) write(LS.flow, stripMeta(cfg.flow));
      const docs = await apiFetch('/documents');
      // map server documents -> the instance shape the UI expects
      const server = docs.map(d => ({
        id: d.id, srvId: d.id, no: d.no, title: d.title, data: d.data, initiator: d.initiator,
        createdAt: d.createdAt, status: d.status, cursor: d.cursor, steps: d.steps,
        resubmittedAt: d.resubmittedAt,
      }));
      // keep any local docs still in-flight (submitted but not yet assigned a
      // server id) so a background pull can't make a just-submitted doc vanish
      const pending = read(LS.inst, []).filter(l => !l.srvId);
      write(LS.inst, [...pending, ...server]);
      bumpSync();
    },

    // push the locally-designed form+flow to the server
    async pushConfig() {
      if (!this.isAuthed()) return;
      await apiFetch('/config', { method: 'PUT', body: { form: read(LS.form, null), flow: read(LS.flow, null) } });
    },

    // create a document on the server, return the saved row (with server id/no)
    async createDocument(doc) {
      if (!this.isAuthed()) return null;
      return apiFetch('/documents', { method: 'POST', body: doc });
    },
    async updateDocument(id, patch) {
      if (!this.isAuthed()) return null;
      return apiFetch('/documents/' + id, { method: 'PUT', body: patch });
    },
    async deleteDocument(id) {
      if (!this.isAuthed()) return null;
      return apiFetch('/documents/' + id, { method: 'DELETE' });
    },
    async members() { return apiFetch('/members'); },
    async invite(payload) { return apiFetch('/members', { method: 'POST', body: payload }); },
    async audit() { return apiFetch('/audit'); },
  };

  function stripMeta(o) { const { orgId, createdAt, updatedAt, id, ...rest } = o; return rest; }
  function afterAuth(r) {
    localStorage.setItem(LS.token, r.token);
    write(LS.me, { ...r.user, org: r.org, role: r.role });
    write(LS.user, r.user.name);   // identity used by the existing UI
    bumpSync();
  }

  window.HDY = HDY;
})();
