import { Viewer } from './viewer.js';
import { generate, tweak, refineModel, fixBuild, ask, listFreeModels, testKey, usageToday, copiesOf, FREE_ROUTER } from './ai.js';
import { share, copy, openUrl, toast, saveFile, shareFile, vibrate, isAndroid, listen, keepAwake, readClipboard } from './bridge.js';
import { SAMPLE } from './sample.js';
import { icon, logoSvg } from './icons.js';

// ---------- state ----------
const LS_SETTINGS = 'bc3d_settings', LS_BUILDS = 'bc3d_builds', LS_MODELS = 'bc3d_models';
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const settings = Object.assign({
  apiKey: '', model: FREE_ROUTER, currency: 'AUD', country: 'Australia', units: 'metric', store: 'google', welcomed: false, hideGot: false,
}, load(LS_SETTINGS, {}));
let builds = load(LS_BUILDS, []);
let cachedModels = load(LS_MODELS, []);
const syncFallbacks = () => { settings.fallbacks = cachedModels.slice(0, 2).map(m => m.id); };
syncFallbacks();
const saveSettings = () => localStorage.setItem(LS_SETTINGS, JSON.stringify(settings));
const saveBuilds = () => { try { localStorage.setItem(LS_BUILDS, JSON.stringify(builds)); } catch (e) { toast('Storage full — delete some old builds'); } };

let view = 'home';
let homeTab = 'builds';
let homeImage = null;    // data URL of a photo to build from
let homeSearch = '';
let current = null;      // {id, created, prompt, data, checked, stepsDone, notes, chat, versions}
let tab = '3d';
let viewer = null;
let homeMode = 'auto';
let abortCtl = null;
let askCtl = null;
let playTimer = null;

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = v => {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: settings.currency, maximumFractionDigits: v >= 100 ? 0 : 2 }).format(v || 0); }
  catch { return `${settings.currency} ${(v || 0).toFixed(2)}`; }
};
const fmtLen = m => settings.units === 'imperial'
  ? (m * 39.37 >= 24 ? `${(m * 3.2808).toFixed(2)} ft` : `${(m * 39.37).toFixed(1)}″`)
  : (m < 1 ? `${Math.round(m * 1000)} mm` : `${m.toFixed(2)} m`);
const app = $('#app');
const ensureBuild = b => Object.assign(b, { checked: b.checked || {}, stepsDone: b.stepsDone || {}, notes: b.notes || '', chat: b.chat || [], versions: b.versions || [] });
builds.forEach(ensureBuild);

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
];
const IDEAS = [
  'Pallet coffee table', 'Wall-mounted bike rack', 'Cat tree with 3 levels', 'Compost bin with 2 bays', 'Workbench with shelf', 'Floating TV unit',
  'Dog kennel for a medium dog', 'Outdoor fire pit bench', 'Arcade cabinet with Raspberry Pi', 'Hanging herb garden', 'Kids sandpit with lid',
  'Surfboard wall rack', 'Shoe rack for 12 pairs', 'Standing desk frame', 'Beehive (Langstroth)', 'Mini greenhouse', 'Wooden toolbox',
  'LED infinity mirror', 'Smart plant watering system with ESP32', 'Bluetooth speaker box', 'Garden potting bench', 'Firewood rack',
  'Camping drawer system for a ute', 'Bookshelf ladder', 'Picnic table', 'Wooden planter box on legs', 'Rabbit hutch', 'Rain water tank stand',
  'Folding wall desk', 'Electric skateboard', 'Kayak storage rack', 'Bar cart', 'Outdoor shower', 'Chicken feeder', 'Pergola 3 × 3 m',
];
const SWATCHES = ['#c9a46a', '#8a5a3b', '#3d2b1f', '#f2f2f2', '#2b2b2b', '#9aa3ad', '#d64545', '#e8913a', '#f2c84b', '#4f9a3c', '#3a7bd5', '#7a4fd6', '#e86aa6', '#2fb3a6'];

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
  if (viewer?.measuring) { viewer.setMeasuring(false); renderResult(); return true; }
  if (view === 'result' && tab !== '3d') { tab = '3d'; renderResult(); return true; }
  if (view !== 'home') { go('home'); return true; }
  return false;
};

function render() {
  keepAwake(view === 'result' && tab === 'steps');
  if (view === 'home') renderHome();
  else if (view === 'settings') renderSettings();
  else if (view === 'result') renderResult();
}

// ---------- home ----------
function renderHome() {
  const hasKey = !!settings.apiKey.trim();
  const cart = cartItems();
  app.innerHTML = `
  <header class="top">
    <div class="brand"><span class="logo">${logoSvg()}</span><span>BuildCart <b>3D</b></span></div>
    <button class="icon-btn" id="btnSettings" aria-label="Settings">${icon('gear')}</button>
  </header>
  <section class="hero">
    <h1>What are you <span class="hl">building</span> or <span class="hl2">buying</span>?</h1>
    <p class="sub">Shopping list with prices + a 3D model you can spin, measure and build step by step.</p>
    ${hasKey ? '' : `<div class="banner"><div><b>Add your free OpenRouter key</b><br><span>Needed to make new builds. It stays on this phone.</span></div><button class="btn small" id="btnAddKey">Add key</button></div>`}
    <div class="card input-card">
      <div class="prompt-wrap">
        <textarea id="prompt" rows="2" placeholder="e.g. a chicken coop for 4 hens, or a cordless drill">${esc(sessionStorage.getItem('bc3d_draft') || '')}</textarea>
        <div class="prompt-tools">
          <button class="icon-btn subtle" id="btnMic" aria-label="Voice">${icon('mic')}</button>
          <button class="icon-btn subtle" id="btnPhoto" aria-label="Photo">${icon('camera')}</button>
          <button class="icon-btn subtle" id="btnDice" aria-label="Surprise me">${icon('dice')}</button>
        </div>
      </div>
      <input type="file" id="photoIn" accept="image/*" capture="environment" hidden>
      ${homeImage ? `<div class="photo-prev"><img src="${homeImage}" alt=""><div><b>Photo attached</b><div class="muted small">The AI will work out what it is. Add words above to guide it.</div></div><button class="icon-btn subtle" id="photoX">×</button></div>` : ''}
      <div class="seg" id="mode">
        ${['auto', 'item', 'project'].map(m => `<button data-m="${m}" class="${homeMode === m ? 'on' : ''}">${m === 'auto' ? '✨ Auto' : m === 'item' ? '🛒 Item' : '🔨 Project'}</button>`).join('')}
      </div>
      <details class="more">
        <summary>More options</summary>
        <label>Details (size, style, what you already have)</label>
        <textarea id="details" rows="2" placeholder="e.g. 1.8 m long, use pallets, I already own a drill"></textarea>
        <label>Budget (${esc(settings.currency)})</label>
        <input id="budget" type="number" inputmode="decimal" placeholder="optional">
        <label>Parts I already have</label>
        <textarea id="have" rows="2" placeholder="e.g. ESP32 DevKit, BME280 sensor, 2 m of 90×45 pine, box of 8g × 30 mm screws">${esc(localStorage.getItem('bc3d_have') || '')}</textarea>
        <label class="toggle" style="margin-top:6px"><input type="checkbox" id="onlyHave"><span>Only use the parts I have</span></label>
      </details>
      <button class="btn primary big" id="btnGo">${icon('spark')} Generate</button>
      ${hasKey ? `<div class="muted small center">${usageToday()} of ~50 free AI requests used today</div>` : ''}
    </div>
    <div class="chips">${EXAMPLES.map(([e, t]) => `<button class="chip" data-ex="${esc(t)}">${e} ${esc(t)}</button>`).join('')}</div>
  </section>
  <section class="list-section">
    <nav class="seg home-tabs">
      <button data-ht="builds" class="${homeTab === 'builds' ? 'on' : ''}">🧱 Builds ${builds.length ? `<span class="count">${builds.length}</span>` : ''}</button>
      <button data-ht="cart" class="${homeTab === 'cart' ? 'on' : ''}">🛒 Shopping ${cart.count ? `<span class="count">${cart.count}</span>` : ''}</button>
    </nav>
    <div id="homeBody"></div>
  </section>`;

  $('#btnSettings').onclick = () => go('settings');
  $('#btnAddKey')?.addEventListener('click', () => go('settings'));
  $('#prompt').oninput = e => sessionStorage.setItem('bc3d_draft', e.target.value);
  $('#mode').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    homeMode = b.dataset.m; vibrate();
    [...$('#mode').children].forEach(x => x.classList.toggle('on', x === b));
  };
  const setPrompt = t => { $('#prompt').value = t; sessionStorage.setItem('bc3d_draft', t); };
  $$('[data-ex]').forEach(b => b.onclick = () => { setPrompt(b.dataset.ex); $('#prompt').focus(); });
  $('#btnDice').onclick = () => { vibrate(); setPrompt(IDEAS[Math.floor(Math.random() * IDEAS.length)]); homeMode = 'project'; $$('#mode button').forEach(x => x.classList.toggle('on', x.dataset.m === 'project')); };
  $('#btnMic').onclick = async () => {
    $('#btnMic').classList.add('on');
    const t = await listen();
    $('#btnMic')?.classList.remove('on');
    if (t) { const p = $('#prompt'); setPrompt((p.value ? p.value.trim() + ' ' : '') + t); }
  };
  $('#btnPhoto').onclick = () => $('#photoIn').click();
  $('#photoIn').onchange = async e => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    try { homeImage = await resizeImage(f, 1024); renderHome(); }
    catch (err) { toast('Could not read that photo'); }
  };
  $('#photoX')?.addEventListener('click', () => { homeImage = null; renderHome(); });
  $('#btnGo').onclick = startGenerate;
  $$('[data-ht]').forEach(b => b.onclick = () => { homeTab = b.dataset.ht; vibrate(); renderHome(); });
  if (homeTab === 'builds') renderBuildList(); else renderCart();
  if (!settings.welcomed) showWelcome();
}

