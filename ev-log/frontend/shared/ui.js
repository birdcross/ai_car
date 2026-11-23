// EV Log 공용 UI 도우미: 토스트, 확인창, 날짜 표기

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

let toastWrap;
export function toast(message, type = 'info', ms = 3200) {
  if (!toastWrap) {
    toastWrap = document.createElement('div');
    toastWrap.className = 'toast-wrap';
    toastWrap.setAttribute('role', 'status');
    toastWrap.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastWrap);
  }
  const el = document.createElement('div');
  el.className = 'toast';
  el.dataset.type = type;
  el.textContent = message;
  toastWrap.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

/** 브라우저 기본 confirm 대신 테마에 맞춘 확인창. Promise<boolean> */
export function confirmDialog({ title, message, confirmText = '확인', cancelText = '취소', danger = false }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'sheet';
    dlg.innerHTML = `
      <form method="dialog">
        <div class="sheet-body"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p></div>
        <div class="sheet-actions">
          <button class="btn btn-quiet" value="cancel">${escapeHtml(cancelText)}</button>
          <button class="btn ${danger ? 'btn-outline' : 'btn-primary'}" value="ok">${escapeHtml(confirmText)}</button>
        </div>
      </form>`;
    document.body.appendChild(dlg);
    dlg.addEventListener('close', () => {
      resolve(dlg.returnValue === 'ok');
      dlg.remove();
    });
    dlg.showModal();
  });
}

const pad = (n) => String(n).padStart(2, '0');

function to12h(d) {
  const h = d.getHours();
  return `${h < 12 ? '오전' : '오후'} ${h % 12 === 0 ? 12 : h % 12}:${pad(d.getMinutes())}`;
}

/** 2026.11.23 오후 7:20 (슬라이드 표기) */
export function formatDateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${to12h(d)}`;
}

/** 11월 23일 오후 7:20 (목록용 짧은 표기) */
export function formatShort(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${to12h(d)}`;
}

/** 방금 전 / 3시간 전 / 2일 전 */
export function timeAgo(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!Number.isFinite(diff)) return '';
  if (diff < 60) return '방금 전';
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  return `${Math.floor(diff / 86400)}일 전`;
}
