"use strict";
const COMUNAS = ["Alhué","Buin","Calera de Tango","Cerrillos","Cerro Navia","Colina","Conchalí","Curacaví","El Bosque","El Monte","Estación Central","Huechuraba","Independencia","Isla de Maipo","La Cisterna","La Florida","La Granja","La Pintana","La Reina","Lampa","Las Condes","Lo Barnechea","Lo Espejo","Lo Prado","Macul","Maipú","María Pinto","Melipilla","Ñuñoa","Padre Hurtado","Paine","Pedro Aguirre Cerda","Peñaflor","Peñalolén","Pirque","Providencia","Pudahuel","Puente Alto","Quilicura","Quinta Normal","Recoleta","Renca","San Bernardo","San Joaquín","San José de Maipo","San Miguel","San Pedro","San Ramón","Santiago","Talagante","Tiltil","Vitacura"];

const DEFAULT_STOPS = [
  {dir:"Las Comadrejas 1750", com:"Cerro Navia"},
  {dir:"Av Maria Rozas Velasquez 55", com:"Estación Central"},
  {dir:"Nueva Exposición 1830", com:"Estación Central"},
  {dir:"García Lorca 3468", com:"Maipú"},
  {dir:"Av Cuatro Poniente 200", com:"Maipú"},
  {dir:"El Conquistador 3181", com:"Maipú"},
  {dir:"Pasaje Santa Amelia 9572", com:"Pudahuel"}
];

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- confirmación propia (reemplaza el confirm() del navegador) ---------- */
function askConfirm(title, msg, okText = "Aceptar"){
  return new Promise(resolve => {
    const d = $("#dlg");
    if (!d.showModal) return resolve(confirm(msg));   // navegadores muy antiguos
    $("#dlgTitle").textContent = title;
    $("#dlgMsg").textContent = msg;
    $("#dlgOk").textContent = okText;
    d.returnValue = "";
    $("#dlgOk").onclick = () => d.close("ok");
    $("#dlgCancel").onclick = () => d.close("");
    d.onclick = e => { if (e.target === d) d.close(""); };   // clic fuera = cancelar
    d.onclose = () => resolve(d.returnValue === "ok");
    d.showModal();
    $("#dlgCancel").focus();
  });
}

/* ---------- almacenamiento seguro ---------- */
const store = {
  get(k){ try { return localStorage.getItem(k); } catch(e){ return null; } },
  set(k,v){ try { localStorage.setItem(k,v); } catch(e){} },
  del(k){ try { localStorage.removeItem(k); } catch(e){} }
};

/* ---------- estado ---------- */
let stops = [];
let lastResult = null;

(function init(){
  const dl = $("#comunas");
  dl.innerHTML = COMUNAS.map(c => `<option value="${esc(c)}">`).join("");

  const o = store.get("pr_origin");
  if (o) { try { const v = JSON.parse(o); $("#o-dir").value = v.dir||""; $("#o-com").value = v.com||""; } catch(e){} }
  const s = store.get("pr_stops");
  try { stops = s ? JSON.parse(s) : DEFAULT_STOPS.map(x => ({...x})); } catch(e){ stops = DEFAULT_STOPS.map(x => ({...x})); }
  if (!Array.isArray(stops) || !stops.length) stops = [{dir:"",com:""}];
  stops.forEach(x => { x.com = cleanCom(x.com); });
  const t = store.get("pr_traffic"); if (t && [...$("#traffic").options].some(x => x.value === t)) $("#traffic").value = t;
  renderStops();
})();

function persist(){
  store.set("pr_stops", JSON.stringify(stops));
  store.set("pr_origin", JSON.stringify({dir:$("#o-dir").value, com:$("#o-com").value}));
  prefetchGeo();   // empieza a ubicar las direcciones en segundo plano
}
$("#o-dir").addEventListener("input", persist);
$("#o-com").addEventListener("input", persist);
$("#traffic").addEventListener("change", () => store.set("pr_traffic", $("#traffic").value));

/* ---------- servicio: recogida (paradas → base) o zarpe (base → paradas) ---------- */
const service = () => document.querySelector('input[name=svc]:checked').value;
function updateService(){
  $("#baseRole").textContent = service() === "recogida" ? "· destino final" : "· punto de salida";
  store.set("pr_service", service());
}
(function(){
  const sv = store.get("pr_service");
  if (sv) { const el = document.querySelector(`input[name=svc][value=${sv}]`); if (el) el.checked = true; }
  document.querySelectorAll("input[name=svc]").forEach(el => el.addEventListener("change", updateService));
  updateService();
})();

/* ---------- motor: gratis (OpenStreetMap) o Google si hay key ---------- */
const useGoogle = () => false;
function updateEngine(){
  const g = useGoogle();
  $("#engine").textContent = g ? "Google · tráfico real" : "Modo gratis";
  $("#engine").className = "engine" + (g ? " g" : "");
  $("#trafficBox").classList.toggle("hidden", g);
}
updateEngine();

/* ---------- lista de paradas ---------- */
function renderStops(focusLast){
  const box = $("#stops");
  box.innerHTML = "";
  stops.forEach((s,i) => {
    const row = document.createElement("div");
    row.className = "stop";
    row.innerHTML = `
      <span class="n">${i+1}</span>
      <input type="text" class="dir" placeholder="Dirección" aria-label="Dirección parada ${i+1}">
      <input type="text" class="com" list="comunas" placeholder="Comuna" aria-label="Comuna parada ${i+1}">
      <span class="acts">
        <button class="icon ghost up" title="Subir" aria-label="Subir parada ${i+1}">↑</button>
        <button class="icon ghost down" title="Bajar" aria-label="Bajar parada ${i+1}">↓</button>
        <button class="icon ghost del" title="Quitar" aria-label="Quitar parada ${i+1}">✕</button>
      </span>`;
    const dir = row.querySelector(".dir"), com = row.querySelector(".com");
    dir.value = s.dir; com.value = s.com;
    dir.addEventListener("input", () => { s.dir = dir.value; persist(); });
    com.addEventListener("input", () => { s.com = com.value; persist(); });
    com.addEventListener("change", () => { s.com = cleanCom(com.value); com.value = s.com; persist(); });
    com.addEventListener("keydown", e => {
      if (e.key === "Enter" && i === stops.length-1) { e.preventDefault(); addStop(); }
    });
    row.querySelector(".up").onclick = () => move(i,-1);
    row.querySelector(".down").onclick = () => move(i,1);
    row.querySelector(".del").onclick = () => { stops.splice(i,1); if(!stops.length) stops.push({dir:"",com:""}); persist(); renderStops(); };
    box.appendChild(row);
  });
  if (focusLast) { const ins = box.querySelectorAll(".dir"); ins[ins.length-1].focus(); }
}
function move(i,d){
  const j = i+d; if (j<0 || j>=stops.length) return;
  [stops[i],stops[j]] = [stops[j],stops[i]]; persist(); renderStops();
}
function addStop(){ stops.push({dir:"",com:""}); persist(); renderStops(true); }
$("#addStop").onclick = addStop;
const filledStops = () => stops.filter(s => s.dir.trim());
$("#clearStops").onclick = async () => {
  const n = filledStops().length;
  if (n && !await askConfirm("Vaciar la lista", `Se borrarán las ${n} ${n === 1 ? "parada" : "paradas"} de la lista. Esta acción no se puede deshacer.`, "Sí, borrar")) return;
  stops = [{dir:"",com:""}]; persist(); renderStops();
  $("#pasteInfo").textContent = "";
};

