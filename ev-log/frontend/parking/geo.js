// GPS 관련 순수 함수 (브라우저 Geolocation API + 거리·방향 계산)

export const ACCURACY = { GOOD: 20, FAIR: 50 }; // m. 50m 초과면 '애매함' → 사진 권장 (서버와 같은 기준)

export function accuracyLevel(meters) {
  if (meters == null) return 'none';
  if (meters <= ACCURACY.GOOD) return 'good';
  if (meters <= ACCURACY.FAIR) return 'fair';
  return 'weak';
}

export const LEVEL_TEXT = { good: '정확함', fair: '보통', weak: '부정확' };

export class GeoError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code; // 'unsupported' | 'insecure' | 'denied' | 'unavailable' | 'timeout'
  }
}

/** 현재 위치 1회 측정. 정확도가 낮으면 잠시 더 기다려 가장 좋은 값을 씁니다. */
export function getPosition({ timeout = 15000, settleMs = 6000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new GeoError('unsupported', '이 브라우저는 위치 기능을 지원하지 않아요.'));
      return;
    }
    if (!window.isSecureContext) {
      reject(new GeoError('insecure', '위치 기능은 https 주소에서만 쓸 수 있어요.'));
      return;
    }
    let best = null;
    let done = false;
    let watchId = null;
    let settleTimer = null;
    let hardTimer = null;
    const finish = (fn) => {
      if (done) return;
      done = true;
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      clearTimeout(hardTimer);
      clearTimeout(settleTimer);
      fn();
    };
    const toResult = (p) => ({
      latitude: p.coords.latitude,
      longitude: p.coords.longitude,
      accuracy: Math.round(p.coords.accuracy),
      timestamp: p.timestamp,
    });

    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (!best || pos.coords.accuracy < best.coords.accuracy) best = pos;
        if (pos.coords.accuracy <= ACCURACY.GOOD) { finish(() => resolve(toResult(pos))); return; }
        // 첫 값이 들어온 뒤 settleMs 동안 더 정확한 값을 기다렸다가 최선값 사용
        settleTimer ??= setTimeout(() => finish(() => resolve(toResult(best))), settleMs);
      },
      (err) => {
        if (best) { finish(() => resolve(toResult(best))); return; }
        const map = {
          1: new GeoError('denied', '위치 권한이 꺼져 있어요. 브라우저 설정에서 위치 권한을 허용해주세요.'),
          2: new GeoError('unavailable', '현재 위치를 찾을 수 없어요. 지하라면 GPS 신호가 약할 수 있어요.'),
          3: new GeoError('timeout', '위치 확인 시간이 초과됐어요. 지하라면 GPS 신호가 약할 수 있어요.'),
        };
        finish(() => reject(map[err.code] || map[2]));
      },
      { enableHighAccuracy: true, timeout, maximumAge: 0 },
    );
    hardTimer = setTimeout(() => finish(() => (best
      ? resolve(toResult(best))
      : reject(new GeoError('timeout', '위치 확인 시간이 초과됐어요. 지하라면 GPS 신호가 약할 수 있어요.')))), timeout + 500);
  });
}

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;

/** 두 좌표 사이 직선 거리(m) */
export function distanceMeters(a, b) {
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** a에서 b를 바라보는 방위각(0=북, 시계방향) */
export function bearingDegrees(a, b) {
  const y = Math.sin(rad(b.longitude - a.longitude)) * Math.cos(rad(b.latitude));
  const x = Math.cos(rad(a.latitude)) * Math.sin(rad(b.latitude))
    - Math.sin(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.cos(rad(b.longitude - a.longitude));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const DIRS = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];
export function directionName(deg) {
  return DIRS[Math.round(deg / 45) % 8];
}

export function formatDistance(m) {
  if (m < 1000) return `${Math.round(m / 5) * 5 || Math.round(m)}m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)}km`;
}

export function kakaoMapUrl(label, lat, lng) {
  const name = `내 차 · ${label}`.replace(/,/g, ' ');
  return `https://map.kakao.com/link/map/${encodeURIComponent(name)},${lat},${lng}`;
}

export function googleMapUrl(lat, lng) {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}
