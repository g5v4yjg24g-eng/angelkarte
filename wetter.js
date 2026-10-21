/* Wetter & Beißfenster – erfasst Wetter (Open-Meteo) für Sessions und Fischkontakte und wertet die eigenen Daten aus.
   Wetter wird nur lokal an den bestehenden Datensätzen gespeichert: entries[].wx, sessions[].wx (laufende Session: meta 'active').
   Abrufe nur, solange die App offen ist (kein Hintergrund-Abruf – iOS hält Web-Apps an); Lücken werden beim Öffnen nachgeladen.
   Wetterdaten: Open-Meteo.com, CC BY 4.0. Alle Werte sind Modellwerte für die Seekoordinaten, keine Messungen am See. */
(()=>{
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const H=36e5,MIN=6e4;

/* ---------- Standorte (OpenStreetMap, Mittelpunkt der Seefläche) ---------- */
const LAKE={gross:{name:'Großer De Wittsee',lat:51.32655,lng:6.24145,osm:'way/35044256'},klein:{name:'Kleiner De Wittsee',lat:51.31864,lng:6.24611,osm:'way/27634541'}};
const lakeKey=n=>/klein/i.test(n||'')?'klein':'gross';

/* ---------- Open-Meteo ---------- */
// Reihenfolge von VARS und KEYS muss übereinstimmen
const VARS='temperature_2m,apparent_temperature,relative_humidity_2m,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover,precipitation,weather_code,is_day';
const KEYS=['temp','feels','rh','p','ws','wd','gust','cloud','precip','code','day'];
const API={forecast:'https://api.open-meteo.com/v1/forecast',historisch:'https://historical-forecast-api.open-meteo.com/v1/forecast',archiv:'https://archive-api.open-meteo.com/v1/archive'};
const API_LABEL={forecast:'Open-Meteo Forecast-API',historisch:'Open-Meteo Historical-Forecast-API',archiv:'Open-Meteo Archiv (ERA5-Reanalyse)'};
const NOW_TTL=10*MIN,LIVE_EVERY=30*MIN,FORECAST_PAST_DAYS=90;
/* Trendgrenzen (App-Festlegung, angelehnt an die 3-stündige Luftdrucktendenz der Wetterbeobachtung; keine Aussage über „gute“ Beißbedingungen):
   Δ 3 h ≥ +1,0 hPa = steigend, ≤ −1,0 hPa = fallend, dazwischen = weitgehend stabil. Dieselbe Grenze nutzt die App schon für das Feld „Luftdruck-Trend“. */
const TREND=1.0;
const trendOf=d=>d==null?null:d>=TREND?'steigend':d<=-TREND?'fallend':'stabil';
const TREND_L={steigend:'steigend',stabil:'weitgehend stabil',fallend:'fallend'};
/* Mindestdaten für Vergleiche (App-Festlegung) */
const MIN_H=3,MIN_SESS=2,MIN_ALL_SESS=5,MIN_ALL_CON=10,MIN_CMP=3;

let backoff=0,busy=false,hoursCache=null,nowCache=null;
const tried=new Set(),failed=new Set(); // failed: Einträge, deren Wetter beim Anlegen nicht abrufbar war
const fmt=(x,d=0)=>x==null||!isFinite(x)?'–':Number(x).toLocaleString('de-DE',{minimumFractionDigits:d,maximumFractionDigits:d,useGrouping:false});
const sgn=(x,d=1)=>x==null?'–':(x>0?'+':x<0?'−':'±')+fmt(Math.abs(x),d);
const dirs=['N','NO','O','SO','S','SW','W','NW'],dirOf=deg=>deg==null?null:dirs[Math.round(((deg%360)+360)%360/45)%8];
const bft=k=>k==null?null:Math.min(12,Math.round(Math.pow(k/3.6/.836,2/3)));
const tzp=new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit',hourCycle:'h23'});
const tStr=ms=>tzp.format(ms).replace(',','');
const hm=ms=>new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(ms);
const bHour=ms=>+new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Berlin',hour:'2-digit',hourCycle:'h23'}).format(ms);
const bMonth=ms=>+new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Berlin',month:'numeric'}).format(ms);
const utcDay=ms=>new Date(ms).toISOString().slice(0,10);
const WMO=c=>c==null?null:c===0?['klar','☀️']:c<=2?[c===1?'überwiegend klar':'teilweise bewölkt','⛅']:c===3?['bedeckt','☁️']:c<=48?['Nebel','🌫️']:c<=57?['Nieselregen','🌦️']:c<=67?['Regen','🌧️']:c<=77?['Schnee','🌨️']:c<=82?['Regenschauer','🌦️']:c<=86?['Schneeschauer','🌨️']:['Gewitter','⛈️'];
// Ereigniszeit: exakter Erstellungszeitpunkt, wenn er zu Datum/Uhrzeit des Eintrags passt (Gerätezeit), sonst Datum/Uhrzeit als Ortszeit Europe/Berlin
const localStamp=ms=>{const d=new Date(ms),p=n=>String(n).padStart(2,'0');return`${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`};
const entryMs=e=>{if(e.created&&e.date&&e.time&&localStamp(e.created)===e.date+' '+e.time)return e.created;return window.AngelCal&&e.date&&e.time?AngelCal.berlinMs(e.date,e.time):e.created||null};

async function getJSON(url){
 if(Date.now()<backoff)throw Error('Abruflimit von Open-Meteo erreicht – später erneut versuchen.');
 if(!navigator.onLine)throw Error('Keine Internetverbindung.');
 const c=new AbortController(),to=setTimeout(()=>c.abort(),20000);
 let r;try{r=await fetch(url,{signal:c.signal,cache:'no-store'})}catch(e){throw Error(c.signal.aborted?'Zeitüberschreitung beim Wetterdienst.':'Wetterdienst nicht erreichbar.')}finally{clearTimeout(to)}
 let j=null;try{j=await r.json()}catch(e){}
 if(r.status===429){backoff=Date.now()+H;throw Error('Abruflimit von Open-Meteo erreicht – später erneut versuchen.')}
 if(!r.ok||!j||j.error)throw Error('Wetterdienst meldet einen Fehler'+(j&&j.reason?': '+j.reason:` (${r.status})`)+'.');
 return j}
const q=(lake,extra)=>`latitude=${LAKE[lake].lat}&longitude=${LAKE[lake].lng}&timezone=GMT&timeformat=unixtime&wind_speed_unit=kmh&${extra}`;
const toRecs=(h,src)=>!h||!h.time?[]:h.time.map((t,i)=>{const o={t:t*1000};KEYS.forEach((k,j)=>{const v=h[VARS.split(',')[j]]?.[i];o[k]=v==null?null:v});return o});

/* ---------- Stündlicher Cache (meta 'wxHours'): je See und UTC-Tag die Stundenwerte + Abrufzeit ---------- */
async function loadHours(){if(!hoursCache){try{hoursCache=(await dbx('meta','readonly',s=>s.get('wxHours')))||{}}catch(e){hoursCache={}}}hoursCache.gross??={};hoursCache.klein??={};return hoursCache}
async function saveHours(){const keep=utcDay(Date.now()-150*864e5);for(const l of['gross','klein'])for(const d of Object.keys(hoursCache[l]))if(d<keep)delete hoursCache[l][d];try{await dbx('meta','readwrite',s=>s.put(hoursCache,'wxHours'))}catch(e){}}
function putHours(lake,recs,api,qt){const by={};for(const r of recs){(by[utcDay(r.t)]??=[]).push(r)}
 for(const[d,a]of Object.entries(by)){const old=hoursCache[lake][d],m=new Map((old?.h||[]).map(r=>[r.t,r]));a.forEach(r=>{if(r.t<=qt)m.set(r.t,r)});hoursCache[lake][d]={q:qt,api,h:[...m.values()].sort((x,y)=>x.t-y.t)}}}
const dayList=(from,to)=>{const o=[];for(let t=Date.parse(utcDay(from));t<=to;t+=864e5)o.push(utcDay(t));return o};
// Lädt fehlende Stundenwerte für [from,to] (inkl. 24 h davor für Trends) in möglichst wenigen Abrufen
async function ensureHours(lake,from,to){await loadHours();to=Math.min(to,Date.now());
 const need=dayList(from-25*H,to).filter(d=>{const c=hoursCache[lake][d],end=Math.min(Date.parse(d)+864e5-H,to);return!c||c.q<end});
 if(!need.length)return;
 const today=Date.parse(utcDay(Date.now())),groups=[];
 for(const d of need){const kind=Date.parse(d)>=today-FORECAST_PAST_DAYS*864e5?'forecast':d<'2022-01-01'?'archiv':'historisch',g=groups.at(-1);
  if(g&&g.kind===kind&&Date.parse(d)-Date.parse(g.to)===864e5&&g.n<31){g.to=d;g.n++}else groups.push({kind,from:d,to:d,n:1})}
 let err=null;
 for(const g of groups){const qt=Date.now();
  try{const j=await getJSON(`${API[g.kind]}?${q(lake,`hourly=${VARS}&start_date=${g.from}&end_date=${g.to}`)}`);putHours(lake,toRecs(j.hourly),g.kind,qt)}
  catch(e){if(g.kind==='historisch'){try{const j=await getJSON(`${API.archiv}?${q(lake,`hourly=${VARS}&start_date=${g.from}&end_date=${g.to}`)}`);putHours(lake,toRecs(j.hourly),'archiv',qt);continue}catch(e2){}}err=e}}
 await saveHours();if(err)throw err}
function hoursIn(lake,from,to){const out=[];if(!hoursCache)return out;for(const d of dayList(from,to))for(const r of hoursCache[lake][d]?.h||[])if(r.t>=from&&r.t<=to)out.push(r);return out}
const apiOf=(lake,t)=>hoursCache?.[lake]?.[utcDay(t)]?.api||'forecast';

/* ---------- Wert zu einem Zeitpunkt aus Stundenreihe (lineare Interpolation, nie extrapoliert) ---------- */
function valAt(series,t,k){let a=null,b=null;for(const r of series){if(r[k]==null)continue;if(r.t<=t&&(!a||r.t>a.t))a=r;if(r.t>=t&&(!b||r.t<b.t))b=r}
 if(!a||!b||b.t-a.t>2*H)return a&&a.t===t?a[k]:b&&b.t===t?b[k]:null;if(a.t===b.t)return a[k];return a[k]+(b[k]-a[k])*(t-a.t)/(b.t-a.t)}
function nearest(series,t,k,maxD=H){let best=null;for(const r of series)if(r[k]!=null&&Math.abs(r.t-t)<=maxD&&(!best||Math.abs(r.t-t)<Math.abs(best.t-t)))best=r;return best?best[k]:null}
function withTrend(rec,series){const p=rec.p??valAt(series,rec.t,'p');const d=n=>{const p0=valAt(series,rec.t-n*H,'p');return p==null||p0==null?null:Math.round((p-p0)*10)/10};
 return{...rec,p,dp3:d(3),dp6:d(6),dp12:d(12),dp24:d(24),trend:trendOf(d(3))}}
function recAt(series,t){if(!series.length)return null;const r={t};
 for(const k of['temp','feels','rh','p','ws','gust','cloud'])r[k]=valAt(series,t,k);for(const k of['wd','code','day'])r[k]=nearest(series,t,k);
 r.precip=nearest(series,Math.ceil(t/H)*H,'precip',0);if(r.temp==null&&r.p==null)return null;
 for(const k of['temp','feels','p','ws','gust'])if(r[k]!=null)r[k]=Math.round(r[k]*10)/10;for(const k of['rh','cloud'])if(r[k]!=null)r[k]=Math.round(r[k]);return withTrend(r,series)}

/* ---------- Aktuelles Wetter (ein Abruf liefert aktuell + 48 h Verlauf + 48 h Vorhersage + Sonnenzeiten) ---------- */
async function getNow(lake,force){
 if(!nowCache){try{nowCache=(await dbx('meta','readonly',s=>s.get('wxNow')))||{}}catch(e){nowCache={}}}
 const c=nowCache[lake];if(c&&!force&&Date.now()-c.q<NOW_TTL)return c;
 const qt=Date.now(),j=await getJSON(`${API.forecast}?${q(lake,`current=${VARS}&hourly=${VARS}&daily=sunrise,sunset&past_days=2&forecast_days=3`)}`);
 const hours=toRecs(j.hourly),cur={t:j.current.time*1000};KEYS.forEach((k,i)=>{const v=j.current[VARS.split(',')[i]];cur[k]=v==null?null:v});
 const d={q:qt,lake,cur:{...withTrend(cur,hours),src:'aktuell',api:'forecast',q:qt,lake},hours,sun:(j.daily?.time||[]).map((t,i)=>[j.daily.sunrise[i]*1000,j.daily.sunset[i]*1000])};
 nowCache[lake]=d;try{await dbx('meta','readwrite',s=>s.put(nowCache,'wxNow'))}catch(e){}
 await loadHours();putHours(lake,hours,'forecast',qt);await saveHours();return d}
const cachedNow=async lake=>{if(!nowCache){try{nowCache=(await dbx('meta','readonly',s=>s.get('wxNow')))||{}}catch(e){nowCache={}}}return nowCache[lake]||null};

/* ---------- Sonnenauf-/untergang (astronomisch berechnet, offline; Grundlage für „Lichtverhältnisse“) ---------- */
function sunTimes(ms,lat=LAKE.gross.lat,lng=LAKE.gross.lng){const r=Math.PI/180,day=Date.parse(utcDay(ms)),n=Math.ceil(day/864e5+2440587.5-2451545+.0008),Js=n-lng/360;
 const M=(357.5291+.98560028*Js)%360,C=1.9148*Math.sin(M*r)+.02*Math.sin(2*M*r)+.0003*Math.sin(3*M*r),lam=(M+C+282.9372)%360;
 const Jt=2451545+Js+.0053*Math.sin(M*r)-.0069*Math.sin(2*lam*r),dec=Math.asin(Math.sin(lam*r)*Math.sin(23.4397*r));
 const w=Math.acos((Math.sin(-.833*r)-Math.sin(lat*r)*Math.sin(dec))/(Math.cos(lat*r)*Math.cos(dec)))/r;
 return{rise:(Jt-w/360-2440587.5)*864e5,set:(Jt+w/360-2440587.5)*864e5}}
// Lichtverhältnisse (App-Festlegung): ±1 h um Sonnenaufgang/-untergang = Dämmerung
function lightOf(t){const s=sunTimes(t);return Math.abs(t-s.rise)<=H?'Morgendämmerung':Math.abs(t-s.set)<=H?'Abenddämmerung':t>s.rise&&t<s.set?'Tag':'Nacht'}

/* ---------- Fischkontakte: Wetter zum Zeitpunkt speichern (nie bestehende Werte überschreiben) ---------- */
async function attachEntry(e){const t=entryMs(e);if(!t||e.wx)return false;const lake=lakeKey(e.lake);let rec=null;
 const fresh=Date.now()-t<45*MIN&&Date.now()-(e.created||0)<45*MIN&&t<=Date.now()+5*MIN;
 if(fresh){const n=await getNow(lake);const late=failed.has(e.id)||Date.now()-(e.created||t)>2*MIN; // erst später (z. B. nach Offline-Phase) zugeordnet
  rec=Math.abs(n.cur.t-t)<=20*MIN?{...n.cur,late}:(()=>{const r=recAt(n.hours.filter(x=>x.t<=n.q),t);return r&&{...r,src:'modell',api:'forecast',q:n.q,lake,late}})()}
 else{await ensureHours(lake,t-H,t+H);const r=recAt(hoursIn(lake,t-26*H,t+2*H),t);rec=r&&{...r,src:'modell',api:apiOf(lake,t),q:Date.now(),lake,late:true}}
 if(!rec)return false;
 const cur=await dbx('entries','readonly',s=>s.get(e.id));if(!cur||cur.wx)return false;
 await dbx('entries','readwrite',s=>s.put({...cur,wx:rec}));const m=entries.find(x=>x.id===e.id);if(m)m.wx=rec;return true} // nur im Speicher nachziehen, Karte nicht neu aufbauen

/* ---------- Sessions ---------- */
const sessLake=x=>{if(x.wx?.lake)return x.wx.lake;if(x.lake)return lakeKey(x.lake);const c={};entries.filter(e=>e.sessionId===x.id&&e.lake).forEach(e=>c[e.lake]=(c[e.lake]||0)+1);return lakeKey(Object.keys(c).sort((a,b)=>c[b]-c[a])[0]||'')};
async function saveActive(){if(curSess)await dbx('meta','readwrite',s=>s.put(curSess,'active'))}
async function onSessionStart(){const s=curSess;if(!s)return;s.wx??={lake:sessLake(s),live:[]};await saveActive();
 try{const n=await getNow(s.wx.lake);if(curSess!==s)return;if(Math.abs(n.cur.t-s.start)<=20*MIN)s.wx.start=n.cur;addLive(s,n.cur);await saveActive()}catch(e){}}
function addLive(s,rec){s.wx.live??=[];if(!s.wx.live.some(r=>r.t===rec.t))s.wx.live.push(rec)}
async function liveTick(force){const s=curSess;if(!s||document.visibilityState!=='visible'||!navigator.onLine)return;s.wx??={lake:sessLake(s),live:[]};
 const last=s.wx.live?.at(-1);if(!force&&last&&Date.now()-last.q<LIVE_EVERY)return;
 try{const n=await getNow(s.wx.lake,force);if(curSess!==s)return;s.wx.start??=Math.abs(n.cur.t-s.start)<=20*MIN?n.cur:undefined;addLive(s,n.cur);await saveActive();if(isOn())renderAll()}catch(e){}}
async function onSessionEnd(id){try{await finalize(id,true)}catch(e){}afterChange()}
function afterChange(){if(isOn())renderAll();if(window.calRefresh)calRefresh()}
// Stundenreihe für die Session laden, Zusammenfassung berechnen, an der Session speichern
async function finalize(id,ending){const x=await dbx('sessions','readonly',s=>s.get(id));if(!x||!x.end)return false;const lake=sessLake(x),wx={lake,live:[],...(x.wx||{})};
 if(ending){try{const n=await getNow(lake);if(Math.abs(n.cur.t-x.end)<=20*MIN){wx.end=n.cur;if(!wx.live.some(r=>r.t===n.cur.t))wx.live.push(n.cur)}}catch(e){}}
 await ensureHours(lake,x.start-H,x.end+H);
 const all=hoursIn(lake,x.start-26*H,x.end+2*H),ser=all.filter(r=>r.t>=Math.floor(x.start/H)*H&&r.t<=Math.ceil(x.end/H)*H).map(r=>({...withTrend(r,all),api:apiOf(lake,r.t)}));
 wx.series=ser;wx.checked=Date.now();wx.late=!ending||!!wx.late;
 if(!wx.start){const r=recAt(all,x.start);if(r)wx.startModel={...r,src:'modell',api:apiOf(lake,x.start),late:true}}
 if(!wx.end){const r=recAt(all,x.end);if(r)wx.endModel={...r,src:'modell',api:apiOf(lake,x.end),late:!ending}}
 wx.sum=summarize({...x,wx});
 const cur=await dbx('sessions','readonly',s=>s.get(id));if(!cur)return false;
 const nx={...cur,wx:{...(cur.wx||{}),...wx}};await dbx('sessions','readwrite',s=>s.put(nx));const i=sessions.findIndex(z=>z.id===id);if(i>=0)sessions[i]=nx;else sessions.push(nx);return true}
function summarize(x){const ser=x.wx?.series||[],a=Math.floor(x.start/H)*H,b=Math.ceil(x.end/H)*H,exp=Math.round((b-a)/H)+1;
 const pts=ser.filter(r=>r.t>=a&&r.t<=b&&(r.p!=null||r.temp!=null)),v=k=>pts.map(r=>r[k]).filter(z=>z!=null),avg=z=>z.length?z.reduce((s,y)=>s+y,0)/z.length:null;
 const T=v('temp'),W=v('ws'),P=v('p'),G=v('gust'),C=v('cloud'),dc={};pts.forEach(r=>{if(r.ws>=2&&r.wd!=null){const d=dirOf(r.wd);dc[d]=(dc[d]||0)+1}});
 const p0=valAt(ser,x.start,'p'),p1=valAt(ser,x.end,'p');let rain=null;
 if(pts.some(r=>r.precip!=null)){rain=0;for(const r of ser){if(r.precip==null)continue;const ov=Math.max(0,Math.min(r.t,x.end)-Math.max(r.t-H,x.start));rain+=r.precip*ov/H}rain=Math.round(rain*10)/10}
 return{dur:x.end-x.start,exp,got:pts.length,complete:pts.length>=exp,live:(x.wx?.live||[]).length,tAvg:avg(T),tMin:T.length?Math.min(...T):null,tMax:T.length?Math.max(...T):null,
  wAvg:avg(W),gMax:G.length?Math.max(...G):null,dir:Object.keys(dc).sort((m,n)=>dc[n]-dc[m])[0]||null,pAvg:avg(P),dp:p0!=null&&p1!=null?Math.round((p1-p0)*10)/10:null,rain,cAvg:avg(C),
  trend0:(x.wx?.start||x.wx?.startModel)?.trend||null}}

/* ---------- Nachprüfung beim Öffnen / bei Verbindung ---------- */
async function backfill(){if(!navigator.onLine||Date.now()<backoff)entries.forEach(e=>{if(!e.wx)failed.add(e.id)});if(busy||!navigator.onLine||Date.now()<backoff||!window.AngelCal)return;busy=true;let changed=false;
 try{
  for(const x of sessions.filter(s=>s.end&&!tried.has('s'+s.id)&&(!s.wx?.series||!s.wx.sum?.complete&&Date.now()-(s.wx.checked||0)>6*H&&Date.now()-s.end<14*864e5)).slice(0,20)){tried.add('s'+x.id);try{changed=await finalize(x.id,false)||changed}catch(e){}}
  const todo=entries.filter(e=>!e.wx&&!tried.has('e'+e.id)&&entryMs(e)).slice(0,60);
  for(const e of todo){tried.add('e'+e.id);try{changed=await attachEntry(e)||changed}catch(er){failed.add(e.id)}}
 }finally{busy=false}
 if(changed)afterChange()}
let started=false;
window.wxRefresh=()=>{if(!started){started=true;setTimeout(backfill,1500)}else if(entries.some(e=>!e.wx&&!tried.has('e'+e.id)))setTimeout(backfill,300);if(isOn())renderAll()};
addEventListener('online',()=>{tried.clear();backfill();if(isOn())refreshNow()});addEventListener('offline',()=>{if(isOn())renderAll()});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){liveTick();if(started)backfill()}});
setInterval(()=>liveTick(),60e3);

