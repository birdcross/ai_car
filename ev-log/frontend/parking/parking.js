// 내 차 주차 위치 페이지
// 흐름: GPS로 위치 저장 → GPS가 애매하면(오차 50m 초과·실패) 사진을 권함 → AI가 사진 속 층·구역을 읽음
//      → 사용자가 확인·수정 + 메모 → 저장. 돌아갈 때는 지도·사진·메모·거리로 차를 찾습니다.

import { renderShell, setBadge } from '/shared/shell.js';
import { api } from '/shared/api.js';
import { toast, confirmDialog, formatDateTime, formatShort, timeAgo, escapeHtml } from '/shared/ui.js';
import {
  loadConsents, hasConsent, askConsent, waitForConsent, withdrawConsent, flushUnsentConsents,
} from '/shared/consent.js';
import {
  getPosition, accuracyLevel, LEVEL_TEXT, distanceMeters, bearingDegrees, directionName,
  formatDistance, kakaoMapUrl, googleMapUrl,
} from './geo.js';
import { compressImage } from './photo.js';
import { ParkingMap } from './map.js';
import { readPending, addPending, updatePending, removePending } from './pending.js';

const $ = (id) => document.getElementById(id);
const esc = escapeHtml;

const CONSENT_TEXT = {
  location: {
    title: '위치 정보 저장에 동의해주세요',
    items: [
      '수집 항목: 주차할 때의 GPS 좌표(위도·경도)와 오차 범위',
      '이용 목적: 지도에 내 차 위치 표시, 돌아갈 때 거리 안내',
      '보관 기간: 기록을 삭제할 때까지 (언제든 삭제 가능)',
    ],
    note: '동의하지 않아도 층·구역을 직접 적거나 사진으로 저장할 수 있어요.',
  },
  photo_ai: {
    title: '주차 사진 저장·AI 인식에 동의해주세요',
    items: [
      '수집 항목: 직접 찍거나 고른 주차 사진 (촬영 위치 등 메타데이터는 지우고 저장)',
      '이용 목적: 사진 속 층·구역 표지판을 AI로 읽고, 돌아갈 때 사진으로 확인',
      '사진은 인식을 위해 외부 AI 서비스(Gemini·OpenAI·Claude 중 서버에 설정된 것)로 전송돼요',
      '다른 차 번호판이나 사람이 나오지 않게 기둥·표지판 위주로 찍어주세요',
      '보관 기간: 기록을 삭제하면 사진도 함께 삭제돼요',
    ],
    note: '동의하지 않아도 층·구역을 직접 적어서 저장할 수 있어요.',
    agreeText: '동의하고 계속',
  },
};

const SAMPLE = { label: '지하 2층 A-17', meta: '2026.11.23 오후 7:20 · 샘플 기록' };
const WEAK_GPS_HELP = '지하라서 GPS가 정확하지 않아요. 기둥 번호나 층 표지판을 찍으면 AI가 층·구역을 읽어줘요.';
const CONFIDENCE = {
  high: ['신뢰도 높음', 'chip-teal'],
  medium: ['신뢰도 보통', 'chip-teal'],
  low: ['신뢰도 낮음 · 확인 필요', 'chip-warn'],
};

const state = {
  records: [],
  viewingId: null,       // 지난 기록을 눌러 보는 중이면 그 ID
  heroRecord: null,      // 지금 초록 카드에 표시된 기록
  aiStatus: { enabled: false },
  // 작성 중인 새 기록
  gps: null,
  photo: null,           // 서버에 올라간 사진 {id, url}
  photoDataUrl: null,    // 줄인 사진 (오프라인 재전송용)
  photoTask: null,       // 업로드 진행 중 Promise
  analysis: null,
  autoLabel: null,       // AI가 입력칸에 자동으로 넣은 값
  syncing: false,
};

const parkingMap = new ParkingMap($('map'));
let photoToken = 0;
let heroToken = 0;
let heroPhotoUrl = null;

