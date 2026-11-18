import { Viewer } from './viewer.js';
import { generate, tweak, listFreeModels, testKey, FREE_ROUTER } from './ai.js';
import { share, copy, openUrl, toast, saveFile, vibrate, isAndroid } from './bridge.js';
import { SAMPLE } from './sample.js';

// ---------- state ----------
const LS_SETTINGS = 'bc3d_settings', LS_BUILDS = 'bc3d_builds', LS_MODELS = 'bc3d_models';
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const settings = Object.assign({
  apiKey: '', model: FREE_ROUTER, currency: 'AUD', country: 'Australia', units: 'metric', store: 'google',
}, load(LS_SETTINGS, {}));
let builds = load(LS_BUILDS, []);
let cachedModels = load(LS_MODELS, []);
const saveSettings = () => localStorage.setItem(LS_SETTINGS, JSON.stringify(settings));
const saveBuilds = () => { try { localStorage.setItem(LS_BUILDS, JSON.stringify(builds)); } catch (e) { toast('Storage full — delete some old builds'); } };

let view = 'home';
let current = null;      // build object {id, created, prompt, data, checked}
let tab = '3d';
let viewer = null;
let homeMode = 'auto';
let abortCtl = null;
let playTimer = null;

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = v => {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: settings.currency, maximumFractionDigits: v >= 100 ? 0 : 2 }).format(v || 0); }
  catch { return `${settings.currency} ${(v || 0).toFixed(2)}`; }
};
const app = $('#app');

const STORES = {
  google: { name: 'Google Shopping', url: q => `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(q)}` },
  bunnings: { name: 'Bunnings', url: q => `https://www.bunnings.com.au/search/products?q=${encodeURIComponent(q)}` },
  amazon: { name: 'Amazon AU', url: q => `https://www.amazon.com.au/s?k=${encodeURIComponent(q)}` },
  ebay: { name: 'eBay AU', url: q => `https://www.ebay.com.au/sch/i.html?_nkw=${encodeURIComponent(q)}` },
  jaycar: { name: 'Jaycar', url: q => `https://www.jaycar.com.au/search?text=${encodeURIComponent(q)}` },
  aliexpress: { name: 'AliExpress', url: q => `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(q)}` },
};

const EXAMPLES = [
  ['🪴', 'Raised garden bed'], ['🐦', 'Birdhouse'], ['🖥️', 'Budget gaming PC'], ['🛏️', 'Single bunk bed'],
  ['📡', 'ESP32 weather station'], ['🔧', 'Cordless drill'], ['🏄', 'Surfboard rack for 3 boards'], ['🪑', 'Outdoor bench seat'],
  ['🐔', 'Chicken coop for 4 hens'], ['📚', 'Floating bookshelf'], ['🛹', 'Skateboard'], ['🏕️', 'Camping kitchen box'],
];

// ---------- routing ----------
function go(v, opts = {}) {
  stopPlay();
  if (viewer && v !== 'result') viewer.stop();
  view = v;
  if (opts.tab) tab = opts.tab;
  render();
  window.scrollTo(0, 0);
}

window.onAndroidBack = () => {
  if ($('.sheet-backdrop')) { closeSheet(); return true; }
  if (abortCtl) { abortCtl.abort(); return true; }
  if (view !== 'home') { go('home'); return true; }
  return false;
};

function render() {
  if (view === 'home') renderHome();
  else if (view === 'settings') renderSettings();
  else if (view === 'result') renderResult();
}

