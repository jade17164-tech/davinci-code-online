/* 다빈치 코드 3D 보드 렌더러
 *
 * 프로토타입(prototype/davinci-3d-2to6.html)의 렌더러를 떼어내 게임 엔진 의존성을 없앴다.
 * 규칙은 전혀 모르고, 넘겨받은 상태를 그리고 클릭만 되돌려준다. 그래서 index.html의
 * Firebase 데이터든 로컬 엔진이든 같은 모양으로 맞춰 넘기기만 하면 된다.
 *
 *   Board3D.mount({ canvas, app, labels })
 *   Board3D.update(state)
 *   Board3D.onPick(fn)      // {type:'target',pi,idx} | {type:'slot',idx} | {type:'deck',color}
 *   Board3D.resetCam()
 *
 * state = {
 *   n, mode, over, turn, phase,                       // phase: init|draw|place|guess|reveal
 *   players: [{ name, team, hand:[{id,color,num,revealed}], pending, peek }],   // 0번이 나
 *   decks: { black:수, white:수 },
 *   slots:   [idx...],          // 내 손패에 띄울 [+] 자리
 *   targets: [{pi,idx}...],     // 지목할 수 있는 상대 타일
 *   canDraw: bool
 * }
 */
window.Board3D = (() => {
  const V3 = THREE.Vector3;
  const TW = 1.12, TH = 1.58, TD = 0.3;     // 타일 크기

  let canvas, appEl, labelsEl, renderer, scene, camera, world, tileGroup, tileGeo, clock;
  let S = null, pickCb = null, zoom = 1, hover = null, pickables = [], raf = 0;
  let fit = 1;     // 테이블을 화면에 얼마나 꽉 채울지 (작을수록 크게 보인다)
  let glyph = 1;   // 타일 숫자 크기 배수
  const cam = { az: 0, pol: 0.92, rad: 20, tgt: new V3(0, 0, 0.4) };
  const tileMeshes = new Map();
  let seats = [], racks = [], deckMeshes = {}, slotSprites = [], builtN = 0;

  /* ---------- 타일 면 텍스처 ---------- */
  const matCache = new Map();
  const edgeMat = {
    black: new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: .5 }),
    white: new THREE.MeshStandardMaterial({ color: 0xd8d0bb, roughness: .6 }),
  };
  function rr(c, x, y, w, h, r) {
    c.beginPath(); c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  function faceMat(kind, color, num) {
    const key = kind + color + glyph + (kind === 'cover' ? '' : num);
    if (matCache.has(key)) return matCache.get(key);
    const W = 220, H = 310, c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'), blk = color === 'black';
    const bg = blk ? '#17171a' : '#f2ede0', fg = blk ? '#f4efe0' : '#1a1a1e';
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.strokeStyle = blk ? '#4a4a52' : '#b8ae92'; g.lineWidth = 6; rr(g, 7, 7, W - 14, H - 14, 16); g.stroke();
    if (kind === 'cover' || kind === 'peek') {
      // 가려진 타일은 실물처럼 민무늬다. 색만 보이고 숫자는 보이지 않는다.
      if (kind === 'peek') {   // 팀전 아군 타일만 작게 숫자를 띄운다
        g.fillStyle = 'rgba(59,130,214,.92)'; rr(g, 14, 14, 56, 40, 8); g.fill();
        g.fillStyle = '#fff'; g.font = '800 28px Georgia, serif';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(num === -1 ? '-' : String(num), 42, 35);
      }
    } else {
      g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
      const label = num === -1 ? '-' : String(num);
      // 멀리서도 한눈에 읽히도록 글자를 면 높이의 70% 가까이 키운다
      g.font = '800 ' + Math.round((label.length > 1 ? 196 : 240) * glyph) + 'px Georgia, "Times New Roman", serif';
      g.fillText(label, W / 2, H / 2 + 10);
      if (kind === 'rev') {
        g.fillStyle = '#c0392b'; g.beginPath();
        g.moveTo(W - 68, 7); g.lineTo(W - 7, 7); g.lineTo(W - 7, 68); g.closePath(); g.fill();
        g.fillStyle = 'rgba(192,57,43,.10)'; g.fillRect(0, 0, W, H);
      }
    }
    const tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding; tex.anisotropy = 8;
    const m = new THREE.MeshStandardMaterial({ map: tex, roughness: .55, metalness: 0 });
    matCache.set(key, m); return m;
  }
  function setFaces(m, t, pz, nz) {
    const key = pz + '|' + nz; if (m.userData.key === key) return; m.userData.key = key;
    const e = edgeMat[t.color];
    m.material = [e, e, e, e, faceMat(pz, t.color, t.num), faceMat(nz, t.color, t.num)];
  }

  /* ---------- 원목 상판 텍스처 ---------- */
  function woodTex() {
    const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
    const b = g.createLinearGradient(0, 0, 512, 380);
    b.addColorStop(0, '#b07c46'); b.addColorStop(.5, '#8d5c30'); b.addColorStop(1, '#6d4524');
    g.fillStyle = b; g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 200; i++) {
      g.strokeStyle = `rgba(58,33,14,${Math.random() * .17})`; g.lineWidth = Math.random() * 2.2 + .3;
      const y = Math.random() * 512; g.beginPath(); g.moveTo(0, y);
      g.bezierCurveTo(170, y + (Math.random() * 18 - 9), 340, y + (Math.random() * 18 - 9), 512, y + (Math.random() * 12 - 6));
      g.stroke();
    }
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return t;
  }
  let _plus = null;
  function plusMat() {
    if (_plus) return _plus;
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
    g.fillStyle = 'rgba(240,215,140,.96)'; g.beginPath(); g.arc(64, 64, 58, 0, 7); g.fill();
    g.strokeStyle = '#7a5a10'; g.lineWidth = 6; g.stroke();
    g.fillStyle = '#3d2110'; g.fillRect(34, 57, 60, 14); g.fillRect(57, 34, 14, 60);
    _plus = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true });
    return _plus;
  }

  /* ---------- 좌석·탁자 ---------- */
  const tableR = n => n <= 2 ? 7.2 : n <= 4 ? 8.4 : 10;
  function seat(i, n) {
    const th = -2 * Math.PI * i / n, Rt = tableR(n), Rs = Rt - 1.7;
    return { th, Rs, d: new V3(Math.sin(th), 0, Math.cos(th)), r: new V3(Math.cos(th), 0, -Math.sin(th)) };
  }
  function buildWorld(n) {
    while (world.children.length) {
      const o = world.children.pop();
      o.traverse && o.traverse(x => { if (x.geometry) x.geometry.dispose(); });
    }
    tileMeshes.forEach(m => tileGroup.remove(m)); tileMeshes.clear();
    labelsEl.querySelectorAll('.b3d-pl, .b3d-dl').forEach(e => e.remove());
    builtN = n; const Rt = tableR(n);

    const edge = new THREE.MeshStandardMaterial({ color: 0x4a2f18, roughness: .7 });
    const topMat = new THREE.MeshStandardMaterial({ map: woodTex(), roughness: .75 });
    // CylinderGeometry 머티리얼 순서: 옆면, 윗면, 아랫면
    const top = new THREE.Mesh(new THREE.CylinderGeometry(Rt, Rt, 0.4, 72), [edge, topMat, edge]);
    top.position.y = -0.2; top.receiveShadow = true; world.add(top);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(Rt + 0.15, 0.34, 18, 96), new THREE.MeshStandardMaterial({ color: 0x6b4226, roughness: .5 }));
    rim.rotation.x = Math.PI / 2; rim.position.y = 0.02; rim.castShadow = true; world.add(rim);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(Rt + 0.5, Rt + 0.8, 0.5, 72), new THREE.MeshStandardMaterial({ color: 0x2b1810, roughness: .8 }));
    base.position.y = -0.62; world.add(base);

    seats = []; racks = [];
    for (let i = 0; i < n; i++) {
      const st = seat(i, n); seats.push(st);
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, 0.14, 0.75), new THREE.MeshStandardMaterial({ color: 0x6b4226, roughness: .5, emissive: 0x000000 }));
      m.position.copy(st.d).multiplyScalar(st.Rs); m.position.y = 0.07; m.rotation.y = st.th;
      m.castShadow = m.receiveShadow = true; world.add(m); racks.push(m);
    }

    deckMeshes = {};
    ['black', 'white'].forEach((c, k) => {
      const mat = new THREE.MeshStandardMaterial({ color: c === 'black' ? 0x17171a : 0xf2ede0, roughness: .5, emissive: 0x000000 });
      const m = new THREE.Mesh(new THREE.BoxGeometry(1.05, 1, 1.45), mat);
      m.castShadow = m.receiveShadow = true; m.position.set(k === 0 ? -1.25 : 1.25, 0.2, 0);
      world.add(m); deckMeshes[c] = m;
      const lab = document.createElement('div'); lab.className = 'b3d-dl'; lab.id = 'b3d-dl-' + c; labelsEl.appendChild(lab);
    });
    for (let i = 0; i < n; i++) {
      const d = document.createElement('div'); d.className = 'b3d-pl'; d.id = 'b3d-pl-' + i; labelsEl.appendChild(d);
    }
    fitCamera();
  }

  /* ---------- 카메라 ---------- */
  function fitCamera() {
    const W = appEl.clientWidth, H = appEl.clientHeight, asp = W / H, Rt = tableR(builtN || 4);
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const needW = (Rt + 1.4 * fit) / (t * Math.min(asp, 1.6)) * 0.98;
    const needH = (Rt * 1.15 + 2.5 * fit) / t * 0.62;
    cam.rad = Math.max(needW, needH) * zoom * fit;
  }
  function placeCamera() {
    const off = new V3(Math.sin(cam.pol) * Math.sin(cam.az), Math.cos(cam.pol), Math.sin(cam.pol) * Math.cos(cam.az)).multiplyScalar(cam.rad);
    camera.position.copy(cam.tgt).add(off); camera.lookAt(cam.tgt);
  }
  function resize() {
    const W = appEl.clientWidth, H = appEl.clientHeight;
    if (!W || !H) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(W, H, false);
    camera.aspect = W / H; camera.updateProjectionMatrix(); fitCamera();
  }

  /* ---------- 상태 → 장면 ---------- */
  const hiddenCount = p => (p.hand || []).filter(t => !t.revealed).length;
  const isDead = p => (p.hand || []).length > 0 && (p.hand || []).every(t => t.revealed);
  function rowScale(pi, len, n) {
    const st = seats[pi];
    if (pi === 0) return Math.min(1.1, 10.8 / (Math.max(len, 1) * TW * 1.1));
    const chord = n === 2 ? 10 : 2 * st.Rs * Math.sin(Math.PI / n) * 0.8;
    return Math.min(n === 2 ? 0.9 : 0.74, chord / (Math.max(len, 1) * TW * 1.1));
  }
  const deckSpawn = color => new V3(color === 'black' ? -1.25 : 1.25, 0.6, 0);
  function getMesh(t, spawnAt) {
    let m = tileMeshes.get(t.id);
    if (m) return m;
    const e = edgeMat[t.color];
    m = new THREE.Mesh(tileGeo, [e, e, e, e, e, e]);
    m.rotation.order = 'YXZ'; m.castShadow = true; m.receiveShadow = true;
    m.position.copy(spawnAt);
    m.userData = { tid: t.id, tgt: new V3().copy(spawnAt), sc: 1, scT: 1, tilt: 0, tiltT: 0, key: '' };
    tileGroup.add(m); tileMeshes.set(t.id, m); return m;
  }

  function sync3D() {
    const s = S; if (!s) return;
    if (builtN !== s.n) buildWorld(s.n);
    const picks = [];
    const targetKey = new Set((s.targets || []).map(t => t.pi + ':' + t.idx));
    const live = new Set();

    s.players.forEach((p, pi) => {
      const st = seats[pi], hand = p.hand || [], len = hand.length;
      const sc = rowScale(pi, len, s.n), sp = TW * 1.1 * sc;
      const stand = pi === 0 ? -0.42 : 0.42;
      const rack = racks[pi]; rack.scale.x = Math.max(2.4, len * sp + 0.9);

      hand.forEach((t, i) => {
        live.add(t.id);
        const m = getMesh(t, deckSpawn(t.color));
        const x = (i - (len - 1) / 2) * sp;
        // 공개된 타일은 세우지 않고 눕힌다. 비스듬한 시점에서 세워두면 숫자가 찌그러져 읽기 어렵다.
        const flat = !!t.revealed;
        const tilt = flat ? -Math.PI / 2 : stand;
        const pos = st.d.clone().multiplyScalar(st.Rs - (flat ? 1.5 : 0)).addScaledVector(st.r, x);
        pos.y = flat ? TD * sc / 2 + 0.02 : 0.14 + TH * sc / 2 * Math.cos(tilt);
        Object.assign(m.userData, { tgt: pos, scT: sc, tiltT: tilt, pi, idx: i, pick: null });
        m.rotation.y = st.th;

        const mine = pi === 0, reveal = t.revealed || s.over;
        const kind = reveal ? (t.revealed ? 'rev' : 'face') : (mine ? 'face' : (p.peek ? 'peek' : 'cover'));
        setFaces(m, t, mine || reveal ? kind : 'cover', kind);

        if (targetKey.has(pi + ':' + i)) m.userData.pick = { type: 'target', pi, idx: i };
        if (m.userData.pick) picks.push(m);
      });

      if (p.pending) {
        const t = p.pending; live.add(t.id);
        const m = getMesh(t, deckSpawn(t.color));
        // 내 쪽으로 더 당긴다. 테이블 가운데로 보내면 덱 더미와 겹쳐 둘 다 안 보인다.
        const pos = st.d.clone().multiplyScalar(st.Rs - (pi === 0 ? 1.5 : 2.4)); pos.y = pi === 0 ? 1.9 : 1.6;
        Object.assign(m.userData, { tgt: pos, scT: pi === 0 ? 1.15 : 0.8, tiltT: -0.55, pi, idx: -1, pick: null });
        m.rotation.y = st.th;
        setFaces(m, t, pi === 0 ? 'face' : 'cover', 'cover');
      }
      rack.material.emissive.setHex(!s.over && s.turn === pi ? 0x8a6a10 : 0x000000);
    });

    // 사라진 타일 정리 (판이 바뀌거나 사람이 나간 경우)
    tileMeshes.forEach((m, id) => { if (!live.has(id)) { tileGroup.remove(m); tileMeshes.delete(id); } });

    slotSprites.forEach(sp => scene.remove(sp)); slotSprites = [];
    const me = s.players[0];
    if (me && me.pending && (s.slots || []).length) {
      const st = seats[0], len = (me.hand || []).length, sc = rowScale(0, len, s.n), sp = TW * 1.1 * sc;
      s.slots.forEach(idx => {
        const spr = new THREE.Sprite(plusMat()); spr.scale.set(0.75, 0.75, 1);
        const x = (idx - len / 2) * sp;
        spr.position.copy(st.d).multiplyScalar(st.Rs).addScaledVector(st.r, x);
        spr.position.y = TH * sc + 0.75; spr.position.addScaledVector(st.d, 0.3);
        spr.userData.pick = { type: 'slot', idx };
        scene.add(spr); slotSprites.push(spr); picks.push(spr);
      });
    }

    ['black', 'white'].forEach(c => {
      const cnt = (s.decks && s.decks[c]) || 0, m = deckMeshes[c]; if (!m) return;
      const h = Math.max(0.02, cnt * 0.075);
      m.scale.y = h; m.position.y = h / 2; m.visible = cnt > 0;
      const el = document.getElementById('b3d-dl-' + c);
      if (el) el.textContent = (c === 'black' ? '검은 ' : '흰 ') + cnt;
      const can = !!s.canDraw && cnt > 0;
      m.material.emissive.setHex(can ? 0x8a6a10 : 0x000000);
      m.userData.pick = can ? { type: 'deck', color: c } : null;
      if (can) picks.push(m);
    });

    pickables = picks;
    renderLabels();
  }

  /* ---------- 라벨 ---------- */
  const _v = new V3();
  function project(v) {
    _v.copy(v).project(camera);
    return { x: (_v.x * .5 + .5) * appEl.clientWidth, y: (-_v.y * .5 + .5) * appEl.clientHeight };
  }
  function renderLabels() {
    if (!S) return;
    S.players.forEach((p, pi) => {
      const el = document.getElementById('b3d-pl-' + pi); if (!el) return;
      const dead = isDead(p), turn = !S.over && S.turn === pi;
      el.className = 'b3d-pl' + (turn ? ' turn' : '') + (dead ? ' dead' : '');
      const team = p.team ? `<span class="b3d-tag t${p.team}">팀 ${p.team}</span>` : '';
      el.innerHTML = `<span>${p.name || '?'}</span>${team}`
        + `<span class="b3d-cnt">남은 ${hiddenCount(p)}/${(p.hand || []).length}</span>`
        + (dead ? '<span class="b3d-tag">탈락</span>' : '');
    });
  }
  function updateLabels() {
    if (!S || builtN !== S.n) return;
    S.players.forEach((p, pi) => {
      const el = document.getElementById('b3d-pl-' + pi); if (!el) return;
      const st = seats[pi];
      // 내 이름표는 패 위가 아니라 패 앞(화면 아래)에 둔다. 위에 두면 내 타일 숫자를 가린다.
      const a = st.d.clone().multiplyScalar(pi === 0 ? st.Rs + 1.6 : st.Rs + 1.15);
      a.y = pi === 0 ? 0.35 : 1.15;
      const q = project(a), W = appEl.clientWidth, hw = el.offsetWidth / 2 + 4;
      el.style.left = Math.min(Math.max(q.x, hw), W - hw) + 'px'; el.style.top = q.y + 'px';
    });
    ['black', 'white'].forEach(c => {
      const m = deckMeshes[c]; if (!m) return;
      const q = project(new V3(m.position.x, m.position.y + m.scale.y / 2 + 0.55, 0.9));
      const el = document.getElementById('b3d-dl-' + c);
      if (el) { el.style.left = q.x + 'px'; el.style.top = q.y + 'px'; }
    });
  }

  /* ---------- 프레임 ---------- */
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05), k = 1 - Math.exp(-dt * 9);
    tileMeshes.forEach(m => {
      const u = m.userData;
      const lift = (hover === m && u.pick) ? 0.35 : 0;
      m.position.x += (u.tgt.x - m.position.x) * k;
      m.position.y += (u.tgt.y + lift - m.position.y) * k;
      m.position.z += (u.tgt.z - m.position.z) * k;
      u.sc += (u.scT - u.sc) * k; m.scale.setScalar(u.sc);
      u.tilt += (u.tiltT - u.tilt) * k; m.rotation.x = u.tilt;
    });
    placeCamera(); updateLabels();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }

  /* ---------- 입력 ---------- */
  const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
  const pointers = new Map();
  function pick(ev) {
    const r = canvas.getBoundingClientRect();
    mouse.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(mouse, camera);
    const hits = ray.intersectObjects(pickables, false).filter(h => h.object.userData.pick);
    return hits.length ? hits[0].object : null;
  }
  function bindInput() {
    canvas.addEventListener('pointerdown', e => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false });
    });
    canvas.addEventListener('pointermove', e => {
      const p = pointers.get(e.pointerId);
      if (!p) { const h = pick(e); if (h !== hover) { hover = h; canvas.style.cursor = h ? 'pointer' : 'grab'; } return; }
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 6) p.moved = true;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]; const before = Math.hypot(a.x - b.x, a.y - b.y);
        p.x = e.clientX; p.y = e.clientY; const after = Math.hypot(a.x - b.x, a.y - b.y);
        if (before > 0) { zoom = THREE.MathUtils.clamp(zoom * before / after, 0.55, 1.5); fitCamera(); }
      } else if (p.moved) {
        cam.az = THREE.MathUtils.clamp(cam.az - dx * 0.006, -1.3, 1.3);
        cam.pol = THREE.MathUtils.clamp(cam.pol - dy * 0.005, 0.35, 1.3);
        p.x = e.clientX; p.y = e.clientY;
      }
    });
    const end = e => {
      const p = pointers.get(e.pointerId); pointers.delete(e.pointerId);
      if (p && !p.moved && e.type === 'pointerup' && pointers.size === 0) {
        const h = pick(e); if (h && pickCb) pickCb(h.userData.pick);
      }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', e => {
      e.preventDefault(); zoom = THREE.MathUtils.clamp(zoom * (e.deltaY > 0 ? 1.08 : 0.92), 0.55, 1.5); fitCamera();
    }, { passive: false });
    window.addEventListener('resize', resize);
  }

  /* ---------- 공개 API ---------- */
  return {
    mount(opts) {
      if (renderer) return;
      canvas = opts.canvas; appEl = opts.app; labelsEl = opts.labels;
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      renderer.outputEncoding = THREE.sRGBEncoding;
      renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
      scene.add(new THREE.HemisphereLight(0xfff1d0, 0x2a1a10, 0.85));
      const sun = new THREE.DirectionalLight(0xfff3dc, 0.9);
      sun.position.set(5, 16, 9); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
      Object.assign(sun.shadow.camera, { left: -13, right: 13, top: 13, bottom: -13, near: 1, far: 40 });
      sun.shadow.bias = -0.0004; scene.add(sun);
      world = new THREE.Group(); scene.add(world);
      tileGroup = new THREE.Group(); scene.add(tileGroup);
      tileGeo = new THREE.BoxGeometry(TW, TH, TD);
      clock = new THREE.Clock();
      bindInput(); resize(); frame();
    },
    update(state) { S = state; resize(); sync3D(); },
    onPick(fn) { pickCb = fn; },
    resetCam() { cam.az = 0; cam.pol = 0.92; zoom = 1; fitCamera(); },
    setFit(f) { fit = f; fitCamera(); },
    setGlyph(g) {
      glyph = g;
      // 면 머티리얼은 캐시되고 타일은 '바뀐 게 없으면 넘어간다'로 판단하므로 둘 다 풀어줘야 다시 그려진다
      matCache.clear();
      tileMeshes.forEach(m => { m.userData.key = ''; });
      sync3D();
    },
  };
})();