function parsePaste(text){
  const clean = v => (v||"").trim().replace(/^"+|"+$/g,"").trim();
  const out = [];
  text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).forEach(line => {
    let parts;
    if (line.includes("\t")) parts = line.split("\t");
    else if (line.includes(";")) parts = line.split(";");
    else if (line.includes(",")) { const i = line.lastIndexOf(","); parts = [line.slice(0,i), line.slice(i+1)]; }
    else parts = [line];
    parts = parts.map(clean);
    // quitar columnas vacías al inicio y un número de fila (1, 2, 3...)
    while (parts.length > 1 && parts[0] === "") parts.shift();
    if (parts.length >= 3 && /^\d+$/.test(parts[0])) parts.shift();
    // saltar encabezados
    if (/^(direcci[oó]n|address|calle)$/i.test(parts[0])) return;
    if (parts[0]) out.push({dir:parts[0], com:cleanCom(parts[1])});
  });
  return out;
}
// clave para detectar direcciones repetidas (sin importar mayúsculas, tildes ni espacios)
const stopKey = s => (s.dir + "|" + cleanCom(s.com)).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

// append = true  → se AGREGAN al final de la lista (lo normal; nunca se borra lo que ya hay)
// append = false → se REEMPLAZA la lista completa (solo con el botón «Reemplazar lista»)
async function applyPaste(append){
  const raw = $("#paste").value;
  let p = parsePaste(raw);
  if (!p.length) { $("#pasteInfo").textContent = raw.trim() ? "No encontré direcciones en lo que pegaste." : ""; return; }
  if (!append) {
    const n = filledStops().length;
    if (n && !await askConfirm("Reemplazar la lista", `Se reemplazarán las ${n} paradas actuales por las ${p.length} que pegaste.`, "Sí, reemplazar")) return;
  }
  if ($("#firstIsOrigin").checked) {
    const o = p.shift();
    $("#o-dir").value = o.dir; $("#o-com").value = o.com;
    $("#firstIsOrigin").checked = false;   // la base ya quedó puesta; lo siguiente que se pegue son paradas
  }
  // al agregar, no se duplican direcciones que ya están en la lista
  const base = append ? filledStops() : [];
  const seen = new Set(base.map(stopKey));
  const nuevas = p.filter(s => { const k = stopKey(s); if (seen.has(k)) return false; seen.add(k); return true; });
  const repetidas = p.length - nuevas.length;
  stops = base.concat(nuevas);
  if (!stops.length) stops = [{dir:"",com:""}];
  const total = filledStops().length;
  $("#pasteInfo").textContent =
    `${nuevas.length} ${nuevas.length === 1 ? "dirección agregada" : "direcciones agregadas"}` +
    (append ? ` · ahora tienes ${total} ${total === 1 ? "parada" : "paradas"}` : "") +
    (repetidas ? ` · ${repetidas} ya ${repetidas === 1 ? "estaba" : "estaban"} en la lista y no se repitió` : "") +
    (nuevas.some(s => !s.com) ? ". Algunas no tienen comuna: agrégala para ubicarlas mejor." : ".");
  $("#paste").value = "";
  persist(); renderStops();
}
$("#paste").addEventListener("paste", () => setTimeout(() => applyPaste(true), 0));
$("#pasteAppend").onclick = () => applyPaste(true);
$("#pasteReplace").onclick = () => applyPaste(false);