// ======================================================================= 공통 도우미
function busy(btn, on, text) {
  if (on) {
    btn.dataset.prev = btn.textContent;
    btn.textContent = text;
    btn.disabled = true;
    btn.classList.add('is-busy');
  } else {
    btn.textContent = btn.dataset.prev ?? btn.textContent;
    btn.disabled = false;
    btn.classList.remove('is-busy');
  }
}

function setTile(tile, valueEl, helpEl, stateName, value, help = '') {
  tile.dataset.state = stateName;
  valueEl.textContent = value;
  helpEl.textContent = help;
  helpEl.hidden = !help;
}
const setGps = (s, v, h) => setTile($('gpsTile'), $('gpsValue'), $('gpsHelp'), s, v, h);
const setPhoto = (s, v, h) => setTile($('photoTile'), $('photoValue'), $('photoHelp'), s, v, h);

function photoIdleText() {
  if (state.aiStatus.enabled) return ['기둥 번호나 층 표지판을 찍어두세요', 'AI가 사진 속 표지판에서 층·구역을 읽어줘요.'];
  return ['기둥 번호나 층 표지판을 찍어두세요', '사진은 돌아갈 때 확인용으로 함께 저장돼요.'];
}

// ======================================================================= ① 최근 주차 기록
function pendingAsRecord(p) {
  const pl = p.payload;
  return {
    id: p.localId,
    pending: true,
    label: pl.label || '임시 저장한 위치',
    memo: pl.memo || '',
    location: pl.latitude != null
      ? { latitude: pl.latitude, longitude: pl.longitude, accuracy_m: pl.accuracy_m, is_weak: accuracyLevel(pl.accuracy_m) === 'weak' }
      : null,
    photo: p.photoDataUrl ? { dataUrl: p.photoDataUrl } : null,
    ai: null,
    created_at: p.parkedAt,
  };
}

function pickHeroRecord() {
  if (state.viewingId) {
    const viewing = state.records.find((r) => r.id === state.viewingId);
    if (viewing) return viewing;
    state.viewingId = null;
  }
  const latest = state.records[0] || null;
  const pending = readPending();
  const lastPending = pending.length ? pendingAsRecord(pending[pending.length - 1]) : null;
  if (lastPending && (!latest || new Date(lastPending.created_at) > new Date(latest.created_at))) return lastPending;
  return latest;
}

function renderHero() {
  const rec = pickHeroRecord();
  state.heroRecord = rec;
  const token = ++heroToken;
  $('distanceResult').hidden = true;
  $('memoEditForm').hidden = true;

  if (!rec) {
    $('heroEyebrow').textContent = '최근 주차 기록';
    $('heroLabel').textContent = SAMPLE.label;
    $('heroMeta').textContent = SAMPLE.meta;
    $('heroAiChip').hidden = true;
    $('heroMemo').hidden = true;
    $('heroActions').hidden = true;
    $('heroMedia').hidden = true;
    $('hero').classList.remove('has-media');
    setBadge('샘플 데이터');
    return;
  }
  setBadge(null);

  $('heroEyebrow').textContent = state.viewingId ? '선택한 주차 기록' : rec.pending ? '방금 저장한 위치' : '최근 주차 기록';
  $('heroLabel').textContent = rec.label;

  const meta = [formatDateTime(rec.created_at)];
  if (rec.pending) meta.push('기기에 임시 저장 · 연결되면 자동 전송');
  else meta.push(timeAgo(rec.created_at));
  if (rec.location) {
    const level = accuracyLevel(rec.location.accuracy_m);
    meta.push(rec.location.accuracy_m != null ? `GPS ${LEVEL_TEXT[level]} ±${Math.round(rec.location.accuracy_m)}m` : 'GPS');
  }
  $('heroMeta').textContent = meta.join(' · ');
  $('heroAiChip').hidden = !rec.ai?.accepted;

  $('heroMemo').textContent = rec.memo;
  $('heroMemo').hidden = !rec.memo;

  $('heroActions').hidden = false;
  $('btnDistance').hidden = !rec.location;
  $('linkMapApp').hidden = !rec.location;
  if (rec.location) $('linkMapApp').href = kakaoMapUrl(rec.label, rec.location.latitude, rec.location.longitude);
  $('btnEditMemo').hidden = !!rec.pending;
  $('btnEditMemo').textContent = rec.memo ? '메모 수정' : '메모 추가';
  $('btnBackToLatest').hidden = !state.viewingId;

  renderHeroMedia(rec, token);
}

