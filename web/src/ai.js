// OpenRouter client + prompt + JSON repair/validation
import { httpRequest, httpStream } from './bridge.js';

export const FREE_ROUTER = 'openrouter/free';
const API = 'https://openrouter.ai/api/v1';

const SHAPES = ['box', 'cylinder', 'sphere', 'cone', 'torus', 'capsule', 'roundbox', 'halfsphere', 'wedge', 'tube', 'extrude', 'lathe', 'path'];
const MATERIALS = ['wood', 'plywood', 'metal', 'steel', 'aluminium', 'brass', 'chrome', 'plastic', 'glass', 'rubber', 'fabric', 'stone', 'concrete', 'paint', 'soil', 'water', 'led', 'pcb', 'foam', 'leather', 'ceramic', 'plant', 'brick', 'carbon'];

// PASS 1: exact parts list, steps, layout (no 3D yet)
function planPrompt(s) {
  return `You are BuildCart, an expert maker, carpenter, electrician/electronics builder and smart shopper.
The user names an ITEM they want to buy or a PROJECT they want to build. Reply with ONE JSON object only (no markdown, no text around it).

The user lives in ${s.country}. Prices are realistic retail estimates in ${s.currency} from stores in that country ("price" = TOTAL for the qty). Use ${s.units} sizes.

JSON schema:
{
 "type": "item" or "project",
 "title": "short name",
 "summary": "1-2 sentences",
 "difficulty": "easy" | "medium" | "hard",
 "time_estimate": "e.g. 1 weekend",
 "dimensions": "overall finished size, e.g. 1200 x 600 x 400 mm",
 "shopping_list": [
   {"id":"s1","name":"90 x 19 mm treated pine decking board, 2.4 m","qty":3,"unit":"lengths","price":27,"category":"Timber",
    "dims":[2400,90,19],"notes":"Cut plan: 4 x 1200 mm + 4 x 550 mm (fits 3 lengths with kerf)","optional":false,"have":false}
 ],
 "tools": ["tools needed"],
 "steps": [ {"title":"short","detail":"exact instruction with measurements and which items to use"} ],
 "tips": ["useful tip"],
 "layout": "6-12 sentences describing the EXACT geometry of the finished thing for a 3D artist: overall size, where every component sits (in mm from the centre / floor), how each joins to the next, orientation, colours"
}

THE SHOPPING LIST MUST BE AN EXACT, COMPLETE BILL OF MATERIALS:
- Buying exactly these items in these quantities must be enough to build the finished thing with NOTHING else needed (apart from the tools list).
- Every item is a specific product you can actually buy, with exact specs: dimensions and length, material/grade, screw gauge + length + head type, bolt thread size, wire gauge, voltage/current, connector type, pin count, and the common model name for modules (e.g. "ESP32-DevKitC V4 38-pin", "BME280 I2C breakout 3.3 V").
- All components must be compatible with each other (voltages, logic levels, connectors, thread sizes, how pieces fit). Say why in the notes when it matters.
- Quantities must exactly cover what is built. Timber/sheet/wire: give a cut plan in notes and make sure the cuts fit in the stock lengths you list. Count every screw, bolt, washer, nut, bracket, hinge, wire, header pin.
- Include every fastener, adhesive, finish, cable, connector, solder, heat-shrink, power supply and battery needed. Never write "assorted", "as needed" or "misc".
- "dims" = exact size of ONE unit in millimetres [length, width, thickness/height]. Required for every physical item.
- Steps must use the listed items by name and real measurements, in the right order, so someone could build it start to finish.
IF type is "item": the first shopping_list entry is the item itself with the exact specs/model to look for, then essential accessories; steps = how to choose, buy and set it up; layout describes the item itself in detail.`;
}

