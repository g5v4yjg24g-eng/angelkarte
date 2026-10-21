// End-to-End-Test des Statistik-Dashboards (Chromium via Playwright). Wetterdienst wird blockiert (keine Netzabrufe nötig).
// Start: node tests/statistik.e2e.mjs   (benötigt Playwright + http-server, z. B. `npm i -g playwright http-server`)
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), ".."), tmp = mkdtempSync(join(tmpdir(), "st-e2e-"));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const PORT = 8129, APP = `http://localhost:${PORT}/index.html`, H = 36e5;
const srv = spawn("http-server", [root, "-p", String(PORT), "-s", "-c-1"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 1200));
const browser = await chromium.launch(); let failures = 0;
async function step(name, fn) { try { await fn(); console.log("ok   -", name); } catch (e) { failures++; console.log("FAIL -", name, "\n      ", String(e.message).split("\n").slice(0, 4).join(" | ").slice(0, 600)); } }
async function fresh(width = 390) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 844 }, hasTouch: width < 600, acceptDownloads: true });
  await ctx.route(/open-meteo\.com/, (r) => r.abort());
  const p = await ctx.newPage(); p.errors = []; p.on("pageerror", (e) => p.errors.push(e.message)); p.on("dialog", (d) => d.accept());
  await p.goto(APP); await p.waitForFunction(() => typeof db !== "undefined" && db && window.Stat);
  return { ctx, p };
}
const nav = async (p, v) => { await p.click("#menuBtn"); await p.click(`#nav button[data-v="${v}"]`); await p.waitForSelector(`#v-${v}.on`); };
const txt = (p) => p.textContent("#stats");
const kpi = (p) => p.$$eval("#stats .kc", (cs) => Object.fromEntries(cs.map((c) => [c.querySelector(".kl").textContent.trim(), c.querySelector("b").textContent.trim()])));
const noBad = async (p) => { const t = await txt(p); for (const bad of ["NaN", "Infinity", "undefined", "null"]) assert.ok(!t.includes(bad), bad + " im Text"); };
const noOverflow = (p) => p.evaluate(() => { const s = document.querySelector("#v-stats"); return s.scrollWidth <= s.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1; });
const day = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const add = (p, list, key = "entries") => p.evaluate(async ([list, key]) => { for (const x of list) await dbx(key, "readwrite", (s) => s.put(x)); await reload(); }, [list, key]);
const E = (id, d, result, extra = {}) => ({ id, lat: 51.3266, lng: 6.2415, date: d, time: "08:00", lake: "Großer De Witt See", result, created: Date.parse(d), ...extra });