function selectMediaTab(which) {
  const isMap = which === 'map';
  $('tabMap').setAttribute('aria-selected', String(isMap));
  $('tabPhoto').setAttribute('aria-selected', String(!isMap));
  $('mapPanel').hidden = !isMap;
  $('photoPanel').hidden = isMap;
  if (isMap) parkingMap.refresh();
}

async function renderHeroMedia(rec, token) {
  const hasMap = !!rec.location;
  const hasPhoto = !!rec.photo;
  $('heroMedia').hidden = !(hasMap || hasPhoto);
  $('hero').classList.toggle('has-media', hasMap || hasPhoto);
  $('mediaTabs').hidden = !(hasMap && hasPhoto);
  if (!hasMap && !hasPhoto) return;

  // GPS가 부정확하면 사진이 더 쓸모 있으므로 사진 먼저
  selectMediaTab(hasPhoto && (!hasMap || rec.location.is_weak) ? 'photo' : 'map');

  if (hasMap) {
    const { latitude, longitude } = rec.location;
    $('mapCoords').textContent = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
    $('mapGoogle').href = googleMapUrl(latitude, longitude);
    const ok = await parkingMap.show(rec.location);
    if (token !== heroToken) return;
    $('map').hidden = !ok;
    $('mapFallback').hidden = ok;
  }

  if (hasPhoto) {
    const img = $('heroPhoto');
    if (heroPhotoUrl) { URL.revokeObjectURL(heroPhotoUrl); heroPhotoUrl = null; }
    if (rec.photo.dataUrl) {
      img.src = rec.photo.dataUrl;
    } else {
      img.removeAttribute('src');
      try {
        const blob = await api(rec.photo.url, { as: 'blob' });
        if (token !== heroToken) return;
        heroPhotoUrl = URL.createObjectURL(blob);
        img.src = heroPhotoUrl;
      } catch {
        if (token === heroToken) img.alt = '사진을 불러오지 못했어요';
      }
    }
  }
}

async function showDistance() {
  const rec = state.heroRecord;
  if (!rec?.location) return;
  const out = $('distanceResult');
  busy($('btnDistance'), true, '현재 위치 확인 중…');
  try {
    const me = await getPosition({ timeout: 12000, settleMs: 4000 });
    const car = rec.location;
    const d = distanceMeters(me, car);
    const slack = Math.max(25, (me.accuracy || 0) + (car.accuracy_m || 0));
    let main;
    let sub;
    if (d <= slack) {
      main = `차 근처에 있어요 (약 ${formatDistance(d)})`;
      sub = `‘${rec.label}’ 표지판을 찾아보세요.`;
    } else {
      main = `차까지 직선 약 ${formatDistance(d)} · ${directionName(bearingDegrees(me, car))}쪽`;
      sub = `현재 위치 오차 ±${me.accuracy}m`;
    }
    if (car.is_weak) sub += ' · 저장된 GPS가 부정확해서 층·구역 표기를 함께 확인하세요.';
    out.innerHTML = `${esc(main)}<small>${esc(sub)}</small>`;
    out.hidden = false;
    if (!$('map').hidden) {
      selectMediaTab('map');
      parkingMap.showMe(me, car);
    }
  } catch (err) {
    out.innerHTML = `${esc(err.message)}<small>층·구역 표기와 사진으로 찾아보세요.</small>`;
    out.hidden = false;
  } finally {
    busy($('btnDistance'), false);
  }
}