/* ---------- Auswertung ---------- */
const CON=e=>e.result&&e.result!=='seen',CAUGHT=e=>e.result==='caught';
const BLOCK=h=>{const a=Math.floor(h/3)*3;return`${String(a).padStart(2,'0')}–${String(a+3).padStart(2,'0')} Uhr`};
const SEASON=m=>m>=3&&m<=5?'Frühling':m>=6&&m<=8?'Sommer':m>=9&&m<=11?'Herbst':'Winter';
const bin=(v,edges,lab)=>{if(v==null)return null;for(let i=0;i<edges.length;i++)if(v<edges[i])return lab[i];return lab.at(-1)};
const FACT=[
 {k:'block',n:'Tageszeit',o:[0,3,6,9,12,15,18,21].map(BLOCK),f:(t)=>BLOCK(bHour(t)),time:1},
 {k:'light',n:'Lichtverhältnisse',o:['Morgendämmerung','Tag','Abenddämmerung','Nacht'],f:t=>lightOf(t),time:1},
 {k:'season',n:'Jahreszeit',o:['Frühling','Sommer','Herbst','Winter'],f:t=>SEASON(bMonth(t)),time:1},
 {k:'pbin',n:'Luftdruck (Meereshöhe)',o:['unter 1000 hPa','1000–1005 hPa','1005–1010 hPa','1010–1015 hPa','1015–1020 hPa','1020–1025 hPa','ab 1025 hPa'],f:(t,r)=>bin(r?.p,[1000,1005,1010,1015,1020,1025],['unter 1000 hPa','1000–1005 hPa','1005–1010 hPa','1010–1015 hPa','1015–1020 hPa','1020–1025 hPa','ab 1025 hPa'])},
 {k:'trend',n:'Luftdrucktrend (3 h)',o:['fallend','weitgehend stabil','steigend'],f:(t,r)=>r?.trend?TREND_L[r.trend]:null},
 {k:'wdir',n:'Windrichtung',o:[...dirs,'windstill'],f:(t,r)=>r?.ws==null?null:r.ws<2?'windstill':dirOf(r.wd)},
 {k:'wspd',n:'Windstärke',o:['unter 10 km/h','10–20 km/h','20–30 km/h','ab 30 km/h'],f:(t,r)=>bin(r?.ws,[10,20,30],['unter 10 km/h','10–20 km/h','20–30 km/h','ab 30 km/h'])},
 {k:'temp',n:'Lufttemperatur',o:['unter 5 °C','5–10 °C','10–15 °C','15–20 °C','20–25 °C','ab 25 °C'],f:(t,r)=>bin(r?.temp,[5,10,15,20,25],['unter 5 °C','5–10 °C','10–15 °C','15–20 °C','20–25 °C','ab 25 °C'])},
 {k:'cloud',n:'Bewölkung',o:['0–25 %','25–50 %','50–75 %','75–100 %'],f:(t,r)=>bin(r?.cloud,[25,50,75],['0–25 %','25–50 %','50–75 %','75–100 %'])},
 {k:'rain',n:'Niederschlag',o:['trocken','Niederschlag'],f:(t,r)=>r?.precip==null?null:r.precip>0?'Niederschlag':'trocken'}];
