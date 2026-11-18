// Builds real-size geometry, world-scale UVs and realistic procedural materials for parts.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const D2R = THREE.MathUtils.degToRad;

// ---------- procedural textures ----------
function canvas(n) { const c = document.createElement('canvas'); c.width = c.height = n; return [c, c.getContext('2d')]; }
function rnd(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

function woodCanvas(ply) {
  const [c, x] = canvas(512);
  const r = rnd(ply ? 7 : 3);
  x.fillStyle = '#efe4d2'; x.fillRect(0, 0, 512, 512);
  // broad colour bands
  for (let i = 0; i < 14; i++) {
    const y = r() * 512, h = 10 + r() * 60;
    x.fillStyle = `rgba(${150 + r() * 40},${100 + r() * 30},${55 + r() * 20},${0.05 + r() * 0.08})`;
    x.fillRect(0, y, 512, h);
  }
  // grain lines (run along u / x)
  for (let i = 0; i < (ply ? 90 : 150); i++) {
    const y0 = r() * 512, amp = 2 + r() * 6, f = 0.004 + r() * 0.01, ph = r() * 6;
    x.strokeStyle = `rgba(${90 + r() * 40},${55 + r() * 25},${25 + r() * 15},${0.06 + r() * 0.16})`;
    x.lineWidth = 0.5 + r() * 2;
    x.beginPath();
    for (let px = -4; px <= 516; px += 8) {
      const yy = y0 + Math.sin(px * f + ph) * amp + Math.sin(px * f * 3.1) * amp * 0.25;
      px < 0 ? x.moveTo(px, yy) : x.lineTo(px, yy);
    }
    x.stroke();
  }
  // knots
  if (!ply) for (let k = 0; k < 3; k++) {
    const cx = r() * 512, cy = r() * 512, rr = 5 + r() * 9;
    for (let j = 6; j > 0; j--) {
      x.strokeStyle = `rgba(90,50,20,${0.08 + (6 - j) * 0.05})`; x.lineWidth = 1.2;
      x.beginPath(); x.ellipse(cx, cy, rr * j * 0.55 * 2.2, rr * j * 0.55, 0, 0, Math.PI * 2); x.stroke();
    }
    x.fillStyle = 'rgba(70,38,15,.55)'; x.beginPath(); x.ellipse(cx, cy, rr * 0.9, rr * 0.5, 0, 0, Math.PI * 2); x.fill();
  }
  return c;
}

function noiseCanvas(kind) {
  const [c, x] = canvas(256);
  const r = rnd(kind.length * 31 + 5);
  const img = x.createImageData(256, 256);
  const amt = { stone: 60, concrete: 50, soil: 110, plant: 80, leather: 40, foam: 50, rubber: 20, brushed: 40 }[kind] ?? 40;
  for (let y = 0; y < 256; y++) for (let i = 0; i < 256; i++) {
    let v = 255 - r() * amt;
    if (kind === 'brushed') v = 235 - (Math.sin(y * 0.9 + r() * 0.5) * 0.5 + 0.5) * 25 - r() * 18;
    const o = (y * 256 + i) * 4;
    img.data[o] = img.data[o + 1] = img.data[o + 2] = v; img.data[o + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  if (kind === 'stone' || kind === 'concrete') {
    for (let k = 0; k < 160; k++) { x.fillStyle = `rgba(0,0,0,${r() * 0.12})`; x.beginPath(); x.arc(r() * 256, r() * 256, r() * 2.5, 0, 7); x.fill(); }
  }
  if (kind === 'leather') {
    for (let k = 0; k < 500; k++) { x.strokeStyle = `rgba(0,0,0,${r() * 0.1})`; x.beginPath(); const px = r() * 256, py = r() * 256; x.moveTo(px, py); x.lineTo(px + r() * 8 - 4, py + r() * 8 - 4); x.stroke(); }
  }
  return c;
}

function weaveCanvas(dark) {
  const [c, x] = canvas(128);
  x.fillStyle = dark ? '#3a3a3a' : '#f2f2f2'; x.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 128; i += 8) for (let j = 0; j < 128; j += 8) {
    x.fillStyle = ((i + j) / 8) % 2 ? (dark ? '#262626' : '#d6d6d6') : (dark ? '#4a4a4a' : '#ffffff');
    x.fillRect(i, j, 8, 4);
  }
  return c;
}

function brickCanvas() {
  const [c, x] = canvas(256);
  x.fillStyle = '#d9d2c8'; x.fillRect(0, 0, 256, 256);
  const r = rnd(11);
  for (let row = 0; row < 8; row++) for (let col = -1; col < 4; col++) {
    const ox = (row % 2) * 32;
    const v = 200 + r() * 55;
    x.fillStyle = `rgb(${v},${v * 0.92},${v * 0.88})`;
    x.fillRect(col * 64 + ox + 2, row * 32 + 2, 60, 28);
  }
  return c;
}

function pcbCanvas() {
  const [c, x] = canvas(256);
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, 256, 256);
  const r = rnd(5);
  x.strokeStyle = 'rgba(0,0,0,.16)'; x.lineWidth = 2;
  for (let i = 0; i < 40; i++) {
    let px = r() * 256, py = r() * 256;
    x.beginPath(); x.moveTo(px, py);
    for (let k = 0; k < 3; k++) { if (r() > 0.5) px += (r() - 0.5) * 120; else py += (r() - 0.5) * 120; x.lineTo(px, py); }
    x.stroke();
  }
  x.fillStyle = 'rgba(210,180,90,.5)';
  for (let i = 0; i < 30; i++) { x.beginPath(); x.arc(r() * 256, r() * 256, 2.5, 0, 7); x.fill(); }
  return c;
}

const TEX = {};
function tex(kind) {
  if (TEX[kind]) return TEX[kind];
  const cv = kind === 'wood' ? woodCanvas(false) : kind === 'plywood' ? woodCanvas(true) : kind === 'fabric' ? weaveCanvas(false)
    : kind === 'carbon' ? weaveCanvas(true) : kind === 'brick' ? brickCanvas() : kind === 'pcb' ? pcbCanvas() : noiseCanvas(kind);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  const b = new THREE.CanvasTexture(cv);
  b.wrapS = b.wrapT = THREE.RepeatWrapping;
  return (TEX[kind] = { map: t, bump: b });
}

// texture tile size in metres per material
const TILE = { wood: 0.7, plywood: 0.5, stone: 0.35, concrete: 0.5, soil: 0.3, plant: 0.12, leather: 0.15, fabric: 0.06, carbon: 0.04, brick: 0.5, pcb: 0.06, brushed: 0.25, foam: 0.1 };

export function makeMaterial(p) {
  const color = new THREE.Color(p.color);
  const m = p.material;
  const o = { color, roughness: 0.5, metalness: 0 };
  const T = k => { const t = tex(k); return { map: t.map, bumpMap: t.bump, bumpScale: 1.2 }; };
  switch (m) {
    case 'wood': Object.assign(o, T('wood'), { roughness: 0.72 }); break;
    case 'plywood': Object.assign(o, T('plywood'), { roughness: 0.75 }); break;
    case 'metal': case 'steel': Object.assign(o, { roughness: 0.32, metalness: 0.85, roughnessMap: tex('brushed').bump, bumpMap: tex('brushed').bump, bumpScale: 0.3 }); break;
    case 'aluminium': Object.assign(o, { roughness: 0.28, metalness: 0.9, roughnessMap: tex('brushed').bump }); break;
    case 'chrome': Object.assign(o, { roughness: 0.06, metalness: 1 }); break;
    case 'brass': Object.assign(o, { roughness: 0.25, metalness: 1 }); break;
    case 'glass': Object.assign(o, { roughness: 0.04, transparent: true, opacity: 0.28, depthWrite: false, envMapIntensity: 2 }); break;
    case 'water': Object.assign(o, { roughness: 0.06, transparent: true, opacity: 0.6 }); break;
    case 'rubber': Object.assign(o, { roughness: 0.92 }); break;
    case 'foam': Object.assign(o, T('foam'), { roughness: 1 }); break;
    case 'fabric': Object.assign(o, T('fabric'), { roughness: 0.95 }); break;
    case 'leather': Object.assign(o, T('leather'), { roughness: 0.6 }); break;
    case 'stone': Object.assign(o, T('stone'), { roughness: 0.85 }); break;
    case 'concrete': Object.assign(o, T('concrete'), { roughness: 0.92 }); break;
    case 'brick': Object.assign(o, T('brick'), { roughness: 0.9 }); break;
    case 'soil': Object.assign(o, T('soil'), { roughness: 1, bumpScale: 3 }); break;
    case 'plant': Object.assign(o, T('plant'), { roughness: 0.75 }); break;
    case 'pcb': Object.assign(o, T('pcb'), { roughness: 0.5, bumpScale: 0.6 }); break;
    case 'carbon': Object.assign(o, T('carbon'), { roughness: 0.3, metalness: 0.2 }); break;
    case 'led': Object.assign(o, { emissive: color, emissiveIntensity: 1.6, roughness: 0.2 }); break;
    case 'ceramic': o.roughness = 0.15; break;
    case 'paint': o.roughness = 0.42; break;
    default: o.roughness = 0.42; // plastic
  }
  return new THREE.MeshStandardMaterial(o);
}

// ---------- geometry ----------
function projectUV(geo, part) {
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  if (!pos || !nor) return geo;
  const tile = TILE[part.material] || 0.4;
  // grain runs along the part's longest axis
  const s = part.size, longest = s[0] >= s[1] && s[0] >= s[2] ? 0 : s[1] >= s[2] ? 1 : 2;
  const uv = new Float32Array(pos.count * 2);
  const P = [0, 0, 0], N = [0, 0, 0];
  for (let i = 0; i < pos.count; i++) {
    P[0] = pos.getX(i); P[1] = pos.getY(i); P[2] = pos.getZ(i);
    N[0] = Math.abs(nor.getX(i)); N[1] = Math.abs(nor.getY(i)); N[2] = Math.abs(nor.getZ(i));
    const a = N[0] >= N[1] && N[0] >= N[2] ? 0 : N[1] >= N[2] ? 1 : 2;
    const pl = [0, 1, 2].filter(k => k !== a);
    const u = pl.includes(longest) ? longest : pl[0], v = pl[0] === u ? pl[1] : pl[0];
    uv[i * 2] = P[u] / tile + a * 0.37;
    uv[i * 2 + 1] = P[v] / tile + a * 0.71;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

function bevelFor(p) {
  const mn = Math.min(...p.size);
  if (mn < 0.004) return 0;
  const cap = { wood: 0.003, plywood: 0.0015, metal: 0.0012, steel: 0.0012, aluminium: 0.0012, chrome: 0.002, brass: 0.0015, plastic: 0.0025, rubber: 0.004, foam: 0.006, fabric: 0.01, leather: 0.006 }[p.material] ?? 0.002;
  return Math.min(cap, mn * 0.22);
}

const GEO_CACHE = new Map();
export function clearGeoCache() { GEO_CACHE.forEach(g => { g.geo.dispose(); g.edges?.dispose(); }); GEO_CACHE.clear(); }

export function buildGeometry(p) {
  const key = JSON.stringify([p.shape, p.size, p.material, p.points, p.profile, p.path, p.dia]);
  if (GEO_CACHE.has(key)) return GEO_CACHE.get(key);
  const [sx, sy, sz] = p.size;
  const segs = d => Math.max(10, Math.min(48, Math.round(d * 260) + 10));
  let geo, edgeSrc = null, edgeAngle = 35;
  switch (p.shape) {
    case 'box': case 'roundbox': {
      const b = p.shape === 'roundbox' ? Math.min(Math.min(sx, sy, sz) * 0.3, 0.025) : bevelFor(p);
      geo = b > 0 ? new RoundedBoxGeometry(sx, sy, sz, p.shape === 'roundbox' ? 4 : 2, b) : new THREE.BoxGeometry(sx, sy, sz);
      edgeSrc = new THREE.BoxGeometry(sx, sy, sz);
      if (p.shape === 'roundbox') edgeSrc = null;
      break;
    }
    case 'cylinder': geo = new THREE.CylinderGeometry(sx / 2, sx / 2, sy, segs(sx)); geo.scale(1, 1, sz / Math.max(sx, 1e-5)); break;
    case 'cone': geo = new THREE.ConeGeometry(sx / 2, sy, segs(sx)); geo.scale(1, 1, sz / Math.max(sx, 1e-5)); break;
    case 'sphere': geo = new THREE.SphereGeometry(0.5, 40, 24); geo.scale(sx, sy, sz); edgeAngle = 89; break;
    case 'halfsphere': geo = new THREE.SphereGeometry(0.5, 40, 14, 0, Math.PI * 2, 0, Math.PI / 2); geo.translate(0, -0.25, 0); geo.scale(sx, sy, sz); break;
    case 'capsule': { const r = sx / 2; geo = new THREE.CapsuleGeometry(r, Math.max(sy - sx, 0.0001), 8, segs(sx)); geo.scale(1, 1, sz / Math.max(sx, 1e-5)); edgeAngle = 89; break; }
    case 'tube': {
      const r = sx / 2, t = Math.max(Math.min(r * 0.15, 0.004), 0.0006);
      const pts = [[r - t, -sy / 2], [r, -sy / 2], [r, sy / 2], [r - t, sy / 2], [r - t, -sy / 2]].map(q => new THREE.Vector2(q[0], q[1]));
      geo = new THREE.LatheGeometry(pts, segs(sx)); geo.scale(1, 1, sz / Math.max(sx, 1e-5)); break;
    }
    case 'torus': { const R = Math.max(sx - sy, 0.002) / 2; geo = new THREE.TorusGeometry(R, sy / 2, 16, 56); geo.rotateX(Math.PI / 2); geo.scale(1, 1, sz / Math.max(sx, 1e-5)); edgeAngle = 89; break; }
    case 'wedge': {
      const s = new THREE.Shape();
      s.moveTo(-sx / 2, -sy / 2); s.lineTo(sx / 2, -sy / 2); s.lineTo(-sx / 2, sy / 2); s.lineTo(-sx / 2, -sy / 2);
      geo = new THREE.ExtrudeGeometry(s, { depth: sz, bevelEnabled: false }); geo.translate(0, 0, -sz / 2); break;
    }
    case 'extrude': {
      const pts = p.points;
      const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
      const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
      const s = new THREE.Shape(pts.map(q => new THREE.Vector2(q[0] - cx, q[1] - cy)));
      const bv = Math.min(bevelFor(p), sz * 0.2);
      geo = new THREE.ExtrudeGeometry(s, { depth: Math.max(sz - bv * 2, 0.0002), bevelEnabled: bv > 0, bevelThickness: bv, bevelSize: bv, bevelSegments: 1, curveSegments: 10 });
      geo.translate(0, 0, -sz / 2 + bv);
      edgeSrc = new THREE.ExtrudeGeometry(s, { depth: sz, bevelEnabled: false }); edgeSrc.translate(0, 0, -sz / 2);
      break;
    }
    case 'lathe': {
      const ys = p.profile.map(q => q[1]); const my = (Math.max(...ys) + Math.min(...ys)) / 2;
      geo = new THREE.LatheGeometry(p.profile.map(q => new THREE.Vector2(Math.max(q[0], 0.00001), q[1] - my)), 40);
      edgeAngle = 50; break;
    }
    case 'path': {
      const v = p.path.map(q => new THREE.Vector3(q[0], q[1], q[2]));
      const curve = v.length > 2 ? new THREE.CatmullRomCurve3(v, false, 'centripetal') : new THREE.LineCurve3(v[0], v[1]);
      geo = new THREE.TubeGeometry(curve, Math.min(200, Math.max(16, v.length * 10)), p.dia / 2, 10, false);
      edgeAngle = 89; break;
    }
    default: geo = new THREE.BoxGeometry(sx, sy, sz);
  }
  projectUV(geo, p);
  const edges = new THREE.EdgesGeometry(edgeSrc || geo, edgeAngle);
  edgeSrc?.dispose?.();
  const out = { geo, edges };
  GEO_CACHE.set(key, out);
  return out;
}

// all placed copies of a part definition (repeat + mirror)
export function instancesOf(p) {
  const list = [];
  const base = new THREE.Vector3(...p.pos);
  const rot = p.rot.map(D2R);
  const rp = p.repeat;
  const n = rp ? rp.count : 1;
  for (let k = 0; k < n; k++) {
    const pos = base.clone();
    const e = new THREE.Euler(...rot, 'XYZ');
    if (rp) {
      pos.add(new THREE.Vector3(...rp.offset).multiplyScalar(k));
      if (rp.rot && rp.rot.some(v => v)) {
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...rp.rot.map(v => D2R(v * k)), 'XYZ'));
        if (rp.around) { const piv = new THREE.Vector3(...rp.around); pos.sub(piv).applyQuaternion(q).add(piv); }
        e.setFromQuaternion(q.multiply(new THREE.Quaternion().setFromEuler(e)), 'XYZ');
      }
    }
    list.push({ pos, rot: e });
  }
  if (!p.mirror) return list;
  const out = list.slice();
  const mir = (it, ax) => {
    const pos = it.pos.clone(), e = it.rot.clone();
    if (ax === 'x') { pos.x = -pos.x; e.y = -e.y; e.z = -e.z; }
    else { pos.z = -pos.z; e.x = -e.x; e.y = -e.y; }
    return { pos, rot: e, mirrored: ax };
  };
  if (p.mirror.includes('x')) list.forEach(it => out.push(mir(it, 'x')));
  if (p.mirror.includes('z')) out.slice().forEach(it => out.push(mir(it, 'z')));
  // drop copies that land exactly on another (e.g. part already on the mirror line)
  return out.filter((it, i) => !out.slice(0, i).some(o => o.pos.distanceToSquared(it.pos) < 1e-10 && Math.abs(o.rot.y - it.rot.y) < 1e-6));
}
