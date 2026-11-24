/* Action Project PRO — 3D theme (beta): Holo HUD
   Loaded only for the beta account, only when the 3D appearance is picked (see the gate script in index.html).
   Sits on top of the existing app: reads Store, calls openJob(); never changes data.
   Efficiency rules used here:
   - one WebGL renderer for the whole app; its canvas moves between the Jobs scene and the job drawer
   - render on demand (only after data, size, drag or a short tween); the idle core spin runs at 24 fps only while visible
   - pixel ratio capped (2 desktop, 1.5 touch) and stepped down automatically on slow devices; no shadows; flat shapes
   - 3D shows status and size at a glance; all numbers and actions stay in the normal 2D app
   - camera turn is clamped (no free orbit) so nobody gets lost; prefers-reduced-motion skips animations */
import * as THREE from './three.module.min.js';

const C = 'D';
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const touch = matchMedia('(hover: none) and (pointer: coarse)').matches;
const root = document.documentElement;
root.classList.add('t3d', 't3d-D', 'dark');   // the HUD is a display: always dark
const phone = () => innerWidth <= 640;

const STAGES = ['New bid', 'Bid build', 'Quote sent', 'Awarded', 'COs & material', 'Complete'];
const SHORT = ['New', 'Build', 'Sent', 'Won', 'Active', 'Done'];
const sn = i => `<span class="full">${STAGES[i]}</span><span class="short">${SHORT[i]}</span>`;
const SCOL = ['#94a3b8', '#7c3aed', '#d97706', '#16a34a', '#2563eb', '#e8a317'];
const SCOLD = ['#64748b', '#a78bfa', '#f59e0b', '#22c55e', '#60a5fa', '#e8a317'];
const dark = () => root.classList.contains('dark');
const sc = i => (dark() ? SCOLD : SCOL)[i];

function stageOf(j) {
  if (j.completedDate) return 5;
  if (j.bidStatus === 'Awarded') return (j.materials.length || j.labor.length || j.changeOrders.length || childrenOf(j.id).length) ? 4 : 3;
  if (j.bidStatus === 'Bid Sent') return 2;
  if (j.bidStatus === 'Estimating') return (j.quotes.length || j.estLabor.length || +j.bidTotal > 0) ? 1 : 0;
  return -1; // Lost / No Bid stay out of the 3D view
}
const money0 = v => '$' + Math.round(v).toLocaleString('en-US');
const kmoney = v => v >= 1e6 ? '$' + (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? '$' + Math.round(v / 1e3) + 'k' : '$' + Math.round(v);

/* ---------- one renderer ---------- */
const renderer = new THREE.WebGLRenderer({ antialias: !touch, alpha: true, powerPreference: 'low-power' });
renderer.setPixelRatio(Math.min(devicePixelRatio, touch ? 1.5 : 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const canvas = renderer.domElement; canvas.className = 't3dcv';
canvas.style.opacity = 0;   // fades in over the saved picture (instant first frame)
const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();

function hostEl(id, cls, label) {
  const h = document.createElement('div'); h.id = id; h.className = 't3dhost ' + cls;
  h.innerHTML = `<div class="t3dlbls"></div><div class="t3dcap">${label}</div>`;
  return h;
}
const hero = hostEl('t3dHero', 'hero', '');
document.getElementById('kpis').before(hero);

/* view = {scene, camera, host, fit(), labels:[{obj|pos, html, cls}], pick:[mesh] , yaw} */
let view = null, dirty = false, tweens = [], tilting = false, shown = false, idleT = 0;
function show(v) {
  view = v; v.host.prepend(canvas); sizeTo(v); request();
}
function sizeTo(v) {
  const r = v.host.getBoundingClientRect(); if (!r.width) return;
  renderer.setSize(r.width, r.height, false);
  canvas.style.width = r.width + 'px'; canvas.style.height = r.height + 'px';
  v.fit(r.width, r.height);
}
function request() { if (!dirty) { dirty = true; requestAnimationFrame(frame); } }
/* auto quality: watch frame times while something moves; step down if a device can't keep up */
const TIERS = [Math.min(devicePixelRatio, touch ? 1.5 : 2), 1.25, 1, .75];
const QS = new URLSearchParams(location.search), AUTO = !QS.has('noauto');
let tier = +(QS.get('tier') || 0), lastT = 0, dts = [];
function setTier(n) { tier = n; renderer.setPixelRatio(Math.min(devicePixelRatio, TIERS[n])); root.classList.toggle('t3dlow', n >= 2); view && sizeTo(view); dts = []; }
function frame(t) {
  dirty = false; if (!view) return;
  if (lastT && t - lastT < 80 && (tweens.length || drag)) { dts.push(t - lastT); if (dts.length > 40) dts.shift(); if (AUTO && dts.length === 40 && tier < 3 && dts.reduce((a, b) => a + b) / 40 > 24) setTier(tier + 1); }
  lastT = t;
  tweens = tweens.filter(tw => { const k = Math.min(1, (t - (tw.t0 ??= t)) / tw.ms); tw.step(1 - Math.pow(1 - k, 3)); return k < 1; });
  renderer.render(view.scene, view.camera);
  placeLabels(view);
  if (view.idle && !reduce && tier < 2 && !document.hidden) { view.idle(Math.min((t - (view._it || t)) / 1000, .1)); view._it = t; clearTimeout(idleT); idleT = setTimeout(request, 42); }
  if (tweens.length || tilting) request(); else { lastT = 0; if (view === heroView) snapLater(); }
  if (!shown && view === heroView) { shown = true; canvas.style.opacity = 1; setTimeout(() => { if (!hero.classList.contains('frozen')) hero.style.backgroundImage = ''; }, 700); }
}
function tween(ms, step) { if (reduce) { step(1); return; } tweens.push({ ms, step }); request(); }
new ResizeObserver(() => view && (sizeTo(view), request())).observe(document.body);

const v3 = new THREE.Vector3();
function placeLabels(v) {
  const box = v.host.querySelector('.t3dlbls'), r = v.host.getBoundingClientRect();
  if (!v._lbl) { box.innerHTML = v.labels.map(l => `<div class="t3dl ${l.cls || ''}">${l.html}</div>`).join(''); v._lbl = [...box.children]; }
  v.labels.forEach((l, i) => {
    (l.obj ? l.obj.getWorldPosition(v3) : v3.copy(l.pos)); if (l.dy) v3.y += l.dy;
    v3.project(v.camera);
    const el = v._lbl[i], x = (v3.x + 1) / 2 * r.width, y = (1 - v3.y) / 2 * r.height;
    const cl = el.classList;
    el.style.transform = `translate(${x}px,${y}px) ` + (cl.contains('gr') ? 'translate(0,-50%)' : cl.contains('gl') ? 'translate(-100%,-50%)' : `translate(-50%,${cl.contains('st') ? '4px' : '-100%'})`);
    el.style.opacity = v3.z > 1 ? 0 : '';
  });
}

/* drag to turn (clamped) + tap to open a job */
let drag = null;
canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, yaw: view.yaw || 0, moved: false }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', e => {
  if (!drag || !view.turn) return;
  const dx = e.clientX - drag.x; if (Math.abs(dx) > 4) drag.moved = true;
  view.yaw = Math.max(-0.55, Math.min(0.55, drag.yaw + dx * 0.004)); view.turn(view.yaw); request();
});
function pickAt(e) {
  if (!view || !view.pick) return null;
  const r = canvas.getBoundingClientRect();
  ptr.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
  ray.setFromCamera(ptr, view.camera);
  const hit = ray.intersectObjects(view.pick, false)[0];
  return hit ? hit.object : null;
}
canvas.addEventListener('pointerup', e => {
  const d = drag; drag = null; if (!d || d.moved || !view.pick) return;
  const o = pickAt(e), id = o && o.userData.id;
  if (!id) return select(null);
  if (view === heroView && selId !== id) select(id, o); else openJob(id);   // 1st tap = preview card, 2nd tap = open
});
/* hover name tag (mouse only); costs one raycast per move, no re-render */
const tip = document.createElement('div'); tip.className = 't3dtip'; tip.hidden = true;
canvas.addEventListener('pointermove', e => {
  if (e.pointerType !== 'mouse' || drag || !view || !view.pick) return;
  const o = pickAt(e), j = o && Store.get(o.userData.id);
  canvas.style.cursor = j ? 'pointer' : '';
  if (!j) { tip.hidden = true; return; }
  if (tip.parentNode !== view.host) view.host.appendChild(tip);
  const r = view.host.getBoundingClientRect();
  tip.innerHTML = `<b>${esc(j.name)}</b><span>${esc(j.sv || '')} · ${kmoney(val(j))}</span>`;
  tip.style.transform = `translate(${e.clientX - r.left + 14}px,${e.clientY - r.top + 14}px)`; tip.hidden = false;
});
canvas.addEventListener('pointerleave', () => { tip.hidden = true; });

