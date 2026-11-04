// 시뮬레이터용 가짜 Realtime Database 클라이언트. 서버는 부모 창(sim/index.html)에 하나뿐이고
// 이 창은 거기 붙은 기기 한 대다. 값은 창 사이를 오갈 때 JSON으로 복사한다(다른 창의 배열/객체를 섞지 않으려고).
const client = window.parent.__server.connect(window.__cfg.name);
const own = v => (v == null ? null : JSON.parse(JSON.stringify(v)));
const snap = (path, v) => {
  const val = own(v);
  return { key: path.split('/').pop() || null, val: () => own(val), exists: () => val != null };
};

export function getDatabase() { return {}; }
export function ref(db, path) { return { path: (path || '').split('/').filter(Boolean).join('/') }; }
export function set(r, v) { return client.write({ kind: 'set', path: r.path, val: own(v) }); }
export function update(r, upd) { return client.write({ kind: 'update', path: r.path, upd: own(upd) }); }
export function remove(r) { return client.write({ kind: 'set', path: r.path, val: null }); }
export function get(r) { return client.get(r.path).then(v => snap(r.path, v)); }
export function onValue(r, cb) { return client.listen(r.path, v => cb(snap(r.path, v))); }
export function push(r) {
  const key = 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  return { key, path: r.path + '/' + key };
}
export function onDisconnect() {
  const ok = () => Promise.resolve();
  return { set: ok, update: ok, remove: ok, cancel: ok };
}
export function runTransaction(r, fn) {
  // fn이 undefined를 돌려주면 '취소'다. null(=삭제)로 바꾸면 안 된다.
  return client.transaction(r.path, cur => { const v = fn(own(cur)); return v === undefined ? undefined : own(v); }).then(res => ({
    committed: res.committed, snapshot: snap(r.path, res.value),
  }));
}
