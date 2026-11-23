// 주차 위치 지도 (Leaflet + OpenStreetMap, API 키 불필요)
// Leaflet은 좌표가 있는 기록을 볼 때만 불러옵니다. 불러오지 못하면 좌표·지도 앱 링크로 대체합니다.

const LEAFLET = {
  css: 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css',
  cssSri: 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=',
  js: 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js',
  jsSri: 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=',
};

let leafletPromise = null;

function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    Object.assign(css, { rel: 'stylesheet', href: LEAFLET.css, integrity: LEAFLET.cssSri, crossOrigin: '' });
    document.head.appendChild(css);
    const js = document.createElement('script');
    Object.assign(js, { src: LEAFLET.js, integrity: LEAFLET.jsSri, crossOrigin: '', async: true });
    js.onload = () => (window.L ? resolve(window.L) : reject(new Error('leaflet')));
    js.onerror = () => reject(new Error('leaflet'));
    document.head.appendChild(js);
    setTimeout(() => reject(new Error('leaflet-timeout')), 8000);
  }).catch((err) => { leafletPromise = null; throw err; });
  return leafletPromise;
}

const carIcon = (L) => L.divIcon({
  className: 'car-pin',
  html: '<span>ϟ</span>',
  iconSize: [34, 34],
  iconAnchor: [17, 17],
});
const meIcon = (L) => L.divIcon({ className: 'me-pin', html: '<span></span>', iconSize: [18, 18], iconAnchor: [9, 9] });

export class ParkingMap {
  constructor(el) {
    this.el = el;
    this.map = null;
    this.layers = [];
  }

  /** @returns {Promise<boolean>} 지도 표시 성공 여부 */
  async show(car) {
    let L;
    try {
      L = await loadLeaflet();
    } catch {
      return false;
    }
    if (!this.map) {
      this.map = L.map(this.el, { zoomControl: true, attributionControl: true, scrollWheelZoom: false });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap',
      }).addTo(this.map);
    }
    this.clear();
    const center = [car.latitude, car.longitude];
    if (car.accuracy_m) {
      this.layers.push(L.circle(center, {
        radius: car.accuracy_m, color: '#c7f485', weight: 1, fillColor: '#c7f485', fillOpacity: 0.12,
      }).addTo(this.map));
    }
    this.layers.push(L.marker(center, { icon: carIcon(L), title: '내 차', keyboard: false }).addTo(this.map));
    this.map.setView(center, car.accuracy_m && car.accuracy_m > 80 ? 16 : 18);
    requestAnimationFrame(() => this.map.invalidateSize());
    return true;
  }

  /** 현재 위치를 함께 표시하고 둘 다 보이게 맞춤 */
  showMe(me, car) {
    if (!this.map || !window.L) return;
    const L = window.L;
    this.meLayer?.remove();
    this.meLayer = L.marker([me.latitude, me.longitude], { icon: meIcon(L), title: '현재 위치' }).addTo(this.map);
    this.map.fitBounds(L.latLngBounds([[me.latitude, me.longitude], [car.latitude, car.longitude]]), { padding: [36, 36], maxZoom: 18 });
  }

  clear() {
    this.layers.forEach((l) => l.remove());
    this.layers = [];
    this.meLayer?.remove();
    this.meLayer = null;
  }

  refresh() {
    this.map?.invalidateSize();
  }
}
