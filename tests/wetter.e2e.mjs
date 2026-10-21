// End-to-End-Test „Wetter & Beißfenster“ (Chromium via Playwright). Open-Meteo wird simuliert – keine echten Abrufe.
// Start: node tests/wetter.e2e.mjs   (benötigt Playwright + http-server, z. B. `npm i -g playwright http-server`)
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), ".."), tmp = mkdtempSync(join(tmpdir(), "wx-e2e-"));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const PORT = 8127, APP = `http://localhost:${PORT}/index.html`, H = 36e5;
const srv = spawn("http-server", [root, "-p", String(PORT), "-s", "-c-1"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 1200));

// ---- simuliertes Open-Meteo: deterministische Werte je Zeitpunkt ----
const M = { now: Date.now(), down: false, calls: [], nullDays: new Set() };
const VARS = "temperature_2m,apparent_temperature,relative_humidity_2m,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover,precipitation,weather_code,is_day".split(",");
const val = (k, t) => { const d = t / 864e5, h = t / H;
  return { temperature_2m: 12 + 5 * Math.sin(d * 2 * Math.PI), apparent_temperature: 10 + 5 * Math.sin(d * 2 * Math.PI), relative_humidity_2m: 80, pressure_msl: 1012 + 9 * Math.sin(h / 40 * 2 * Math.PI),
    wind_speed_10m: 8 + 6 * Math.abs(Math.sin(h / 9)), wind_direction_10m: (h * 7) % 360, wind_gusts_10m: 20, cloud_cover: Math.round(50 + 50 * Math.sin(h / 5)), precipitation: Math.floor(h) % 7 === 0 ? 0.4 : 0, weather_code: 3, is_day: 1 }[k]; };
const dayOf = (t) => new Date(t).toISOString().slice(0, 10);
function series(from, to) { const time = [], o = {}; VARS.forEach((v) => (o[v] = []));
  for (let t = from; t <= to; t += H) { time.push(t / 1000); VARS.forEach((v) => o[v].push(M.nullDays.has(dayOf(t)) ? null : +val(v, t).toFixed(1))); }
  return { time, ...o }; }
async function meteo(route) {
  const u = new URL(route.request().url()), p = u.searchParams; M.calls.push(u.hostname + u.pathname + "?" + (p.get("start_date") || "now"));
  if (M.down) return route.abort("connectionrefused");
  const day0 = Date.parse(dayOf(M.now));
  let from, to;
  if (p.get("start_date")) { from = Date.parse(p.get("start_date")); to = Date.parse(p.get("end_date")) + 23 * H; }
  else { from = day0 - (+p.get("past_days") || 0) * 864e5; to = day0 + (+p.get("forecast_days") || 1) * 864e5 - H; }
  const body = { latitude: +p.get("latitude"), longitude: +p.get("longitude"), hourly: series(from, to) };
  if (p.get("current")) { const t = Math.floor(M.now / 9e5) * 9e5; body.current = { time: t / 1000 }; VARS.forEach((v) => (body.current[v] = +val(v, t).toFixed(1))); }
  if (p.get("daily")) { body.daily = { time: [], sunrise: [], sunset: [] }; for (let d = from; d <= to; d += 864e5) { body.daily.time.push(d / 1000); body.daily.sunrise.push((d + 6.1 * H) / 1000); body.daily.sunset.push((d + 16.5 * H) / 1000); } }
  return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
}

const browser = await chromium.launch(); let failures = 0;
async function step(name, fn) { try { await fn(); console.log("ok   -", name); } catch (e) { failures++; console.log("FAIL -", name, "\n      ", String(e.message).split("\n").slice(0, 4).join(" | ").slice(0, 500)); } }
async function fresh() {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, hasTouch: true, permissions: ["geolocation"], geolocation: { latitude: 51.3266, longitude: 6.2415 }, acceptDownloads: true });
  await ctx.route(/open-meteo\.com/, meteo);
  const p = await ctx.newPage(); p.errors = []; p.on("pageerror", (e) => p.errors.push(e.message)); p.ans = [];
  p.on("dialog", (d) => { const a = p.ans.shift(); a === false ? d.dismiss() : d.accept(); });
  await p.goto(APP); await p.waitForFunction(() => typeof db !== "undefined" && db && window.WX);
  return { ctx, p };
}
const nav = async (p, v) => { await p.click("#menuBtn"); await p.click(`#nav button[data-v="${v}"]`); await p.waitForSelector(`#v-${v}.on`); };

