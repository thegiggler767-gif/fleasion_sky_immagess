import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

import { buildGeometry, makeMaterial, instancesOf, clearGeoCache } from './geom.js';

export class Viewer {
  constructor(container, { onSelect, onMeasure } = {}) {
    this.container = container;
    this.onSelect = onSelect;
    this.onMeasure = onMeasure;
    this.measuring = false;
    this.measurePts = [];
    this.isolated = -1;
    this.camAnim = null;
    this.follow = true;
    this.meshes = [];
    this.anims = [];
    this.explode = 0;
    this.step = Infinity;
    this.ghosts = true;
    this.blueprint = false;
    this.selected = -1;
    this.running = false;

    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(r.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.01, 500);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.autoRotateSpeed = 1.2;
    this.controls.maxPolarAngle = Math.PI * 0.495;

    try {
      const pmrem = new THREE.PMREMGenerator(r);
      this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      this.scene.environmentIntensity = 0.55;
      pmrem.dispose();
    } catch (e) { /* older GPUs: fall back to plain lights */ }
    this.scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x3a3226, 0.75));
    const sun = this.sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun, sun.target);
    const fill = new THREE.DirectionalLight(0xbcd4ff, 0.6);
    fill.position.set(-3, 2, -2);
    this.scene.add(fill);

    this.floor = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.ShadowMaterial({ opacity: 0.28 }));
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);

    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.ghostMat = new THREE.MeshBasicMaterial({ color: 0x7fb2ff, transparent: true, opacity: 0.08, depthWrite: false });
    this.edgeMat = new THREE.LineBasicMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0.9 });
    this.outlineMat = new THREE.LineBasicMaterial({ color: 0x10131c, transparent: true, opacity: 0.32 });
    this.outlines = true;

    this.ray = new THREE.Raycaster();
    let down = null;
    r.domElement.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; this.userTouched = true; this.camAnim = null; });
    r.domElement.addEventListener('pointerup', e => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      if (moved < 8 && performance.now() - down.t < 400) this.pick(e);
      down = null;
    });

    this.mLabel = document.createElement('div');
    this.mLabel.className = 'measure-label hidden';
    container.appendChild(this.mLabel);
    this.measureGroup = new THREE.Group();
    this.scene.add(this.measureGroup);

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.last = performance.now();
    this.loop = this.loop.bind(this);
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + 'px';
    this.renderer.domElement.style.height = h + 'px';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  start() { if (!this.running) { this.running = true; this.resize(); this.last = performance.now(); requestAnimationFrame(this.loop); } }
  stop() { this.running = false; }

  load(model) {
    for (const m of this.materials || []) m.dispose();
    this.root.clear();
    clearGeoCache();
    this.meshes = [];
    this.materials = [];
    this.anims = [];
    this.selected = -1;
    this.isolated = -1;
    this.clearMeasure();
    if (this.grid) { this.scene.remove(this.grid); this.grid.geometry.dispose(); }

    let total = 0;
    model.parts.forEach((p, i) => {
      if (total > 1500) return;
      let built;
      try { built = buildGeometry(p); } catch (e) { console.warn('part failed', p.name, e); return; }
      const mat = makeMaterial(p);
      this.materials.push(mat);
      for (const inst of instancesOf(p)) {
        if (++total > 1500) break;
        const mesh = new THREE.Mesh(built.geo, mat);
        mesh.userData = { index: i, part: p, step: p.step || 1, realMat: mat, edgeGeo: built.edges };
        mesh.position.copy(inst.pos);
        mesh.rotation.copy(inst.rot);
        const small = Math.max(...p.size) < 0.012;
        mesh.castShadow = p.material !== 'glass' && p.material !== 'water' && !small;
        mesh.receiveShadow = !small;
        this.root.add(mesh);
        this.meshes.push(mesh);
      }
    });
    this.root.position.set(0, 0, 0);
    this.root.updateMatrixWorld(true);
    this.snapFloating();
    this.meshes.forEach(m => { m.userData.base = m.position.clone(); });

    // ground & centre the model
    this.root.position.set(0, 0, 0);
    this.root.updateMatrixWorld(true);
    const box = new THREE.Box3();
    this.meshes.forEach(m => box.expandByObject(m));
    if (box.isEmpty()) box.set(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5));
    const c = box.getCenter(new THREE.Vector3());
    this.root.position.set(-c.x, -box.min.y, -c.z);
    this.localCenter = c.clone();
    this.size = box.getSize(new THREE.Vector3());
    const radius = Math.max(this.size.length() / 2, 0.05);
    this.radius = radius;

    // floor, grid, light sized to the model
    const span = Math.max(this.size.x, this.size.z, 0.2);
    this.floor.scale.setScalar(span * 2.2 + radius);
    const cell = span < 0.5 ? 0.05 : span < 3 ? 0.1 : span < 10 ? 0.5 : 1;
    const gsize = Math.ceil((span * 1.8 + radius) / cell) * cell;
    this.grid = new THREE.GridHelper(gsize, Math.round(gsize / cell), 0x5a6b8c, 0x2c3650);
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.45;
    this.grid.position.y = 0.0005;
    this.scene.add(this.grid);
    const s = this.sun.shadow.camera;
    const ext = radius * 1.6;
    s.left = -ext; s.right = ext; s.top = ext; s.bottom = -ext; s.near = 0.01; s.far = radius * 12;
    s.updateProjectionMatrix();
    this.sun.position.set(radius * 2.2, radius * 4, radius * 1.6);
    this.sun.target.position.set(0, this.size.y / 2, 0);

    this.camera.near = Math.max(radius / 200, 0.002);
    this.camera.far = radius * 60;
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = radius * 0.3;
    this.controls.maxDistance = radius * 8;
    this.applyBlueprint();
    this.resetView();
    this.setStep(Infinity, false);
  }

  resetView() {
    const r = this.radius || 1;
    const dist = r / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * (this.camera.aspect < 1 ? 1.25 : 1.0);
    const dir = new THREE.Vector3(1.0, 0.75, 1.3).normalize();
    this.controls.target.set(0, this.size ? this.size.y / 2 : 0.5, 0);
    this.camera.position.copy(this.controls.target).addScaledVector(dir, dist);
    this.controls.update();
  }

  setAutoRotate(on) { this.controls.autoRotate = on; }

  setExplode(f) { this.explode = f; this.updatePositions(); }

  setGhosts(on) { this.ghosts = on; this.setStep(this.step, false); }

  setBlueprint(on) { this.blueprint = on; this.applyBlueprint(); }

  setOutlines(on) { this.outlines = on; this.applyBlueprint(); }

  applyBlueprint() {
    const want = this.blueprint || this.outlines;
    const tiny = (this.radius || 1) * 0.004;
    for (const m of this.meshes) {
      if (want && !m.userData.edges && Math.max(...m.userData.part.size) > tiny) {
        const l = new THREE.LineSegments(m.userData.edgeGeo, this.outlineMat);
        l.raycast = () => {};
        m.add(l);
        m.userData.edges = l;
      }
      if (m.userData.edges) {
        m.userData.edges.material = this.blueprint ? this.edgeMat : this.outlineMat;
        m.userData.edges.visible = want && !m.userData.ghost;
      }
    }
    for (const mat of this.materials || []) {
      const pm = this.meshes.find(m => m.userData.realMat === mat)?.userData.part.material;
      mat.transparent = this.blueprint || pm === 'glass' || pm === 'water';
      mat.opacity = this.blueprint ? 0.18 : (pm === 'glass' ? 0.28 : pm === 'water' ? 0.6 : 1);
      mat.depthWrite = !this.blueprint && pm !== 'glass';
      mat.needsUpdate = true;
    }
  }

  // close small gaps under parts that touch nothing (AI rounding errors)
  snapFloating() {
    const ms = this.meshes.filter(m => m.userData.part.shape !== 'path');
    if (ms.length < 2) return;
    const boxes = new Map(ms.map(m => [m, new THREE.Box3().setFromObject(m)]));
    const all = new THREE.Box3(); boxes.forEach(b => all.union(b));
    const tol = Math.max(0.003, all.getSize(new THREE.Vector3()).length() * 0.012);
    const floorY = all.min.y;
    const sorted = ms.slice().sort((a, b) => boxes.get(a).min.y - boxes.get(b).min.y);
    for (const m of sorted) {
      const b = boxes.get(m);
      if (b.min.y - floorY < 0.0008) continue;
      const grown = b.clone().expandByScalar(0.0008);
      let touching = false;
      for (const [o, ob] of boxes) if (o !== m && grown.intersectsBox(ob)) { touching = true; break; }
      if (touching) continue;
      let top = floorY;
      for (const [o, ob] of boxes) {
        if (o === m || ob.max.y > b.min.y + 0.0005) continue;
        const ox = Math.min(b.max.x, ob.max.x) - Math.max(b.min.x, ob.min.x);
        const oz = Math.min(b.max.z, ob.max.z) - Math.max(b.min.z, ob.min.z);
        if (ox > 0 && oz > 0) top = Math.max(top, ob.max.y);
      }
      const gap = b.min.y - top;
      if (gap > 0.0008 && gap <= tol) {
        m.position.y -= gap;
        m.updateMatrixWorld(true);
        boxes.set(m, new THREE.Box3().setFromObject(m));
      }
    }
  }

  // show parts up to step n (Infinity = all). Parts of step n animate in.
  setStep(n, animate = true) {
    const prev = this.step;
    this.step = n;
    for (const m of this.meshes) {
      const st = m.userData.step;
      const built = st <= n;
      m.visible = (built || this.ghosts) && (this.isolated < 0 || m.userData.index === this.isolated);
      m.material = built ? m.userData.realMat : this.ghostMat;
      m.castShadow = built && m.userData.part.material !== 'glass';
      m.userData.ghost = !built;
      m.userData.current = Number.isFinite(n) && st === n;
      if (m.userData.edges) m.userData.edges.visible = (this.blueprint || this.outlines) && built;
      if (animate && built && st === n && (prev < n || !Number.isFinite(prev))) {
        this.anims.push({ mesh: m, t: 0, dur: 0.55, delay: Math.random() * 0.25 });
        m.userData.anim = 0;
      } else if (!animate) m.userData.anim = 1;
    }
    this.highlight();
    this.updatePositions();
  }

  highlight() {
    for (const m of this.meshes) {
      const mat = m.userData.realMat;
      if (!mat.emissive) continue;
      const isLed = m.userData.part.material === 'led';
      if (m.userData.index === this.selected) { mat.emissive.set(0x2f7bff); mat.emissiveIntensity = 0.65; }
      else if (m.userData.current) { mat.emissive.set(0xffa53a); mat.emissiveIntensity = 0.28; }
      else if (isLed) { mat.emissive.set(m.userData.part.color); mat.emissiveIntensity = 1.6; }
      else { mat.emissive.set(0x000000); mat.emissiveIntensity = 1; }
    }
  }

  select(i) {
    this.selected = i;
    this.highlight();
  }

  pick(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(v, this.camera);
    const hits = this.ray.intersectObjects(this.meshes.filter(m => m.visible && !m.userData.ghost), false);
    if (this.measuring) {
      if (!hits.length) return;
      this.addMeasurePoint(hits[0].point.clone());
      return;
    }
    const i = hits.length ? hits[0].object.userData.index : -1;
    this.select(i);
    this.onSelect?.(i);
  }

  updatePositions() {
    const c = this.localCenter || new THREE.Vector3();
    for (const m of this.meshes) {
      const b = m.userData.base;
      const k = this.explode * 1.1;
      m.position.set(b.x + (b.x - c.x) * k, b.y + (b.y - c.y) * k + this.explode * (this.radius || 1) * 0.15, b.z + (b.z - c.z) * k);
      const a = m.userData.anim ?? 1;
      if (a < 1) {
        const e = 1 - Math.pow(1 - a, 3);
        m.position.y += (1 - e) * (this.radius || 1) * 0.9;
        const s = 0.6 + 0.4 * e;
        m.userData.animScale = s;
      }
    }
  }

  loop() {
    if (!this.running) return;
    const now = performance.now(); const dt = Math.min((now - this.last) / 1000, 0.05); this.last = now;
    if (this.anims.length) {
      this.anims = this.anims.filter(a => {
        if (a.delay > 0) { a.delay -= dt; return true; }
        a.t += dt;
        a.mesh.userData.anim = Math.min(a.t / a.dur, 1);
        return a.t < a.dur;
      });
      this.updatePositions();
    }
    // pulse current-step parts
    if (Number.isFinite(this.step)) {
      const pulse = 0.18 + 0.14 * Math.sin(performance.now() / 260);
      for (const m of this.meshes) if (m.userData.current && m.userData.index !== this.selected && m.userData.realMat.emissive) m.userData.realMat.emissiveIntensity = pulse;
    }
    if (this.camAnim) {
      const a = this.camAnim;
      a.t = Math.min(a.t + dt / a.dur, 1);
      const e = a.t < 0.5 ? 4 * a.t * a.t * a.t : 1 - Math.pow(-2 * a.t + 2, 3) / 2;
      this.camera.position.lerpVectors(a.p0, a.p1, e);
      this.controls.target.lerpVectors(a.t0, a.t1, e);
      if (a.t >= 1) this.camAnim = null;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    if (this.measurePts.length === 2) this.placeMeasureLabel();
    requestAnimationFrame(this.loop);
  }

  dimensionsText(units) {
    if (!this.size) return '';
    const s = this.size;
    if (units === 'imperial') {
      const f = v => (v * 39.37).toFixed(v * 39.37 < 20 ? 1 : 0) + '″';
      return `W ${f(s.x)} × H ${f(s.y)} × D ${f(s.z)}`;
    }
    const f = v => v < 1 ? `${Math.round(v * 1000)} mm` : `${v.toFixed(2)} m`;
    return `W ${f(s.x)} × H ${f(s.y)} × D ${f(s.z)}`;
  }

  // ---- camera helpers ----
  flyTo(target, position, dur = 0.7) {
    this.camAnim = { t: 0, dur, p0: this.camera.position.clone(), p1: position.clone(), t0: this.controls.target.clone(), t1: target.clone() };
  }

  setView(name) {
    const r = this.radius || 1;
    const dist = r / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * (this.camera.aspect < 1 ? 1.2 : 1.0);
    const target = new THREE.Vector3(0, this.size ? this.size.y / 2 : 0.5, 0);
    const dirs = { front: [0, 0.08, 1], back: [0, 0.08, -1], left: [-1, 0.08, 0], right: [1, 0.08, 0], top: [0.001, 1, 0.02], iso: [1, 0.75, 1.3] };
    const d = new THREE.Vector3(...(dirs[name] || dirs.iso)).normalize();
    this.setAutoRotate(false);
    this.flyTo(target, target.clone().addScaledVector(d, dist));
  }

  // frame a set of part indices
  focusParts(indices) {
    const ms = this.meshes.filter(m => indices.includes(m.userData.index));
    if (!ms.length) return;
    this.root.updateMatrixWorld(true);
    const box = new THREE.Box3();
    ms.forEach(m => box.expandByObject(m));
    const c = box.getCenter(new THREE.Vector3());
    const rad = Math.max(box.getSize(new THREE.Vector3()).length() / 2, (this.radius || 1) * 0.25);
    const dist = rad / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.15;
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    if (dir.y < 0.25) { dir.y = 0.35; dir.normalize(); }
    this.flyTo(c, c.clone().addScaledVector(dir, Math.min(dist, (this.radius || 1) * 4)));
  }

  focusStep(n) {
    if (!this.follow || !Number.isFinite(n)) return;
    this.focusParts(this.meshes.filter(m => m.userData.step === n).map(m => m.userData.index));
  }

  isolate(i) {
    this.isolated = i;
    this.setStep(this.step, false);
    if (i >= 0) this.focusParts([i]); else this.setView('iso');
  }

  recolor(i, hex) {
    const m = this.meshes.find(x => x.userData.index === i);
    if (!m) return;
    m.userData.realMat.color.set(hex);
    if (m.userData.part.material === 'led') m.userData.realMat.emissive.set(hex);
    m.userData.part.color = hex;
  }

  // ---- measure tool ----
  setMeasuring(on) {
    this.measuring = on;
    this.clearMeasure();
    if (on) { this.select(-1); this.setAutoRotate(false); }
  }

  clearMeasure() {
    this.measurePts = [];
    if (this.measureGroup) {
      this.measureGroup.children.forEach(c => c.geometry?.dispose());
      this.measureGroup.clear();
    }
    this.mLabel?.classList.add('hidden');
  }

  addMeasurePoint(p) {
    if (this.measurePts.length >= 2) this.clearMeasure();
    this.measurePts.push(p);
    const r = (this.radius || 1) * 0.018;
    const dot = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffd23f, depthTest: false }));
    dot.renderOrder = 10;
    dot.position.copy(p);
    this.measureGroup.add(dot);
    if (this.measurePts.length === 2) {
      const g = new THREE.BufferGeometry().setFromPoints(this.measurePts);
      const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffd23f, depthTest: false }));
      line.renderOrder = 10;
      this.measureGroup.add(line);
      const d = this.measurePts[0].distanceTo(this.measurePts[1]);
      this.measureDist = d;
      this.onMeasure?.(d);
    } else this.onMeasure?.(null);
  }

  placeMeasureLabel() {
    const mid = this.measurePts[0].clone().add(this.measurePts[1]).multiplyScalar(0.5).project(this.camera);
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.mLabel.style.left = `${(mid.x + 1) / 2 * w}px`;
    this.mLabel.style.top = `${(1 - mid.y) / 2 * h}px`;
    this.mLabel.classList.remove('hidden');
    this.mLabel.textContent = this.formatLen ? this.formatLen(this.measureDist) : `${Math.round(this.measureDist * 1000)} mm`;
  }

  async exportSTL() {
    const { STLExporter } = await import('three/examples/jsm/exporters/STLExporter.js');
    const group = new THREE.Group();
    for (const m of this.meshes) {
      const mm = new THREE.Mesh(m.geometry);
      mm.position.copy(m.userData.base); mm.rotation.copy(m.rotation); mm.scale.copy(m.scale);
      group.add(mm);
    }
    group.position.copy(this.root.position);
    group.scale.setScalar(1000); // millimetres for slicers
    group.rotation.x = Math.PI / 2; // Z-up for 3D printing
    group.updateMatrixWorld(true);
    return new STLExporter().parse(group, { binary: true });
  }

  snapshot() {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  async exportGLB() {
    const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
    const group = new THREE.Group();
    for (const m of this.meshes) {
      const mm = new THREE.Mesh(m.geometry, m.userData.realMat);
      mm.position.copy(m.userData.base); mm.rotation.copy(m.rotation); mm.scale.copy(m.scale);
      mm.name = m.userData.part.name;
      group.add(mm);
    }
    group.position.copy(this.root.position);
    return new Promise((res, rej) => new GLTFExporter().parse(group, r => res(r), rej, { binary: true }));
  }
}