/* selected job: glow ring in 3D + a 2D card with the numbers and an Open button */
let selId = null, ring = null;
function select(id, obj) {
  selId = id; const card = document.getElementById('t3dSel');
  if (ring) { ring.parent && ring.parent.remove(ring); ring = null; }
  if (!id || !heroView) { card.hidden = true; request(); return; }
  obj = obj || heroView.pick.find(o => o.userData.id === id);
  if (obj) {
    const bb = new THREE.Box3().setFromObject(obj), c = bb.getCenter(new THREE.Vector3()), rr = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * .75 + .12;
    ring = new THREE.Mesh(new THREE.RingGeometry(rr, rr + .09, 40), new THREE.MeshBasicMaterial({ color: C === 'D' ? '#4fd8ff' : '#e8a317', side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(c.x, bb.min.y + .03, c.z); heroView.scene.add(ring);
    tween(420, k => { ring && ring.scale.setScalar(.6 + .4 * k); request(); });
  }
  const j = Store.get(id), st = stageOf(j), t = totals(j), aw = st >= 3;
  card.innerHTML = `<button class="x" aria-label="Close">✕</button>
    <div class="k">${esc(jidLabel ? jidLabel(j) : j.sv)} · <span style="color:${sc(st)}">●</span> ${STAGES[st]}</div>
    <h3>${esc(j.name)}</h3>
    <div class="nums">${aw ? `<div><b>${money0(t.revised)}</b><span>Revised</span></div><div><b>${money0(t.mat + t.lab + t.trav)}</b><span>Spent</span></div><div><b class="${t.remaining < 0 ? 'neg' : 'pos'}">${money0(t.remaining)}</b><span>Remaining</span></div>`
      : `<div><b>${val(j) ? money0(val(j)) : '—'}</b><span>Bid</span></div><div><b>${j.pct || 0}%</b><span>Estimate</span></div><div><b>${j.sentDate ? fdate(j.sentDate) : '—'}</b><span>Sent</span></div>`}</div>
    <div class="steps">${STAGES.map((n, i) => `<i class="${i < st ? 'd' : i === st ? 'on' : ''}" title="${n}"></i>`).join('')}</div>
    <button class="open">Open job</button>`;
  card.hidden = false;
  card.querySelector('.x').onclick = () => select(null);
  card.querySelector('.open').onclick = () => openJob(id);
  request();
}

/* ---------- shared bits ---------- */
const matCache = {};
function mat(color, o = {}) {
  const k = color + JSON.stringify(o);
  return matCache[k] ||= new THREE.MeshStandardMaterial(Object.assign({ color, roughness: .55, metalness: .05 }, o));
}
function lights(scene, strong = 1) {
  scene.add(new THREE.HemisphereLight(0xffffff, dark() ? 0x1a1f2b : 0xd9dde6, dark() ? 1.25 : 1.9 * strong));
  const d = new THREE.DirectionalLight(0xffffff, dark() ? 1.6 : 1.9); d.position.set(4, 9, 6); scene.add(d);
}
function box(w, h, d, m, x = 0, y = 0, z = 0) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); return b;
}
function cyl(r, h, m, seg = 20) { return new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), m); }
function persp(fov, pos, look) {
  const cam = new THREE.PerspectiveCamera(fov, 1, .1, 200); cam.position.copy(pos); cam.lookAt(look); cam.userData.base = pos.clone(); cam.userData.look = look.clone(); return cam;
}
function orbitTurn(cam) {
  return yaw => { const b = cam.userData.base, L = cam.userData.look, dx = b.x - L.x, dz = b.z - L.z, rr = Math.hypot(dx, dz), a = Math.atan2(dx, dz) + yaw;
    cam.position.set(L.x + Math.sin(a) * rr, b.y, L.z + Math.cos(a) * rr); cam.lookAt(L); };
}
function fitPersp(cam, wideZoom, tallZoom) {
  return (w, h) => { cam.aspect = w / h; const z = w / h < 1.25 ? tallZoom : wideZoom; cam.zoom = z; cam.updateProjectionMatrix(); };
}
/* fit the camera to whatever is in the scene, for any screen shape */
function fitAuto(cam, scene, topPad = 64, botPad = 34, margin = .96, sidePad = 0) {
  const pts = [], by = [], bb = new THREE.Box3();
  scene.updateMatrixWorld(true);
  scene.traverse(o => { if (!o.isMesh || o.userData.nofit || o.material.visible === false) return; bb.setFromObject(o);
    for (let i = 0; i < 8; i++) { const p = new THREE.Vector3(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z); pts.push(p); if (o.userData.st != null) (by[o.userData.st] ||= []).push(p); } });
  let W = 1, H = 1, cur = null, focus = -1;
  const pads = () => { const small = H < 260, TP = typeof topPad === 'function' ? topPad() : topPad, BP = typeof botPad === 'function' ? botPad() : botPad, SP = typeof sidePad === 'function' ? sidePad() : sidePad; return [small ? TP * .7 : TP, small ? BP * .8 : BP, SP]; };
  function solve(P, mg) {
    const a = W / H, [tp, bp, sp] = pads();
    if (cam.isOrthographicCamera) { cam.left = -a; cam.right = a; cam.top = 1; cam.bottom = -1; } else cam.aspect = a;
    cam.clearViewOffset(); cam.zoom = 1; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    let x0 = 9, x1 = -9, y0 = 9, y1 = -9;
    P.forEach(p => { const q = p.clone().project(cam); x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); });
    const hx = (x1 - x0) / 2, hy = (y1 - y0) / 2, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, avail = (H - tp - bp) / H;
    const z = mg * Math.min((W - 2 * sp) / W / hx, avail / hy), ty = 1 - 2 * (tp + (H - tp - bp) / 2) / H;
    return { z, ox: cx * z * W / 2, oy: -(cy * z - ty) * H / 2 };
  }
  function apply(t) { cam.zoom = t.z; cam.updateProjectionMatrix(); cam.setViewOffset(W, H, t.ox, t.oy, W, H); cam.updateProjectionMatrix(); cur = t; }
  const target = () => focus >= 0 && by[focus] ? solve(by[focus], .72) : solve(pts, margin);
  const fit = (w, h) => { W = w; H = h; apply(target()); };
  fit.focus = i => { if (!cur) return; const from = { ...cur }; focus = i; const to = target(); apply(from);
    tween(reduce ? 1 : 750, k => { apply({ z: from.z + (to.z - from.z) * k, ox: from.ox + (to.ox - from.ox) * k, oy: from.oy + (to.oy - from.oy) * k }); request(); }); };
  fit.focused = () => focus;
  fit.center = i => { const b = new THREE.Box3().setFromPoints(by[i] || pts), c = b.getCenter(new THREE.Vector3()); c.y = .2; return c; };
  return fit;
}
const heroTop = () => { const u = hero.querySelector('.t3dui'); return u ? u.offsetTop + u.offsetHeight + (narrow() ? 18 : 46) : 64; };
const heroBot = () => narrow() ? (read.offsetHeight || 120) + 16 : 40;
const heroSide = () => narrow() ? 6 : 246;
function ground(scene) { // a floor that fades into the background so the board sits in a space, not in the void
  const bg = dark() ? '#0d1016' : '#f3f4f7';
  scene.fog = new THREE.Fog(bg, 30, 70);
  const g = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ color: dark() ? '#11151d' : '#eceef2' }));
  g.rotation.x = -Math.PI / 2; g.position.y = -.3; g.userData.nofit = true; scene.add(g);
  const grid = new THREE.GridHelper(200, 100, dark() ? 0x1d2430 : 0xdfe3ea, dark() ? 0x161b24 : 0xe6e9ee); grid.position.y = -.29; grid.userData.nofit = true; scene.add(grid);
}
// stations wrap into rows so the board fills any screen: 6 across on very wide, 3x2 on desktop/tablet, 2x3 on phones
function gridOf(px, pz, snake) {
  const a = hero.clientWidth / Math.max(hero.clientHeight - heroTop() - heroBot(), 1);
  const cols = a > 2.3 ? 6 : a > .95 ? 3 : 2, rows = 6 / cols;
  return { cols, rows, at: i => { const r = Math.floor(i / cols); let c = i % cols; if (snake && r % 2) c = cols - 1 - c;
    return { x: (c - (cols - 1) / 2) * px, z: (r - (rows - 1) / 2) * pz, r, c }; } };
}
const top = () => (filter === 'Trash' ? [] : visibleJobs()).filter(j => !isChild(j) && stageOf(j) >= 0);
const allMax = () => Math.max(...topJobs().map(j => val(j)), 1);   // stable sizes while filtering
const LBL = () => narrow() ? 0 : 1;                 // more name tags when the scene is full screen
function slots(n, W, D) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(n * W / D))), rows = Math.ceil(n / cols), step = Math.min(W / cols, D / rows);
  return k => ({ x: ((k % cols) - (cols - 1) / 2) * step, z: (Math.floor(k / cols) - (rows - 1) / 2) * step, size: step });
}
const hgt = (v, max, H) => .25 + Math.sqrt(v / max) * H;   // sqrt keeps small jobs visible; exact $ is in the label
const val = j => Math.max(+j.bidTotal || 0, totals(j).revised || 0);

