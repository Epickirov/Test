/* 好队友 backend — zero-dependency Node SaaS API.
   Run: node server/server.js   (serves the /web UI + /api)
   Multi-tenant: every row is scoped by orgId. Auth via signed bearer tokens.
   Storage via ./store.js (JSON files); swap for Postgres without touching routes. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Store } = require('./store');
const { hashPassword, verifyPassword, signToken, verifyToken } = require('./auth');

const PORT = process.env.PORT || 8787;
const WEB_DIR = path.join(__dirname, '..', 'web');

/* ---------------- helpers ---------------- */
function send(res, code, body, headers = {}) {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(data);
}
function readBody(req) {
  return new Promise((resolve) => {
    let s = ''; req.on('data', c => { s += c; if (s.length > 5e6) req.destroy(); });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { resolve({}); } });
  });
}
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
  '.png':'image/png', '.svg':'image/svg+xml', '.webmanifest':'application/manifest+json', '.ico':'image/x-icon' };

function audit(orgId, actorId, action, detail) {
  Store.insert('audit', { orgId, actorId, action, detail: detail || {}, at: Date.now() });
}

/* ---------------- auth middleware ---------------- */
function authUser(req) {
  const h = req.headers['authorization'] || '';
  const tok = h.startsWith('Bearer ') ? h.slice(7) : null;
  const data = verifyToken(tok);
  if (!data) return null;
  const user = Store.find('users', u => u.id === data.uid);
  if (!user) return null;
  return user;
}
// membership + role of a user within their active org
function membership(user) {
  return Store.find('members', m => m.userId === user.id && m.orgId === user.orgId);
}
function can(role, action) {
  const M = {
    owner:  ['*'],
    admin:  ['design', 'manage', 'approve', 'submit', 'invite', 'view'],
    member: ['submit', 'approve', 'view'],
    viewer: ['view'],
  };
  const allowed = M[role] || [];
  return allowed.includes('*') || allowed.includes(action);
}

/* ---------------- API routes ---------------- */
async function api(req, res, url) {
  const seg = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const p = seg.slice(1);                               // drop 'api'
  const method = req.method;

  /* ---- public: signup / login ---- */
  if (p[0] === 'auth') {
    if (p[1] === 'signup' && method === 'POST') return signup(req, res);
    if (p[1] === 'login' && method === 'POST') return login(req, res);
    return send(res, 404, { error: 'not found' });
  }

  /* ---- everything below requires a valid user ---- */
  const user = authUser(req);
  if (!user) return send(res, 401, { error: 'unauthorized' });
  const mem = membership(user);
  if (!mem) return send(res, 403, { error: 'no org membership' });
  const ctx = { user, orgId: user.orgId, role: mem.role };

  if (p[0] === 'me' && method === 'GET') {
    const org = Store.find('orgs', o => o.id === ctx.orgId);
    return send(res, 200, { user: pubUser(user), org, role: ctx.role });
  }

  // org-wide config docs (single form + flow per org for now; multi-app later)
  if (p[0] === 'config') {
    if (method === 'GET') {
      return send(res, 200, {
        form: Store.find('forms', f => f.orgId === ctx.orgId) || null,
        flow: Store.find('flows', f => f.orgId === ctx.orgId) || null,
      });
    }
    if (method === 'PUT') {
      if (!can(ctx.role, 'design')) return send(res, 403, { error: 'forbidden' });
      const b = await readBody(req);
      if (b.form) {
        const ex = Store.find('forms', f => f.orgId === ctx.orgId);
        await Store.put('forms', ex ? ex.id : Store.uid('form_'), { ...b.form, orgId: ctx.orgId });
      }
      if (b.flow) {
        const ex = Store.find('flows', f => f.orgId === ctx.orgId);
        await Store.put('flows', ex ? ex.id : Store.uid('flow_'), { ...b.flow, orgId: ctx.orgId });
      }
      audit(ctx.orgId, user.id, 'config.update', { hasForm: !!b.form, hasFlow: !!b.flow });
      return send(res, 200, { ok: true });
    }
  }

  // documents (submitted instances)
  if (p[0] === 'documents') {
    if (method === 'GET' && !p[1]) {
      const docs = Store.filter('documents', d => d.orgId === ctx.orgId)
        .sort((a, b) => b.createdAt - a.createdAt);
      return send(res, 200, docs);
    }
    if (method === 'POST' && !p[1]) {
      if (!can(ctx.role, 'submit')) return send(res, 403, { error: 'forbidden' });
      const b = await readBody(req);
      const row = await Store.insert('documents', {
        orgId: ctx.orgId, title: b.title || '表单', no: b.no || null,
        data: b.data || {}, steps: b.steps || [], cursor: b.cursor ?? -1,
        status: b.status || 'running', initiator: user.name, initiatorId: user.id,
      });
      audit(ctx.orgId, user.id, 'document.create', { id: row.id, no: row.no });
      return send(res, 201, row);
    }
    const id = p[1];
    if (method === 'PUT' && id) {
      const cur = Store.find('documents', d => d.id === id && d.orgId === ctx.orgId);
      if (!cur) return send(res, 404, { error: 'not found' });
      const b = await readBody(req);
      const row = await Store.update('documents', id, b);
      audit(ctx.orgId, user.id, 'document.update', { id, status: row.status });
      return send(res, 200, row);
    }
    if (method === 'DELETE' && id) {
      if (!can(ctx.role, 'manage')) return send(res, 403, { error: 'forbidden' });
      const cur = Store.find('documents', d => d.id === id && d.orgId === ctx.orgId);
      if (!cur) return send(res, 404, { error: 'not found' });
      await Store.remove('documents', id);
      audit(ctx.orgId, user.id, 'document.delete', { id });
      return send(res, 200, { ok: true });
    }
  }

  // team: list members, invite
  if (p[0] === 'members') {
    if (method === 'GET') {
      const rows = Store.filter('members', m => m.orgId === ctx.orgId).map(m => {
        const u = Store.find('users', x => x.id === m.userId);
        return { userId: m.userId, role: m.role, name: u ? u.name : '?', email: u ? u.email : '' };
      });
      return send(res, 200, rows);
    }
    if (method === 'POST') {
      if (!can(ctx.role, 'invite')) return send(res, 403, { error: 'forbidden' });
      const b = await readBody(req);
      const email = (b.email || '').toLowerCase().trim();
      if (!email) return send(res, 400, { error: 'email required' });
      let u = Store.find('users', x => x.email === email);
      if (!u) {
        // create a pending user with a temp password the inviter sets/share
        u = await Store.insert('users', { email, name: b.name || email.split('@')[0],
          password: hashPassword(b.tempPassword || 'changeme123'), orgId: ctx.orgId, pending: true });
      }
      if (!Store.find('members', m => m.userId === u.id && m.orgId === ctx.orgId)) {
        await Store.insert('members', { orgId: ctx.orgId, userId: u.id, role: b.role || 'member' });
      }
      audit(ctx.orgId, user.id, 'member.invite', { email, role: b.role || 'member' });
      return send(res, 201, { ok: true });
    }
  }

  // audit log (admins)
  if (p[0] === 'audit' && method === 'GET') {
    if (!can(ctx.role, 'manage')) return send(res, 403, { error: 'forbidden' });
    const rows = Store.filter('audit', a => a.orgId === ctx.orgId)
      .sort((a, b) => b.at - a.at).slice(0, 200);
    return send(res, 200, rows);
  }

  return send(res, 404, { error: 'unknown route' });
}