function startMemoEdit() {
  const rec = state.heroRecord;
  if (!rec || rec.pending) return;
  $('memoEditInput').value = rec.memo || '';
  $('memoEditForm').hidden = false;
  $('heroMemo').hidden = true;
  $('heroActions').hidden = true;
  $('memoEditInput').focus();
}

function cancelMemoEdit() {
  $('memoEditForm').hidden = true;
  $('heroActions').hidden = false;
  $('heroMemo').hidden = !state.heroRecord?.memo;
}

async function saveMemoEdit(e) {
  e.preventDefault();
  const rec = state.heroRecord;
  const btn = e.submitter || $('memoEditForm').querySelector('[type=submit]');
  busy(btn, true, '저장 중…');
  try {
    const { record } = await api(`/api/parking/records/${rec.id}`, { method: 'PATCH', body: { memo: $('memoEditInput').value } });
    state.records = state.records.map((r) => (r.id === record.id ? record : r));
    renderHero();
    renderHistory();
    toast('메모를 저장했어요.', 'success');
  } catch (err) {
    toast(err.network ? '연결이 끊겨 메모를 저장하지 못했어요.' : err.message, 'error');
  } finally {
    busy(btn, false);
  }
}

// ======================================================================= ② 새 위치 저장
async function captureGps() {
  if (!hasConsent('location')) {
    const ok = await askConsent('location', CONSENT_TEXT.location);
    if (!ok) {
      setGps('idle', '위치 저장에 동의하지 않았어요', '층·구역을 직접 적거나 사진으로 저장할 수 있어요.');
      return;
    }
  }
  const btn = $('btnGps');
  busy(btn, true, '위치 확인 중…');
  setGps('loading', '위치 확인 중…', '지하에서는 실외보다 오래 걸릴 수 있어요.');
  try {
    const pos = await getPosition();
    state.gps = pos;
    const level = accuracyLevel(pos.accuracy);
    setGps(level, `${LEVEL_TEXT[level]} · 오차 ±${pos.accuracy}m`,
      level === 'weak' ? WEAK_GPS_HELP : `${pos.latitude.toFixed(5)}, ${pos.longitude.toFixed(5)}`);
    if (level === 'weak') suggestPhoto();
    busy(btn, false);
    btn.textContent = '위치 다시 가져오기';
    return;
  } catch (err) {
    state.gps = null;
    setGps('error', err.message, err.code === 'denied'
      ? '권한 없이도 사진이나 직접 입력으로 저장할 수 있어요.'
      : '기둥 번호나 층 표지판을 찍으면 AI가 층·구역을 읽어줘요.');
    suggestPhoto();
  }
  busy(btn, false);
}

function suggestPhoto() {
  if (state.photo || state.photoDataUrl) return;
  const btn = $('btnPhoto');
  btn.classList.remove('attention');
  void btn.offsetWidth; // 애니메이션 재시작
  btn.classList.add('attention');
  setTimeout(() => btn.classList.remove('attention'), 4500);
}

function openPicker(input) {
  if (hasConsent('photo_ai')) {
    input.click();
    return;
  }
  // 파일 선택창은 클릭 직후에만 열리므로 동의 버튼 클릭 안에서 바로 엽니다.
  askConsent('photo_ai', CONSENT_TEXT.photo_ai, { onAgree: () => input.click() });
}

async function onFileChosen(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  const token = ++photoToken;
  clearAi();
  state.photo = null;
  state.analysis = null;
  setPhoto('loading', '사진 준비 중…');
  let dataUrl;
  try {
    dataUrl = await compressImage(file);
  } catch (err) {
    if (token === photoToken) setPhoto('error', err.message, '다른 사진으로 다시 시도해주세요.');
    return;
  }
  if (token !== photoToken) return;
  state.photoDataUrl = dataUrl;
  $('photoPreviewImg').src = dataUrl;
  $('photoPreview').hidden = false;
  $('btnPhoto').textContent = '다시 찍기';
  state.photoTask = uploadPhoto(dataUrl, token);
  await state.photoTask;
  state.photoTask = null;
}