// P(X ≥ k) bzw. P(X ≤ k) für Poisson(λ)
function pois(k,l,upper){let p=Math.exp(-l),c=p;for(let i=1;i<=k;i++){p*=l/i;c+=p}const le=Math.min(1,c),lt=Math.max(0,le-p);return upper?1-lt:le}
// Session in Stundenabschnitte zerlegen; jedem Abschnitt das Wetter zu seiner Mitte zuordnen
function slices(x){const out=[],ser=x.wx?.series||[];for(let a=Math.floor(x.start/H)*H;a<x.end;a+=H){const s=Math.max(a,x.start),e=Math.min(a+H,x.end);if(e<=s)continue;const m=(s+e)/2;out.push({t:m,h:(e-s)/H,r:ser.length?recAt(ser,m):null})}return out}

function filterSet(F){const now=Date.now(),from=F.from!=null?F.from:F.per==='all'?0:F.per==='year'?Date.parse(new Date().getFullYear()+'-01-01'):now-(+F.per)*864e5,to=F.to??Infinity; // from/to (ms) optional, z. B. aus dem Statistik-Reiter
 const okL=l=>F.lake==='all'||lakeKey(l)===F.lake&&!!l;
 const S=sessions.filter(x=>x.end&&x.start>=from&&x.start<to&&(F.lake==='all'||sessLake(x)===F.lake));
 const E=entries.filter(e=>{const t=entryMs(e);return t&&t>=from&&t<to&&(F.lake==='all'||okL(e.lake))&&(F.sp==='all'||e.species===F.sp)});
 return{S,E,ids:new Set(S.map(x=>x.id))}}
function analyze(F){const{S,E,ids}=filterSet(F),con=E.filter(CON),inS=con.filter(e=>ids.has(e.sessionId)),hours=S.reduce((a,x)=>a+(x.end-x.start)/H,0);
 const sl=new Map(S.map(x=>[x.id,slices(x)])),R=hours?inS.length/hours:0,enough=S.length>=MIN_ALL_SESS&&inS.length>=MIN_ALL_CON;
 const facts=FACT.map(f=>{const rows=f.o.map(c=>({c,h:0,s:new Set(),con:0,caught:0,all:0,allCaught:0,sc:new Set()}));const row=c=>rows.find(r=>r.c===c);let unk=0;
  for(const x of S)for(const p of sl.get(x.id)){const c=f.f(p.t,p.r);if(!c){unk+=p.h;continue}const r=row(c);if(r){r.h+=p.h;r.s.add(x.id)}}
  for(const e of con){const t=entryMs(e),c=f.f(t,e.wx);const r=c&&row(c);if(!r)continue;r.all++;if(CAUGHT(e))r.allCaught++;if(ids.has(e.sessionId)){r.con++;if(CAUGHT(e))r.caught++;r.sc.add(e.sessionId)}}
  for(const r of rows){r.ok=r.h>=MIN_H&&r.s.size>=MIN_SESS;r.rate=r.h?r.con/r.h:null;r.crate=r.h?r.caught/r.h:null;
   r.flag=null;if(enough&&r.ok){const lam=R*r.h;if(r.con>=3&&pois(r.con,lam,true)<.05)r.flag='hoch';else if(lam>=3&&pois(r.con,lam,false)<.05)r.flag='niedrig'}}
  return{...f,rows,unk}});
 return{S,E,con,inS,out:con.length-inS.length,caught:con.filter(CAUGHT).length,seen:E.filter(e=>e.result==='seen').length,hours,R,enough,facts}}