// ---------- home ----------
function renderHome() {
  const hasKey = !!settings.apiKey.trim();
  app.innerHTML = `
  <header class="top">
    <div class="brand"><span class="logo">${logoSvg()}</span><span>BuildCart <b>3D</b></span></div>
    <button class="icon-btn" id="btnSettings" aria-label="Settings">${icon('gear')}</button>
  </header>
  <section class="hero">
    <h1>What are you <span class="hl">building</span> or <span class="hl2">buying</span>?</h1>
    <p class="sub">Get a shopping list with prices and a 3D model you can spin, explode and build step by step.</p>
    ${hasKey ? '' : `<div class="banner"><div><b>Add your free OpenRouter key</b><br><span>Needed to make new builds. It stays on this phone.</span></div><button class="btn small" id="btnAddKey">Add key</button></div>`}
    <div class="card input-card">
      <textarea id="prompt" rows="2" placeholder="e.g. a chicken coop for 4 hens, or a cordless drill">${esc(sessionStorage.getItem('bc3d_draft') || '')}</textarea>
      <div class="seg" id="mode">
        ${['auto', 'item', 'project'].map(m => `<button data-m="${m}" class="${homeMode === m ? 'on' : ''}">${m === 'auto' ? '✨ Auto' : m === 'item' ? '🛒 Item' : '🔨 Project'}</button>`).join('')}
      </div>
      <details class="more">
        <summary>More options</summary>
        <label>Details (size, style, what you already have)</label>
        <textarea id="details" rows="2" placeholder="e.g. 1.8 m long, use pallets, I already own a drill"></textarea>
        <label>Budget (${esc(settings.currency)})</label>
        <input id="budget" type="number" inputmode="decimal" placeholder="optional">
      </details>
      <button class="btn primary big" id="btnGo">${icon('spark')} Generate</button>
    </div>
    <div class="chips">${EXAMPLES.map(([e, t]) => `<button class="chip" data-ex="${esc(t)}">${e} ${esc(t)}</button>`).join('')}</div>
  </section>
  <section class="list-section">
    <div class="sec-head"><h2>Your builds</h2>${builds.length ? `<span class="muted">${builds.length}</span>` : ''}</div>
    ${builds.length ? builds.map(buildCard).join('') : `<div class="empty">Nothing yet. ${hasKey ? 'Type something above!' : ''}</div>`}
    <button class="btn ghost wide" id="btnDemo">${icon('cube')} Open the demo build</button>
  </section>`;

  $('#btnSettings').onclick = () => go('settings');
  $('#btnAddKey')?.addEventListener('click', () => go('settings'));
  $('#prompt').oninput = e => sessionStorage.setItem('bc3d_draft', e.target.value);
  $('#mode').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    homeMode = b.dataset.m; vibrate();
    [...$('#mode').children].forEach(x => x.classList.toggle('on', x === b));
  };
  app.querySelectorAll('[data-ex]').forEach(b => b.onclick = () => { $('#prompt').value = b.dataset.ex; sessionStorage.setItem('bc3d_draft', b.dataset.ex); $('#prompt').focus(); });
  $('#btnGo').onclick = startGenerate;
  $('#btnDemo').onclick = () => openBuild({ id: 'demo', created: Date.now(), prompt: 'demo', data: JSON.parse(JSON.stringify(SAMPLE)), checked: {} });
  app.querySelectorAll('[data-open]').forEach(el => el.onclick = e => {
    if (e.target.closest('[data-del]')) return;
    const b = builds.find(x => x.id === el.dataset.open); if (b) openBuild(b);
  });
  app.querySelectorAll('[data-del]').forEach(el => el.onclick = () => {
    const b = builds.find(x => x.id === el.dataset.del);
    if (b) ask(`Delete "${b.data.title}"?`, 'Delete', () => { builds = builds.filter(x => x !== b); saveBuilds(); renderHome(); });
  });
}

function totals(b) {
  const list = b.data.shopping_list;
  const total = list.filter(i => !i.optional).reduce((s, i) => s + i.price, 0);
  const got = list.filter(i => b.checked[i.id]).reduce((s, i) => s + i.price, 0);
  const done = list.filter(i => b.checked[i.id]).length;
  return { total, got, done, count: list.length, optional: list.filter(i => i.optional).reduce((s, i) => s + i.price, 0) };
}

function buildCard(b) {
  const t = totals(b);
  const pct = t.count ? Math.round(t.done / t.count * 100) : 0;
  return `<div class="card build" data-open="${b.id}">
    <div class="build-icon ${b.data.type}">${b.data.type === 'item' ? '🛒' : '🔨'}</div>
    <div class="build-body">
      <div class="build-title">${esc(b.data.title)}</div>
      <div class="muted small">${t.count} items · ${money(t.total)} · ${b.data.model.parts.length} parts</div>
      <div class="bar"><i style="width:${pct}%"></i></div>
    </div>
    <button class="icon-btn subtle" data-del="${b.id}" aria-label="Delete">${icon('trash')}</button>
  </div>`;
}

// ---------- generate ----------
async function startGenerate() {
  const prompt = $('#prompt').value.trim();
  if (!prompt) { toast('Type an item or project first'); $('#prompt').focus(); return; }
  if (!settings.apiKey.trim()) { toast('Add your OpenRouter key first'); go('settings'); return; }
  const details = $('#details')?.value.trim(), budget = $('#budget')?.value.trim();
  const data = await withLoading(signal => generate(settings, { prompt, mode: homeMode, details, budget }, setLoadingStatus, signal));
  if (!data) return;
  sessionStorage.removeItem('bc3d_draft');
  const b = { id: 'b' + Date.now().toString(36), created: Date.now(), prompt, data, checked: {} };
  builds.unshift(b); saveBuilds();
  openBuild(b);
}

