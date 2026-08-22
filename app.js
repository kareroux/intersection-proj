/* ============================================================
   CONFIG — paste your Supabase project details here once you've
   created a free project at https://supabase.com (see README.md).
   ============================================================ */
const SUPABASE_URL = "";
const SUPABASE_ANON_KEY = "";

let supabaseClient = null;
if (SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase) {
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

function showFatalError(msg) {
  let banner = document.getElementById("fatalBanner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "fatalBanner";
    banner.style.cssText = "background:#c0392b;color:#fff;padding:10px 16px;font-size:0.85rem;position:sticky;top:0;z-index:9999;";
    document.body.prepend(banner);
  }
  banner.textContent = "오류: " + msg + " (자세한 내용은 브라우저 개발자 콘솔 확인)";
  console.error(msg);
}

/* ---------- simple shared-storage layer ---------- */
const DB = {
  async getBookings() {
    if (supabaseClient) {
      const { data, error } = await supabaseClient.from("bookings").select("*");
      if (error) { console.error(error); return []; }
      return data;
    }
    return JSON.parse(localStorage.getItem("bookings") || "[]");
  },
  async addBooking(booking) {
    if (supabaseClient) {
      const { data, error } = await supabaseClient.from("bookings").insert(booking).select();
      if (error) { console.error(error); return booking; }
      return data[0];
    }
    const all = JSON.parse(localStorage.getItem("bookings") || "[]");
    booking.id = "local-" + Date.now();
    all.push(booking);
    localStorage.setItem("bookings", JSON.stringify(all));
    return booking;
  }
};

/* ---------- navigation ---------- */
function goTo(id) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  if (id === "page1" && map1) setTimeout(() => map1.invalidateSize(), 50);
  if (id === "page2" && map2) setTimeout(() => map2.invalidateSize(), 50);
  if (id === "page5") { setTimeout(() => map5 && map5.invalidateSize(), 50); renderRoutesPage(); }
}
document.querySelectorAll("[data-goto]").forEach(btn => {
  btn.addEventListener("click", () => goTo(btn.dataset.goto));
});
document.getElementById("toBooking").addEventListener("click", () => goTo("page2"));
document.getElementById("toBrowse").addEventListener("click", () => goTo("page5"));

/* ============================================================
   PAGE 1 — live flight map + locally-built flight paths
   ============================================================ */
let map1, flightMarkers = [];
const trails = {};
const trailLines = {};
const MAX_TRAIL_POINTS = 40;
const POLL_MS = 90000;
const MOVE_DEBOUNCE_MS = 15000;
let lastFetchTime = 0;
let consecutiveFailures = 0;

function initMap1() {
  map1 = L.map("map1").setView([36.5, 127.8], 6);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map1);
  loadFlights();
  map1.on("moveend", () => {
    if (Date.now() - lastFetchTime > MOVE_DEBOUNCE_MS) loadFlights();
  });
  setInterval(loadFlights, POLL_MS);
}

function setStatusLine(msg) {
  let el = document.getElementById("flightStatusLine");
  if (!el) {
    el = document.createElement("p");
    el.id = "flightStatusLine";
    el.style.cssText = "font-size:0.7rem;opacity:0.75;margin-top:6px;";
    document.getElementById("flightInfo").after(el);
  }
  el.textContent = msg;
}