function renderBuildList() {
  const q = homeSearch.toLowerCase();
  const list = builds.filter(b => !q || b.data.title.toLowerCase().includes(q) || (b.prompt || '').toLowerCase().includes(q));
  $('#homeBody').innerHTML = `
    ${builds.length > 2 ? `<input id="search" class="search" placeholder="🔍 Search your builds" value="${esc(homeSearch)}">` : ''}
    <div id="buildCards">${list.length ? list.map(buildCard).join('') : `<div class="empty">${builds.length ? 'No matches.' : 'Nothing yet. Type something above!'}</div>`}</div>
    <button class="btn ghost wide" id="btnDemo">${icon('cube')} Open the demo build</button>`;
  $('#btnDemo').onclick = () => openBuild(ensureBuild({ id: 'demo', created: Date.now(), prompt: 'demo', data: JSON.parse(JSON.stringify(SAMPLE)) }));
  const s = $('#search');
  if (s) s.oninput = () => { homeSearch = s.value; const pos = s.selectionStart; renderBuildList(); const n = $('#search'); n.focus(); n.setSelectionRange(pos, pos); };
  $$('[data-open]').forEach(el => el.onclick = e => {
    if (e.target.closest('[data-del]')) return;
    const b = builds.find(x => x.id === el.dataset.open); if (b) openBuild(b);
  });
  $$('[data-del]').forEach(el => el.onclick = () => {
    const b = builds.find(x => x.id === el.dataset.del);
    if (b) askSheet(`Delete "${b.data.title}"?`, 'Delete', () => { builds = builds.filter(x => x !== b); saveBuilds(); renderHome(); });
  });
}

function cartItems() {
  const groups = [];
  let count = 0, total = 0;
  for (const b of builds) {
    const items = b.data.shopping_list.filter(i => !b.checked?.[i.id] && !i.optional);
    if (!items.length) continue;
    groups.push({ b, items });
    count += items.length;
    total += items.reduce((s, i) => s + i.price, 0);
  }
  return { groups, count, total };
}

function renderCart() {
  const c = cartItems();
  $('#homeBody').innerHTML = c.count ? `
    <div class="card totals"><div><div class="muted small">Still to buy across all builds</div><div class="big-num">${money(c.total)}</div></div>
    <div class="right"><div class="muted small">${c.count} items</div><button class="btn small" id="cartShare">${icon('share')} Share</button></div></div>
    ${c.groups.map(({ b, items }) => `
      <h3 class="cat"><span>${esc(b.data.title)}</span><span class="muted small">${money(items.reduce((s, i) => s + i.price, 0))}</span></h3>
      ${items.map(i => `<div class="card item">
        <label class="check"><input type="checkbox" data-cb="${b.id}" data-ci="${esc(i.id)}"><span></span></label>
        <div class="item-body"><div class="item-name">${esc(i.name)}</div><div class="muted small">${fmtQty(i)}${i.notes ? ' · ' + esc(i.notes) : ''}</div></div>
        <div class="price">${money(i.price)}</div></div>`).join('')}`).join('')}`
    : `<div class="empty">🎉 Nothing left to buy. Items you haven't ticked off in your builds show up here, all in one list.</div>`;
  $$('[data-cb]').forEach(cb => cb.onchange = () => {
    const b = builds.find(x => x.id === cb.dataset.cb);
    if (!b) return;
    b.checked[cb.dataset.ci] = true; vibrate(); saveBuilds();
    setTimeout(renderHome, 250);
  });
  $('#cartShare')?.addEventListener('click', () => {
    const lines = ['🛒 Shopping list', ''];
    c.groups.forEach(({ b, items }) => { lines.push(b.data.title.toUpperCase()); items.forEach(i => lines.push(`☐ ${i.name} — ${+i.qty.toFixed(2)} ${i.unit} (~${money(i.price)})`)); lines.push(''); });
    lines.push(`Total: ${money(c.total)}`, '', 'Made with BuildCart 3D');
    share(lines.join('\n'));
  });
}

function totals(b) {
  const list = b.data.shopping_list;
  const total = list.filter(i => !i.optional).reduce((s, i) => s + i.price, 0);
  const got = list.filter(i => b.checked[i.id] && !i.optional).reduce((s, i) => s + i.price, 0);
  const done = list.filter(i => b.checked[i.id]).length;
  return { total, got, done, count: list.length, optional: list.filter(i => i.optional).reduce((s, i) => s + i.price, 0) };
}

function buildCard(b) {
  const t = totals(b);
  const pct = t.count ? Math.round(t.done / t.count * 100) : 0;
  const sd = Object.values(b.stepsDone || {}).filter(Boolean).length;
  return `<div class="card build" data-open="${b.id}">
    <div class="build-icon ${b.data.type}">${b.data.type === 'item' ? '🛒' : '🔨'}</div>
    <div class="build-body">
      <div class="build-title">${esc(b.data.title)}</div>
      <div class="muted small">${t.count} items · ${money(t.total)} · ${pieceCount(b.data)} 3D pieces${b.data.type === 'project' && b.data.steps.length ? ` · built ${sd}/${b.data.steps.length}` : ''}</div>
      <div class="bar"><i style="width:${pct}%"></i></div>
    </div>
    <button class="icon-btn subtle" data-del="${b.id}" aria-label="Delete">${icon('trash')}</button>
  </div>`;
}

function resizeImage(file, max) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = reject;
    fr.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.82));
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

function showWelcome() {
  openSheet(`<div class="welcome">
    <div class="w-logo">${logoSvg(56)}</div>
    <h3>Welcome to BuildCart 3D</h3>
    <ol class="w-list">
      <li>🗣️ Type, say or photograph something you want to <b>buy</b> or <b>build</b>.</li>
      <li>🛒 Get a priced shopping list you can tick off at the shop.</li>
      <li>🧊 Spin the 3D model, tap parts, measure it and watch it build step by step.</li>
    </ol>
    <p class="muted small">You need a free OpenRouter key for the AI. Get one at openrouter.ai → Keys, copy it, then paste it here.</p>
    <div class="row gap"><input id="wKey" type="password" placeholder="sk-or-v1-…" autocomplete="off"><button class="btn small ghost" id="wPaste">${icon('paste')}</button></div>
    <div class="row gap wrap" style="margin-top:10px">
      <button class="btn primary" id="wSave">Save key</button>
      <button class="btn ghost" id="wGet">Get a free key</button>
      <button class="btn ghost" id="wSkip">Try the demo</button>
    </div></div>`, () => { settings.welcomed = true; saveSettings(); });
  $('#wPaste').onclick = async () => { $('#wKey').value = (await readClipboard()).trim(); };
  $('#wGet').onclick = () => openUrl('https://openrouter.ai/keys');
  $('#wSave').onclick = () => {
    const k = $('#wKey').value.trim();
    if (!k) { toast('Paste your key first'); return; }
    settings.apiKey = k; settings.welcomed = true; saveSettings(); closeSheet(); toast('Key saved ✓'); renderHome();
  };
  $('#wSkip').onclick = () => { settings.welcomed = true; saveSettings(); closeSheet(); $('#btnDemo')?.click(); };
}

// ---------- generate ----------
async function startGenerate() {
  const prompt = $('#prompt').value.trim();
  if (!prompt && !homeImage) { toast('Type, say or snap something first'); $('#prompt').focus(); return; }
  if (!settings.apiKey.trim()) { toast('Add your OpenRouter key first'); go('settings'); return; }
  const details = $('#details')?.value.trim(), budget = $('#budget')?.value.trim();
  const have = $('#have')?.value.trim(), onlyHave = $('#onlyHave')?.checked;
  localStorage.setItem('bc3d_have', have || '');
  const image = homeImage;
  const data = await withLoading(signal => generate(settings, { prompt, mode: homeMode, details, budget, image, have, onlyHave }, setLoadingStatus, signal));
  if (!data) return;
  sessionStorage.removeItem('bc3d_draft');
  homeImage = null;
  const b = ensureBuild({ id: 'b' + Date.now().toString(36), created: Date.now(), prompt: prompt || '📷 photo', data });
  data.shopping_list.forEach(i => { if (i.have) b.checked[i.id] = true; });
  builds.unshift(b); saveBuilds();
  openBuild(b);
}