const LOADING_TIPS = [
  'Free models can take 20–90 seconds. Hang tight!',
  'Tip: tap any part in 3D to see what to buy for it.',
  'Tip: use Explode to see how everything fits together.',
  'Tip: “Change it” lets you resize or restyle with AI.',
  'Tip: tick items off in the List as you shop.',
  'Tip: export the 3D model as .glb to open it in other apps.',
];

async function withLoading(fn) {
  abortCtl = new AbortController();
  const ov = document.createElement('div');
  ov.className = 'loading';
  ov.innerHTML = `<div class="loader-card">
    <div class="cube-spin"><div></div><div></div><div></div><div></div><div></div><div></div></div>
    <div class="status" id="ldStatus">Starting…</div>
    <div class="muted small" id="ldTime">0s</div>
    <div class="tip" id="ldTip">${LOADING_TIPS[0]}</div>
    <button class="btn ghost" id="ldCancel">Cancel</button></div>`;
  document.body.appendChild(ov);
  const t0 = Date.now();
  let tipI = 0;
  const timer = setInterval(() => {
    const s = Math.round((Date.now() - t0) / 1000);
    $('#ldTime').textContent = `${s}s`;
    if (s && s % 6 === 0) { tipI = (tipI + 1) % LOADING_TIPS.length; $('#ldTip').textContent = LOADING_TIPS[tipI]; }
  }, 1000);
  $('#ldCancel').onclick = () => abortCtl?.abort();
  try {
    return await fn(abortCtl.signal);
  } catch (e) {
    if (e.message !== 'Cancelled') showError(e.message);
    return null;
  } finally {
    clearInterval(timer); ov.remove(); abortCtl = null;
  }
}
function setLoadingStatus(t) { const el = $('#ldStatus'); if (el) el.textContent = t; }

function showError(msg) {
  openSheet(`<h3>Something went wrong</h3><p>${esc(msg)}</p>
    <div class="row gap"><button class="btn" data-close>OK</button><button class="btn ghost" id="errSettings">Settings</button></div>`);
  $('#errSettings').onclick = () => { closeSheet(); go('settings'); };
}

// ---------- result ----------
function openBuild(b) { current = b; tab = '3d'; go('result'); }

function renderResult() {
  const d = current.data;
  const steps = d.steps.length;
  app.innerHTML = `
  <header class="top result-top">
    <button class="icon-btn" id="btnBack" aria-label="Back">${icon('back')}</button>
    <div class="rt-title"><div class="t">${esc(d.title)}</div><div class="muted small">${d.type === 'item' ? '🛒 Item' : '🔨 Project'} · ${money(totals(current).total)}</div></div>
    <button class="icon-btn" id="btnMenu" aria-label="Menu">${icon('dots')}</button>
  </header>
  <nav class="tabs">
    ${[['3d', '3D'], ['list', 'List'], ['steps', d.type === 'item' ? 'Setup' : 'Steps'], ['info', 'Info']].map(([k, l]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}
  </nav>
  <div class="tab-body" id="tabBody"></div>
  <div class="tweak-bar">
    <input id="tweakIn" placeholder="✏️ Change it… e.g. make it 1.8 m long">
    <button class="btn primary small" id="tweakGo">${icon('spark')}</button>
  </div>`;
  $('#btnBack').onclick = () => go('home');
  $('#btnMenu').onclick = openMenu;
  app.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; vibrate(); renderResult(); });
  $('#tweakGo').onclick = doTweak;
  $('#tweakIn').onkeydown = e => { if (e.key === 'Enter') doTweak(); };
  if (tab === '3d') render3D(); else { viewer?.stop(); }
  if (tab === 'list') renderList();
  if (tab === 'steps') renderSteps();
  if (tab === 'info') renderInfo();
}