/* ---------- Diagramme (SVG, eine Reihe pro Diagramm, Vorhersage gestrichelt) ---------- */
let chartId=0;const CH=new Map();
function lineChart(pts,{unit,dec=0,now=null,label}){pts=pts.filter(p=>p.v!=null);if(pts.length<2)return'<p class="mu">Keine ausreichenden Daten für ein Diagramm.</p>';
 const W=600,Hh=190,L=46,R=10,T=12,B=26,t0=pts[0].t,t1=pts.at(-1).t,vs=pts.map(p=>p.v);let lo=Math.min(...vs),hi=Math.max(...vs);const pad=Math.max((hi-lo)*.15,unit==='hPa'?1.5:1);lo-=pad;hi+=pad;
 const X=t=>L+(t-t0)/(t1-t0||1)*(W-L-R),Y=v=>T+(hi-v)/(hi-lo)*(Hh-T-B);
 const past=pts.filter(p=>now==null||p.t<=now),fut=pts.filter(p=>now!=null&&p.t>=now);const path=a=>a.map((p,i)=>(i?'L':'M')+X(p.t).toFixed(1)+' '+Y(p.v).toFixed(1)).join(' ');
 const ticks=[];for(let i=0;i<=3;i++){const v=lo+(hi-lo)*i/3;ticks.push(`<line x1="${L}" x2="${W-R}" y1="${Y(v)}" y2="${Y(v)}" class="g"/><text x="${L-6}" y="${Y(v)+4}" text-anchor="end">${fmt(v,unit==='hPa'?0:0)}</text>`)}
 const xt=[];for(let t=Math.ceil(t0/(6*H))*6*H;t<=t1;t+=6*H)xt.push(`<text x="${X(t)}" y="${Hh-6}" text-anchor="middle">${hm(t).slice(0,2)}</text>`);
 const id='lc'+(++chartId);CH.set(id,{pts,X,Y,unit,dec,now,W,Hh,T,B});
 return`<figure class="lc" id="${id}" aria-label="${esc(label)}"><svg viewBox="0 0 ${W} ${Hh}" role="img"><title>${esc(label)}</title>${ticks.join('')}${xt.join('')}
${now!=null&&now>t0&&now<t1?`<line x1="${X(now)}" x2="${X(now)}" y1="${T}" y2="${Hh-B}" class="nw"/><text x="${X(now)+4}" y="${T+12}" class="nt">jetzt</text>`:''}
<path d="${path(past)}" class="ln"/>${fut.length>1?`<path d="${path(fut)}" class="ln fc"/>`:''}<line class="cx" y1="${T}" y2="${Hh-B}" x1="-9" x2="-9"/><circle class="cd" r="5" cx="-9" cy="-9"/></svg><div class="tip" hidden></div></figure>`}
function bindCharts(root){root.querySelectorAll('.lc').forEach(fg=>{const c=CH.get(fg.id);if(!c||fg.dataset.b)return;fg.dataset.b=1;const sv=fg.querySelector('svg'),tip=fg.querySelector('.tip');
 const mv=ev=>{const b=sv.getBoundingClientRect(),x=(ev.clientX-b.left)/b.width*c.W;let best=c.pts[0];for(const p of c.pts)if(Math.abs(c.X(p.t)-x)<Math.abs(c.X(best.t)-x))best=p;
  const px=c.X(best.t),py=c.Y(best.v);sv.querySelector('.cx').setAttribute('x1',px);sv.querySelector('.cx').setAttribute('x2',px);const d=sv.querySelector('.cd');d.setAttribute('cx',px);d.setAttribute('cy',py);
  tip.hidden=false;tip.textContent=`${tStr(best.t)} · ${fmt(best.v,c.dec)} ${c.unit}${c.now!=null&&best.t>c.now?' (Vorhersage)':''}`;tip.style.left=Math.min(Math.max(px/c.W*b.width-60,0),b.width-150)+'px'};
 sv.addEventListener('pointermove',mv);sv.addEventListener('pointerdown',mv);sv.addEventListener('pointerleave',()=>{tip.hidden=true})})}
// Balken: Kontakte pro Angelstunde je Kategorie; Werte stehen als Text daneben, unzureichende Gruppen ohne Balken
function rateBars(f,R,show){const rows=f.rows.filter(r=>r.h>0||r.all>0);if(!rows.length)return'<p class="mu">Noch keine Daten.</p>';const mx=Math.max(1e-9,...rows.filter(r=>r.ok).map(r=>r.rate||0));
 return rows.map(r=>`<div class="wb"><span class="wl">${esc(r.c)}</span>${r.ok?`<span class="wt"><b style="width:${(r.rate/mx*100).toFixed(1)}%"></b></span><span class="wv">${fmt(r.rate,2)}/h${r.flag==='hoch'?' ▲':r.flag==='niedrig'?' ▼':''}</span>`:`<span class="wt na"></span><span class="wv mu">zu wenig Daten</span>`}</div>`).join('')+(show?`<p class="mu sm">Balken: ${show}. ▲/▼ = statistische Auffälligkeit (siehe Methodik). Gruppen unter ${MIN_H} Angelstunden oder ${MIN_SESS} Sessions werden nicht verglichen.</p>`:'')}
function factTable(f){const rows=f.rows.filter(r=>r.h>0||r.all>0);if(!rows.length)return'';
 return`<div class="tw"><table class="wtab"><thead><tr><th>${esc(f.n)}</th><th>Angel&shy;stunden</th><th>Sessions</th><th>Kontakte*</th><th>Fänge*</th><th>Kontakte/h</th><th>Fänge/h</th><th>Sessions mit Kontakt</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.c)}</td><td>${fmt(r.h,1)}</td><td>${r.s.size}</td><td>${r.con}${r.all>r.con?` <small class="mu">(+${r.all-r.con})</small>`:''}</td><td>${r.caught}</td><td>${r.ok?fmt(r.rate,2):'–'}</td><td>${r.ok?fmt(r.crate,2):'–'}</td><td>${r.s.size?`${r.sc.size} von ${r.s.size}`:'–'}</td></tr>`).join('')}</tbody></table></div>
