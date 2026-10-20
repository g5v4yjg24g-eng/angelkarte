/* Fischereirecht NRW – Daten fest eingebaut (offline nutzbar). Jede Angabe: Quelle + Prüfstand. */
(()=>{
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const CHECKED='2026-10-18',STALE_DAYS=180;
const LAW='https://recht.nrw.de/lrgv/rechtsverordnung/03072026-landesfischereiverordnung-lfischvo';
const LAWS='Landesfischereiverordnung (LFischVO), Fassung gültig ab 03.07.2026 (zuletzt geändert durch Art. 2 der VO vom 01.07.2026, GV. NRW. S. 414)';
const RLPDF='https://www.lanuk.nrw.de/fileadmin/lanuvpubl/3_fachberichte/LANUV-Fachbericht_152.pdf';
const RLS='LANUV-Fachbericht 152: Rote Liste und Artenverzeichnis der Fische und Rundmäuler in NRW, 5. Fassung, Bearbeitungsstand März 2020 (Tabellenkopf im Dokument: „RL 2024“)';
const KULA='https://www.kuladig.de/Objektansicht/Drucken/KLD-333686';
const AA1='https://www.alleangeln.de/gewaesser/gro%C3%9Fer-de-witt-see',AA2='https://www.alleangeln.de/gewaesser/kleiner-de-witt-see';
const de=d=>d.split('-').reverse().join('.');

/* ---------- Gesetz: LFischVO §§ 1–3 (Quelle: recht.nrw.de, siehe LAW) ---------- */
const G=[['Stör','Acipenser sturio L.'],['Schneider','Alburnoides bipunctatus Bloch'],['Maifisch','Alosa alosa L.'],['Finte','Alosa fallax Lacépède'],['Steinbeißer','Cobitis sp. (in NRW: C. taenia inkl. Hybriden)'],['Nordseeschnäpel, Wandermaräne','Coregonus oxyrinchus L.'],['Groppe, Koppe','Cottus sp.'],['Moderlieschen','Leucaspius delineatus Heckel'],['Quappe','Lota lota L.'],['Schlammpeitzger','Misgurnus fossilis L.'],['Schmerle','Barbatula barbatula L.'],['Elritze','Phoxinus phoxinus L.'],['Zwergstichling','Pungitius pungitius L.'],['Bitterling','Rhodeus amarus Bloch'],['Lachs','Salmo salar L.'],['Meerforelle','Salmo trutta forma trutta L.'],['Flussneunauge','Lampetra fluviatilis L.'],['Bachneunauge','Lampetra planeri Bloch'],['Meerneunauge','Petromyzon marinus L.']];
// [Name, wiss. Name, Mindestmaß cm, Schonzeit [Monat,Tag,Monat,Tag]|0, Hinweis, Paragraf, nur regional]
const B=[
['Aal','Anguilla anguilla L.',50,[10,1,3,1],'Die Schonzeit gilt nur im Rheinhauptstrom (ohne Nebengewässer).','§ 2 Nr. 2, § 3',1],
['Äsche','Thymallus thymallus L.',30,[3,1,4,30],'Zusätzlich ganzjährige Entnahmeverbote in Gewässerabschnitten, die die oberste Fischereibehörde per Verwaltungsvorschrift festlegt (§ 1a). Diese Abschnitte sind hier NICHT erfasst.','§ 1a, § 2 Nr. 3, § 3'],
['Bachforelle','Salmo trutta forma fario L.',25,[10,20,3,15],'','§ 2 Nr. 1, § 3'],
['Seeforelle','Salmo trutta forma lacustris L.',50,[10,20,3,15],'','§ 2 Nr. 1, § 3'],
['Seesaibling','Salvelinus alpinus L.',30,[10,20,3,15],'','§ 2 Nr. 1, § 3'],
['Nase','Chondrostoma nasus L.',30,[3,1,4,30],'','§ 2 Nr. 3, § 3'],
['Zander','Sander lucioperca L.',40,[4,1,5,31],'','§ 2 Nr. 4, § 3'],
['Barbe','Barbus barbus L.',35,[5,15,6,15],'','§ 2 Nr. 5, § 3'],
['Hecht','Esox lucius L.',45,[2,15,4,30],'','§ 2 Nr. 6, § 3'],
['Karpfen','Cyprinus carpio L.',35,0,'','§ 3'],
['Aland','Leuciscus idus L.',25,0,'','§ 3'],
['Schleie','Tinca tinca L.',25,0,'','§ 3']];
// Arten ohne Eintrag in §§ 1–3 (wiss. Namen aus der Roten Liste, LANUV)
const N=[['Flussbarsch','Perca fluviatilis'],['Rotauge','Rutilus rutilus'],['Rotfeder','Scardinius erythrophthalmus'],['Brassen (Brasse)','Abramis brama'],['Wels','Silurus glanis'],['Giebel','Carassius gibelio'],['Döbel','Squalius cephalus']];
const ROWS=[...G.map(([n,w])=>({n,w,k:'g',p:'§ 1'})),...B.map(([n,w,min,sz,note,p,reg])=>({n,w,min,sz,note,p,reg,k:'b'})),...N.map(([n,w])=>({n,w,k:'n',p:'§§ 1–3 (Art dort nicht aufgeführt)'}))].sort((a,b)=>a.n.localeCompare(b.n,'de'));
const OTHER=[
['§ 3','Maßgeblich ist die Länge von der Kopfspitze bis zum Ende des längsten Teils der Schwanzflosse. Untermaßige Fische dürfen nicht entnommen werden.'],
['§ 4 Abs. 1','Fische in Schonzeit oder unter Mindestmaß sind unverzüglich und mit gebotener Sorgfalt ins Fanggewässer zurückzusetzen. Muss mit dem Eingehen gerechnet werden: töten und vergraben, sofern keine andere Beseitigung vorgeschrieben ist. Verwertung auch bei tot angelandeten Tieren verboten.'],
['§ 6','Köderfische nur in dem Gewässer verwenden, aus dem sie stammen (oder verbundenen Gewässern). Lebende Köderfische dürfen weder mitgeführt noch zum Fang verwendet werden.'],
['§ 5 Abs. 1','Die in §§ 1–3 genannten Arten dürfen nicht als Köderfische oder Fischköder abgegeben werden.'],
['§ 15','Vom 1. April bis 31. Mai ist die Entnahme von Wasserpflanzen, Schlamm, Erde, Sand, Kies und Steinen nur mit Zustimmung des Fischereiberechtigten zulässig.'],
['§ 22a/22b (neu seit 03.07.2026)','Fischereiabgabe: 10 € je Kalenderjahr bzw. 30 € für fünf Jahre. Der Nachweis ist bei der Fischerei mitzuführen und auf Verlangen vorzuzeigen.']];
const md=d=>(d.getMonth()+1)*100+d.getDate();
const inR=(r,t)=>{const a=r[0]*100+r[1],b=r[2]*100+r[3];return a<=b?t>=a&&t<=b:t>=a||t<=b};
const rng=r=>`${r[1]}.${r[0]}. – ${r[3]}.${r[2]}.`;
function status(r,t,at){t=t||md(new Date());at=at||'derzeit';
 if(r.k==='g')return['bad','ganzjährig geschont','Ganzjährig geschont – keine Entnahme (§ 1).'];
 if(r.k==='n')return['mu','keine Regelung in LFischVO','Keine landesweite Schonzeit und kein Mindestmaß in §§ 1–3 LFischVO. ACHTUNG: Das ist keine Entnahmeerlaubnis – Erlaubnisschein, Gewässerregeln oder Schutzgebietsrecht können mehr verbieten.'];
 if(!r.sz)return['ok','keine Schonzeit','Keine befristete Schonzeit. Mindestmaß gilt ganzjährig.'];
 const a=inR(r.sz,t);
 if(r.reg)return['mu',a?'im Rhein: Schonzeit aktiv':'keine Schonzeit aktiv',`Landesweit keine Schonzeit. Im Rheinhauptstrom (${rng(r.sz)}) ist sie ${at} ${a?'AKTIV':'nicht aktiv'}.`];
 return a?['bad','Schonzeit aktiv','Landesweite Schonzeit AKTIV ('+rng(r.sz)+') – keine Entnahme.']:['ok','keine Schonzeit aktiv',(at==='derzeit'?'Derzeit':'Am Termintag')+' keine landesweite Schonzeit (Schonzeit: '+rng(r.sz)+'). Mindestmaß beachten.']}

/* ---------- Rote Liste NRW (Quelle: LANUV-Fachbericht 152, Tabelle 6) ---------- */
const RL=[['Aal','Anguilla anguilla','2S'],['Aland','Leuciscus idus','*'],['Äsche','Thymallus thymallus','3'],['Atlantischer Lachs','Salmo salar','2S'],['Bachforelle','Salmo trutta fario','*'],['Bachneunauge','Lampetra planeri','*'],['Bachsaibling','Salvelinus fontinalis','♦'],['Barbe','Barbus barbus','G'],['Bitterling','Rhodeus amarus','V'],['Blaubandbärbling','Pseudorasbora parva','♦'],['Blaufelchen','Coregonus wartmanni','♦'],['Brassen','Abramis brama','*'],['Döbel','Squalius cephalus','*'],['Dreistachliger Stichling','Gasterosteus aculeatus','*'],['Elritze','Phoxinus phoxinus','*'],['Finte','Alosa fallax','0'],['Flunder','Platichthys flesus','R'],['Flussbarsch','Perca fluviatilis','*'],['Flussgrundel','Neogobius fluviatilis','♦'],['Flussneunauge','Lampetra fluviatilis','1'],['Giebel','Carassius gibelio','*'],['Groppe','Cottus gobio','*'],['Große Maräne','Coregonus lavaretus','♦'],['Gründling','Gobio gobio','*'],['Güster','Blicca bjoerkna','*'],['Hasel','Leuciscus leuciscus','V'],['Hecht','Esox lucius','V'],['Karausche','Carassius carassius','1'],['Karpfen','Cyprinus carpio','D'],['Kaulbarsch','Gymnocephalus cernua','V'],['Kessler-Grundel','Ponticola kessleri','♦'],['Kleine Maräne','Coregonus albula','♦'],['Maifisch','Alosa alosa','1'],['Marmorierte Grundel','Proterorhinus semilunaris','♦'],['Meerforelle','Salmo trutta trutta','D'],['Meerneunauge','Petromyzon marinus','1'],['Moderlieschen','Leucaspius delineatus','G'],['Nase','Chondrostoma nasus','3'],['Neunstachliger Stichling','Pungitius pungitius','*'],['Ostasiatischer Schlammpeitzger','Misgurnus anguillicaudatus','♦'],['Quappe','Lota lota','2S'],['Rapfen','Leuciscus aspius','♦'],['Regenbogenforelle','Oncorhynchus mykiss','♦'],['Rheingroppe','Cottus rhenanus','D'],['Rotauge','Rutilus rutilus','*'],['Rotfeder','Scardinius erythrophthalmus','3'],['Schlammpeitzger','Misgurnus fossilis','1'],['Schleie','Tinca tinca','V'],['Schmerle','Barbatula barbatula','*'],['Schnäpel (Nordsee-/Ostseeschnäpel)','Coregonus oxyrinchus/maraena','1'],['Schneider','Alburnoides bipunctatus','3'],['Schwarzmundgrundel','Neogobius melanostomus','♦'],['Seesaibling','Salvelinus umbla','♦'],['Sonnenbarsch','Lepomis gibbosus','♦'],['Stachelgroppe','Cottus perifretum','D'],['Steinbeißer','Cobitis taenia','3'],['Stör','Acipenser sturio','0'],['Stromgründling','Romanogobio belingi','♦'],['Ukelei','Alburnus alburnus','V'],['Wels','Silurus glanis','*'],['Zährte','Vimba vimba','1'],['Zander','Sander lucioperca','♦']];
const CAT={'0':['ausgestorben oder verschollen','bad'],'1':['vom Aussterben bedroht','bad'],'2':['stark gefährdet','or'],'3':['gefährdet','ye'],'G':['Gefährdung unbekannten Ausmaßes','ye'],'R':['durch extreme Seltenheit (potenziell) gefährdet','ye'],'V':['Vorwarnliste (noch nicht gefährdet)','bl'],'D':['Daten unzureichend','bl'],'*':['ungefährdet','ok'],'♦':['nicht bewertet (z. B. in NRW gebietsfremde Art)','mu']};
const catLabel=k=>(k==='*'?'ungefährdet':k==='♦'?'nicht bewertet':k)+'';
const RLLIST=new Set(['0','1','2','3','G','R']);

/* ---------- Oberfläche ---------- */
const css=document.createElement('style');css.textContent=`.lw{background:var(--card);border:1px solid var(--line);border-radius:10px;margin-bottom:8px;padding:2px 12px}.lw summary{padding:12px 0;cursor:pointer;line-height:1.9}.lw>div{padding:0 0 12px;font-size:14px;line-height:1.5}.bd{display:inline-block;border-radius:12px;padding:1px 9px;font-size:12px;margin-left:6px;color:#111;white-space:nowrap}.bd.bad{background:#f87171}.bd.ok{background:#86efac}.bd.mu{background:#cbd5e1}.bd.or{background:#fb923c}.bd.ye{background:#facc15}.bd.bl{background:#93c5fd}.note{background:var(--warn);border-radius:8px;padding:8px 10px;font-size:13px;margin:8px 0;line-height:1.45}.lwb a{color:var(--ac)}nav button{font-size:13px;line-height:1.15;padding:10px 2px}`;document.head.appendChild(css);
const days=()=>Math.floor((Date.now()-new Date(CHECKED))/864e5);
function head(){const d=days();return `<h3 style="margin-top:4px">Fischereirecht NRW</h3><div class="note"><b>Zuletzt geprüft: ${de(CHECKED)}</b> (am Original abgeglichen). Die Daten sind fest in die App eingebaut, es gibt keine automatische Aktualisierung; nach einmaligem Laden sind sie offline verfügbar.${d>STALE_DAYS?`<br><b>⚠ Die Prüfung liegt ${d} Tage zurück – Daten können veraltet sein. Bitte vor dem Angeln die Quelle prüfen.</b>`:''}<br>Keine Rechtsberatung: Maßgeblich sind der amtliche Text und dein Erlaubnisschein.</div>`}
const q=(id)=>$(id)?$(id).value.toLowerCase():'';
function law(){const t=q('#lq'),fs=$('#lf').value,fm=$('#lm').value;
 const rows=ROWS.filter(r=>(r.n+' '+r.w).toLowerCase().includes(t)&&(fm===''||(fm==='with'?r.min>0:!r.min))&&(()=>{const s=status(r);return fs===''||(fs==='act'&&s[0]==='bad')||(fs==='ganz'&&r.k==='g')||(fs==='befr'&&r.sz)||(fs==='none'&&(r.k==='n'||(r.k==='b'&&!r.sz)))})());
 $('#llist').innerHTML=(rows.length?'':'<p class="mu">Keine Treffer.</p>')+rows.map(r=>{const[c,b,tx]=status(r);return `<details class="lw"><summary><b>${esc(r.n)}</b><span class="bd ${c}">${b}</span>${r.min?`<span class="bd mu">${r.min} cm</span>`:''}</summary><div><i>${esc(r.w)}</i><br><b>Status heute:</b> ${esc(tx)}<br><b>Mindestmaß:</b> ${r.min?r.min+' cm (§ 3)':'kein Mindestmaß in § 3'}<br><b>Befristete Schonzeit:</b> ${r.k==='g'?'– (ganzjährig geschützt)':r.sz?rng(r.sz)+(r.reg?' (nur Rheinhauptstrom)':''):'keine'}${r.note?`<br>${esc(r.note)}`:''}<br><small class="mu">Quelle: ${r.p} LFischVO · ${LAWS} · <a href="${LAW}" target="_blank" rel="noopener">recht.nrw.de</a> · geprüft ${de(CHECKED)}</small></div></details>`}).join('')}
function rl(){const t=q('#rq'),f=$('#rf').value;
 const rows=RL.filter(r=>(r[0]+' '+r[1]).toLowerCase().includes(t)&&(f===''||(f==='rl'?RLLIST.has(r[2][0]):r[2][0]===f)));
 $('#rlist').innerHTML=(rows.length?'':'<p class="mu">Keine Treffer.</p>')+rows.map(([n,w,k])=>{const b=k[0],[tx,c]=CAT[b];return `<details class="lw"><summary><b>${esc(n)}</b><span class="bd ${c}">${catLabel(b)}${k.length>1?'S':''}</span></summary><div><i>${esc(w)}</i><br><b>Kategorie ${esc(k==='*'?'* (ungefährdet)':k==='♦'?'♦ (nicht bewertet)':k)}:</b> ${tx}${k.length>1?'<br><b>Zusatz S:</b> dank Schutzmaßnahmen gleich, geringer oder nicht mehr gefährdet.':''}${b==='♦'?'<br>„Nicht bewertet“ heißt nicht „ungefährdet“ (z. B. Zander und Rapfen gelten in NRW als gebietsfremd).':''}<br><small class="mu">Stand: ${esc(RLS)} · <a href="${RLPDF}" target="_blank" rel="noopener">Quelle (PDF)</a> · geprüft ${de(CHECKED)}</small></div></details>`}).join('')}
const opt=(a)=>a.map(([v,l])=>`<option value="${v}">${l}</option>`).join('');
function build(){
 $('#law').innerHTML=`<div class="lwb">${head()}
<div class="row" id="lwtabs" style="margin:8px 0"><button class="btn p" data-s="law">Gesetz</button><button class="btn" data-s="rl">Rote Liste</button><button class="btn" data-s="dw">De Witt See</button><button class="btn" data-s="src">Quellen</button></div>
<div id="p-law"><div class="note"><b>Gesetzliche Fang- und Entnahmebestimmungen</b> (§§ 1–3 LFischVO). Stand: ${esc(LAWS)}.</div>
<input id="lq" placeholder="Fischart suchen …"><div class="grid"><label>Schonzeit<select id="lf">${opt([['','Alle'],['act','Aktuell geschont (inkl. ganzjährig)'],['ganz','Nur ganzjährig geschützt'],['befr','Mit befristeter Schonzeit'],['none','Ohne Schonzeit']])}</select></label><label>Mindestmaß<select id="lm">${opt([['','Alle'],['with','Mit Mindestmaß'],['without','Ohne Mindestmaß']])}</select></label></div>
<div id="llist"></div>
<h3>Weitere Vorschriften (Auszug)</h3>${OTHER.map(([p,t])=>`<div class="lw"><div style="padding-top:10px"><b>${p}</b><br>${esc(t)}</div></div>`).join('')}
<p class="mu"><small>Nicht erfasst: Krebse und Muscheln (§ 1), die Äschen-Schutzabschnitte (§ 1a), Regeln nach Landesfischereigesetz und Erlaubnisschein. Quelle: <a href="${LAW}" target="_blank" rel="noopener">${LAW}</a></small></p></div>
<div id="p-rl" hidden><div class="note"><b>Rote Liste ≠ Fangbestimmung.</b> Sie beschreibt nur den Gefährdungsstatus einer Art in NRW. Ob du einen Fisch entnehmen darfst, regeln LFischVO und Erlaubnisschein – siehe Reiter „Gesetz“. Datenstand: ${esc(RLS)}. Ob es eine neuere Fassung gibt, wurde nicht geprüft.</div>
<input id="rq" placeholder="Fischart suchen …"><label>Gefährdungskategorie<select id="rf">${opt([['','Alle'],['rl','Nur Rote-Liste-Arten (0, 1, 2, 3, G, R)'],['0','0 ausgestorben/verschollen'],['1','1 vom Aussterben bedroht'],['2','2 stark gefährdet'],['3','3 gefährdet'],['G','G Gefährdung unbekannten Ausmaßes'],['R','R extrem selten'],['V','V Vorwarnliste'],['D','D Daten unzureichend'],['*','* ungefährdet'],['♦','♦ nicht bewertet']])}</select></label>
<div id="rlist"></div></div>
<div id="p-dw" hidden></div>
<div id="p-src" hidden></div></div>`;
 $('#lq').oninput=law;$('#lf').onchange=law;$('#lm').onchange=law;$('#rq').oninput=rl;$('#rf').onchange=rl;
 $('#lwtabs').onclick=e=>{const s=e.target.dataset.s;if(!s)return;document.querySelectorAll('#lwtabs button').forEach(b=>b.classList.toggle('p',b===e.target));['law','rl','dw','src'].forEach(x=>$('#p-'+x).hidden=x!==s);if(s==='dw')dw()};
 law();rl();src()}
const NK='dwNotes';
async function loadNotes(){try{return(typeof dbx==='function'&&await dbx('meta','readonly',s=>s.get(NK)))||{}}catch(e){return{}}}
async function dw(){const n=await loadNotes();
 const lake=(id,name,aa,extra)=>`<div class="lw" style="padding-top:10px"><b>${name}</b><div><b>Belegt (Sekundärquelle):</b> ${extra}<br><b>Eigene Notizen (z. B. Angaben aus deinem Erlaubnisschein):</b><textarea id="n-${id}" rows="4" placeholder="Hier eintragen, was auf deinem Erlaubnisschein steht …">${esc(n[id]?.t||'')}</textarea><small class="mu" id="s-${id}">${n[id]?.d?'Zuletzt von dir gespeichert: '+n[id].d:'Noch nichts eingetragen.'} · Nur auf diesem Gerät gespeichert, nicht in der JSON-Sicherung.</small></div></div>`;
 $('#p-dw').innerHTML=`<div class="note"><b>Gewässerspezifische Regeln – bisher nicht belegt.</b> Für abweichende Mindestmaße, zusätzliche Schonzeiten, Entnahmebeschränkungen oder besondere Angelregeln am Großen und Kleinen De Witt See habe ich keine verlässliche Quelle gefunden. Es werden deshalb keine Regeln angezeigt. Maßgeblich ist der Erlaubnisschein des Fischereiberechtigten bzw. Pächters.</div>
<div class="lw" style="padding-top:10px"><b>Status der Angaben</b><div><span class="bd mu">nicht geprüft</span> abweichende Mindestmaße<br><span class="bd mu">nicht geprüft</span> zusätzliche Schonzeiten<br><span class="bd mu">nicht geprüft</span> Entnahmebeschränkungen / Fangbegrenzungen<br><span class="bd mu">nicht geprüft</span> besondere Angelregeln (Köder, Zeiten, Uferbereiche)</div></div>
${lake('gross','Großer De Wittsee',AA1,`Landschaftsschutzgebiet (<a href="${KULA}" target="_blank" rel="noopener">KuLaDig/LVR</a>, Objekt KLD-333686, dort unter Verweis auf www.npsn.de). Angelverein laut Community-Portal alleangeln.de: ASV Seerose Leuth, Gastkarten verfügbar (<a href="${AA1}" target="_blank" rel="noopener">Seite</a>, <b>ungeprüft</b>, ohne Gewähr).`)}
${lake('klein','Kleiner De Wittsee',AA2,`Naturschutzgebiet (<a href="${KULA}" target="_blank" rel="noopener">KuLaDig/LVR</a>, Objekt KLD-333686, dort unter Verweis auf www.npsn.de). Angelverein laut alleangeln.de: ASV Seerose Leuth (<a href="${AA2}" target="_blank" rel="noopener">Seite</a>, <b>ungeprüft</b>). Für Naturschutzgebiete gelten oft eigene Verordnungen; für diesen See habe ich sie <b>nicht geprüft</b>. Kläre vor dem Angeln, ob und wo dort geangelt werden darf.`)}
<p class="mu"><small>Prüfstand: ${de(CHECKED)}. Nachfragen bei Verein bzw. Fischereiberechtigtem, der Stadt Nettetal oder der unteren Fischereibehörde sind die verlässlichste Quelle.</small></p>`;
 ['gross','klein'].forEach(id=>{$('#n-'+id).onchange=async()=>{const o=await loadNotes();o[id]={t:$('#n-'+id).value,d:new Date().toLocaleDateString('de-DE')};try{await dbx('meta','readwrite',s=>s.put(o,NK));$('#s-'+id).textContent='Gespeichert am '+o[id].d}catch(e){$('#s-'+id).textContent='Speichern fehlgeschlagen: '+e.message}}})}
function src(){$('#p-src').innerHTML=`<div class="lw" style="padding-top:10px"><b>Amtliche Quellen</b><div>• Gesetzliche Bestimmungen: <a href="${LAW}" target="_blank" rel="noopener">Landesfischereiverordnung, Fassung ab 03.07.2026</a> (recht.nrw.de). Auf der Seite sind 7 Fassungen gelistet; geprüft wurde die aktuellste.<br>• Rote Liste: <a href="${RLPDF}" target="_blank" rel="noopener">LANUV-Fachbericht 152</a>, 5. Fassung, Bearbeitungsstand März 2020. Das Erscheinungsjahr steht im geprüften Text nicht eindeutig; die Tabellenüberschrift nennt „RL 2024“.</div></div>
<div class="lw" style="padding-top:10px"><b>Sekundärquellen (nur Hinweise, ungeprüft)</b><div>• KuLaDig/LVR: <a href="${KULA}" target="_blank" rel="noopener">De Wittsee bei Nettetal</a> (Schutzgebietsstatus).<br>• alleangeln.de: <a href="${AA1}" target="_blank" rel="noopener">Großer</a> / <a href="${AA2}" target="_blank" rel="noopener">Kleiner De-Witt-See</a> (Verein, Gastkarten; Community-Portal, ohne Gewähr).</div></div>
<div class="lw" style="padding-top:10px"><b>Hinweise zur Datenerfassung</b><div>• In der PDF-Tabelle der Roten Liste fehlte beim Text-Auslesen das Symbol für „ungefährdet“. Arten mit leerer Kategoriespalte habe ich als „ungefährdet“ gewertet. Das passt zur Legende und zur Summe 16 in Tabelle 8 des Berichts, ersetzt aber nicht den Blick ins Original.<br>• Gesetz und Rote Liste nennen teils unterschiedliche wissenschaftliche Namen (z. B. Seesaibling: <i>S. alpinus</i> in der LFischVO, <i>S. umbla</i> in der Roten Liste); jede Angabe folgt ihrer Quelle.<br>• Die LFischVO ist hier nur in den §§ 1–3 vollständig übernommen. Für alles Weitere gilt der amtliche Text.</div></div>`}

function init(){if(!$('#law'))return;build();$('#nav').addEventListener('click',e=>{if(e.target.dataset.v==='law'){const a=$('#lwtabs .p');law()}})}
window.FischRecht={ROWS,status,md,LAW,LAWS,CHECKED};
init();
})();
