// ============================================================
// HUMAN ERROR — platform shim
// One seam between the web build and the desktop (Tauri) build so platform
// calls never leak into game code. steamworks.js (achievements/overlay) drops
// in behind this same file later.
//
//   isDesktop()                    -> running inside the Tauri wrapper?
//   save(blob, filename, kind)     -> desktop: OS Videos/Pictures dir, returns
//                                     the saved path; browser: download, null
//   openUrl(url)                   -> system browser on desktop, new tab on web
// ============================================================

export function isDesktop() {
  return typeof window !== 'undefined' && !!window.__TAURI__;
}

function browserDownload(blob, filename) {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch (e) {}
  return null;
}

// kind: 'video' (clips) | 'picture' (screenshots)
export async function save(blob, filename, kind = 'video') {
  if (!isDesktop()) return browserDownload(blob, filename);
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    const dataB64 = btoa(bin);
    return await window.__TAURI__.core.invoke('save_media', { kind, filename, dataB64 });
  } catch (e) {
    return browserDownload(blob, filename);
  }
}

export function openUrl(url) {
  if (isDesktop()) { window.__TAURI__.core.invoke('open_url', { url }).catch(() => {}); return; }
  try { window.open(url, '_blank', 'noopener'); } catch (e) {}
}