async function uploadPhoto(dataUrl, token) {
  const analyze = state.aiStatus.enabled;
  setPhoto('loading', analyze ? 'AI가 사진을 읽는 중…' : '사진 올리는 중…');
  $('aiLoading').hidden = !analyze;
  try {
    await waitForConsent('photo_ai');
    const res = await api('/api/parking/photos', { method: 'POST', body: { image: dataUrl, analyze } });
    if (token !== photoToken) return;
    state.photo = res.photo;
    state.aiStatus = { ...state.aiStatus, ...res.ai };
    if (res.analysis) {
      state.analysis = res.analysis;
      renderAi(res.analysis);
      setPhoto(res.analysis.label ? 'done' : 'warn',
        res.analysis.label ? '사진에서 위치를 읽었어요' : '표지판을 찾지 못했어요',
        res.analysis.label ? '아래 결과를 확인해주세요.' : '층·구역을 직접 적거나 표지판이 잘 보이게 다시 찍어주세요.');
    } else if (res.ai?.error) {
      setPhoto('warn', '사진은 함께 저장돼요', res.ai.error);
    } else {
      setPhoto('done', '사진 준비 완료', '돌아갈 때 확인용으로 함께 저장돼요.');
    }
  } catch (err) {
    if (token !== photoToken) return;
    if (err.network || err.status >= 500) {
      setPhoto('warn', '연결이 불안정해 AI 인식은 못 했어요', '사진은 저장할 때 함께 올라가요. 층·구역은 직접 적어주세요.');
    } else {
      // 형식 오류·동의 없음 등: 이 사진은 쓰지 않음
      setPhoto('error', '사진을 쓸 수 없어요', err.message);
      state.photoDataUrl = null;
      $('photoPreview').hidden = true;
    }
  } finally {
    if (token === photoToken) $('aiLoading').hidden = true;
  }
}

function renderAi(a) {
  const box = $('aiResult');
  box.hidden = false;
  box.classList.toggle('is-mock', !!a.is_mock);
  $('aiChip').textContent = a.is_mock ? '데모 결과 · 실제 AI 아님' : 'AI 인식 결과';
  const [confText, confClass] = CONFIDENCE[a.confidence] || CONFIDENCE.low;
  $('aiConfidence').textContent = confText;
  $('aiConfidence').className = `chip ${confClass}`;
  $('aiLabel').textContent = a.label || '층·구역을 읽지 못했어요';

  const ev = (a.evidence || []).map((t) => `“${t}”`).join(', ');
  $('aiEvidence').textContent = ev ? `사진에서 읽은 글자: ${ev}` : '';
  $('aiEvidence').hidden = !ev;
  const lm = (a.landmarks || []).join(', ');
  $('aiLandmarks').textContent = lm ? `주변: ${lm}` : '';
  $('aiLandmarks').hidden = !lm;
  $('aiNote').textContent = a.note || '';
  $('aiNote').hidden = !a.note;
  $('aiDisclaimer').textContent = a.is_mock
    ? '데모 모드라 사진을 실제로 읽지 않은 예시 값이에요. 직접 확인해서 입력해주세요.'
    : 'AI가 사진을 보고 만든 결과예요. 틀릴 수 있으니 저장 전에 확인해주세요.';

  const input = $('labelInput');
  const current = input.value.trim();
  const canAuto = a.label && a.confidence !== 'low' && !a.is_mock && (!current || current === state.autoLabel);
  if (canAuto) {
    input.value = a.label;
    state.autoLabel = a.label;
    $('btnApplyAi').hidden = true;
  } else {
    $('btnApplyAi').hidden = !a.label || current === a.label;
  }
}

function applyAi() {
  if (!state.analysis?.label) return;
  $('labelInput').value = state.analysis.label;
  state.autoLabel = state.analysis.label;
  $('btnApplyAi').hidden = true;
  $('labelInput').focus();
}

function clearAi() {
  $('aiResult').hidden = true;
  $('aiLoading').hidden = true;
  if (state.autoLabel && $('labelInput').value.trim() === state.autoLabel) $('labelInput').value = '';
  state.autoLabel = null;
}

