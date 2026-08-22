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
let map1, flightMarkers = [];
const trails = {};
const trailLines = {};
const MAX_TRAIL_POINTS = 40;

// OpenSky's anonymous tier is capped at ~400 credits/day PER IP. Polling
// every few seconds (or on every map drag) burns through that in minutes,
// after which every request fails — which is what "doesn't load real-time
// info" almost always turns out to be. 90s is conservative enough that a
// full day of one visitor's browsing stays comfortably inside the quota.
const POLL_MS = 90000;
const MOVE_DEBOUNCE_MS = 15000; // ignore a moveend if we just fetched recently
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
      // surface the exact status so we can diagnose:
      // 429 = anonymous daily quota used up (most common cause)
      // 401/403 = blocked/auth required · 5xx = OpenSky's own servers down
      throw new Error("OpenSky HTTP " + res.status + (res.status === 429 ? " (일일 무료 요청 한도 초과)" : ""));
    }
    const data = await res.json();
    consecutiveFailures = 0;
    setStatusLine("마지막 업데이트: " + new Date().toLocaleTimeString("ko-KR"));
    const seenIds = new Set();

    flightMarkers.forEach(m => map1.removeLayer(m));
    flightMarkers = [];

    const states = data.states || [];
    if (states.length === 0) {
      infoEl.innerHTML = "현재 시야 범위 안에 표시할 항공편이 없습니다. 지도를 이동해보세요.";
    }

    states.slice(0, 200).forEach(s => {
      const [icao24, callsign, country, , , lon, lat, , on_ground, velocity, track] = s;
      if (lat == null || lon == null) return;
      seenIds.add(icao24);

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
    // back off much harder after repeated failures — if this is quota
    // exhaustion (429), hammering it again immediately only makes it worse
    if (consecutiveFailures >= 2) {
      setTimeout(loadFlights, POLL_MS * 5);
    }
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
    opt.value = c.name;
    opt.textContent = c.name; // <-- this was missing; dropdown showed blank labels before
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
}

// build a gently-curved (parenthesis-like) arc between two points
function curvedPath(p1, p2, curvature = 0.15) {
  const [lat1, lng1] = p1, [lat2, lng2] = p2;
  const midLat = (lat1 + lat2) / 2;
  const midLng = (lng1 + lng2) / 2;
  const distDeg = Math.hypot(lat2 - lat1, lng2 - lng1);
  const bowLat = midLat + distDeg * curvature; // always bows "upward" (north)
  const pts = [];
  for (let t = 0; t <= 1.0001; t += 0.04) {
    const lat = (1 - t) ** 2 * lat1 + 2 * (1 - t) * t * bowLat + t ** 2 * lat2;
    const lng = (1 - t) ** 2 * lng1 + 2 * (1 - t) * t * midLng + t ** 2 * lng2;
    pts.push([lat, lng]);
  }
  return pts;
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
    const dist = haversine(fromCoords.lat, fromCoords.lon, toCoords.lat, toCoords.lon);
    const hours = dist / 800;
    document.getElementById("routeInfo").innerHTML =
      `<b>\uac70\ub9ac:</b> \uc57d ${Math.round(dist).toLocaleString()} km<br><b>\uc608\uc0c1 \ube44\ud589\uc2dc\uac04:</b> \uc57d ${hours.toFixed(1)}\uc2dc\uac04`;
    updateTicketPreview();
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
  const reason = document.getElementById("bReason").value.trim();
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
    name, email, reason,
    from_name: fromCoords.name, from_lat: fromCoords.lat, from_lon: fromCoords.lon,
    to_name: toMatch.name, to_country: toMatch.country, to_iso2: toMatch.iso2,
    to_lat: toMatch.lat, to_lon: toMatch.lon
  };
  buildSeatGrid("seatGrid", onSeatPick);
  updateTicketPreview();
  goTo("page3");
});

function resetBookingForm() {
  booking = {};
  document.getElementById("bName").value = "";
  document.getElementById("bFrom").value = "";
  document.getElementById("bTo").value = "";
  document.getElementById("bReason").value = "";
  document.getElementById("bEmail").value = "";
  document.getElementById("bConsent").checked = false;
  fromCoords = null; toCoords = null;
}

/* ============================================================
   PAGE 3 — seat selection (7 seats/row: 1-7, letters A-P going down)
   gaps fall after seat 2 and after seat 5, as in the original wireframe.
   ============================================================ */
const SEAT_POSITIONS = [1, 2, "GAP", 3, 4, 5, "GAP", 6, 7];
const SEAT_LETTERS = "ABCDEFGHIJKLMNOP".split(""); // 16 rows of the plane
let selectedSeat = null;
let takenSeats = new Set();