/* ---------- utilidades de formato ---------- */
// Limpia la comuna tal como viene del Excel: "Puente Alto 2" → "Puente Alto".
// Quita números al final, códigos postales y "Región Metropolitana"/"Chile" sobrantes.
// (Google Maps no reconoce "Puente Alto 2" y por eso no cargaba la ruta.)
function cleanCom(c){
  let s = String(c || "").trim();
  s = s.replace(/,?\s*(regi[oó]n\s+metropolitana(\s+de\s+santiago)?|rm|chile)\s*$/i, "").trim();
  s = s.replace(/(\s*[-–#]?\s*\d+)+$/, "").trim();          // números al final ("Puente Alto 2", "Maipú 9273099")
  // si coincide con una comuna conocida (sin importar tildes/mayúsculas), se usa el nombre correcto
  const n = x => x.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  const hit = COMUNAS.find(k => n(k) === n(s));
  return hit || s;
}
const fullAddress = (dir,com) => {
  dir = (dir||"").trim(); com = cleanCom(com);
  if (!dir) return "";
  return com ? `${dir}, ${com}, Región Metropolitana, Chile` : `${dir}, Chile`;
};
const fmtKm = m => (m/1000).toLocaleString("es-CL",{minimumFractionDigits:1,maximumFractionDigits:1}) + " km";
const parseSecs = d => parseInt(String(d||"0").replace("s",""),10) || 0;
function fmtDur(sec){
  const m = Math.round(sec/60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m/60), r = m%60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/* ---------- mensajes ---------- */
function showErr(title, detail){
  const b = $("#errBox");
  b.innerHTML = `<strong>${esc(title)}</strong>${detail ? esc(detail) : ""}`;
  b.classList.remove("hidden");
  scrollToEl(b);
}
// los avisos y el resultado quedan debajo del formulario: se baja la página hasta ellos
function scrollToEl(el){ el.scrollIntoView({behavior:"smooth", block:"start"}); }
function showWarn(html){ const b=$("#warnBox"); b.insertAdjacentHTML("beforeend", `<div>${html}</div>`); b.classList.remove("hidden"); }
function clearMsgs(){ $("#errBox").classList.add("hidden"); $("#warnBox").classList.add("hidden"); $("#warnBox").innerHTML = ""; }

class ApiError extends Error { constructor(msg, status, code){ super(msg); this.status=status; this.code=code; } }

/* =====================================================================
   MOTOR GRATIS: Nominatim (ubicar direcciones) + OSRM (tiempos y rutas)
   ===================================================================== */
function geoCache(){ try { return JSON.parse(store.get("pr_geo") || "{}"); } catch(e){ return {}; } }
function saveGeo(k, v){ const c = geoCache(); c[k] = v; store.set("pr_geo", JSON.stringify(c)); }

// Dos buscadores gratuitos: Nominatim (principal) y Photon (respaldo). Si Nominatim falla o
// bloquea por exceso de consultas, se sigue solo con Photon durante esta sesión.
let lastNominatim = 0, nominatimDown = false;
// fila de espera: aunque se busquen varias direcciones a la vez, a Nominatim se le consulta
// de a una por segundo (es su política de uso)
let nominatimQueue = Promise.resolve();
function nominatimTurn(){
  const turn = nominatimQueue.then(async () => {
    const wait = lastNominatim + 1100 - Date.now();
    if (wait > 0) await sleep(wait);
    lastNominatim = Date.now();
  });
  nominatimQueue = turn;
  return turn;
}
async function nominatim(params){
  if (nominatimDown) return undefined;
  await nominatimTurn();
  if (nominatimDown) return undefined;
  const qs = new URLSearchParams({format:"jsonv2", limit:"1", countrycodes:"cl", addressdetails:"1", "accept-language":"es", ...params});
  try {
    const res = await fetchTimeout("https://nominatim.openstreetmap.org/search?" + qs, 10000);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const j = await res.json();
    return j[0] || null;
  } catch(e){ nominatimDown = true; return undefined; }   // undefined = servicio no disponible
}
// fetch con tiempo máximo de espera
async function fetchTimeout(url, ms){
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, {signal: ctrl.signal}); }
  finally { clearTimeout(t); }
}
// Si Photon tarda o falla, se deja de usar durante esta sesión y se sigue solo con Nominatim
let photonDown = false;
const PHOTON_TIMEOUT = 4000;
async function photon(q){
  if (photonDown) return undefined;
  // limitado a la Región Metropolitana y alrededores
  const url = "https://photon.komoot.io/api/?limit=1&lang=default&bbox=-71.8,-34.3,-69.7,-32.9&q=" + encodeURIComponent(q);
  try {
    let res;
    try { res = await fetchTimeout(url, PHOTON_TIMEOUT); }
    catch(e){ photonDown = true; throw e; }
    if (!res.ok) { if (res.status >= 500 || res.status === 429) photonDown = true; throw new Error("HTTP " + res.status); }
    const j = await res.json();
    const f = j.features && j.features[0];
    if (!f) return null;
    const p = f.properties || {};
    const calle = [p.street || p.name, p.housenumber].filter(Boolean).join(" ");
    return {lat:f.geometry.coordinates[1], lng:f.geometry.coordinates[0],
            fmt:[calle, p.district || p.city].filter(Boolean).join(", ") || p.name || q, approx: p.type !== "house"};
  } catch(e){ return undefined; }
}
function shortName(s){
  const p = s.split(", ").filter(x => !/^(Provincia|Región|Chile$|\d{7}$)/.test(x));
  if (p.length > 2 && p[p.length-1] === "Santiago") p.pop();
  return p.join(", ");
}
async function geocodeFree(dir, com){
  const toV = (g, approx) => ({lat:+g.lat, lng:+g.lon, fmt:shortName(g.display_name),
    approx: approx || (!(g.address && g.address.house_number) && !["house","building"].includes(g.addresstype) && g.type !== "house")});
  const q = [dir, com, "Chile"].filter(Boolean).join(", ");
  // 0) Photon primero: responde rápido y permite varias consultas a la vez.
  //    Si encuentra la dirección exacta (con número) no hace falta esperar a Nominatim.
  const ph = await photon(q);
  if (ph && !ph.approx) return ph;
  let down = false, aprox = null;
  // 1) Nominatim
  let g = await nominatim({q});
  if (g === undefined) down = true;
  if (g) { const v = toV(g, false); if (!v.approx) return v; aprox = v; }
  if (!g && com && !down) {
    g = await nominatim({street:dir, city:com, country:"Chile"});
    if (g === undefined) down = true;
    if (g) { const v = toV(g, false); if (!v.approx) return v; aprox = v; }
  }
  // 2) si nadie la encontró exacta: lo aproximado de Nominatim, o si no, lo de Photon
  if (aprox) return aprox;
  if (ph) return ph;
  // 3) sin resultado: se busca la calle sin número (ubicación aproximada)
  const sinNumero = dir.replace(/\s*#?\s*\d+[a-zA-Z]?(\s*(depto|dpto|casa|of|block)\.?\s*\S+)?\s*$/i, "").trim();
  if (sinNumero && sinNumero !== dir) {
    const q2 = [sinNumero, com, "Chile"].filter(Boolean).join(", ");
    g = await nominatim({q:q2});
    if (g) return toV(g, true);
    const ph2 = await photon(q2);
    if (ph2) return {...ph2, approx:true};
  }
  if ((down || nominatimDown) && ph === undefined)
    throw new ApiError("Los buscadores gratuitos de direcciones no responden (pueden estar saturados). Espera unos minutos y vuelve a intentar.", 0, "FREE");
  return null;
}
// Ubica una dirección: usa lo guardado (las correcciones manuales del mapa tienen prioridad).
// Si la misma dirección ya se está buscando (por ejemplo en segundo plano), espera esa búsqueda.
const geoInFlight = new Map();
function locateOne(dir, com, address){
  const c = geoCache();
  const hit = c["m|" + address] || c["o|" + address];
  if (hit) return Promise.resolve(hit);
  if (geoInFlight.has(address)) return geoInFlight.get(address);
  const job = geocodeFree(dir, com)
    .then(v => { if (v) saveGeo("o|" + address, v); return v; })
    .finally(() => geoInFlight.delete(address));
  geoInFlight.set(address, job);
  return job;
}
// ejecuta tareas con un máximo de "limit" a la vez
async function runPool(items, limit, fn){
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; await fn(items[i], i); } };
  await Promise.all(Array.from({length: Math.min(limit, items.length)}, worker));
}
const GEO_PARALLEL = 6;

// ubica todos los puntos, varios a la vez
async function locateAll(pts, onProgress){
  const notFound = [];
  let done = 0, fatal = null;
  onProgress(0, pts.length);
  await runPool(pts, GEO_PARALLEL, async p => {
    try {
      const v = await locateOne(p.dir, p.com, p.address);
      const manual = !!geoCache()["m|" + p.address];
      if (v) Object.assign(p, {lat:v.lat, lng:v.lng, fmt:v.fmt, approx:!!v.approx, manual});
      else notFound.push(p.label);
    } catch(e) { fatal = fatal || e; }
    onProgress(++done, pts.length);
  });
  if (fatal) throw fatal;
  if (notFound.length) throw new ApiError(notFound.join(" · "), 0, "NOT_FOUND");
}

// Ubicación en segundo plano: apenas se pegan o editan direcciones se empiezan a buscar,
// así al presionar «Calcular ruta» ya están listas. Los errores se ignoran (se reintenta al calcular).
let prefetchTimer = null;
function prefetchGeo(){
  clearTimeout(prefetchTimer);
  prefetchTimer = setTimeout(() => {
    const { origin, list } = collect();
    // solo direcciones que parecen completas (con número y comuna), para no buscar mientras se escribe
    const pts = [origin, ...list].filter(p => p.address && p.com && /\d/.test(p.dir));
    runPool(pts, GEO_PARALLEL, p => locateOne(p.dir, p.com, p.address).catch(() => null));
  }, 1500);
}

const OSRM = "https://router.project-osrm.org";
const coordsOf = pts => pts.map(p => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(";");
async function osrm(path){
  // el servidor gratuito a veces rechaza por exceso de consultas: se reintenta con espera
  for (let intento = 0; ; intento++) {
    let res;
    try { res = await fetch(OSRM + path); }
    catch(e){
      if (intento < 3) { await sleep(1500 * (intento + 1)); continue; }
      throw new ApiError("No hay conexión con el servidor de rutas. Revisa tu internet.", 0, "NETWORK");
    }
    const j = await res.json().catch(() => null);
    if (res.ok && j && j.code === "Ok") return j;
    if (intento < 3 && (res.status === 429 || res.status >= 500 || !j)) { await sleep(1500 * (intento + 1)); continue; }
    throw new ApiError("El servidor gratuito de rutas no respondió" + (j && j.message ? ": " + j.message : "") + ". Vuelve a intentar en unos segundos.", res.status, "FREE");
  }
}
// el servidor gratuito acepta hasta 100 puntos por consulta: con más paradas se consulta por bloques
const OSRM_MAX_PTS = 100;
const range = (a, b) => Array.from({length: b - a}, (_, i) => a + i);
// tiempos (segundos, con factor de tráfico) y distancias entre todos los puntos (sin límite de puntos)
async function matrixFree(pts, factor, onProgress){
  const n = pts.length;
  const T = [...Array(n)].map(() => Array(n).fill(null));
  const D = [...Array(n)].map(() => Array(n).fill(null));
  // bloques de 50: cada consulta lleva como máximo 50 orígenes + 50 destinos = 100 puntos
  const B = n <= OSRM_MAX_PTS ? n : OSRM_MAX_PTS / 2;
  const blocks = [];
  for (let i = 0; i < n; i += B) blocks.push(range(i, Math.min(n, i + B)));
  const jobs = [];
  blocks.forEach((src, a) => blocks.forEach((dst, b) => jobs.push({src, dst, same: a === b})));
  let done = 0;
  if (onProgress) onProgress(0, jobs.length);
  await runPool(jobs, 2, async ({src, dst, same}) => {
    const coords = same ? src : [...src, ...dst];
    const si = src.map((_, i) => i).join(";");
    const di = same ? si : dst.map((_, i) => src.length + i).join(";");
    const q = n <= OSRM_MAX_PTS ? "" : `&sources=${si}&destinations=${di}`;
    const j = await osrm(`/table/v1/driving/${coordsOf(coords.map(k => pts[k]))}?annotations=duration,distance${q}`);
    j.durations.forEach((row, r) => row.forEach((v, c) => {
      T[src[r]][dst[c]] = v == null ? null : v * factor;
      D[src[r]][dst[c]] = j.distances ? j.distances[r][c] : null;
    }));
    if (onProgress) onProgress(++done, jobs.length);
  });
  return { T, D };
}
// recorrido completo; con más de 100 puntos se pide por tramos que comparten el punto de unión
async function routeFree(points, factor){
  const legs = [], path = [];
  for (let i = 0; i < points.length - 1; i += OSRM_MAX_PTS - 1) {
    const seg = points.slice(i, i + OSRM_MAX_PTS);
    const j = await osrm(`/route/v1/driving/${coordsOf(seg)}?overview=full&geometries=geojson&steps=false`);
    const rt = j.routes[0];
    rt.legs.forEach(l => legs.push({m:l.distance, s:l.duration*factor}));
    const p = rt.geometry.coordinates.map(c => [c[1], c[0]]);
    path.push(...(path.length ? p.slice(1) : p));
  }
  return { legs, path };
}

/* ---------- mejor orden (exacto hasta 13 paradas; heurística 2-opt sobre eso) ---------- */
// nodos de T: 0 = punto de partida. inner = nodos a ordenar. endNode = nodo final fijo, o null = termina donde convenga.
function bestOrder(T, inner, endNode){
  const n = inner.length;
  if (n <= 1) return inner.slice();
  const w = (a,b) => b == null ? 0 : (T[a][b] == null ? 1e9 : T[a][b]);
  if (n <= 13) {
    const S = 1 << n, dp = [], prev = [];
    for (let m=0;m<S;m++){ dp.push(new Float64Array(n).fill(Infinity)); prev.push(new Int8Array(n).fill(-1)); }
    for (let i=0;i<n;i++) dp[1<<i][i] = w(0, inner[i]);
    for (let m=1;m<S;m++) for (let a=0;a<n;a++){
      const cur = dp[m][a]; if (cur === Infinity || !(m & (1<<a))) continue;
      for (let b=0;b<n;b++){ if (m & (1<<b)) continue;
        const nm = m | (1<<b), c = cur + w(inner[a], inner[b]);
        if (c < dp[nm][b]) { dp[nm][b] = c; prev[nm][b] = a; } }
    }
    let last = 0, best = Infinity;
    for (let i=0;i<n;i++){ const c = dp[S-1][i] + w(inner[i], endNode); if (c < best) { best = c; last = i; } }
    const ord = []; let m = S-1;
    while (last >= 0) { ord.push(inner[last]); const p = prev[m][last]; m ^= 1<<last; last = p; }
    return ord.reverse();
  }
  // vecino más cercano + mejoras 2-opt y reubicación.
  // Cada cambio se evalúa en tiempo constante (sumas acumuladas), así funciona rápido con cientos de paradas.
  const left = new Set(inner), ord = []; let cur = 0;
  while (left.size) { let b = null; for (const c of left) if (b === null || w(cur,c) < w(cur,b)) b = c; ord.push(b); left.delete(b); cur = b; }
  // A[0] = partida, A[1..n] = paradas, A[n+1] = final fijo (null = termina donde convenga)
  const A = [0, ...ord, endNode];
  const F = new Float64Array(n + 2), R = new Float64Array(n + 2);
  // F[t]: costo de A[1]→…→A[t] ; R[t]: costo del mismo tramo recorrido al revés
  const prefix = () => { for (let t = 2; t <= n; t++) { F[t] = F[t-1] + w(A[t-1], A[t]); R[t] = R[t-1] + w(A[t], A[t-1]); } };
  const t0 = Date.now(), LIMITE_MS = 5000;
  let improved = true;
  while (improved && Date.now() - t0 < LIMITE_MS) {
    improved = false;
    prefix();
    // 2-opt: dar vuelta el tramo A[i..k]
    for (let i = 1; i < n; i++) for (let k = i + 1; k <= n; k++) {
      const d = w(A[i-1], A[k]) + w(A[i], A[k+1]) - w(A[i-1], A[i]) - w(A[k], A[k+1]) + (R[k] - R[i]) - (F[k] - F[i]);
      if (d < -1) {
        for (let a = i, b = k; a < b; a++, b--) [A[a], A[b]] = [A[b], A[a]];
        prefix(); improved = true;
      }
    }
    // reubicación: sacar una parada y ponerla entre A[j] y A[j+1]
    for (let i = 1; i <= n; i++) {
      const x = A[i], rem = w(A[i-1], A[i+1]) - w(A[i-1], x) - w(x, A[i+1]);
      for (let j = 0; j <= n; j++) {
        if (j === i || j === i - 1) continue;
        const d = rem + w(A[j], x) + w(x, A[j+1]) - w(A[j], A[j+1]);
        if (d < -1) { A.splice(i, 1); A.splice(j < i ? j + 1 : j, 0, x); improved = true; break; }
      }
    }
  }
  return A.slice(1, n + 1);
}

/* ---------- orden para Recogida / Zarpe ----------
   T: tiempos entre [base, parada1..paradaN]. Devuelve los índices de las paradas (1..N) en orden de visita.
   - Zarpe:    base → paradas. Se busca el recorrido más corto que además vaya ALEJÁNDOSE de la base.
   - Recogida: paradas → base. Es el zarpe al revés (con los tiempos en sentido contrario):
               parte por la más lejana y se va ACERCANDO a la base, terminando en ella.
   Cada vez que un tramo se devuelve (se acerca a la base en zarpe, o se aleja en recogida) se suma
   una penalización, para que la ruta avance "en línea" hacia el destino y no vaya y vuelva. */
const BACKTRACK_PENALTY = 1.0;
function orderForService(T, n, svc){
  const N = n + 1;
  const W = [...Array(N)].map(() => Array(N).fill(0));
  // dBase[x]: tiempo entre la base y x, en el sentido del servicio
  const dBase = x => svc === "zarpe" ? T[0][x] : T[x][0];
  for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) {
    if (a === b) continue;
    // se recorre siempre "desde la base hacia afuera"; en recogida el tramo real es b → a
    const t = svc === "zarpe" ? T[a][b] : T[b][a];
    const back = a === 0 ? 0 : Math.max(0, dBase(a) - dBase(b));
    W[a][b] = (t == null ? 1e9 : t) + BACKTRACK_PENALTY * back;
  }
  const inner = [...Array(n)].map((_, i) => i + 1);
  const ord = bestOrder(W, inner, null);
  return svc === "zarpe" ? ord : ord.reverse();
}

/* =====================================================================
   MOTOR GOOGLE (si se ingresa key): Routes API
   ===================================================================== */
const FIELDS = [
  "routes.optimizedIntermediateWaypointIndex",
  "routes.legs.distanceMeters","routes.legs.duration",
  "routes.legs.polyline.encodedPolyline",
  "routes.legs.startLocation","routes.legs.endLocation",
  "geocodingResults"
].join(",");

function decodePoly(str){
  let i=0,lat=0,lng=0; const out=[];
  while (i < str.length) {
    let b,s=0,r=0;
    do { b = str.charCodeAt(i++) - 63; r |= (b & 31) << s; s += 5; } while (b >= 32);
    lat += (r & 1) ? ~(r >> 1) : (r >> 1);
    s=0; r=0;
    do { b = str.charCodeAt(i++) - 63; r |= (b & 31) << s; s += 5; } while (b >= 32);
    lng += (r & 1) ? ~(r >> 1) : (r >> 1);
    out.push([lat/1e5, lng/1e5]);
  }
  return out;
}

async function computeChunk(key, pts, optimize){
  const wp = p => ({address:p.address});
  const body = {
    origin: wp(pts[0]),
    destination: wp(pts[pts.length-1]),
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_AWARE",
    languageCode: "es-CL",
    regionCode: "CL",
    units: "METRIC"
  };
  const inter = pts.slice(1,-1);
  if (inter.length) body.intermediates = inter.map(wp);
  if (optimize && inter.length > 1) body.optimizeWaypointOrder = true;

  let res;
  try {
    res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method:"POST",
      headers:{"Content-Type":"application/json","X-Goog-Api-Key":key,"X-Goog-FieldMask":FIELDS},
      body: JSON.stringify(body)
    });
  } catch(e){
    throw new ApiError("No hay conexión con Google. Revisa tu internet.", 0, "NETWORK");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = data.error || {};
    throw new ApiError(e.message || `Error ${res.status}`, res.status, e.status);
  }
  const route = data.routes && data.routes[0];
  if (!route) throw new ApiError("Google no encontró una ruta entre esos puntos.", 200, "ZERO_RESULTS");

  // coincidencias parciales (dirección ambigua)
  const partial = [];
  const g = data.geocodingResults || {};
  if (g.origin && g.origin.partialMatch) partial.push(pts[0].label);
  if (g.destination && g.destination.partialMatch) partial.push(pts[pts.length-1].label);
  (g.intermediates || []).forEach(x => {
    if (x.partialMatch) {
      const idx = x.intermediateWaypointRequestIndex;
      if (inter[idx]) partial.push(inter[idx].label);
    }
  });

  let order = inter.map((_,i) => i);
  if (route.optimizedIntermediateWaypointIndex && route.optimizedIntermediateWaypointIndex.length) {
    order = route.optimizedIntermediateWaypointIndex;
  }
  const legs = (route.legs || []).map(l => ({
    m: l.distanceMeters || 0, s: parseSecs(l.duration),
    path: l.polyline && l.polyline.encodedPolyline ? decodePoly(l.polyline.encodedPolyline) : [],
    start: l.startLocation && l.startLocation.latLng, end: l.endLocation && l.endLocation.latLng
  }));
  return { order, legs, partial };
}

