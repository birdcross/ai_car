// 오프라인 저장 대기열.
// 지하 주차장은 데이터 신호가 끊기는 경우가 많아, 저장에 실패하면 기기에 잠시 보관했다가
// 연결되면 자동으로 서버에 올립니다. (사진은 줄인 JPEG data URL로 함께 보관)

const KEY = 'evlog:parking:pending';

export function readPending() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
}

function write(items) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
    return true;
  } catch {
    return false; // 용량 초과 등
  }
}

/** @returns {boolean} 보관 성공 여부 */
export function addPending(item) {
  const items = readPending();
  items.push({ ...item, localId: `p-${Date.now()}` });
  if (write(items)) return true;
  // 사진 때문에 용량이 넘치면 사진 없이라도 보관
  items[items.length - 1].photoDataUrl = null;
  return write(items);
}

export function updatePending(localId, patch) {
  write(readPending().map((i) => (i.localId === localId ? { ...i, ...patch } : i)));
}

export function removePending(localId) {
  write(readPending().filter((i) => i.localId !== localId));
}