let { ctx, p } = await fresh();
await step("Leere Daten: Platzhalter statt falscher Nullen, keine leeren Diagrammrahmen", async () => {
  await nav(p, "stats"); const k = await kpi(p);
  assert.equal(k["Angel-Sessions"], "–"); assert.equal(k["Angelstunden"], "–"); assert.equal(k["Fänge pro Stunde"], "–"); assert.equal(k["Fänge"], "0");
  assert.match(await txt(p), /Noch keine Einträge vorhanden/); assert.match(await txt(p), /Sobald du Fänge mit „Gefangen“ dokumentierst/);
  assert.equal(await p.locator("#stats .sc").count(), 0); await noBad(p); assert.ok(await noOverflow(p));
});
await step("Kopfbereich: Überschrift, Filter, Anzeige des Zeitraums/Gewässers", async () => {
  assert.equal(await p.textContent("#stats h2"), "Statistik");
  assert.deepEqual(await p.$$eval("#stPer option", (o) => o.map((x) => x.textContent)), ["Gesamtzeitraum", "Dieses Jahr", "Dieser Monat", "Letzte 30 Tage", "Benutzerdefiniert"]);
  assert.match(await p.textContent("#stChip"), /Gesamtzeitraum · Beide Seen/);
});
await step("Einzelne Session ohne Fang", async () => {
  const st = Date.parse(day(3) + "T06:00Z"); await add(p, [{ id: "s1", start: st, end: st + 2.5 * H }], "sessions");
  const k = await kpi(p); assert.equal(k["Angel-Sessions"], "1"); assert.equal(k["Angelstunden"], "2 h 30 min"); assert.equal(k["Fänge pro Stunde"], "0,00");
  assert.match(await txt(p), /Ø Dauer pro Session2 h 30 min/); await noBad(p);
});
await step("Unvollständige/unplausible Sessions verfälschen keine Zeitwerte", async () => {
  const st = Date.parse(day(2) + "T06:00Z");
  await add(p, [{ id: "bad1", start: st, end: st - H }, { id: "bad2", start: st, end: st + 30 * H }], "sessions");
  await p.evaluate(async () => { curSess = { id: "run", start: Date.now() - 2 * 36e5 }; await dbx("meta", "readwrite", (s) => s.put(curSess, "active")); await reload(); });
  const k = await kpi(p); assert.equal(k["Angelstunden"], "2 h 30 min"); assert.equal(k["Angel-Sessions"], "3");
  const t = await txt(p); assert.match(t, /laufende Session zählt erst nach dem Beenden/); assert.match(t, /2 Sessions mit unplausibler Zeitangabe/); assert.match(t, /Ø Dauer pro Session2 h 30 min/);
  await p.evaluate(async () => { curSess = null; await dbx("meta", "readwrite", (s) => s.delete("active")); await dbx("sessions", "readwrite", (s) => { s.delete("bad1"); return s.delete("bad2"); }); await reload(); });
});
await step("Mehrere Fischarten, Unbekannt, Vermutung, Kontakte, Landequote, Rekorde", async () => {
  const st = Date.parse(day(3) + "T06:00Z");
  await add(p, [
    E("c1", day(3), "caught", { species: "Hecht", lenMeas: 72, lenEst: 70, weight: 2600, sessionId: "s1" }),
    E("c2", day(3), "caught", { species: "Hecht", lenEst: 55, sessionId: "s1", guess: true }),
    E("c3", day(3), "caught", { species: "Flussbarsch", lenMeas: 31 }),
    E("c4", day(40), "caught", { species: "Unbekannt" }), E("c5", day(41), "caught", {}),
    E("b1", day(3), "bite", { sessionId: "s1" }), E("l1", day(3), "lost_hooked", { sessionId: "s1" }), E("l2", day(3), "lost_drill"), E("g1", day(3), "seen", { species: "Karpfen" }),
  ]);
  const k = await kpi(p); assert.equal(k["Fänge"], "5"); assert.equal(k["Fänge pro Stunde"], "0,80");
  const t = await txt(p);
  assert.match(t, /2Fischarten/); assert.match(t, /1Bisse/); assert.match(t, /2Verloren/); assert.match(t, /1Gesehen/);
  assert.match(t, /Hecht2 · 40 %/); assert.match(t, /Nicht bestimmt2 · 40 %/); assert.match(t, /Flussbarsch1 · 20 %/); assert.match(t, /1× als Vermutung/);
  assert.match(t, /Landequote71 %/); assert.match(t, /Gehakte Fische7/);
  assert.match(t, /Größter Fisch \(gemessen\).*72 cm · Hecht/); assert.match(t, /Höchstes eingetragenes Gewicht \(geschätzt\).*2,60 kg/);
  assert.match(t, /Häufigste Fischart · 2 FängeHecht/); assert.match(t, /Längste Session/); assert.match(t, /Erfolgreichster Monat/);
  assert.match(t, /nicht unterschiedliche Fische/); await noBad(p); assert.ok(await noOverflow(p));
});
await step("Rekord öffnet den Fangeintrag auf der Karte", async () => {
  await p.click('#stats [data-entry="c1"] >> nth=0'); await p.waitForSelector("#v-map.on"); await p.waitForSelector(".leaflet-popup");
  assert.match(await p.textContent(".leaflet-popup"), /Hecht/); await nav(p, "stats");
});
await step("Fangentwicklung: Diagramm mit Achsenbeschriftung und Tooltip", async () => {
  assert.equal(await p.locator("#stats .sc").count(), 1); assert.match(await p.textContent("#stats .sc figcaption"), /Fänge pro (Woche|Monat) · y-Achse: Anzahl Fänge/);
  const g = p.locator("#stats .sc .bf").first(); await g.dispatchEvent("pointerdown"); await p.waitForSelector("#stats .sc .tip:not([hidden])");
  assert.match(await p.textContent("#stats .sc .tip"), /\d+ (Fang|Fänge)/);
});
await step("Zeitraumfilter aktualisieren alle Kennzahlen", async () => {
  await p.selectOption("#stPer", "30"); assert.match(await p.textContent("#stChip"), /Letzte 30 Tage: /);
  let k = await kpi(p); assert.equal(k["Fänge"], "3"); assert.match(await txt(p), /Fänge pro Woche/);
  assert.doesNotMatch(await txt(p), /Nicht bestimmt/);
  await p.selectOption("#stPer", "custom"); assert.equal(await p.isVisible("#stFrom"), true);
  await p.fill("#stFrom", day(35)); await p.dispatchEvent("#stFrom", "change"); await p.fill("#stTo", day(45)); await p.dispatchEvent("#stTo", "change");
  k = await kpi(p); assert.equal(k["Fänge"], "2", "vertauschte Daten werden korrigiert"); assert.equal(k["Angel-Sessions"], "–");
  await p.selectOption("#stPer", "month"); await p.selectOption("#stPer", "year"); await p.selectOption("#stPer", "all"); k = await kpi(p); assert.equal(k["Fänge"], "5");
});
await step("Gewässerfilter", async () => {
  await add(p, [E("k1", day(5), "caught", { lake: "Kleiner De Witt See", species: "Zander" })]);
  await p.selectOption("#stLake", "Kleiner De Witt See"); assert.match(await p.textContent("#stChip"), /Kleiner De Witt See/);
  const k = await kpi(p); assert.equal(k["Fänge"], "1"); assert.equal(k["Angel-Sessions"], "–"); assert.match(await txt(p), /Zander1 · 100 %/);
  await p.selectOption("#stLake", "all");
});
await step("Neue, geänderte und gelöschte Einträge werden sofort berücksichtigt", async () => {
  await add(p, [E("n1", day(1), "caught", { species: "Schleie" })]); assert.equal((await kpi(p))["Fänge"], "7");
  await p.evaluate(async () => { const e = entries.find((x) => x.id === "n1"); await put({ ...e, result: "bite" }); await reload(); }); assert.equal((await kpi(p))["Fänge"], "6");
  await p.evaluate(async () => { await del("n1"); await reload(); }); assert.match(await txt(p), /1Bisse/);
});
await step("Wetterteil: Hinweis bei zu wenig Daten", async () => {
  assert.match(await txt(p), /Noch nicht genügend Daten für eine aussagekräftige Auswertung/);
});
await step("Wetterteil mit ausreichend zugeordneten Daten (Fänge pro Angelstunde, nur gültige Gruppen)", async () => {
  await p.evaluate(async () => {
    for (let i = 0; i < 6; i++) { const d = new Date(Date.now() - (60 + i) * 864e5).toISOString().slice(0, 10), st = Date.parse(d + "T05:00Z"), ser = [];
      for (let h = -1; h <= 4; h++) ser.push({ t: st + h * 36e5, temp: 14, p: 1012 - h, ws: 12, wd: 225, cloud: 60, precip: 0, code: 3 });
      await dbx("sessions", "readwrite", (s) => s.put({ id: "W" + i, start: st, end: st + 3 * 36e5, wx: { lake: "gross", series: ser } }));
      await put({ id: "WC" + i, sessionId: "W" + i, lat: 51.3266, lng: 6.2415, date: d, time: "08:30", lake: "Großer De Witt See", result: "caught", species: "Hecht", created: st, wx: { t: st + 1.5 * 36e5, temp: 14, p: 1011, ws: 12, wd: 225, cloud: 60, precip: 0, trend: "fallend" } }); }
    await reload(); });
  await p.click("#stats details.sec > summary"); const t = await p.textContent("#stats details.sec");
  assert.match(t, /Sessions mit Fang\d+ von \d+/); assert.match(t, /Windstärke/); assert.match(t, /\d,\d\d\/h/); assert.match(t, /keine bewiesenen Ursachen/);
});
await step("Mehr als 24 Monate: Diagramm bleibt lesbar", async () => {
  await add(p, [E("old", "2021-03-10", "caught", { species: "Hecht" })]);
  const n = await p.locator("#stats .sc g[data-i]").count(); assert.ok(n <= 24, String(n)); assert.match(await txt(p), /ältere Monate nicht dargestellt/);
  await p.evaluate(async () => { await del("old"); await reload(); });
});
await step("Export/Import funktionieren weiter", async () => {
  await nav(p, "data"); const [d] = await Promise.all([p.waitForEvent("download"), p.click("#exJ")]);
  const j = JSON.parse(readFileSync(await d.path(), "utf8")); assert.ok(j.entries.length >= 10 && j.sessions.length >= 7); writeFileSync(join(tmp, "b.json"), JSON.stringify(j));
});
await step("Übrige App unverändert funktionsfähig", async () => {
  for (const v of ["map", "list", "wx", "cal", "law", "data", "stats"]) await nav(p, v);
  assert.deepEqual(p.errors, []);
});
await ctx.close();
for (const w of [320, 1280]) await step(`Darstellung ohne horizontalen Überlauf bei ${w}px`, async () => {
  const { ctx: c, p: q } = await fresh(w); await q.setInputFiles("#imp", join(tmp, "b.json")); await q.waitForFunction(() => entries.length >= 10);
  await nav(q, "stats"); assert.ok(await noOverflow(q)); await noBad(q);
  const cols = await q.$eval("#stats .kpi", (e) => getComputedStyle(e).gridTemplateColumns.split(" ").length); assert.equal(cols, w < 640 ? 2 : 4);
  assert.deepEqual(q.errors, []); await c.close();
});
await browser.close(); srv.kill();
console.log(failures ? `\n${failures} Test(s) fehlgeschlagen` : "\nAlle Tests bestanden"); process.exit(failures ? 1 : 0);