// PASS 2: detailed 3D model built only from the parts list
function modelPrompt() {
  return `You are a meticulous 3D modeller who builds extremely detailed, realistic models out of primitive shapes. Reply with ONE JSON object only, no markdown:
{"model":{"parts":[ ... ]},"missing_items":[ ... ]}

Each part: {"name":"Left front leg","shape":"box","size":[x,y,z],"pos":[x,y,z],"rot":[x,y,z],"color":"#hex","material":"wood","item":"s2","step":1}
Optional on any part: "repeat":{"count":N,"offset":[dx,dy,dz]} makes N evenly spaced copies (slats, screws, pins, steps, rungs). For things arranged in a circle use "repeat":{"count":N,"rot":[0,360/N,0],"around":[x,y,z]} (each copy rotates around that pivot point: spokes, bolts on a flange, petals),
and "mirror":"x" | "z" | "xz" adds mirrored copies across x=0 and/or z=0 (use for symmetric pairs: legs, sides, wheels).

COORDINATES: metres, Y is up, floor is y=0, the model is centred on x=0 and z=0. "pos" is the centre of the part. "rot" in degrees (omit if 0).
SHAPES:
- "box", "roundbox" (rounded edges), "wedge" (ramp sloping down to +x): size = [x,y,z].
- "cylinder", "tube" (hollow pipe), "cone", "capsule": axis along Y, size = [diameter, length, diameter]. rot [0,0,90] lays it along X, [90,0,0] along Z.
- "sphere", "halfsphere" (dome, flat side down): size = [d,d,d].
- "torus": flat ring, size = [outer diameter, thickness, outer diameter].
- "extrude": any flat outline. "points":[[x,y],...] outline in metres in the part's local X/Y plane (centred on 0,0), extruded along local Z by size[2]. Use for brackets, curved sides, cut-outs, surfboards, signs, gussets.
- "lathe": round turned shape. "profile":[[radius,y],...] from bottom to top, spun around Y. Use for knobs, bottles, pots, turned legs, wheels, lamp shades, bolts.
- "path": a cable/rod/handle following points. "path":[[x,y,z],...] relative to pos, size[0] = diameter. Use for wires, cables, hoses, bent handles, rails.

RULES:
1. DETAIL: 60 to 160 part entries (more rendered pieces through repeat/mirror). Model every board, leg, rail, slat, panel, module and component, PLUS small details: screw and bolt heads (tiny cylinders, repeat them along joints), washers, nuts, hinges, handles, brackets, rubber feet, rounded edges (roundbox), trims, labels, buttons, LEDs, pin headers (repeat), chips on boards, wires (path) between connected pins, soldered joints, vents, grilles, seams, wheel spokes, treads. Vary board colours slightly so they look real.
2. EXACT PARTS: every part comes from the parts list - set "item" to its id. Use the exact real size from that item's dims/name (a 90 x 19 mm board is 0.09 x 0.019 in cross-section; an ESP32 DevKit is 0.055 x 0.028). The number of copies must match the qty (4 legs if the list says 4 legs).
3. If the build needs a part that is NOT in the list, add it to "missing_items" (same fields as the list: id "m1","m2"..., name, qty, unit, price, category, dims, notes) and reference that id.
4. Everything touches what it connects to: nothing floating, nothing sunk into the floor; things sitting on the floor have their bottom at y=0. Parts must not overlap unless they are fixed into each other.
5. "step" = the build step number (1-based) when that part gets added, so the build can be animated.
6. Realistic colours and materials from: ${MATERIALS.join(', ')}.`;
}

export function stripToJson(text) {
  if (!text) throw new Error('Empty reply from the AI');
  let t = String(text).replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1].includes('{')) t = fence[1];
  const start = t.indexOf('{');
  if (start < 0) throw new Error('The AI did not return JSON');
  t = t.slice(start);
  // try straight parse of the balanced object
  const balanced = balance(t);
  const attempts = [balanced, repair(balanced), repair(closeOpen(t))];
  for (const a of attempts) {
    try { return JSON.parse(a); } catch (e) { /* next */ }
  }
  throw new Error('Could not read the AI reply (broken JSON)');
}

function balance(t) {
  let depth = 0, inStr = false, esc = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') { depth--; if (depth === 0) return t.slice(0, i + 1); }
  }
  return t;
}

