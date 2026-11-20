const prefix = 'recipe-book:' + self.registration.scope + ':';
const cacheName = prefix + '2';
const files = ['./','./index.html','./style.css','./recipes.js','./app.js','./manifest.webmanifest','./blini.jpg','./apple-touch-icon.png','./icon-192.png','./icon-512.png'];
const urls = new Set(files.map(path => new URL(path,self.registration.scope).href));
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(cacheName).then(cache=>cache.addAll(files.map(path=>new Request(path,{cache:'reload'})))).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith(prefix) && k!==cacheName).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET') return;
  const url=new URL(event.request.url); url.search='';
  if(!urls.has(url.href)) return;
  event.respondWith(caches.open(cacheName).then(async cache=>await cache.match(url.href) || fetch(event.request)));
});
