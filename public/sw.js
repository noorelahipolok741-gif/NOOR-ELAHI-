const CACHE_NAME = 'noor-elahi-v12';
const FONT_CACHE = 'noor-elahi-fonts-v12';

const CORE_SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json?v=5',
  '/icon-192.png?v=5',
  '/icon-512.png?v=5',
  '/maskable-icon-512.png?v=5',
  '/apple-touch-icon.png?v=5',
  '/favicon.svg?v=5',
  '/icon.svg?v=5',
  '/plyr.svg',
  '/pdf.worker.min.mjs',
];

const BYPASS_ORIGINS = [
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'accounts.google.com',
  'apis.google.com',
  'www.googleapis.com',
  'firebase.googleapis.com',
  'firebaseinstallations.googleapis.com',
  'www.googletagmanager.com',
  'www.google-analytics.com',
  'www.gstatic.com',
  'noor-elahi-84e9a.firebaseapp.com',
];

function extractAssetsFromHtml(htmlText, baseUrl) {
  const discovered = new Set();
  const attrRegex = /(?:src|href)=["']([^"']+)["']/gi;
  let match;
  while ((match = attrRegex.exec(htmlText)) !== null) {
    const raw = match[1];
    if (!raw || raw.startsWith('data:') || raw.startsWith('blob:')) continue;
    try {
      const resolved = new URL(raw, baseUrl);
      if (resolved.origin === self.location.origin) {
        discovered.add(resolved.pathname + resolved.search);
      }
    } catch {
      // Ignore malformed URLs
    }
  }
  return Array.from(discovered);
}

async function precacheAppShell() {
  const cache = await caches.open(CACHE_NAME);

  await Promise.allSettled(
    CORE_SHELL_ASSETS.map(async (assetUrl) => {
      try {
        const res = await fetch(assetUrl, { cache: 'no-store' });
        if (res.ok) {
          await cache.put(assetUrl, res.clone());
        }
      } catch {
        // Ignore single optional asset error during install
      }
    })
  );

  try {
    const htmlRes = await fetch('/', { cache: 'no-store' });
    if (htmlRes.ok) {
      const cloneForCache = htmlRes.clone();
      const htmlText = await htmlRes.text();
      await cache.put('/', cloneForCache.clone());
      await cache.put('/index.html', cloneForCache);

      const discoveredUrls = extractAssetsFromHtml(htmlText, self.location.origin);
      await Promise.allSettled(
        discoveredUrls.map(async (u) => {
          try {
            const res = await fetch(u, { cache: 'no-store' });
            if (res.ok) {
              await cache.put(u, res);
            }
          } catch {
            // Ignore optional resource failure
          }
        })
      );
    }
  } catch {
    // Ignore HTML discovery failure
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheAppShell().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  const validCaches = new Set([CACHE_NAME, FONT_CACHE]);
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames.map((name) => {
            if (!validCaches.has(name)) {
              return caches.delete(name);
            }
            return Promise.resolve();
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;

  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (data.type === 'CACHE_URLS' && Array.isArray(data.urls)) {
    event.waitUntil(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        await Promise.allSettled(
          data.urls.map(async (rawUrl) => {
            try {
              const url = new URL(String(rawUrl), self.location.origin);
              if (url.origin !== self.location.origin) return;
              if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/__/')) return;
              const reqKey = url.pathname + url.search;
              const existing = await cache.match(reqKey);
              if (existing) return;
              const res = await fetch(reqKey);
              if (res.ok) {
                await cache.put(reqKey, res);
              }
            } catch {
              // Ignore single entry error
            }
          })
        );
      })()
    );
  }
});

async function fetchWithTimeout(request, timeoutMs, bypassHttpCache = false) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(request, {
      signal: controller.signal,
      ...(bypassHttpCache ? { cache: 'no-store' } : {}),
    });
  } finally {
    clearTimeout(timer);
  }
}