// ---------------------------------------------------------------------------------------------
let { ctx, p } = await fresh();
await step("Menüeintrag „Wetter & Beißfenster“ im Hamburger-Menü, keine neue Menüleiste", async () => {
  await nav(p, "wx"); assert.equal(await p.textContent("#pageName"), "Wetter & Beißfenster");
  assert.equal(await p.locator("nav").count(), 1);
});
await step("1) Wetterdaten verfügbar: aktuelles Wetter mit Quelle, Trend, Sonnenzeiten, Diagramme", async () => {
  await p.waitForSelector("#w1 .wxBig"); const t = await p.textContent("#w1");
  for (const s of ["hPa", "gefühlt", "Böen", "Bewölkung", "Luftfeuchte", "Sonnen", "Open-Meteo", "Keine Messung am See", "51,3266"]) assert.ok(t.includes(s), s);
  assert.match(t, /(steigend|weitgehend stabil|fallend) \([+−±]\d/);
  assert.equal(await p.locator("#w5 .lc").count(), 2); assert.equal(await p.locator("#w5 .lc .fc").count(), 2, "Vorhersage gestrichelt");
  assert.match(await p.textContent("#w5"), /Vorhersage/);
});
await step("Abrufe werden gecacht (keine Wiederholung binnen 10 min)", async () => {
  const n = M.calls.length; await nav(p, "map"); await nav(p, "wx"); await p.waitForTimeout(300); assert.equal(M.calls.length, n);
});
await step("Kleiner See: eigene Koordinaten", async () => {
  await p.click('#w1 [data-lake="klein"]'); await p.waitForFunction(() => /51,3186/.test(document.querySelector("#w1").textContent));
  assert.ok(M.calls.length >= 2);
});
await step("2) Wetter-API nicht erreichbar: Meldung, alte Werte bleiben, Kontakt wird trotzdem gespeichert", async () => {
  M.down = true; await p.click("#wRef"); await p.waitForFunction(() => /nicht erreichbar/.test(document.querySelector("#w1").textContent));
  assert.match(await p.textContent("#w1"), /zuletzt geladenen Werte/);
  await p.evaluate(async () => { WX._reset(); await dbx("meta", "readwrite", (s) => s.delete("wxNow")); }); await nav(p, "map"); await p.click('#quick button[data-r="bite"]'); await p.waitForFunction(() => entries.length === 1);
  await p.waitForFunction(() => WX._failed().length === 1); assert.equal(await p.evaluate(() => entries[0].wx), undefined); M.down = false;
});
await step("7) Historische Wetterdaten werden nachträglich ergänzt (Kennzeichnung, keine Überschreibung)", async () => {
  await p.evaluate(() => { WX._reset(); }); await p.evaluate(() => WX.backfill()); await p.waitForFunction(() => entries[0].wx);
  const w = await p.evaluate(() => entries[0].wx); assert.equal(w.late, true, JSON.stringify({ w, f: await p.evaluate(() => WX._failed()), c: await p.evaluate(() => entries[0].created), calls: M.calls.slice(-6) })); assert.ok(w.p > 990 && w.trend);
  const before = JSON.stringify(w); await p.evaluate(() => WX.backfill()); assert.equal(JSON.stringify(await p.evaluate(() => entries[0].wx)), before);
});
await step("3) Keine Internetverbindung: Hinweis, Fang speicherbar, Daten weiter sichtbar", async () => {
  await p.evaluate(() => WX.getNow("gross", true)); await ctx.setOffline(true); await p.click('#quick button[data-r="caught"]'); await p.waitForFunction(() => entries.length === 2);
  await nav(p, "wx"); await p.click('#w1 [data-lake="gross"]'); await p.waitForTimeout(200); assert.match(await p.textContent("#w1"), /Luftdruck/); assert.match(await p.textContent("#w1"), /Offline – angezeigt werden die zuletzt geladenen Werte/); await p.waitForFunction(() => WX._failed().length === 2); await ctx.setOffline(false);
  await p.waitForFunction(() => entries.every((e) => e.wx)); const dbg = await p.evaluate(() => ({ f: WX._failed(), e: entries.map((e) => [e.id, e.result, e.wx.late, e.created, e.wx.q]) })); assert.equal(await p.evaluate(() => entries.find((e) => e.result === "caught").wx.late), true, JSON.stringify(dbg));
});
await step("4/5/6) Session starten → Kontakt → beenden: Wetter erfasst, Rückblick", async () => {
  await nav(p, "map"); await p.click("#sess"); await p.waitForFunction(() => curSess && curSess.wx && curSess.wx.start, null, { timeout: 8000 }).catch(async (e) => { throw Error(JSON.stringify(await p.evaluate(() => ({ s: curSess, on: navigator.onLine })))); });
  const s = await p.evaluate(() => curSess.wx); assert.equal(s.start.src, "aktuell"); assert.ok(s.live.length >= 1);
  await p.click('#quick button[data-r="caught"]'); await p.waitForFunction(() => entries.length === 3 && entries.find((e) => e.sessionId === curSess.id)?.wx);
  const ew = await p.evaluate(() => { const e = entries.find((e) => e.sessionId === curSess.id); return { ...e.wx, _c: e.created, _d: e.date, _t: e.time, _now: Date.now() }; }); assert.equal(ew.late, false, JSON.stringify(ew)); assert.ok(ew.q && ew.api === "forecast");
  const id = await p.evaluate(() => curSess.id); await p.click("#sess"); await p.waitForFunction((id) => sessions.find((x) => x.id === id)?.wx?.sum, id);
  const w = await p.evaluate((id) => sessions.find((x) => x.id === id).wx, id); assert.ok(w.series.length >= 1); assert.ok(w.sum.dur >= 0);
  await p.evaluate((id) => AngelCal.openSess(id), id); await p.waitForSelector("#cdlg[open]"); const t = await p.textContent("#cdlg");
  assert.match(t, /Wetterbericht/); assert.match(t, /einen gefangenen Fisch dokumentiert/); assert.match(t, /reichen noch nicht aus/); assert.match(t, /Open-Meteo/);
  await p.click("#sx");
});
await step("Live-Erfassung nur bei geöffneter App, höchstens alle 30 min", async () => {
  await p.click("#sess"); await p.waitForFunction(() => curSess?.wx?.live?.length >= 1); const n0 = await p.evaluate(() => curSess.wx.live.length);
  await p.evaluate(() => WX.liveTick()); await p.waitForTimeout(200); assert.equal(await p.evaluate(() => curSess.wx.live.length), n0);
  M.now += 31 * 6e4; await p.evaluate(() => { curSess.wx.live.forEach((r) => (r.q -= 31 * 6e4)); }); await p.evaluate(() => WX.liveTick(true)); await p.waitForFunction((n0) => curSess.wx.live.length === n0 + 1, n0);
  M.now = Date.now(); p.ans.push(true); await p.click("#sess"); await p.waitForFunction(() => !curSess);
});
await step("8) Fehlende Wetterdaten für einen Zeitpunkt werden nicht erfunden", async () => {
  const day = new Date(Date.now() - 40 * 864e5).toISOString().slice(0, 10); M.nullDays.add(day);
  await p.evaluate((day) => put({ id: "lueck", lat: 51.3266, lng: 6.2415, date: day, time: "12:00", lake: "Großer De Witt See", result: "bite", created: Date.parse(day) }), day);
  await p.evaluate(() => reload()); await p.evaluate(() => WX.backfill()); await p.waitForTimeout(500);
  assert.equal(await p.evaluate(() => entries.find((e) => e.id === "lueck").wx), undefined);
  assert.match(await p.evaluate(() => WX.wxLine(entries.find((e) => e.id === "lueck").wx)), /keine Wetterdaten/);
});
await step("Sonnenzeiten (berechnet) stimmen mit Open-Meteo überein, Lichtklassen", async () => {
  const r = await p.evaluate(() => { const s = WX.sunTimes(Date.parse("2026-10-21T09:00Z")); return { rise: s.rise, set: s.set, l: ["05", "06", "10", "16", "20"].map((h) => WX.lightOf(Date.parse(`2026-10-21T${h}:00Z`))) }; });
  assert.ok(Math.abs(r.rise - Date.parse("2026-10-21T06:08Z")) < 3 * 6e4, "Aufgang"); assert.ok(Math.abs(r.set - Date.parse("2026-10-21T16:29Z")) < 3 * 6e4, "Untergang");
  assert.deepEqual(r.l, ["Nacht", "Morgendämmerung", "Tag", "Abenddämmerung", "Nacht"]);
});
await step("Popup zeigt Wetter am Eintrag", async () => {
  const h = await p.evaluate(() => popup(entries.find((e) => e.wx))); assert.match(h, /Wetter: .*hPa/);
});
await step("12) Keine Erfolgsquoten ohne ausreichende Bezugsdaten", async () => {
  await nav(p, "wx"); const t = await p.textContent("#v-wx");
  assert.match(t, /Noch nicht genügend Daten für eine belastbare Auswertung/); assert.doesNotMatch(await p.textContent("#w3"), /\/h ▲|\/h ▼/);
  assert.match(await p.textContent("#w3"), /zu wenig Daten/);
});
await step("10) Neues JSON-Backup enthält Wetterdaten", async () => {
  await nav(p, "data"); const [d] = await Promise.all([p.waitForEvent("download"), p.click("#exJ")]);
  const j = JSON.parse(readFileSync(await d.path(), "utf8")); assert.ok(j.entries.some((e) => e.wx)); assert.ok(j.sessions.some((x) => x.wx?.series));
  writeFileSync(join(tmp, "neu.json"), JSON.stringify(j));
});
assert.deepEqual(p.errors, []); await ctx.close();

({ ctx, p } = await fresh());
await step("9) Älteres JSON-Backup ohne Wetter importierbar, Wetter wird nachgeladen", async () => {
  const day = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  const old = { app: "angelkarte", version: 2, entries: [{ id: "o1", lat: 51.3266, lng: 6.2415, date: day(5), time: "07:30", lake: "Großer De Witt See", result: "caught", species: "Hecht", pressure: 1003, pressTrend: "fallend" }], sessions: [{ id: "s-old", start: Date.parse(day(5) + "T05:00Z"), end: Date.parse(day(5) + "T08:00Z") }], plans: [] };
  writeFileSync(join(tmp, "alt.json"), JSON.stringify(old)); await p.setInputFiles("#imp", join(tmp, "alt.json"));
  await p.waitForFunction(() => entries.length === 1 && sessions.length === 1);
  await p.waitForFunction(() => entries[0].wx && sessions[0].wx?.sum, null, { timeout: 15000 });
  const e = await p.evaluate(() => entries[0]); assert.equal(e.pressure, 1003, "altes Feld unverändert"); assert.equal(e.wx.late, true);
});
await step("Import des neuen Backups behält Wetterdaten unverändert", async () => {
  await p.setInputFiles("#imp", join(tmp, "neu.json")); await p.waitForFunction(() => entries.length >= 4);
  const j = JSON.parse(readFileSync(join(tmp, "neu.json"), "utf8")), src = j.entries.find((e) => e.wx);
  assert.deepEqual(await p.evaluate((id) => entries.find((e) => e.id === id).wx, src.id), src.wx);
});
await step("11) Filter Fischart/Zeitraum + Raten mit ausreichenden Daten", async () => {
  // 8 Sessions à 3 h: Hecht-Kontakte morgens, Barsch abends
  await p.evaluate(async () => {
    for (let i = 0; i < 8; i++) { const d = new Date(Date.now() - (10 + i) * 864e5).toISOString().slice(0, 10), st = Date.parse(d + "T05:00Z"), id = "S" + i;
      await dbx("sessions", "readwrite", (s) => s.put({ id, start: st, end: st + 3 * 36e5 }));
      for (let k = 0; k < 2; k++) await put({ id: `H${i}${k}`, sessionId: id, lat: 51.3266, lng: 6.2415, date: d, time: "07:" + (10 + k * 20), lake: "Großer De Witt See", result: k ? "bite" : "caught", species: "Hecht", created: st });
      await put({ id: `B${i}`, sessionId: id, lat: 51.3266, lng: 6.2415, date: d, time: "07:50", lake: "Großer De Witt See", result: "bite", species: "Flussbarsch", created: st });
      await put({ id: `G${i}`, sessionId: id, lat: 51.3266, lng: 6.2415, date: d, time: "07:55", lake: "Großer De Witt See", result: "seen", species: "Flussbarsch", created: st }); }
    await reload(); WX._reset(); await WX.backfill(); });
  await p.waitForFunction(() => sessions.filter((x) => /^S/.test(x.id)).every((x) => x.wx?.sum) && entries.filter((e) => /^[HB]\d/.test(e.id)).every((e) => e.wx), null, { timeout: 20000 });
  await nav(p, "wx");
  const A = await p.evaluate(() => { const a = WX.analyze({ per: "all", lake: "all", sp: "Flussbarsch" }); return { con: a.con.length, sp: [...new Set(a.con.map((e) => e.species))], seen: a.seen, enough: a.enough }; });
  assert.deepEqual(A.sp, ["Flussbarsch"]); assert.equal(A.seen, 8, "Sichtungen getrennt"); assert.ok(A.con >= 8);
  await p.selectOption("#fSp", "Flussbarsch"); assert.match(await p.textContent("#wSum"), /Gefiltert auf Flussbarsch/);
  const hecht = await p.evaluate(() => WX.analyze({ per: "all", lake: "all", sp: "Hecht" })); assert.ok(hecht.enough);
  await p.selectOption("#fSp", "Hecht"); await p.waitForFunction(() => !/Noch nicht genügend/.test(document.querySelector("#wSum").textContent));
  assert.match(await p.textContent("#w3"), /Kontakte pro Angelstunde/); assert.match(await p.textContent("#w3"), /\d,\d\d\/h/);
  await p.selectOption("#fPer", "30"); const c30 = await p.textContent("#wSum");
  await p.selectOption("#fPer", "all"); assert.ok(c30.length > 0);
  const per = await p.evaluate(() => [WX.analyze({ per: "all", lake: "all", sp: "all" }).S.length, WX.analyze({ per: "30", lake: "all", sp: "all" }).S.length, WX.analyze({ per: "all", lake: "klein", sp: "all" }).S.length]);
  assert.ok(per[0] >= per[1]); assert.equal(per[2], 0);
  assert.match(await p.textContent("#w6"), /mit Fang/); assert.match(await p.textContent("#w4"), /Hecht/);
});
await step("Raten berücksichtigen die Angelzeit (Poisson-Kennzeichnung nur bei genug Daten)", async () => {
  const r = await p.evaluate(() => { const a = WX.analyze({ per: "all", lake: "all", sp: "all" }), b = a.facts.find((f) => f.k === "block"); return b.rows.filter((x) => x.h > 0).map((x) => ({ c: x.c, h: +x.h.toFixed(2), con: x.con, ok: x.ok })); });
  assert.ok(r.some((x) => x.ok));
  assert.ok(await p.evaluate(() => WX.pois(10, 2, true) < 0.001 && WX.pois(2, 2, true) > 0.5));
});
await step("13) Bisherige Funktionen: alle Seiten, Statistik, Kalender, Karte, Angelsteg", async () => {
  for (const v of ["list", "stats", "cal", "law", "data", "map"]) await nav(p, v);
  await p.evaluate(() => map.setView([51.45, 6.40], 16, { animate: false })); await p.waitForTimeout(300); const bx = await p.locator("#map").boundingBox(); await p.mouse.click(bx.x + bx.width / 2, bx.y + bx.height / 2); await p.waitForSelector("#fdlg[open]");
  await p.click('#kind [data-k="steg"]'); await p.click("#fs"); await p.waitForFunction(() => places.length === 1);
  assert.deepEqual(p.errors, []);
});
await ctx.close(); await browser.close(); srv.kill();
console.log(failures ? `\n${failures} Test(s) fehlgeschlagen` : "\nAlle Tests bestanden"); process.exit(failures ? 1 : 0);