/* ======================================================================
   D · HOLO HUD — an original holographic heads-up display: dark space, a radial
   stage dial around a live core, every job a glowing wireframe column
   ====================================================================== */
const HUD = { cyan: '#4fd8ff', dim: '#1b5a73', bg: '#03070d', st: ['#8fb3d9', '#b197ff', '#ffc24d', '#3dfcb0', '#4fd8ff', '#ffe27a'] };
const hcol = i => HUD.st[i];
const glow = (c, o = 1) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
const lineM = (c, o = 1) => new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
function holoBox(w, h, d, c, fillO = .14) {
  const g = new THREE.Group(), geo = new THREE.BoxGeometry(w, h, d);
  const f = new THREE.Mesh(geo, glow(c, fillO)); g.add(f);
  const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), lineM(c, .95)); g.add(e);
  g.userData.fill = f; return g;
}
function arcLine(r, a0, a1, c, o = 1, y = .02, seg = 48) {
  const pts = []; for (let k = 0; k <= seg; k++) { const a = a0 + (a1 - a0) * k / seg; pts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r)); }
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineM(c, o));
}
function hudFloor(scene, R) {
  scene.fog = new THREE.FogExp2(HUD.bg, .028);
  const pg = new THREE.PolarGridHelper(R, 24, 8, 96, HUD.dim, '#0d2a38'); pg.material.transparent = true; pg.material.opacity = .55; pg.userData.nofit = true; scene.add(pg);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(R, 96), new THREE.MeshBasicMaterial({ color: '#051019', transparent: true, opacity: .9 }));
  disc.rotation.x = -Math.PI / 2; disc.position.y = -.02; disc.userData.nofit = true; scene.add(disc);
}
function hudCore(scene, labels, title, sub) {
  const core = new THREE.Group(); scene.add(core);
  [[1.0, .05, 0], [1.45, .03, .5], [1.9, .02, -.35]].forEach(([r, t, tilt], k) => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, t, 6, 90, Math.PI * (1.4 + k * .2)), glow(HUD.cyan, .85));
    ring.rotation.x = Math.PI / 2 + tilt * .25; ring.position.y = .05 + k * .04; ring.userData.spin = (k % 2 ? -1 : 1) * (.25 + k * .15); core.add(ring);
  });
  const hub = new THREE.Mesh(new THREE.CircleGeometry(.7, 6).rotateX(-Math.PI / 2), glow(HUD.cyan, .25)); hub.position.y = .03; core.add(hub);
  const ctr = new THREE.Object3D(); ctr.position.set(0, .2, -2.4); core.add(ctr);
  labels.push({ obj: ctr, html: `${title}<small>${sub}</small>`, cls: 'core' });
  return core;
}
/* alerts: red = over budget or a bid that is overdue; amber = close to budget, a bid getting old, or a sent bid to follow up */
const RED = '#ff4d5e', AMBER = '#ffb020', DAYMS = 864e5;
const ageDays = d => d ? Math.floor((Date.now() - new Date(d + 'T12:00:00')) / DAYMS) : -1;
function alertOf(j) {
  const st = stageOf(j);
  if (st >= 3 && st < 5) {
    const t = totals(j), spent = t.mat + t.lab + t.trav;
    if (t.revised > 0 && t.remaining < 0) return { lvl: 'red', txt: 'Over budget ' + kmoney(-t.remaining) };
    if (t.revised > 0 && spent / t.revised >= .9) return { lvl: 'amber', txt: Math.round(spent / t.revised * 100) + '% spent' };
  }
  if (j.bidStatus === 'Estimating') {
    const d = ageDays(j.startDate);
    if (d > 21) return { lvl: 'red', txt: 'Bid open ' + d + ' days' };
    if (d > 10) return { lvl: 'amber', txt: 'Bid open ' + d + ' days' };
  }
  if (j.bidStatus === 'Bid Sent') {
    const d = ageDays(j.sentDate || j.startDate);
    if (d > 30) return { lvl: 'amber', txt: 'Sent ' + d + ' days ago, follow up' };
  }
  return null;
}
const acol = a => a ? (a.lvl === 'red' ? RED : AMBER) : null;

