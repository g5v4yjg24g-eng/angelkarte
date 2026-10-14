const APP='angelkarte-app-v1',TILES='angelkarte-tiles-v1',MAXTILES=3000;
const CDN=['https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css','https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js','https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/MarkerCluster.css','https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/MarkerCluster.Default.css','https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/leaflet.markercluster.js'];
const LOCAL=['./','index.html','manifest.json','icon-192.png','icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil((async()=>{const c=await caches.open(APP);await Promise.allSettled([...LOCAL,...CDN].map(u=>c.add(u)));self.skipWaiting()})())});
self.addEventListener('activate',e=>{e.waitUntil((async()=>{for(const k of await caches.keys())if(![APP,TILES].includes(k))await caches.delete(k);await clients.claim()})())});
async function tile(req){
 const c=await caches.open(TILES),hit=await c.match(req.url);if(hit)return hit;
 const res=await fetch(req.url,{mode:'cors'});
 if(res.ok){await c.put(req.url,res.clone());const ks=await c.keys();if(ks.length>MAXTILES)for(const k of ks.slice(0,ks.length-MAXTILES))await c.delete(k)}
 return res}
self.addEventListener('fetch',e=>{
 const r=e.request;if(r.method!=='GET')return;const u=new URL(r.url);
 if(u.hostname.endsWith('tile.openstreetmap.org'))return e.respondWith(tile(r).catch(()=>Response.error()));
 if(u.origin===location.origin)return e.respondWith(fetch(r).then(res=>{if(res.ok)caches.open(APP).then(c=>c.put(r,res.clone()));return res}).catch(()=>caches.match(r,{ignoreSearch:true}).then(h=>h||caches.match('index.html'))));
 if(u.hostname==='cdnjs.cloudflare.com')return e.respondWith(caches.match(r).then(h=>h||fetch(r)));
});