async function computeAllGoogle(key, points, optimize){
  const MAX_PTS = 27; // origen + 25 intermedios + destino
  if (optimize) {
    if (points.length - 2 > 25) throw new ApiError("Para ordenar la ruta el máximo es 25 paradas. Quita algunas o elige otra opción.", 0, "TOO_MANY");
    const r = await computeChunk(key, points, true);
    const inter = points.slice(1,-1);
    const ordered = [points[0], ...r.order.map(i => inter[i]), points[points.length-1]];
    return { points: ordered, legs: r.legs, partial: r.partial };
  }
  if (points.length <= MAX_PTS) {
    const r = await computeChunk(key, points, false);
    return { points, legs: r.legs, partial: r.partial };
  }
  // más de 25 paradas: se parte en tramos que comparten el punto final/inicial
  let legs = [], partial = [], i = 0;
  while (i < points.length - 1) {
    const chunk = points.slice(i, i + MAX_PTS);
    const r = await computeChunk(key, chunk, false);
    legs = legs.concat(r.legs); partial = partial.concat(r.partial);
    i += chunk.length - 1;
  }
  return { points, legs, partial };
}

async function computeMatrixGoogle(key, origin, list){
  const wp = p => ({ waypoint:{ address:p.address } });
  const body = {
    origins:[wp(origin)], destinations:list.map(wp),
    travelMode:"DRIVE", routingPreference:"TRAFFIC_AWARE",
    languageCode:"es-CL", regionCode:"CL", units:"METRIC"
  };
  let res;
  try {
    res = await fetch("https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix", {
      method:"POST",
      headers:{"Content-Type":"application/json","X-Goog-Api-Key":key,
        "X-Goog-FieldMask":"originIndex,destinationIndex,duration,distanceMeters,status,condition"},
      body: JSON.stringify(body)
    });
  } catch(e){ throw new ApiError("No hay conexión con Google. Revisa tu internet.", 0, "NETWORK"); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = (Array.isArray(data) ? data[0] : data).error || {};
    throw new ApiError(e.message || `Error ${res.status}`, res.status, e.status);
  }
  const out = new Array(list.length).fill(null);
  (Array.isArray(data) ? data : []).forEach(el => {
    const i = el.destinationIndex || 0;
    if (el.condition === "ROUTE_EXISTS" || el.duration) {
      out[i] = { m: el.distanceMeters || 0, s: parseSecs(el.duration) };
    }
  });
  return out;
}