/* a job on the HUD: flat hexagon blip; size = bid; outer ring fills with money spent (awarded) or estimate % (bidding) */
function flatMarker(rad, c, j, st) {
  const g = new THREE.Group(), al = alertOf(j), ac = acol(al);
  const hexG = new THREE.CircleGeometry(rad, 6); hexG.rotateX(-Math.PI / 2);
  g.add(new THREE.Mesh(hexG, glow(ac || c, ac ? .3 : .22)));
  const edge = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 6 }, (_, k) => new THREE.Vector3(Math.cos(k * Math.PI / 3) * rad, .005, Math.sin(k * Math.PI / 3) * rad))), lineM(ac || c, 1)); g.add(edge);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(rad * .22, 16).rotateX(-Math.PI / 2), glow('#ffffff', .9)); dot.position.y = .01; g.add(dot);
  const t = totals(j), f = st >= 3 ? Math.min(1, (t.mat + t.lab + t.trav) / Math.max(t.revised, 1)) : st === 5 ? 1 : Math.min(1, (+j.pct || 0) / 100);
  const R = rad * 1.28, track = new THREE.Mesh(new THREE.RingGeometry(R, R + .05, 48).rotateX(-Math.PI / 2), glow(c, .18)); g.add(track);
  if (f > 0) { const fill = new THREE.Mesh(new THREE.RingGeometry(R, R + .07, 48, 1, Math.PI / 2, -Math.PI * 2 * f).rotateX(-Math.PI / 2), glow(ac || c, 1)); fill.position.y = .006; g.add(fill); }
  if (ac) { // warning halo, pulses gently while the HUD idles
    const halo = new THREE.Mesh(new THREE.RingGeometry(R + .16, R + .24, 6).rotateX(-Math.PI / 2), glow(ac, .8)); halo.position.y = .008; halo.userData.pulse = 1; g.add(halo); g.userData.halo = halo;
  }
  const hit = new THREE.Mesh(new THREE.CylinderGeometry(R + .12, R + .12, .25, 12), new THREE.MeshBasicMaterial({ visible: false })); hit.position.y = .12; g.add(hit); g.userData.hit = hit;
  return g;
}
let booted = false;   // the power-up (radar sweep + panels drawing in) plays once per page load
function boardD() {
  const stStart = [];
  function tagStations(sc) { stStart.forEach((n0, i) => sc.children.slice(n0, stStart[i + 1] ?? sc.children.length).forEach(o => o.traverse(x => x.userData.st = i))); }
  const scene = new THREE.Scene(); scene.background = null;
  scene.add(new THREE.AmbientLight(0xffffff, 1));
  const J = top(), max = allMax(), labels = [], pick = [], R0 = 3.0, R1 = 10, markers = [], halos = [];
  hudFloor(scene, R1 + 2.5);
  const T = topJobs(), backlog = T.filter(j => j.bidStatus === 'Awarded' && !j.completedDate).reduce((a, j) => a + totals(j).remaining, 0);
  const out = T.filter(j => j.bidStatus === 'Bid Sent').reduce((a, j) => a + val(j), 0);
  const core = hudCore(scene, labels, 'Pipeline ' + kmoney(out), 'backlog ' + kmoney(backlog));
  // outer tick ring
  for (let k = 0; k < 120; k++) { const a = k / 120 * Math.PI * 2, r = R1 + 1.1, l = k % 5 ? .18 : .45;
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(Math.cos(a) * r, .02, Math.sin(a) * r), new THREE.Vector3(Math.cos(a) * (r + l), .02, Math.sin(a) * (r + l))]);
    const t = new THREE.Line(g, lineM(HUD.cyan, k % 5 ? .25 : .6)); t.userData.nofit = true; scene.add(t); }
  // a faint outer ring just past the stage names, so the camera fit leaves room for them
  { const o = new THREE.Mesh(new THREE.RingGeometry(R1 + 1.75, R1 + 1.8, 120).rotateX(-Math.PI / 2), glow(HUD.cyan, .12)); o.position.y = .01; scene.add(o); }
  const span = Math.PI * 2 / 6, gap = .06, start = -Math.PI / 2 - span / 2; // New bid at the back, flow runs clockwise
  STAGES.forEach((n, i) => {
    stStart[i] = scene.children.length;
    const a0 = start + i * span + gap, a1 = start + (i + 1) * span - gap, am = (a0 + a1) / 2, c = hcol(i);
    const sector = new THREE.Mesh(new THREE.RingGeometry(R0, R1, 40, 1, a0, a1 - a0), glow(c, .05)); sector.rotation.set(Math.PI / 2, 0, 0); scene.add(sector);
    scene.add(arcLine(R1, a0, a1, c, .9), arcLine(R0, a0, a1, c, .5), arcLine(R1 + .35, a0 + .04, a1 - .04, c, .35));
    [a0, a1].forEach(a => scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(Math.cos(a) * R0, .02, Math.sin(a) * R0), new THREE.Vector3(Math.cos(a) * R1, .02, Math.sin(a) * R1)]), lineM(c, .35))));
    const here = J.filter(j => stageOf(j) === i).sort((a, b) => val(b) - val(a));
    const sum = here.reduce((a, j) => a + val(j), 0), nAl = here.filter(alertOf).length;
    labels.push({ pos: new THREE.Vector3(Math.cos(am) * (R1 + 1.0), 0, Math.sin(am) * (R1 + 1.0)), html: `${sn(i)}<b>${here.length}</b>${sum ? '<em>' + kmoney(sum) + '</em>' : ''}`, cls: 'st' });
    // polar slots inside the sector: rows outward, columns across
    const n2 = here.length, rows = Math.max(1, Math.ceil(Math.sqrt(n2 * .8))), cols = Math.ceil(n2 / rows || 1);
    here.forEach((j, k) => {
      const r = R0 + .9 + (Math.floor(k / cols) + .5) * ((R1 - R0 - 1.4) / rows), a = a0 + .12 + ((k % cols) + .5) * ((a1 - a0 - .24) / cols);
      const x = Math.cos(a) * r, z = Math.sin(a) * r, cell = Math.min((R1 - R0 - 1.4) / rows, r * (a1 - a0 - .24) / cols);
      const rad = Math.min(cell * .42, .16 + .5 * Math.sqrt(val(j) / max));   // marker size = bid (area)
      const mk = flatMarker(rad, c, j, i); mk.position.set(x, .03, z); mk.userData.a = ((a - start) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2); scene.add(mk); markers.push(mk);
      if (mk.userData.halo) halos.push(mk.userData.halo);
      mk.userData.hit.userData.id = j.id; pick.push(mk.userData.hit);
      if (k < LBL() && val(j)) labels.push({ obj: mk.userData.hit, dy: .2, html: `${esc(j.name).slice(0, 20)}<small>${kmoney(val(j))}</small>` });
    });
  });
  tagStations(scene);
  // narrow screens look more straight down so the dial fills the width
  const tall = hero.clientWidth / Math.max(hero.clientHeight, 1) < 1;
  const cam = persp(38, tall ? new THREE.Vector3(0, 19, 7.5) : new THREE.Vector3(0, 16, 12.5), new THREE.Vector3(0, 0, tall ? .2 : .4));
  const v = { scene, camera: cam, host: hero, labels, pick, turn: orbitTurn(cam), fit: fitAuto(cam, scene, heroTop, heroBot, .97, heroSide) };
  let ph = 0;
  v.idle = dt => { core.children.forEach(o => { if (o.userData.spin) o.rotation.z += o.userData.spin * dt; });
    ph += dt; const k = .45 + .45 * Math.abs(Math.sin(ph * 2.2)); halos.forEach(h => h.material.opacity = k); };
  // power-up: a radar sweep runs once around the dial and switches the markers on as it passes
  v.boot = () => {
    if (booted || reduce) return; booted = true;
    const sweep = new THREE.Mesh(new THREE.RingGeometry(R0 * .3, R1 + 1.1, 48, 1, 0, .55).rotateX(-Math.PI / 2), glow(HUD.cyan, .28)); sweep.userData.nofit = true; sweep.position.y = .04; scene.add(sweep);
    const edge = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(R0 * .3, 0, 0), new THREE.Vector3(R1 + 1.1, 0, 0)]), lineM('#ffffff', .9)); edge.position.y = .05; scene.add(edge);
    markers.forEach(m => m.scale.setScalar(.001));
    tween(1700, k => { const a = k * Math.PI * 2; sweep.rotation.y = -(start + a); edge.rotation.y = -(start + a);
      markers.forEach(m => { const d = a - m.userData.a; m.scale.setScalar(d < 0 ? .001 : Math.min(1, .3 + d * 3)); });
      sweep.material.opacity = .28 * (1 - Math.max(0, k - .8) * 5); edge.material.opacity = .9 * (1 - Math.max(0, k - .8) * 5);
      if (k >= 1) { scene.remove(sweep, edge); markers.forEach(m => m.scale.setScalar(1)); }
      request(); });
  };
  return v;
}
function jobD(j, host) {
  const scene = new THREE.Scene(); scene.add(new THREE.AmbientLight(0xffffff, 1));
  const ph = phone(), s = Math.max(stageOf(j), 0), t = totals(j), b = bidBuild(j), labels = [], step = ph ? 1.25 : 2.2, hr = ph ? .3 : .42;
  const grid = new THREE.GridHelper(16, 32, HUD.dim, '#0b2533'); grid.material.transparent = true; grid.material.opacity = .5; grid.userData.nofit = true; scene.add(grid);
  STAGES.forEach((n, i) => {
    const x = (i - 2.5) * step, on = i <= s, c = on ? hcol(i) : '#24465a';
    const hex = new THREE.Mesh(new THREE.CylinderGeometry(hr, hr, .06, 6), glow(c, on ? .35 : .12)); hex.position.set(x, .03, 0); scene.add(hex);
    { const e = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.CylinderGeometry(hr, hr, .06, 6)), lineM(c, on ? 1 : .4)); e.position.set(x, .03, 0); scene.add(e); }
    if (i < 5) { const ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x + hr + .03, .03, 0), new THREE.Vector3(x + step - hr - .03, .03, 0)]), lineM(i < s ? hcol(i) : '#24465a', .9)); scene.add(ln); }
    labels.push({ pos: new THREE.Vector3(x, 0, ph ? .5 : .75), html: sn(i), cls: 'st' + (i === s ? ' on' : '') + (i < s ? ' done' : '') });
  });
  // the dial sits beside the track on desktop, below it on phones
  const dz = ph ? -2.6 : -1.9, x = ph ? 0 : (s - 2.5) * step, g = new THREE.Group(); g.position.set(x, .04, dz); scene.add(g);
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3((s - 2.5) * step, .03, -hr - .03), new THREE.Vector3(x, .03, dz + 1.82)]), lineM(HUD.cyan, .7)));
  const parts = s <= 2 && b.suggested > 0 ? [['I Material', b.matPrice, '#4fd8ff'], ['II-III Labor', b.labExpPrice, '#b197ff'], ['IV Subs', b.subPrice || 0, '#ffc24d']]
    : [['Contract', +j.bidTotal || 0, hcol(Math.max(s, 3))], ['Change orders', t.co, '#ffc24d']];
  const tot = parts.reduce((a, p) => a + (p[1] || 0), 0) || 1; let a0 = Math.PI / 2;
  const R1 = 1.5, R2 = 1.78, al = alertOf(j);
  parts.forEach(([n, v, c], pi) => { if (!(v > 0)) return; const sw = v / tot * Math.PI * 2 - .05;
    const seg = new THREE.Mesh(new THREE.RingGeometry(R1, R2, 64, 1, a0, sw).rotateX(-Math.PI / 2), glow(c, .75)); g.add(seg);
    // labels go out to the left or right of the dial, never on top of it
    const am = a0 + sw / 2, side = Math.cos(am) >= 0 ? 1 : -1, o = new THREE.Object3D(); o.position.set(side * (R2 + .25), 0, -Math.sin(am) * 1.1); g.add(o);
    labels.push({ obj: o, html: `${n}<small>${kmoney(v)}</small>`, cls: 'side ' + (side > 0 ? 'gr' : 'gl') }); a0 += sw + .05; });
  const f = s >= 3 ? Math.min(1, (t.mat + t.lab + t.trav) / Math.max(t.revised, 1)) : s === 5 ? 1 : Math.min(1, (+j.pct || 0) / 100);
  g.add(new THREE.Mesh(new THREE.RingGeometry(1.0, 1.25, 64).rotateX(-Math.PI / 2), glow('#24465a', .7)));
  if (f > 0) g.add(new THREE.Mesh(new THREE.RingGeometry(1.0, 1.25, 64, 1, Math.PI / 2, -Math.PI * 2 * f).rotateX(-Math.PI / 2), glow(acol(al) || HUD.cyan, .95)));
  const ctr = new THREE.Object3D(); g.add(ctr);
  labels.push({ obj: ctr, html: `${Math.round(f * 100)}%<small>${s >= 3 ? kmoney(t.remaining) + ' left' : 'estimated'}</small>`, cls: 'core' + (al ? ' ' + al.lvl : '') });
  g.add(new THREE.Mesh(new THREE.CircleGeometry(.95, 6).rotateX(-Math.PI / 2), glow(HUD.cyan, .08)));
  const spin = new THREE.Mesh(new THREE.TorusGeometry(2.05, .015, 6, 90, Math.PI * 1.3), glow(HUD.cyan, .8)); spin.rotation.x = Math.PI / 2; g.add(spin);
  if (al) host.querySelector('.t3dcap').insertAdjacentHTML('beforeend', `<i class="t3dal ${al.lvl}">${esc(al.txt)}</i>`);
  tween(750, k => { g.scale.setScalar(.2 + .8 * k); request(); });
  const cam = ph ? persp(32, new THREE.Vector3(0, 9.5, 3.2), new THREE.Vector3(0, 0, -1.2)) : persp(32, new THREE.Vector3(x * .3, 7.5, 6.5), new THREE.Vector3(x * .3, 0, -.8));
  const v = { scene, camera: cam, host, labels, turn: orbitTurn(cam), fit: fitAuto(cam, scene, ph ? 44 : 60, ph ? 14 : 40, ph ? .92 : .8, ph ? 84 : 0) };
  v.idle = dt => { spin.rotation.z += .6 * dt; };
  return v;
}

