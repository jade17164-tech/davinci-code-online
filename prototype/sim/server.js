// 시뮬레이터의 가짜 서버. 진짜 Realtime Database SDK(10.8)가 하는 일 중 버그와 관련된 것만 흉내 낸다.
//  - 내가 쓴 값은 즉시 내 화면에 반영되고(낙관적 반영), 서버에는 지연 후 보낸 순서대로 도착한다.
//  - 서버에 반영된 값은 다른 기기에 지연 후 도착한다.
//  - get()은 서버에 묻지 않고 캐시 + 아직 확인 안 된 내 쓰기에서 바로 돌려준다(리스너가 걸린 경로에서 SDK가 그렇다).
//  - 리스너 안에서 또 쓰면, 그 이벤트는 지금 이벤트가 끝난 뒤에 이어서 울린다.
(function () {
  const clone = v => (v === undefined || v === null ? null : JSON.parse(JSON.stringify(v)));
  const keys = p => (p || '').split('/').filter(Boolean);
  const join = (a, b) => keys(a).concat(keys(b)).join('/');

  // Firebase는 빈 객체·빈 배열·null을 저장하지 않는다.
  function prune(v) {
    if (v === null || v === undefined) return null;
    if (Array.isArray(v)) {
      const a = v.map(prune);
      while (a.length && a[a.length - 1] === null) a.pop();
      return a.length ? a : null;
    }
    if (typeof v === 'object') {
      const o = {};
      for (const k of Object.keys(v)) { const x = prune(v[k]); if (x !== null) o[k] = x; }
      return Object.keys(o).length ? o : null;
    }
    return v;
  }
  function getAt(tree, path) {
    let n = tree;
    for (const k of keys(path)) { if (n === null || typeof n !== 'object') return null; n = n[k]; if (n === undefined) return null; }
    return n;
  }
  function setAt(tree, path, val) {
    const ks = keys(path);
    if (!ks.length) return prune(clone(val)) || {};
    const root = tree || {};
    let n = root;
    for (let i = 0; i < ks.length - 1; i++) {
      if (n[ks[i]] === null || typeof n[ks[i]] !== 'object') n[ks[i]] = {};
      n = n[ks[i]];
    }
    n[ks[ks.length - 1]] = clone(val);
    return prune(root) || {};
  }
  function applyOp(tree, op) {
    if (op.kind === 'update') { for (const k of Object.keys(op.upd)) tree = setAt(tree, join(op.path, k), op.upd[k]); return tree; }
    return setAt(tree, op.path, op.val);   // set, txn(낙관적 결과)
  }

  const server = {
    tree: {},
    latency: () => 120,
    inflight: 0,
    clients: [],
    log: () => {},
    delay() { const ms = this.latency(); return new Promise(r => setTimeout(r, ms)); },
    connect(name) { const c = new Client(this, name); this.clients.push(c); return c; },
    reset(tree) { this.tree = prune(clone(tree)) || {}; this.clients = []; this.inflight = 0; },
    quiet() { return this.inflight === 0 && this.clients.every(c => c.writes.length === 0); },
    // 서버에 쓰기 하나가 도착했다. 반영하고 모든 기기에 새 상태를 흘려보낸다.
    receive(from, op) {
      if (op.kind === 'txn') {
        const cur = clone(getAt(this.tree, op.path));
        const res = op.fn(cur);
        op.committed = res !== undefined;
        if (op.committed) this.tree = setAt(this.tree, op.path, res);
        op.value = clone(getAt(this.tree, op.path));
      } else {
        this.tree = applyOp(this.tree, op);
      }
      const state = clone(this.tree);
      for (const c of this.clients) {
        this.inflight++;
        c.down = c.down.then(() => this.delay()).then(() => {
          this.inflight--;
          c.deliver(state, c === from ? op : null);
        });
      }
      this.inflight--;   // from이 보낸 몫
    },
  };

  class Client {
    constructor(s, name) {
      this.s = s; this.name = name;
      this.base = clone(s.tree) || {};
      this.writes = [];
      this.listeners = [];
      this.up = Promise.resolve();
      this.down = Promise.resolve();
      this.firing = false; this.dirty = false;
    }
    view() { let t = clone(this.base) || {}; for (const w of this.writes) t = applyOp(t, w); return t; }
    write(op) {
      return new Promise(resolve => {
        op.resolve = resolve;
        this.writes.push(op);
        // SDK(repoSetWithPriority)처럼 서버로 먼저 보내고 화면 이벤트는 그다음에 울린다.
        // 순서를 바꾸면 리스너 안에서 한 쓰기가 앞질러 서버에 도착한다.
        this.s.inflight++;
        this.up = this.up.then(() => this.s.delay()).then(() => this.s.receive(this, op));
        this.raise();
      });
    }
    get(path) { return Promise.resolve(clone(getAt(this.view(), path))); }
    transaction(path, fn) {
      const local = fn(clone(getAt(this.view(), path)));
      if (local === undefined) return Promise.resolve({ committed: false, value: clone(getAt(this.view(), path)) });
      return this.write({ kind: 'txn', path, val: local, fn }).then(op => ({ committed: op.committed, value: op.value }));
    }
    deliver(state, ackOp) {
      this.base = state;
      if (ackOp) { this.writes = this.writes.filter(w => w !== ackOp); ackOp.resolve(ackOp); }
      this.raise();
    }
    listen(path, cb) {
      const l = { path, cb, last: undefined, on: true };
      this.listeners.push(l);
      setTimeout(() => this.raise(), 0);
      return () => { l.on = false; };
    }
    raise() {
      if (this.firing) { this.dirty = true; return; }
      this.firing = true;
      try {
        do {
          this.dirty = false;
          for (const l of this.listeners.slice()) {
            if (!l.on) continue;
            const v = getAt(this.view(), l.path);
            const j = JSON.stringify(v);
            if (j === l.last) continue;
            l.last = j;
            try { l.cb(clone(v)); } catch (e) { this.s.log(this.name, '스크립트 오류: ' + e.message, 'err'); }
          }
        } while (this.dirty);
      } finally { this.firing = false; }
    }
  }

  window.__server = server;
  window.__simUtil = { clone, getAt };
})();