async function loadFlights() {
  const b = map1.getBounds();
  const url = `https://opensky-network.org/api/states/all?lamin=${b.getSouth()}&lomin=${b.getWest()}&lamax=${b.getNorth()}&lomax=${b.getEast()}`;
  const infoEl = document.getElementById("flightInfo");
  lastFetchTime = Date.now();
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      throw new Error("OpenSky HTTP " + res.status + (res.status === 429 ? " (일일 무료 요청 한도 초과)" : ""));
    }
    const data = await res.json();
    consecutiveFailures = 0;
    setStatusLine("마지막 업데이트: " + new Date().toLocaleTimeString("ko-KR"));

    flightMarkers.forEach(m => map1.removeLayer(m));
    flightMarkers = [];

    const states = data.states || [];
    if (states.length === 0) {
      infoEl.innerHTML = "현재 시야 범위 안에 표시할 항공편이 없습니다. 지도를 이동해보세요.";
    }

    states.slice(0, 200).forEach(s => {
      const [icao24, callsign, country, , , lon, lat, , on_ground, velocity, track] = s;
      if (lat == null || lon == null) return;

      if (!trails[icao24]) trails[icao24] = [];
      const last = trails[icao24][trails[icao24].length - 1];
      if (!last || last[0] !== lat || last[1] !== lon) {
        trails[icao24].push([lat, lon]);
        if (trails[icao24].length > MAX_TRAIL_POINTS) trails[icao24].shift();
      }
      if (trailLines[icao24]) map1.removeLayer(trailLines[icao24]);
      if (trails[icao24].length > 1) {
        trailLines[icao24] = L.polyline(trails[icao24], { color: "#4f97d6", weight: 2, opacity: 0.7 }).addTo(map1);
      }

      const icon = L.divIcon({
        className: "plane-icon",
        html: `<div style="transform:rotate(${track || 0}deg); font-size:16px;">\u2708\ufe0f</div>`,
        iconSize: [20, 20]
      });
      const marker = L.marker([lat, lon], { icon }).addTo(map1);
      marker.on("click", () => {
        infoEl.innerHTML =
          `<b>Callsign:</b> ${(callsign || "\u2014").trim()}<br>` +
          `<b>Country:</b> ${country}<br>` +
          `<b>Speed:</b> ${velocity ? Math.round(velocity * 3.6) + " km/h" : "\u2014"}<br>` +
          `<b>Status:</b> ${on_ground ? "On ground" : "In flight"}`;
      });
      flightMarkers.push(marker);
    });
  } catch (e) {
    consecutiveFailures++;
    infoEl.innerHTML =
      `실시간 항공편 정보를 불러올 수 없습니다.<br><span style="font-size:0.75rem;opacity:0.85">(${e.message}${consecutiveFailures > 1 ? ", " + consecutiveFailures + "회 연속 실패" : ""})</span>`;
    setStatusLine("마지막 시도: " + new Date().toLocaleTimeString("ko-KR") + " (실패)");
    console.error("OpenSky fetch failed:", e);
    if (consecutiveFailures >= 2) setTimeout(loadFlights, POLL_MS * 5);
  }
}

/* ---------- shared helpers ---------- */
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// gently-curved (parenthesis-like) arc between two points, always bowing north
function curvedPath(p1, p2, curvature = 0.15) {
  const [lat1, lng1] = p1, [lat2, lng2] = p2;
  const midLat = (lat1 + lat2) / 2;
  const midLng = (lng1 + lng2) / 2;
  const distDeg = Math.hypot(lat2 - lat1, lng2 - lng1);
  const bowLat = midLat + distDeg * curvature;
  const pts = [];
  for (let t = 0; t <= 1.0001; t += 0.04) {
    const lat = (1 - t) ** 2 * lat1 + 2 * (1 - t) * t * bowLat + t ** 2 * lat2;
    const lng = (1 - t) ** 2 * lng1 + 2 * (1 - t) * t * midLng + t ** 2 * lng2;
    pts.push([lat, lng]);
  }
  return pts;
}

// random seat like "3B" out of a 7 x 16 grid, avoiding seats already taken
function assignRandomSeat(existingBookings) {
  const taken = new Set(existingBookings.map(b => b.seat));
  const letters = "ABCDEFGHIJKLMNOP".split("");
  for (let attempt = 0; attempt < 300; attempt++) {
    const pos = 1 + Math.floor(Math.random() * 7);
    const letter = letters[Math.floor(Math.random() * letters.length)];
    const seat = `${pos}${letter}`;
    if (!taken.has(seat)) return seat;
  }
  return `${1 + Math.floor(Math.random() * 7)}${letters[Math.floor(Math.random() * letters.length)]}`;
}

/* ============================================================
   PAGE 2 — booking form + live ticket (combined)
   ============================================================ */
let map2, fromMarker, toMarker, routeLine;
let fromCoords = null, toCoords = null;
let booking = {};

