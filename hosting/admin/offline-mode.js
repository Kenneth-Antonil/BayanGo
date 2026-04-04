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