function render3D() {
  const d = current.data;
  const body = $('#tabBody');
  const hasSteps = d.type === 'project' && d.steps.length > 1;
  body.innerHTML = `
  <div class="stage ${hasSteps ? 'with-steps' : ''}" id="stage">
    <div class="hud tl"><span id="dims"></span></div>
    <div class="hud tr col">
      <button class="fab" id="tRotate" title="Auto rotate">${icon('rotate')}</button>
      <button class="fab" id="tXray" title="X-ray">${icon('xray')}</button>
      <button class="fab" id="tReset" title="Reset view">${icon('target')}</button>
      <button class="fab" id="tPic" title="Save picture">${icon('camera')}</button>
    </div>
    <div class="part-card hidden" id="partCard"></div>
  </div>
  <div class="controls card">
    ${hasSteps ? `
    <div class="step-row">
      <button class="icon-btn" id="sPrev">${icon('prev')}</button>
      <div class="step-mid">
        <div class="step-label" id="stepLabel"></div>
        <input type="range" id="stepRange" min="1" max="${d.steps.length + 1}" value="${d.steps.length + 1}">
      </div>
      <button class="icon-btn" id="sNext">${icon('next')}</button>
      <button class="icon-btn accent" id="sPlay">${icon('play')}</button>
    </div>` : ''}
    <div class="explode-row">
      <span class="muted small">Explode</span>
      <input type="range" id="explode" min="0" max="100" value="0">
      ${hasSteps ? `<label class="toggle"><input type="checkbox" id="ghost" checked><span>Ghost</span></label>` : ''}
    </div>
  </div>`;
  if (!viewer) viewer = new Viewer(document.createElement('div'), { onSelect: showPart });
  $('#stage').prepend(viewer.container);
  viewer.container.className = 'canvas-wrap';
  viewer.start();
  if (viewer.loadedFor !== current) { viewer.load(d.model); viewer.loadedFor = current; viewer.setAutoRotate(true); }
  else { viewer.resize(); viewer.select(-1); }
  viewer.setExplode(0);
  if (!d.model.parts.length) $('#stage').insertAdjacentHTML('beforeend', `<div class="hud center muted">No 3D parts in this build — try “Change it: add a 3D model”.</div>`);
  $('#dims').textContent = viewer.dimensionsText(settings.units);
  $('#tRotate').classList.toggle('on', viewer.controls.autoRotate);
  $('#tXray').classList.toggle('on', viewer.blueprint);
  $('#tRotate').onclick = e => { viewer.setAutoRotate(!viewer.controls.autoRotate); e.currentTarget.classList.toggle('on', viewer.controls.autoRotate); };
  $('#tXray').onclick = e => { viewer.setBlueprint(!viewer.blueprint); e.currentTarget.classList.toggle('on', viewer.blueprint); viewer.setStep(viewer.step, false); };
  $('#tReset').onclick = () => viewer.resetView();
  $('#tPic').onclick = () => { const url = viewer.snapshot(); saveFile(`${slug(d.title)}.png`, 'image/png', url.split(',')[1]); };
  $('#explode').oninput = e => viewer.setExplode(e.target.value / 100);
  if (hasSteps) {
    const total = d.steps.length;
    const range = $('#stepRange');
    const show = (n, anim = true) => {
      n = Math.max(1, Math.min(total + 1, n));
      range.value = n;
      viewer.setStep(n > total ? Infinity : n, anim);
      $('#stepLabel').innerHTML = n > total ? `<b>Finished build</b> <span class="muted">· all ${total} steps</span>` : `<b>Step ${n}/${total}:</b> ${esc(d.steps[n - 1].title)}`;
    };
    $('#ghost').onchange = e => viewer.setGhosts(e.target.checked);
    viewer.setGhosts(true);
    range.oninput = () => { stopPlay(); show(+range.value); };
    $('#sPrev').onclick = () => { stopPlay(); show(+range.value - 1); vibrate(); };
    $('#sNext').onclick = () => { stopPlay(); show(+range.value + 1); vibrate(); };
    $('#sPlay').onclick = () => {
      if (playTimer) { stopPlay(); return; }
      viewer.setAutoRotate(true); $('#tRotate').classList.add('on');
      let n = 1; show(n);
      $('#sPlay').innerHTML = icon('pause');
      playTimer = setInterval(() => { n++; show(n); if (n > total) stopPlay(); }, 1700);
    };
    show(viewer.pendingStep || total + 1, !!viewer.pendingStep);
    viewer.pendingStep = null;
  }
}

function stopPlay() {
  if (playTimer) { clearInterval(playTimer); playTimer = null; }
  const b = $('#sPlay'); if (b) b.innerHTML = icon('play');
}

function showPart(i) {
  const card = $('#partCard'); if (!card) return;
  if (i < 0) { card.classList.add('hidden'); return; }
  vibrate(8);
  const d = current.data, p = d.model.parts[i];
  const it = d.shopping_list.find(x => x.id === p.item);
  const step = d.steps[p.step - 1];
  card.classList.remove('hidden');
  card.innerHTML = `<button class="x" id="pcX">×</button>
    <div class="pc-name">${esc(p.name)}</div>
    <div class="muted small">${p.material} · ${fmtSize(p.size)}${step && d.type === 'project' ? ` · step ${p.step}` : ''}</div>
    ${it ? `<div class="pc-item">
      <label class="check"><input type="checkbox" ${current.checked[it.id] ? 'checked' : ''} data-chk="${it.id}"><span></span></label>
      <div><div>${esc(it.name)}</div><div class="muted small">${fmtQty(it)} · ${money(it.price)}</div></div>
      <button class="btn small ghost" data-shop="${esc(it.name)}">${icon('search')}</button>
    </div>` : `<div class="muted small">Not linked to a shopping item.</div>`}`;
  $('#pcX').onclick = () => { viewer.select(-1); card.classList.add('hidden'); };
  card.querySelector('[data-chk]')?.addEventListener('change', e => { current.checked[e.target.dataset.chk] = e.target.checked; persistCurrent(); });
  card.querySelector('[data-shop]')?.addEventListener('click', e => searchStore(e.currentTarget.dataset.shop));
}

