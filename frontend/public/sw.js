// Service Worker mínimo para habilitar instalação como PWA no celular (sem travar cache da API)
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Nunca intercepta requisições da API — sempre vai direto para a rede
  if (event.request.url.includes('/api/')) return;
  event.respondWith(fetch(event.request));
});
