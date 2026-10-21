/* Angelkalender – nutzt vorhandene Daten (sessions, entries, curSess) und speichert nur Termine (plans). */
(()=>{
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const TZ='Europe/Berlin',p2=n=>String(n).padStart(2,'0');
const MON=['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'],WD=['Mo','Di','Mi','Do','Fr','Sa','So'],WDL=['Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag','Sonntag'];
/* ---------- Zeit (Europe/Berlin, unabhängig von der Geräte-Zeitzone) ---------- */
const FMT=new Intl.DateTimeFormat('en-GB',{timeZone:TZ,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
const tzp=ms=>{const o={};for(const p of FMT.formatToParts(ms))o[p.type]=+p.value;return o};
const bDay=ms=>{const o=tzp(ms);return`${o.year}-${p2(o.month)}-${p2(o.day)}`};
const bTime=ms=>{const o=tzp(ms);return`${p2(o.hour)}:${p2(o.minute)}`};
const D2U=s=>{const[a,b,c]=s.split('-').map(Number);return Date.UTC(a,b-1,c)};
const U2D=u=>{const d=new Date(u);return`${d.getUTCFullYear()}-${p2(d.getUTCMonth()+1)}-${p2(d.getUTCDate())}`};
const addD=(s,n)=>U2D(D2U(s)+n*864e5);
const dow=s=>(new Date(D2U(s)).getUTCDay()+6)%7;
const fd=s=>s.split('-').reverse().join('.');
const isoWeek=s=>{const d=new Date(D2U(s));d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7)+3);const j=new Date(Date.UTC(d.getUTCFullYear(),0,4));return 1+Math.round(((d-j)/864e5-3+((j.getUTCDay()+6)%7))/7)};
const berlinMs=(date,time)=>{const[y,m,d]=date.split('-').map(Number),[h,mi]=(time||'00:00').split(':').map(Number),w=Date.UTC(y,m-1,d,h,mi);let t=w;for(let i=0;i<3;i++){const o=tzp(t);t+=w-Date.UTC(o.year,o.month-1,o.day,o.hour,o.minute)}return t};
const todayB=()=>bDay(Date.now());
const mdOf=s=>{const[,m,d]=s.split('-').map(Number);return m*100+d};
/* ---------- Daten ---------- */
const DRE=/^\d{4}-\d{2}-\d{2}$/,TRE=/^\d{2}:\d{2}$/,RRE=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
function cleanPlan(x){if(!x||typeof x!=='object'||!x.id||!DRE.test(x.date||'')||!TRE.test(x.start||'')||!TRE.test(x.end||''))return null;
 const o={...x};o.id=String(x.id);o.v=1;o.status=['planned','cancelled','done','started'].includes(x.status)?x.status:'planned';
 ['title','lake','place','target','method','bait','notes'].forEach(k=>o[k]=String(x[k]??''));
 o.remind=['','day','2h','1h','custom'].includes(x.remind)?x.remind:'';o.remindAt=RRE.test(x.remindAt||'')?x.remindAt:'';if(o.remind==='custom'&&!o.remindAt)o.remind='';
 o.created=+x.created||Date.now();o.updated=+x.updated||o.created;return o}
const planLake=p=>p.lake==='other'?(p.place||'Anderer Ort'):(p.lake||'');
const sLake=x=>{if(x.lake)return x.lake;const c={};entries.filter(e=>e.sessionId===x.id&&e.lake).forEach(e=>c[e.lake]=(c[e.lake]||0)+1);return Object.keys(c).sort((a,b)=>c[b]-c[a])[0]||''};
function pState(p,now=Date.now()){
 if(p.status==='cancelled')return'cancelled';
 const ss=p.sessionId&&(sessions.find(x=>x.id===p.sessionId)||(curSess&&curSess.id===p.sessionId?curSess:null));
 if(ss)return ss.end?'finished':'active';
 if(p.status==='done')return'done';
 return berlinMs(p.date,p.start)<now?'open':'planned'}
const pEnd=p=>{const s=berlinMs(p.date,p.start),e=berlinMs(p.date,p.end);return e>s?e:berlinMs(addD(p.date,1),p.end)};
function buildEvents(now=Date.now()){const ev=[];
 for(const p of plans){const st=pState(p,now);if(st==='finished'||st==='active')continue;ev.push({k:'plan',id:p.id,p,st,s:berlinMs(p.date,p.start),e:pEnd(p),title:p.title||'Angeltermin',lake:planLake(p)})}
 for(const x of sessions)if(x.end)ev.push({k:'sess',id:x.id,x,st:'finished',s:x.start,e:x.end,title:x.planTitle||'Session',lake:sLake(x)});
 if(curSess)ev.push({k:'sess',id:curSess.id,x:curSess,st:'active',s:curSess.start,e:now,title:curSess.planTitle||'Laufende Session',lake:sLake(curSess)});
 ev.forEach(x=>{x.d1=bDay(x.s);x.d2=bDay(Math.max(x.s,x.e-1))});return ev.sort((a,b)=>a.s-b.s)}
const onDay=(ev,d)=>ev.filter(x=>x.d1<=d&&d<=x.d2);
/* ---------- Fischereirecht (recht.js) ---------- */
const FR=()=>window.FischRecht;
const findRow=t=>{const f=FR();return f&&t?f.ROWS.find(r=>r.n===t||r.n.startsWith(t)):null};
const legalFlag=p=>{const f=FR(),r=findRow(p.target);return!!(f&&r&&f.status(r,mdOf(p.date),'am Termintag')[0]==='bad')};
function legalHtml(p){const f=FR();if(!f)return'<div class="note">Der Bereich „Fischereirecht NRW“ ist nicht geladen.</div>';
 const r=findRow(p.target);let h=`<b>⚖ Hinweise für den ${fd(p.date)}</b> (nicht Heute):<br>`;
 if(r){const[,,tx]=f.status(r,mdOf(p.date),'am Termintag');h+=`<b>${esc(r.n)}:</b> ${esc(tx)}<br>Mindestmaß: ${r.min?r.min+' cm':(r.k==='g'?'– (ganzjährig geschützt)':'keines in § 3 LFischVO')}<br>`}
 else h+='Kein Zielfisch aus der Liste gewählt – keine Prüfung möglich.<br>';
 const gw=p.lake==='Großer De Witt See'?'Landschaftsschutzgebiet laut KuLaDig. ':p.lake==='Kleiner De Witt See'?'Naturschutzgebiet laut KuLaDig – ob und wo geangelt werden darf, ist NICHT geprüft. ':'';
 h+=`<b>Gewässerspezifische Regeln${p.lake==='other'?' (anderer Ort)':''}:</b> <b>ungeklärt</b>. ${gw}Abweichende Mindestmaße, Schonzeiten, Entnahmebeschränkungen und Angelregeln habe ich nicht belegt – maßgeblich ist dein Erlaubnisschein.<br><small class="mu">Quelle: ${esc(f.LAWS)} · <a href="${f.LAW}" target="_blank" rel="noopener">recht.nrw.de</a> · Datenstand geprüft ${fd(f.CHECKED)}. Hinweis, keine abschließende rechtliche Beurteilung.</small>`;return h}
/* ---------- Erinnerungen ---------- */
function remindMs(p){if(!p.remind)return null;const s=berlinMs(p.date,p.start);
 if(p.remind==='day')return berlinMs(addD(p.date,-1),'18:00');if(p.remind==='2h')return s-72e5;if(p.remind==='1h')return s-36e5;
 if(p.remind==='custom'&&p.remindAt)return berlinMs(p.remindAt.slice(0,10),p.remindAt.slice(11,16));return null}
const RLAB={'':'keine',day:'am Vortag (18:00 Uhr)','2h':'2 Stunden vorher','1h':'1 Stunde vorher',custom:'individuell'};
function remInfo(p){if(!p.remind)return'';const r=remindMs(p);const at=r==null?'':`${fd(bDay(r))} ${bTime(r)} Uhr`;
 if(p.fired){const t=p.fired.at?`${fd(bDay(p.fired.at))} ${bTime(p.fired.at)}`:'';
  if(p.fired.state==='missed')return`🔔 ${RLAB[p.remind]} (${at}): <b>nicht zugestellt</b> – die App war zum Zeitpunkt nicht geöffnet.`;
  return`🔔 ${RLAB[p.remind]} (${at}): in der App angezeigt (${t})${p.fired.state==='late'?', <b>verspätet</b>, da die App zur Fälligkeit nicht geöffnet war':''}; Systemmitteilung: ${p.fired.notified?'gesendet':'nicht gesendet (keine Erlaubnis)'}.`}
 return`🔔 ${RLAB[p.remind]}: fällig ${at}. Erscheint nur, wenn die App dann geöffnet ist.`}
async function notify(p,state){if(!('Notification' in window)||Notification.permission!=='granted')return false;
 const t='Angeltermin: '+(p.title||'Angeln'),o={body:`${fd(p.date)} ${p.start}–${p.end} · ${planLake(p)}${state==='late'?' (verspätet)':''}`,tag:'plan-'+p.id,icon:'icon-192.png'};
 try{const reg=navigator.serviceWorker&&await navigator.serviceWorker.getRegistration();if(reg)await reg.showNotification(t,o);else new Notification(t,o);return true}catch(e){return false}}
function banner(p,state){let b=$('#rmb');if(!b){b=document.createElement('div');b.id='rmb';b.className='note';b.style.cssText='position:fixed;top:56px;left:12px;right:12px;z-index:2000;max-width:520px;margin:auto;box-shadow:0 2px 12px #000a';document.body.appendChild(b)}
 b.innerHTML=`<b>🔔 Erinnerung${state==='late'?' (verspätet)':''}:</b> ${esc(p.title||'Angeltermin')} – ${fd(p.date)}, ${p.start} Uhr, ${esc(planLake(p))}<div class="row"><button class="btn p" id="rb1">Öffnen</button><button class="btn" id="rb2">Schließen</button></div>`;
 $('#rb1').onclick=()=>{b.remove();show('cal');openPlan(p.id)};$('#rb2').onclick=()=>b.remove()}
let booted=false;
async function checkRem(initial){const now=Date.now();let ch=false;
 for(const p of plans){if(p.status!=='planned'||!p.remind||p.fired)continue;const r=remindMs(p);if(r==null||now<r)continue;
  const s=berlinMs(p.date,p.start),state=now>=s?'missed':(initial&&now-r>12e4?'late':'ok');p.fired={at:now,state,notified:false};
  if(state!=='missed'){p.fired.notified=await notify(p,state);banner(p,state)}
  try{await dbx('plans','readwrite',st=>st.put(p))}catch(e){}ch=true}
 if(ch)rcal()}
/* ---------- Aktionen ---------- */
function validate(d){if(!DRE.test(d.date||'')||isNaN(D2U(d.date)))return'Bitte ein gültiges Datum angeben.';
 if(!TRE.test(d.start||'')||!TRE.test(d.end||''))return'Bitte Start- und Endzeit angeben.';if(d.start===d.end)return'Start- und Endzeit dürfen nicht gleich sein.';
 if(d.lake==='other'&&!(d.place||'').trim())return'Bitte den Ort angeben.';
 if(d.remind==='custom'){if(!RRE.test(d.remindAt||''))return'Bitte den Erinnerungszeitpunkt angeben.';if(remindMs(d)>=berlinMs(d.date,d.start))return'Die Erinnerung muss vor dem Start liegen.'}
 return''}
async function savePlan(p){p.updated=Date.now();await dbx('plans','readwrite',s=>s.put(p));await reload()}
async function removePlan(id){await dbx('plans','readwrite',s=>s.delete(id));await reload()}
async function setStatus(p,st){p.status=st;if(st!=='planned'){}p.updated=Date.now();await savePlan(p)}
async function movePlan(p,date,start,end){const e=validate({...p,date,start,end});if(e)throw Error(e);Object.assign(p,{date,start,end});delete p.fired;delete p.wx;await savePlan(p)}
async function startSess(p){
 if(curSess)throw Error('Es läuft bereits eine Session. Beende sie zuerst.');
 curSess={id:crypto.randomUUID(),start:Date.now(),planId:p.id,planTitle:p.title||'Angeltermin',lake:LAKES.includes(p.lake)?p.lake:'',pre:{...(p.method?{method:p.method}:{}),...(p.bait?{bait:p.bait}:{})}};
 await dbx('meta','readwrite',s=>s.put(curSess,'active'));p.sessionId=curSess.id;p.status='started';await savePlan(p);if(typeof sessUI==='function')sessUI();if(window.WX)WX.onSessionStart()}
/* ---------- Wetter (optional, Open-Meteo) ---------- */
function coords(p){const L=typeof lakes!=='undefined'?lakes:[];let rs=[];L.forEach(l=>{if(p.lake&&p.lake!=='other'&&l.key===p.lake)rs.push(...l.rings)});if(!rs.length&&p.lake!=='other')L.forEach(l=>rs.push(...l.rings));
 if(rs.length){let a=0,b=0,n=0;rs.forEach(r=>r.forEach(([la,ln])=>{a+=la;b+=ln;n++}));return{lat:a/n,lng:b/n,src:'Gewässermitte laut OSM-Umriss'}}
 if(typeof map!=='undefined'){const c=map.getCenter();return{lat:c.lat,lng:c.lng,src:'aktueller Kartenausschnitt (kein Seeumriss geladen)'}}return null}
async function loadWx(p){const diff=(D2U(p.date)-D2U(todayB()))/864e5;if(diff<0)throw Error('Für vergangene Termine wird im Kalender keine Wetteranzeige geladen.');if(diff>15)throw Error('Für diesen Zeitraum liegt noch keine Prognose vor (max. 15 Tage im Voraus).');
 const c=coords(p);if(!c)throw Error('Kein Ort für die Wetterabfrage.');
 const j=await(await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${c.lat.toFixed(3)}&longitude=${c.lng.toFixed(3)}&hourly=temperature_2m,precipitation_probability,wind_speed_10m,wind_direction_10m,cloud_cover&wind_speed_unit=ms&timezone=Europe%2FBerlin&start_date=${p.date}&end_date=${p.date}`)).json(),h=j.hourly;if(!h)throw Error(j.reason||'keine Daten');
 const a=+p.start.slice(0,2),b=p.end>p.start?Math.max(a,+p.end.slice(0,2)):23,ix=[];for(let i=a;i<=b&&i<24;i++)ix.push(i);const v=k=>ix.map(i=>h[k][i]).filter(x=>x!=null);
 const t=v('temperature_2m'),w=v('wind_speed_10m'),cl=v('cloud_cover'),pp=v('precipitation_probability');
 p.wx={at:Date.now(),src:c.src,tmin:Math.min(...t),tmax:Math.max(...t),pop:Math.max(...pp),wind:Math.max(...w),dir:h.wind_direction_10m[a],cloud:Math.round(cl.reduce((x,y)=>x+y,0)/cl.length)};await savePlan(p)}
const DIRS=['N','NO','O','SO','S','SW','W','NW'];
const wxHtml=p=>p.wx?`<b>☁ Wetterprognose</b> (Open-Meteo, abgerufen ${fd(bDay(p.wx.at))} ${bTime(p.wx.at)}; Ort: ${esc(p.wx.src)}; nur Prognose, keine Messung): ${Math.round(p.wx.tmin)}–${Math.round(p.wx.tmax)} °C · Regenwahrscheinlichkeit bis ${p.wx.pop} % · Wind bis ${p.wx.wind.toFixed(1)} m/s aus ${DIRS[Math.round(p.wx.dir/45)%8]} · Bewölkung Ø ${p.wx.cloud} %`:'';
/* ---------- Oberfläche ---------- */
let view='month',cur=todayB(),sel=null,showStats=false,sy=null,sl='';
const CLS=x=>x.k==='plan'?{planned:'pl',open:'op',done:'dn',cancelled:'cn'}[x.st]:x.st==='active'?'ac':'fn';
const SLAB={pl:'Geplant',op:'Vergangen, nicht durchgeführt/erledigt',dn:'Als erledigt markiert',cn:'Abgesagt',ac:'Laufende Session',fn:'Abgeschlossene Session'};
const badges=x=>x.k==='plan'?((x.st==='planned'&&legalFlag(x.p)?' ⚖':'')+(x.st==='planned'&&x.p.remind&&!x.p.fired?' 🔔':'')):'';
const tr=x=>`${bTime(x.s)}–${x.st==='active'?'läuft':bTime(x.e)}${x.d2>x.d1?' (+'+Math.round((D2U(x.d2)-D2U(x.d1))/864e5)+' T)':''}`;
const chip=(x,d)=>`<div class="ce ${CLS(x)}" data-k="${x.k}" data-id="${x.id}" title="${esc(x.title)}"><span class="t">${x.d1===d?bTime(x.s)+' ':'↦ '}${esc(x.title)}${badges(x)}</span></div>`;
const row=x=>`<div class="ci ${CLS(x)}" data-k="${x.k}" data-id="${x.id}"><b>${tr(x)}</b> ${esc(x.title)}${badges(x)}<br><small>${esc(x.lake||'Gewässer unbekannt')}${x.k==='plan'&&x.p.target?' · Ziel: '+esc(x.p.target):''} · ${SLAB[CLS(x)]}</small></div>`;
const css=document.createElement('style');css.textContent=`#cal .tabs{display:flex;gap:6px;margin:6px 0}#cal .tabs .btn{flex:1;padding:10px 4px}#cal .nv{display:flex;gap:6px;align-items:center;margin:6px 0}#cal .nv .btn{padding:10px 14px}#cal h4{flex:1;text-align:center;margin:0;font-size:16px}
.cgrid{display:grid;grid-template-columns:repeat(7,1fr);gap:3px}.cgrid .wd{text-align:center;font-size:12px;color:var(--mu)}.cc{min-height:62px;background:var(--card);border:1px solid var(--line);border-radius:6px;padding:3px;cursor:pointer;overflow:hidden}.cc.oth{opacity:.45}.cc.td{border-color:var(--ac);box-shadow:inset 0 0 0 1px var(--ac)}.cc.sl{background:var(--card2);border-color:var(--ac)}.cc .n{font-size:12px;color:var(--mu)}
.ce{font-size:11px;border-radius:4px;padding:1px 3px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#111}.ci{border-radius:8px;padding:8px 10px;margin:6px 0;cursor:pointer;color:#111;font-size:14px}.ci small{opacity:.85}
.pl{background:#bfdbfe;border:2px solid #3b82f6}.op{background:transparent;border:2px dashed #3b82f6;color:var(--tx)!important}.dn{background:#5eead4}.cn{background:#9ca3af;text-decoration:line-through}.ac{background:#fbbf24;border:2px solid #b45309}.fn{background:#86efac}
.lg span{display:inline-block;margin:2px 6px 2px 0;padding:1px 8px;border-radius:10px;font-size:12px;color:#111}
@media(max-width:600px){.cc{min-height:54px}.ce{height:7px;padding:0;font-size:0;border-radius:4px}.ce.pl,.ce.ac,.ce.op{border-width:1.5px}}
.cal-t td,.cal-t th{padding:4px 6px;text-align:right;border-bottom:1px solid var(--line);font-size:14px}.cal-t th:first-child,.cal-t td:first-child{text-align:left}.cal-t{width:100%;border-collapse:collapse}`;document.head.appendChild(css);
function build(){const sec=$('#cal');if(!sec||sec.dataset.b)return;sec.dataset.b=1;
 sec.innerHTML=`<h3 style="margin-top:4px">Angelkalender</h3>
<div class="tabs" id="ctabs"><button class="btn p" data-v="month">Monat</button><button class="btn" data-v="week">Woche</button><button class="btn" data-v="day">Tag</button></div>
<div class="nv"><button class="btn" id="cprev">‹</button><h4 id="ctitle"></h4><button class="btn" id="cnext">›</button></div>
<div class="row" style="margin-top:0"><button class="btn" id="ctoday">Heute</button><input type="date" id="cjump" style="flex:1.4;margin:0" aria-label="Zu Datum springen"><button class="btn p" id="cnew">＋ Termin</button></div>
<div class="lg" id="clg">${Object.entries(SLAB).map(([k,v])=>`<span class="${k}">${v}</span>`).join('')}<span style="background:var(--card);color:var(--tx)">⚖ Schonzeit-Warnung</span><span style="background:var(--card);color:var(--tx)">🔔 Erinnerung aktiv</span></div>
<div id="cup"></div><div id="cb"></div><div id="cday"></div>
<div class="row"><button class="btn" id="cstat">Jahresübersicht</button><button class="btn" id="cperm"></button></div><div id="cs"></div><p class="mu" id="cpn"></p>`;
 $('#ctabs').onclick=e=>{const v=e.target.dataset.v;if(!v)return;view=v;if(v!=='month'&&sel)cur=sel;rcal()};
 $('#cprev').onclick=()=>nav(-1);$('#cnext').onclick=()=>nav(1);$('#ctoday').onclick=()=>{cur=todayB();sel=cur;rcal()};
 $('#cjump').onchange=e=>{if(DRE.test(e.target.value)){cur=e.target.value;sel=cur;rcal()}};
 $('#cnew').onclick=()=>openForm(null,'new',view==='day'?cur:(sel||todayB()));
 $('#cstat').onclick=()=>{showStats=!showStats;rcal()};
 $('#cperm').onclick=async()=>{if('Notification' in window&&Notification.permission==='default'){await Notification.requestPermission()}rcal()};
 const body=e=>{const it=e.target.closest('.ce,.ci');if(it){it.dataset.k==='plan'?openPlan(it.dataset.id):openSess(it.dataset.id);return true}return false};
 $('#cb').onclick=e=>{if(body(e))return;const c=e.target.closest('.cc'),a=e.target.closest('[data-add]');if(a){openForm(null,'new',a.dataset.add);return}if(c){sel=c.dataset.d;cur=view==='month'?cur:sel;rcal()}};
 $('#cday').onclick=e=>{if(body(e))return;const a=e.target.closest('[data-add]'),o=e.target.closest('[data-open]');if(a)openForm(null,'new',a.dataset.add);if(o){view='day';cur=o.dataset.open;sel=cur;rcal()}};
 $('#cup').onclick=body}
function nav(n){if(view==='month'){const[y,m]=cur.split('-').map(Number);cur=U2D(Date.UTC(y,m-1+n,1))}else cur=addD(cur,view==='week'?7*n:n);sel=null;rcal()}
function rcal(){const sec=$('#v-cal');if(!sec||!sec.classList.contains('on'))return;build();const ev=buildEvents(),td=todayB();
 document.querySelectorAll('#ctabs button').forEach(b=>b.classList.toggle('p',b.dataset.v===view));$('#cjump').value=cur;
 let html='';
 if(view==='month'){const[y,m]=cur.split('-').map(Number),f=`${y}-${p2(m)}-01`;$('#ctitle').textContent=`${MON[m-1]} ${y}`;const st=addD(f,-dow(f));
  html=`<div class="cgrid">${WD.map(w=>`<div class="wd">${w}</div>`).join('')}${Array.from({length:42},(_,i)=>{const d=addD(st,i),evs=onDay(ev,d),mm=+d.slice(5,7);return`<div class="cc${mm!==m?' oth':''}${d===td?' td':''}${d===sel?' sl':''}" data-d="${d}"><div class="n">${+d.slice(8)}</div>${evs.slice(0,3).map(x=>chip(x,d)).join('')}${evs.length>3?`<div class="n">+${evs.length-3}</div>`:''}</div>`}).join('')}</div>`}
 else if(view==='week'){const st=addD(cur,-dow(cur));$('#ctitle').textContent=`KW ${isoWeek(cur)} · ${fd(st).slice(0,6)}–${fd(addD(st,6))}`;
  html=Array.from({length:7},(_,i)=>{const d=addD(st,i),evs=onDay(ev,d);return`<div style="margin:8px 0"><b${d===td?' style="color:var(--ac)"':''}>${WD[i]} ${fd(d).slice(0,6)}</b> <button class="btn" style="padding:4px 10px;margin-left:6px" data-add="${d}">＋</button>${evs.map(x=>row(x)).join('')||'<div class="mu" style="font-size:13px">–</div>'}</div>`}).join('')}
 else{$('#ctitle').textContent=`${WDL[dow(cur)]}, ${fd(cur)}`;const evs=onDay(ev,cur);html=(evs.map(x=>row(x)).join('')||'<p class="mu">Keine Termine oder Sessions an diesem Tag.</p>')+`<div class="row"><button class="btn p" data-add="${cur}">＋ Termin an diesem Tag</button></div>`}
 $('#cb').innerHTML=html;
 const dd=view==='month'&&sel?sel:null;$('#cday').innerHTML=dd?`<h3>Tagesübersicht ${WD[dow(dd)]} ${fd(dd)}</h3>${onDay(ev,dd).map(x=>row(x)).join('')||'<p class="mu">Nichts eingetragen.</p>'}<div class="row"><button class="btn p" data-add="${dd}">＋ Termin</button><button class="btn" data-open="${dd}">Tagesansicht</button></div>`:'';
 const up=ev.filter(x=>x.k==='plan'&&x.st==='planned'&&x.e>Date.now()).slice(0,4);
 $('#cup').innerHTML=up.length?`<div class="note"><b>Anstehend</b>${up.map(x=>`<div class="ci pl" data-k="plan" data-id="${x.id}" style="margin:4px 0"><b>${fd(x.d1).slice(0,6)} ${bTime(x.s)}</b> ${esc(x.title)}${badges(x)}<br><small>${esc(x.lake)}${x.p.remind?' · '+(x.p.fired?'Erinnerung '+(x.p.fired.state==='missed'?'nicht zugestellt':'angezeigt'):'Erinnerung '+RLAB[x.p.remind]):''}</small></div>`).join('')}</div>`:'';
 const P='Notification' in window?Notification.permission:'none';$('#cperm').textContent=P==='granted'?'🔔 Mitteilungen: erlaubt':P==='denied'?'🔕 Mitteilungen: blockiert':P==='default'?'🔔 Mitteilungen erlauben':'Mitteilungen nicht unterstützt';$('#cperm').disabled=P!=='default';
 $('#cpn').innerHTML='Erinnerungen erscheinen nur, solange die App geöffnet oder im Hintergrund aktiv ist. Eine Zustellung bei geschlossener App (echter Push) ist ohne Server nicht möglich; verpasste Erinnerungen werden als „nicht zugestellt“ bzw. „verspätet“ gekennzeichnet.';
 $('#cs').innerHTML=showStats?yearHtml():''}
/* ---------- Jahresübersicht ---------- */
function yearHtml(){const now=Date.now();const ys=new Set([todayB().slice(0,4)]);plans.forEach(p=>ys.add(p.date.slice(0,4)));sessions.forEach(x=>x.end&&ys.add(bDay(x.start).slice(0,4)));entries.forEach(e=>e.date&&ys.add(e.date.slice(0,4)));
 if(!sy||!ys.has(sy))sy=todayB().slice(0,4);const y=sy,L=sl;
 const P=plans.filter(p=>p.date.startsWith(y)&&(!L||p.lake===L));let du=0,ca=0,fa=0,op=0;P.forEach(p=>{const s=pState(p,now);s==='cancelled'?ca++:s==='finished'||s==='active'||s==='done'?du++:s==='open'?fa++:op++});
 const S=sessions.filter(x=>x.end&&bDay(x.start).startsWith(y)&&(!L||sLake(x)===L)),E=entries.filter(e=>e.date&&e.date.startsWith(y)&&e.result!=='seen'&&(!L||e.lake===L));
 const m=Array.from({length:12},()=>({s:0,h:0,k:0,f:0}));S.forEach(x=>{const i=+bDay(x.start).slice(5,7)-1;m[i].s++;m[i].h+=(x.end-x.start)/36e5});E.forEach(e=>{const i=+e.date.slice(5,7)-1;m[i].k++;if(e.result==='caught')m[i].f++});
 const T=m.reduce((a,b)=>({s:a.s+b.s,h:a.h+b.h,k:a.k+b.k,f:a.f+b.f}),{s:0,h:0,k:0,f:0}),hf=h=>h.toFixed(1).replace('.',',');
 return`<h3>Jahresübersicht</h3><div class="grid"><label>Jahr<select id="sy">${[...ys].sort().map(v=>`<option${v===y?' selected':''}>${v}</option>`).join('')}</select></label><label>Gewässer<select id="sl"><option value="">Alle</option>${LAKES.map(v=>`<option${v===L?' selected':''}>${v}</option>`).join('')}</select></label></div>
<div class="kp"><div><b>${P.length}</b>Termine geplant</div><div><b>${du}</b>durchgeführt/erledigt</div><div><b>${ca}</b>abgesagt</div><div><b>${fa}</b>ausgefallen</div><div><b>${op}</b>noch offen</div></div>
<div class="kp" style="margin-top:8px"><div><b>${T.s}</b>Sessions (tatsächlich)</div><div><b>${hf(T.h)}</b>Angelstunden</div><div><b>${T.k}</b>Fischkontakte</div><div><b>${T.f}</b>Fänge</div></div>
<table class="cal-t" style="margin-top:10px"><tr><th>Monat</th><th>Sessions</th><th>Std.</th><th>Kontakte</th><th>Fänge</th></tr>${m.map((r,i)=>`<tr><td>${MON[i].slice(0,3)}</td><td>${r.s}</td><td>${hf(r.h)}</td><td>${r.k}</td><td>${r.f}</td></tr>`).join('')}</table>
<p class="mu"><small>„Ausgefallen“ = Termin vergangen, nicht abgesagt, ohne Session und nicht als erledigt markiert. Sessions, Kontakte und Fänge stammen aus den vorhandenen Daten (keine Doppelspeicherung); geplante Termine zählen nicht als Sessions. Kontakte ohne Sichtungen.${L?' Sessions ohne erkennbares Gewässer sind bei aktivem Gewässerfilter ausgeblendet.':''}</small></p>`}
document.addEventListener('change',e=>{if(e.target.id==='sy'){sy=e.target.value;rcal()}if(e.target.id==='sl'){sl=e.target.value;rcal()}});
/* ---------- Dialoge ---------- */
const dlg=id=>{let d=$('#'+id);if(!d){d=document.createElement('dialog');d.id=id;document.body.appendChild(d)}return d};
function openPlan(id){const p=plans.find(x=>x.id===id);if(!p)return;const d=dlg('cdlg'),$=s=>d.querySelector(s),st=pState(p),ov=pEnd(p)>berlinMs(p.date,p.start)&&bDay(pEnd(p)-1)>p.date;
 const act=st==='cancelled'?[['reopen','Wieder aktivieren','p']]:st==='done'?[['reopen','Wieder öffnen',''],['edit','Bearbeiten','']]:[['start','▶ Session starten','p'],['edit','Bearbeiten',''],['move','Verschieben',''],['done','Als erledigt markieren',''],['cancel','Absagen','']];
 d.innerHTML=`<b>${esc(p.title||'Angeltermin')}</b> <span class="bd ${{planned:'ye',open:'mu',done:'ok',cancelled:'mu'}[st]}" style="margin-left:6px;padding:1px 8px;border-radius:10px;font-size:12px;background:#cbd5e1;color:#111">${{planned:'geplant',open:'vergangen, offen',done:'erledigt',cancelled:'abgesagt'}[st]}</span>
<div style="font-size:14px;line-height:1.5;margin-top:8px">📅 ${WD[dow(p.date)]} ${fd(p.date)}, ${p.start}–${p.end} Uhr${ov?' (endet am Folgetag)':''}<br>📍 ${esc(planLake(p)||'–')}${p.target?'<br>🎯 Ziel: '+esc(p.target):''}${p.method?'<br>Methode: '+esc(p.method):''}${p.bait?'<br>Köder: '+esc(p.bait):''}${p.notes?'<br><i>'+esc(p.notes)+'</i>':''}
${p.remind?'<div class="note">'+remInfo(p)+'</div>':''}<div id="wxo">${wxHtml(p)?'<div class="note">'+wxHtml(p)+'</div>':''}</div><div id="lgo"></div></div>
<div class="row"><button class="btn" id="bw">☁ Wetter laden</button><button class="btn" id="bl">⚖ Rechtliche Hinweise</button></div>
<div class="row">${act.map(([k,l,c])=>`<button class="btn ${c}" data-a="${k}">${l}</button>`).join('')}<button class="btn d" data-a="del">Löschen</button></div><div class="row"><button class="btn" data-a="x">Schließen</button></div><p class="mu" id="derr"></p>`;
 const err=m=>$('#derr').textContent=m;
 $('#bl').onclick=()=>{$('#lgo').innerHTML='<div class="note">'+legalHtml(p)+'</div>'};
 $('#bw').onclick=async()=>{try{err('Lade …');await loadWx(p);err('');$('#wxo').innerHTML='<div class="note">'+wxHtml(p)+'</div>'}catch(e){err('Wetter nicht verfügbar: '+e.message+(p.wx?' (zuletzt gespeicherte Prognose siehe oben)':''))}};
 d.onclick=async e=>{const a=e.target.dataset.a;if(!a)return;try{
  if(a==='x')return d.close();
  if(a==='edit'||a==='move'){d.close();return openForm(p,a)}
  if(a==='start'){await startSess(p);d.close();toast('Session gestartet – Gewässer und geplanter Köder werden für neue Einträge vorbelegt.');show('map')}
  if(a==='done'){await setStatus(p,'done');d.close()}
  if(a==='cancel'){await setStatus(p,'cancelled');d.close()}
  if(a==='reopen'){delete p.fired;await setStatus(p,'planned');d.close()}
  if(a==='del'){if(!confirm('Diesen Termin endgültig löschen?'))return;await removePlan(p.id);d.close()}
 }catch(er){err(er.message)}};
 d.showModal()}
function openSess(id){const act=curSess&&curSess.id===id,x=act?curSess:sessions.find(s=>s.id===id);if(!x)return;const d=dlg('cdlg'),$=s=>d.querySelector(s),en=entries.filter(e=>e.sessionId===id).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time)),con=en.filter(e=>e.result!=='seen'),ca=en.filter(e=>e.result==='caught'),e2=act?Date.now():x.end,pl=x.planId&&plans.find(p=>p.id===x.planId);
 d.innerHTML=`<b>${esc(x.planTitle||'Session')}</b> <span class="bd" style="margin-left:6px;padding:1px 8px;border-radius:10px;font-size:12px;background:${act?'#fbbf24':'#86efac'};color:#111">${act?'läuft':'abgeschlossen'}</span>
<div style="font-size:14px;line-height:1.5;margin-top:8px">📅 ${fd(bDay(x.start))} ${bTime(x.start)}${act?' – läuft':' – '+(bDay(e2)>bDay(x.start)?fd(bDay(e2))+' ':'')+bTime(e2)} Uhr · ${fmtDur(e2-x.start)}<br>📍 ${esc(sLake(x)||'Gewässer nicht erkennbar')}${pl?'<br>Geplant als: '+esc(pl.title||'Termin')+' ('+fd(pl.date)+')':''}<br><b>${con.length}</b> Fischkontakte, <b>${ca.length}</b> Fänge</div>
${window.WX?WX.reviewHtml(x,en):''}
<label>Notiz zur Session<textarea id="sn" rows="3">${esc(x.note||'')}</textarea></label>
<div id="sel">${en.map(e=>`<div class="ci fn" data-e="${e.id}" style="margin:4px 0"><b>${esc(e.time)}</b> ${esc(RES[e.result]?.[0]||'–')}${e.species?' · '+esc(e.species):''}${e.bait?' · '+esc(e.bait):''}${e.notes?'<br><small>'+esc(e.notes.slice(0,80))+'</small>':''}</div>`).join('')||'<p class="mu">Noch keine Einträge in dieser Session.</p>'}</div>
<div class="row"><button class="btn" id="sx">Schließen</button></div>`;
 $('#sx').onclick=()=>d.close();
 $('#sn').onchange=async()=>{x.note=$('#sn').value;if(act)await dbx('meta','readwrite',s=>s.put(curSess,'active'));else await dbx('sessions','readwrite',s=>s.put(x));toast('Notiz gespeichert.')};
 $('#sel').onclick=ev=>{const c=ev.target.closest('[data-e]');if(!c)return;const e=entries.find(z=>z.id===c.dataset.e);d.close();hlId=e.id;show('map');render();map.setView([e.lat,e.lng],Math.max(map.getZoom(),18));const m=markers.get(e.id);if(m)cluster.zoomToShowLayer(m,()=>m.openPopup())};
 d.showModal()}
function openForm(p,mode,date){const d=dlg('pdlg'),$=s=>d.querySelector(s),nw=!p,mv=mode==='move',all=plans.slice().sort((a,b)=>b.created-a.created)[0]||{},td=todayB();
 const o=nw?(()=>{let s='06:00';if(date===td){const h=(tzp(Date.now()).hour+1)%24;s=p2(h)+':00'}return{date,start:s,end:p2((+s.slice(0,2)+3)%24)+':00',lake:all.lake||LAKES[0],place:all.place||'',target:all.target||'',method:all.method||'',bait:all.bait||'',notes:'',remind:'',remindAt:'',title:''}})():{...p};
 const op=(a,v)=>a.map(x=>`<option${x===v?' selected':''}>${esc(x)}</option>`).join('');
 const dis=mv?' style="display:none"':'';
 d.innerHTML=`<b>${nw?'Neuer Angeltermin':mv?'Termin verschieben':'Termin bearbeiten'}</b>
<div${dis}><label>Titel<input id="f-title" value="${esc(o.title)}" placeholder="z. B. Barsch am Abend"></label></div>
<div class="grid"><label>Datum<input type="date" id="f-date" value="${o.date}"></label><span></span><label>Start<input type="time" id="f-start" value="${o.start}"></label><label>Ende<input type="time" id="f-end" value="${o.end}"></label></div>
<div${dis}><label>Gewässer<select id="f-lake">${op(LAKES,o.lake)}<option value="other"${o.lake==='other'?' selected':''}>Anderer Ort</option></select></label><label id="f-pl" style="display:${o.lake==='other'?'block':'none'}">Ort<input id="f-place" value="${esc(o.place)}"></label>
<div class="grid"><label>Zielfisch<select id="f-target"><option value="">–</option>${op(SPECIES,o.target)}</select></label><label>Methode<select id="f-method"><option value="">–</option>${op(METHODS,o.method)}</select></label></div>
<label>Geplante Köder<input id="f-bait" value="${esc(o.bait)}"></label><label>Notizen<textarea id="f-notes" rows="2">${esc(o.notes)}</textarea></label>
<label>Erinnerung<select id="f-rem">${Object.entries(RLAB).map(([k,v])=>`<option value="${k}"${k===o.remind?' selected':''}>${v==='keine'?'Keine':v}</option>`).join('')}</select></label><label id="f-ra" style="display:${o.remind==='custom'?'block':'none'}">Erinnerungszeitpunkt<input type="datetime-local" id="f-remat" value="${esc(o.remindAt)}"></label></div>
<p class="mu" id="ferr" style="color:#f87171"></p><div class="row"><button class="btn" id="pfx">Abbrechen</button><button class="btn p" id="pfs">Speichern</button></div>`;
 $('#f-lake').onchange=e=>$('#f-pl').style.display=e.target.value==='other'?'block':'none';$('#f-rem').onchange=e=>$('#f-ra').style.display=e.target.value==='custom'?'block':'none';$('#pfx').onclick=()=>d.close();
 $('#pfs').onclick=async()=>{const v=k=>$('#f-'+k).value,n={...o,date:v('date'),start:v('start'),end:v('end')};
  if(!mv)Object.assign(n,{title:v('title').trim(),lake:v('lake'),place:v('lake')==='other'?v('place').trim():'',target:v('target'),method:v('method'),bait:v('bait').trim(),notes:v('notes').trim(),remind:v('rem'),remindAt:v('rem')==='custom'?v('remat'):''});
  const er=validate(n);if(er){$('#ferr').textContent=er;return}
  if(!n.title)n.title='Angeln – '+(planLake(n)||'Termin');
  try{if(nw){Object.assign(n,{id:crypto.randomUUID(),v:1,status:'planned',created:Date.now()});}else{const ch=n.date!==p.date||n.start!==p.start||n.end!==p.end||n.remind!==p.remind||n.remindAt!==p.remindAt;if(ch)delete n.fired;if(n.date!==p.date||n.lake!==p.lake||n.place!==p.place)delete n.wx}
   await savePlan(n);d.close();cur=n.date;sel=n.date;rcal()}catch(e){$('#ferr').textContent='Speichern fehlgeschlagen: '+e.message}};
 d.showModal()}
/* ---------- Einbindung ---------- */
window.calRefresh=()=>{if(!booted&&typeof plans!=='undefined'){booted=true;checkRem(true)}rcal()};
$('#nav').addEventListener('click',e=>{if(e.target.dataset.v==='cal'){cur=todayB();sel=null;rcal()}});
setInterval(()=>checkRem(false),20000);
window.AngelCal={berlinMs,bDay,bTime,addD,isoWeek,cleanPlan,pState,buildEvents,remindMs,legalFlag,legalHtml,validate,savePlan,removePlan,setStatus,movePlan,startSess,checkRem,onDay,pEnd,yearHtml,remInfo,openSess};
})();
