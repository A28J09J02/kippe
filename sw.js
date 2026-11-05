// Offline support: the game shell is cached on install; fonts are cached the first time they load.
// Bump VERSION with every release so installed apps pick up the new files.
const VERSION="kippe-v10";
const SHELL=["./","./index.html","./manifest.webmanifest","./icons/icon-192.png","./icons/icon-512.png","./icons/icon-maskable-512.png","./icons/apple-touch-icon.png","./icons/favicon.png"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(VERSION).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener("fetch",e=>{
  const req=e.request;if(req.method!=="GET")return;
  const url=new URL(req.url);
  // the page itself: network first, so updates arrive; cached copy when offline
  if(req.mode==="navigate"){
    e.respondWith(fetch(req,{cache:"no-store"}).then(r=>{const cp=r.clone();caches.open(VERSION).then(c=>c.put("./index.html",cp));return r;}).catch(()=>caches.match("./index.html")));
    return;
  }
  // same-origin files and Google Fonts: cache first
  if(url.origin===location.origin||url.host==="fonts.googleapis.com"||url.host==="fonts.gstatic.com"){
    e.respondWith(caches.match(req).then(hit=>hit||fetch(req).then(r=>{if(r.ok||r.type==="opaque"){const cp=r.clone();caches.open(VERSION).then(c=>c.put(req,cp));}return r;})));
  }
});
