// ---- Editable data lists ----
// Add/remove entries here to change the dropdown options shown on page 2.

const KOREAN_CITIES = [
  { name: "서울 강남구", lat: 37.5172, lon: 127.0473 },
  { name: "서울 마포구", lat: 37.5663, lon: 126.9016 },
  { name: "서울 종로구", lat: 37.5735, lon: 126.9788 },
  { name: "서울 성북구", lat: 37.5894, lon: 127.0167 },
  { name: "인천", lat: 37.4563, lon: 126.7052 },
  { name: "부산", lat: 35.1796, lon: 129.0756 },
  { name: "대구", lat: 35.8714, lon: 128.6014 },
  { name: "대전", lat: 36.3504, lon: 127.3845 },
  { name: "광주", lat: 35.1595, lon: 126.8526 },
  { name: "제주", lat: 33.4996, lon: 126.5312 },
];

// name shown in the list, IATA code, country, ISO2 (for flag), coords,
// and korean: alternate names/aliases so typing Korean also finds a match
const AIRPORTS = [
  { name: "Seoul (ICN)", iata: "ICN", country: "South Korea", iso2: "kr", lat: 37.4602, lon: 126.4407, korean: ["서울", "인천"] },
  { name: "Tokyo/Narita (NRT)", iata: "NRT", country: "Japan", iso2: "jp", lat: 35.7720, lon: 140.3929, korean: ["도쿄", "동경", "나리타"] },
  { name: "Osaka (KIX)", iata: "KIX", country: "Japan", iso2: "jp", lat: 34.4347, lon: 135.2441, korean: ["오사카"] },
  { name: "Taipei (TPE)", iata: "TPE", country: "Taiwan", iso2: "tw", lat: 25.0777, lon: 121.2328, korean: ["타이베이", "대만"] },
  { name: "Hong Kong (HKG)", iata: "HKG", country: "Hong Kong", iso2: "hk", lat: 22.3080, lon: 113.9185, korean: ["홍콩"] },
  { name: "Bangkok (BKK)", iata: "BKK", country: "Thailand", iso2: "th", lat: 13.6900, lon: 100.7501, korean: ["방콕", "태국"] },
  { name: "Singapore (SIN)", iata: "SIN", country: "Singapore", iso2: "sg", lat: 1.3644, lon: 103.9915, korean: ["싱가포르"] },
  { name: "Shanghai (PVG)", iata: "PVG", country: "China", iso2: "cn", lat: 31.1443, lon: 121.8083, korean: ["상하이", "상해"] },
  { name: "London (LHR)", iata: "LHR", country: "United Kingdom", iso2: "gb", lat: 51.4700, lon: -0.4543, korean: ["런던", "영국"] },
  { name: "Paris (CDG)", iata: "CDG", country: "France", iso2: "fr", lat: 49.0097, lon: 2.5479, korean: ["파리", "프랑스"] },
  { name: "New York (JFK)", iata: "JFK", country: "United States", iso2: "us", lat: 40.6413, lon: -73.7781, korean: ["뉴욕"] },
  { name: "Los Angeles (LAX)", iata: "LAX", country: "United States", iso2: "us", lat: 33.9416, lon: -118.4085, korean: ["로스앤젤레스", "엘에이"] },
  { name: "Sydney (SYD)", iata: "SYD", country: "Australia", iso2: "au", lat: -33.9399, lon: 151.1753, korean: ["시드니", "호주"] },
  { name: "Rome (FCO)", iata: "FCO", country: "Italy", iso2: "it", lat: 41.8003, lon: 12.2389, korean: ["로마", "이탈리아"] },
  { name: "Barcelona (BCN)", iata: "BCN", country: "Spain", iso2: "es", lat: 41.2974, lon: 2.0833, korean: ["바르셀로나", "스페인"] },
  { name: "Istanbul (IST)", iata: "IST", country: "Turkey", iso2: "tr", lat: 41.2753, lon: 28.7519, korean: ["이스탄불", "터키"] },
  { name: "Dubai (DXB)", iata: "DXB", country: "UAE", iso2: "ae", lat: 25.2532, lon: 55.3657, korean: ["두바이"] },
  { name: "Reykjavik (KEF)", iata: "KEF", country: "Iceland", iso2: "is", lat: 63.9850, lon: -22.6056, korean: ["레이캬비크", "아이슬란드"] },
];
