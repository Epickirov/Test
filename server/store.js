/* Atomic JSON file store — a tiny embedded "database".
   One file per collection under ./data. Swap this module for Postgres later;
   the rest of the server only depends on these methods. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.HDY_DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const cache = new Map();         // collection -> array (in-memory mirror)
const locks = new Map();         // collection -> Promise chain (serialize writes)

function file(coll) { return path.join(DATA_DIR, coll + '.json'); }

function load(coll) {
  if (cache.has(coll)) return cache.get(coll);
  let arr = [];
  try { arr = JSON.parse(fs.readFileSync(file(coll), 'utf8')); }
  catch (e) { arr = []; }
  cache.set(coll, arr);
  return arr;
}

// atomic write: write to temp then rename (prevents half-written files on crash)
function persist(coll) {
  const tmp = file(coll) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cache.get(coll) || [], null, 0));
  fs.renameSync(tmp, file(coll));
}

// serialize mutations per-collection so concurrent requests can't corrupt state
function withLock(coll, fn) {
  const prev = locks.get(coll) || Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(coll, next.catch(() => {}));
  return next;
}

const uid = (p = '') => p + crypto.randomBytes(9).toString('base64url');

const Store = {
  uid,
  all(coll) { return load(coll).slice(); },

  find(coll, pred) { return load(coll).find(pred); },
  filter(coll, pred) { return load(coll).filter(pred); },

  insert(coll, doc) {
    return withLock(coll, () => {
      const arr = load(coll);
      const row = { id: doc.id || uid(), createdAt: Date.now(), ...doc };
      arr.push(row); persist(coll); return row;
    });
  },

  update(coll, id, patch) {
    return withLock(coll, () => {
      const arr = load(coll);
      const i = arr.findIndex(r => r.id === id);
      if (i < 0) return null;
      arr[i] = { ...arr[i], ...patch, id, updatedAt: Date.now() };
      persist(coll); return arr[i];
    });
  },

  // upsert by id (used for whole-document form/flow saves)
  put(coll, id, doc) {
    return withLock(coll, () => {
      const arr = load(coll);
      const i = arr.findIndex(r => r.id === id);
      const row = { ...doc, id, updatedAt: Date.now() };
      if (i < 0) { row.createdAt = Date.now(); arr.push(row); }
      else arr[i] = { ...arr[i], ...row };
      persist(coll); return row;
    });
  },

  remove(coll, id) {
    return withLock(coll, () => {
      const arr = load(coll);
      const i = arr.findIndex(r => r.id === id);
      if (i < 0) return false;
      arr.splice(i, 1); persist(coll); return true;
    });
  },
};

module.exports = { Store, DATA_DIR };