function removePhoto() {
  photoToken += 1;
  state.photo = null;
  state.photoDataUrl = null;
  state.analysis = null;
  state.photoTask = null;
  clearAi();
  $('photoPreview').hidden = true;
  $('btnPhoto').textContent = '주차 사진 찍기';
  setPhoto('empty', ...photoIdleText());
}

function resetForm() {
  removePhoto();
  state.gps = null;
  $('labelInput').value = '';
  $('memoInput').value = '';
  $('memoCount').textContent = '0';
  $('btnGps').textContent = '휴대폰 위치 가져오기';
  setGps('idle', '아직 가져오지 않았어요', '주차한 자리에서 ‘휴대폰 위치 가져오기’를 눌러주세요.');
}

async function saveRecord(e) {
  e.preventDefault();
  const label = $('labelInput').value.trim();
  const memo = $('memoInput').value.trim();
  if (state.photoTask) {
    toast('사진을 처리하고 있어요. 잠시만 기다려주세요.');
    await state.photoTask;
  }
  if (!label && !state.gps && !state.photo && !state.photoDataUrl && !memo) {
    toast('층·구역을 적거나 위치·사진·메모 중 하나를 추가해주세요.', 'error');
    $('labelInput').focus();
    return;
  }

  const payload = { label, memo, parked_at: new Date().toISOString() };
  if (state.gps) Object.assign(payload, { latitude: state.gps.latitude, longitude: state.gps.longitude, accuracy_m: state.gps.accuracy });
  if (state.photo) payload.photo_id = state.photo.id;

  const btn = $('btnSave');
  busy(btn, true, '저장 중…');
  try {
    if (!payload.photo_id && state.photoDataUrl) {
      // 앞에서 못 올린 사진을 다시 시도 (AI 인식 없이)
      const res = await api('/api/parking/photos', { method: 'POST', body: { image: state.photoDataUrl, analyze: false } });
      payload.photo_id = res.photo.id;
    }
    const { record } = await api('/api/parking/records', { method: 'POST', body: payload });
    state.records.unshift(record);
    state.viewingId = null;
    resetForm();
    renderHero();
    renderHistory();
    toast('주차 위치를 저장했어요.', 'success');
    $('hero').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    if (err.network) {
      const ok = addPending({ payload, photoDataUrl: payload.photo_id ? null : state.photoDataUrl, parkedAt: payload.parked_at });
      if (ok) {
        resetForm();
        renderHero();
        renderPendingBanner();
        toast('연결이 끊겨 기기에 임시 저장했어요. 연결되면 자동으로 올라가요.');
      } else {
        toast('기기 저장 공간이 부족해 임시 저장하지 못했어요.', 'error');
      }
    } else {
      toast(err.message, 'error');
    }
  } finally {
    busy(btn, false);
  }
}

// ======================================================================= 오프라인 대기열
function renderPendingBanner() {
  const n = readPending().length;
  $('pendingBanner').hidden = n === 0;
  $('pendingText').textContent = `오프라인에서 저장한 기록 ${n}건이 있어요. 연결되면 자동으로 올라가요.`;
}

async function syncPending() {
  if (state.syncing) return;
  const items = readPending();
  if (!items.length) { renderPendingBanner(); return; }
  state.syncing = true;
  if (!(await flushUnsentConsents())) { state.syncing = false; return; } // 아직 오프라인
  let synced = 0;
  for (const item of items) {
    try {
      const payload = { ...item.payload };
      if (item.photoDataUrl && !payload.photo_id) {
        const res = await api('/api/parking/photos', { method: 'POST', body: { image: item.photoDataUrl, analyze: false } });
        payload.photo_id = res.photo.id;
        updatePending(item.localId, { payload, photoDataUrl: null });
      }
      await api('/api/parking/records', { method: 'POST', body: payload });
      removePending(item.localId);
      synced += 1;
    } catch (err) {
      if (err.network) break; // 아직 오프라인
      removePending(item.localId);
      toast(`임시 저장한 기록 1건을 올리지 못했어요: ${err.message}`, 'error');
    }
  }
  state.syncing = false;
  renderPendingBanner();
  if (synced) {
    toast(`임시 저장한 기록 ${synced}건을 올렸어요.`, 'success');
    await loadRecords();
  }
}

