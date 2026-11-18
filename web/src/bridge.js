// Talks to the Android side (window.AndroidBridge) when running inside the APK,
// falls back to browser APIs otherwise.
const pending = new Map();
let seq = 0;

window.__bridgeHttpChunk = (id, text) => {
  const p = pending.get(id);
  if (p && p.onChunk) p.onChunk(text);
};

window.__bridgeHttpDone = (id, status, body) => {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  p.resolve({ status, body });
};

export const isAndroid = () => typeof window.AndroidBridge !== 'undefined';

export function httpRequest({ method = 'GET', url, headers = {}, body = null, signal }) {
  if (isAndroid()) {
    const id = `r${++seq}`;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve });
      if (signal) signal.addEventListener('abort', () => { pending.delete(id); window.AndroidBridge.cancel(id); reject(new Error('Cancelled')); });
      window.AndroidBridge.http(id, method, url, JSON.stringify(headers), body || '');
    });
  }
  return fetch(url, { method, headers, body, signal })
    .then(async r => ({ status: r.status, body: await r.text() }))
    .catch(e => { if (signal?.aborted) throw new Error('Cancelled'); return { status: 0, body: String(e) }; });
}

// Streaming request: onChunk(text) gets raw text as it arrives. Resolves {status, body} (body only on error).
export function httpStream({ method = 'POST', url, headers = {}, body = null, signal, onChunk }) {
  if (isAndroid() && window.AndroidBridge.httpStream) {
    const id = `s${++seq}`;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, onChunk });
      if (signal) signal.addEventListener('abort', () => { pending.delete(id); window.AndroidBridge.cancel(id); reject(new Error('Cancelled')); });
      window.AndroidBridge.httpStream(id, method, url, JSON.stringify(headers), body || '');
    });
  }
  return fetch(url, { method, headers, body, signal }).then(async r => {
    if (r.status >= 400 || !r.body) return { status: r.status, body: await r.text() };
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      onChunk?.(dec.decode(value, { stream: true }));
    }
    return { status: r.status, body: '' };
  }).catch(e => { if (signal?.aborted) throw new Error('Cancelled'); return { status: 0, body: String(e) }; });
}

export function listen(prompt = 'Say what you want to build or buy') {
  return new Promise(resolve => {
    if (isAndroid() && window.AndroidBridge.listen) {
      window.__onSpeech = t => { window.__onSpeech = null; resolve(t || ''); };
      window.AndroidBridge.listen(prompt);
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast('Voice input is not available here'); return resolve(''); }
    const r = new SR(); r.lang = 'en-AU';
    r.onresult = e => resolve(e.results[0][0].transcript);
    r.onerror = () => resolve('');
    r.start();
  });
}

export function keepAwake(on) {
  if (isAndroid() && window.AndroidBridge.keepAwake) window.AndroidBridge.keepAwake(!!on);
}

export function readClipboard() {
  return new Promise(resolve => {
    if (isAndroid() && window.AndroidBridge.readClipboard) {
      window.__onClipboard = t => { window.__onClipboard = null; resolve(t || ''); };
      window.AndroidBridge.readClipboard();
      return;
    }
    (navigator.clipboard?.readText() || Promise.resolve('')).then(resolve, () => resolve(''));
  });
}

export function shareFile(name, mime, base64, text = '') {
  if (isAndroid() && window.AndroidBridge.shareFile) return window.AndroidBridge.shareFile(name, mime, base64, text);
  return saveFile(name, mime, base64);
}

export function share(text, title = 'BuildCart 3D') {
  if (isAndroid()) return window.AndroidBridge.share(title, text);
  if (navigator.share) return navigator.share({ title, text }).catch(() => {});
  return copy(text);
}

export function copy(text) {
  if (isAndroid()) return window.AndroidBridge.copy(text);
  return navigator.clipboard?.writeText(text);
}

export function openUrl(url) {
  if (isAndroid()) return window.AndroidBridge.openUrl(url);
  window.open(url, '_blank');
}

export function toast(msg) {
  if (isAndroid()) return window.AndroidBridge.toast(msg);
  document.querySelectorAll('.toast').forEach(x => x.remove());
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

export function saveFile(name, mime, base64) {
  if (isAndroid()) return window.AndroidBridge.saveFile(name, mime, base64);
  const a = document.createElement('a');
  a.href = `data:${mime};base64,${base64}`; a.download = name; a.click();
}

export function vibrate(ms = 12) {
  if (isAndroid()) window.AndroidBridge.vibrate(ms);
  else navigator.vibrate?.(ms);
}