const BUILD = [boardD, jobD];
const NAME = 'Holo HUD';
const HELP = 'Marker size = bid. Ring fills with money spent (or estimate % while bidding). Red = over budget or overdue, amber = needs a look.';
hero.querySelector('.t3dcap').innerHTML = `<b>${NAME}</b><span>${HELP} Drag to turn · tap a job to open it</span>`;

/* ---------- hook into the app: the whole Jobs page becomes the scene ---------- */
function disposeView(v) { if (!v) return; v.scene.traverse(o => o.geometry && o.geometry.dispose()); }
let heroView = null;
// floating controls: the app's own filter bar and counters move into the scene (same elements, same handlers)
const ui = document.createElement('div'); ui.className = 't3dui';
const ttl = document.createElement('div'); ttl.className = 't3dtitle'; ttl.innerHTML = '<h1>Jobs</h1><div class="t3dstat"></div>';
ui.append(ttl, document.getElementById('bar'), document.getElementById('kpis'));
const sel = document.createElement('div'); sel.id = 't3dSel'; sel.hidden = true;
const read = document.createElement('div'); read.className = 't3dread';
hero.append(ui, sel, read);
const narrow = () => hero.clientWidth < 900;
// the floating controls and readouts change height (fonts arriving, chips wrapping): refit the dial when they do
{ const refit = () => { if (view && view === heroView) { layout(); sizeTo(view); request(); } };
  const ro = new ResizeObserver(refit); ro.observe(ui); ro.observe(read);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(refit); }