// ======================================================================= ③ 지난 기록
function renderHistory() {
  const recs = state.records;
  $('historyEmpty').hidden = recs.length > 0;
  $('historyCount').textContent = recs.length ? `최근 ${recs.length}건` : '';
  const shownId = state.heroRecord?.id;
  $('historyList').innerHTML = recs.map((r) => {
    const tags = [];
    if (r.location) {
      const weak = r.location.is_weak;
      tags.push(`<span class="chip ${weak ? 'chip-warn' : 'chip-teal'}">GPS${r.location.accuracy_m != null ? ` ±${Math.round(r.location.accuracy_m)}m` : ''}</span>`);
    }
    if (r.photo) tags.push('<span class="chip chip-teal">사진</span>');
    if (r.ai?.accepted) tags.push('<span class="chip chip-ai">AI 인식</span>');
    return `
      <li class="history-item${r.id === shownId ? ' is-viewing' : ''}">
        <button type="button" class="history-main" data-view="${esc(r.id)}" aria-label="${esc(r.label)} 기록 보기">
          <span class="h-label">${esc(r.label)}</span>
          <span class="h-time">${esc(formatShort(r.created_at))}</span>
          ${tags.length ? `<span class="h-tags">${tags.join('')}</span>` : ''}
          ${r.memo ? `<span class="h-memo">${esc(r.memo)}</span>` : ''}
        </button>
        <button type="button" class="icon-btn" data-delete="${esc(r.id)}" aria-label="${esc(r.label)} 기록 삭제">✕</button>
      </li>`;
  }).join('');
}