function explainError(e){
  const m = e.message || "";
  if (e.code === "NETWORK") return ["Sin conexión", m];
  if (e.code === "NOT_FOUND") return ["No encontré estas direcciones", "Revisa cómo están escritas y que tengan su comuna: " + m];
  if (e.code === "FREE") return ["No se pudo calcular la ruta", m];
  if (e.code === "ZERO_RESULTS") return ["Sin ruta", "Revisa que cada dirección tenga su comuna y esté bien escrita."];
  if (e.code === "TOO_MANY") return ["Demasiadas paradas", m];
  if (e.status === 400 && /API key/i.test(m)) return ["La key no es válida", "Copia la key completa desde Google Cloud, sin espacios. O borra la key para usar el modo gratis."];
  if (e.status === 400) return ["Google no entendió alguna dirección", m];
  if (e.status === 403 || e.status === 401) {
    return ["Google rechazó la key",
      "Revisa que Routes API esté habilitada, que el proyecto tenga facturación activa y que las restricciones de la key permitan Routes API. " +
      "También puedes borrar la key para usar el modo gratis. Detalle: " + m];
  }
  if (e.status === 429) return ["Demasiadas consultas", "Espera un momento y vuelve a intentar."];
  return ["No se pudo calcular la ruta", m];
}

/* ---------- construir puntos desde el formulario ---------- */
function collect(){
  const oDir = $("#o-dir").value.trim(), oCom = cleanCom($("#o-com").value);
  const list = stops.filter(s => s.dir.trim()).map(s => {
    const com = cleanCom(s.com);
    return { ref: s, dir: s.dir.trim(), com,
      label: com ? `${s.dir.trim()}, ${com}` : s.dir.trim(),
      address: fullAddress(s.dir, com) };
  });
  const origin = { dir: oDir, com: oCom, label: oCom ? `${oDir}, ${oCom}` : oDir, address: fullAddress(oDir, oCom) };
  return { origin, list };
}