function layout() { // fit the scene between the app's header/rail and the phone tab bar
  const h = document.querySelector('header').getBoundingClientRect(), tab = document.getElementById('iostab');
  const rail = h.height > innerHeight * .8, tb = tab && getComputedStyle(tab).display !== 'none' ? tab.getBoundingClientRect().top : innerHeight;
  Object.assign(hero.style, { left: (rail ? h.right : 0) + 'px', top: (rail ? 0 : h.bottom) + 'px', bottom: (innerHeight - tb) + 'px' });
  hero.classList.toggle('narrow', narrow());
  read.style.top = narrow() ? '' : (ui.offsetTop + ui.offsetHeight + 14) + 'px';
}
let lastCols = 0;
let lastNarrow = null;
addEventListener('resize', () => { layout(); const c = gridOf(1, 1).cols; if (c !== lastCols || narrow() !== lastNarrow) { lastCols = c; drawHero(); } });
let pend = false;
function drawHero() {
  if (pend) return; pend = true;
  requestAnimationFrame(() => { pend = false;
    root.classList.toggle('t3trash', filter === 'Trash');
    layout(); lastCols = gridOf(1, 1).cols; disposeView(heroView); heroView = BUILD[0](); ring = null;
    drawPanels(); drawStat(); lastNarrow = narrow(); layout();
    const play = activity(heroView); drawStops();
    if (!document.getElementById('drawer').classList.contains('open')) { show(heroView); if (!booted && !reduce) { hero.classList.add('boot'); setTimeout(() => hero.classList.remove('boot'), 2600); } heroView.boot(); play(); if (selId && Store.get(selId)) select(selId); else select(null); }
  });
}
const _renderGrid = renderGrid;
renderGrid = function () { _renderGrid.apply(this, arguments); drawHero(); };
const _renderDrawer = renderDrawer;
renderDrawer = function () {
  _renderDrawer.apply(this, arguments);
  const j = Store.get(openId); if (!j) return;
  const dh = document.querySelector('#drawer .dh'); if (!dh) return;
  // freeze the jobs scene as a picture behind the open job, then lend the renderer to the job strip
  if (view === heroView && heroView) { renderer.render(heroView.scene, heroView.camera); hero.style.backgroundImage = `url(${canvas.toDataURL('image/png')})`; hero.classList.add('frozen'); }
  const s = stageOf(j);
  const host = hostEl('t3dJob', 'strip', `<b>${s >= 0 ? STAGES[s] : j.bidStatus}</b><span>${['Fill in the bid info, then build it below', 'Bid builder sections stack up as you add quotes, labor and subs', 'Quote letter is out, waiting to hear back', 'Awarded. Log material, labor and COs as they come', 'Change orders and material are on the job', 'Job completed'][s] || ''}</span>`);
  dh.after(host);
  show(jobViewFor(j, host));
};
let lastJobView = null;
function jobViewFor(j, host) { disposeView(lastJobView); lastJobView = BUILD[1](j, host); return lastJobView; }
const _closeJob = closeJob;
closeJob = function () { _closeJob.apply(this, arguments); hero.classList.remove('frozen'); hero.style.backgroundImage = ''; if (heroView) show(heroView); };
let wasDark = dark();
new MutationObserver(() => { if (dark() === wasDark) return; wasDark = dark(); Object.keys(matCache).forEach(k => delete matCache[k]); drawHero(); if (openId) renderDrawer(); }).observe(root, { attributes: true, attributeFilter: ['class'] });
drawHero();