function initPage2() {
  const fromSel = document.getElementById("bFrom");
  KOREAN_CITIES.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.name;
    opt.textContent = c.name;
    opt.dataset.lat = c.lat;
    opt.dataset.lon = c.lon;
    fromSel.appendChild(opt);
  });
  const dl = document.getElementById("airportList");
  AIRPORTS.forEach(a => {
    const opt = document.createElement("option");
    opt.value = a.name;
    dl.appendChild(opt);
  });

  map2 = L.map("map2").setView([37.5, 127], 5);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map2);

  fromSel.addEventListener("change", () => {
    const c = KOREAN_CITIES.find(c => c.name === fromSel.value);
    if (c) { fromCoords = { ...c }; updateRouteMap(); }
  });
  document.getElementById("bTo").addEventListener("change", (e) => {
    const a = AIRPORTS.find(a => a.name === e.target.value);
    if (a) { toCoords = { ...a }; updateRouteMap(); }
  });
  ["bName", "bReason"].forEach(id => {
    document.getElementById(id).addEventListener("input", updateTicketPreview);
  });
}

function updateRouteMap() {
  if (fromMarker) map2.removeLayer(fromMarker);
  if (toMarker) map2.removeLayer(toMarker);
  if (routeLine) map2.removeLayer(routeLine);

  const points = [];
  if (fromCoords) {
    fromMarker = L.marker([fromCoords.lat, fromCoords.lon], { draggable: true })
      .addTo(map2).bindPopup("FROM: " + fromCoords.name);
    fromMarker.on("dragend", () => {
      const p = fromMarker.getLatLng();
      fromCoords.lat = p.lat; fromCoords.lon = p.lng;
      updateRouteMap();
    });
    points.push([fromCoords.lat, fromCoords.lon]);
  }
  if (toCoords) {
    toMarker = L.marker([toCoords.lat, toCoords.lon], { draggable: true })
      .addTo(map2).bindPopup("TO: " + toCoords.name);
    toMarker.on("dragend", () => {
      const p = toMarker.getLatLng();
      toCoords.lat = p.lat; toCoords.lon = p.lng;
      updateRouteMap();
    });
    points.push([toCoords.lat, toCoords.lon]);
  }

  if (fromCoords && toCoords) {
    const arc = curvedPath([fromCoords.lat, fromCoords.lon], [toCoords.lat, toCoords.lon]);
    routeLine = L.polyline(arc, { color: "#e69a4a", weight: 3 }).addTo(map2);
    map2.fitBounds(points, { padding: [30, 30] });
  } else if (points.length === 1) {
    map2.setView(points[0], 9);
  }
  updateTicketPreview();
}

function updateTicketPreview() {
  const name = document.getElementById("bName").value.trim();
  const reason = document.getElementById("bReason").value.trim();

  document.getElementById("tkName").textContent = name || "—";
  document.getElementById("tkFrom").textContent = "FROM: " + (fromCoords ? fromCoords.name : "—");
  document.getElementById("tkTo").textContent = "TO: " + (toCoords ? toCoords.name : "—");
  document.getElementById("tkReason").textContent = reason || "—";
  document.getElementById("tkRoute").textContent = (fromCoords && toCoords)
    ? `FROM ${fromCoords.name} \u2192 TO ${toCoords.name}` : "—";
  document.getElementById("tkSeat").textContent = "SEAT: " + (booking.seat || "—");

  if (fromCoords && toCoords) {
    const dist = haversine(fromCoords.lat, fromCoords.lon, toCoords.lat, toCoords.lon);
    document.getElementById("tkDistTime").textContent =
      `\uc57d ${Math.round(dist).toLocaleString()} km \u00b7 \uc57d ${(dist / 800).toFixed(1)}\uc2dc\uac04`;
  } else {
    document.getElementById("tkDistTime").textContent = "—";
  }

  const stamp = document.getElementById("tkStamp");
  stamp.innerHTML = (toCoords && toCoords.iso2)
    ? `<img src="https://flagcdn.com/w80/${toCoords.iso2}.png" style="width:50px;border-radius:4px;"><br>${toCoords.country}`
    : "\ubaa9\uc801\uc9c0 \uc120\ud0dd \uc2dc<br>\uc2a4\ud0ec\ud504\uac00 \ud45c\uc2dc\ub429\ub2c8\ub2e4";
}