const LOADING_TIPS = [
  'Free models can take 20–90 seconds. Hang tight!',
  'Tip: tap any part in 3D to see what to buy for it — and recolour it.',
  'Tip: use the ruler in 3D to measure between any two points.',
  'Tip: “Change it” lets you resize or restyle with AI — and Undo it.',
  'Tip: the Shopping tab on the home screen merges every build’s list.',
  'Tip: the Ask tab answers questions about your build.',
  'Tip: export STL from Info to 3D print your model.',
  'Tip: back up your builds in Settings so you never lose them.',
];

async function withLoading(fn) {
  abortCtl = new AbortController();
  const ov = document.createElement('div');
  ov.className = 'loading';
  ov.innerHTML = `<div class="loader-card">
    <div class="cube-spin"><div></div><div></div><div></div><div></div><div></div><div></div></div>
    <div class="status" id="ldStatus">Starting…</div>
    <div class="progress-line" id="ldProg"></div>
    <div class="muted small" id="ldTime">0s</div>
    <div class="tip" id="ldTip">${LOADING_TIPS[0]}</div>
    <button class="btn ghost" id="ldCancel">Cancel</button></div>`;
  document.body.appendChild(ov);
  keepAwake(true);
  const t0 = Date.now();
  let tipI = 0;
  const timer = setInterval(() => {
    const s = Math.round((Date.now() - t0) / 1000);
    $('#ldTime').textContent = `${s}s`;
    if (s && s % 7 === 0) { tipI = (tipI + 1) % LOADING_TIPS.length; $('#ldTip').textContent = LOADING_TIPS[tipI]; }
  }, 1000);
  $('#ldCancel').onclick = () => abortCtl?.abort();
  try {
    return await fn(abortCtl.signal);
  } catch (e) {
    if (e.message !== 'Cancelled') showError(e.message);
    return null;
  } finally {
    clearInterval(timer); ov.remove(); abortCtl = null;
    keepAwake(view === 'result' && tab === 'steps');
  }
}
function setLoadingStatus(t, prog) {
  const el = $('#ldStatus'); if (el && t) el.textContent = t;
  const p = $('#ldProg'); if (p && prog !== undefined) p.textContent = prog;
}

function showError(msg) {
  const imgHint = /image|vision|modalit/i.test(msg) ? '<p class="muted small">This model may not understand photos. In Settings, load the free models and pick one with “VL” or “vision” in its name.</p>' : '';
  openSheet(`<h3>Something went wrong</h3><p>${esc(msg)}</p>${imgHint}
    <div class="row gap"><button class="btn" data-close>OK</button><button class="btn ghost" id="errSettings">Settings</button></div>`);
  $('#errSettings').onclick = () => { closeSheet(); go('settings'); };
}

// ---------- result ----------
function openBuild(b) { current = ensureBuild(b); tab = '3d'; go('result'); }

