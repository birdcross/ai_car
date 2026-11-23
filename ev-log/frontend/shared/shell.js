// EV Log 공용 화면 틀(사이드바·상단바·모바일 탭바).
// 페이지에서:  renderShell({ page: 'parking', title: '주차 위치' })
// 메뉴 주소는 팀 규칙 "frontend/<페이지>/index.html" 을 따릅니다.

export const NAV = [
  { key: 'dashboard', label: '대시보드', icon: '⌂', href: '/' },
  { key: 'ledger', label: '차계부', icon: '▤', href: '/ledger/' },
  { key: 'parking', label: '주차 위치', icon: '⌖', href: '/parking/' },
  { key: 'warning', label: '경고등 안내', icon: '◇', href: '/warning/' },
  { key: 'monitoring', label: '모니터링', icon: '◉', href: '/monitoring/' },
];

// TODO(팀): 차량 정보 API가 생기면 여기서 불러오도록 교체
export const VEHICLE = { name: '아이오닉 6', year: '2025년형' };

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function navLinks(page) {
  return NAV.map((n) => `
    <a href="${n.href}"${n.key === page ? ' aria-current="page"' : ''}>
      <span class="nav-icon" aria-hidden="true">${n.icon}</span><span>${esc(n.label)}</span>
    </a>`).join('');
}

export function renderShell({ page, title }) {
  const sidebar = document.getElementById('sidebar');
  const topbar = document.getElementById('topbar');
  const tabbar = document.getElementById('tabbar');

  if (sidebar) {
    sidebar.innerHTML = `
      <a class="brand" href="/"><span class="brand-mark" aria-hidden="true">ϟ</span><span class="brand-name">EV Log</span></a>
      <nav class="nav" aria-label="주요 메뉴">${navLinks(page)}</nav>
      <div class="vehicle-card">
        <p class="k">내 차량</p>
        <p class="name">${esc(VEHICLE.name)}</p>
        <p class="year">${esc(VEHICLE.year)}</p>
      </div>`;
  }
  if (topbar) {
    topbar.innerHTML = `
      <a class="mobile-brand" href="/"><span class="brand-mark" aria-hidden="true">ϟ</span>
        <span>EV Log <small>· ${esc(VEHICLE.name)}</small></span></a>
      <ol class="crumbs" aria-label="현재 위치"><li>내 차고</li><li>${esc(title)}</li></ol>
      <span class="topbar-badge" id="topbarBadge" hidden></span>`;
  }
  if (tabbar) {
    tabbar.setAttribute('aria-label', '주요 메뉴');
    tabbar.innerHTML = navLinks(page);
  }
}

/** 상단 오른쪽 배지 ('샘플 데이터' 등). null이면 숨김 */
export function setBadge(text) {
  const el = document.getElementById('topbarBadge');
  if (!el) return;
  el.textContent = text || '';
  el.hidden = !text;
}