document.getElementById("toTicket").addEventListener("click", async () => {
  const name = document.getElementById("bName").value.trim();
  const reason = document.getElementById("bReason").value.trim();
  const toVal = document.getElementById("bTo").value.trim();
  const toMatch = AIRPORTS.find(a => a.name === toVal);

  const missing = [];
  if (!name) missing.push("bName");
  if (!fromCoords) missing.push("bFrom");
  if (!toMatch) missing.push("bTo");
  if (!reason) missing.push("bReason");

  document.querySelectorAll(".form-col input, .form-col select, .form-col textarea").forEach(el => el.style.borderColor = "#ccc");
  if (missing.length) {
    missing.forEach(id => document.getElementById(id).style.borderColor = "#c0392b");
    document.getElementById("bHint").textContent = "\ubaa8\ub4e0 \uc815\ubcf4\ub97c \uc785\ub825\ud574\uc8fc\uc138\uc694.";
    return;
  }
  document.getElementById("bHint").textContent = "";
  toCoords = { ...toMatch };

  const existing = await DB.getBookings();
  const seat = assignRandomSeat(existing);

  const full = {
    name, reason, seat,
    from_name: fromCoords.name, from_lat: fromCoords.lat, from_lon: fromCoords.lon,
    to_name: toMatch.name, to_country: toMatch.country, to_iso2: toMatch.iso2,
    to_lat: toMatch.lat, to_lon: toMatch.lon,
    created_at: new Date().toISOString()
  };
  const saved = await DB.addBooking(full);
  booking = saved;
  updateTicketPreview();

  // brief pause so the person actually sees their finished ticket before we move on
  setTimeout(() => goTo("page5"), 1200);
});

/* ============================================================
   PAGE 5 — 다른 사용자 둘러보기: every booked trip as a curved
   route line; click a line to see that person's ticket.
   ============================================================ */
let map5, routeLayers = [];
let selectedRouteLayer = null;

function initMap5() {
  map5 = L.map("map5").setView([20, 60], 2);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map5);
}

async function renderRoutesPage() {
  if (!map5) initMap5();
  routeLayers.forEach(l => map5.removeLayer(l));
  routeLayers = [];
  selectedRouteLayer = null;

  const bookings = await DB.getBookings();
  const panel = document.getElementById("routeInfoPanel");

  if (bookings.length === 0) {
    panel.innerHTML = `<p class="placeholder-text">아직 아무도 여정을 등록하지 않았습니다.</p>`;
    return;
  }
  panel.innerHTML = `<p class="placeholder-text">경로를 선택하면 그 사람의 티켓이 여기에 표시됩니다.</p>`;

  const allPoints = [];
  bookings.forEach(b => {
    if (b.from_lat == null || b.to_lat == null) return;
    const arc = curvedPath([b.from_lat, b.from_lon], [b.to_lat, b.to_lon]);
    const line = L.polyline(arc, { color: "#4f97d6", weight: 2.5, opacity: 0.75, className: "route-line" }).addTo(map5);
    line.on("click", () => selectRoute(line, b));
    line.on("mouseover", () => line.setStyle({ weight: 4, opacity: 1 }));
    line.on("mouseout", () => { if (line !== selectedRouteLayer) line.setStyle({ weight: 2.5, opacity: 0.75 }); });
    routeLayers.push(line);
    allPoints.push([b.from_lat, b.from_lon], [b.to_lat, b.to_lon]);
  });

  if (allPoints.length) map5.fitBounds(allPoints, { padding: [40, 40] });
}

function selectRoute(line, b) {
  if (selectedRouteLayer) selectedRouteLayer.setStyle({ color: "#4f97d6", weight: 2.5, opacity: 0.75 });
  line.setStyle({ color: "#e69a4a", weight: 4, opacity: 1 });
  selectedRouteLayer = line;

  const dist = haversine(b.from_lat, b.from_lon, b.to_lat, b.to_lon);
  document.getElementById("routeInfoPanel").innerHTML = `
    <p style="font-weight:700;margin-bottom:6px;">${b.name}</p>
    <p>FROM ${b.from_name} \u2192 TO ${b.to_name}</p>
    <p style="margin-top:8px;"><b>\uc774 \uc5ec\uc815\uc774 \uc0c1\uc9d5\ud558\ub294 \uac83:</b><br>${b.reason || "\u2014"}</p>
    <p style="margin-top:8px;">\uc57d ${Math.round(dist).toLocaleString()} km \u00b7 \uc57d ${(dist / 800).toFixed(1)}\uc2dc\uac04</p>
    <p style="margin-top:8px;">SEAT: ${b.seat}</p>
  `;
}

/* ---------- init ---------- */
try {
  initMap1();
  initPage2();
} catch (e) {
  showFatalError(e.message);
}