function renderResult() {
  const d = current.data;
  keepAwake(tab === 'steps');
  app.innerHTML = `
  <header class="top result-top">
    <button class="icon-btn" id="btnBack" aria-label="Back">${icon('back')}</button>
    <div class="rt-title"><div class="t">${esc(d.title)}</div><div class="muted small" id="rtSub">${subLine()}</div></div>
    <button class="icon-btn" id="btnMenu" aria-label="Menu">${icon('dots')}</button>
  </header>
  <nav class="tabs">
    ${[['3d', '3D'], ['list', 'List'], ['steps', d.type === 'item' ? 'Setup' : 'Steps'], ['ask', 'Ask'], ['info', 'Info']].map(([k, l]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}
  </nav>
  <div class="tab-body" id="tabBody"></div>
  <div class="tweak-bar">
    ${tab === 'ask'
      ? `<input id="askIn" placeholder="💬 Ask anything about this build…"><button class="btn primary small" id="askGo">${icon('send')}</button>`
      : `<button class="icon-btn subtle" id="tweakMic">${icon('mic')}</button><input id="tweakIn" placeholder="✏️ Change it… e.g. make it 1.8 m long"><button class="btn primary small" id="tweakGo">${icon('spark')}</button>`}
  </div>`;
  $('#btnBack').onclick = () => go('home');
  $('#btnMenu').onclick = openMenu;
  $$('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; vibrate(); stopPlay(); renderResult(); });
  if (tab === 'ask') {
    $('#askGo').onclick = () => doAsk($('#askIn').value);
    $('#askIn').onkeydown = e => { if (e.key === 'Enter') doAsk($('#askIn').value); };
  } else {
    $('#tweakGo').onclick = doTweak;
    $('#tweakIn').onkeydown = e => { if (e.key === 'Enter') doTweak(); };
    $('#tweakMic').onclick = async () => { const t = await listen('Say what to change'); if (t) $('#tweakIn').value = t; };
  }
  if (tab !== '3d') viewer?.stop();
  if (tab === '3d') render3D();
  if (tab === 'list') renderList();
  if (tab === 'steps') renderSteps();
  if (tab === 'ask') renderAsk();
  if (tab === 'info') renderInfo();
}

function subLine() {
  const d = current.data;
  return `${d.type === 'item' ? '🛒 Item' : '🔨 Project'} · ${money(totals(current).total)}`;
}

// ----- 3D tab -----
function render3D() {
  const d = current.data;
  const body = $('#tabBody');
  const hasSteps = d.type === 'project' && d.steps.length > 1;
  body.innerHTML = `
  <div class="stage ${hasSteps ? 'with-steps' : ''}" id="stage">
    <div class="hud tl"><span id="dims"></span></div>
    <div class="hud tr col">
      <button class="fab" id="tRotate" title="Auto rotate">${icon('rotate')}</button>
      <button class="fab" id="tViews" title="Views">${icon('eye')}</button>
      <button class="fab" id="tParts" title="Parts">${icon('layers')}</button>
      <button class="fab" id="tMeasure" title="Measure">${icon('ruler')}</button>
      <button class="fab" id="tXray" title="X-ray">${icon('xray')}</button>
      <button class="fab" id="tPic" title="Picture">${icon('camera')}</button>
    </div>
    ${current.versions.length ? `<button class="hud bl undo-pill" id="tUndo">${icon('undo')} Undo change</button>` : ''}
    <div class="hud measure-hint hidden" id="mHint">📏 Tap two points on the model</div>
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
      ${hasSteps ? `<label class="toggle"><input type="checkbox" id="ghost" checked><span>Ghost</span></label>
      <label class="toggle"><input type="checkbox" id="follow" ${viewer?.follow !== false ? 'checked' : ''}><span>Follow</span></label>` : ''}
    </div>
  </div>`;
  if (!viewer) {
    viewer = new Viewer(document.createElement('div'), { onSelect: showPart, onMeasure: d2 => { const h = $('#mHint'); if (h) h.textContent = d2 == null ? '📏 Tap a second point' : `📏 ${fmtLen(d2)} — tap again to re-measure`; } });
  }
  viewer.formatLen = fmtLen;
  if (settings.outlines === false) viewer.outlines = false;
  $('#stage').prepend(viewer.container);
  viewer.container.className = 'canvas-wrap';
  viewer.start();
  if (viewer.loadedFor !== current || viewer.loadedVersion !== current.data) {
    viewer.load(d.model); viewer.loadedFor = current; viewer.loadedVersion = current.data; viewer.setAutoRotate(true);
  } else { viewer.resize(); viewer.select(-1); }
  viewer.setMeasuring(false);
  viewer.setExplode(0);
  if (!d.model.parts.length || d.modelError) {
    $('#stage').insertAdjacentHTML('beforeend', `<div class="hud center no-model"><div>${d.model.parts.length ? '⚠️ The detailed 3D pass didn\'t finish, so this is the older model.' : '🧊 Your parts list is ready, but the 3D model didn\'t finish.'}<br><span class="muted small">${esc(d.modelError || '')}</span></div><button class="btn primary" id="build3d">${icon('cube')} Build the 3D model</button></div>`);
    $('#build3d').onclick = doRefine;
  }
  $('#dims').textContent = viewer.dimensionsText(settings.units);
  $('#tRotate').classList.toggle('on', viewer.controls.autoRotate);
  $('#tXray').classList.toggle('on', viewer.blueprint);
  $('#tRotate').onclick = e => { viewer.setAutoRotate(!viewer.controls.autoRotate); e.currentTarget.classList.toggle('on', viewer.controls.autoRotate); };
  $('#tXray').onclick = e => { viewer.setBlueprint(!viewer.blueprint); e.currentTarget.classList.toggle('on', viewer.blueprint); viewer.setStep(viewer.step, false); };
  $('#tViews').onclick = () => {
    openSheet(`<h3>Camera view</h3><div class="view-grid">
      ${[['iso', '🧊', '3D'], ['front', '⬜', 'Front'], ['right', '▶️', 'Side'], ['top', '⬇️', 'Top'], ['back', '🔙', 'Back'], ['left', '◀️', 'Other side']].map(([k, e, l]) => `<button class="btn ghost" data-view="${k}">${e} ${l}</button>`).join('')}
      </div>
      <label class="toggle" style="margin-top:14px"><input type="checkbox" id="vOutlines" ${viewer.outlines ? 'checked' : ''}><span>Show outlines on edges</span></label>`);
    $$('[data-view]').forEach(b => b.onclick = () => { closeSheet(); viewer.setView(b.dataset.view); $('#tRotate').classList.remove('on'); });
    $('#vOutlines').onchange = e => { viewer.setOutlines(e.target.checked); settings.outlines = e.target.checked; saveSettings(); };
  };
  $('#tParts').onclick = openPartsDrawer;
  $('#tMeasure').onclick = e => {
    const on = !viewer.measuring;
    viewer.setMeasuring(on);
    e.currentTarget.classList.toggle('on', on);
    $('#mHint').classList.toggle('hidden', !on);
    $('#mHint').textContent = '📏 Tap two points on the model';
    $('#partCard').classList.add('hidden');
    $('#tRotate').classList.remove('on');
  };
  $('#tPic').onclick = () => {
    openSheet(`<div class="menu">
      <button data-p="share">${icon('share')} Share picture</button>
      <button data-p="save">${icon('download')} Save picture to phone</button></div>`);
    $$('[data-p]').forEach(b => b.onclick = () => {
      closeSheet();
      const b64 = viewer.snapshot().split(',')[1];
      if (b.dataset.p === 'share') shareFile(`${slug(d.title)}.png`, 'image/png', b64, `${d.title} — made with BuildCart 3D`);
      else saveFile(`${slug(d.title)}.png`, 'image/png', b64);
    });
  };
  $('#tUndo')?.addEventListener('click', undo);
  $('#explode').oninput = e => viewer.setExplode(e.target.value / 100);
  if (hasSteps) {
    const total = d.steps.length;
    const range = $('#stepRange');
    const show = (n, anim = true) => {
      n = Math.max(1, Math.min(total + 1, n));
      range.value = n;
      viewer.setStep(n > total ? Infinity : n, anim);
      if (n > total) { if (anim && viewer.follow) viewer.setView('iso'); }
      else if (anim) viewer.focusStep(n);
      const done = n <= total && current.stepsDone[n - 1];
      $('#stepLabel').innerHTML = n > total ? `<b>Finished build</b> <span class="muted">· all ${total} steps</span>` : `<b>${done ? '✅ ' : ''}Step ${n}/${total}:</b> ${esc(d.steps[n - 1].title)}`;
    };
    range.oninput = () => { stopPlay(); show(+range.value); };
    range.onchange = range.oninput;
    $('#ghost').onchange = e => viewer.setGhosts(e.target.checked);
    $('#follow').onchange = e => { viewer.follow = e.target.checked; if (!viewer.follow) viewer.setView('iso'); };
    viewer.setGhosts(true);
    $('#sPrev').onclick = () => { stopPlay(); show(+range.value - 1); vibrate(); };
    $('#sNext').onclick = () => { stopPlay(); show(+range.value + 1); vibrate(); };
    $('#sPlay').onclick = () => {
      if (playTimer) { stopPlay(); return; }
      keepAwake(true);
      let n = 1; show(n);
      $('#sPlay').innerHTML = icon('pause');
      playTimer = setInterval(() => { n++; show(n); if (n > total) stopPlay(); }, 2200);
    };
    const ps = viewer.pendingStep; viewer.pendingStep = null;
    show(ps || total + 1, !!ps);
  }
}

function stopPlay() {
  if (playTimer) { clearInterval(playTimer); playTimer = null; keepAwake(view === 'result' && tab === 'steps'); }
  const b = $('#sPlay'); if (b) b.innerHTML = icon('play');
}

function showPart(i) {
  const card = $('#partCard'); if (!card) return;
  if (i < 0) { card.classList.add('hidden'); return; }
  vibrate(8);
  const d = current.data, p = d.model.parts[i];
  const it = d.shopping_list.find(x => x.id === p.item);
  card.classList.remove('hidden');
  card.innerHTML = `<button class="x" id="pcX">×</button>
    <div class="pc-name">${esc(p.name)}</div>
    <div class="muted small">${p.material} · ${fmtSize(p.size)}${d.type === 'project' && d.steps[p.step - 1] ? ` · step ${p.step}` : ''}</div>
    <div class="swatches">${SWATCHES.map(c => `<button style="background:${c}" data-sw="${c}" class="${p.color.toLowerCase() === c ? 'on' : ''}"></button>`).join('')}</div>
    <div class="row gap"><button class="btn small ghost" id="pcIso">${viewer.isolated === i ? 'Show all' : '🔍 Isolate'}</button>
    <button class="btn small ghost" id="pcSame">🎨 Same colour for all “${esc(shortName(p.name))}”</button></div>
    ${it ? `<div class="pc-item">
      <label class="check"><input type="checkbox" ${current.checked[it.id] ? 'checked' : ''} data-chk="${it.id}"><span></span></label>
      <div><div>${esc(it.name)}</div><div class="muted small">${fmtQty(it)} · ${money(it.price)}</div></div>
      <button class="btn small ghost" data-shop="${esc(it.name)}">${icon('search')}</button>
    </div>` : ''}`;
  $('#pcX').onclick = () => { viewer.select(-1); if (viewer.isolated >= 0) viewer.isolate(-1); card.classList.add('hidden'); };
  $$('[data-sw]', card).forEach(b => b.onclick = () => {
    viewer.recolor(i, b.dataset.sw); persistCurrent();
    $$('[data-sw]', card).forEach(x => x.classList.toggle('on', x === b)); vibrate(6);
  });
  $('#pcSame').onclick = () => {
    const name = shortName(p.name);
    d.model.parts.forEach((q, j) => { if (shortName(q.name) === name) viewer.recolor(j, p.color); });
    persistCurrent(); toast('Colour applied');
  };
  $('#pcIso').onclick = () => { viewer.isolate(viewer.isolated === i ? -1 : i); showPart(i); };
  card.querySelector('[data-chk]')?.addEventListener('change', e => { current.checked[e.target.dataset.chk] = e.target.checked; persistCurrent(); });
  card.querySelector('[data-shop]')?.addEventListener('click', e => searchStore(e.currentTarget.dataset.shop));
}
const shortName = n => String(n).replace(/\s*\d+$/, '').replace(/\s*\((left|right|front|back|top|bottom)\)$/i, '').trim().toLowerCase();

function openPartsDrawer() {
  const d = current.data;
  const groups = {};
  d.model.parts.forEach((p, i) => (groups[shortName(p.name)] ||= []).push(i));
  openSheet(`<h3>Parts <span class="muted small">${pieceCount(d)} pieces</span></h3>
    <div class="parts-list">${Object.values(groups).map(idx => {
      const p = d.model.parts[idx[0]];
      return `<button class="part-row" data-pi="${idx[0]}" data-all="${idx.join(',')}">
        <span class="dot" style="background:${p.color}"></span>
        <span class="grow">${esc(p.name)}${(() => { const c = idx.reduce((n, j) => n + copiesOf(d.model.parts[j]), 0); return c > 1 ? ` <span class="muted">× ${c}</span>` : ''; })()}</span>
        <span class="muted small">${fmtSize(p.size)}</span></button>`;
    }).join('')}</div>`);
  $$('[data-pi]').forEach(b => b.onclick = () => {
    closeSheet();
    const i = +b.dataset.pi;
    if (Number.isFinite(viewer.step)) { viewer.setStep(Infinity, false); const r = $('#stepRange'); if (r) { r.value = r.max; r.oninput(); } }
    viewer.select(i); viewer.focusParts(b.dataset.all.split(',').map(Number)); showPart(i);
  });
}

function fmtSize(s) {
  if (settings.units === 'imperial') return s.map(v => (v * 39.37).toFixed(1) + '″').join(' × ');
  return s.map(v => Math.round(v * 1000)).join(' × ') + ' mm';
}
const fmtQty = it => `${+(+it.qty).toFixed(2)} ${esc(it.unit || '')}`.trim();

// ----- List tab -----
function renderList() {
  const d = current.data;
  const t = totals(current);
  const cats = {};
  d.shopping_list.forEach(i => (cats[i.category] ||= []).push(i));
  const catTotals = Object.entries(cats).map(([c, items]) => [c, items.reduce((s, i) => s + i.price, 0)]).sort((a, b) => b[1] - a[1]);
  const maxCat = Math.max(1, ...catTotals.map(x => x[1]));
  const pct = t.count ? Math.round(t.done / t.count * 100) : 0;
  const cut = cutList(d);
  $('#tabBody').innerHTML = `
  <div class="pad">
    <div class="card totals">
      <div><div class="muted small">Estimated total</div><div class="big-num">${money(t.total)}</div>${t.optional ? `<div class="muted small">+ ${money(t.optional)} optional</div>` : ''}</div>
      <div class="right"><div class="muted small">${t.done}/${t.count} got</div><div class="num">${money(Math.max(t.total - t.got, 0))} left</div></div>
      <div class="bar wide"><i style="width:${pct}%"></i></div>
      ${catTotals.length > 1 ? `<div class="breakdown wide">${catTotals.map(([c, v]) => `<div class="bd-row"><span>${esc(c)}</span><div class="bd-bar"><i style="width:${Math.max(3, v / maxCat * 100)}%"></i></div><span class="bd-v">${money(v)}</span></div>`).join('')}</div>` : ''}
    </div>
    ${checkCard(d)}
    <div class="row gap wrap">
      <button class="btn small" id="shareList">${icon('share')} Share</button>
      <button class="btn small ghost" id="copyList">${icon('copy')}</button>
      <button class="btn small ghost" id="addItem">${icon('plus')} Add</button>
      <button class="btn small ghost ${settings.hideGot ? 'on' : ''}" id="hideGot">${settings.hideGot ? '👁 Show got' : '🙈 Hide got'}</button>
      <select id="storeSel" class="small-select">${Object.entries(STORES).map(([k, v]) => `<option value="${k}" ${settings.store === k ? 'selected' : ''}>🔎 ${v.name}</option>`).join('')}</select>
    </div>
    ${Object.entries(cats).map(([c, items]) => {
      const shown = items.filter(i => !settings.hideGot || !current.checked[i.id]);
      if (!shown.length) return '';
      return `<h3 class="cat"><span>${esc(c)}</span><span class="muted small">${money(items.reduce((s, i) => s + i.price, 0))}</span></h3>
      ${shown.map(i => `
      <div class="card item ${current.checked[i.id] ? 'done' : ''}">
        <label class="check"><input type="checkbox" ${current.checked[i.id] ? 'checked' : ''} data-chk="${esc(i.id)}"><span></span></label>
        <div class="item-body" data-item="${esc(i.id)}">
          <div class="item-name">${esc(i.name)} ${i.optional ? '<span class="pill">optional</span>' : ''}${i.have ? '<span class="pill good">you have</span>' : ''}${i.addedBy3D ? '<span class="pill warn">added by 3D check</span>' : ''}</div>
          <div class="muted small">${fmtQty(i)}${i.notes ? ' · ' + esc(i.notes) : ''}</div>
        </div>
        <div class="price">${money(i.price)}</div>
      </div>`).join('')}`;
    }).join('')}
    ${settings.hideGot && t.done ? `<p class="muted small center">${t.done} item${t.done > 1 ? 's' : ''} hidden (already got)</p>` : ''}
    ${cut.rows.length ? `
      <h3 class="cat"><span>🪚 Cut list</span><span class="muted small">${cut.rows.reduce((s, r) => s + r.n, 0)} pieces</span></h3>
      <div class="card cut">
        <div class="cut-row head"><span>Qty</span><span>Length × width × thick</span><span>Part</span></div>
        ${cut.rows.map(r => `<div class="cut-row"><span><b>${r.n}×</b></span><span>${r.dims}</span><span class="muted">${esc(r.names)}</span></div>`).join('')}
        ${cut.stock.length ? `<div class="cut-stock">${cut.stock.map(s => `<div>📏 ${s}</div>`).join('')}</div>` : ''}
        <div class="muted small">From the 3D model — check sizes against your timber before cutting.</div>
      </div>` : ''}
    ${d.tools.length ? `<h3 class="cat">Tools you'll need</h3><div class="chips static">${d.tools.map(x => `<span class="chip">🔧 ${esc(x)}</span>`).join('')}</div>` : ''}
    <p class="muted small center">Prices are AI estimates — tap an item to edit it or find it in store.</p>
  </div>`;
  $$('[data-chk]').forEach(c => c.onchange = e => {
    current.checked[c.dataset.chk] = e.target.checked; vibrate(); persistCurrent();
    const scroll = window.scrollY; setTimeout(() => { renderList(); window.scrollTo(0, scroll); }, settings.hideGot ? 250 : 0);
  });
  $$('[data-item]').forEach(el => el.onclick = () => itemSheet(el.dataset.item));
  $('#addItem').onclick = () => itemSheet(null);
  $('#fixBuild')?.addEventListener('click', async () => {
    if (!settings.apiKey.trim()) { toast('Add your OpenRouter key first'); go('settings'); return; }
    const probs = buildCheck(d).problems.map(x => x.text);
    const data = await withLoading(signal => fixBuild(settings, slimData(), probs, setLoadingStatus, signal));
    if (data) { applyNewData(data, 'Before fixing the parts list'); tab = 'list'; renderResult(); toast('Parts list fixed ✓'); }
  });
  $('#checkMore')?.addEventListener('click', e => { $('#checkList').classList.toggle('hidden'); e.currentTarget.remove(); });
  $('#hideGot').onclick = () => { settings.hideGot = !settings.hideGot; saveSettings(); renderList(); };
  $('#shareList').onclick = () => share(listText());
  $('#copyList').onclick = () => { copy(listText()); toast('List copied'); };
  $('#storeSel').onchange = e => { settings.store = e.target.value; saveSettings(); };
}

function pieceCount(d) { return d.model.parts.reduce((n, p) => n + copiesOf(p), 0); }

// Does the shopping list exactly cover what's in the 3D model?
function buildCheck(d) {
  const problems = [];
  const parts = d.model.parts;
  if (!parts.length) return { problems, ok: [], noModel: true };
  const byItem = new Map();
  const orphan = new Map();
  for (const p of parts) {
    const c = copiesOf(p);
    if (p.item) { const a = byItem.get(p.item) || []; a.push(p); byItem.set(p.item, a); }
    else if (Math.max(...p.size) > 0.01) orphan.set(shortName(p.name), (orphan.get(shortName(p.name)) || 0) + c);
  }
  if (orphan.size) {
    const names = [...orphan.entries()].slice(0, 6).map(([n, c]) => `${c > 1 ? c + ' × ' : ''}${n}`);
    problems.push({ text: `These parts in the 3D model aren't on the shopping list: ${names.join(', ')}`, short: `${orphan.size} part type${orphan.size > 1 ? 's' : ''} in 3D not on the list` });
  }
  for (const it of d.shopping_list) {
    if (it.optional) continue;
    if (!(it.qty > 0)) { problems.push({ text: `${it.name} has a quantity of 0`, short: `${it.name}: quantity 0` }); continue; }
    const ps = byItem.get(it.id);
    if (!ps) continue;
    const unit = (it.unit || '').toLowerCase().trim();
    const n = ps.reduce((s, p) => s + copiesOf(p), 0);
    const len = stockLength(it);
    const lengthy = /length|board|sheet|^m$|metre|meter|roll|^lm$/.test(unit) || /timber|lumber|wood/i.test(it.category);
    if (len && lengthy) {
      // total cut length needed vs stock bought
      const need = ps.reduce((s, p) => s + Math.max(...p.size) * copiesOf(p), 0);
      const have = /^(m|metres?|meters?|lm|linear m)$/.test(unit) ? it.qty : it.qty * len;
      if (need > have * 1.02) {
        problems.push({ text: `${it.name}: the 3D model needs about ${need.toFixed(2)} m of cuts but the list only buys ${have.toFixed(2)} m`, short: `${shortItem(it.name)}: need ${need.toFixed(1)} m, buying ${have.toFixed(1)} m` });
      }
    } else if (/^(pcs?|pieces?|each|ea|x|units?|qty|)$/.test(unit) && n > it.qty + 0.01 && !/screw|nail|bolt|nut|washer|pin|rivet|staple/i.test(it.name)) {
      problems.push({ text: `The 3D model uses ${n} × ${it.name} but the list only has ${it.qty}`, short: `${shortItem(it.name)}: 3D uses ${n}, list has ${it.qty}` });
    }
  }
  const linked = parts.filter(p => p.item).reduce((s, p) => s + copiesOf(p), 0);
  return { problems, linked, total: pieceCount(d) };
}
const shortItem = n => n.length > 34 ? n.slice(0, 32) + '…' : n;
function stockLength(it) {
  if (Array.isArray(it.dims) && it.dims[0] > 200) return it.dims[0] / 1000;
  let best = 0;
  for (const m of it.name.matchAll(/(\d+(?:\.\d+)?)\s*(mm|m)\b/gi)) {
    const v = parseFloat(m[1]) * (m[2].toLowerCase() === 'mm' ? 0.001 : 1);
    if (v >= 0.2 && v <= 12) best = Math.max(best, v);
  }
  return best;
}

