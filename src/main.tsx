import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

function findScrollableParent(el: EventTarget | null): HTMLElement | null {
  let node = el instanceof HTMLElement ? el : null;
  while (node && node !== document.body && node !== document.documentElement) {
    const style = window.getComputedStyle(node);
    const overflowY = style.overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

// Strict PWA Native Lock: Block pinch zoom, gesture zoom, ctrl+wheel/key zoom, and top pull-to-refresh
if (typeof window !== 'undefined') {
  let touchStartY = 0;
  let touchStartX = 0;

  document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
  document.addEventListener('gesturechange', (e) => e.preventDefault(), { passive: false });
  document.addEventListener('gestureend', (e) => e.preventDefault(), { passive: false });

  document.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length > 1) {
        e.preventDefault();
        return;
      }
      touchStartY = e.touches[0].clientY;
      touchStartX = e.touches[0].clientX;
    },
    { passive: false }
  );

  document.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length > 1) {
        e.preventDefault();
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target?.closest('.plyr__progress, input[type="range"]')) {
        return;
      }
      const dy = e.touches[0].clientY - touchStartY;
      const dx = e.touches[0].clientX - touchStartX;
      // Block vertical downward pull-to-refresh when already at scrollTop <= 0 or outside a scrollable box
      if (dy > 12 && Math.abs(dy) > Math.abs(dx)) {
        const scroller = findScrollableParent(e.target);
        if (!scroller || scroller.scrollTop <= 0) {
          e.preventDefault();
        }
      }
    },
    { passive: false }
  );

  window.addEventListener(
    'wheel',
    (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
      }
    },
    { passive: false }
  );

  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '-' || e.key === '=' || e.key === '0')) {
      e.preventDefault();
    }
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

function warmServiceWorkerCache(sw: ServiceWorker | null | undefined) {
  if (!sw) return;
  try {
    const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    const urls = Array.from(
      new Set([
        '/',
        window.location.pathname + window.location.search,
        ...entries
          .map((e) => e.name)
          .filter((name) => name.startsWith(window.location.origin) && !name.includes('/api/')),
      ])
    );
    sw.postMessage({ type: 'CACHE_URLS', urls });
  } catch {
    // Ignore performance entry read errors
  }
}

if ('serviceWorker' in navigator) {
  const bootTime = Date.now();
  const hadController = Boolean(navigator.serviceWorker.controller);

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        if (reg.active) {
          warmServiceWorkerCache(reg.active);
        }
        reg.update().catch(() => {});

        let lastUpdateCheck = Date.now();
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible' && navigator.onLine && Date.now() - lastUpdateCheck > 60_000) {
            lastUpdateCheck = Date.now();
            reg.update().catch(() => {});
          }
        });

        reg.addEventListener('updatefound', () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'activated') {
              warmServiceWorkerCache(installing);
            }
          });
        });
        return navigator.serviceWorker.ready;
      })
      .then((readyReg) => {
        warmServiceWorkerCache(readyReg.active || navigator.serviceWorker.controller);
      })
      .catch(() => {});

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      warmServiceWorkerCache(navigator.serviceWorker.controller);
      // Seamlessly apply updated app shell when an existing PWA updates to a newer version
      const isPlayingVideo = Array.from(document.querySelectorAll('video')).some(
        (v) => !v.paused && !v.ended
      );
      const isOAuthCallback =
        /[?&#](code|state|apiKey|mode|oobCode|__firebase)=/i.test(
          window.location.search + window.location.hash
        );
      const reloadedOnce = sessionStorage.getItem('noor_elahi_sw_reloaded') === '1';
      if (
        hadController &&
        !reloadedOnce &&
        !isPlayingVideo &&
        !isOAuthCallback &&
        Date.now() - bootTime < 20_000
      ) {
        sessionStorage.setItem('noor_elahi_sw_reloaded', '1');
        window.location.reload();
      }
    });
  });
}
