// 개인정보 수집 동의 (팀 공용). 서버 /api/consent 와 연동됩니다.
//
//   await loadConsents();
//   if (!hasConsent('location')) {
//     const ok = await askConsent('location', { title, items });
//   }
//
// 파일 선택창처럼 '사용자 클릭 직후'에만 열 수 있는 동작은 onAgree 로 넘기면
// 동의 버튼 클릭 안에서 바로 실행됩니다.

import { api } from './api.js';
import { escapeHtml, toast } from './ui.js';

let state = { scopes: {}, consents: {} };
let loaded = null;
const saving = new Map();

// 오프라인(지하 주차장)에서 동의하면 서버 기록이 실패하므로 기기에 보관했다가 연결되면 다시 보냅니다.
const UNSENT_KEY = 'evlog:consent:unsent';
function unsent() {
  try { return JSON.parse(localStorage.getItem(UNSENT_KEY) || '[]'); } catch { return []; }
}
function setUnsent(list) {
  try { localStorage.setItem(UNSENT_KEY, JSON.stringify([...new Set(list)])); } catch { /* 저장 불가 */ }
}
function markLocal(scopes) {
  state = { ...state, consents: { ...state.consents } };
  scopes.forEach((s) => { state.consents[s] = { current: true, unsent: true, agreed_at: new Date().toISOString() }; });
}

/** 보내지 못한 동의를 서버에 기록합니다. 다른 기록을 올리기 전에 호출하세요. */
export async function flushUnsentConsents() {
  const scopes = unsent();
  if (!scopes.length) return true;
  try {
    state = await api('/api/consent/', { method: 'POST', body: { scopes } });
    setUnsent([]);
    return true;
  } catch {
    return false;
  }
}

export function loadConsents(force = false) {
  if (!loaded || force) {
    loaded = flushUnsentConsents()
      .then(() => api('/api/consent/'))
      .then((data) => { state = data; return state; })
      .catch(() => { markLocal(unsent()); return state; }) // 오프라인: 기기에 보관된 동의만 반영
      .then(() => { if (unsent().length) markLocal(unsent()); return state; });
  }
  return loaded;
}

export function hasConsent(scope) {
  return state.consents?.[scope]?.current === true;
}

/** 동의 기록이 서버에 반영될 때까지 기다립니다. */
export async function waitForConsent(scope) {
  if (saving.has(scope)) await saving.get(scope);
  return hasConsent(scope);
}

export function askConsent(scope, { title, items = [], note = '', agreeText = '동의하고 계속' }, { onAgree } = {}) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'sheet';
    dlg.setAttribute('aria-labelledby', 'consentTitle');
    dlg.innerHTML = `
      <div class="sheet-body">
        <h2 id="consentTitle">${escapeHtml(title)}</h2>
        <ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>
        ${note ? `<p>${escapeHtml(note)}</p>` : ''}
      </div>
      <div class="sheet-actions">
        <button type="button" class="btn btn-quiet" data-act="no">동의하지 않음</button>
        <button type="button" class="btn btn-primary" data-act="yes">${escapeHtml(agreeText)}</button>
      </div>`;
    document.body.appendChild(dlg);

    let agreed = false;
    dlg.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      if (act === 'yes') {
        agreed = true;
        onAgree?.(); // 클릭 이벤트 안에서 동기 실행 (카메라 열기 등)
        const req = api('/api/consent/', { method: 'POST', body: { scopes: [scope] } })
          .then((data) => { state = data; })
          .catch((err) => {
            if (err.network) {
              setUnsent([...unsent(), scope]);
              markLocal([scope]);
            } else {
              toast(`동의 기록을 저장하지 못했어요: ${err.message}`, 'error');
            }
          })
          .finally(() => saving.delete(scope));
        saving.set(scope, req);
      }
      dlg.close();
    });
    dlg.addEventListener('close', async () => {
      dlg.remove();
      if (agreed) await saving.get(scope);
      resolve(agreed && hasConsent(scope));
    });
    dlg.showModal();
  });
}

export async function withdrawConsent(scope) {
  state = await api(`/api/consent/${encodeURIComponent(scope)}`, { method: 'DELETE' });
  return state;
}
