// Talks to the Android side (window.AndroidBridge) when running inside the APK,
// falls back to browser APIs otherwise.
const pending = new Map();
let seq = 0;

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