function checkCard(d) {
  const c = buildCheck(d);
  if (c.noModel) return '';
  if (!c.problems.length) return `<div class="card build-check ok">✅ <div><b>Buildable with exactly this list</b><div class="muted small">${c.linked} of ${c.total} 3D pieces come straight from these items, and the quantities cover them.</div></div></div>`;
  return `<div class="card build-check warn">⚠️ <div class="grow"><b>${c.problems.length} thing${c.problems.length > 1 ? 's' : ''} to fix before you shop</b>
    <ul id="checkList" class="${c.problems.length > 2 ? 'hidden' : ''}">${c.problems.map(p => `<li>${esc(p.short)}</li>`).join('')}</ul>
    ${c.problems.length > 2 ? `<button class="linkish" id="checkMore">Show details</button>` : ''}
    <button class="btn small primary" id="fixBuild" style="margin-top:8px">${icon('spark')} Fix the list with AI</button></div></div>`;
}

function cutList(d) {
  if (d.type !== 'project') return { rows: [], stock: [] };
  const map = new Map();
  const stock = new Map();
  for (const p of d.model.parts) {
    if (!(p.shape === 'box' || p.shape === 'roundbox')) continue;
    if (!(p.material === 'wood' || /board|plank|panel|ply|mdf|timber|batten|rail|slat|post|leg|shelf/i.test(p.name))) continue;
    const s = p.size.map(v => Math.round(v * 1000)).sort((a, b) => b - a);
    if (s[0] < 30) continue;
    const key = s.join('×');
    const c = copiesOf(p);
    const r = map.get(key) || { n: 0, l: s[0], w: s[1], t: s[2], names: new Set() };
    r.n += c; r.names.add(p.name.replace(/\s*\d+$/, ''));
    map.set(key, r);
    if (s[1] <= 300) { const k = `${s[1]} × ${s[2]} mm`; stock.set(k, (stock.get(k) || 0) + s[0] * c); }
    else { const k = `sheet ${s[2]} mm`; stock.set(k, (stock.get(k) || 0) + s[0] * s[1] * c); }
  }
  const rows = [...map.values()].sort((a, b) => b.l - a.l).map(r => ({
    n: r.n, dims: settings.units === 'imperial' ? [r.l, r.w, r.t].map(v => (v / 25.4).toFixed(1) + '″').join(' × ') : `${r.l} × ${r.w} × ${r.t}`, names: [...r.names].slice(0, 2).join(', '),
  }));
  const st = [...stock.entries()].map(([k, v]) => k.startsWith('sheet') ? `${(v / 1e6).toFixed(2)} m² of ${k}` : `${(v / 1000).toFixed(2)} m total of ${k} (+10% for waste: ${(v * 1.1 / 1000).toFixed(1)} m)`);
  return { rows, stock: st };
}

