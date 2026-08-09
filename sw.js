const CACHE_NAME = 'astra-static-v20260809v804FutureEvidenceP0';
const APP_SHELL = [
  './',
  './index.html',
  './shared/js/lucide.min.js?v=20260417d',
  './shared/js/config.js?v=20260716v7427RoleWorkflowGateP0',
  './shared/js/api-client.js?v=20260719v7437AstraWorkspaceP0',
  './shared/js/auth-ui.js?v=20260716v7427RoleWorkflowGateP0',
  './shared/js/app-session.js?v=20260809v804FutureEvidenceP0',
  './shared/js/experiment-registry.js?v=20260716v7427RoleWorkflowGateP0',
  './shared/js/page-registry.js?v=20260809v804FutureEvidenceP0',
  './shared/js/router.js?v=20260809v804FutureEvidenceP0',
  './shared/js/main.js?v=20260809v804FutureEvidenceP0',
  './shared/js/backend-content.js?v=20260716v7427RoleWorkflowGateP0',
  './shared/css/tokens.css?v=20260424ss',
  './shared/css/base.css?v=20260719v758ReleaseAuditP0',
  './shared/css/typography.css?v=20260526v61c',
  './shared/css/navbar.css?v=20260731v7969StudentUiP0',
  './shared/css/page-layout.css?v=20260731v7969StudentUiP0',
  './shared/css/backend-content.css?v=20260716v7427RoleWorkflowGateP0',
  './shared/css/auth-ui.css?v=20260716v7427RoleWorkflowGateP0',
  './shared/css/app-session.css?v=20260719v759A11yP0',
  './shared/css/responsive.css?v=20260716v7427RoleWorkflowGateP0',
  './pages/planets/planets.css?v=20260731v7969StudentUiP0',
  './pages/planets/planets.js?v=20260731v7969StudentUiP0',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
      .catch(async (error) => {
        await caches.delete(CACHE_NAME);
        throw error;
      })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key.startsWith('astra-static-') && key !== CACHE_NAME).map((key) => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API responses, sandbox documents and API-shaped assets are always network-only.
  // Let the browser honor backend no-store headers; never provide CacheStorage fallback.
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return;

  // Role workspaces are selected only after the server session is known. Keep these
  // assets out of the shared runtime cache so logout/role changes cannot race cache.put.
  const isRoleResource = /^\/pages\/(?:student|teacher|admin)\/[^/]+\.(?:js|css)$/.test(url.pathname);
  if (isRoleResource) {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  const publicPath = url.pathname === '/'
    || url.pathname === '/index.html'
    || url.pathname === '/sw.js'
    || /^\/(?:pages|shared|UI|codevis)(?:\/|$)/.test(url.pathname);
  if (!publicPath) {
    event.respondWith(new Response('Not Found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    }));
    return;
  }

  // SPA navigation: network first, cache fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            const cache = await caches.open(CACHE_NAME);
            await cache.put(request, clone);
          }
          return response;
        })
        .catch(async () => {
          const isCodevisNav = /\/codevis\/(?:index\.html)?$/.test(url.pathname);
          const cache = await caches.open(CACHE_NAME);
          const fallbacks = isCodevisNav
            ? [request, './codevis/', './codevis/index.html', './index.html']
            : [request, './', './index.html'];

          for (const fallback of fallbacks) {
            const cached = await cache.match(fallback);
            if (cached) return cached;
          }

          return new Response('Offline', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
        })
    );
    return;
  }

  const isStaticAsset = /\.(?:js|css|png|jpg|jpeg|svg|webp|gif|ico|woff2?)$/i.test(url.pathname);
  if (!isStaticAsset) return;

  const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
  const isVersionedAsset = url.searchParams.has('v');

  // Versioned local/dev assets stay network-first to avoid stale JS after edits.
  if (isLocalhost || isVersionedAsset) {
    event.respondWith(
      fetch(request, { cache: 'reload' })
        .then(async (response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            const cache = await caches.open(CACHE_NAME);
            await cache.put(request, clone);
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Stale-while-revalidate for unversioned production static assets.
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetchPromise = fetch(request)
        .then(async (response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            const cache = await caches.open(CACHE_NAME);
            await cache.put(request, clone);
          }
          return response;
        })
        .catch(() => cached);

      return cached || fetchPromise;
    })
  );
});
