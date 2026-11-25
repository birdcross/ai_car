const koreaDate = new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Seoul'});
const koreaTime = new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul', hour:'2-digit', minute:'2-digit'});
let tripRows = [];
let tripLoadVersion = 0;
let showTripExamples = false;
const exampleTrips = [
  {
    id: 'example-city-hall', name: '서울시청 · 광화문',
    started_at: '2026-11-23T09:10:00+09:00', ended_at: '2026-11-23T09:18:00+09:00',
    points: [[37.5665,126.9780],[37.5683,126.9779],[37.5711,126.9769],[37.5750,126.9769]],
  },
  {
    id: 'example-yeouido', name: '여의도 · 한강공원',
    started_at: '2026-11-22T15:20:00+09:00', ended_at: '2026-11-22T15:30:00+09:00',
    points: [[37.5218,126.9245],[37.5240,126.9257],[37.5266,126.9274],[37.5284,126.9301]],
  },
];
function visibleTrips() {
  return showTripExamples ? exampleTrips : tripRows;
}
let selectedTrip = null;
let tripMap = null;
let tripLayer = null;
let leafletReady = null;

function distanceKm(points) {
  const rad = Math.PI / 180;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const [lat1,lng1] = points[i - 1];
    const [lat2,lng2] = points[i];
    const a = Math.sin((lat2 - lat1) * rad / 2) ** 2 +
      Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin((lng2 - lng1) * rad / 2) ** 2;
    total += 12742 * Math.asin(Math.sqrt(Math.min(1, a)));
  }
  return total;
}
function leaflet() {
  if (!leafletReady) {
    leafletReady = new Promise((resolve,reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css';
      css.integrity = 'sha384-sHL9NAb7lN7rfvG5lfHpm643Xkcjzp4jFvuavGOndn6pjVqS6ny56CAt3nsEVT4H';
      css.crossOrigin = 'anonymous';
      document.head.append(css);
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js';
      script.integrity = 'sha384-cxOPjt7s7Iz04uaHJceBmS+qpjv2JkIHNVcuOrM+YHwZOmJGBXI00mdUXEq65HTH';
      script.crossOrigin = 'anonymous';
      script.onload = () => resolve(window.L);
      script.onerror = () => { script.remove(); css.remove(); leafletReady = null; reject(); };
      document.head.append(script);
    });
  }
  return leafletReady;
}
async function showTrip(trip) {
  selectedTrip = trip.id;
  const epoch = recordEpoch;
  $('tripTitle').textContent = trip.name || '주행 경로';
  const minutes = Math.max(1, Math.round((Date.parse(trip.ended_at) - Date.parse(trip.started_at)) / 60000));
  $('tripSummary').textContent = koreaTime.format(new Date(trip.started_at)) + ' 출발 · 약 ' +
    distanceKm(trip.points).toFixed(1) + ' km · ' + minutes + '분';
  $('tripMap').hidden = false;
  $('tripMapStatus').textContent = '지도를 불러오고 있어요.';
  renderTripList();
  try {
    const L = await leaflet();
    if (epoch !== recordEpoch || selectedTrip !== trip.id || $('parking').hidden) return;
    if (!tripMap) {
      tripMap = L.map('tripMap', {scrollWheelZoom:false});
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom:19, attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(tripMap);
    }
    if (tripLayer) tripLayer.remove();
    const start = trip.points[0];
    const finish = trip.points.at(-1);
    const line = L.polyline(trip.points, {color:'#1867db', weight:5});
    tripLayer = L.layerGroup([
      line,
      L.circleMarker(start,{radius:7,color:'#166b46',fillColor:'#c7f485',fillOpacity:1}).bindTooltip('출발'),
      L.circleMarker(finish,{radius:7,color:'#204289',fillColor:'#bde2ff',fillOpacity:1}).bindTooltip('도착'),
    ]).addTo(tripMap);
    tripMap.invalidateSize();
    tripMap.fitBounds(line.getBounds(), {padding:[24,24], maxZoom:16});
    $('tripMapStatus').textContent = '';
  } catch {
    if (epoch === recordEpoch && selectedTrip === trip.id) $('tripMapStatus').textContent = '지도를 불러오지 못했어요. 경로를 다시 선택해주세요.';
  }
}
function renderTripList() {
  const list = $('tripList');
  list.replaceChildren();
  let day;
  $('tripExampleNotice').hidden = !showTripExamples;
  for (const trip of visibleTrips()) {
    const date = koreaDate.format(new Date(trip.started_at));
    if (date !== day) {
      day = date;
      const label = document.createElement('h3');
      label.textContent = day;
      list.append(label);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'trip-choice';
    button.textContent = koreaTime.format(new Date(trip.started_at)) + ' · ' +
      (trip.name || '주행 기록') + ' · ' + distanceKm(trip.points).toFixed(1) + ' km';
    button.setAttribute('aria-pressed', selectedTrip === trip.id);
    button.onclick = () => void showTrip(trip);
    list.append(button);
  }
}
async function loadTrips() {
  if (!recordOwner || !parkingClient) return;
  const epoch = recordEpoch;
  const version = ++tripLoadVersion;
  $('tripStatus').textContent = '주행 기록을 불러오고 있어요.';
  const {data,error} = await parkingClient.from('driving_trips')
    .select('id,started_at,ended_at,points').eq('user_id',recordOwner)
    .order('started_at',{ascending:false}).limit(100);
  if (epoch !== recordEpoch || version !== tripLoadVersion) return;
  if (error) {
    $('tripStatus').textContent = '저장된 주행 기록을 불러오지 못했어요.';
    return;
  }
  tripRows = data.filter(row => Array.isArray(row.points) && row.points.length > 1 &&
    row.points.every(point => Array.isArray(point) && point.length === 2 &&
      Number.isFinite(point[0]) && Math.abs(point[0]) <= 90 &&
      Number.isFinite(point[1]) && Math.abs(point[1]) <= 180));
  $('tripStatus').textContent = '';
  showTripExamples = !tripRows.length;
  if (visibleTrips().some(trip => trip.id === selectedTrip)) renderTripList();
  else if (showTripExamples && !$('parking').hidden) void showTrip(visibleTrips()[0]);
  else {
    clearTripSelection();
    renderTripList();
  }
}
function clearTripSelection() {
  selectedTrip = null;
  tripMap?.remove();
  tripMap = tripLayer = null;
  $('tripMap').hidden = true;
  $('tripTitle').textContent = '주행 경로';
  $('tripSummary').textContent = '목록에서 기록을 선택하세요.';
  $('tripMapStatus').textContent = '';
}
function resetDrivingTrips() {
  tripRows = [];
  showTripExamples = false;
  $('tripStatus').textContent = '';
  clearTripSelection();
  renderTripList();
}
renderTripList();