function itemSheet(id) {
  const d = current.data;
  const it = id ? d.shopping_list.find(x => x.id === id) : { id: '', name: '', qty: 1, unit: 'pcs', price: 0, category: 'Other', notes: '', optional: false };
  if (!it) return;
  const cats = [...new Set(d.shopping_list.map(i => i.category))];
  const hasParts = id && d.model.parts.some(p => p.item === id);
  openSheet(`<h3>${id ? 'Edit item' : 'Add item'}</h3>
    <div class="form">
      <label>Name</label><input id="eName" value="${esc(it.name)}" placeholder="e.g. Wood glue 250 ml">
      <div class="row gap">
        <div class="grow"><label>Qty</label><input id="eQty" type="number" inputmode="decimal" value="${it.qty}"></div>
        <div class="grow"><label>Unit</label><input id="eUnit" value="${esc(it.unit)}"></div>
        <div class="grow"><label>Price (${esc(settings.currency)})</label><input id="ePrice" type="number" inputmode="decimal" value="${it.price}"></div>
      </div>
      <label>Category</label><input id="eCat" list="catList" value="${esc(it.category)}"><datalist id="catList">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
      <label>Notes</label><input id="eNotes" value="${esc(it.notes)}">
      <label class="toggle" style="margin-top:8px"><input type="checkbox" id="eOpt" ${it.optional ? 'checked' : ''}><span>Optional</span></label>
    </div>
    <div class="row gap wrap" style="margin-top:12px">
      <button class="btn primary" id="eSave">Save</button>
      ${id ? `<button class="btn ghost" id="eFind">${icon('search')} Find it</button>` : ''}
      ${hasParts ? `<button class="btn ghost" id="eShow">${icon('cube')} 3D</button>` : ''}
      ${id ? `<button class="btn ghost danger-text" id="eDel">${icon('trash')}</button>` : ''}
    </div>`);
  $('#eSave').onclick = () => {
    const name = $('#eName').value.trim();
    if (!name) { toast('Give it a name'); return; }
    const upd = { name, qty: Math.max(0, parseFloat($('#eQty').value) || 0), unit: $('#eUnit').value.trim(), price: Math.max(0, parseFloat($('#ePrice').value) || 0), category: $('#eCat').value.trim() || 'Other', notes: $('#eNotes').value.trim(), optional: $('#eOpt').checked };
    if (id) Object.assign(it, upd);
    else d.shopping_list.push({ id: 'u' + Date.now().toString(36), ...upd });
    closeSheet(); persistCurrent(); renderList(); toast(id ? 'Saved' : 'Added');
  };
  $('#eFind')?.addEventListener('click', () => searchStore(it.name));
  $('#eShow')?.addEventListener('click', () => {
    closeSheet();
    const idx = d.model.parts.map((p, i) => p.item === id ? i : -1).filter(i => i >= 0);
    tab = '3d'; renderResult();
    viewer.setStep(Infinity, false);
    const r = $('#stepRange'); if (r) { r.value = r.max; r.oninput(); }
    viewer.select(idx[0]); viewer.focusParts(idx); showPart(idx[0]);
  });
  $('#eDel')?.addEventListener('click', () => {
    d.shopping_list = d.shopping_list.filter(x => x !== it);
    delete current.checked[id];
    d.model.parts.forEach(p => { if (p.item === id) p.item = ''; });
    closeSheet(); persistCurrent(); renderList(); toast('Deleted');
  });
}

function searchStore(q) { openUrl((STORES[settings.store] || STORES.google).url(q)); }

function listText() {
  const d = current.data, t = totals(current);
  const lines = [`🛒 ${d.title} — shopping list`, ''];
  const cats = {};
  d.shopping_list.forEach(i => (cats[i.category] ||= []).push(i));
  for (const [c, items] of Object.entries(cats)) {
    lines.push(`${c.toUpperCase()}`);
    items.forEach(i => lines.push(`${current.checked[i.id] ? '☑' : '☐'} ${i.name} — ${+(+i.qty).toFixed(2)} ${i.unit} (~${money(i.price)})${i.optional ? ' [optional]' : ''}${i.notes ? `\n    ${i.notes}` : ''}`));
    lines.push('');
  }
  lines.push(`Estimated total: ${money(t.total)}`);
  const cut = cutList(d);
  if (cut.rows.length) { lines.push('', 'CUT LIST'); cut.rows.forEach(r => lines.push(`${r.n} × ${r.dims} mm (${r.names})`)); }
  if (d.tools.length) lines.push('', `Tools: ${d.tools.join(', ')}`);
  lines.push('', 'Made with BuildCart 3D');
  return lines.join('\n');
}

// ----- Steps tab -----
function renderSteps() {
  const d = current.data;
  const n = d.steps.length;
  const done = d.steps.filter((_, i) => current.stepsDone[i]).length;
  const pct = n ? Math.round(done / n * 100) : 0;
  $('#tabBody').innerHTML = `<div class="pad">
    ${n ? `<div class="card totals"><div><div class="muted small">${d.type === 'item' ? 'Setup' : 'Build'} progress</div><div class="big-num">${pct}%</div></div>
      <div class="right"><div class="muted small">${done}/${n} steps</div><div class="muted small">${d.time_estimate ? '⏱ ' + esc(d.time_estimate) : ''}</div></div>
      <div class="bar wide"><i style="width:${pct}%"></i></div>
      <div class="muted small wide">💡 Your screen stays on while this tab is open.</div></div>` : ''}
    ${n ? d.steps.map((s, i) => `
    <div class="card step ${current.stepsDone[i] ? 'done' : ''}">
      <div class="step-num">${current.stepsDone[i] ? '✓' : i + 1}</div>
      <div class="step-body"><div class="step-title">${esc(s.title)}</div><div class="step-detail">${esc(s.detail)}</div>
      <div class="row gap wrap">
        <button class="btn small ${current.stepsDone[i] ? 'ghost' : ''}" data-done="${i}">${current.stepsDone[i] ? 'Undo' : '✓ Done'}</button>
        ${d.type === 'project' && d.model.parts.some(p => p.step === i + 1) ? `<button class="btn small ghost" data-step="${i + 1}">${icon('cube')} See in 3D</button>` : ''}
      </div></div>
    </div>`).join('') : '<div class="empty">No steps.</div>'}
    ${d.tips.length ? `<h3 class="cat">Tips</h3>${d.tips.map(t => `<div class="card tipc">💡 ${esc(t)}</div>`).join('')}` : ''}
  </div>`;
  $$('[data-step]').forEach(b => b.onclick = () => { if (viewer) viewer.pendingStep = +b.dataset.step; else pendingStepNoViewer = +b.dataset.step; tab = '3d'; renderResult(); });
  $$('[data-done]').forEach(b => b.onclick = () => {
    const i = +b.dataset.done;
    current.stepsDone[i] = !current.stepsDone[i]; vibrate(); persistCurrent();
    const scroll = window.scrollY; renderSteps(); window.scrollTo(0, scroll);
    if (current.stepsDone[i] && d.steps.every((_, j) => current.stepsDone[j])) toast('🎉 All done — nice work!');
  });
}
let pendingStepNoViewer = null;

