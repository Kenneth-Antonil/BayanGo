(() => {
  if (typeof window === 'undefined') return;

  const OFFLINE_BANNER_ID = 'bayango-offline-banner';

  function ensureOfflineBanner() {
    let banner = document.getElementById(OFFLINE_BANNER_ID);
    if (banner) return banner;

    banner = document.createElement('div');
    banner.id = OFFLINE_BANNER_ID;
    banner.style.cssText = [
      'position:fixed',
      'left:12px',
      'right:12px',
      'bottom:12px',
      'z-index:2147483647',
      'display:none',
      'padding:10px 12px',
      'border-radius:12px',
      'background:#111827',
      'color:#FFFFFF',
      'font-size:12px',
      'font-weight:700',
      'box-shadow:0 8px 18px rgba(0,0,0,.22)',
      'text-align:center',
      'pointer-events:none',
    ].join(';');
    banner.textContent = 'Offline mode: puwede mo pa ring buksan ang huling cached screens.';
    document.body.appendChild(banner);
    return banner;
  }

  function updateConnectionBanner() {
    const banner = ensureOfflineBanner();
    banner.style.display = navigator.onLine ? 'none' : 'block';
  }

  window.addEventListener('online', updateConnectionBanner);
  window.addEventListener('offline', updateConnectionBanner);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateConnectionBanner, { once: true });
  } else {
    updateConnectionBanner();
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.warn('Offline service worker registration failed:', err);
      });
    });
  }
})();

(() => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const ua = navigator.userAgent || '';
  const isAndroid = /Android/i.test(ua);
  const isNativeAndroidApp = /BayanGoAndroidApp/i.test(ua);
  const isCrawler = /bot|crawler|spider|crawling/i.test(ua);
  if (!isAndroid || isNativeAndroidApp || isCrawler) return;

  const APK_URL = window.BAYANGO_ANDROID_APK_URL || '/downloads/bayango-user.apk';
  const DOWNLOAD_PAGE_URL = window.BAYANGO_ANDROID_DOWNLOAD_PAGE || '/user-demo/android-download.html';
  const DISMISS_KEY = 'bayango_android_download_prompt_dismissed_v1';
  const PROMPT_ID = 'bayango-android-download-prompt';
  const MINI_ID = 'bayango-android-download-mini';

  function applyStyles(el, styles) {
    Object.assign(el.style, styles);
  }

  function wasDismissed() {
    try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch (_) { return false; }
  }

  function dismissForNow() {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch (_) {}
    document.getElementById(PROMPT_ID)?.remove();
    document.getElementById(MINI_ID)?.remove();
  }

  function openDownload() {
    window.location.href = DOWNLOAD_PAGE_URL;
  }

  function createButton(text, bg, color) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = text;
    applyStyles(btn, {
      width: '100%',
      border: 'none',
      borderRadius: '14px',
      padding: '14px 16px',
      background: bg,
      color,
      fontSize: '14px',
      fontWeight: '800',
      fontFamily: 'inherit',
      cursor: 'pointer',
      boxShadow: bg.includes('gradient') ? '0 10px 22px rgba(22,101,52,.25)' : 'none',
    });
    return btn;
  }

  function showMainPrompt() {
    if (document.getElementById(PROMPT_ID)) return;

    const overlay = document.createElement('div');
    overlay.id = PROMPT_ID;
    applyStyles(overlay, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483646',
      background: 'rgba(15,23,42,.72)',
      backdropFilter: 'blur(7px)',
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'center',
      padding: '16px',
      fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
    });

    const card = document.createElement('div');
    applyStyles(card, {
      width: '100%',
      maxWidth: '430px',
      background: '#FFFFFF',
      color: '#111827',
      borderRadius: '24px',
      overflow: 'hidden',
      boxShadow: '0 24px 70px rgba(0,0,0,.34)',
      animation: 'bannerUp .28s ease both',
    });

    card.innerHTML = `
      <div style="background:linear-gradient(135deg,#052E16,#166534 55%,#22C55E);color:#fff;padding:18px 18px 16px;position:relative;">
        <button id="bayango-android-close" type="button" aria-label="Close" style="position:absolute;right:12px;top:12px;width:34px;height:34px;border-radius:12px;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.14);color:#fff;font-size:18px;font-weight:800;line-height:1;">×</button>
        <div style="display:inline-flex;align-items:center;gap:7px;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.18);padding:6px 10px;border-radius:999px;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;">Android App Available</div>
        <div style="margin-top:12px;font-size:23px;line-height:1.15;font-weight:900;max-width:310px;">I-download na ang BayanGo Android App</div>
        <div style="margin-top:7px;font-size:13px;line-height:1.55;opacity:.94;max-width:330px;">Hindi na kailangang i-install bilang PWA. Mas stable at app-like na ang experience sa Android app.</div>
      </div>
      <div style="padding:16px 18px 18px;">
        <div style="display:grid;gap:9px;margin-bottom:14px;">
          <div style="display:flex;gap:10px;align-items:flex-start;background:#F0FDF4;border:1px solid #BBF7D0;border-radius:14px;padding:11px 12px;">
            <div style="width:30px;height:30px;border-radius:10px;background:#166534;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:900;flex-shrink:0;">✓</div>
            <div><div style="font-size:13px;font-weight:800;color:#14532D;">Mas mabilis buksan</div><div style="font-size:11px;color:#4B5563;margin-top:2px;line-height:1.45;">Diretso app icon sa phone, hindi na Add to Home Screen.</div></div>
          </div>
          <div style="display:flex;gap:10px;align-items:flex-start;background:#EFF6FF;border:1px solid #BFDBFE;border-radius:14px;padding:11px 12px;">
            <div style="width:30px;height:30px;border-radius:10px;background:#2563EB;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:900;flex-shrink:0;">!</div>
            <div><div style="font-size:13px;font-weight:800;color:#1E3A8A;">Same account at same orders</div><div style="font-size:11px;color:#4B5563;margin-top:2px;line-height:1.45;">Connected pa rin sa Firebase ng BayanGo.</div></div>
          </div>
        </div>
        <div id="bayango-android-actions" style="display:grid;gap:9px;"></div>
        <div style="font-size:10.5px;color:#6B7280;line-height:1.5;margin-top:11px;text-align:center;">Kapag may security warning sa APK, piliin ang <b>Settings</b> → <b>Allow from this source</b>. Ilagay sa Play Store kapag ready na para mas madali sa users.</div>
      </div>
    `;

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const actions = card.querySelector('#bayango-android-actions');
    const downloadBtn = createButton('Download Android App', 'linear-gradient(135deg,#166534,#22C55E)', '#FFFFFF');
    downloadBtn.onclick = openDownload;
    const laterBtn = createButton('Mamaya na', '#F3F4F6', '#374151');
    laterBtn.onclick = dismissForNow;
    actions.appendChild(downloadBtn);
    actions.appendChild(laterBtn);

    card.querySelector('#bayango-android-close').onclick = dismissForNow;
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) dismissForNow();
    });
  }

  function showMiniBanner() {
    if (wasDismissed() || document.getElementById(MINI_ID) || document.getElementById(PROMPT_ID)) return;

    const mini = document.createElement('div');
    mini.id = MINI_ID;
    applyStyles(mini, {
      position: 'fixed',
      left: '12px',
      right: '12px',
      bottom: 'calc(env(safe-area-inset-bottom,0px) + 82px)',
      zIndex: '2147483645',
      maxWidth: '456px',
      margin: '0 auto',
      background: '#FFFFFF',
      border: '1px solid #BBF7D0',
      borderRadius: '18px',
      padding: '10px 10px 10px 12px',
      boxShadow: '0 12px 30px rgba(15,23,42,.18)',
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
    });

    mini.innerHTML = `
      <div style="width:38px;height:38px;border-radius:13px;background:linear-gradient(135deg,#166534,#22C55E);color:#fff;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:900;flex-shrink:0;">↓</div>
      <button type="button" id="bayango-mini-open" style="flex:1;border:0;background:transparent;text-align:left;padding:0;cursor:pointer;">
        <div style="font-size:12.5px;font-weight:900;color:#111827;line-height:1.2;">Android app available</div>
        <div style="font-size:10.5px;color:#64748B;margin-top:2px;line-height:1.3;">Tap to download, hindi na PWA.</div>
      </button>
      <button type="button" id="bayango-mini-close" aria-label="Close" style="width:30px;height:30px;border:0;border-radius:10px;background:#F3F4F6;color:#64748B;font-size:16px;font-weight:900;cursor:pointer;">×</button>
    `;

    document.body.appendChild(mini);
    mini.querySelector('#bayango-mini-open').onclick = showMainPrompt;
    mini.querySelector('#bayango-mini-close').onclick = dismissForNow;
  }

  function bootAndroidPrompt() {
    if (wasDismissed()) return;
    setTimeout(showMainPrompt, 900);
    setTimeout(showMiniBanner, 1600);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootAndroidPrompt, { once: true });
  } else {
    bootAndroidPrompt();
  }
})();
