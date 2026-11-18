// OpenRouter client + prompt + JSON repair/validation
import { httpRequest } from './bridge.js';

export const FREE_ROUTER = 'openrouter/free';
const API = 'https://openrouter.ai/api/v1';

const SHAPES = ['box', 'cylinder', 'sphere', 'cone', 'torus', 'capsule', 'roundbox', 'halfsphere', 'wedge', 'tube'];
const MATERIALS = ['wood', 'metal', 'steel', 'aluminium', 'plastic', 'glass', 'rubber', 'fabric', 'stone', 'concrete', 'paint', 'soil', 'water', 'led', 'pcb', 'foam', 'leather', 'ceramic', 'plant'];

function systemPrompt(s) {
  return `You are BuildCart, an expert maker, carpenter, electronics hobbyist and smart shopper.
The user names an ITEM they want to buy or a PROJECT they want to build. You reply with ONE JSON object and nothing else (no markdown, no comments, no text before or after).

The user lives in ${s.country}. All prices are realistic retail estimates in ${s.currency} for that country (the price field is the TOTAL for the quantity). Use ${s.units} sizes in names and notes.

JSON schema:
{
 "type": "item" or "project",
 "title": "short name",
 "summary": "1-2 sentences",
 "difficulty": "easy" | "medium" | "hard",
 "time_estimate": "e.g. 1 weekend",
 "dimensions": "overall size, e.g. 1200 x 600 x 400 mm",
 "shopping_list": [
   {"id":"s1","name":"specific product","qty":2,"unit":"pcs","price":24.5,"category":"Timber","notes":"size/spec/what to look for","optional":false}
 ],
 "tools": ["tools needed that people often already own"],
 "steps": [ {"title":"short","detail":"clear instruction, 1-3 sentences"} ],
 "tips": ["useful tip"],
 "model": { "parts": [
   {"name":"Left side panel","shape":"box","size":[0.019,0.4,0.6],"pos":[-0.59,0.2,0],"rot":[0,0,0],"color":"#c8a26b","material":"wood","item":"s1","step":1}
 ]}
}

3D MODEL RULES (very important, the model is rendered in 3D):
- Units are METRES. Y is up. The floor is y=0. "pos" is the CENTRE of the part. "rot" is degrees [x,y,z].
- "size" is the full [width(x), height(y), depth(z)] before rotation.
- shape "box"/"roundbox"/"wedge": size = [x,y,z]. "wedge" is a ramp sloping down towards +x.
- shape "cylinder"/"tube"/"cone"/"capsule": axis along Y; size = [diameter, length, diameter]. "tube" is a hollow pipe. Rotate [0,0,90] to lay it along X, [90,0,0] to lay it along Z.
- shape "sphere"/"halfsphere": size = [diameter, diameter, diameter] (halfsphere is a dome, flat side down).
- shape "torus": ring lying flat; size = [outer diameter, tube thickness, outer diameter].
- Parts must touch and join realistically: nothing floating, nothing sunk into the floor, legs reach the floor. Use true real-world proportions.
- Use 12 to 70 parts. Model every visible piece (each board, leg, screw-cluster is optional). Give each part a realistic hex colour and a material from: ${MATERIALS.join(', ')}.
- "item" = the id of the shopping_list entry that part comes from (or "" if none). "step" = the 1-based step number in which that part is added.

IF type is "project": shopping_list = every material and part needed to build it (with cut sizes in notes), steps = the full build in order, and the model shows the WHOLE finished project with every part assigned to the build step that adds it.
IF type is "item": shopping_list = the item itself first (with the key specs to look for) plus essential accessories/consumables; steps = how to choose, buy and set it up; the model is a detailed model of the item itself (all parts can be step 1 or follow setup steps).
Be specific: real product types, sizes, gauges, quantities. Keep it practical and keep the JSON valid.`;
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
  };
  const list = Array.isArray(d.shopping_list) ? d.shopping_list : (Array.isArray(d.shoppingList) ? d.shoppingList : []);
  const ids = new Set();
  list.slice(0, 80).forEach((it, i) => {
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
    });
  });
  const steps = Array.isArray(d.steps) ? d.steps : [];
  out.steps = steps.slice(0, 60).map((s, i) => typeof s === 'string'
    ? { title: `Step ${i + 1}`, detail: s }
    : { title: String(s.title || s.name || `Step ${i + 1}`), detail: String(s.detail || s.description || s.text || '') });

  const parts = (d.model && Array.isArray(d.model.parts)) ? d.model.parts : (Array.isArray(d.parts) ? d.parts : []);
  const nSteps = Math.max(1, out.steps.length);
  parts.slice(0, 200).forEach((p, i) => {
    if (!p || typeof p !== 'object') return;
    let shape = String(p.shape || 'box').toLowerCase();
    if (shape === 'cube' || shape === 'plank' || shape === 'board' || shape === 'panel') shape = 'box';
    if (shape === 'pipe' || shape === 'tube') shape = 'tube';
    if (shape === 'rod' || shape === 'dowel') shape = 'cylinder';
    if (shape === 'dome' || shape === 'hemisphere') shape = 'halfsphere';
    if (!SHAPES.includes(shape)) shape = 'box';
    let size = vec(p.size ?? p.dimensions, [0.1, 0.1, 0.1]).map(v => Math.abs(v));
    if (size.some(v => v > 40)) size = size.map(v => v / 1000); // model used mm
    size = size.map(v => Math.min(Math.max(v, 0.001), 60));
    let pos = vec(p.pos ?? p.position, [0, size[1] / 2, 0]);
    if (pos.some(v => Math.abs(v) > 200)) pos = pos.map(v => v / 1000);
    const rot = vec(p.rot ?? p.rotation, [0, 0, 0]);
    let color = String(p.color || p.colour || '#b0b4bb');
    if (!/^#?[0-9a-f]{3,8}$/i.test(color)) color = '#b0b4bb';
    if (color[0] !== '#') color = '#' + color;
    let material = String(p.material || 'plastic').toLowerCase();
    if (!MATERIALS.includes(material)) material = material.includes('wood') || material.includes('timber') || material.includes('pine') || material.includes('ply') ? 'wood'
      : material.includes('steel') || material.includes('iron') || material.includes('metal') || material.includes('brass') || material.includes('copper') ? 'metal' : 'plastic';
    out.model.parts.push({
      name: String(p.name || `Part ${i + 1}`),
      shape, size, pos, rot, color, material,
      item: ids.has(String(p.item ?? '')) ? String(p.item) : '',
      step: Math.min(Math.max(1, Math.round(num(p.step, 1))), nSteps),
    });
  });
  return out;
}

