/* ============================================================
   CONFIG — paste your Supabase project details here once you've
   created a free project at https://supabase.com (see README.md).
   Until you fill these in, the site still works, but seats are
   only saved on YOUR browser (localStorage), not shared with others.
   ============================================================ */
const SUPABASE_URL = "";       // e.g. "https://xxxxxxxx.supabase.co"
const SUPABASE_ANON_KEY = "";  // e.g. "eyJhbGciOi..."

let supabase = null;
if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

/* ---------- simple shared-storage layer ---------- */
const DB = {
  async getBookings() {
    if (supabase) {
      const { data, error } = await supabase.from("bookings").select("*");
      if (error) { console.error(error); return []; }
      return data;
    }
    return JSON.parse(localStorage.getItem("bookings") || "[]");
  },
  async addBooking(booking) {
    if (supabase) {
      const { data, error } = await supabase.from("bookings").insert(booking).select();
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
   PAGE 1 — live flight map
   ============================================================ */
let map1, flightMarkers = [];
function initMap1() {
  map1 = L.map("map1").setView([36.5, 127.8], 6); // default: Korea
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map1);
  loadFlights();
  map1.on("moveend", loadFlights);
}

async function loadFlights() {
  const b = map1.getBounds();
  const url = `https://opensky-network.org/api/states/all?lamin=${b.getSouth()}&lomin=${b.getWest()}&lamax=${b.getNorth()}&lomax=${b.getEast()}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("opensky request failed");
    const data = await res.json();
    flightMarkers.forEach(m => map1.removeLayer(m));
    flightMarkers = [];
    (data.states || []).slice(0, 200).forEach(s => {
      const [icao24, callsign, country, , , lon, lat, , on_ground, velocity, track] = s;
      if (lat == null || lon == null) return;
      const icon = L.divIcon({
        className: "plane-icon",
        html: `<div style="transform:rotate(${track||0}deg); font-size:16px;">✈️</div>`,
        iconSize: [20, 20]
      });
      const marker = L.marker([lat, lon], { icon }).addTo(map1);
      marker.on("click", () => {
        document.getElementById("flightInfo").innerHTML =
          `<b>Callsign:</b> ${(callsign||"—").trim()}<br>` +
          `<b>Country:</b> ${country}<br>` +
          `<b>Speed:</b> ${velocity ? Math.round(velocity*3.6)+" km/h" : "—"}<br>` +
          `<b>Status:</b> ${on_ground ? "On ground" : "In flight"}`;
      });
      flightMarkers.push(marker);
    });
  } catch (e) {
    document.getElementById("flightInfo").innerHTML =
      "실시간 항공편 정보를 불러올 수 없습니다. (OpenSky API 요청 제한)";
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
    const hours = dist / 800; // rough average cruise speed incl. buffer
    document.getElementById("routeInfo").innerHTML =
      `<b>거리:</b> 약 ${Math.round(dist).toLocaleString()} km<br><b>예상 비행시간:</b> 약 ${hours.toFixed(1)}시간`;
  } else if (points.length === 1) {
    map2.setView(points[0], 9);
  }
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
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
    document.getElementById("bHint").textContent = "모든 정보를 입력해주세요.";
    return;
  }
  document.getElementById("bHint").textContent = "";
  toCoords = { ...toMatch };
  booking = { name, email, from_name: fromCoords.name, from_lat: fromCoords.lat, from_lon: fromCoords.lon,
              to_name: toMatch.name, to_country: toMatch.country, to_iso2: toMatch.iso2,
              to_lat: toMatch.lat, to_lon: toMatch.lon };
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
    document.getElementById("sHint").textContent = "이미 선택된 좌석입니다.";
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
    document.getElementById("sHint").textContent = "좌석과 필수 정보를 모두 입력해주세요.";
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
              : b.to_country || "";

  document.getElementById("tkRouteInfoBtn").onclick = () => {
    const dist = haversine(b.from_lat, b.from_lon, b.to_lat, b.to_lon);
    alert(`거리: 약 ${Math.round(dist)} km\n예상 비행시간: 약 ${(dist/800).toFixed(1)}시간`);
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
    <p><b>상태 메세지:</b> ${b.status || "—"}</p>
    <p><b>기내식:</b> ${b.meal || "—"}</p>
    <p><b>데코:</b> ${b.deco || "—"}</p>
  `;
  document.getElementById("ticket5").innerHTML = `
    <p><b>${b.name}</b></p>
    <p>FROM ${b.from_name} \u2192 TO ${b.to_name}</p>
    <p>DATE: ${b.dep_date} · SEAT: ${b.seat}</p>
  `;
}

/* ---------- init ---------- */
initMap1();
initPage2();