function fmtSize(s) {
  if (settings.units === 'imperial') return s.map(v => (v * 39.37).toFixed(1) + '″').join(' × ');
  return s.map(v => Math.round(v * 1000)).join(' × ') + ' mm';
}
const fmtQty = it => `${+it.qty.toFixed(2)} ${esc(it.unit || '')}`.trim();

function renderList() {
  const d = current.data;
  const t = totals(current);
  const cats = {};
  d.shopping_list.forEach(i => (cats[i.category] ||= []).push(i));
  const pct = t.count ? Math.round(t.done / t.count * 100) : 0;
  $('#tabBody').innerHTML = `
  <div class="pad">
    <div class="card totals">
      <div><div class="muted small">Estimated total</div><div class="big-num">${money(t.total)}</div>${t.optional ? `<div class="muted small">+ ${money(t.optional)} optional</div>` : ''}</div>
      <div class="right"><div class="muted small">${t.done}/${t.count} got</div><div class="num">${money(Math.max(t.total - t.got, 0))} left</div></div>
      <div class="bar wide"><i style="width:${pct}%"></i></div>
    </div>
    <div class="row gap wrap">
      <button class="btn small" id="shareList">${icon('share')} Share list</button>
      <button class="btn small ghost" id="copyList">${icon('copy')} Copy</button>
      <select id="storeSel" class="small-select">${Object.entries(STORES).map(([k, v]) => `<option value="${k}" ${settings.store === k ? 'selected' : ''}>🔎 ${v.name}</option>`).join('')}</select>
    </div>
    ${Object.entries(cats).map(([c, items]) => `
      <h3 class="cat">${esc(c)} <span class="muted small">${money(items.reduce((s, i) => s + i.price, 0))}</span></h3>
      ${items.map(i => `
      <div class="card item ${current.checked[i.id] ? 'done' : ''}">
        <label class="check"><input type="checkbox" ${current.checked[i.id] ? 'checked' : ''} data-chk="${i.id}"><span></span></label>
        <div class="item-body" data-exp="${i.id}">
          <div class="item-name">${esc(i.name)} ${i.optional ? '<span class="pill">optional</span>' : ''}</div>
          <div class="muted small">${fmtQty(i)}${i.notes ? ' · ' + esc(i.notes) : ''}</div>
          <div class="item-actions hidden" id="act-${i.id}">
            <button class="btn small ghost" data-shop="${esc(i.name)}">${icon('search')} Find it</button>
            ${d.model.parts.some(p => p.item === i.id) ? `<button class="btn small ghost" data-show="${i.id}">${icon('cube')} Show in 3D</button>` : ''}
          </div>
        </div>
        <div class="price">${money(i.price)}</div>
      </div>`).join('')}`).join('')}
    ${d.tools.length ? `<h3 class="cat">Tools you'll need</h3><div class="chips static">${d.tools.map(x => `<span class="chip">🔧 ${esc(x)}</span>`).join('')}</div>` : ''}
    <p class="muted small center">Prices are AI estimates — check the store before buying.</p>
  </div>`;
  app.querySelectorAll('[data-chk]').forEach(c => c.onchange = e => {
    current.checked[c.dataset.chk] = e.target.checked; vibrate(); persistCurrent();
    c.closest('.item').classList.toggle('done', e.target.checked);
    const scroll = window.scrollY; renderList(); window.scrollTo(0, scroll);
  });
  app.querySelectorAll('[data-exp]').forEach(el => el.onclick = e => { if (e.target.closest('button')) return; $('#act-' + CSS.escape(el.dataset.exp)).classList.toggle('hidden'); });
  app.querySelectorAll('[data-shop]').forEach(b => b.onclick = () => searchStore(b.dataset.shop));
  app.querySelectorAll('[data-show]').forEach(b => b.onclick = () => {
    const idx = current.data.model.parts.findIndex(p => p.item === b.dataset.show);
    tab = '3d'; renderResult();
    viewer.setStep(Infinity, false);
    const r = $('#stepRange'); if (r) { r.value = r.max; r.oninput(); }
    viewer.select(idx); showPart(idx);
  });
  $('#shareList').onclick = () => share(listText());
  $('#copyList').onclick = () => { copy(listText()); toast('List copied'); };
  $('#storeSel').onchange = e => { settings.store = e.target.value; saveSettings(); };
}

function searchStore(q) { openUrl((STORES[settings.store] || STORES.google).url(q)); }

function listText() {
  const d = current.data, t = totals(current);
  const lines = [`🛒 ${d.title} — shopping list`, ''];
  const cats = {};
  d.shopping_list.forEach(i => (cats[i.category] ||= []).push(i));
  for (const [c, items] of Object.entries(cats)) {
    lines.push(`${c.toUpperCase()}`);
    items.forEach(i => lines.push(`${current.checked[i.id] ? '☑' : '☐'} ${i.name} — ${+i.qty.toFixed(2)} ${i.unit} (~${money(i.price)})${i.optional ? ' [optional]' : ''}${i.notes ? `\n    ${i.notes}` : ''}`));
    lines.push('');
  }
  lines.push(`Estimated total: ${money(t.total)}`);
  if (d.tools.length) lines.push('', `Tools: ${d.tools.join(', ')}`);
  lines.push('', 'Made with BuildCart 3D');
  return lines.join('\n');
}

function renderSteps() {
  const d = current.data;
  $('#tabBody').innerHTML = `<div class="pad">
    ${d.steps.length ? d.steps.map((s, i) => `
    <div class="card step">
      <div class="step-num">${i + 1}</div>
      <div class="step-body"><div class="step-title">${esc(s.title)}</div><div class="step-detail">${esc(s.detail)}</div>
      ${d.type === 'project' && d.model.parts.some(p => p.step === i + 1) ? `<button class="btn small ghost" data-step="${i + 1}">${icon('cube')} See in 3D</button>` : ''}</div>
    </div>`).join('') : '<div class="empty">No steps.</div>'}
    ${d.tips.length ? `<h3 class="cat">Tips</h3>${d.tips.map(t => `<div class="card tipc">💡 ${esc(t)}</div>`).join('')}` : ''}
  </div>`;
  app.querySelectorAll('[data-step]').forEach(b => b.onclick = () => { viewer && (viewer.pendingStep = +b.dataset.step); tab = '3d'; renderResult(); });
}

function renderInfo() {
  const d = current.data, t = totals(current);
  $('#tabBody').innerHTML = `<div class="pad">
    <div class="card"><p class="lead">${esc(d.summary)}</p>
      <div class="facts">
        ${d.difficulty ? `<div><span class="muted small">Difficulty</span><b>${esc(d.difficulty)}</b></div>` : ''}
        ${d.time_estimate ? `<div><span class="muted small">Time</span><b>${esc(d.time_estimate)}</b></div>` : ''}
        ${d.dimensions ? `<div><span class="muted small">Size</span><b>${esc(d.dimensions)}</b></div>` : ''}
        <div><span class="muted small">Cost</span><b>${money(t.total)}</b></div>
        <div><span class="muted small">Items</span><b>${t.count}</b></div>
        <div><span class="muted small">3D parts</span><b>${d.model.parts.length}</b></div>
      </div>
    </div>
    <div class="card"><div class="muted small">You asked for</div><div>${esc(current.prompt)}</div>
    <div class="muted small" style="margin-top:8px">Made by</div><div class="mono small">${esc(d.generatedBy || '')}</div>
    <div class="muted small" style="margin-top:8px">Created</div><div>${new Date(current.created).toLocaleString()}</div></div>
    <div class="row gap wrap">
      <button class="btn small ghost" id="iRegen">${icon('spark')} Regenerate</button>
      <button class="btn small ghost" id="iGlb">${icon('cube')} Export 3D (.glb)</button>
    </div>
  </div>`;
  $('#iRegen').onclick = regenerate;
  $('#iGlb').onclick = exportGlb;
}

async function regenerate() {
  if (!settings.apiKey.trim()) { toast('Add your OpenRouter key first'); go('settings'); return; }
  const data = await withLoading(signal => generate(settings, { prompt: current.prompt === 'demo' ? current.data.title : current.prompt, mode: current.data.type }, setLoadingStatus, signal));
  if (!data) return;
  applyNewData(data);
}

async function doTweak() {
  const ins = $('#tweakIn').value.trim();
  if (!ins) { $('#tweakIn').focus(); return; }
  if (!settings.apiKey.trim()) { toast('Add your OpenRouter key first'); go('settings'); return; }
  const slim = JSON.parse(JSON.stringify(current.data));
  delete slim.generatedBy;
  slim.model.parts.forEach(p => { p.size = p.size.map(r4); p.pos = p.pos.map(r4); p.rot = p.rot.map(v => Math.round(v)); });
  const data = await withLoading(signal => tweak(settings, slim, ins, setLoadingStatus, signal));
  if (!data) return;
  applyNewData(data);
  toast('Updated ✓');
}
const r4 = v => Math.round(v * 10000) / 10000;

function applyNewData(data) {
  current.data = data;
  if (current.id === 'demo') { current.id = 'b' + Date.now().toString(36); current.prompt = data.title; }
  if (!builds.includes(current)) builds.unshift(current);
  const ids = new Set(data.shopping_list.map(i => i.id));
  for (const k of Object.keys(current.checked)) if (!ids.has(k)) delete current.checked[k];
  saveBuilds();
  if (viewer) viewer.loadedFor = null;
  renderResult();
}

function persistCurrent() {
  if (current.id === 'demo') return;
  saveBuilds();
  const tt = $('.rt-title .muted'); if (tt) tt.textContent = `${current.data.type === 'item' ? '🛒 Item' : '🔨 Project'} · ${money(totals(current).total)}`;
}

async function exportGlb() {
  try {
    if (!viewer || viewer.loadedFor !== current) { toast('Open the 3D tab first'); return; }
    const buf = await viewer.exportGLB();
    const bytes = new Uint8Array(buf);
    let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    saveFile(`${slug(current.data.title)}.glb`, 'model/gltf-binary', btoa(bin));
  } catch (e) { showError('Export failed: ' + e.message); }
}
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'build';

function openMenu() {
  openSheet(`<div class="menu">
    <button data-a="share">${icon('share')} Share shopping list</button>
    <button data-a="pic">${icon('camera')} Save 3D picture</button>
    <button data-a="glb">${icon('cube')} Export 3D model (.glb)</button>
    <button data-a="regen">${icon('spark')} Regenerate from scratch</button>
    ${current.id !== 'demo' ? `<button data-a="del" class="danger">${icon('trash')} Delete build</button>` : ''}
  </div>`);
  document.querySelectorAll('.menu [data-a]').forEach(b => b.onclick = async () => {
    const a = b.dataset.a; closeSheet();
    if (a === 'share') share(listText());
    if (a === 'pic') { if (tab !== '3d') { tab = '3d'; renderResult(); } setTimeout(() => saveFile(`${slug(current.data.title)}.png`, 'image/png', viewer.snapshot().split(',')[1]), 300); }
    if (a === 'glb') { if (!viewer || viewer.loadedFor !== current) { tab = '3d'; renderResult(); } exportGlb(); }
    if (a === 'regen') regenerate();
    if (a === 'del') ask('Delete this build?', 'Delete', () => { builds = builds.filter(x => x !== current); saveBuilds(); go('home'); });
  });
}

// ---------- sheet ----------
function openSheet(html) {
  closeSheet();
  const bd = document.createElement('div');
  bd.className = 'sheet-backdrop';
  bd.innerHTML = `<div class="sheet">${html}</div>`;
  bd.onclick = e => { if (e.target === bd || e.target.closest('[data-close]')) closeSheet(); };
  document.body.appendChild(bd);
}
function ask(q, okLabel, fn) {
  openSheet(`<h3>${esc(q)}</h3><div class="row gap"><button class="btn danger-btn" id="askOk">${esc(okLabel)}</button><button class="btn ghost" data-close>Cancel</button></div>`);
  $('#askOk').onclick = () => { closeSheet(); fn(); };
}
function closeSheet() { document.querySelector('.sheet-backdrop')?.remove(); }

// ---------- settings ----------
function renderSettings() {
  const models = cachedModels;
  app.innerHTML = `
  <header class="top result-top">
    <button class="icon-btn" id="btnBack">${icon('back')}</button>
    <div class="rt-title"><div class="t">Settings</div></div><span></span>
  </header>
  <div class="pad">
    <div class="card form">
      <label>OpenRouter API key</label>
      <div class="row gap"><input id="sKey" type="password" placeholder="sk-or-v1-…" value="${esc(settings.apiKey)}" autocomplete="off" spellcheck="false">
      <button class="btn small ghost" id="sShow">${icon('eye')}</button></div>
      <div class="row gap"><button class="btn small" id="sTest">Test key</button><span class="muted small" id="sTestOut"></span></div>
      <p class="muted small">Get a free key at openrouter.ai → Keys. Free models cost nothing (about 50 requests a day). Your key is only stored on this phone.</p>
    </div>
    <div class="card form">
      <label>AI model</label>
      <select id="sModel">
        <option value="${FREE_ROUTER}">⭐ Auto — best free model (recommended)</option>
        ${models.map(m => `<option value="${esc(m.id)}" ${settings.model === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}
        ${settings.model !== FREE_ROUTER && !models.some(m => m.id === settings.model) ? `<option value="${esc(settings.model)}" selected>${esc(settings.model)}</option>` : ''}
      </select>
      <div class="row gap"><button class="btn small ghost" id="sRefresh">${icon('rotate')} Load free models</button><span class="muted small" id="sModelsOut">${models.length ? models.length + ' free models' : ''}</span></div>
      <label>Or type any model id</label>
      <input id="sCustom" placeholder="e.g. vendor/model-name:free" value="">
      <p class="muted small">If a model is busy, the app falls back to Auto automatically.</p>
    </div>
    <div class="card form">
      <label>Country (for prices &amp; products)</label>
      <input id="sCountry" value="${esc(settings.country)}">
      <div class="row gap">
        <div class="grow"><label>Currency</label><select id="sCur">${['AUD', 'USD', 'NZD', 'GBP', 'EUR', 'CAD', 'INR', 'ZAR', 'SGD', 'JPY'].map(c => `<option ${settings.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
        <div class="grow"><label>Units</label><select id="sUnits"><option value="metric" ${settings.units === 'metric' ? 'selected' : ''}>Metric</option><option value="imperial" ${settings.units === 'imperial' ? 'selected' : ''}>Imperial</option></select></div>
      </div>
      <label>Store for “Find it”</label>
      <select id="sStore">${Object.entries(STORES).map(([k, v]) => `<option value="${k}" ${settings.store === k ? 'selected' : ''}>${v.name}</option>`).join('')}</select>
    </div>
    <button class="btn primary wide" id="sSave">Save</button>
    <p class="muted small center">BuildCart 3D · v1.0 ${isAndroid() ? '· Android' : '· Web'}</p>
  </div>`;
  const collect = () => {
    settings.apiKey = $('#sKey').value.trim();
    settings.model = $('#sCustom').value.trim() || $('#sModel').value;
    settings.country = $('#sCountry').value.trim() || 'Australia';
    settings.currency = $('#sCur').value;
    settings.units = $('#sUnits').value;
    settings.store = $('#sStore').value;
  };
  $('#btnBack').onclick = () => { collect(); saveSettings(); go('home'); };
  $('#sShow').onclick = () => { const k = $('#sKey'); k.type = k.type === 'password' ? 'text' : 'password'; };
  $('#sTest').onclick = async () => {
    collect();
    const out = $('#sTestOut'); out.textContent = 'Checking…';
    try {
      const k = await testKey(settings);
      out.textContent = `✅ Key works${k.is_free_tier ? ' (free tier)' : ''}`;
      saveSettings();
    } catch (e) { out.textContent = '❌ ' + e.message; }
  };
  $('#sRefresh').onclick = async () => {
    collect();
    const out = $('#sModelsOut'); out.textContent = 'Loading…';
    try {
      cachedModels = await listFreeModels(settings);
      localStorage.setItem(LS_MODELS, JSON.stringify(cachedModels));
      saveSettings(); renderSettings();
      toast(`${cachedModels.length} free models found`);
    } catch (e) { out.textContent = '❌ ' + e.message; }
  };
  $('#sSave').onclick = () => { collect(); saveSettings(); toast('Saved'); go('home'); };
}

// ---------- icons ----------
function icon(n) {
  const p = {
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
    back: '<path d="M15 18l-6-6 6-6"/>', dots: '<circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>', cube: '<path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M12 22V12M21 7l-9 5-9-5"/>',
    rotate: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>', xray: '<rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="3 2"/><path d="M4 12h16M12 4v16"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>', camera: '<path d="M4 7h3l2-3h6l2 3h3v12H4z"/><circle cx="12" cy="13" r="3.5"/>',
    prev: '<path d="M15 18l-6-6 6-6"/>', next: '<path d="M9 18l6-6-6-6"/>', play: '<path d="M7 4l13 8-13 8z" fill="currentColor"/>', pause: '<path d="M7 4h4v16H7zM13 4h4v16h-4z" fill="currentColor"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5"/>', share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>', eye: '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>',
  }[n] || '';
  return `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
}
function logoSvg() {
  return `<svg viewBox="0 0 32 32" width="26" height="26"><path d="M16 2l12 7v14l-12 7-12-7V9z" fill="#ff9f43"/><path d="M16 16l12-7v14l-12 7z" fill="#e8742a"/><path d="M16 16L4 9v14l12 7z" fill="#ffb86b"/><path d="M10 12h12l-1.5 7h-9z" fill="none" stroke="#1b2133" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12.5" cy="22" r="1.3" fill="#1b2133"/><circle cx="19.5" cy="22" r="1.3" fill="#1b2133"/></svg>`;
}

// ---------- boot ----------
render();
window.__app = { get current() { return current; }, openBuild, settings, builds: () => builds, get viewer() { return viewer; } };