/* ---------------- auth handlers ---------------- */
function pubUser(u) { return { id: u.id, email: u.email, name: u.name, orgId: u.orgId }; }

async function signup(req, res) {
  const b = await readBody(req);
  const email = (b.email || '').toLowerCase().trim();
  const password = b.password || '';
  const orgName = (b.orgName || '').trim();
  if (!email || !password || password.length < 6) return send(res, 400, { error: '邮箱和至少 6 位密码必填' });
  if (Store.find('users', u => u.email === email && !u.pending)) return send(res, 409, { error: '该邮箱已注册' });

  const org = await Store.insert('orgs', { name: orgName || (email.split('@')[0] + ' 的团队'), plan: 'free' });
  // reuse a pending invited user if present, else create
  let user = Store.find('users', u => u.email === email);
  if (user && user.pending) {
    user = await Store.update('users', user.id, { name: b.name || user.name, password: hashPassword(password), orgId: org.id, pending: false });
  } else {
    user = await Store.insert('users', { email, name: b.name || email.split('@')[0], password: hashPassword(password), orgId: org.id });
  }
  await Store.insert('members', { orgId: org.id, userId: user.id, role: 'owner' });
  audit(org.id, user.id, 'org.create', { name: org.name });
  const token = signToken({ uid: user.id });
  return send(res, 201, { token, user: pubUser(user), org, role: 'owner' });
}

async function login(req, res) {
  const b = await readBody(req);
  const email = (b.email || '').toLowerCase().trim();
  const user = Store.find('users', u => u.email === email && !u.pending);
  if (!user || !verifyPassword(b.password || '', user.password)) return send(res, 401, { error: '邮箱或密码错误' });
  const mem = Store.find('members', m => m.userId === user.id && m.orgId === user.orgId);
  const org = Store.find('orgs', o => o.id === user.orgId);
  const token = signToken({ uid: user.id });
  return send(res, 200, { token, user: pubUser(user), org, role: mem ? mem.role : 'member' });
}

/* ---------------- static files ---------------- */
function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' ) rel = '/index.html';
  const filePath = path.join(WEB_DIR, path.normalize(rel));
  if (!filePath.startsWith(WEB_DIR)) return send(res, 403, { error: 'forbidden' });
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      // SPA-ish fallback to the shell
      return fs.readFile(path.join(WEB_DIR, 'index.html'), (e2, b2) =>
        e2 ? send(res, 404, { error: 'not found' }) : res.writeHead(200, { 'Content-Type': 'text/html' }) & res.end(b2));
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(buf);
  });
}

/* ---------------- server ---------------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  // CORS (so the static-hosted UI can talk to a separately deployed API)
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    return serveStatic(req, res, url);
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: 'server error' });
  }
});

server.listen(PORT, () => console.log(`好队友 server on http://localhost:${PORT}`));
