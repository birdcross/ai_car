// EV Log 공용 API 호출 도우미.
// - 같은 서버에서 프론트를 서빙하면 API_BASE는 '' (기본값)
// - 프론트를 Vercel 등 다른 곳에 올리면 index.html에서 window.EVLOG_API_BASE = 'https://api주소' 지정
// - 모든 요청에 브라우저별 익명 사용자 ID(X-User-Id)를 붙입니다.

export const API_BASE = String(window.EVLOG_API_BASE || '').replace(/\/$/, '');
const USER_KEY = 'evlog:user-id';
let memoryUserId = null;

function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function getUserId() {
  try {
    let id = localStorage.getItem(USER_KEY);
    if (!id) {
      id = newId();
      localStorage.setItem(USER_KEY, id);
    }
    return id;
  } catch {
    // 사생활 보호 모드 등으로 저장소를 못 쓰면 이번 방문 동안만 유지
    memoryUserId ??= newId();
    return memoryUserId;
  }
}

export class ApiError extends Error {
  constructor(message, status = 0, { network = false } = {}) {
    super(message);
    this.status = status;
    this.network = network;
  }
}

/**
 * @param {string} path  '/api/parking/latest' 처럼 /api 로 시작하는 경로
 * @param {{method?: string, body?: any, as?: 'json'|'blob', signal?: AbortSignal}} opts
 */
export async function api(path, { method = 'GET', body, as = 'json', signal } = {}) {
  const headers = { 'X-User-Id': getUserId() };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiError('네트워크에 연결할 수 없어요.', 0, { network: true });
  }
  if (!res.ok) {
    let detail = `요청을 처리하지 못했어요. (${res.status})`;
    try {
      const data = await res.json();
      if (data?.detail) detail = Array.isArray(data.detail) ? data.detail[0]?.msg || detail : data.detail;
    } catch { /* 본문 없음 */ }
    throw new ApiError(detail, res.status);
  }
  if (as === 'blob') return res.blob();
  if (res.status === 204) return null;
  return res.json();
}