<p class="mu sm">* während Sessions; in Klammern zusätzlich außerhalb von Sessions (ohne Angelzeit, daher nicht in Raten).${f.unk>0.05?` ${fmt(f.unk,1)} Angelstunden ohne Wetterdaten.`:''}</p>`}

/* ---------- Oberfläche ---------- */
const F={per:'all',lake:'all',sp:'all'};let viewLake='gross',err='';
const isOn=()=>$('#v-wx')?.classList.contains('on');
const css=document.createElement('style');css.textContent=`
#wx .wxCur{display:grid;grid-template-columns:auto 1fr;gap:4px 14px;align-items:center}#wx .wxBig{font-size:42px;font-weight:700;line-height:1}#wx .wxIc{font-size:40px}
#wx .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-top:12px}#wx .tiles div{background:var(--card2);border:1px solid var(--line);border-radius:14px;padding:10px 12px;font-size:12.5px;color:var(--mu)}#wx .tiles b{display:block;font-size:17px;color:var(--tx);margin:2px 0}
#wx .flt{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}#wx .flt label{margin:0}@media(max-width:420px){#wx .flt{grid-template-columns:1fr 1fr}}
#wx .seg{display:flex;gap:6px;margin:4px 0 10px}#wx .seg button{flex:1;min-height:40px;border-radius:12px;border:1px solid var(--line);background:var(--card2);color:var(--tx);font-weight:600;font-size:13.5px}#wx .seg button.on{background:var(--ac);border-color:var(--ac);color:var(--act)}
.sm{font-size:12.5px}.lc{margin:6px 0 2px;position:relative}.lc svg{width:100%;height:auto;display:block;touch-action:pan-y}.lc text{font-size:17px;fill:var(--mu)}.lc .g{stroke:var(--line);stroke-width:1}.lc .ln{fill:none;stroke:var(--ac);stroke-width:2.5;stroke-linejoin:round;stroke-linecap:round}.lc .fc{stroke-dasharray:7 6;opacity:.85}
.lc .nw{stroke:var(--mu);stroke-width:1;stroke-dasharray:3 4}.lc .nt{font-size:15px}.lc .cx{stroke:var(--tx);stroke-width:1;opacity:.5}.lc .cd{fill:var(--ac);stroke:var(--card);stroke-width:2}
.lc .tip{position:absolute;top:0;background:var(--bg2);border:1px solid var(--line);border-radius:10px;padding:4px 8px;font-size:12.5px;white-space:nowrap;box-shadow:var(--sh);pointer-events:none}
.wb{display:grid;grid-template-columns:minmax(90px,38%) 1fr auto;align-items:center;gap:8px;margin:5px 0;font-size:13.5px}.wb .wl{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.wt{height:12px;border-radius:6px;background:var(--card2);overflow:hidden}.wt b{display:block;height:100%;background:var(--ac);border-radius:0 6px 6px 0}.wt.na{background:repeating-linear-gradient(45deg,var(--card2) 0 4px,transparent 4px 8px)}.wv{font-variant-numeric:tabular-nums;min-width:62px;text-align:right}
.tw{overflow-x:auto;margin:8px 0}.wtab{border-collapse:collapse;font-size:12.5px;min-width:100%}.wtab th,.wtab td{padding:5px 6px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}.wtab th:first-child,.wtab td:first-child{text-align:left;position:sticky;left:0;background:var(--card)}.wtab th{color:var(--mu);font-weight:600}
.wsrc{font-size:11.5px;color:var(--mu)}.wtag{display:inline-block;font-size:11.5px;font-weight:700;padding:1px 8px;border-radius:10px;border:1px solid var(--line);background:var(--card2);margin-left:4px}.wnote{border-left:3px solid var(--bl);padding:6px 10px;margin:8px 0;font-size:13.5px;background:var(--card2);border-radius:0 10px 10px 0}`;
document.head.appendChild(css);

function build(){const sec=$('#wx');if(!sec||sec.dataset.b)return;sec.dataset.b=1;
 const sp=[...new Set([...SPECIES.filter(s=>!/Andere|Unbekannt/.test(s)),...entries.map(e=>e.species).filter(Boolean)])];
 sec.innerHTML=`<h3 style="margin-top:4px">Wetter &amp; Beißfenster</h3>
<div class="card" id="w1"></div>
<div class="card"><h3>Wetterverlauf und Luftdruck</h3><div id="w5"></div></div>
<div class="card"><h3>Wetter während meiner Angel-Session</h3><div id="w2"></div></div>
<div class="card"><h3>Auswertung meiner Daten</h3><div class="flt"><label>Zeitraum<select id="fPer"><option value="all">Alle Daten</option><option value="year">Dieses Jahr</option><option value="365">Letzte 12 Monate</option><option value="90">Letzte 90 Tage</option><option value="30">Letzte 30 Tage</option></select></label>
<label>Gewässer<select id="fLake"><option value="all">Beide Seen</option><option value="gross">Großer De Wittsee</option><option value="klein">Kleiner De Wittsee</option></select></label>
<label>Fischart<select id="fSp"><option value="all">Alle Fischarten</option>${sp.map(s=>`<option>${esc(s)}</option>`).join('')}</select></label></div><div id="wSum"></div></div>
<div class="card"><h3>Persönliche Beißfenster</h3><div id="w3"></div></div>
<div class="card"><h3>Auswertung nach Fischart</h3><div id="w4"></div></div>
<div class="card"><h3>Erfolgreiche und weniger erfolgreiche Sessions</h3><div id="w6"></div></div>
<details><summary>Methodik, Grenzen und Quellen</summary><div id="wM" style="font-size:13.5px"></div></details>`;
 const upd=()=>{F.per=$('#fPer').value;F.lake=$('#fLake').value;F.sp=$('#fSp').value;renderAnalysis()};['#fPer','#fLake','#fSp'].forEach(s=>$(s).onchange=upd);
 sec.addEventListener('click',e=>{const l=e.target.dataset.lake;if(l){viewLake=l;renderNow();refreshNow()}if(e.target.id==='wRef')refreshNow(true);if(e.target.id==='wLive')liveTick(true);
  const r=e.target.closest('[data-sess]');if(r&&window.AngelCal?.openSess)AngelCal.openSess(r.dataset.sess)})}

async function refreshNow(force){err='';try{await getNow(viewLake,force)}catch(e){err=e.message}if(isOn()){renderNow();renderSession()}}
function trendTxt(r){return r?.trend?`${TREND_L[r.trend]} (${sgn(r.dp3)} hPa in 3 h)`:'–'}
async function renderNow(){const n=await cachedNow(viewLake),box=$('#w1'),gr=$('#w5');if(!box)return;
 const seg=`<div class="seg">${Object.entries(LAKE).map(([k,v])=>`<button data-lake="${k}" class="${k===viewLake?'on':''}">${v.name}</button>`).join('')}</div>`;
 if(!n){box.innerHTML=`<h3>Aktuelles Wetter am De Wittsee</h3>${seg}<p class="mu">${err?esc(err):'Noch keine Wetterdaten geladen.'}</p><button class="btn" id="wRef">Wetter abrufen</button>`;gr.innerHTML='<p class="mu">Erscheint nach dem ersten Wetterabruf.</p>';return}
 const c=n.cur,w=WMO(c.code),age=Date.now()-n.q,nextSun=(()=>{const now=Date.now();for(const[r,s]of n.sun){if(r>now)return[['Sonnenaufgang',r],['Sonnenuntergang',s>now?s:null]];if(s>now)return[['Sonnenuntergang',s],['Sonnenaufgang',(n.sun.find(([r2])=>r2>now)||[])[0]||null]]}return[]})();
 const tile=(l,v,s='')=>`<div>${l}<b>${v}</b>${s}</div>`;
 box.innerHTML=`<h3>Aktuelles Wetter am De Wittsee</h3>${seg}
<div class="wxCur"><span class="wxIc">${w?(c.day===0&&c.code<=2?'🌙':w[1]):''}</span><div><span class="wxBig">${fmt(c.temp,1)} °C</span><div class="mu">${w?esc(w[0]):'Wetterzustand nicht verfügbar'}${c.feels!=null?` · gefühlt ${fmt(c.feels,1)} °C`:''}</div></div></div>
<div class="tiles">${tile('Luftdruck',c.p!=null?fmt(c.p,1)+' hPa':'–',`<span>${trendTxt(c)}</span>`)}${tile('Luftdruck­änderung',`${sgn(c.dp6)} / ${sgn(c.dp12)} / ${sgn(c.dp24)}`,'<span>hPa in 6 / 12 / 24 h</span>')}
${tile('Wind',c.ws!=null?`${dirOf(c.wd)||''} ${fmt(c.ws)} km/h`:'–',c.wd!=null?`<span>${fmt(c.wd)}° · ${bft(c.ws)} Bft${c.gust!=null?` · Böen ${fmt(c.gust)} km/h`:''}</span>`:'')}
${tile('Bewölkung',c.cloud!=null?fmt(c.cloud)+' %':'–')}${tile('Niederschlag',c.precip!=null?fmt(c.precip,1)+' mm':'–','<span>letzte 15 min</span>')}${tile('Luftfeuchte',c.rh!=null?fmt(c.rh)+' %':'–')}
${nextSun.filter(x=>x[1]).map(([l,t])=>tile(l,hm(t)+' Uhr',`<span>${new Date(t).toLocaleDateString('de-DE',{timeZone:'Europe/Berlin',weekday:'short'})}</span>`)).join('')}</div>
${!navigator.onLine?`<div class="warn">Offline – angezeigt werden die zuletzt geladenen Werte (Stand ${tStr(n.q)} Uhr).</div>`:age>3*H?`<div class="warn">Diese Werte sind ${fmt(age/H)} Stunden alt – nicht mehr aktuell.</div>`:''}${err&&navigator.onLine?`<div class="warn">${esc(err)} Angezeigt werden die zuletzt geladenen Werte.</div>`:''}
<div class="row"><button class="btn" id="wRef">Aktualisieren</button></div>
<p class="wsrc">Aktueller Modellwert für ${esc(LAKE[viewLake].name)} (${fmt(LAKE[viewLake].lat,4)}, ${fmt(LAKE[viewLake].lng,4)}), gültig ${tStr(c.t)} Uhr, abgerufen ${tStr(n.q)} Uhr. Keine Messung am See. Luftdruck auf Meereshöhe reduziert. Wetterdaten: <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo.com</a> (CC BY 4.0).</p>`;
 const h=n.hours.filter(r=>r.t>=n.q-24*H&&r.t<=n.q+24*H);
 gr.innerHTML=`<p class="mu sm">Letzte 24 Stunden (durchgezogen, vergangene Modellwerte) und nächste 24 Stunden (gestrichelt, <b>Vorhersage</b>). Antippen für Werte.</p>
<h4 style="margin:8px 0 0">Luftdruck (hPa)</h4>${lineChart(h.map(r=>({t:r.t,v:r.p})),{unit:'hPa',dec:1,now:n.q,label:'Luftdruckverlauf'})}
<h4 style="margin:8px 0 0">Lufttemperatur (°C)</h4>${lineChart(h.map(r=>({t:r.t,v:r.temp})),{unit:'°C',dec:1,now:n.q,label:'Temperaturverlauf'})}`;
 bindCharts(gr)}

function wxLine(r){if(!r)return'keine Wetterdaten';const w=WMO(r.code);return[r.temp!=null?fmt(r.temp,1)+' °C':null,r.p!=null?fmt(r.p,1)+' hPa'+(r.trend?' ('+TREND_L[r.trend]+')':''):null,r.ws!=null?`${r.ws<2?'windstill':(dirOf(r.wd)||'')+' '+fmt(r.ws)+' km/h'}`:null,r.cloud!=null?fmt(r.cloud)+' % Wolken':null,r.precip>0?fmt(r.precip,1)+' mm Niederschlag':null,w?w[0]:null].filter(Boolean).join(' · ')}
const srcTag=r=>!r?'':r.late?'<span class="wtag">nachträglich zugeordnet</span>':r.src==='aktuell'?'<span class="wtag">live abgerufen</span>':'<span class="wtag">Modellwert</span>';

function renderSession(){const box=$('#w2');if(!box)return;const s=curSess;let h='';
 if(s){const wx=s.wx||{},live=wx.live||[],last=live.at(-1);
  h+=`<div class="wnote"><b>Laufende Session</b> seit ${hm(s.start)} Uhr (${fmtDur(Date.now()-s.start)}) · ${esc(LAKE[wx.lake||sessLake(s)].name)}</div>
<p style="font-size:14px"><b>Beim Start:</b> ${wx.start?wxLine(wx.start)+srcTag(wx.start):'noch keine Daten – werden nachgeladen, sobald eine Verbindung besteht.'}<br><b>Zuletzt:</b> ${last?`${hm(last.t)} Uhr – ${wxLine(last)}`:'–'}</p>
<p class="mu sm">${live.length} Wetterabruf(e) während dieser Session. Solange die App geöffnet ist, ruft sie etwa alle 30 Minuten neue Werte ab. Ist sie geschlossen, entstehen Lücken – beim Beenden werden die stündlichen Werte für die ganze Session nachgeladen.</p>
<button class="btn" id="wLive">Wetter jetzt erfassen</button>`}
 else h+=`<p class="mu">Keine laufende Session. Starte sie wie gewohnt auf der Karte (Stoppuhr) oder im Angelkalender – das Wetter wird dann automatisch erfasst.</p>`;
 const last=sessions.filter(x=>x.end).sort((a,b)=>b.start-a.start).slice(0,6);
 h+=`<h4 style="margin:14px 0 6px">Letzte Sessions</h4>`+(last.length?last.map(x=>{const m=x.wx?.sum,en=entries.filter(e=>e.sessionId===x.id),c=en.filter(CON).length,f=en.filter(CAUGHT).length;
  return`<div class="it" data-sess="${x.id}"><div style="flex:1"><b>${new Date(x.start).toLocaleDateString('de-DE',{timeZone:'Europe/Berlin'})} ${hm(x.start)}</b> · ${fmtDur(x.end-x.start)} · ${c} Kontakte, ${f} Fänge${f?' 🎣':''}<br><small class="mu">${m&&m.got?`${m.tMin!=null?fmt(m.tMin)+'–'+fmt(m.tMax)+' °C · ':''}${m.dp!=null?'Luftdruck '+sgn(m.dp)+' hPa · ':''}${m.dir?m.dir+' '+fmt(m.wAvg)+' km/h':''}${m.complete?'':' · Wetter lückenhaft'}`:'Wetterdaten fehlen noch'}</small></div><span class="mu">›</span></div>`}).join(''):'<p class="mu">Noch keine beendeten Sessions.</p>');
 box.innerHTML=h}

function renderAnalysis(){if(!$('#w3'))return;const A=analyze(F),spTxt=F.sp==='all'?'':` (${F.sp})`;
 const gate=A.enough?'':`<div class="warn"><b>Noch nicht genügend Daten für eine belastbare Auswertung.</b> Bisher ${A.S.length} beendete Session(s) und ${A.inS.length} Kontakte während Sessions${spTxt}. Vergleiche und Auffälligkeiten werden erst ab ${MIN_ALL_SESS} Sessions und ${MIN_ALL_CON} Kontakten berechnet; bis dahin sind es reine Beobachtungen.</div>`;
 $('#wSum').innerHTML=`<div class="kp" style="margin-top:12px"><div><b>${A.S.length}</b>Sessions</div><div><b>${fmt(A.hours,1)}</b>Angelstunden</div><div><b>${A.con.length}</b>Kontakte${spTxt}</div><div><b>${A.caught}</b>Fänge</div><div><b>${A.seen}</b>Sichtungen</div></div>
<p class="mu sm">Kontakte = Biss, verloren, gefangen (ohne Sichtungen). ${A.out?`${A.out} Kontakt(e) außerhalb von Sessions zählen mit, fließen aber nicht in Raten pro Stunde ein. `:''}${A.hours?`Insgesamt ${fmt(A.R,2)} Kontakte pro Angelstunde.`:''}${F.sp!=='all'?` Gefiltert auf ${esc(F.sp)}: Einträge ohne oder mit anderer Fischart sind ausgeschlossen; die Angelzeit ist die gesamte Session-Zeit.`:''}</p>${gate}`;
 const fb=k=>A.facts.find(f=>f.k===k);
 // 3 Beißfenster
 const best=A.enough?fb('block').rows.filter(r=>r.ok&&r.rate>A.R).sort((a,b)=>b.rate-a.rate).slice(0,3):[];
 const flags=A.facts.flatMap(f=>f.rows.filter(r=>r.flag).map(r=>({f,r})));
 $('#w3').innerHTML=`${best.length?`<div class="wnote"><b>Persönliche Orientierung:</b> Überdurchschnittlich viele Kontakte pro Angelstunde hattest du bisher ${best.map(r=>`<b>${esc(r.c)}</b> (${fmt(r.rate,2)}/h)`).join(', ')}. Das ist eine Beobachtung aus deinen Daten, keine Fangprognose.</div>`:''}
<h4 style="margin:10px 0 4px">Kontakte pro Angelstunde nach Tageszeit</h4>${rateBars(fb('block'),A.R,'Kontakte pro Angelstunde')}
<h4 style="margin:14px 0 4px">Nach Lichtverhältnissen</h4>${rateBars(fb('light'),A.R)}
<h4 style="margin:14px 0 4px">Statistische Auffälligkeiten</h4>${!A.enough?'<p class="mu">Erst ab genügend Daten.</p>':flags.length?`<ul style="font-size:14px;margin:4px 0;padding-left:20px">${flags.map(({f,r})=>`<li>${esc(f.n)} „${esc(r.c)}“: ${fmt(r.rate,2)} statt Ø ${fmt(A.R,2)} Kontakte/h (${r.con} Kontakte in ${fmt(r.h,1)} h) – auffällig ${r.flag==='hoch'?'höher':'niedriger'}</li>`).join('')}</ul><p class="mu sm">Bei vielen gleichzeitigen Vergleichen treten einzelne Auffälligkeiten auch zufällig auf. Sie zeigen, wo sich genaueres Hinsehen lohnt – sie beweisen keinen Zusammenhang.</p>`:'<p class="mu">Keine Kategorie weicht deutlich vom Durchschnitt ab.</p>'}
${A.facts.filter(f=>!['block','light'].includes(f.k)).map(f=>`<details><summary>${esc(f.n)}</summary>${rateBars(f,A.R)}${factTable(f)}</details>`).join('')}
<details><summary>Tabellen Tageszeit &amp; Licht</summary>${factTable(fb('block'))}${factTable(fb('light'))}</details>
${methodBaitHtml(A)}`;
 // 4 Fischarten
 $('#w4').innerHTML=speciesHtml(A);
 // 6 Sessions vergleichen
 $('#w6').innerHTML=compareHtml(A);
 $('#wM').innerHTML=methodHtml()}
function methodBaitHtml(A){const t=(k,l)=>{const m={};A.con.forEach(e=>{const v=(e[k]||'').trim();if(v){m[v]??={c:0,f:0};m[v].c++;if(CAUGHT(e))m[v].f++}});const r=Object.entries(m).sort((a,b)=>b[1].c-a[1].c).slice(0,8);return r.length?`<h4 style="margin:10px 0 4px">${l}</h4>`+r.map(([n,v])=>`<div class="wb"><span class="wl">${esc(n)}</span><span class="mu sm" style="grid-column:2/4">${v.c} Kontakte, ${v.f} Fänge</span></div>`).join(''):''};
 const h=t('method','Angelmethode')+t('bait','Köder');return h?`<details><summary>Angelmethode &amp; Köder</summary>${h}<p class="mu sm">Nur Anzahlen: Wie lange du mit welcher Methode geangelt hast, erfasst die App nicht – daher keine Raten.</p></details>`:''}
function q3(a){a=a.filter(v=>v!=null).sort((x,y)=>x-y);if(!a.length)return null;if(a.length<4)return[a[0],a.at(-1)];const p=f=>a[Math.round((a.length-1)*f)];return[p(.25),p(.75)]}
const mode=a=>{const m={};a.filter(Boolean).forEach(v=>m[v]=(m[v]||0)+1);const k=Object.keys(m).sort((x,y)=>m[y]-m[x])[0];return k?[k,m[k]]:null};
function speciesHtml(A){const all=analyze({...F,sp:'all'}),con=all.con,by={};con.forEach(e=>{const s=e.species||'Ohne Fischart';(by[s]??=[]).push(e)});
 const seen={};all.E.filter(e=>e.result==='seen').forEach(e=>{const s=e.species||'Ohne Fischart';seen[s]=(seen[s]||0)+1});
 const rows=Object.entries(by).sort((a,b)=>b[1].length-a[1].length);if(!rows.length)return'<p class="mu">Noch keine Fischkontakte im gewählten Zeitraum.</p>';
 const mx=Math.max(...rows.map(r=>r[1].length));
 const bars=rows.map(([s,a])=>`<div class="wb"><span class="wl">${esc(s)}</span><span class="wt"><b style="width:${(a.length/mx*100).toFixed(1)}%"></b></span><span class="wv">${a.length}</span></div>`).join('');
 const cell=(a,fn)=>fn(a)||'–';
 const tab=`<div class="tw"><table class="wtab"><thead><tr><th>Fischart</th><th>Kontakte</th><th>Fänge</th><th>Gesehen</th><th>Kontakte/h</th><th>Häufigste Tageszeit</th><th>Temperatur</th><th>Luftdruck</th><th>Trend</th><th>Wind</th></tr></thead><tbody>${rows.map(([s,a])=>{const inS=a.filter(e=>all.S.some(x=>x.id===e.sessionId)).length,w=a.map(e=>e.wx).filter(Boolean),ok=all.hours>=MIN_H&&all.S.length>=MIN_SESS;
  const rg=(k,d,u)=>{const r=q3(w.map(x=>x[k]));return r?`${fmt(r[0],d)}–${fmt(r[1],d)} ${u}`:null};
  return`<tr><td>${esc(s)}</td><td>${a.length}</td><td>${a.filter(CAUGHT).length}</td><td>${seen[s]||0}</td><td>${ok?fmt(inS/all.hours,2):'–'}</td><td>${cell(a,a=>{const m=mode(a.map(e=>e.time&&BLOCK(+e.time.slice(0,2))));return m&&m[0]+` (${m[1]}×)`})}</td><td>${cell(w,()=>rg('temp',0,'°C'))}</td><td>${cell(w,()=>rg('p',0,'hPa'))}</td><td>${cell(w,w=>{const m=mode(w.map(x=>x.trend&&TREND_L[x.trend]));return m&&m[0]+` (${m[1]}×)`})}</td><td>${cell(w,w=>{const m=mode(w.map(x=>x.ws==null?null:x.ws<2?'windstill':dirOf(x.wd)));const r=q3(w.map(x=>x.ws));return m&&`${m[0]}${r?`, ${fmt(r[0])}–${fmt(r[1])} km/h`:''}`})}</td></tr>`}).join('')}</tbody></table></div>`;
 return`<h4 style="margin:4px 0">Kontakte nach Fischart</h4>${bars}${tab}<p class="mu sm">Bereiche = mittlere Hälfte der Werte bei den Kontakten (bei weniger als 4 Werten: kleinster bis größter Wert). „Kontakte/h“ bezieht Kontakte während Sessions auf deine gesamte Angelzeit. Sichtungen sind keine Kontakte. Für die Fangrate einer Art bei unterschiedlichen Bedingungen oben die Fischart filtern – dann zeigen „Persönliche Beißfenster“ und der Session-Vergleich nur diese Art.</p>`}
function compareHtml(A){const sp=F.sp,grp={fang:[],kontakt:[],ohne:[]};
 for(const x of A.S){const en=entries.filter(e=>e.sessionId===x.id&&(sp==='all'||e.species===sp));grp[en.some(CAUGHT)?'fang':en.some(CON)?'kontakt':'ohne'].push(x)}
 const G=[['fang','mit Fang'],['kontakt','nur Kontakte'],['ohne','ohne Kontakt']];
 const med=a=>{a=a.filter(v=>v!=null).sort((x,y)=>x-y);return a.length?a[Math.floor((a.length-1)/2)]:null};
 const st=x=>x.wx?.start||x.wx?.startModel||null,sm=x=>x.wx?.sum||{};
 const R=[['Anzahl Sessions',a=>String(a.length)],['Dauer (Median)',a=>{const m=med(a.map(x=>x.end-x.start));return m?fmtDur(m):'–'}],
  ['Startzeit (häufigste)',a=>{const m=mode(a.map(x=>BLOCK(bHour(x.start))));return m?m[0]:'–'}],['Licht beim Start',a=>{const m=mode(a.map(x=>lightOf(x.start)));return m?m[0]:'–'}],
  ['Luftdruck beim Start',a=>{const m=med(a.map(x=>st(x)?.p));return m!=null?fmt(m)+' hPa':'–'}],['Trend beim Start',a=>{const m=mode(a.map(x=>st(x)?.trend&&TREND_L[st(x).trend]));return m?m[0]:'–'}],
  ['Luftdruckänderung',a=>{const m=med(a.map(x=>sm(x).dp));return m!=null?sgn(m)+' hPa':'–'}],['Temperatur Ø',a=>{const m=med(a.map(x=>sm(x).tAvg));return m!=null?fmt(m,1)+' °C':'–'}],
  ['Wind Ø',a=>{const m=med(a.map(x=>sm(x).wAvg));return m!=null?fmt(m)+' km/h':'–'}],['Windrichtung',a=>{const m=mode(a.map(x=>sm(x).dir));return m?m[0]:'–'}],
  ['Bewölkung Ø',a=>{const m=med(a.map(x=>sm(x).cAvg));return m!=null?fmt(m)+' %':'–'}],['Mit Niederschlag',a=>{const z=a.filter(x=>sm(x).rain!=null);return z.length?`${z.filter(x=>sm(x).rain>0).length} von ${z.length}`:'–'}],
  ['Methode (häufigste)',a=>{const m=mode(a.flatMap(x=>entries.filter(e=>e.sessionId===x.id).map(e=>e.method)));return m?m[0]:'–'}]];
 const small=G.filter(([k])=>grp[k].length<MIN_CMP).map(g=>g[1]);
 // Gemeinsamkeiten: Merkmal in ≥ 60 % der Fang-Sessions und häufiger als bei den übrigen
 const com=[];const f=grp.fang,o=[...grp.kontakt,...grp.ohne];
 if(f.length>=MIN_CMP&&o.length>=MIN_CMP)for(const[l,fn]of[['Trend beim Start',x=>st(x)?.trend&&TREND_L[st(x).trend]],['Startzeit',x=>BLOCK(bHour(x.start))],['Licht beim Start',x=>lightOf(x.start)],['Windrichtung',x=>sm(x).dir],['Jahreszeit',x=>SEASON(bMonth(x.start))]]){const m=mode(f.map(fn));if(!m)continue;const sf=m[1]/f.length,so=o.filter(x=>fn(x)===m[0]).length/o.length;if(sf>=.6&&sf>so+.2)com.push(`${l}: „${m[0]}“ bei ${m[1]} von ${f.length} Sessions mit Fang (übrige Sessions: ${Math.round(so*100)} %)`)}
 return`<div class="tw"><table class="wtab"><thead><tr><th></th>${G.map(([k,l])=>`<th>${l}</th>`).join('')}</tr></thead><tbody>${R.map(([l,fn])=>`<tr><td>${l}</td>${G.map(([k])=>`<td>${grp[k].length?fn(grp[k]):'–'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
<p class="mu sm">Werte: Median bzw. häufigster Wert je Gruppe, aus den gespeicherten Session-Wetterdaten.${sp!=='all'?` „Mit Fang“ bezieht sich nur auf ${esc(sp)}.`:''}</p>
${small.length?`<div class="warn">Zu wenige Sessions für einen Vergleich in: ${small.join(', ')} (mindestens ${MIN_CMP} je Gruppe).</div>`:''}
${com.length?`<div class="wnote"><b>Wiederkehrende Bedingungen erfolgreicher Sessions</b> (Beobachtung, kein Beleg):<ul style="margin:4px 0;padding-left:20px">${com.map(c=>`<li>${esc(c)}</li>`).join('')}</ul></div>`:''}
<h4 style="margin:12px 0 6px">Letzte erfolgreiche Sessions</h4>${grp.fang.slice().sort((a,b)=>b.start-a.start).slice(0,5).map(x=>`<div class="it" data-sess="${x.id}"><div style="flex:1"><b>${new Date(x.start).toLocaleDateString('de-DE',{timeZone:'Europe/Berlin'})} ${hm(x.start)}</b> · ${fmtDur(x.end-x.start)}<br><small class="mu">${wxLine(st(x))}</small></div><span class="mu">›</span></div>`).join('')||'<p class="mu">Noch keine Session mit Fang.</p>'}`}
function methodHtml(){return`<p><b>Datenquelle:</b> <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo.com</a>, Lizenz CC BY 4.0, kostenlose Nutzung für nicht-kommerzielle Zwecke (unter 10.000 Abrufe/Tag). Abgefragt werden die Koordinaten der Seeflächen aus OpenStreetMap: Großer De Wittsee ${LAKE.gross.lat}, ${LAKE.gross.lng} (OSM ${LAKE.gross.osm}), Kleiner De Wittsee ${LAKE.klein.lat}, ${LAKE.klein.lng} (OSM ${LAKE.klein.osm}). Open-Meteo rechnet auf ein Modellgitter (in Deutschland etwa 1–2 km, bei älteren Daten gröber); beide Seen können in derselben Gitterzelle liegen.</p>
<p><b>Datenarten:</b> „Aktueller Modellwert“ (Forecast-API, Abschnitt <i>current</i>), „Modellwert vergangen“ (stündliche Werte für vergangene Stunden; bis ${FORECAST_PAST_DAYS} Tage zurück aus der Forecast-API, älter aus der Historical-Forecast-API, vor 2022 aus dem ERA5-Archiv) und „Vorhersage“ (nur im Verlaufsdiagramm, gestrichelt). Für Sessions und Kontakte werden nie Vorhersagewerte gespeichert. Es sind Modellwerte, keine Messungen am See. Nachträglich ergänzte Werte sind als „nachträglich zugeordnet“ gekennzeichnet; vorhandene Werte werden nie überschrieben.</p>
<p><b>Luftdruck:</b> auf Meereshöhe reduziert (wie im Wetterbericht). Das ältere Formularfeld „Luftdruck (hPa)“ enthält den Bodendruck am Standort (ca. 5 hPa niedriger) und wird hier nicht verwendet. Trend aus der Änderung über 3 Stunden: ab +${fmt(TREND,1)} hPa steigend, ab −${fmt(TREND,1)} hPa fallend, dazwischen weitgehend stabil. Diese Grenze ist eine Festlegung der App, keine Aussage über gute oder schlechte Beißbedingungen.</p>
<p><b>Angelzeit und Raten:</b> Jede beendete Session wird in Stundenabschnitte zerlegt; jeder Abschnitt erhält das Wetter zu seiner Mitte. Kontakte pro Angelstunde = Kontakte während Sessions in einer Kategorie ÷ Angelstunden in dieser Kategorie. So wird berücksichtigt, wie lange du unter einer Bedingung überhaupt geangelt hast. Gruppen mit weniger als ${MIN_H} Angelstunden oder ${MIN_SESS} Sessions werden nicht verglichen; Vergleiche insgesamt erst ab ${MIN_ALL_SESS} Sessions und ${MIN_ALL_CON} Kontakten.</p>
<p><b>Statistische Auffälligkeit (▲/▼):</b> Poisson-Test, ob die Zahl der Kontakte in einer Kategorie bei gleicher Angelzeit deutlich (p &lt; 0,05) über bzw. unter deinem Durchschnitt liegt. Wegen vieler gleichzeitiger Vergleiche ist das ein Hinweis, kein Beweis – und ein Zusammenhang ist keine Ursache.</p>
<p><b>Lichtverhältnisse:</b> Sonnenauf- und -untergang werden astronomisch berechnet; ±1 Stunde gilt als Dämmerung. <b>Tageszeit</b> in 3-Stunden-Blöcken, Ortszeit Europe/Berlin.</p>
<p><b>Persönliche Beobachtung, statistische Auffälligkeit, allgemeine Erfahrungsregel:</b> Die App zeigt nur die ersten beiden – beide aus deinen eigenen Daten. Allgemeine Anglerregeln (z. B. „fallender Luftdruck macht Raubfische aktiv“) sind verbreitete Erfahrungswerte, aber nicht durch deine Daten belegt und werden hier nicht als Ergebnis ausgegeben.</p>
<p><b>Grenzen:</b> Wetter wird nur abgerufen, solange die App geöffnet ist; iOS pausiert Web-Apps im Hintergrund. Fehlende Stunden werden beim nächsten Öffnen mit Internet aus den vergangenen Modellwerten ergänzt. Ohne Internet bleiben alle Einträge speicherbar; Wetter folgt später.</p>`}

/* ---------- Session-Rückblick (in der Session-Zusammenfassung des Angelkalenders) ---------- */
const NUM=['keine','eine','zwei','drei','vier','fünf','sechs','sieben','acht','neun','zehn','elf','zwölf'];
const num=(n,one,many)=>n===1?(one==='Biss'?'einen Biss':one==='gefangenen Fisch'?'einen gefangenen Fisch':'eine '+one):`${n<=12?NUM[n]:n} ${many}`;
function reviewText(x,en){const m=x.wx?.sum,act=!x.end,e2=x.end||Date.now(),parts=[];
 const durH=(e2-x.start)/H,dTxt=durH<1?`${Math.round(durH*60)}-minütigen`:Number.isInteger(Math.round(durH*2)/2)&&Math.round(durH)<=12?`${NUM[Math.round(durH)]}stündigen`:`${fmt(durH,1)}-stündigen`;
 if(m&&m.got){const s=[];
  if(m.dp!=null)s.push(Math.abs(m.dp)<TREND?`blieb der Luftdruck weitgehend stabil (${sgn(m.dp)} hPa)`:`${m.dp<0?'sank':'stieg'} der Luftdruck ${Math.abs(m.dp)<3?'leicht ':''}um ${fmt(Math.abs(m.dp),1)} hPa`);
  parts.push(`Während deiner ${dTxt} Session ${s[0]||'liegen Luftdruckwerte nur teilweise vor'}.`);
  if(m.tMin!=null)parts.push(Math.round(m.tMin)===Math.round(m.tMax)?`Die Temperatur lag bei etwa ${fmt(m.tMin)} °C.`:`Die Temperatur lag zwischen ${fmt(m.tMin)} und ${fmt(m.tMax)} °C.`);
  if(m.wAvg!=null)parts.push(m.wAvg<2?'Es war nahezu windstill.':`Der Wind kam überwiegend aus ${m.dir||'wechselnder Richtung'} mit durchschnittlich ${fmt(m.wAvg)} km/h${m.gMax!=null?` (Böen bis ${fmt(m.gMax)} km/h)`:''}.`);
  if(m.rain!=null)parts.push(m.rain>0?`Es fiel etwa ${fmt(m.rain,1)} mm Niederschlag.`:'Es blieb trocken.')}
 else parts.push(act?'Die Session läuft noch.':'Für diese Session liegen noch keine Wetterdaten vor; sie werden nachgeladen, sobald eine Internetverbindung besteht.');
 const b=en.filter(e=>e.result==='bite').length,l=en.filter(e=>/^lost/.test(e.result)).length,c=en.filter(CAUGHT).length,s=en.filter(e=>e.result==='seen').length,li=[];
 if(b)li.push(num(b,'Biss','Bisse'));if(l)li.push(l===1?'einen verlorenen Fisch':num(l,'','verlorene Fische'));if(c)li.push(num(c,'gefangenen Fisch','gefangene Fische'));
 parts.push(li.length?`Du hast ${li.length>1?li.slice(0,-1).join(', ')+' und '+li.at(-1):li[0]} dokumentiert${s?` sowie ${s} Sichtung${s>1?'en':''}`:''}.`:`Du hast keinen Fischkontakt dokumentiert${s?`, aber ${s} Sichtung${s>1?'en':''}`:''}.`);
 const A=analyze({per:'all',lake:'all',sp:'all'}),tr=m?.trend0&&TREND_L[m.trend0],row=tr&&A.facts.find(f=>f.k==='trend').rows.find(r=>r.c===tr);
 parts.push(A.enough&&row&&row.ok?`Bei ${tr}em Luftdruck hattest du bisher ${fmt(row.rate,2)} Kontakte pro Angelstunde (Durchschnitt ${fmt(A.R,2)}) – eine Beobachtung aus ${fmt(row.h,1)} Angelstunden, kein Beleg für einen Zusammenhang.`:'Deine bisherigen Daten reichen noch nicht aus, um einen verlässlichen Zusammenhang zwischen dieser Wetterlage und deinen Fängen festzustellen.');
 return parts.join(' ')}
function reviewHtml(x,en){const wx=x.wx||{},m=wx.sum,st=wx.start||wx.startModel,ed=wx.end||wx.endModel,ser=wx.series||[];
 const cov=!x.end?`${(wx.live||[]).length} Wetterabruf(e) bisher.`:!m?'Noch keine Wetterdaten – werden bei Internetverbindung nachgeladen.':m.complete?`Stündliche Modellwerte vollständig (${m.got} von ${m.exp})${m.live?`, dazu ${m.live} Live-Abruf(e)`:''}.`:`Wetterdaten lückenhaft: ${m.got} von ${m.exp} Stundenwerten${m.live?`, ${m.live} Live-Abruf(e)`:''}.`;
 const ens=en.map(e=>`<li><b>${esc(e.time)}</b> ${esc(RES[e.result]?.[0]||'–')}${e.species?' · '+esc(e.species):''}: <span class="mu">${wxLine(e.wx)}</span>${e.wx?.late?' <small class="mu">(nachträglich)</small>':''}</li>`).join('');
 const id='rv'+(++chartId);
 setTimeout(()=>{const el=document.getElementById(id);if(el)bindCharts(el)},0);
 return`<div id="${id}" style="margin-top:10px"><b>Wetterbericht</b><p style="font-size:14px;margin:6px 0">${esc(reviewText(x,en))}</p>
<div style="font-size:13.5px;line-height:1.5"><b>Beginn:</b> ${wxLine(st)} ${srcTag(st)}${x.end?`<br><b>Ende:</b> ${wxLine(ed)} ${srcTag(ed)}`:''}</div>
${ser.length>1?`<div style="margin-top:6px"><small class="mu">Luftdruck während der Session (hPa)</small>${lineChart(ser.map(r=>({t:r.t,v:r.p})),{unit:'hPa',dec:1,label:'Luftdruck während der Session'})}</div>`:''}
${ens?`<div style="font-size:13.5px;margin-top:6px"><b>Wetter bei den Kontakten</b><ul style="margin:4px 0;padding-left:18px">${ens}</ul></div>`:''}
<p class="wsrc">${cov} Modellwerte von Open-Meteo.com (CC BY 4.0) für die Seekoordinaten, keine Messung am See.</p></div>`}
// Kurzzeile für das Karten-Popup
function entryLine(e){return e.wx?`Wetter: ${wxLine(e.wx)}${e.wx.late?' (nachträglich)':''}<br>`:''}

function spOpts(){const el=$('#fSp');if(!el)return;const v=el.value,sp=[...new Set([...SPECIES.filter(s=>!/Andere|Unbekannt/.test(s)),...entries.map(e=>e.species).filter(Boolean)])];el.innerHTML=`<option value="all">Alle Fischarten</option>${sp.map(s=>`<option>${esc(s)}</option>`).join('')}`;el.value=sp.includes(v)?v:'all';F.sp=el.value}
function renderAll(){build();spOpts();renderNow();renderSession();renderAnalysis()}
function init(){if(!$('#wx'))return;$('#nav').addEventListener('click',e=>{if(e.target.dataset.v==='wx'){renderAll();refreshNow()}})}
window.WX={LAKE,lakeKey,sessLake,trendOf,sunTimes,lightOf,recAt,valAt,withTrend,summarize,slices,analyze,pois,getNow,ensureHours,attachEntry,finalize,backfill,onSessionStart,onSessionEnd,liveTick,reviewHtml,reviewText,entryLine,wxLine,_failed:()=>[...failed],_reset:()=>{hoursCache=null;nowCache=null;tried.clear();backoff=0;started=false}};
init();
})();