async function onHistoryClick(e) {
  const view = e.target.closest('[data-view]')?.dataset.view;
  const del = e.target.closest('[data-delete]')?.dataset.delete;
  if (view) {
    state.viewingId = view === state.records[0]?.id ? null : view;
    renderHero();
    renderHistory();
    $('hero').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else if (del) {
    const rec = state.records.find((r) => r.id === del);
    const ok = await confirmDialog({
      title: '이 주차 기록을 삭제할까요?',
      message: `‘${rec?.label ?? ''}’ 기록과 사진이 함께 삭제되고 되돌릴 수 없어요.`,
      confirmText: '삭제',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/parking/records/${del}`, { method: 'DELETE' });
      state.records = state.records.filter((r) => r.id !== del);
      if (state.viewingId === del) state.viewingId = null;
      renderHero();
      renderHistory();
      toast('기록을 삭제했어요.');
    } catch (err) {
      toast(err.message, 'error');
    }
  }
}

async function deleteAll() {
  const ok = await confirmDialog({
    title: '주차 기록을 모두 삭제할까요?',
    message: '저장한 위치·사진·메모가 모두 삭제되고 되돌릴 수 없어요.',
    confirmText: '모두 삭제',
    danger: true,
  });
  if (!ok) return;
  try {
    await api('/api/parking/records', { method: 'DELETE' });
    state.records = [];
    state.viewingId = null;
    renderHero();
    renderHistory();
    toast('모든 주차 기록을 삭제했어요.');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function manageConsent() {
  const data = await loadConsents(true);
  const dlg = document.createElement('dialog');
  dlg.className = 'sheet';
  const rows = () => ['location', 'photo_ai'].map((scope) => {
    const mine = data.consents?.[scope];
    const title = data.scopes?.[scope]?.title || scope;
    const status = mine?.current ? `동의함 · ${formatDateTime(mine.agreed_at)}` : '동의하지 않음';
    return `<li><strong>${esc(title)}</strong><br><span>${esc(status)}</span>
      ${mine?.current ? ` <button type="button" class="btn btn-quiet danger" data-withdraw="${scope}">동의 철회</button>` : ''}</li>`;
  }).join('');
  const draw = () => {
    dlg.innerHTML = `
      <div class="sheet-body"><h2>개인정보 동의 관리</h2><ul>${rows()}</ul>
        <p>동의를 철회해도 이미 저장된 기록은 남아 있어요. ‘전체 기록 삭제’로 지울 수 있어요.</p></div>
      <div class="sheet-actions"><button type="button" class="btn btn-primary" data-close>닫기</button></div>`;
  };
  draw();
  dlg.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) { dlg.close(); return; }
    const scope = e.target.closest('[data-withdraw]')?.dataset.withdraw;
    if (!scope) return;
    try {
      Object.assign(data, await withdrawConsent(scope));
      draw();
      if (scope === 'location') { state.gps = null; resetGpsTileOnly(); }
      if (scope === 'photo_ai') removePhoto();
      toast('동의를 철회했어요.');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  dlg.addEventListener('close', () => dlg.remove());
  document.body.appendChild(dlg);
  dlg.showModal();
}

function resetGpsTileOnly() {
  $('btnGps').textContent = '휴대폰 위치 가져오기';
  setGps('idle', '아직 가져오지 않았어요', '주차한 자리에서 ‘휴대폰 위치 가져오기’를 눌러주세요.');
}

// ======================================================================= 시작
async function loadRecords() {
  try {
    const { records } = await api('/api/parking/records?limit=20');
    state.records = records;
  } catch (err) {
    if (!err.network) toast(err.message, 'error');
  }
  renderHero();
  renderHistory();
}

function bindEvents() {
  $('btnGps').addEventListener('click', captureGps);
  $('btnPhoto').addEventListener('click', () => openPicker($('fileCamera')));
  $('btnGallery').addEventListener('click', () => openPicker($('fileGallery')));
  $('fileCamera').addEventListener('change', onFileChosen);
  $('fileGallery').addEventListener('change', onFileChosen);
  $('btnPhotoRemove').addEventListener('click', removePhoto);
  $('btnApplyAi').addEventListener('click', applyAi);
  $('saveForm').addEventListener('submit', saveRecord);
  $('memoInput').addEventListener('input', (e) => { $('memoCount').textContent = String(e.target.value.length); });
  $('labelInput').addEventListener('input', () => {
    if (state.analysis?.label) $('btnApplyAi').hidden = $('labelInput').value.trim() === state.analysis.label;
  });

  $('btnDistance').addEventListener('click', showDistance);
  $('btnEditMemo').addEventListener('click', startMemoEdit);
  $('btnMemoCancel').addEventListener('click', cancelMemoEdit);
  $('memoEditForm').addEventListener('submit', saveMemoEdit);
  $('btnBackToLatest').addEventListener('click', () => { state.viewingId = null; renderHero(); renderHistory(); });
  $('tabMap').addEventListener('click', () => selectMediaTab('map'));
  $('tabPhoto').addEventListener('click', () => selectMediaTab('photo'));
  $('btnHeroPhoto').addEventListener('click', () => {
    $('photoDialogImg').src = $('heroPhoto').src;
    $('photoDialog').showModal();
  });

  $('historyList').addEventListener('click', onHistoryClick);
  $('btnDeleteAll').addEventListener('click', deleteAll);
  $('btnConsentManage').addEventListener('click', manageConsent);
  $('btnRetryPending').addEventListener('click', syncPending);
  window.addEventListener('online', syncPending);
  setInterval(() => { if (readPending().length && navigator.onLine) syncPending(); }, 30000);
}

async function init() {
  renderShell({ page: 'parking', title: '주차 위치' });
  bindEvents();
  setPhoto('empty', ...photoIdleText());
  renderPendingBanner();
  loadConsents();
  api('/api/parking/ai-status')
    .then((s) => { state.aiStatus = s; if (!state.photoDataUrl) setPhoto('empty', ...photoIdleText()); })
    .catch(() => {});
  await loadRecords();
  syncPending();
}

init();