function offlineFallbackPage() {
  const html = `<!doctype html>
<html lang="bn" style="background:#020617;color:#f1f5f9;">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no" />
  <meta name="theme-color" content="#020617" />
  <title>NOOR ELAHI</title>
</head>
<body style="margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;background:#020617;color:#f1f5f9;font-family:system-ui,sans-serif;padding:24px;text-align:center;">
  <div style="max-width:340px;background:#0f172a;border:1px solid #1e293b;border-radius:24px;padding:24px;">
    <h2 style="margin:0 0 8px;font-size:18px;color:#fff;">NOOR ELAHI</h2>
    <p style="margin:0 0 18px;font-size:13px;color:#94a3b8;line-height:1.6;">অফলাইন ক্যাশ লোড করতে প্রথমবার ইন্টারনেট সংযোগ চালু অবস্থায় অ্যাপটি একবার ওপেন করুন।</p>
    <button onclick="location.reload()" style="width:100%;height:44px;border:none;border-radius:14px;background:#10b981;color:#020617;font-weight:700;font-size:14px;cursor:pointer;">পুনরায় চেষ্টা করুন</button>
  </div>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Never intercept backend APIs, Auth handlers, or Firebase endpoints
  if (url.origin === self.location.origin && (url.pathname.startsWith('/api/') || url.pathname.startsWith('/__/'))) {
    return;
  }
  if (BYPASS_ORIGINS.some((host) => url.hostname === host || url.hostname.endsWith('.' + host))) {
    return;
  }

  // Google Fonts: CacheFirst + clean empty CSS fallback offline
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      (async () => {
        const fontCache = await caches.open(FONT_CACHE);
        const cached = await fontCache.match(request);
        if (cached) return cached;
        try {
          const res = await fetchWithTimeout(request, 5000);
          if (res && (res.ok || res.type === 'opaque')) {
            await fontCache.put(request, res.clone());
          }
          return res;
        } catch {
          if (url.hostname === 'fonts.googleapis.com') {
            return new Response('', { status: 200, headers: { 'Content-Type': 'text/css' } });
          }
          return Response.error();
        }
      })()
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Navigation requests (HTML shell): NetworkFirst with no-store + generous timeout so installed PWAs never stay on old shells
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cachedNav =
          (await cache.match(request)) ||
          (await cache.match(request, { ignoreSearch: true })) ||
          (await cache.match('/')) ||
          (await cache.match('/index.html'));
        try {
          const netRes = await fetchWithTimeout(request, cachedNav ? 6000 : 14000, true);
          if (netRes && netRes.ok) {
            const ct = (netRes.headers.get('content-type') || '').toLowerCase();
            if (ct.includes('text/html')) {
              await cache.put(request, netRes.clone());
              await cache.put('/', netRes.clone());
              await cache.put('/index.html', netRes.clone());
            }
          }
          return netRes;
        } catch {
          return cachedNav || offlineFallbackPage();
        }
      })()
    );
    return;
  }

  // Same-origin JS/CSS/TSX/SVG/PNG/JSON assets
  // NEVER fall back to '/' HTML for JS/CSS modules
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const exactCached = await cache.match(request);

      const isImmutableOrStatic =
        url.pathname.startsWith('/assets/') ||
        url.pathname.startsWith('/pdfjs/') ||
        url.pathname.startsWith('/node_modules/.vite/deps/') ||
        url.pathname.startsWith('/icon') ||
        url.pathname.startsWith('/maskable') ||
        url.pathname.startsWith('/apple-touch-icon') ||
        url.pathname === '/plyr.svg' ||
        url.pathname === '/pdf.worker.min.mjs' ||
        url.pathname === '/favicon.svg';

      if (isImmutableOrStatic && exactCached) {
        fetch(request)
          .then((fresh) => {
            if (fresh && fresh.ok) {
              cache.put(request, fresh.clone());
            }
          })
          .catch(() => {});
        return exactCached;
      }

      try {
        const netRes = await fetchWithTimeout(request, exactCached ? 6000 : 15000, true);
        if (netRes && netRes.ok) {
          await cache.put(request, netRes.clone());
        }
        return netRes;
      } catch {
        if (exactCached) return exactCached;
        const looseCached = await cache.match(request, { ignoreSearch: true });
        if (looseCached) return looseCached;
        return Response.error();
      }
    })()
  );
});