/* ---------- Google Maps (enlaces, sin key) ---------- */
// Puntos por enlace de Google Maps (contando inicio y fin):
// - computador: el formato /maps/dir/A/B/C/… acepta hasta 25 puntos en un solo enlace
// - celular: la app de Google Maps solo muestra 10 puntos, por eso se ofrecen tramos de 10
const MAPS_MAX_PHONE = 10;
// paradas por enlace elegidas en Opciones (1 a 50; por defecto 24 = 25 puntos contando la base)
function maxStops(){
  const n = Math.round(Number($("#maxStops").value));
  return Number.isFinite(n) ? Math.min(50, Math.max(1, n)) : 24;
}
const maxPc = () => maxStops() + 1;   // puntos por enlace, contando la base
(function(){
  const el = $("#maxStops"), v = store.get("pr_maxstops");
  if (v) el.value = v;
  el.value = maxStops();
  el.addEventListener("change", () => { el.value = maxStops(); store.set("pr_maxstops", el.value); });
})();
function mapsLinks(points, maxPts = maxPc()){
  const STEP = maxPts - 1, links = [];
  // si el pin se corrigió a mano en el mapa se manda la ubicación exacta; si no, la dirección escrita
  const where = p => p.manual && p.lat != null ? `${p.lat.toFixed(6)},${p.lng.toFixed(6)}` : p.address;
  for (let i = 0; i < points.length - 1; i += STEP) {
    // cada tramo empieza donde terminó el anterior
    const seg = points.slice(i, i + STEP + 1);
    if (maxPts > 10) {
      links.push("https://www.google.com/maps/dir/" + seg.map(p => encodeURIComponent(where(p))).join("/") + "/");
    } else {
      const o = seg[0], d = seg[seg.length-1], w = seg.slice(1,-1).map(where).join("|");
      let url = "https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=" + encodeURIComponent(where(o)) +
                "&destination=" + encodeURIComponent(where(d));
      if (w) url += "&waypoints=" + encodeURIComponent(w);
      links.push(url);
    }
  }
  return links;
}
// arma el recorrido según el servicio: recogida = paradas → base ; zarpe = base → paradas
function withBase(base, ordered, svc){ return svc === "recogida" ? [...ordered, base] : [base, ...ordered]; }
const baseIdx = r => r.svc === "recogida" ? r.points.length - 1 : 0;
// número que se muestra: "B" para la base y 1, 2, 3… para las paradas en orden de visita
const numOf = (r, i) => i === baseIdx(r) ? "B" : String(r.svc === "recogida" ? i + 1 : i);
const svcName = s => s === "recogida" ? "Recogida" : "Zarpe";

