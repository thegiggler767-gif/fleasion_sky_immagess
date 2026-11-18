import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const UNIT = {};
function unitGeo(shape) {
  if (UNIT[shape]) return UNIT[shape];
  let g;
  switch (shape) {
    case 'cylinder': g = new THREE.CylinderGeometry(0.5, 0.5, 1, 40); break;
    case 'cone': g = new THREE.ConeGeometry(0.5, 1, 40); break;
    case 'sphere': g = new THREE.SphereGeometry(0.5, 40, 24); break;
    case 'halfsphere': g = new THREE.SphereGeometry(0.5, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2); g.translate(0, -0.25, 0); break;
    case 'capsule': g = new THREE.CapsuleGeometry(0.5, 1, 8, 24); g.scale(1, 0.5, 1); break;
    case 'tube': {
      const pts = [new THREE.Vector2(0.38, -0.5), new THREE.Vector2(0.5, -0.5), new THREE.Vector2(0.5, 0.5), new THREE.Vector2(0.38, 0.5), new THREE.Vector2(0.38, -0.5)];
      g = new THREE.LatheGeometry(pts, 40); break;
    }
    case 'wedge': {
      const s = new THREE.Shape();
      s.moveTo(-0.5, -0.5); s.lineTo(0.5, -0.5); s.lineTo(-0.5, 0.5); s.lineTo(-0.5, -0.5);
      g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false });
      g.translate(0, 0, -0.5); break;
    }
    default: g = new THREE.BoxGeometry(1, 1, 1);
  }
  UNIT[shape] = g;
  return g;
}

function makeNoiseTexture(kind) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, 256, 256);
  if (kind === 'wood') {
    for (let i = 0; i < 70; i++) {
      const y = Math.random() * 256, a = 0.04 + Math.random() * 0.1;
      x.strokeStyle = `rgba(80,50,20,${a})`; x.lineWidth = 0.6 + Math.random() * 2.4;
      x.beginPath(); x.moveTo(0, y);
      for (let px = 0; px <= 256; px += 16) x.lineTo(px, y + Math.sin(px / 40 + i) * 3 + Math.random() * 1.5);
      x.stroke();
    }
  } else {
    const img = x.getImageData(0, 0, 256, 256);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 255 - Math.random() * (kind === 'soil' ? 90 : 45);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    }
    x.putImageData(img, 0, 0);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const TEX = {};
const tex = k => (TEX[k] ||= makeNoiseTexture(k));

function makeMaterial(p) {
  const color = new THREE.Color(p.color);
  const m = p.material;
  const o = { color, roughness: 0.5, metalness: 0 };
  if (m === 'wood') Object.assign(o, { roughness: 0.78, map: tex('wood') });
  else if (m === 'metal' || m === 'steel') Object.assign(o, { roughness: 0.32, metalness: 0.85 });
  else if (m === 'aluminium') Object.assign(o, { roughness: 0.28, metalness: 0.9 });
  else if (m === 'glass') Object.assign(o, { roughness: 0.05, transparent: true, opacity: 0.32, depthWrite: false });
  else if (m === 'water') Object.assign(o, { roughness: 0.08, transparent: true, opacity: 0.6 });
  else if (m === 'rubber' || m === 'foam') o.roughness = 0.95;
  else if (m === 'fabric') o.roughness = 1;
  else if (m === 'stone' || m === 'concrete') Object.assign(o, { roughness: 0.92, map: tex('stone') });
  else if (m === 'soil') Object.assign(o, { roughness: 1, map: tex('soil') });
  else if (m === 'led') Object.assign(o, { emissive: color, emissiveIntensity: 1.6 });
  else if (m === 'ceramic') o.roughness = 0.18;
  else if (m === 'leather') o.roughness = 0.65;
  else if (m === 'plant') o.roughness = 0.8;
  else if (m === 'paint') o.roughness = 0.42;
  return new THREE.MeshStandardMaterial(o);
}

export class Viewer {
  constructor(container, { onSelect } = {}) {
    this.container = container;
    this.onSelect = onSelect;
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

    this.scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x3a3226, 1.1));
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

    this.ray = new THREE.Raycaster();
    let down = null;
    r.domElement.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; this.userTouched = true; });
    r.domElement.addEventListener('pointerup', e => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      if (moved < 8 && performance.now() - down.t < 400) this.pick(e);
      down = null;
    });

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
    for (const m of this.meshes) { m.material.dispose(); }
    this.root.clear();
    this.meshes = [];
    this.anims = [];
    this.selected = -1;
    if (this.grid) { this.scene.remove(this.grid); this.grid.geometry.dispose(); }

    model.parts.forEach((p, i) => {
      let geo;
      if (p.shape === 'roundbox') geo = new RoundedBoxGeometry(p.size[0], p.size[1], p.size[2], 3, Math.min(...p.size) * 0.18);
      else if (p.shape === 'torus') {
        const R = Math.max(p.size[0] - p.size[1], 0.002) / 2;
        geo = new THREE.TorusGeometry(R, p.size[1] / 2, 18, 56);
        geo.rotateX(Math.PI / 2);
      } else geo = unitGeo(p.shape);
      const mesh = new THREE.Mesh(geo, makeMaterial(p));
      mesh.userData = { index: i, part: p, step: p.step || 1, realMat: mesh.material };
      if (p.shape === 'roundbox') mesh.scale.set(1, 1, 1);
      else if (p.shape === 'torus') mesh.scale.set(1, 1, p.size[2] / Math.max(p.size[0], 1e-4));
      else mesh.scale.set(p.size[0], p.size[1], p.size[2]);
      mesh.position.set(...p.pos);
      mesh.rotation.set(...p.rot.map(d => THREE.MathUtils.degToRad(d)), 'XYZ');
      mesh.castShadow = p.material !== 'glass' && p.material !== 'water';
      mesh.receiveShadow = true;
      mesh.userData.base = mesh.position.clone();
      this.root.add(mesh);
      this.meshes.push(mesh);
    });

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

  applyBlueprint() {
    for (const m of this.meshes) {
      if (this.blueprint && !m.userData.edges) {
        const eg = new THREE.EdgesGeometry(m.geometry, 25);
        const l = new THREE.LineSegments(eg, this.edgeMat);
        l.raycast = () => {};
        m.add(l);
        m.userData.edges = l;
      }
      if (m.userData.edges) m.userData.edges.visible = this.blueprint;
      m.userData.realMat.wireframe = false;
      m.userData.realMat.transparent = this.blueprint || m.userData.part.material === 'glass' || m.userData.part.material === 'water';
      m.userData.realMat.opacity = this.blueprint ? 0.18 : (m.userData.part.material === 'glass' ? 0.32 : m.userData.part.material === 'water' ? 0.6 : 1);
      m.userData.realMat.depthWrite = !this.blueprint;
      m.userData.realMat.needsUpdate = true;
    }
  }

  // show parts up to step n (Infinity = all). Parts of step n animate in.
  setStep(n, animate = true) {
    const prev = this.step;
    this.step = n;
    for (const m of this.meshes) {
      const st = m.userData.step;
      const built = st <= n;
      m.visible = built || this.ghosts;
      m.material = built ? m.userData.realMat : this.ghostMat;
      m.castShadow = built && m.userData.part.material !== 'glass';
      m.userData.ghost = !built;
      m.userData.current = Number.isFinite(n) && st === n;
      if (m.userData.edges) m.userData.edges.visible = this.blueprint && built;
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
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
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
