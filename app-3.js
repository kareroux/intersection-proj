/* ============================================================
   CONFIG — paste your Supabase project details here once you've
   created a free project at https://supabase.com (see README.md).
   Until you fill these in, the site still works, but seats are
   only saved on YOUR browser (localStorage), not shared with others.
   ============================================================ */
const SUPABASE_URL = "";       // e.g. "https://xxxxxxxx.supabase.co"
const SUPABASE_ANON_KEY = "";  // e.g. "eyJhbGciOi..."

// NOTE: named supabaseClient (not "supabase") on purpose — the Supabase
// CDN script already creates a global called `supabase`, and declaring
// `let supabase = ...` here would collide with it and silently break
// the entire file. Keep this name as-is.
let supabaseClient = null;
if (SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase) {
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

/* ---------- visible error banner (so failures are never silent again) ---------- */
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
  if (id === "page3fresh") { resetBookingForm(); id = "page1"; }
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  if (id === "page1" && map1) setTimeout(() => map1.invalidateSize(), 50);
  if (id === "page2" && map2) setTimeout(() => map2.invalidateSize(), 50);
  if (id === "page5") renderBrowsePage();
}
document.querySelectorAll("[data-goto]").forEach(btn => {
  btn.addEventListener("click", () => goTo(btn.dataset.goto));
});
document.getElementById("toBooking").addEventListener("click", () => goTo("page2"));
document.getElementById("toBrowse").addEventListener("click", () => goTo("page5"));

/* ============================================================
   PAGE 1 — live flight map + locally-built flight paths
   ============================================================ */
let map1;
let flightMarkers = {};  // icao24 -> Leaflet marker (persistent, reused across polls)
const trails = {};       // icao24 -> array of [lat, lon], built up locally over time
const trailLines = {};   // icao24 -> Leaflet polyline
const MAX_TRAIL_POINTS = 60;
const POLL_MS = 12000;
const MAX_PLANES_FOR_TRAILS = 70; // disable path rendering above this many visible planes

function initMap1() {
  map1 = L.map("map1").setView([36.5, 127.8], 6); // default: Korea
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map1);
  loadFlights();
  map1.on("moveend", loadFlights);
  setInterval(loadFlights, POLL_MS); // keep polling so trails/positions stay live
}

function clearTrail(icao24) {
  if (trailLines[icao24]) { map1.removeLayer(trailLines[icao24]); delete trailLines[icao24]; }
  delete trails[icao24];
}