/* ---------- side readouts (BIDDING left, JOBS right; a swipe strip on phones) + top status strip ---------- */
function drawPanels() {
  const T = topJobs(), A = T.filter(j => !j.completedDate && stageOf(j) >= 0), sum = a => a.reduce((x, j) => x + val(j), 0);
  const est = A.filter(j => j.bidStatus === 'Estimating'), sent = A.filter(j => j.bidStatus === 'Bid Sent');
  const won = T.filter(j => j.bidStatus === 'Awarded').length, lost = T.filter(j => j.bidStatus === 'Lost').length;
  const wk = d => d && ageDays(d) >= 0 && ageDays(d) < 7;
  const live = A.filter(j => j.bidStatus === 'Awarded');
  const backlog = live.reduce((a, j) => a + totals(j).remaining, 0);
  const matWk = live.reduce((a, j) => a + j.materials.filter(m => wk(m.date)).reduce((x, m) => x + (+m.cost || 0), 0), 0);
  const coP = T.flatMap(j => j.changeOrders.filter(c => !c.status || /pend|sent|submit/i.test(c.status)).map(c => +c.amount || 0))
    .concat(Store.jobs.filter(c => isChild(c) && (c.bidStatus === 'Bid Sent' || c.bidStatus === 'Estimating')).map(c => +c.bidTotal || 0));
  const al = (list) => list.map(j => [j, alertOf(j)]).filter(x => x[1]).sort((a, b) => (a[1].lvl === 'red' ? 0 : 1) - (b[1].lvl === 'red' ? 0 : 1));
  const bidAl = al(est.concat(sent)), jobAl = al(live);
  const row = (k, v, sub = '') => `<div class="rr"><span>${k}</span><b>${v}</b>${sub ? `<i>${sub}</i>` : ''}</div>`;
  const alerts = (list, none) => `<div class="ral">${list.length ? list.slice(0, 3).map(([j, a]) => `<button data-id="${esc(j.id)}" class="${a.lvl}"><b>${esc(j.name).slice(0, 24)}</b><span>${esc(a.txt)}</span></button>`).join('') + (list.length > 3 ? `<em>+${list.length - 3} more</em>` : '') : `<em class="ok">${none}</em>`}</div>`;
  const cnt = list => { const r = list.filter(x => x[1].lvl === 'red').length, a = list.length - r; return (r ? `<i class="red">${r}</i>` : '') + (a ? `<i class="amber">${a}</i>` : ''); };
  read.innerHTML = `<section class="rp"><h4>Bidding<span>${cnt(bidAl)}</span></h4>
      ${row('Estimating', est.length, est.length ? kmoney(sum(est)) || '' : '')}
      ${row('Bids out', kmoney(sum(sent)), sent.length + ' sent')}
      ${row('Sent this week', sent.filter(j => wk(j.sentDate)).length)}
      ${row('Win rate', won + lost ? Math.round(won / (won + lost) * 100) + '%' : '—', won + ' won · ' + lost + ' lost')}
      ${alerts(bidAl, 'No bids need a look')}</section>
    <section class="rp"><h4>Jobs<span>${cnt(jobAl)}</span></h4>
      ${row('Active', live.length)}
      ${row('Backlog left', kmoney(backlog))}
      ${row('Material this week', kmoney(matWk))}
      ${row('COs pending', coP.length, coP.length ? kmoney(coP.reduce((a, b) => a + b, 0)) : '')}
      ${alerts(jobAl, 'All jobs inside budget')}</section>`;
  read.querySelectorAll('.ral button').forEach(b => b.onclick = () => { if (view === heroView) select(b.dataset.id); });
}
let lastSync = Date.now();
if (typeof Cloud !== 'undefined' && Cloud.remote) { const _remote = Cloud.remote; Cloud.remote = function () { lastSync = Date.now(); const r = _remote.apply(this, arguments); drawStat(); return r; }; }
const hm = d => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
function drawStat() {
  const el = ttl.querySelector('.t3dstat'); if (!el) return;
  const now = new Date(), pill = document.getElementById('syncPill');
  const st = pill && !pill.hidden && pill.textContent ? pill.textContent : 'This device';
  const bad = pill && /off/.test(pill.className);
  let chat = 0; try { chat = typeof JobChat !== 'undefined' && JobChat.count ? JobChat.count() : 0; } catch (e) { }
  el.innerHTML = `<span class="clk"><b>${hm(now).replace(/ (AM|PM)/, '<small>$1</small>')}</b><i class="dt">${now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</i></span>`
    + `<span class="sy ${bad ? 'bad' : ''}"><i></i>${esc(st)}<em>· synced ${hm(new Date(lastSync))}</em></span>`
    + `<span class="ch ${chat ? 'on' : ''}">${chat ? chat + ' new message' + (chat > 1 ? 's' : '') : 'No new messages'}</span>`;
}
setInterval(() => { if (!document.hidden) drawStat(); }, 20000);
// sci-fi square headings: Orbitron (free font), only loaded in this theme
{ const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700&display=swap'; document.head.appendChild(l); }

/* ---------- 1. stage rooms: tap a stop or scroll, the camera glides there ---------- */
const stops = document.createElement('div'); stops.className = 't3dstops'; ui.append(stops);
function drawStops() {
  const f = heroView && heroView.fit.focused ? heroView.fit.focused() : -1, T = top();
  stops.innerHTML = `<button data-s="-1" class="${f < 0 ? 'on' : ''}">Overview</button>` + STAGES.map((n, i) =>
    `<button data-s="${i}" class="${f === i ? 'on' : ''}"><i style="background:${sc(i)}"></i>${sn(i)}<b>${T.filter(j => stageOf(j) === i).length}</b></button>`).join('');
  stops.querySelectorAll('button').forEach(b => b.onclick = () => goStage(+b.dataset.s));
}
function goStage(i) { if (!heroView || view !== heroView) return; heroView.fit.focus(i); drawStops(); }
let wheelAt = 0;
hero.addEventListener('wheel', e => {
  if (view !== heroView || e.target.closest('.t3dui,#t3dSel,.t3dstops')) return;
  e.preventDefault(); const now = performance.now(); if (now - wheelAt < 550 || Math.abs(e.deltaY) < 8) return; wheelAt = now;
  goStage(Math.max(-1, Math.min(5, heroView.fit.focused() + Math.sign(e.deltaY))));
}, { passive: false });

/* ---------- 2. activity as light: an arc when a job changed stage since you last looked, a pulse on fresh activity ---------- */
const SEEN = 'apT3dSeen', DAY = 864e5;
function recent(j) {
  const now = Date.now(), d = s => s && now - new Date(s + 'T12:00:00') < 3 * DAY;
  return d(j.awardDate) || d(j.sentDate) || d(j.completedDate) || j.materials.some(m => d(m.date)) || j.labor.some(l => d(l.date)) || childrenOf(j.id).some(c => d(c.awardDate));
}
function activity(v) {
  let seen = {}; try { seen = JSON.parse(localStorage.getItem(SEEN) || '{}'); } catch (e) { }
  const fx = [];
  top().forEach(j => {
    const s = stageOf(j), o = v.pick.find(p => p.userData.id === j.id); if (!o) return;
    const bb = new THREE.Box3().setFromObject(o), end = bb.getCenter(new THREE.Vector3()); end.y = bb.max.y + .15;
    if (seen[j.id] != null && seen[j.id] !== s && seen[j.id] >= 0) {
      const a = v.fit.center(seen[j.id]), mid = a.clone().lerp(end, .5); mid.y = Math.max(a.y, end.y) + a.distanceTo(end) * .45;
      const curve = new THREE.QuadraticBezierCurve3(a, mid, end), geo = new THREE.TubeGeometry(curve, 60, .07, 8);
      const m = new THREE.MeshBasicMaterial({ color: C === 'D' ? '#ffe27a' : '#e8a317', transparent: true, opacity: .95, fog: false }), arc = new THREE.Mesh(geo, m); arc.userData.nofit = true;
      const head = new THREE.Mesh(new THREE.SphereGeometry(.2, 16, 12), new THREE.MeshBasicMaterial({ color: '#ffd57a', fog: false })); head.userData.nofit = true;
      v.scene.add(arc, head); const n = geo.index.count; geo.setDrawRange(0, 0);
      v.labels.push({ obj: head, dy: .35, html: `→ ${STAGES[s]}<small>${esc(j.name).slice(0, 18)}</small>`, cls: 'move' });
      fx.push(() => tween(1800, k => { geo.setDrawRange(0, Math.floor(n * k / 6) * 6); head.position.copy(curve.getPoint(k)); request(); }));
      fx.push(() => setTimeout(() => tween(1600, k => { m.opacity = .95 * (1 - k) + .25 * k; request(); }), 5000));
    }
    if (recent(j)) {
      const rr = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * .7 + .2;
      const pm = new THREE.MeshBasicMaterial({ color: C === 'D' ? hcol(s) : sc(s), transparent: true, opacity: .0, side: THREE.DoubleSide, fog: false });
      const pr = new THREE.Mesh(new THREE.RingGeometry(rr, rr + .14, 40), pm); pr.rotation.x = -Math.PI / 2; pr.position.set(end.x, bb.min.y + .02, end.z); pr.userData.nofit = true; v.scene.add(pr);
      fx.push(() => tween(3600, k => { const c = (k * 3) % 1; pr.scale.setScalar(1 + c * .9); pm.opacity = (1 - c) * .7 * (k < .98 ? 1 : 0) + (k >= .98 ? .35 : 0); request(); }));
    }
    seen[j.id] = s;
  });
  try { localStorage.setItem(SEEN, JSON.stringify(seen)); } catch (e) { }
  return () => fx.forEach(f => f());
}

/* ---------- 3. instant first frame: last picture of the board shows at once, live 3D fades in on top ---------- */
const SNAP = 'apT3dSnap' + C;
try { const snap = localStorage.getItem(SNAP); if (snap) hero.style.backgroundImage = `url(${snap})`; } catch (e) { }
let snapT = 0;
function snapLater() { clearTimeout(snapT); snapT = setTimeout(() => { if (view !== heroView || tweens.length || selId) return;
  renderer.render(heroView.scene, heroView.camera); try { localStorage.setItem(SNAP, canvas.toDataURL('image/jpeg', .7)); } catch (e) { } }, 2500); }

/* ---------- 5. depth and mouse tilt: the scene leans a little toward the mouse ---------- */
let tiltRaf = 0;
hero.addEventListener('pointermove', e => {
  if (e.pointerType !== 'mouse' || drag || reduce || tier >= 2 || view !== heroView || !heroView.turn) return;
  const r = hero.getBoundingClientRect(), nx = (e.clientX - r.left) / r.width - .5;
  if (tiltRaf) return; tiltRaf = requestAnimationFrame(() => { tiltRaf = 0; heroView.turn((heroView.yaw || 0) + nx * .1); request(); });
});
window.T3D = { stageOf, request, C, select, goStage, setTier };