async function buildSeatGrid(containerId, onPick) {
  const bookings = await DB.getBookings();
  takenSeats = new Set(bookings.map(b => b.seat));
  const grid = document.getElementById(containerId);
  grid.innerHTML = "";
  selectedSeat = null;
  SEAT_LETTERS.forEach(letter => {
    SEAT_POSITIONS.forEach(pos => {
      if (pos === "GAP") {
        const gap = document.createElement("div");
        gap.className = "gap";
        grid.appendChild(gap);
        return;
      }
      const seatId = `${pos}${letter}`;
      const div = document.createElement("div");
      div.className = "seat" + (takenSeats.has(seatId) ? " taken" : "");
      div.dataset.seat = seatId;
      div.dataset.tip = seatId;
      div.addEventListener("click", () => onPick(seatId, div, bookings));
      grid.appendChild(div);
    });
  });
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
  updateTicketPreview();
}

// live-update the ticket preview as any relevant field changes
["sDate", "sMeal", "sDeco", "sNote", "sStatus"].forEach(id => {
  document.getElementById(id).addEventListener("input", updateTicketPreview);
  document.getElementById(id).addEventListener("change", updateTicketPreview);
});

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function updateTicketPreview() {
  const date = document.getElementById("sDate").value;
  document.getElementById("tkName").textContent = booking.name || "—";
  document.getElementById("tkName2").textContent = booking.name || "—";
  document.getElementById("tkDepDate").textContent = todayStr();
  document.getElementById("tkArrDate").textContent = date || "—";
  document.getElementById("tkFrom").textContent = "FROM: " + (booking.from_name || "—");
  document.getElementById("tkTo").textContent = "TO: " + (booking.to_name || "—");
  document.getElementById("tkRoute").textContent = booking.from_name
    ? `FROM ${booking.from_name} \u2192 TO ${booking.to_name}` : "—";
  document.getElementById("tkSeat").textContent = "SEAT: " + (selectedSeat || "—");

  if (booking.from_lat != null && booking.to_lat != null) {
    const dist = haversine(booking.from_lat, booking.from_lon, booking.to_lat, booking.to_lon);
    document.getElementById("tkDistTime").textContent =
      `\uc57d ${Math.round(dist).toLocaleString()} km \u00b7 \uc57d ${(dist / 800).toFixed(1)}\uc2dc\uac04`;
  } else {
    document.getElementById("tkDistTime").textContent = "";
  }

  const qrData = encodeURIComponent(location.href.split("?")[0] + "?seat=" + (selectedSeat || ""));
  document.getElementById("tkQr").src = `https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${qrData}`;

  const stamp = document.getElementById("tkStamp");
  stamp.innerHTML = booking.to_iso2
    ? `<img src="https://flagcdn.com/w80/${booking.to_iso2}.png" style="width:50px;border-radius:4px;"><br>${booking.to_country}`
    : "\ubaa9\uc801\uc9c0 \uc120\ud0dd \uc2dc<br>\uc2a4\ud0ec\ud504\uac00 \ud45c\uc2dc\ub429\ub2c8\ub2e4";
}

document.getElementById("tkRouteInfoBtn").addEventListener("click", updateTicketPreview);

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
    seat: selectedSeat, dep_date: todayStr(), arr_date: date, meal, deco, note, status,
    created_at: new Date().toISOString()
  };
  const saved = await DB.addBooking(full);
  booking = saved;
  document.getElementById("sHint").style.color = "#2a7";
  document.getElementById("sHint").textContent = "\uc608\uc57d\uc774 \uc644\ub8cc\ub418\uc5c8\uc2b5\ub2c8\ub2e4!";
  updateTicketPreview();
});

/* ============================================================
   PAGE 5 — browse other seats (grey = open, blue = taken)
   ============================================================ */
async function renderBrowsePage() {
  const bookings = await DB.getBookings();
  const byId = {};
  bookings.forEach(b => byId[b.seat] = b);

  const grid = document.getElementById("seatGrid5");
  grid.innerHTML = "";
  SEAT_LETTERS.forEach(letter => {
    SEAT_POSITIONS.forEach(pos => {
      if (pos === "GAP") {
        const gap = document.createElement("div");
        gap.className = "gap";
        grid.appendChild(gap);
        return;
      }
      const seatId = `${pos}${letter}`;
      const div = document.createElement("div");
      const isTaken = !!byId[seatId];
      div.className = "seat" + (isTaken ? " taken" : "");
      div.dataset.tip = seatId;
      if (isTaken) {
        div.addEventListener("click", () => showBrowseInfo(byId[seatId]));
      }
      grid.appendChild(div);
    });
  });
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
    <p>DEP: ${b.dep_date} \u00b7 ARR: ${b.arr_date} \u00b7 SEAT: ${b.seat}</p>
  `;
}

/* ---------- init ---------- */
try {
  initMap1();
  initPage2();
} catch (e) {
  showFatalError(e.message);
}