async function callOpenRouter(settings, messages, model, signal) {
  const body = {
    model,
    messages,
    temperature: 0.4,
    max_tokens: 12000,
  };
  const res = await httpRequest({
    method: 'POST',
    url: `${API}/chat/completions`,
    headers: {
      'Authorization': `Bearer ${settings.apiKey.trim()}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/thegiggler767-gif/BuildCart3D',
      'X-Title': 'BuildCart 3D',
    },
    body: JSON.stringify(body),
    signal,
  });
  let json;
  try { json = JSON.parse(res.body); } catch (e) { json = null; }
  if (res.status !== 200 || !json || json.error) {
    const msg = json?.error?.message || res.body?.slice(0, 200) || `HTTP ${res.status}`;
    const err = new Error(friendlyError(res.status, msg));
    err.status = res.status || json?.error?.code;
    throw err;
  }
  const choice = json.choices && json.choices[0];
  const content = choice?.message?.content || choice?.message?.reasoning || choice?.text || '';
  return { content, model: json.model || model, finish: choice?.finish_reason };
}

function friendlyError(status, msg) {
  if (status === 401) return 'Your OpenRouter API key was rejected. Check it in Settings.';
  if (status === 402) return 'OpenRouter says this model needs credits. Pick a free model in Settings.';
  if (status === 429) return 'The free model is busy or you hit the free daily limit. Wait a minute or pick another free model.';
  if (status === 0) return 'No internet connection (or OpenRouter is unreachable).';
  return `OpenRouter error: ${msg}`;
}

// Generate a build. onStatus(text) for progress.
export async function generate(settings, { prompt, mode, details, budget }, onStatus, signal) {
  const userMsg = [
    `Request: ${prompt}`,
    mode === 'item' ? 'This is an ITEM I want to buy.' : mode === 'project' ? 'This is a PROJECT I want to build.' : 'Decide whether this is an item to buy or a project to build.',
    details ? `Extra details: ${details}` : '',
    budget ? `Budget: about ${budget} ${settings.currency}.` : '',
    'Reply with the JSON object only.',
  ].filter(Boolean).join('\n');
  return runWithRetries(settings, [
    { role: 'system', content: systemPrompt(settings) },
    { role: 'user', content: userMsg },
  ], prompt, onStatus, signal);
}

export async function tweak(settings, current, instruction, onStatus, signal) {
  const compact = JSON.stringify(current);
  return runWithRetries(settings, [
    { role: 'system', content: systemPrompt(settings) },
    { role: 'user', content: `Here is the current build JSON:\n${compact}\n\nChange it like this: ${instruction}\n\nUpdate the shopping list, steps and 3D model to match, keep everything else. Reply with the full updated JSON object only.` },
  ], current.title, onStatus, signal);
}

async function runWithRetries(settings, messages, prompt, onStatus, signal) {
  const models = [settings.model || FREE_ROUTER];
  if (models[0] !== FREE_ROUTER) models.push(FREE_ROUTER);
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    const model = models[Math.min(attempt, models.length - 1)];
    try {
      onStatus?.(attempt === 0 ? 'Asking the AI…' : `Retrying (${attempt + 1}/3)…`);
      const r = await callOpenRouter(settings, messages, model, signal);
      onStatus?.('Building your 3D model…');
      const parsed = stripToJson(r.content);
      const data = normalize(parsed, prompt);
      if (!data.shopping_list.length && !data.model.parts.length) throw new Error('The AI reply was empty');
      data.generatedBy = r.model;
      return data;
    } catch (e) {
      if (signal?.aborted) throw new Error('Cancelled');
      lastErr = e;
      if (e.status === 401 || e.status === 0) throw e;
      if (/broken JSON|did not return JSON|Empty reply|reply was empty/.test(e.message)) {
        messages = messages.concat([{ role: 'user', content: 'Your last reply was not valid JSON. Reply again with ONLY the complete JSON object, keep it shorter if needed (max 40 parts).' }]);
      }
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
    .map(m => ({ id: m.id, name: m.name || m.id, ctx: m.context_length || 0 }))
    .sort((a, b) => b.ctx - a.ctx);
}

export async function testKey(settings) {
  const res = await httpRequest({ method: 'GET', url: `${API}/key`, headers: { Authorization: `Bearer ${settings.apiKey.trim()}` } });
  if (res.status !== 200) throw new Error(friendlyError(res.status, res.body?.slice(0, 120)));
  const j = JSON.parse(res.body);
  return j.data || {};
}