async function loadFlights() {
  const b = map1.getBounds();
  const url = `https://opensky-network.org/api/states/all?lamin=${b.getSouth()}&lomin=${b.getWest()}&lamax=${b.getNorth()}&lomax=${b.getEast()}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    const states = (data.states || []).filter(s => s[5] != null && s[6] != null);
    const seenIds = new Set();
    // to avoid overloading the map, only show flight paths when the number
    // of visible planes is reasonably small
    const showTrails = states.length > 0 && states.length <= MAX_PLANES_FOR_TRAILS;

    states.forEach(s => {
      const [icao24, callsign, country, , , lon, lat, baroAlt, on_ground, velocity, track, , , geoAlt] = s;
      seenIds.add(icao24);
      const altitude = geoAlt != null ? geoAlt : baroAlt;

      if (on_ground) {
        // plane has landed — remove its path immediately
        clearTrail(icao24);
      } else {
        if (!trails[icao24]) trails[icao24] = [];
        const last = trails[icao24][trails[icao24].length - 1];
        if (!last || last[0] !== lat || last[1] !== lon) {
          trails[icao24].push([lat, lon]);
          if (trails[icao24].length > MAX_TRAIL_POINTS) trails[icao24].shift();
        }
        if (trailLines[icao24]) { map1.removeLayer(trailLines[icao24]); delete trailLines[icao24]; }
        if (showTrails && trails[icao24].length > 1) {
          trailLines[icao24] = L.polyline(trails[icao24], { color: "#4f97d6", weight: 2, opacity: 0.7 }).addTo(map1);
        }
      }

      // --- plane marker (reused between polls so it moves smoothly, not flickers) ---
      const icon = L.divIcon({
        className: "plane-icon",
        html: `<div style="transform:rotate(${track || 0}deg); font-size:16px;">\u2708\ufe0f</div>`,
        iconSize: [20, 20]
      });

      const tooltipHtml =
        `<b>${(callsign || "\u2014").trim()}</b><br>` +
        `\uad6d\uac00: ${country}<br>` +
        `\uace0\ub3c4: ${altitude != null ? Math.round(altitude) + " m" : "\u2014"}<br>` +
        `\uc18d\ub3c4: ${velocity ? Math.round(velocity * 3.6) + " km/h" : "\u2014"}<br>` +
        `\uc0c1\ud0dc: ${on_ground ? "\uc9c0\uc0c1" : "\ube44\ud589\uc911"}`;

      let marker = flightMarkers[icao24];
      if (marker) {
        marker.setLatLng([lat, lon]);
        marker.setIcon(icon);
        marker.setTooltipContent(tooltipHtml);
      } else {
        marker = L.marker([lat, lon], { icon }).addTo(map1);
        marker.bindTooltip(tooltipHtml, { direction: "top", offset: [0, -8], sticky: true });
        flightMarkers[icao24] = marker;
      }
      marker.off("click");
      marker.on("click", () => {
        document.getElementById("flightInfo").innerHTML = tooltipHtml;
      });
    });

    // remove markers/paths for planes that are no longer in view
    Object.keys(flightMarkers).forEach(id => {
      if (!seenIds.has(id)) {
        map1.removeLayer(flightMarkers[id]);
        delete flightMarkers[id];
        clearTrail(id);
      }
    });

    document.getElementById("flightInfo").innerHTML =
      `\ud604\uc7ac \ud654\uba74\uc5d0 ${states.length}\ub300\uc758 \ud56d\uacf5\uae30\uac00 \ubcf4\uc785\ub2c8\ub2e4.` +
      (states.length > MAX_PLANES_FOR_TRAILS
        ? `<br><span style="opacity:.85">(\ud56d\uacf5\uae30\uac00 \ub9ce\uc544 \uc774\ub3d9 \uacbd\ub85c \ud45c\uc2dc\uac00 \uc77c\uc2dc\uc801\uc73c\ub85c \ube44\ud65c\uc131\ud654\ub418\uc5c8\uc2b5\ub2c8\ub2e4.)</span>`
        : "") +
      `<br>\ud56d\uacf5\uae30\uc5d0 \ub9c8\uc6b0\uc2a4\ub97c \uc62c\ub9ac\uac70\ub098 \ud074\ub9ad\ud574 \uc815\ubcf4\ub97c \ud655\uc778\ud558\uc138\uc694.`;
  } catch (e) {
    document.getElementById("flightInfo").innerHTML =
      "\uc2e4\uc2dc\uac04 \ud56d\uacf5\ud3b8 \uc815\ubcf4\ub97c \ubd88\ub7ec\uc62c \uc218 \uc5c6\uc2b5\ub2c8\ub2e4. (" + e.message + ")";
    console.error("OpenSky fetch failed:", e);
  }
}

/* ============================================================
   PAGE 2 — booking info
   ============================================================ */
let map2, fromMarker, toMarker, routeLine;
let fromCoords = null, toCoords = null;

function initPage2() {
  const fromSel = document.getElementById("bFrom");
  KOREAN_CITIES.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.name; opt.dataset.lat = c.lat; opt.dataset.lon = c.lon;
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
}

function updateRouteMap() {
  if (fromMarker) map2.removeLayer(fromMarker);
  if (toMarker) map2.removeLayer(toMarker);
  if (routeLine) map2.removeLayer(routeLine);

  const points = [];
  if (fromCoords) { fromMarker = L.marker([fromCoords.lat, fromCoords.lon]).addTo(map2).bindPopup("FROM: " + fromCoords.name); points.push([fromCoords.lat, fromCoords.lon]); }
  if (toCoords) { toMarker = L.marker([toCoords.lat, toCoords.lon]).addTo(map2).bindPopup("TO: " + toCoords.name); points.push([toCoords.lat, toCoords.lon]); }

  if (fromCoords && toCoords) {
    routeLine = L.polyline(points, { color: "#e69a4a", weight: 3 }).addTo(map2);
    map2.fitBounds(points, { padding: [30, 30] });
    const dist = haversine(fromCoords.lat, fromCoords.lon, toCoords.lat, toCoords.lon);
    const hours = dist / 800;
    document.getElementById("routeInfo").innerHTML =
      `<b>\uac70\ub9ac:</b> \uc57d ${Math.round(dist).toLocaleString()} km<br><b>\uc608\uc0c1 \ube44\ud589\uc2dc\uac04:</b> \uc57d ${hours.toFixed(1)}\uc2dc\uac04`;
  } else if (points.length === 1) {
    map2.setView(points[0], 9);
  }
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

let booking = {};
document.getElementById("toSeats").addEventListener("click", () => {
  const name = document.getElementById("bName").value.trim();
  const email = document.getElementById("bEmail").value.trim();
  const consent = document.getElementById("bConsent").checked;
  const toVal = document.getElementById("bTo").value.trim();
  const toMatch = AIRPORTS.find(a => a.name === toVal);

  const missing = [];
  if (!name) missing.push("bName");
  if (!fromCoords) missing.push("bFrom");
  if (!toMatch) missing.push("bTo");
  if (!email) missing.push("bEmail");
  if (!consent) missing.push("bConsent");

  document.querySelectorAll(".form-col input, .form-col select").forEach(el => el.style.borderColor = "#ccc");
  if (missing.length) {
    missing.forEach(id => document.getElementById(id).style.borderColor = "#c0392b");
    document.getElementById("bHint").textContent = "\ubaa8\ub4e0 \uc815\ubcf4\ub97c \uc785\ub825\ud574\uc8fc\uc138\uc694.";
    return;
  }
  document.getElementById("bHint").textContent = "";
  toCoords = { ...toMatch };
  booking = {
    name, email, from_name: fromCoords.name, from_lat: fromCoords.lat, from_lon: fromCoords.lon,
    to_name: toMatch.name, to_country: toMatch.country, to_iso2: toMatch.iso2,
    to_lat: toMatch.lat, to_lon: toMatch.lon
  };
  buildSeatGrid("seatGrid", onSeatPick);
  goTo("page3");
});

function resetBookingForm() {
  booking = {};
  document.getElementById("bName").value = "";
  document.getElementById("bFrom").value = "";
  document.getElementById("bTo").value = "";
  document.getElementById("bEmail").value = "";
  document.getElementById("bConsent").checked = false;
  fromCoords = null; toCoords = null;
}

/* ============================================================
   PAGE 3 — seat selection (2-3-2 layout, rows 1-16)
   ============================================================ */
const SEAT_COLS = ["A", "B", "GAP", "C", "D", "E", "GAP", "F", "G"];
const SEAT_ROWS = 16;
let selectedSeat = null;
let takenSeats = new Set();

async function buildSeatGrid(containerId, onPick) {
  const bookings = await DB.getBookings();
  takenSeats = new Set(bookings.map(b => b.seat));
  const grid = document.getElementById(containerId);
  grid.innerHTML = "";
  selectedSeat = null;
  for (let row = 1; row <= SEAT_ROWS; row++) {
    SEAT_COLS.forEach(col => {
      if (col === "GAP") {
        const gap = document.createElement("div");
        gap.className = "gap";
        grid.appendChild(gap);
        return;
      }
      const seatId = `${row}${col}`;
      const div = document.createElement("div");
      div.className = "seat" + (takenSeats.has(seatId) ? " taken" : "");
      div.dataset.seat = seatId;
      div.title = seatId;
      div.addEventListener("click", () => onPick(seatId, div, bookings));
      grid.appendChild(div);
    });
  }
}

function onSeatPick(seatId, el) {
  if (takenSeats.has(seatId)) {
    document.getElementById("sHint").textContent = "\uc774\ubbf8 \uc120\ud0dd\ub41c \uc88c\uc11d\uc785\ub2c8\ub2e4.";
    return;
  }
  document.querySelectorAll("#seatGrid .seat").forEach(s => s.classList.remove("selected"));
  el.classList.add("selected");
  selectedSeat = seatId;
  document.getElementById("sHint").textContent = "";
}

document.getElementById("toTicket").addEventListener("click", async () => {
  const date = document.getElementById("sDate").value;
  const meal = document.getElementById("sMeal").value;
  const deco = document.getElementById("sDeco").value;
  const note = document.getElementById("sNote").value.trim();
  const status = document.getElementById("sStatus").value.trim();

  const missing = [];
  if (!selectedSeat) missing.push("seatGrid");
  if (!date) missing.push("sDate");
  if (!status) missing.push("sStatus");

  if (missing.length) {
    document.getElementById("sHint").textContent = "\uc88c\uc11d\uacfc \ud544\uc218 \uc815\ubcf4\ub97c \ubaa8\ub450 \uc785\ub825\ud574\uc8fc\uc138\uc694.";
    return;
  }
  document.getElementById("sHint").textContent = "";

  const full = {
    ...booking,
    seat: selectedSeat, dep_date: date, meal, deco, note, status,
    created_at: new Date().toISOString()
  };
  const saved = await DB.addBooking(full);
  showTicket(saved);
  goTo("page4");
});

/* ============================================================
   PAGE 4 — ticket confirmation
   ============================================================ */
function showTicket(b) {
  document.getElementById("tkName").textContent = b.name;
  document.getElementById("tkName2").textContent = b.name;
  document.getElementById("tkDate").textContent = b.dep_date;
  document.getElementById("tkDate2").textContent = b.dep_date;
  document.getElementById("tkFrom").textContent = "FROM: " + b.from_name;
  document.getElementById("tkTo").textContent = "TO: " + b.to_name;
  document.getElementById("tkRoute").textContent = `FROM ${b.from_name} \u2192 TO ${b.to_name}`;
  document.getElementById("tkSeat").textContent = "SEAT: " + b.seat;

  const qrData = encodeURIComponent(location.href.split("?")[0] + "?ticket=" + (b.id || ""));
  document.getElementById("tkQr").src = `https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${qrData}`;

  document.getElementById("tkStamp").innerHTML =
    b.to_iso2 ? `<img src="https://flagcdn.com/w80/${b.to_iso2}.png" style="width:50px;border-radius:4px;"><br>${b.to_country}`
              : (b.to_country || "");

  document.getElementById("tkRouteInfoBtn").onclick = () => {
    const dist = haversine(b.from_lat, b.from_lon, b.to_lat, b.to_lon);
    alert(`\uac70\ub9ac: \uc57d ${Math.round(dist)} km\n\uc608\uc0c1 \ube44\ud589\uc2dc\uac04: \uc57d ${(dist / 800).toFixed(1)}\uc2dc\uac04`);
  };
}

/* ============================================================
   PAGE 5 — browse other seats
   ============================================================ */
async function renderBrowsePage() {
  const bookings = await DB.getBookings();
  const byId = {};
  bookings.forEach(b => byId[b.seat] = b);

  const grid = document.getElementById("seatGrid5");
  grid.innerHTML = "";
  for (let row = 1; row <= SEAT_ROWS; row++) {
    SEAT_COLS.forEach(col => {
      if (col === "GAP") {
        const gap = document.createElement("div");
        gap.className = "gap";
        grid.appendChild(gap);
        return;
      }
      const seatId = `${row}${col}`;
      const div = document.createElement("div");
      const isTaken = !!byId[seatId];
      div.className = "seat" + (isTaken ? " taken" : "");
      div.title = seatId;
      if (isTaken) {
        div.addEventListener("click", () => showBrowseInfo(byId[seatId]));
      }
      grid.appendChild(div);
    });
  }
}

function showBrowseInfo(b) {
  document.getElementById("info5").innerHTML = `
    <p><b>\uc0c1\ud0dc \uba54\uc138\uc9c0:</b> ${b.status || "\u2014"}</p>
    <p><b>\uae30\ub0b4\uc2dd:</b> ${b.meal || "\u2014"}</p>
    <p><b>\ub370\ucf54:</b> ${b.deco || "\u2014"}</p>
  `;
  document.getElementById("ticket5").innerHTML = `
    <p><b>${b.name}</b></p>
    <p>FROM ${b.from_name} \u2192 TO ${b.to_name}</p>
    <p>DATE: ${b.dep_date} \u00b7 SEAT: ${b.seat}</p>
  `;
}

/* ---------- init ---------- */
try {
  initMap1();
  initPage2();
} catch (e) {
  showFatalError(e.message);
}
