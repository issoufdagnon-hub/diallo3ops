// sw.js : Service Worker. Met l'application en cache pour un fonctionnement sans Internet.
// Pour publier une nouvelle version de l'application, augmenter le numéro de CACHE.
const CACHE = 'diallo3ops-v1';
const COQUILLE = ['./', './index.html', './manifest.webmanifest', './icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(COQUILLE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((noms) => Promise.all(noms.filter((nom) => nom !== CACHE).map((nom) => caches.delete(nom))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const requete = event.request;
  if (requete.method !== 'GET') return;
  if (new URL(requete.url).origin !== self.location.origin) return;

  event.respondWith((async () => {
    const enCache = await caches.match(requete, { ignoreSearch: true });
    if (enCache) return enCache;
    try {
      const reponse = await fetch(requete);
      if (reponse.ok) {
        const cache = await caches.open(CACHE);
        cache.put(requete, reponse.clone());
      }
      return reponse;
    } catch {
      if (requete.mode === 'navigate') {
        const accueil = await caches.match('./index.html');
        if (accueil) return accueil;
      }
      return Response.error();
    }
  })());
});