$("#openNow").onclick = () => {
  clearMsgs();
  const { origin, list } = collect();
  if (!origin.address || !list.length) return showErr("Faltan datos", "Ingresa la base y al menos una parada.");
  const links = mapsLinks(withBase(origin, list, service()));
  window.open(links[0], "_blank", "noopener");
  if (links.length > 1) setTimeout(() => scrollToEl($("#warnBox")), 0);
  if (links.length > 1) showWarn(`<strong>Ruta en ${links.length} partes</strong>Cada enlace lleva hasta ${maxStops()} paradas (puedes subirlo hasta 50 en Opciones). Se abrió la parte 1; abre las demás en orden: ` +
    links.slice(1).map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener">Parte ${i + 2}</a>`).join(" · "));
};

/* ---------- Calcular ---------- */
$("#go").onclick = async () => {
  clearMsgs();
  const key = "";
  store.del("pr_key");

  const { origin, list } = collect();
  if (!origin.address) return showErr("Falta la base", "Ingresa dirección y comuna de la base.");
  if (!list.length) return showErr("Faltan paradas", "Agrega al menos una dirección.");

  const svc = service();
  const optimize = document.querySelector('input[name=mode]:checked').value === "opt";

  const btn = $("#go"); btn.disabled = true; btn.textContent = "Calculando…";
  try {
    const factor = parseFloat($("#traffic").value) || 1;
    let ordered = list, changed = false;

    // 1) ordenar (se usa el motor gratuito para medir tiempos entre todas las direcciones)
    if (optimize && list.length > 1) {
      await locateAll([origin, ...list], (i, n) => { btn.textContent = `Ubicando direcciones ${i}/${n}…`; });
      btn.textContent = "Midiendo tiempos entre paradas…";
      const all = [origin, ...list];
      const {T} = await matrixFree(all, factor, (i, n) => { if (n > 1) btn.textContent = `Midiendo tiempos entre paradas ${i}/${n}…`; });
      btn.textContent = "Buscando el mejor orden…";
      await sleep(30);   // deja que se vea el mensaje antes del cálculo
      ordered = orderForService(T, list.length, svc).map(k => all[k]);
      changed = ordered.some((p, i) => p !== list[i]);
      // la lista editable queda en el nuevo orden
      stops = ordered.map(p => p.ref);
      persist(); renderStops();
    }
    const points = withBase(origin, ordered, svc);

    // 2) trazar el recorrido
    let r;
    btn.textContent = "Trazando la ruta…";
    if (key) {
      r = await computeAllGoogle(key, points, false);
      r.google = true;
      r.locs = r.points.map((_, i) => {
        const ll = i === 0 ? (r.legs[0] && r.legs[0].start) : (r.legs[i-1] && r.legs[i-1].end);
        return ll ? {lat:ll.latitude, lng:ll.longitude} : null;
      });
    } else {
      if (!optimize || list.length === 1)
        await locateAll([origin, ...list], (i, n) => { btn.textContent = `Ubicando direcciones ${i}/${n}…`; });
      btn.textContent = "Trazando la ruta…";
      const rt = await routeFree(points, factor);
      r = { points, legs: rt.legs, path: rt.path, partial: [], google: false,
            locs: points.map(p => ({lat:p.lat, lng:p.lng})) };
    }
    r.svc = svc;

    lastResult = r;
    renderResult(r, changed);
    scrollToEl($("#warnBox").classList.contains("hidden") ? $("#results") : $("#warnBox"));
    const on = $("#orderNote");
    on.textContent = svc === "recogida"
      ? "Recogida: parte por la parada más lejana, va acercándose y termina en la base."
      : "Zarpe: sale de la base, va alejándose y termina en la parada más lejana.";
    on.classList.remove("hidden");
  } catch(e){
    console.error(e);
    const [t,d] = explainError(e);
    showErr(t, d);
  } finally {
    btn.disabled = false; btn.textContent = "Calcular ruta";
  }
};

function renderResult(r, changed){
  const totalM = r.legs.reduce((a,l) => a + (l.m||0), 0);
  const totalS = r.legs.reduce((a,l) => a + (l.s||0), 0);
  $("#sKm").textContent = fmtKm(totalM);
  $("#sTime").textContent = fmtDur(totalS);
  $("#sStops").textContent = String(r.points.length - 1);
  $("#summary").classList.remove("hidden");
  $("#results").classList.remove("hidden");

  const ol = $("#routeList"); ol.innerHTML = "";
  const bi = baseIdx(r);
  r.points.forEach((p,i) => {
    const li = document.createElement("li");
    const isBase = i === bi;
    li.className = (isBase ? "first" : (p.approx ? "apx" : ""));
    const leg = i > 0 ? r.legs[i-1] : null;
    const legTxt = leg ? `<div class="leg">Desde ${i === 1 && bi === 0 ? "la base" : "la parada anterior"}: <b>${fmtKm(leg.m||0)}</b> · <b>${fmtDur(leg.s||0)}</b></div>` : "";
    const tag = isBase ? (r.svc === "recogida" ? "Base · destino final" : "Base · salida") : "";
    const found = !r.google && p.fmt ? `<div class="found">Ubicada en: ${esc(p.fmt)}</div>` : "";
    const apx = p.approx && !isBase ? `<div class="apxTxt">⚠ Ubicación aproximada: revisa que la dirección y la comuna estén bien escritas</div>` : "";
    li.innerHTML = `<span class="dot">${numOf(r, i)}</span><div><div class="addr">${esc(p.label)}${tag ? ` <span style="color:var(--muted);font-weight:400">(${tag})</span>` : ""}</div>${found}${apx}${legTxt}</div>`;
    ol.appendChild(li);
  });

  const links = mapsLinks(r.points);
  const Lk = $("#mapLinks"); Lk.innerHTML = "";
  const addLink = (box, u, text, cls) => {
    const a = document.createElement("a");
    a.className = cls; a.href = u; a.target = "_blank"; a.rel = "noopener"; a.textContent = text;
    box.appendChild(a);
  };
  links.forEach((u,i) => addLink(Lk, u, links.length === 1 ? "Abrir ruta completa en Google Maps" : `Abrir parte ${i+1} de ${links.length}`, "btn"));

  // tramos de 10 puntos para la app del celular
  const phone = mapsLinks(r.points, MAPS_MAX_PHONE);
  const Pk = $("#phoneLinks"); Pk.innerHTML = "";
  if (phone.length > 1) {
    phone.forEach((u,i) => addLink(Pk, u, `Tramo ${i+1}`, "btn alt"));
    $("#phoneBox").classList.remove("hidden");
  } else $("#phoneBox").classList.add("hidden");

  $("#linksNote").textContent =
    (links.length > 1 ? `Cada enlace lleva hasta ${maxStops()} paradas (puedes subirlo hasta 50 en Opciones), por eso la ruta se divide en ${links.length} partes. ` : "") +
    (r.google ? "" : `Tiempos estimados (${$("#traffic").selectedOptions[0].textContent.toLowerCase()}).`);
  $("#resultActions").classList.remove("hidden");

  if (changed) showWarn("El orden de las paradas cambió para que la ruta sea más eficiente y avance en línea hacia el destino. La lista de la izquierda quedó en el nuevo orden.");
  const apx = [...new Set(r.points.filter((p,i) => i !== bi && p.approx).map(p => p.label))];
  if (apx.length) showWarn("<strong>Revisa estas direcciones</strong>Se ubicaron de forma aproximada, así que los km y tiempos pueden variar. Revisa que estén bien escritas:" + apx.map(esc).join(" · "));
  if (r.partial && r.partial.length) {
    const uniq = [...new Set(r.partial)];
    showWarn("<strong>Revisa estas direcciones</strong>Google las ubicó con coincidencia parcial y podrían estar mal: " + uniq.map(esc).join(" · "));
  }
}

/* ---------- copiar / CSV ---------- */
$("#copyRoute").onclick = async () => {
  if (!lastResult) return;
  const r = lastResult, bi = baseIdx(r);
  const totalM = r.legs.reduce((a,l) => a + (l.m||0), 0), totalS = r.legs.reduce((a,l) => a + (l.s||0), 0);
  const txt = [`${svcName(r.svc)} · ${r.points.length - 1} paradas · ${fmtKm(totalM)} · ${fmtDur(totalS)}`, "",
    ...r.points.map((p,i) => i === bi ? `🏠 Base: ${p.label}` : `${numOf(r, i)}. ${p.label}`)].join("\n");
  try { await navigator.clipboard.writeText(txt); $("#copyRoute").textContent = "Copiado"; }
  catch(e){ $("#copyRoute").textContent = "No se pudo copiar"; }
  setTimeout(() => $("#copyRoute").textContent = "Copiar ruta", 1600);
};
$("#dlCsv").onclick = () => {
  if (!lastResult) return;
  const r = lastResult, bi = baseIdx(r);
  const q = v => `"${String(v).replace(/"/g,'""')}"`;
  const rows = [["Servicio","Orden","Dirección","Distancia tramo (km)","Tiempo tramo (min)"]];
  r.points.forEach((p,i) => {
    const l = i>0 ? r.legs[i-1] : null;
    rows.push([svcName(r.svc), i === bi ? "Base" : numOf(r, i), p.label,
      l ? ((l.m||0)/1000).toFixed(1).replace(".",",") : "",
      l ? Math.round((l.s||0)/60) : ""]);
  });
  const csv = "﻿" + rows.map(x => x.map(q).join(";")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], {type:"text/csv;charset=utf-8"}));
  a.download = `ruta_${r.svc}.csv`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};

// al abrir la página se ubican en segundo plano las direcciones que ya estaban cargadas
prefetchGeo();
