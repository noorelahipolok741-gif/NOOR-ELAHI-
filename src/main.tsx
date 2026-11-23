import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

function findScrollableParent(el: EventTarget | null): HTMLElement | null {
  let node = el instanceof HTMLElement ? el : null;
  while (node && node !== document.body && node !== document.documentElement) {
    const style = window.getComputedStyle(node);
    const overflowY = style.overflowY;
    if (
      (overflowY === 'auto' || overflowY === 'scroll') &&
      (node.scrollHeight > node.clientHeight + 1 || node.classList.contains('pwa-scroll-container'))
    ) {
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
  let lastTouchY = 0;
  let gestureScrolledDown = false;

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
      lastTouchY = touchStartY;
      gestureScrolledDown = false;
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

      const currentY = e.touches[0].clientY;
      const currentX = e.touches[0].clientX;
      const stepDy = currentY - lastTouchY;
      lastTouchY = currentY;

      const totalDy = currentY - touchStartY;
      const totalDx = currentX - touchStartX;
      const scroller = findScrollableParent(e.target);

      if (scroller) {
        // Finger moving up (stepDy < 0) or container already scrolled down -> allow native scroll freely
        if (scroller.scrollTop > 1 || stepDy < -1 || totalDy < -4) {
          gestureScrolledDown = true;
          return;
        }
        // Only prevent pull-to-refresh when pulling straight down from scrollTop === 0 before scrolling down
        if (
          scroller.scrollTop <= 0 &&
          stepDy > 1 &&
          totalDy > 10 &&
          Math.abs(totalDy) > Math.abs(totalDx) &&
          !gestureScrolledDown
        ) {
          e.preventDefault();
        }
        return;
      }

      // Outside any scrollable region (e.g. fixed top header / bottom nav): block downward pull-to-refresh
      if (totalDy > 10 && Math.abs(totalDy) > Math.abs(totalDx)) {
        e.preventDefault();
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
  const hadController = Boolean(navigator.serviceWorker.controller);

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then((reg) => {
        if (reg.active) {
          warmServiceWorkerCache(reg.active);
        }
        if (reg.waiting) {
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
        reg.update().catch(() => {});

        let lastUpdateCheck = Date.now();
        const triggerUpdateCheck = () => {
          if (navigator.onLine && Date.now() - lastUpdateCheck > 15_000) {
            lastUpdateCheck = Date.now();
            reg.update().catch(() => {});
          }
        };

        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            triggerUpdateCheck();
          }
        });
        window.addEventListener('online', triggerUpdateCheck);

        reg.addEventListener('updatefound', () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              installing.postMessage({ type: 'SKIP_WAITING' });
            }
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

    let pendingReload = false;
    const performSafeReload = () => {
      const lastReloadAt = Number(sessionStorage.getItem('noor_elahi_sw_reloaded_at') || '0');
      if (Date.now() - lastReloadAt < 8_000) return;
      sessionStorage.setItem('noor_elahi_sw_reloaded_at', String(Date.now()));
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      warmServiceWorkerCache(navigator.serviceWorker.controller);
      if (!hadController) return;

      const isPlayingVideo = Array.from(document.querySelectorAll('video')).some(
        (v) => !v.paused && !v.ended
      );
      const isOAuthCallback =
        /[?&#](code|state|apiKey|mode|oobCode|__firebase)=/i.test(
          window.location.search + window.location.hash
        );
      if (isPlayingVideo || isOAuthCallback) {
        pendingReload = true;
        return;
      }
      performSafeReload();
    });

    document.addEventListener('visibilitychange', () => {
      if (pendingReload && document.visibilityState === 'visible') {
        const isPlayingVideo = Array.from(document.querySelectorAll('video')).some(
          (v) => !v.paused && !v.ended
        );
        if (!isPlayingVideo) {
          pendingReload = false;
          performSafeReload();
        }
      }
    });
  });
}