// close a truncated JSON (model ran out of tokens)
function closeOpen(t) {
  const stack = []; let inStr = false, esc = false, lastSafe = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']');
    else if (c === '}' || c === ']') { stack.pop(); lastSafe = i + 1; }
    else if (c === ',') lastSafe = i;
  }
  let out = t.slice(0, lastSafe);
  // recompute the stack for the cut text
  const st = []; inStr = false; esc = false;
  for (const c of out) {
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') st.push(c === '{' ? '}' : ']');
    else if (c === '}' || c === ']') st.pop();
  }
  return out.replace(/,\s*$/, '') + st.reverse().join('');
}

function repair(t) {
  return t
    .replace(/\/\/[^\n"]*$/gm, '')
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":')
    .replace(/:\s*'([^'"]*)'/g, ':"$1"')
    .replace(/\bNaN\b|\bInfinity\b/g, '0');
}

const num = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
const vec = (v, d) => Array.isArray(v) ? [0, 1, 2].map(i => num(v[i], d[i])) : (typeof v === 'number' ? [v, v, v] : d.slice());

export function normalize(raw, prompt) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const out = {
    type: d.type === 'item' ? 'item' : 'project',
    title: String(d.title || prompt || 'My build').slice(0, 80),
    summary: String(d.summary || ''),
    difficulty: String(d.difficulty || ''),
    time_estimate: String(d.time_estimate || ''),
    dimensions: String(d.dimensions || ''),
    tools: (Array.isArray(d.tools) ? d.tools : []).map(String).slice(0, 30),
    tips: (Array.isArray(d.tips) ? d.tips : []).map(t => typeof t === 'string' ? t : (t.text || t.tip || JSON.stringify(t))).slice(0, 20),
    steps: [],
    shopping_list: [],
    model: { parts: [] },
    layout: String(d.layout || ''),
  };
  const list = Array.isArray(d.shopping_list) ? d.shopping_list : (Array.isArray(d.shoppingList) ? d.shoppingList : []);
  const ids = new Set();
  list.slice(0, 120).forEach((it, i) => {
    if (!it) return;
    if (typeof it === 'string') it = { name: it };
    let id = String(it.id || `s${i + 1}`);
    while (ids.has(id)) id += '_';
    ids.add(id);
    out.shopping_list.push({
      id,
      name: String(it.name || it.item || 'Item').slice(0, 120),
      qty: Math.max(0, num(it.qty ?? it.quantity, 1)),
      unit: String(it.unit || ''),
      price: Math.max(0, num(String(it.price ?? it.est_price ?? it.cost ?? 0).replace(/[^0-9.]/g, ''), 0)),
      category: String(it.category || 'Other'),
      notes: String(it.notes || it.spec || ''),
      optional: !!it.optional,
      have: !!it.have,
      dims: Array.isArray(it.dims) ? it.dims.slice(0, 3).map(v => num(v, 0)) : undefined,
    });
  });
  const steps = Array.isArray(d.steps) ? d.steps : [];
  out.steps = steps.slice(0, 60).map((s, i) => typeof s === 'string'
    ? { title: `Step ${i + 1}`, detail: s }
    : { title: String(s.title || s.name || `Step ${i + 1}`), detail: String(s.detail || s.description || s.text || '') });

  const parts = (d.model && Array.isArray(d.model.parts)) ? d.model.parts : (Array.isArray(d.parts) ? d.parts : []);
  const nSteps = Math.max(1, out.steps.length);
  parts.slice(0, 260).forEach((p, i) => {
    const np = normPart(p, i, ids, nSteps);
    if (np) out.model.parts.push(np);
  });
  return out;
}

const pts2 = (v, n) => Array.isArray(v) ? v.filter(q => Array.isArray(q) && q.length >= n).slice(0, 200).map(q => q.slice(0, n).map(x => num(x, 0))) : null;
const mmFix = arr => (arr && arr.some(q => q.some(x => Math.abs(x) > 20))) ? arr.map(q => q.map(x => x / 1000)) : arr;

function normPart(p, i, ids, nSteps) {
  if (!p || typeof p !== 'object') return null;
  let shape = String(p.shape || 'box').toLowerCase();
  if (['cube', 'plank', 'board', 'panel', 'slab', 'block'].includes(shape)) shape = 'box';
  if (['rounded', 'roundedbox', 'rounded_box', 'bevelbox'].includes(shape)) shape = 'roundbox';
  if (shape === 'pipe') shape = 'tube';
  if (['rod', 'dowel', 'disc', 'disk', 'cyl'].includes(shape)) shape = 'cylinder';
  if (shape === 'dome' || shape === 'hemisphere') shape = 'halfsphere';
  if (['cable', 'wire', 'curve', 'polyline', 'spline', 'hose'].includes(shape)) shape = 'path';
  if (['revolve', 'spin', 'turned'].includes(shape)) shape = 'lathe';
  if (['polygon', 'shape', 'outline', 'profile2d', 'extrusion'].includes(shape)) shape = 'extrude';
  if (!SHAPES.includes(shape)) shape = 'box';
  let size = vec(p.size ?? p.dimensions, [0.1, 0.1, 0.1]).map(v => Math.abs(v));
  if (size.some(v => v > 40)) size = size.map(v => v / 1000); // model used mm
  let pos = vec(p.pos ?? p.position, [0, size[1] / 2, 0]);
  if (pos.some(v => Math.abs(v) > 200)) pos = pos.map(v => v / 1000);
  const rot = vec(p.rot ?? p.rotation, [0, 0, 0]);
  const out = { name: String(p.name || `Part ${i + 1}`), shape };

  if (shape === 'extrude') {
    const pts = mmFix(pts2(p.points ?? p.outline, 2));
    if (!pts || pts.length < 3) out.shape = 'box';
    else {
      out.points = pts;
      const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
      size = [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), size[2] || 0.01];
    }
  } else if (shape === 'lathe') {
    const pr = mmFix(pts2(p.profile ?? p.points, 2));
    if (!pr || pr.length < 2) out.shape = 'cylinder';
    else {
      out.profile = pr.map(q => [Math.abs(q[0]), q[1]]);
      const r = Math.max(...out.profile.map(q => q[0])), ys = out.profile.map(q => q[1]);
      size = [r * 2, Math.max(...ys) - Math.min(...ys), r * 2];
    }
  } else if (shape === 'path') {
    const pt = mmFix(pts2(p.path ?? p.points, 3));
    if (!pt || pt.length < 2) out.shape = 'cylinder';
    else {
      out.path = pt;
      out.dia = Math.min(Math.max(size[0] || 0.005, 0.0005), 0.5);
      if (!(p.pos ?? p.position)) pos = [0, 0, 0];
      size = [0, 1, 2].map(k => Math.max(...pt.map(q => q[k])) - Math.min(...pt.map(q => q[k])) + out.dia);
    }
  }
  out.size = size.map(v => Math.min(Math.max(v, 0.0005), 60));
  out.pos = pos; out.rot = rot;
  let color = String(p.color || p.colour || '#b0b4bb');
  if (!/^#?[0-9a-f]{3,8}$/i.test(color)) color = '#b0b4bb';
  out.color = color[0] === '#' ? color : '#' + color;
  let material = String(p.material || 'plastic').toLowerCase();
  if (!MATERIALS.includes(material)) material = /ply/.test(material) ? 'plywood' : /wood|timber|pine|oak|mdf|bamboo|cedar|hardwood/.test(material) ? 'wood'
    : /chrom/.test(material) ? 'chrome' : /brass|copper|bronze|gold/.test(material) ? 'brass' : /alu/.test(material) ? 'aluminium'
    : /steel|iron|metal|zinc|galv|tin/.test(material) ? 'metal' : /circuit|board/.test(material) ? 'pcb' : /stone|marble|granite/.test(material) ? 'stone' : 'plastic';
  out.material = material;
  out.item = ids.has(String(p.item ?? '')) ? String(p.item) : '';
  out.step = Math.min(Math.max(1, Math.round(num(p.step, 1))), nSteps);
  const rp = p.repeat || p.array;
  if (rp && typeof rp === 'object') {
    const count = Math.round(num(rp.count ?? rp.n, 1));
    if (count > 1) {
      let off = vec(rp.offset ?? rp.spacing ?? rp.step, [0, 0, 0]);
      if (off.some(v => Math.abs(v) > 40)) off = off.map(v => v / 1000);
      out.repeat = { count: Math.min(count, 80), offset: off, rot: vec(rp.rot ?? rp.rotation, [0, 0, 0]) };
      if (Array.isArray(rp.around ?? rp.pivot)) { let pv = vec(rp.around ?? rp.pivot, [0, 0, 0]); if (pv.some(v => Math.abs(v) > 200)) pv = pv.map(v => v / 1000); out.repeat.around = pv; }
    }
  }
  const m = String(p.mirror || '').toLowerCase();
  if (m.includes('x') || m.includes('z')) out.mirror = (m.includes('x') ? 'x' : '') + (m.includes('z') ? 'z' : '');
  return out;
}

// how many rendered copies a part definition makes
export function copiesOf(p) {
  return (p.repeat ? p.repeat.count : 1) * (p.mirror ? (p.mirror.length === 2 ? 4 : 2) : 1);
}

// ---- usage counter (free tier ≈ 50 requests/day) ----
export function usageToday() {
  try {
    const u = JSON.parse(localStorage.getItem('bc3d_usage') || '{}');
    return u.date === new Date().toDateString() ? u.n : 0;
  } catch { return 0; }
}
function countUsage() {
  const n = usageToday() + 1;
  localStorage.setItem('bc3d_usage', JSON.stringify({ date: new Date().toDateString(), n }));
}

function headers(settings) {
  return {
    'Authorization': `Bearer ${settings.apiKey.trim()}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://github.com/thegiggler767-gif/fleasion_sky_immagess',
    'X-Title': 'BuildCart 3D',
  };
}

// Streams the reply. onText(fullTextSoFar, {thinking}) is called as text arrives.
async function callOpenRouter(settings, messages, model, signal, onText, opts = {}) {
  const body = { model, messages, temperature: opts.temperature ?? 0.35, max_tokens: opts.max_tokens ?? 16000, stream: true };
  countUsage();
  let buf = '', content = '', reasoning = '', usedModel = model, finish = null, streamErr = null;
  const res = await httpStream({
    method: 'POST', url: `${API}/chat/completions`, headers: headers(settings), body: JSON.stringify(body), signal,
    onChunk: chunk => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        const l = line.trim();
        if (!l.startsWith('data:')) continue;
        const data = l.slice(5).trim();
        if (data === '[DONE]') continue;
        let j; try { j = JSON.parse(data); } catch { continue; }
        if (j.error) { streamErr = j.error; continue; }
        if (j.model) usedModel = j.model;
        const ch = j.choices && j.choices[0];
        if (!ch) continue;
        const d = ch.delta || ch.message || {};
        if (d.content) content += d.content;
        if (d.reasoning) reasoning += d.reasoning;
        if (ch.finish_reason) finish = ch.finish_reason;
      }
      onText?.(content, { thinking: !content && !!reasoning, reasoningLen: reasoning.length });
    },
  });
  // flush any last line
  if (buf.trim().startsWith('data:')) {
    try { const j = JSON.parse(buf.trim().slice(5)); const d = j.choices?.[0]?.delta; if (d?.content) content += d.content; } catch { }
  }
  if (res.status !== 200 || streamErr) {
    let json = null; try { json = JSON.parse(res.body); } catch { }
    const e = streamErr || json?.error;
    const status = res.status !== 200 ? res.status : (e?.code || 500);
    const err = new Error(friendlyError(status, e?.message || res.body?.slice(0, 200) || `HTTP ${res.status}`));
    err.status = status;
    throw err;
  }
  if (!content && reasoning) content = reasoning;
  return { content, model: usedModel, finish };
}

function friendlyError(status, msg) {
  if (status === 401) return 'Your OpenRouter API key was rejected. Check it in Settings.';
  if (status === 402) return 'OpenRouter says this model needs credits. Pick a free model in Settings.';
  if (status === 429) return 'The free model is busy or you hit the free daily limit. Wait a minute or pick another free model.';
  if (status === 0) return 'No internet connection (or OpenRouter is unreachable).';
  return `OpenRouter error: ${msg}`;
}

// Generate a build in two passes: 1) exact parts list + steps, 2) detailed 3D model from those parts.
export async function generate(settings, { prompt, mode, details, budget, image, have, onlyHave }, onStatus, signal) {
  const userMsg = [
    prompt ? `Request: ${prompt}` : 'Request: look at the photo and work out what I want (the item to buy, or the project to build or copy).',
    image ? 'A photo is attached: identify the item/project in it and base everything on it (match its look, size and parts).' : '',
    mode === 'item' ? 'This is an ITEM I want to buy.' : mode === 'project' ? 'This is a PROJECT I want to build.' : 'Decide whether this is an item to buy or a project to build.',
    details ? `Extra details: ${details}` : '',
    budget ? `Budget: about ${budget} ${settings.currency}.` : '',
    have ? `Parts I ALREADY HAVE (use these exact parts, list them with "have": true and price 0): ${have}` : '',
    have && onlyHave ? 'Build it using ONLY the parts I already have. Only add something to buy if it is impossible without it, and keep that to the bare minimum.' : '',
    'Reply with the JSON object only.',
  ].filter(Boolean).join('\n');
  const content = image ? [{ type: 'text', text: userMsg }, { type: 'image_url', image_url: { url: image } }] : userMsg;
  const plan = await runWithRetries(settings, [
    { role: 'system', content: planPrompt(settings) },
    { role: 'user', content },
  ], prompt || 'Photo build', stage(onStatus, 'Step 1 of 2 · Working out the exact parts'), signal);
  return addModel(settings, plan, null, '', onStatus, signal);
}

function stage(onStatus, label) {
  return (t, prog) => onStatus?.(t && /Retrying/.test(t) ? `${label} — retrying…` : `${label}…`, prog);
}

function planBrief(d) {
  return {
    type: d.type, title: d.title, dimensions: d.dimensions, layout: d.layout,
    parts_list: d.shopping_list.map(i => ({ id: i.id, name: i.name, qty: i.qty, unit: i.unit, dims_mm: i.dims, notes: i.notes })),
    steps: d.steps.map((s, i) => `${i + 1}. ${s.title}: ${s.detail}`),
  };
}

// PASS 2 — build (or rebuild) the detailed 3D model for a plan. oldModel/instruction are optional.
export async function addModel(settings, plan, oldModel, instruction, onStatus, signal) {
  let msg = `Build the detailed 3D model of this finished ${plan.type} using ONLY these parts:\n${JSON.stringify(planBrief(plan))}`;
  if (oldModel && oldModel.parts?.length) msg += `\n\nThe previous 3D model (keep what is right, fix what is wrong, and add a LOT more detail):\n${JSON.stringify({ parts: compactParts(oldModel.parts) })}`;
  if (instruction) msg += `\n\nThe user also asked: ${instruction}`;
  msg += '\n\nReply with ONLY {"model":{"parts":[...]},"missing_items":[...]}.';
  try {
    return await runWithRetries(settings, [
      { role: 'system', content: modelPrompt() },
      { role: 'user', content: msg },
    ], plan.title, stage(onStatus, 'Step 2 of 2 · Modelling every part in 3D'), signal, parsed => {
      const missing = Array.isArray(parsed.missing_items) ? parsed.missing_items : [];
      const ids = new Set(plan.shopping_list.map(i => i.id));
      const extra = missing.filter(m => m && m.name && !ids.has(String(m.id))).map((m, k) => ({ ...m, id: String(m.id || `m${k + 1}`), notes: `${m.notes ? m.notes + ' · ' : ''}added by the 3D check`, addedBy3D: true }));
      const merged = normalize({ ...plan, shopping_list: [...plan.shopping_list, ...extra], model: parsed.model || parsed }, plan.title);
      merged.shopping_list.forEach(i => { const src = extra.find(e => e.id === i.id); if (src) i.addedBy3D = true; });
      if (merged.model.parts.length < 3) throw new Error('The AI reply was empty');
      return merged;
    });
  } catch (e) {
    if (signal?.aborted || e.message === 'Cancelled') throw e;
    if (e.status === 401 || e.status === 0) throw e;
    // keep the parts list even if the 3D pass failed
    const keep = normalize({ ...plan, model: oldModel || { parts: [] } }, plan.title);
    keep.modelError = e.message;
    keep.generatedBy = plan.generatedBy;
    return keep;
  }
}

function compactParts(parts) {
  const r4 = v => Math.round(v * 10000) / 10000;
  return parts.map(p => {
    const q = { name: p.name, shape: p.shape, size: p.size.map(r4), pos: p.pos.map(r4), color: p.color, material: p.material, item: p.item, step: p.step };
    if (p.rot.some(v => v)) q.rot = p.rot.map(v => Math.round(v));
    for (const k of ['repeat', 'mirror', 'points', 'profile', 'path', 'dia']) if (p[k] !== undefined) q[k] = p[k];
    return q;
  });
}

export async function tweak(settings, current, instruction, onStatus, signal) {
  const planOnly = { ...current, model: undefined };
  delete planOnly.generatedBy; delete planOnly.modelError;
  const plan = await runWithRetries(settings, [
    { role: 'system', content: planPrompt(settings) },
    { role: 'user', content: `Here is my current build (without the 3D model):\n${JSON.stringify(planOnly)}\n\nChange it like this: ${instruction}\n\nUpdate the shopping list (keep it an exact, complete bill of materials), steps and layout to match, keep everything else and keep the same item ids where the item is unchanged. Reply with the full updated JSON object only.` },
  ], current.title, stage(onStatus, 'Step 1 of 2 · Updating the parts list'), signal);
  return addModel(settings, plan, current.model, instruction, onStatus, signal);
}

// Rebuild ONLY the 3D model with much more detail (1 request)
export async function refineModel(settings, current, onStatus, signal) {
  const plan = normalize({ ...current, model: { parts: [] } }, current.title);
  plan.generatedBy = current.generatedBy;
  const r = await addModel(settings, plan, current.model, 'Make the 3D model far more detailed and accurate than before.', onStatus, signal);
  if (r.modelError) throw new Error(r.modelError);
  return r;
}

// Fix buildability problems found by the app's check
export async function fixBuild(settings, current, problems, onStatus, signal) {
  return tweak(settings, current, `Make sure the shopping list is EXACTLY what is needed to build what is in the 3D model. Fix these problems: ${problems.join('; ')}`, onStatus, signal);
}

export function modelChain(settings) {
  const chain = [settings.model || FREE_ROUTER, FREE_ROUTER, ...(settings.fallbacks || [])];
  return [...new Set(chain.filter(Boolean))].slice(0, 4);
}

export function progressText(t) {
  const items = (t.match(/"price"\s*:/g) || []).length;
  const parts = (t.match(/"shape"\s*:/g) || []).length;
  const steps = (t.match(/"detail"\s*:/g) || []).length;
  const bits = [];
  if (items) bits.push(`🛒 ${items} item${items > 1 ? 's' : ''}`);
  if (steps) bits.push(`📋 ${steps} step${steps > 1 ? 's' : ''}`);
  if (parts) bits.push(`🧩 ${parts} 3D part${parts > 1 ? 's' : ''}`);
  return bits.join(' · ') || `✍️ ${t.length} characters`;
}

async function runWithRetries(settings, messages, prompt, onStatus, signal, parse = normalizeReply) {
  const models = modelChain(settings);
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    const model = models[Math.min(attempt, models.length - 1)];
    try {
      onStatus?.(attempt === 0 ? 'Asking the AI…' : `Retrying with another model (${attempt + 1}/3)…`, '');
      const r = await callOpenRouter(settings, messages, model, signal, (t, info) => {
        if (info.thinking) onStatus?.('The AI is thinking…', `🧠 ${info.reasoningLen} characters of thinking`);
        else onStatus?.('Writing your build…', progressText(t));
      });
      onStatus?.('Building your 3D model…', progressText(r.content));
      const data = parse(stripToJson(r.content), prompt);
      data.generatedBy = r.model;
      return data;
    } catch (e) {
      if (signal?.aborted) throw new Error('Cancelled');
      lastErr = e;
      if (e.status === 401 || e.status === 0) throw e;
      if (/broken JSON|did not return JSON|Empty reply|reply was empty/.test(e.message)) {
        messages = messages.concat([{ role: 'user', content: 'Your last reply was not valid or complete JSON. Reply again with ONLY the complete JSON object. If it is long, shorten text fields and use "repeat"/"mirror" to keep it compact, but keep the detail.' }]);
      }
    }
  }
  throw lastErr;
}

function normalizeReply(parsed, prompt) {
  const data = normalize(parsed, prompt);
  if (!data.shopping_list.length && !data.model.parts.length) throw new Error('The AI reply was empty');
  return data;
}

// Free-text Q&A about a build (streams). Returns the answer text.
export async function ask(settings, current, history, question, onText, signal) {
  const brief = {
    title: current.title, type: current.type, summary: current.summary, dimensions: current.dimensions,
    shopping_list: current.shopping_list.map(i => `${i.qty} ${i.unit} ${i.name} (${i.price} ${settings.currency})${i.notes ? ' - ' + i.notes : ''}`),
    steps: current.steps.map((s, i) => `${i + 1}. ${s.title}: ${s.detail}`), tools: current.tools,
  };
  const messages = [
    { role: 'system', content: `You are BuildCart, a friendly expert maker and shopping helper. The user lives in ${settings.country}, prices in ${settings.currency}, ${settings.units} units. Answer questions about their build clearly and practically in short paragraphs or short lists (plain text, light markdown ok). Here is the build:\n${JSON.stringify(brief)}` },
    ...history.slice(-10).map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: question },
  ];
  let lastErr;
  for (const model of modelChain(settings).slice(0, 3)) {
    try {
      const r = await callOpenRouter(settings, messages, model, signal, t => onText?.(t), { temperature: 0.6, max_tokens: 2500 });
      return r.content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim() || '(no answer)';
    } catch (e) {
      if (signal?.aborted) throw new Error('Cancelled');
      lastErr = e;
      if (e.status === 401 || e.status === 0) throw e;
    }
  }
  throw lastErr;
}

export async function listFreeModels(settings) {
  const res = await httpRequest({ method: 'GET', url: `${API}/models`, headers: settings.apiKey ? { Authorization: `Bearer ${settings.apiKey.trim()}` } : {} });
  if (res.status !== 200) throw new Error(friendlyError(res.status, res.body?.slice(0, 120)));
  const json = JSON.parse(res.body);
  return (json.data || [])
    .filter(m => m.pricing && Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0)
    .filter(m => !(m.architecture?.output_modalities || ['text']).every(x => x !== 'text'))
    .map(m => ({ id: m.id, name: m.name || m.id, ctx: m.context_length || 0, vision: (m.architecture?.input_modalities || []).includes('image') }))
    .sort((a, b) => b.ctx - a.ctx);
}

export async function testKey(settings) {
  const res = await httpRequest({ method: 'GET', url: `${API}/key`, headers: { Authorization: `Bearer ${settings.apiKey.trim()}` } });
  if (res.status !== 200) throw new Error(friendlyError(res.status, res.body?.slice(0, 120)));
  const j = JSON.parse(res.body);
  return j.data || {};
}
