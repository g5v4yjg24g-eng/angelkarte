/* Statistik-Reiter – Dashboard mit eigenem Zeitraum-/Gewässerfilter.
   calc() berechnet alle Kennzahlen aus den gespeicherten Daten (entries, sessions), render() stellt sie dar.
   Wetter-Auswertungen kommen aus WX.analyze (wetter.js), damit es keine zweite Berechnungslogik gibt. */
(()=>{
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const H=36e5,MAX_SESSION_H=24,MIN_RATE_H=1,MIN_QUOTE=5,MIN_WX_SESS=5,MIN_WX_CATCH=5;
const MON=['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'],MONL=['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
const fmt=(x,d=0)=>x==null||!isFinite(x)?'–':Number(x).toLocaleString('de-DE',{minimumFractionDigits:d,maximumFractionDigits:d,useGrouping:false});
const hrs=h=>h==null?'–':h<1?`${Math.round(h*60)} min`:`${fmt(Math.floor(h))} h ${String(Math.round((h%1)*60)).padStart(2,'0')} min`;
const dayDe=d=>d?d.split('-').reverse().join('.'):'';
const UNKNOWN='Nicht bestimmt',spName=s=>!s||s==='Unbekannt'?UNKNOWN:s;
const LOST=r=>r==='lost_hooked'||r==='lost_drill';
const bDay=ms=>window.AngelCal?AngelCal.bDay(ms):new Date(ms).toISOString().slice(0,10);
const addD=(d,n)=>window.AngelCal?AngelCal.addD(d,n):new Date(Date.parse(d)+n*864e5).toISOString().slice(0,10);

/* ---------- Filter ---------- */
const F={per:'all',lake:'all',from:'',to:''};
const PER_L=[['all','Gesamtzeitraum'],['year','Dieses Jahr'],['month','Dieser Monat'],['30','Letzte 30 Tage'],['custom','Benutzerdefiniert']],PER=Object.fromEntries(PER_L); // Liste wegen fester Reihenfolge
function range(f=F){const td=bDay(Date.now());
 if(f.per==='year')return[td.slice(0,4)+'-01-01',td];if(f.per==='month')return[td.slice(0,8)+'01',td];if(f.per==='30')return[addD(td,-29),td];
 if(f.per==='custom'){let a=f.from||'0000-01-01',b=f.to||td;if(a>b)[a,b]=[b,a];return[a,b]}return['0000-01-01','9999-12-31']}
// Gewässer einer Session als 'gross'/'klein'; '' wenn weder Session noch zugehörige Einträge ein Gewässer nennen
const sessLake=x=>{const known=x.wx?.lake||x.lake||entries.some(e=>e.sessionId===x.id&&e.lake);if(!known)return'';return window.WX?.sessLake?WX.sessLake(x):/klein/i.test(x.lake||'')?'klein':'gross'};
const lakeName=k=>k==='gross'?LAKES[0]:k==='klein'?LAKES[1]:k;

/* ---------- Berechnung (rein, ohne DOM) ---------- */
function calc(f=F,data={entries,sessions,curSess}){const[a,b]=range(f),inR=d=>d&&d>=a&&d<=b;
 const lakeKey=f.lake==='all'?null:f.lake===LAKES[1]?'klein':'gross';
 const E=data.entries.filter(e=>inR(e.date)&&(f.lake==='all'||e.lake===f.lake));
 const finished=data.sessions.filter(x=>x.end&&inR(bDay(x.start)));
 const noLake=lakeKey?finished.filter(x=>!sessLake(x)).length:0;
 const S=lakeKey?finished.filter(x=>sessLake(x)===lakeKey):finished;
 const valid=S.filter(x=>x.end>x.start&&(x.end-x.start)/H<=MAX_SESSION_H),invalid=S.length-valid.length,vIds=new Set(valid.map(x=>x.id));
 const hours=valid.reduce((s,x)=>s+(x.end-x.start)/H,0);
 const caught=E.filter(e=>e.result==='caught'),bites=E.filter(e=>e.result==='bite'),lost=E.filter(e=>LOST(e.result)),seen=E.filter(e=>e.result==='seen');
 const contacts=E.filter(e=>e.result&&e.result!=='seen'),cIn=caught.filter(e=>vIds.has(e.sessionId)),kIn=contacts.filter(e=>vIds.has(e.sessionId));
 const rate=(n)=>hours>=MIN_RATE_H?n/hours:null;
 // Fischarten (nur Fänge)
 const sp={};for(const e of caught){const n=spName(e.species),o=sp[n]??={name:n,n:0,guess:0,lenM:null,lenE:null};o.n++;if(e.guess)o.guess++;
  if(e.lenMeas>0&&(!o.lenM||e.lenMeas>o.lenM.v))o.lenM={v:e.lenMeas,id:e.id};if(e.lenEst>0&&(!o.lenE||e.lenEst>o.lenE.v))o.lenE={v:e.lenEst,id:e.id}}
 const species=Object.values(sp).sort((x,y)=>y.n-x.n||x.name.localeCompare(y.name,'de'));
 const distinct=species.filter(s=>s.name!==UNKNOWN&&s.name!=='Andere Fischart').length;
 // Entwicklung: Wochen bei kurzen Zeiträumen, sonst Monate
 const dates=[...E.map(e=>e.date),...S.map(x=>bDay(x.start))].filter(Boolean).sort();
 const td=bDay(Date.now()),first=a>'0000-01-01'?a:dates[0],last=b<'9999-12-31'?(b<td?b:td):(dates.at(-1)||td);
 let trend=null;
 if(first&&caught.length){const spanD=(Date.parse(last)-Date.parse(first))/864e5;
  if(spanD<=70){const mon=d=>addD(d,-((new Date(Date.parse(d)).getUTCDay()+6)%7)),buckets=[];
   for(let w=mon(first);w<=last;w=addD(w,7))buckets.push({k:w,label:'KW '+(window.AngelCal?AngelCal.isoWeek(w):''),title:`Woche ab ${dayDe(w)}`,v:0,s:0});
   for(const e of caught){const k=mon(e.date),x=buckets.find(z=>z.k===k);if(x)x.v++}for(const x of S){const k=mon(bDay(x.start)),z=buckets.find(y=>y.k===k);if(z)z.s++}
   trend={unit:'Woche',buckets}}
  else{const buckets=[];let y=+first.slice(0,4),m=+first.slice(5,7);const ly=+last.slice(0,4),lm=+last.slice(5,7);
   while(y<ly||y===ly&&m<=lm){buckets.push({k:`${y}-${String(m).padStart(2,'0')}`,label:MON[m-1]+(m===1||!buckets.length?' '+String(y).slice(2):''),title:`${MONL[m-1]} ${y}`,v:0,s:0});if(++m>12){m=1;y++}}
   for(const e of caught){const x=buckets.find(z=>z.k===e.date.slice(0,7));if(x)x.v++}for(const x of S){const z=buckets.find(y=>y.k===bDay(x.start).slice(0,7));if(z)z.s++}
   const cut=buckets.length>24?buckets.length-24:0;trend={unit:'Monat',buckets:buckets.slice(cut),cut}}}
 // Sessions pro Monat
 const sm={};valid.forEach(x=>{const k=bDay(x.start).slice(0,7);sm[k]=(sm[k]||0)+1});
 // Rekorde
 const maxBy=(arr,k)=>arr.filter(e=>e[k]>0).sort((x,y)=>y[k]-x[k])[0]||null;
 const mc={};caught.forEach(e=>{const k=e.date.slice(0,7);mc[k]=(mc[k]||0)+1});const bestM=Object.entries(mc).sort((x,y)=>y[1]-x[1]||x[0].localeCompare(y[0]));
 const topSp=species.filter(s=>s.name!==UNKNOWN);
 const rec={lenMeas:maxBy(caught,'lenMeas'),lenEst:maxBy(caught,'lenEst'),weight:maxBy(caught,'weight'),
  species:topSp.length?topSp.filter(s=>s.n===topSp[0].n):[],longest:valid.slice().sort((x,y)=>(y.end-y.start)-(x.end-x.start))[0]||null,
  month:bestM.length?{k:bestM[0][0],n:bestM[0][1],ties:bestM.filter(z=>z[1]===bestM[0][1]).length}:null};
 const hooked=caught.length+lost.length;
 return{range:[a,b],E,S,valid,invalid,noLake,running:!!data.curSess,hours,caught,bites,lost,seen,contacts,cIn,kIn,catchRate:rate(cIn.length),contactRate:rate(kIn.length),
  avgDur:valid.length?hours/valid.length:null,avgCatch:valid.length?cIn.length/valid.length:null,withCatch:valid.filter(x=>cIn.some(e=>e.sessionId===x.id)).length,
  outside:caught.length-cIn.length,species,distinct,trend,sessPerMonth:sm,rec,hooked,landing:hooked>=MIN_QUOTE?caught.length/hooked:null}}

/* ---------- Diagramm: Balken (eine Reihe, Werte per Antippen) ---------- */
let cid=0;const CH=new Map();
function barChart(bk,{unit,label}){const W=600,Hh=210,L=34,R=8,T=18,B=30,n=bk.length,mx=Math.max(1,...bk.map(x=>x.v)),step=mx<=5?1:mx<=10?2:Math.ceil(mx/5),top=Math.ceil(mx/step)*step;
 const bw=(W-L-R)/n,gap=Math.min(6,bw*.25),Y=v=>T+(1-v/top)*(Hh-T-B),every=Math.ceil(n/8),id='sc'+(++cid);CH.set(id,bk);
 const grid=[];for(let v=0;v<=top;v+=step)grid.push(`<line x1="${L}" x2="${W-R}" y1="${Y(v)}" y2="${Y(v)}" class="g"/><text x="${L-6}" y="${Y(v)+5}" text-anchor="end">${v}</text>`);
 const bars=bk.map((x,i)=>{const x0=L+i*bw+gap/2,w=bw-gap,h=Y(0)-Y(x.v),r=Math.min(4,w/2,h);
  return`<g data-i="${i}"><rect class="hit" x="${L+i*bw}" y="${T}" width="${bw}" height="${Hh-T-B}"/>${x.v?`<path class="bf" d="M${x0} ${Y(0)}V${Y(x.v)+r}q0 -${r} ${r} -${r}h${w-2*r}q${r} 0 ${r} ${r}V${Y(0)}z"/>`:''}${n<=14&&x.v?`<text x="${x0+w/2}" y="${Y(x.v)-5}" text-anchor="middle" class="vl">${x.v}</text>`:''}${i%every===0?`<text x="${x0+w/2}" y="${Hh-9}" text-anchor="middle">${esc(x.label)}</text>`:''}</g>`}).join('');
 return`<figure class="sc" id="${id}"><svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title>${grid.join('')}<line x1="${L}" x2="${W-R}" y1="${Y(0)}" y2="${Y(0)}" class="ax"/>${bars}</svg><div class="tip" hidden></div><figcaption>${esc(label)} · y-Achse: ${esc(unit)}</figcaption></figure>`}
function bindCharts(root){root.querySelectorAll('.sc').forEach(fg=>{const bk=CH.get(fg.id),sv=fg.querySelector('svg'),tip=fg.querySelector('.tip');if(!bk)return;
 const on=ev=>{const g=ev.target.closest('g[data-i]');if(!g){tip.hidden=true;return}const x=bk[+g.dataset.i],b=sv.getBoundingClientRect(),r=g.getBoundingClientRect();
  tip.textContent=`${x.title}: ${x.v} ${x.v===1?'Fang':'Fänge'}${x.s!=null?` · ${x.s} Session${x.s===1?'':'s'}`:''}`;tip.hidden=false;tip.style.left=Math.max(0,Math.min(r.left-b.left+r.width/2-80,b.width-170))+'px';
  sv.querySelectorAll('.bf.on').forEach(z=>z.classList.remove('on'));g.querySelector('.bf')?.classList.add('on')};
 sv.addEventListener('pointerover',on);sv.addEventListener('pointerdown',on);sv.addEventListener('pointerleave',()=>{tip.hidden=true;sv.querySelectorAll('.bf.on').forEach(z=>z.classList.remove('on'))})})}

/* ---------- Darstellung ---------- */
const css=document.createElement('style');css.textContent=`
#stats{--gap:12px}#stats .sh{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin:2px 0 10px}#stats .sh h2{margin:0;font-size:22px}
#stats .sf{display:grid;grid-template-columns:1fr 1fr;gap:8px}#stats .sf label{margin:0;font-size:12.5px}#stats .sf select,#stats .sf input{min-height:44px;padding:10px;margin-top:4px}
#stats .sfc{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}#stats .sfc[hidden]{display:none}
#stats .chip{display:inline-flex;align-items:center;gap:6px;margin-top:10px;padding:5px 10px;border-radius:999px;background:var(--card2);border:1px solid var(--line);font-size:12.5px;color:var(--mu);max-width:100%}
#stats .kpi{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:14px 0 10px}@media(min-width:640px){#stats .kpi{grid-template-columns:repeat(4,1fr)}}
#stats .kc{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:12px 14px;min-width:0}#stats .kc .kl{display:flex;align-items:center;gap:7px;font-size:12.5px;color:var(--mu)}#stats .kc .ic{width:16px;height:16px;color:var(--ac)}
#stats .kc b{display:block;font-size:24px;line-height:1.15;margin:6px 0 2px;font-variant-numeric:tabular-nums}#stats .kc small{display:block;font-size:11.5px;line-height:1.3}#stats .kc b.na{font-size:18px;color:var(--mu)}
#stats .mini{display:grid;grid-template-columns:repeat(4,1fr);background:var(--card);border:1px solid var(--line);border-radius:16px;margin-bottom:14px}#stats .mini div{padding:10px 6px;text-align:center;font-size:11.5px;color:var(--mu);min-width:0}#stats .mini div+div{border-left:1px solid var(--line)}#stats .mini b{display:block;font-size:17px;color:var(--tx);font-variant-numeric:tabular-nums}
#stats .sec{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:14px 16px;margin-bottom:14px}#stats .sec>h3{margin:0 0 2px;font-size:16px}#stats .sec>.sd{margin:0 0 10px;font-size:12.5px;color:var(--mu)}
#stBody>.empty{margin-top:12px}#stats .empty{display:flex;gap:10px;align-items:flex-start;padding:12px;border-radius:12px;background:var(--card2);font-size:13.5px;color:var(--mu)}#stats .empty .ic{width:18px;height:18px;flex:none;margin-top:1px}
#stats .rl{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 10px;padding:9px 0;border-top:1px solid var(--line);font-size:14px}#stats .rl:first-of-type{border-top:0}#stats .rl .n{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#stats .rl .v{font-variant-numeric:tabular-nums;font-weight:600;text-align:right}
#stats .rl .tr{grid-column:1/-1;height:6px;border-radius:3px;background:var(--card2);overflow:hidden}#stats .rl .tr i{display:block;height:100%;background:var(--ac);border-radius:3px}#stats .rl small{grid-column:1/-1;color:var(--mu);font-size:12px}
#stats .kv{display:grid;grid-template-columns:1fr 1fr;gap:8px}#stats .kv div{background:var(--card2);border-radius:12px;padding:9px 11px;font-size:12px;color:var(--mu);min-width:0}#stats .kv b{display:block;font-size:16px;color:var(--tx);margin-top:2px;font-variant-numeric:tabular-nums}
#stats .snote{font-size:12px;color:var(--mu);margin:10px 0 0;line-height:1.45}#stats a.lk,#stats button.lk{color:var(--ac);background:none;border:0;padding:0;font:inherit;font-size:12.5px;cursor:pointer;text-decoration:underline;text-underline-offset:2px}
#stats .rec{display:grid;grid-template-columns:auto minmax(0,1fr);gap:2px 12px;align-items:center;padding:10px 0;border-top:1px solid var(--line)}#stats .rec:first-of-type{border-top:0}#stats .rec .ri{grid-row:1/3;width:34px;height:34px;border-radius:10px;background:var(--card2);display:grid;place-items:center;color:var(--ac)}#stats .rec .ri .ic{width:17px;height:17px}
#stats .rec span{font-size:12.5px;color:var(--mu)}#stats .rec b{font-size:15px;overflow:hidden;text-overflow:ellipsis}
#stats details.sec>summary{font-size:16px;font-weight:700;padding:0;list-style:none;display:flex;justify-content:space-between;align-items:center}#stats details.sec>summary::after{content:'▾';color:var(--mu)}#stats details.sec[open]>summary::after{content:'▴'}#stats details.sec>summary::-webkit-details-marker{display:none}
.sc{margin:4px 0 0;position:relative}.sc svg{width:100%;height:auto;display:block;touch-action:pan-y}.sc text{font-size:16px;fill:var(--mu)}.sc .vl{fill:var(--tx);font-size:15px}.sc .g{stroke:var(--line);stroke-width:1;opacity:.6}.sc .ax{stroke:var(--line);stroke-width:1.5}
.sc .bf{fill:var(--ac);opacity:.85}.sc .bf.on{opacity:1}.sc .hit{fill:transparent}.sc figcaption{font-size:11.5px;color:var(--mu);margin-top:2px}
.sc .tip{position:absolute;top:0;background:var(--bg2);border:1px solid var(--line);border-radius:10px;padding:4px 9px;font-size:12.5px;white-space:nowrap;box-shadow:var(--sh);pointer-events:none}`;
document.head.appendChild(css);

const ic=n=>`<svg class="ic"><use href="#i-${n}"/></svg>`;
const empty=t=>`<div class="empty">${ic('info')}<span>${t}</span></div>`;
const kc=(icon,label,val,sub,na)=>`<div class="kc"><div class="kl">${ic(icon)}${label}</div><b class="${na?'na':''}">${val}</b><small class="mu">${sub}</small></div>`;
const row=(name,val,frac,sub)=>`<div class="rl"><span class="n">${name}</span><span class="v">${val}</span>${frac!=null?`<span class="tr"><i style="width:${Math.max(frac>0?2:0,frac*100).toFixed(1)}%"></i></span>`:''}${sub?`<small>${sub}</small>`:''}</div>`;
const entryLink=(id,txt)=>`<button class="lk" data-entry="${id}">${txt}</button>`;

function head(){const s=$('#stats');if(s.dataset.b)return;s.dataset.b=1;
 s.innerHTML=`<div class="sh"><h2>Statistik</h2></div>
<div class="sf"><label>Zeitraum<select id="stPer">${PER_L.map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label>
<label>Gewässer<select id="stLake"><option value="all">Beide Seen</option>${LAKES.map(l=>`<option>${esc(l)}</option>`).join('')}</select></label></div>
<div class="sfc" id="stCus" hidden><label>Von<input type="date" id="stFrom"></label><label>Bis<input type="date" id="stTo"></label></div>
<div class="chip" id="stChip" aria-live="polite"></div><div id="stBody"></div>`;
 const upd=()=>{F.per=$('#stPer').value;F.lake=$('#stLake').value;F.from=$('#stFrom').value;F.to=$('#stTo').value;$('#stCus').hidden=F.per!=='custom';render()};
 ['#stPer','#stLake','#stFrom','#stTo'].forEach(q=>$(q).onchange=upd);
 s.addEventListener('click',e=>{const en=e.target.closest('[data-entry]'),se=e.target.closest('[data-sess]'),go=e.target.closest('[data-go]');
  if(en)openEntry(en.dataset.entry);if(se&&window.AngelCal?.openSess)AngelCal.openSess(se.dataset.sess);if(go)show(go.dataset.go)})}
function openEntry(id){const e=entries.find(x=>x.id===id);if(!e)return;hlId=id;show('map');render();map.setView([e.lat,e.lng],Math.max(map.getZoom(),18));const m=markers.get(id);if(m)cluster.zoomToShowLayer(m,()=>m.openPopup())}

function render(){if(!$('#stats'))return;head();const C=calc(),[a,b]=C.range;
 const td=bDay(Date.now()),rTxt=F.per==='all'?'Gesamtzeitraum':`${PER[F.per]}: ${dayDe(a<'0001'?'':a)} – ${dayDe(b>td?td:b)}`;
 $('#stChip').innerHTML=`${ic('cal')}<span>${esc(rTxt)} · ${esc(F.lake==='all'?'Beide Seen':F.lake)}</span>`;
 const hasAny=C.E.length||C.S.length;let h='';
 if(!hasAny)h+=empty(F.per==='all'&&F.lake==='all'?'Noch keine Einträge vorhanden. Sobald du Fänge, Kontakte und Angelsessions dokumentierst, erscheint hier deine Statistik.':'Im gewählten Zeitraum bzw. Gewässer sind keine Einträge oder Sessions vorhanden.');
 const nS=C.valid.length;
 h+=`<div class="kpi">${kc('timer','Angel-Sessions',C.S.length?fmt(C.S.length):'–',C.S.length?`${C.withCatch} mit Fang`:'noch keine beendet',!C.S.length)}
${kc('cal','Angelstunden',nS?hrs(C.hours):'–',nS?`aus ${nS} Session${nS===1?'':'s'}`:'Zeit wird über Sessions erfasst',!nS)}
${kc('check','Fänge',fmt(C.caught.length),C.caught.length?`${C.cIn.length} während Sessions`:'als „Gefangen“ eingetragen')}
${kc('chart','Fänge pro Stunde',C.catchRate!=null?fmt(C.catchRate,2):'–',C.catchRate!=null?'nur Sessions mit gültiger Zeit':nS?'noch zu wenig Angelzeit (unter 1 h)':'benötigt beendete Sessions',C.catchRate==null)}</div>
<div class="mini"><div><b>${C.distinct||'–'}</b>Fischarten</div><div><b>${C.bites.length}</b>Bisse</div><div><b>${C.lost.length}</b>Verloren</div><div><b>${C.seen.length}</b>Gesehen</div></div>`;
 // 1 Fangentwicklung
 const tr=C.trend;
 h+=`<div class="sec"><h3>Fangentwicklung</h3><p class="sd">Dokumentierte Fänge pro ${tr?tr.unit:'Monat'}${tr?.cut?` (letzte 24 Monate; ${tr.cut} ältere Monate nicht dargestellt)`:''}</p>
${tr&&tr.buckets.length?barChart(tr.buckets,{unit:'Anzahl Fänge',label:`Fänge pro ${tr.unit}`})+(tr.buckets.filter(x=>x.v).length<2?`<p class="snote">Bisher nur in einem ${tr.unit==='Monat'?'Monat':'Zeitraum'} Fänge – mit weiteren Fängen wird die Entwicklung aussagekräftiger.</p>`:''):empty('Sobald du Fänge mit „Gefangen“ dokumentierst, siehst du hier deine Fangentwicklung.')}</div>`;
 // 2 Fischarten
 const mxS=C.species[0]?.n||1;
 h+=`<div class="sec"><h3>Fischarten</h3><p class="sd">Gefangene Fische nach Art · Anteil an allen Fängen</p>
${C.species.length?C.species.map(s=>{const big=s.lenM?`Größter: ${entryLink(s.lenM.id,fmt(s.lenM.v)+' cm')} (gemessen)`:s.lenE?`Größter: ${entryLink(s.lenE.id,'ca. '+fmt(s.lenE.v)+' cm')} (geschätzt)`:'';
 return row(esc(s.name),`${s.n} · ${fmt(s.n/C.caught.length*100)} %`,s.n/mxS,[big,s.guess?`${s.guess}× als Vermutung eingetragen`:''].filter(Boolean).join(' · '))}).join(''):empty('Noch keine Fänge im gewählten Zeitraum. Trage beim Fang die Fischart ein, dann erscheint hier deine Rangliste.')}
${C.species.some(s=>s.name===UNKNOWN)?'<p class="snote">„Nicht bestimmt“: Fänge ohne Fischart oder mit „Unbekannt“.</p>':''}</div>`;
 // 3 Angelzeit & Effizienz
 const sm=Object.entries(C.sessPerMonth),notes=[];
 if(C.running)notes.push('Eine laufende Session zählt erst nach dem Beenden.');if(C.invalid)notes.push(`${C.invalid} Session${C.invalid>1?'s':''} mit unplausibler Zeitangabe (Ende vor Beginn oder länger als ${MAX_SESSION_H} h) ${C.invalid>1?'sind':'ist'} ausgeschlossen.`);
 if(C.noLake)notes.push(`${C.noLake} Session${C.noLake>1?'s':''} ohne erkennbares Gewässer ${C.noLake>1?'sind':'ist'} beim Gewässerfilter nicht enthalten.`);if(C.outside)notes.push(`${C.outside} Fang/Fänge außerhalb von Sessions zählen bei den Fängen mit, aber nicht bei den Raten pro Stunde.`);
 h+=`<div class="sec"><h3>Angelzeit und Effizienz</h3><p class="sd">Nur beendete Sessions mit gültiger Start- und Endzeit</p>
${nS?`<div class="kv"><div>Gesamte Angelzeit<b>${hrs(C.hours)}</b></div><div>Ø Dauer pro Session<b>${hrs(C.avgDur)}</b></div><div>Ø Fänge pro Session<b>${fmt(C.avgCatch,1)}</b></div><div>Sessions mit Fang<b>${C.withCatch} von ${nS}</b></div>
<div>Fänge pro Angelstunde<b>${C.catchRate!=null?fmt(C.catchRate,2):'–'}</b></div><div>Kontakte pro Angelstunde<b>${C.contactRate!=null?fmt(C.contactRate,2):'–'}</b></div></div>
${sm.length>1?`<p class="sd" style="margin:14px 0 0">Sessions pro Monat: ${sm.sort().map(([k,v])=>`${MON[+k.slice(5)-1]} ${k.slice(2,4)}: <b style="color:var(--tx)">${v}</b>`).join(' · ')}</p>`:''}`:empty('Starte auf der Karte mit der Stoppuhr eine Session und beende sie nach dem Angeln. Dann werden Angelzeit, Fänge pro Stunde und Durchschnittswerte berechnet.')}
${notes.length?`<p class="snote">${notes.join(' ')}</p>`:''}</div>`;
 // 4 Angelkontakte
 const ev=[['Biss',C.bites.length],['Fisch verloren',C.lost.length],['Fisch gefangen',C.caught.length],['Fisch gesehen',C.seen.length]],tot=ev.reduce((s,x)=>s+x[1],0),mx=Math.max(1,...ev.map(x=>x[1]));
 h+=`<div class="sec"><h3>Angelkontakte</h3><p class="sd">${tot} dokumentierte Ereignisse</p>
${tot?ev.map(([l,n])=>row(l,`${n}${tot?` · ${fmt(n/tot*100)} %`:''}`,n/mx)).join('')+`<div class="kv" style="margin-top:12px"><div>Landequote<b>${C.landing!=null?fmt(C.landing*100)+' %':'–'}</b></div><div>Gehakte Fische<b>${C.hooked}</b></div></div>
<p class="snote">Die Zahlen beschreiben eingetragene Ereignisse, nicht unterschiedliche Fische – ein Fisch kann z. B. erst als Biss und dann als „verloren“ eingetragen sein. <b>Landequote</b> = gefangen ÷ (gefangen + verloren), also der Anteil gehakter Fische, die gelandet wurden. Reine Bisse zählen nicht mit${C.landing==null?`; berechnet ab ${MIN_QUOTE} gehakten Fischen`:''}.</p>`:empty('Hier erscheinen Bisse, verlorene, gefangene und gesehene Fische, sobald du sie auf der Karte einträgst.')}</div>`;
 // 5 Rekorde
 const R=C.rec,rec=[];
 if(R.lenMeas)rec.push(['fish','Größter Fisch (gemessen)',`${entryLink(R.lenMeas.id,fmt(R.lenMeas.lenMeas)+' cm')} · ${esc(spName(R.lenMeas.species))}`,dayDe(R.lenMeas.date)]);
 else if(R.lenEst)rec.push(['fish','Größter Fisch (nur geschätzt)',`${entryLink(R.lenEst.id,'ca. '+fmt(R.lenEst.lenEst)+' cm')} · ${esc(spName(R.lenEst.species))}`,dayDe(R.lenEst.date)]);
 if(R.weight)rec.push(['check','Höchstes eingetragenes Gewicht (geschätzt)',`${entryLink(R.weight.id,R.weight.weight>=1000?fmt(R.weight.weight/1000,2)+' kg':fmt(R.weight.weight)+' g')} · ${esc(spName(R.weight.species))}`,dayDe(R.weight.date)]);
 if(R.species.length)rec.push(['list','Häufigste Fischart',esc(R.species.map(s=>s.name).join(', ')),`${R.species[0].n} Fänge`]);
 if(R.longest)rec.push(['timer','Längste Session',`<button class="lk" data-sess="${R.longest.id}">${hrs((R.longest.end-R.longest.start)/H)}</button>`,dayDe(bDay(R.longest.start))]);
 if(R.month)rec.push(['cal','Erfolgreichster Monat',`${MONL[+R.month.k.slice(5)-1]} ${R.month.k.slice(0,4)}`,`${R.month.n} Fänge${R.month.ties>1?` (gleichauf mit ${R.month.ties-1} weiteren)`:''}`]);
 h+=`<div class="sec"><h3>Persönliche Rekorde</h3><p class="sd">Nur gespeicherte Werte · antippen öffnet den Eintrag</p>
${rec.length?rec.map(([i,l,v,s])=>`<div class="rec"><span class="ri">${ic(i)}</span><span>${l}${s?' · '+s:''}</span><b>${v}</b></div>`).join(''):empty('Rekorde erscheinen, sobald Fänge mit Länge oder Gewicht bzw. beendete Sessions vorhanden sind.')}
${R.weight?'<p class="snote">Gewichte werden in der App als Schätzung erfasst („Gewicht (g, geschätzt)“) und sind daher nicht gewogen.</p>':''}${!R.lenMeas&&R.lenEst?'<p class="snote">Es gibt noch keine gemessene Länge – angezeigt wird die größte geschätzte Länge.</p>':''}</div>`;
 // 6 Wetter & Beißfenster
 h+=wxSection(a,b);
 $('#stBody').innerHTML=h;bindCharts($('#stBody'))}

function wxSection(a,b){if(!window.WX?.analyze)return'';
 const td=bDay(Date.now()),from=a>'0001'?AngelCal.berlinMs(a,'00:00'):0,to=b<'9999'?AngelCal.berlinMs(AngelCal.addD(b>td?td:b,1),'00:00'):Infinity;
 const A=WX.analyze({per:'all',from,to,lake:F.lake==='all'?'all':F.lake===LAKES[1]?'klein':'gross',sp:'all'}),cIn=A.inS.filter(e=>e.result==='caught').length;
 const ok=A.S.length>=MIN_WX_SESS&&cIn>=MIN_WX_CATCH;
 let h=`<details class="sec"><summary>Wetter und Beißfenster</summary><p class="sd" style="margin-top:8px">Fänge pro Angelstunde unter verschiedenen Bedingungen (Wetter: Open-Meteo-Modellwerte)</p>`;
 if(!ok)return h+empty(`Noch nicht genügend Daten für eine aussagekräftige Auswertung. Benötigt werden mindestens ${MIN_WX_SESS} beendete Sessions und ${MIN_WX_CATCH} Fänge während Sessions (bisher ${A.S.length} bzw. ${cIn}).`)+`<p class="snote"><button class="lk" data-go="wx">Zum Bereich „Wetter &amp; Beißfenster“</button></p></details>`;
 const blk=k=>{const f=A.facts.find(z=>z.k===k),rows=f.rows.filter(r=>r.ok);if(!rows.length)return'';const mx=Math.max(1e-9,...rows.map(r=>r.crate));
  return`<p class="sd" style="margin:12px 0 0;color:var(--tx);font-weight:600">${esc(f.n)}</p>`+rows.map(r=>row(esc(r.c),`${fmt(r.crate,2)}/h`,r.crate/mx,`${r.caught} Fänge in ${fmt(r.h,1)} h`)).join('')};
 const sw=A.S.filter(x=>A.inS.some(e=>e.sessionId===x.id&&e.result==='caught')).length;
 return h+`<div class="kv"><div>Sessions mit Fang<b>${sw} von ${A.S.length}</b></div><div>Ø Fänge pro Angelstunde<b>${fmt(cIn/A.hours,2)}</b></div></div>${blk('block')}${blk('wspd')}${blk('pbin')}${blk('temp')}
<p class="snote">Nur Kategorien mit mindestens 3 Angelstunden und 2 Sessions. Unterschiede zeigen Zusammenhänge in deinen Daten, keine bewiesenen Ursachen. <button class="lk" data-go="wx">Ausführliche Auswertung</button></p></details>`}

window.Stat={calc,render,range,F};
})();