// ----- Ask tab -----
const QUICK_Q = ['How can I make it cheaper?', 'What could go wrong?', 'Which screws / fixings exactly?', 'Safety tips?', 'Can I do it with only basic tools?', 'What size should I make it?'];
function renderAsk() {
  const chat = current.chat;
  $('#tabBody').innerHTML = `<div class="pad chat" id="chat">
    ${chat.length ? '' : `<div class="card"><b>Ask about “${esc(current.data.title)}”</b><div class="muted small">Answers use your shopping list and steps. Questions don't change the build — use “Change it” for that.</div></div>`}
    ${chat.map(m => bubble(m.role, m.content)).join('')}
    <div class="chips">${QUICK_Q.map(q => `<button class="chip" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
    ${chat.length ? `<button class="btn small ghost" id="clearChat" style="align-self:center">Clear chat</button>` : ''}
  </div>`;
  $$('[data-q]').forEach(b => b.onclick = () => doAsk(b.dataset.q));
  $('#clearChat')?.addEventListener('click', () => { current.chat = []; persistCurrent(); renderAsk(); });
  setTimeout(() => window.scrollTo(0, document.body.scrollHeight), 30);
}

function bubble(role, text) {
  return `<div class="bubble ${role === 'user' ? 'me' : 'ai'}">${role === 'user' ? esc(text) : md(text)}</div>`;
}
function md(t) {
  const lines = esc(t).split('\n');
  let out = '', inList = false;
  for (let l of lines) {
    l = l.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|\s)\*(.+?)\*(?=\s|$)/g, '$1<i>$2</i>').replace(/`([^`]+)`/g, '<code>$1</code>');
    const m = l.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)/);
    if (m) { if (!inList) { out += '<ul>'; inList = true; } out += `<li>${m[1]}</li>`; continue; }
    if (inList) { out += '</ul>'; inList = false; }
    const h = l.match(/^#{1,4}\s+(.*)/);
    out += h ? `<div class="md-h">${h[1]}</div>` : (l.trim() ? `<p>${l}</p>` : '');
  }
  return out + (inList ? '</ul>' : '');
}

async function doAsk(q) {
  q = (q || '').trim();
  if (!q || askCtl) return;
  if (!settings.apiKey.trim()) { toast('Add your OpenRouter key first'); go('settings'); return; }
  const b = current;
  const history = b.chat.slice();
  b.chat.push({ role: 'user', content: q });
  if (tab !== 'ask') { tab = 'ask'; renderResult(); } else renderAsk();
  const inp = $('#askIn'); if (inp) inp.value = '';
  const chips = $('#chat .chips'); chips?.remove();
  $('#chat').insertAdjacentHTML('beforeend', `<div class="bubble ai" id="live"><span class="typing"><i></i><i></i><i></i></span></div><button class="btn small ghost" id="askStop" style="align-self:center">Stop</button>`);
  window.scrollTo(0, document.body.scrollHeight);
  askCtl = new AbortController();
  $('#askStop').onclick = () => askCtl?.abort();
  let last = 0;
  try {
    const ans = await ask(settings, b.data, history, q, t => {
      const now = Date.now(); if (now - last < 120) return; last = now;
      const el = $('#live'); if (el && t) { el.innerHTML = md(t); window.scrollTo(0, document.body.scrollHeight); }
    }, askCtl.signal);
    b.chat.push({ role: 'assistant', content: ans });
  } catch (e) {
    if (e.message !== 'Cancelled') b.chat.push({ role: 'assistant', content: `⚠️ ${e.message}` });
    else b.chat.pop();
  } finally {
    askCtl = null;
    persistCurrent();
    if (current === b && view === 'result' && tab === 'ask') renderAsk();
  }
}

// ----- Info tab -----
function renderInfo() {
  const d = current.data, t = totals(current);
  $('#tabBody').innerHTML = `<div class="pad">
    <div class="card form">
      <label>Name</label><input id="iTitle" value="${esc(d.title)}">
      <p class="lead" style="margin-top:10px">${esc(d.summary)}</p>
      <div class="facts">
        ${d.difficulty ? `<div><span class="muted small">Difficulty</span><b>${esc(d.difficulty)}</b></div>` : ''}
        ${d.time_estimate ? `<div><span class="muted small">Time</span><b>${esc(d.time_estimate)}</b></div>` : ''}
        ${d.dimensions ? `<div><span class="muted small">Size</span><b>${esc(d.dimensions)}</b></div>` : ''}
        <div><span class="muted small">Cost</span><b>${money(t.total)}</b></div>
        <div><span class="muted small">Items</span><b>${t.count}</b></div>
        <div><span class="muted small">3D pieces</span><b>${pieceCount(d)}</b></div>
      </div>
    </div>
    <div class="card form"><label>My notes</label><textarea id="iNotes" rows="3" placeholder="Measurements, where to buy, ideas…">${esc(current.notes)}</textarea></div>
    <div class="card info-actions">
      <button class="btn ghost" id="iRefine">${icon('cube')} Improve 3D model</button>
      <button class="btn ghost" id="iRegen">${icon('spark')} Regenerate all</button>
      <button class="btn ghost" id="iDup">${icon('copy')} Duplicate</button>
      <button class="btn ghost" id="iSend">${icon('share')} Send build file</button>
      <button class="btn ghost" id="iStl">${icon('download')} STL (3D print)</button>
      <button class="btn ghost" id="iGlb">${icon('download')} GLB (3D apps)</button>
    </div>
    ${current.versions.length ? `<div class="card"><div class="muted small">Earlier versions (before AI changes)</div>
      ${current.versions.map((v, i) => `<div class="ver-row"><span>${esc(v.label)}<br><span class="muted small">${new Date(v.at).toLocaleString()}</span></span><button class="btn small ghost" data-ver="${i}">Restore</button></div>`).join('')}</div>` : ''}
    <div class="card small"><div class="muted">You asked for</div><div>${esc(current.prompt)}</div>
    <div class="muted" style="margin-top:8px">Made by</div><div class="mono">${esc(d.generatedBy || '')}</div>
    <div class="muted" style="margin-top:8px">Created</div><div>${new Date(current.created).toLocaleString()}</div></div>
  </div>`;
  $('#iTitle').onchange = e => { const v = e.target.value.trim(); if (v) { d.title = v; persistCurrent(); $('.rt-title .t').textContent = v; toast('Renamed'); } };
  let nt; $('#iNotes').oninput = e => { current.notes = e.target.value; clearTimeout(nt); nt = setTimeout(persistCurrent, 400); };
  $('#iRefine').onclick = doRefine;
  $('#iRegen').onclick = regenerate;
  $('#iDup').onclick = duplicate;
  $('#iSend').onclick = sendBuildFile;
  $('#iStl').onclick = exportStl;
  $('#iGlb').onclick = exportGlb;
  $$('[data-ver]').forEach(b => b.onclick = () => restoreVersion(+b.dataset.ver));
}

// ----- AI changes + versions -----
function pushVersion(label) {
  current.versions.unshift({ label, at: Date.now(), data: JSON.parse(JSON.stringify(current.data)) });
  current.versions = current.versions.slice(0, 6);
}
function undo() {
  if (!current.versions.length) return;
  const v = current.versions.shift();
  current.data = v.data;
  saveBuilds(); renderResult(); toast('Undone ↶');
}
function restoreVersion(i) {
  const v = current.versions[i];
  if (!v) return;
  pushVersion('Before restoring');
  current.versions.splice(i + 1, 1);
  current.data = v.data;
  saveBuilds(); tab = '3d'; renderResult(); toast('Restored');
}

async function regenerate() {
  if (!settings.apiKey.trim()) { toast('Add your OpenRouter key first'); go('settings'); return; }
  const prompt = current.prompt === 'demo' || current.prompt.startsWith('📷') ? current.data.title : current.prompt;
  const data = await withLoading(signal => generate(settings, { prompt, mode: current.data.type }, setLoadingStatus, signal));
  if (data) applyNewData(data, 'Before regenerating');
}

async function doRefine() {
  if (!settings.apiKey.trim()) { toast('Add your OpenRouter key first'); go('settings'); return; }
  const data = await withLoading(signal => refineModel(settings, slimData(), setLoadingStatus, signal));
  if (data) { applyNewData(data, 'Before improving 3D'); toast(`3D model rebuilt: ${pieceCount(data)} pieces`); }
}

function slimData() {
  const slim = JSON.parse(JSON.stringify(current.data));
  delete slim.generatedBy;
  slim.model.parts.forEach(p => { p.size = p.size.map(r4); p.pos = p.pos.map(r4); p.rot = p.rot.map(v => Math.round(v)); });
  return slim;
}

async function doTweak() {
  const ins = $('#tweakIn').value.trim();
  if (!ins) { $('#tweakIn').focus(); return; }
  if (!settings.apiKey.trim()) { toast('Add your OpenRouter key first'); go('settings'); return; }
  const data = await withLoading(signal => tweak(settings, slimData(), ins, setLoadingStatus, signal));
  if (!data) return;
  applyNewData(data, `Before “${ins.slice(0, 40)}”`);
  toast(data.modelError ? 'List updated — the 3D pass failed, tap “Build the 3D model”' : 'Updated ✓ — tap Undo if you don’t like it');
}
const r4 = v => Math.round(v * 10000) / 10000;

function applyNewData(data, label) {
  pushVersion(label);
  current.data = data;
  if (current.id === 'demo') { current.id = 'b' + Date.now().toString(36); current.prompt = data.title; }
  if (!builds.includes(current)) builds.unshift(current);
  const ids = new Set(data.shopping_list.map(i => i.id));
  for (const k of Object.keys(current.checked)) if (!ids.has(k)) delete current.checked[k];
  saveBuilds();
  if (viewer) viewer.loadedFor = null;
  tab = '3d';
  renderResult();
}

function persistCurrent() {
  if (current.id === 'demo') return;
  saveBuilds();
  const tt = $('#rtSub'); if (tt) tt.textContent = subLine();
}

function duplicate() {
  const copyB = ensureBuild(JSON.parse(JSON.stringify(current)));
  copyB.id = 'b' + Date.now().toString(36);
  copyB.created = Date.now();
  copyB.data.title += ' (copy)';
  copyB.versions = [];
  builds.unshift(copyB); saveBuilds();
  openBuild(copyB); toast('Duplicated');
}

const b64utf8 = s => btoa(unescape(encodeURIComponent(s)));
function sendBuildFile() {
  const b = { ...current, versions: [], chat: [] };
  shareFile(`${slug(current.data.title)}.buildcart.json`, 'application/json', b64utf8(JSON.stringify({ app: 'BuildCart3D', v: 1, builds: [b] })),
    `${current.data.title} — open in BuildCart 3D (Settings → Import)`);
}

async function exportGlb() {
  try {
    if (!viewer || viewer.loadedFor !== current) { tab = '3d'; renderResult(); }
    const buf = await viewer.exportGLB();
    saveFile(`${slug(current.data.title)}.glb`, 'model/gltf-binary', bufToB64(buf));
  } catch (e) { showError('Export failed: ' + e.message); }
}
async function exportStl() {
  try {
    if (!viewer || viewer.loadedFor !== current) { tab = '3d'; renderResult(); }
    const dv = await viewer.exportSTL();
    saveFile(`${slug(current.data.title)}.stl`, 'model/stl', bufToB64(dv.buffer || dv));
    toast('STL is in millimetres');
  } catch (e) { showError('Export failed: ' + e.message); }
}
function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'build';

function openMenu() {
  openSheet(`<div class="menu">
    ${current.versions.length ? `<button data-a="undo">${icon('undo')} Undo last AI change</button>` : ''}
    <button data-a="share">${icon('share')} Share shopping list</button>
    <button data-a="refine">${icon('cube')} Improve 3D model</button>
    <button data-a="send">${icon('share')} Send build file to a friend</button>
    <button data-a="stl">${icon('download')} Export STL (3D printing)</button>
    <button data-a="glb">${icon('download')} Export GLB (3D apps)</button>
    <button data-a="regen">${icon('spark')} Regenerate from scratch</button>
    ${current.id !== 'demo' ? `<button data-a="del" class="danger">${icon('trash')} Delete build</button>` : ''}
  </div>`);
  $$('.menu [data-a]').forEach(b => b.onclick = () => {
    const a = b.dataset.a; closeSheet();
    if (a === 'undo') undo();
    if (a === 'share') share(listText());
    if (a === 'refine') doRefine();
    if (a === 'send') sendBuildFile();
    if (a === 'stl') exportStl();
    if (a === 'glb') exportGlb();
    if (a === 'regen') regenerate();
    if (a === 'del') askSheet('Delete this build?', 'Delete', () => { builds = builds.filter(x => x !== current); saveBuilds(); go('home'); });
  });
}

// ---------- sheet ----------
let sheetOnClose = null;
function openSheet(html, onClose) {
  closeSheet();
  sheetOnClose = onClose || null;
  const bd = document.createElement('div');
  bd.className = 'sheet-backdrop';
  bd.innerHTML = `<div class="sheet"><div class="grabber"></div>${html}</div>`;
  bd.onclick = e => { if (e.target === bd || e.target.closest('[data-close]')) closeSheet(); };
  document.body.appendChild(bd);
}
function askSheet(q, okLabel, fn) {
  openSheet(`<h3>${esc(q)}</h3><div class="row gap"><button class="btn danger-btn" id="askOk">${esc(okLabel)}</button><button class="btn ghost" data-close>Cancel</button></div>`);
  $('#askOk').onclick = () => { closeSheet(); fn(); };
}
function closeSheet() {
  const s = document.querySelector('.sheet-backdrop');
  if (!s) return;
  s.remove();
  const f = sheetOnClose; sheetOnClose = null; f?.();
}

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
      <button class="btn small ghost" id="sPaste" title="Paste">${icon('paste')}</button>
      <button class="btn small ghost" id="sShow" title="Show">${icon('eye')}</button></div>
      <div class="row gap"><button class="btn small" id="sTest">Test key</button><button class="btn small ghost" id="sGet">Get a free key</button></div>
      <div class="muted small" id="sTestOut"></div>
      <div class="usage"><div class="row" style="justify-content:space-between"><span class="muted small">Free AI requests today (this phone)</span><b>${usageToday()} / ~50</b></div>
      <div class="bar"><i style="width:${Math.min(100, usageToday() * 2)}%;background:${usageToday() > 40 ? 'var(--bad)' : 'var(--accent2)'}"></i></div></div>
    </div>
    <div class="card form">
      <label>AI model</label>
      <select id="sModel">
        <option value="${FREE_ROUTER}">⭐ Auto — best free model (recommended)</option>
        ${models.map(m => `<option value="${esc(m.id)}" ${settings.model === m.id ? 'selected' : ''}>${m.vision ? '📷 ' : ''}${esc(m.name)}</option>`).join('')}
        ${settings.model !== FREE_ROUTER && !models.some(m => m.id === settings.model) ? `<option value="${esc(settings.model)}" selected>${esc(settings.model)}</option>` : ''}
      </select>
      <div class="row gap"><button class="btn small ghost" id="sRefresh">${icon('rotate')} Load free models</button><span class="muted small" id="sModelsOut">${models.length ? models.length + ' free models · 📷 = understands photos' : ''}</span></div>
      <label>Or type any model id</label>
      <input id="sCustom" placeholder="e.g. vendor/model-name:free" value="">
      <p class="muted small">If a model is busy, the app automatically tries Auto and other free models.</p>
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
    <div class="card form">
      <label>Backup</label>
      <p class="muted small">Your builds live only on this phone. Back them up before uninstalling or switching phones. Import also opens build files friends send you.</p>
      <div class="row gap wrap"><button class="btn small" id="sExport">${icon('download')} Back up ${builds.length} builds</button>
      <button class="btn small ghost" id="sImport">${icon('upload')} Import</button></div>
      <input type="file" id="importIn" accept="application/json,.json" hidden>
    </div>
    <button class="btn primary wide" id="sSave">Save</button>
    <button class="btn ghost wide" id="sWelcome">Show welcome screen</button>
    <p class="muted small center">BuildCart 3D · v2 ${isAndroid() ? '· Android' : '· Web'}</p>
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
  $('#sPaste').onclick = async () => { const t = (await readClipboard()).trim(); if (t) { $('#sKey').value = t; toast('Pasted'); } else toast('Clipboard is empty'); };
  $('#sGet').onclick = () => openUrl('https://openrouter.ai/keys');
  $('#sTest').onclick = async () => {
    collect();
    const out = $('#sTestOut'); out.textContent = 'Checking…';
    try {
      const k = await testKey(settings);
      const bits = ['✅ Key works'];
      if (k.is_free_tier) bits.push('free tier');
      if (k.limit_remaining != null) bits.push(`${Number(k.limit_remaining).toFixed(2)} credits left`);
      if (k.usage != null) bits.push(`$${Number(k.usage).toFixed(2)} used`);
      out.textContent = bits.join(' · ');
      saveSettings();
    } catch (e) { out.textContent = '❌ ' + e.message; }
  };
  $('#sRefresh').onclick = async () => {
    collect();
    const out = $('#sModelsOut'); out.textContent = 'Loading…';
    try {
      cachedModels = await listFreeModels(settings);
      localStorage.setItem(LS_MODELS, JSON.stringify(cachedModels));
      syncFallbacks(); saveSettings(); renderSettings();
      toast(`${cachedModels.length} free models found`);
    } catch (e) { out.textContent = '❌ ' + e.message; }
  };
  $('#sExport').onclick = () => {
    const name = `buildcart-backup-${new Date().toISOString().slice(0, 10)}.json`;
    saveFile(name, 'application/json', b64utf8(JSON.stringify({ app: 'BuildCart3D', v: 1, builds })));
  };
  $('#sImport').onclick = () => $('#importIn').click();
  $('#importIn').onchange = e => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const j = JSON.parse(fr.result);
        const list = Array.isArray(j) ? j : j.builds;
        if (!Array.isArray(list)) throw new Error('not a BuildCart file');
        let added = 0;
        for (const b of list) {
          if (!b || !b.data || !Array.isArray(b.data.shopping_list) || !b.data.model) continue;
          if (builds.some(x => x.id === b.id)) continue;
          builds.push(ensureBuild(b)); added++;
        }
        builds.sort((a, b) => b.created - a.created);
        saveBuilds(); toast(`Imported ${added} build${added === 1 ? '' : 's'}`); renderSettings();
      } catch (err) { showError('Could not import: ' + err.message); }
    };
    fr.readAsText(f);
  };
  $('#sSave').onclick = () => { collect(); saveSettings(); toast('Saved'); go('home'); };
  $('#sWelcome').onclick = () => { collect(); saveSettings(); settings.welcomed = false; go('home'); };
}

// ---------- boot ----------
render();
window.__app = { get current() { return current; }, openBuild, settings, builds: () => builds, get viewer() { return viewer; } };
