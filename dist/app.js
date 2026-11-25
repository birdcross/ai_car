const $ = id => document.getElementById(id);
let recordOwner = null;
let accessToken = null;
const recordKey = key => 'evlog-' + (recordOwner ? recordOwner + ':' : '') + key;
const store = (key, value) => localStorage.setItem(recordKey(key), JSON.stringify(value));
const load = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(recordKey(key))) ?? fallback; }
  catch { return fallback; }
};
const today = new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Seoul'}).format(new Date());
const money = n => '₩' + n.toLocaleString('ko-KR');
let expenses = [];
let parking = null;
let parkingClient = null;
let parkingLoaded = false;
let parkingReading = false;
let parkedMap = null;
let parkingMarker = null;
let mappedParkingKey = null;
let pendingParkingKey = null;
let allowedParkingPoint = null;
const exampleParking = {spot:'서울특별시 중구 세종대로 110', latitude:37.5665, longitude:126.9780};
let recordEpoch = 0;
let cards = [];
let registeredCards = [];
let cardImportPending = false;
$('expense').elements.date.value = today;
const vehicleModels = {
  '현대': ['아이오닉 5', '아이오닉 5 N', '아이오닉 6', '아이오닉 6 N', '아이오닉 9', '코나 일렉트릭',
    '캐스퍼 일렉트릭', '아이오닉 일렉트릭', '스타리아 일렉트릭', '포터 II 일렉트릭', 'ST1', '블루온',
    '일렉시티', '일렉시티 이층버스', '일렉시티 타운', '카운티 일렉트릭'],
  '기아': ['EV3', 'EV4', 'EV5', 'EV6', 'EV9', '니로 EV', '레이 EV'],
  '테슬라': ['모델 3', '모델 Y', '모델 S', '모델 X'],
  '제네시스': ['GV60', '일렉트리파이드 GV70', '일렉트리파이드 G80'],
  'BMW': ['i4', 'i5', 'i7', 'iX', 'iX1', 'iX2'],
  '메르세데스-벤츠': ['EQA', 'EQB', 'EQE', 'EQS'],
  '폭스바겐': ['ID.4', 'ID.5'], '폴스타': ['폴스타 2', '폴스타 4'],
  '볼보': ['EX30', 'EX40', 'EC40'], 'BYD': ['아토 3', '실', '돌핀'],
};
let vehicle = null;
const vehicleForm = $('vehicleForm');
function fillOptions(list, values) {
  list.replaceChildren(...values.map(value => {
    const option = document.createElement('option');
    option.value = value;
    return option;
  }));
}
function updateModelChoices(make, list) {
  const key = make.trim();
  fillOptions(list, Object.hasOwn(vehicleModels, key) ? vehicleModels[key] : []);
}
function refreshModelChoices() {
  updateModelChoices(vehicleForm.elements.make.value, $('models'));
  updateModelChoices($('authForm').elements.make.value, $('signupModels'));
}
function validVehicle(profile) {
  return profile && typeof profile.displayName === 'string' && Boolean(profile.displayName.trim())
    && profile.displayName.length <= 40
    && typeof profile.make === 'string' && Boolean(profile.make.trim()) && profile.make.length <= 60
    && typeof profile.model === 'string' && Boolean(profile.model.trim()) && profile.model.length <= 80
    && Number.isInteger(profile.year) && profile.year >= 1900 && profile.year <= 2100;
}
function needsOnboarding() {
  return Boolean(recordOwner && !vehicle?.displayName);
}
function renderVehicle() {
  const onboarding = needsOnboarding();
  $('garageLabel').textContent = vehicle?.displayName ? vehicle.displayName + '님의 차고' : '내 전기차';
  $('vehicleHeading').textContent = onboarding ? '내 전기차 등록' : '내 전기차 설정';
  $('vehicleIntro').textContent = onboarding
    ? '이름 또는 닉네임과 차량을 등록하면 EV Log를 사용할 수 있어요.'
    : '목록에서 고르거나 제조사와 차종을 직접 입력하세요.';
  $('vehicleSave').textContent = onboarding ? '저장하고 시작하기' : '저장하기';
  vehicleForm.hidden = !recordOwner;
  $('vehicleLoginPrompt').hidden = Boolean(recordOwner);
  $('selectedVehicle').textContent = vehicle ? vehicle.make + ' ' + vehicle.model : '차량 미등록';
  $('selectedYear').textContent = vehicle ? vehicle.year + '년형' : '내 전기차를 등록하세요';
  $('headerVehicle').textContent = vehicle ? vehicle.model + ' · ' + vehicle.year : '차량 등록';
  $('guideSubtitle').textContent = vehicle
    ? vehicle.make + ' ' + vehicle.model + ' ' + vehicle.year + '년형'
    : '먼저 내 전기차를 등록해주세요.';
  $('guideSettings').hidden = Boolean(vehicle);
  $('guideChat').hidden = !vehicle;
}
fillOptions($('makes'), Object.keys(vehicleModels));
vehicleForm.elements.make.value = vehicle?.make ?? '';
vehicleForm.elements.model.value = vehicle?.model ?? '';
vehicleForm.elements.year.value = vehicle?.year ?? '';
refreshModelChoices();
vehicleForm.elements.make.addEventListener('input', refreshModelChoices);
vehicleForm.onsubmit = event => {
  event.preventDefault();
  if (!recordOwner) return;
  const {make, model, year, displayName} = vehicleForm.elements;
  const next = {make: make.value.trim(), model: model.value.trim(), year: Number(year.value), displayName: displayName.value.trim()};
  if (!validVehicle(next)) {
    $('vehicleStatus').textContent = '이름 또는 닉네임, 제조사, 차종, 연식을 확인해주세요.';
    return;
  }
  try {
    store('vehicle', next);
  } catch {
    $('vehicleStatus').textContent = '차량을 저장하지 못했어요.';
    return;
  }
  window.alert('저장되었습니다.');
  location.reload();
};
renderVehicle();


async function loadVehicleCatalog() {
  try {
    const response = await fetch('vehicle-catalog.json');
    if (!response.ok) return;
    for (const {make, model} of await response.json()) {
      if (!Object.hasOwn(vehicleModels, make)) vehicleModels[make] = [];
      if (!vehicleModels[make].includes(model)) vehicleModels[make].push(model);
    }
    fillOptions($('makes'), Object.keys(vehicleModels));
    refreshModelChoices();
  } catch {
    // The built-in suggestions and manual entry remain available.
  }
}
loadVehicleCatalog();

function route() {
  const id = location.hash.slice(1);
  const pages = ['monitor', 'ledger', 'parking', 'guide', 'cards', 'settings', 'account'];
  const active = !recordOwner ? 'account' : needsOnboarding() && id !== 'account' ? 'settings' : pages.includes(id) ? id : 'monitor';
  for (const key of ['mainNav', 'vehicleSidebar', 'headerVehicle']) $(key).hidden = !recordOwner || needsOnboarding();
  pages.forEach(page => $(page).hidden = page !== active);
  document.querySelectorAll('nav a').forEach(a => {
    if (a.hash === '#' + active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  $('feedback').textContent = '';
  if (recordOwner && active === 'parking') setTimeout(() => {
    if ($('parking').hidden) return;
    void refreshParking();
    void loadTrips();
    renderParking();
    parkedMap?.invalidateSize();
    if (!tripMap && selectedTrip) {
      const trip = visibleTrips().find(item => item.id === selectedTrip);
      if (trip) void showTrip(trip);
    }
    tripMap?.invalidateSize();
  }, 0);
  window.scrollTo(0, 0);
  document.dispatchEvent(new Event('evlog-route'));
}
function recordList(list, rows) {
  list.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement('li');
    empty.textContent = '아직 지출 기록이 없어요.';
    list.append(empty);
  }
  for (const item of rows) {
    const li = document.createElement('li');
    const label = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = item.merchant || (item.type === '충전' ? '전기차 충전' : '차량 정비');
    const meta = document.createElement('small');
    meta.textContent = item.date;
    const detail = document.createElement('dl');
    detail.className = 'ledger-record-detail';
    const detailLabel = document.createElement('dt');
    const detailValue = document.createElement('dd');
    if (item.type === '충전') {
      detailLabel.textContent = '충전량';
      detailValue.textContent = Number.isFinite(item.kwh) && item.kwh > 0 ? item.kwh + ' kWh' : '미기록';
    } else {
      detailLabel.textContent = '정비 비고';
      detailValue.textContent = item.maintenanceNote || '미기록';
    }
    detail.append(detailLabel, detailValue);
    const amount = document.createElement('strong');
    amount.textContent = money(item.amount);
    label.append(title, meta, detail);
    li.append(label, amount);
    list.append(li);
  }
}
function render() {
  const records = [...expenses, ...cardExpenses()];
  renderCards();
  const sorted = records.sort((a,b) => b.date.localeCompare(a.date));
  recordList($('all'), sorted);
  renderParking();
}
function resetParkingMap() {
  pendingParkingKey = mappedParkingKey = null;
  parkedMap?.remove();
  parkedMap = parkingMarker = null;
  $('lastParkingMap').hidden = true;
  $('map').hidden = true;
  $('map').removeAttribute('href');
}
async function showParkingMap(row) {
  const map = $('lastParkingMap');
  const status = $('parkingMapStatus');
  const latitude = row?.latitude;
  const longitude = row?.longitude;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    resetParkingMap();
    return;
  }
  const key = latitude + ',' + longitude;
  if (mappedParkingKey === key || pendingParkingKey === key) return;
  const epoch = recordEpoch;
  const point = [latitude, longitude];
  pendingParkingKey = key;
  map.hidden = false;
  const link = $('map');
  link.href = 'https://www.openstreetmap.org/?mlat=' + latitude + '&mlon=' + longitude + '#map=17/' + latitude + '/' + longitude;
  link.hidden = false;
  try {
    const L = await loadMapLibrary();
    if (epoch !== recordEpoch || pendingParkingKey !== key || $('parking').hidden) return;
    if (!parkedMap) {
      parkedMap = L.map('lastParkingMap', {scrollWheelZoom:false}).setView(point,17);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom:19, attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(parkedMap);
      parkingMarker = L.circleMarker(point, {radius:9,color:'#165741',fillColor:'#c7f485',fillOpacity:1}).addTo(parkedMap);
    } else {
      parkingMarker.setLatLng(point);
      parkedMap.setView(point,17);
    }
    parkedMap.invalidateSize();
    mappedParkingKey = key;
    status.textContent = '';
  } catch {
    if (epoch === recordEpoch && pendingParkingKey === key) status.textContent = '지도를 불러오지 못했어요. 큰 지도에서 열 수 있어요.';
  } finally {
    if (epoch === recordEpoch && pendingParkingKey === key) pendingParkingKey = null;
  }
}
function renderParking() {
  const row = parking ?? (parkingLoaded ? exampleParking : null);
  const spot = row?.spot?.trim();
  $('parkCurrent').textContent = spot || (row ? '주소 정보가 없어요.' : '최근 주차 위치를 확인하고 있어요.');
  $('parkDetail').textContent = parking
    ? '마지막 갱신 · ' + new Date(parking.updated_at).toLocaleString('ko-KR', {timeZone:'Asia/Seoul'})
    : row ? '차량 위치 데이터가 없어 예시 위치를 표시합니다.' : '';
  const point = Number.isFinite(row?.latitude) && Number.isFinite(row?.longitude)
    ? row.latitude + ',' + row.longitude : null;
  const requiresMapChoice = Boolean(parking && point && allowedParkingPoint !== point);
  $('loadParkingMap').hidden = !requiresMapChoice;
  if (requiresMapChoice) resetParkingMap();
  else if (recordOwner && !$('parking').hidden) void showParkingMap(row);
}
$('loadParkingMap').onclick = () => {
  if (!recordOwner || !parking) return;
  allowedParkingPoint = parking.latitude + ',' + parking.longitude;
  renderParking();
};
async function refreshParking() {
  if (!recordOwner || !parkingClient || parkingReading) return;
  const epoch = recordEpoch;
  parkingReading = true;
  try {
    const {data, error} = await parkingClient.from('parking_locations')
      .select('spot,latitude,longitude,updated_at').eq('user_id',recordOwner).eq('kind','personal').maybeSingle();
    if (epoch !== recordEpoch) return;
    if (error) throw error;
    parking = data;
    parkingLoaded = true;
    $('parkingMapStatus').textContent = '';
    renderParking();
  } catch {
    if (epoch === recordEpoch) $('parkingMapStatus').textContent = '저장된 주차 위치를 불러오지 못했어요.';
  } finally {
    if (epoch === recordEpoch) parkingReading = false;
  }
}
setInterval(() => {
  if (!document.hidden && !$('parking').hidden) void refreshParking();
}, 3000);

const expenseForm = $('expense');

function updateExpenseFields() {
  const {type, kwh, maintenanceNote} = expenseForm.elements;
  const isMaintenance = type.value === '정비';
  $('expenseChargeField').hidden = kwh.disabled = isMaintenance;
  $('expenseMaintenanceField').hidden = maintenanceNote.disabled = !isMaintenance;
  maintenanceNote.required = isMaintenance;
}

expenseForm.elements.type.addEventListener('change', updateExpenseFields);
updateExpenseFields();
expenseForm.onsubmit = event => {
  event.preventDefault();
  if (!recordOwner) return;
  const form = event.currentTarget;
  const values = new FormData(form);
  const type = values.get('type');
  const kwh = type === '충전' && values.get('kwh') ? Number(values.get('kwh')) : null;
  const entry = {date: values.get('date'), type, amount: Number(values.get('amount')), kwh};
  if (type === '정비') {
    const note = values.get('maintenanceNote')?.trim();
    if (!note || note.length > 120) {
      $('feedback').textContent = '정비 내용을 120자 이내로 입력해주세요.';
      form.elements.maintenanceNote.focus();
      return;
    }
    entry.maintenanceNote = note;
  }
  const next = [entry, ...expenses];
  try { store('expenses', next); }
  catch { $('feedback').textContent = '기록을 저장하지 못했습니다. 브라우저 저장소를 확인하세요.'; return; }
  expenses = next;
  form.reset();
  form.elements.date.value = today;
  updateExpenseFields();
  render();
  $('feedback').textContent = '지출 기록을 저장했어요.';
};
async function api(path, body, contentType, signal) {
  if (!accessToken) throw new Error('로그인 후 이용해주세요.');
  const response = await fetch('/api/' + path, {
    method: 'POST', headers: {'Content-Type': contentType, Authorization: 'Bearer ' + accessToken}, body, signal,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error || 'EV Log Python 서버로 접속해주세요.');
  return data;
}

const dashboardPhoto = $('dashboardPhoto');
const guidePhotoConsent = $('guidePhotoConsent');
const guideForm = $('diagnose');
const guideMessages = $('guideMessages');
const guideChatStatus = $('guideChatStatus');
let dashboardPhotoUrl = null;
let guideConversation = 0;
let guideTurns = [];
let activeGuideThread = null;
let guideThreadSaved = false;
let unsavedGuideTurns = [];
let guideOpenRequest = 0;
let guideListRequest = 0;
const guideHistory = $('guideHistory');
const guideHistoryList = $('guideHistoryList');
const guideHistoryStatus = $('guideHistoryStatus');
const guideDate = new Intl.DateTimeFormat('ko-KR', {dateStyle:'medium', timeStyle:'short', timeZone:'Asia/Seoul'});

function guideVehicleLabel({make, model, year}) {
  return [make, model, year + '년형'].join(' ');
}

function guideDB() {
  return parkingClient.from('guide_conversations');
}

async function refreshGuideHistory() {
  if (!recordOwner || !parkingClient || !guideHistory.open) return;
  const request = ++guideListRequest;
  const epoch = recordEpoch;
  guideHistoryStatus.textContent = '대화 목록을 불러오는 중이에요.';
  const {data, error} = await guideDB().select('id,title,vehicle,updated_at')
    .eq('user_id', recordOwner).order('updated_at', {ascending:false}).order('id');
  if (epoch !== recordEpoch || request !== guideListRequest) return;
  guideHistoryList.replaceChildren();
  guideHistoryStatus.textContent = error ? '대화 목록을 불러오지 못했어요. 목록을 닫았다가 다시 열어주세요.'
    : data.length ? '' : '아직 저장된 대화가 없어요.';
  if (error) return;
  for (const thread of data) {
    const row = document.createElement('li');
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'soft guide-thread-open';
    open.setAttribute('aria-current', String(thread.id === activeGuideThread?.id));
    const title = document.createElement('span');
    title.textContent = thread.title;
    const info = document.createElement('small');
    info.textContent = guideVehicleLabel(thread.vehicle) + ' · ' + guideDate.format(new Date(thread.updated_at));
    open.append(title, info);
    open.onclick = () => void openGuideThread(thread.id);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'soft';
    remove.textContent = '삭제';
    remove.setAttribute('aria-label', thread.title + ' 대화 삭제');
    remove.onclick = () => void deleteGuideThread(thread);
    row.append(open, remove);
    guideHistoryList.append(row);
  }
}

async function openGuideThread(id) {
  if ($('sendGuide').disabled) return;
  const request = ++guideOpenRequest;
  const epoch = recordEpoch;
  const {data, error} = await guideDB().select('id,title,vehicle,turns')
    .eq('id', id).eq('user_id', recordOwner).single();
  if (epoch !== recordEpoch || request !== guideOpenRequest || $('sendGuide').disabled) return;
  if (error) {
    guideHistoryStatus.textContent = '대화를 열지 못했어요.';
    return;
  }
  resetGuideChat();
  activeGuideThread = data;
  guideThreadSaved = true;
  const caption = $('guideConversationVehicle');
  caption.textContent = '이 대화의 차량 · ' + guideVehicleLabel(data.vehicle);
  caption.hidden = false;
  for (const turn of data.turns) {
    appendGuideMessage('user', {text:turn.question});
    appendGuideMessage('assistant', turn.answer);
    rememberGuideTurn(turn);
  }
  void refreshGuideHistory();
}

async function deleteGuideThread(thread) {
  if ($('sendGuide').disabled || !confirm('이 대화를 삭제할까요?')) return;
  const epoch = recordEpoch;
  ++guideOpenRequest;
  const {error} = await guideDB().delete().eq('id', thread.id).eq('user_id', recordOwner);
  if (epoch !== recordEpoch) return;
  if (error) {
    guideHistoryStatus.textContent = '대화를 삭제하지 못했어요.';
    return;
  }
  if (thread.id === activeGuideThread?.id) resetGuideChat();
  void refreshGuideHistory();
}

function rememberGuideTurn({question, answer}) {
  const userText = [question, answer.photo_warning].filter(Boolean).join(' / ');
  guideTurns = [...guideTurns, {role:'user', text:userText}, {role:'assistant', text:answer.text.slice(0, 1200)}].slice(-8);
}

async function saveGuideTurns(conversation) {
  const thread = activeGuideThread;
  while (unsavedGuideTurns.length) {
    const {error} = await parkingClient.rpc('save_guide_turn', {
      conversation_id:thread.id, conversation_title:thread.title,
      conversation_vehicle:thread.vehicle, new_turn:unsavedGuideTurns[0], new_conversation:!guideThreadSaved,
    });
    if (conversation !== guideConversation) return;
    if (error) {
      $('retryGuideSave').hidden = false;
      guideChatStatus.textContent = '답변은 받았지만 대화를 저장하지 못했어요.';
      return;
    }
    guideThreadSaved = true;
    unsavedGuideTurns.shift();
  }
  $('retryGuideSave').hidden = true;
  guideChatStatus.textContent = '';
  void refreshGuideHistory();
}

guideHistory.ontoggle = refreshGuideHistory;

function renderDashboardPreview() {
  if (dashboardPhotoUrl) URL.revokeObjectURL(dashboardPhotoUrl);
  const file = dashboardPhoto.files[0];
  dashboardPhotoUrl = file ? URL.createObjectURL(file) : null;
  $('guidePhotoConsentLabel').hidden = !file;
  guidePhotoConsent.disabled = !file;
  guidePhotoConsent.required = Boolean(file);
  guidePhotoConsent.checked = false;
  $('dashboardPreview').hidden = !dashboardPhotoUrl;
  if (dashboardPhotoUrl) $('dashboardImage').src = dashboardPhotoUrl;
  else $('dashboardImage').removeAttribute('src');
}
function checkDashboardFile(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 12 * 1024 * 1024) {
    throw new Error('12MB 이하의 JPG, PNG 또는 WebP 사진을 첨부해주세요.');
  }
}
dashboardPhoto.onchange = () => {
  try {
    if (dashboardPhoto.files[0]) checkDashboardFile(dashboardPhoto.files[0]);
    guideChatStatus.textContent = '';
  } catch (error) {
    dashboardPhoto.value = '';
    guideChatStatus.textContent = error.message;
  }
  renderDashboardPreview();
};
$('removeDashboardPhoto').onclick = () => {
  dashboardPhoto.value = '';
  renderDashboardPreview();
};

async function encodeDashboardPhoto(file) {
  checkDashboardFile(file);
  const image = new Image();
  image.src = dashboardPhotoUrl;
  try { await image.decode(); }
  catch { throw new Error('사진을 열 수 없어요. 다른 파일을 선택해주세요.'); }
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight));
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d', {alpha: false});
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const data = canvas.toDataURL('image/jpeg', 0.78);
  if (data.length > 1500000) throw new Error('사진 용량이 너무 커요. 잘라낸 사진을 다시 첨부해주세요.');
  return data;
}

function setGuidePending(pending) {
  for (const control of [$('sendGuide'), dashboardPhoto, $('removeDashboardPhoto'), guideForm.elements.warning,
    $('clearGuideChat'), $('retryGuideSave')]) {
    control.disabled = pending;
  }
  guidePhotoConsent.disabled = pending || !dashboardPhoto.files.length;
}

function resetGuideChat() {
  guideConversation++;
  guideOpenRequest++;
  activeGuideThread = null;
  guideThreadSaved = false;
  unsavedGuideTurns = [];
  $('retryGuideSave').hidden = true;
  $('guideConversationVehicle').hidden = true;
  guideTurns = [];
  guideMessages.replaceChildren();
  guideForm.reset();
  renderDashboardPreview();
  setGuidePending(false);
  guideChatStatus.textContent = '';
  $('guideWelcome').hidden = false;
}

function appendGuideMessage(role, data) {
  const item = document.createElement('li');
  item.className = 'guide-message guide-message-' + role;
  const bubble = document.createElement('article');
  const label = document.createElement('strong');
  label.className = 'guide-message-label';
  label.textContent = role === 'user' ? '나' : data.kind;
  bubble.append(label);
  if (data.photo) {
    const image = document.createElement('img');
    image.src = data.photo;
    image.alt = '질문에 첨부한 계기판 사진';
    bubble.append(image);
  }
  if (data.text) {
    const text = document.createElement('p');
    text.className = 'guide-message-text';
    text.textContent = data.text;
    bubble.append(text);
  }
  for (const note of [data.photo_warning && '사진에서 읽은 내용 · ' + data.photo_warning, data.photo_notice, data.generation_notice]) {
    if (!note) continue;
    const detail = document.createElement('p');
    detail.className = 'guide-message-note';
    detail.textContent = note;
    bubble.append(detail);
  }
  const sources = data.sources ?? (data.source ? [{url:data.source,title:data.title}] : []);
  for (const source of sources) {
    if (typeof source.url !== 'string' || !source.url.startsWith('https://')) continue;
    const link = document.createElement('a');
    link.href = source.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = source.title || '제조사 공식 설명서';
    bubble.append(link);
  }
  item.append(bubble);
  guideMessages.append(item);
  $('guideWelcome').hidden = true;
  const transcript = guideMessages.parentElement;
  transcript.scrollTop = transcript.scrollHeight;
}

$('clearGuideChat').onclick = () => {
  resetGuideChat();
  void refreshGuideHistory();
  guideForm.elements.warning.focus();
};
$('retryGuideSave').onclick = async () => {
  const conversation = guideConversation;
  setGuidePending(true);
  guideChatStatus.textContent = '대화를 저장하는 중이에요.';
  try { await saveGuideTurns(conversation); }
  finally { if (conversation === guideConversation) setGuidePending(false); }
};
guideForm.elements.warning.addEventListener('keydown', event => {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  if (!$('sendGuide').disabled) guideForm.requestSubmit();
});
guideForm.onsubmit = async event => {
  event.preventDefault();
  if ($('sendGuide').disabled) return;
  const question = guideForm.elements.warning.value.trim();
  const file = dashboardPhoto.files[0];
  if (file && !guidePhotoConsent.checked) {
    guideChatStatus.textContent = '사진 전송에 동의한 후 보내주세요.';
    return;
  }
  if (!question && !file) {
    guideChatStatus.textContent = '계기판 문구를 입력하거나 사진을 첨부해주세요.';
    return;
  }
  const conversation = guideConversation;
  const thread = activeGuideThread;
  const {make, model, year} = thread?.vehicle ?? vehicle;
  const conversationVehicle = {make, model, year};
  setGuidePending(true);
  guideChatStatus.textContent = file ? '사진을 읽고 있어요.' : '답변을 준비하고 있어요.';
  try {
    const photo = file ? await encodeDashboardPhoto(file) : null;
    if (conversation !== guideConversation) return;
    const answer = await api('guide', JSON.stringify({
      question, vehicle:conversationVehicle, photo, photoConsent:Boolean(photo), history:guideTurns,
    }), 'application/json');
    if (conversation !== guideConversation) return;
    const {text, kind, sources, photo_warning, photo_notice, generation_notice} = answer;
    const turn = {
      id: crypto.randomUUID(),
      question: question || '계기판 사진을 첨부했어요.',
      answer: {text, kind, sources, photo_warning, photo_notice, generation_notice},
    };
    appendGuideMessage('user', {text:turn.question, photo});
    appendGuideMessage('assistant', turn.answer);
    guideForm.reset();
    renderDashboardPreview();
    rememberGuideTurn(turn);
    activeGuideThread = thread ?? {
      id:crypto.randomUUID(), title:[...(question || photo_warning || '계기판 사진 질문')].slice(0, 100).join(''),
      vehicle:conversationVehicle,
    };
    unsavedGuideTurns.push(turn);
    await saveGuideTurns(conversation);
  } catch (error) {
    if (conversation === guideConversation) guideChatStatus.textContent = error.message;
  } finally {
    if (conversation === guideConversation) setGuidePending(false);
  }
};

function cardSummary() {
  const originals = new Map(cards.filter(tx => tx.status === 'approved').map(tx => [tx.id, tx]));
  const remaining = new Map([...originals].map(([id, tx]) => [id, tx.amount]));
  const results = new Map();
  const counts = new Map();
  for (const tx of cards) {
    if (tx.status !== 'cancelled') continue;
    const originalCard = originals.get(tx.original)?.cardId;
    if (tx.cardId && originalCard && tx.cardId !== originalCard) {
      results.set(tx.id, '원거래 카드 확인 필요');
      continue;
    }
    const left = remaining.get(tx.original) ?? 0;
    if (left < tx.amount) {
      results.set(tx.id, left ? '취소 금액 확인 필요' : '반영 가능한 원거래 없음');
      continue;
    }
    remaining.set(tx.original, left - tx.amount);
    counts.set(tx.original, (counts.get(tx.original) ?? 0) + tx.amount);
    results.set(tx.id, '취소 반영');
  }
  return {originals, remaining, results, counts};
}

function cardExpenses({originals, remaining} = cardSummary()) {
  return [...originals.values()]
    .filter(tx => tx.category === 'charge' && remaining.get(tx.id) > 0)
    .map(tx => ({date:tx.date, type:'충전', amount:remaining.get(tx.id), merchant:tx.merchant}));
}

function saveCards(next) {
  try { store('cards', next); }
  catch { throw new Error('카드 내역을 브라우저에 저장하지 못했어요.'); }
  cards = next;
  render();
}

function cardLabel(card) {
  return card.nickname + ' · ' + card.issuer + ' · 끝 ' + card.lastFour;
}

function saveRegisteredCards(next) {
  try { store('registeredCards', next); }
  catch { throw new Error('카드 정보를 브라우저에 저장하지 못했어요.'); }
  registeredCards = next;
  renderRegisteredCards();
}

function renderRegisteredCards() {
  const rows = $('registeredCardRows');
  const picker = $('importCardChoice');
  const selected = picker.value;
  rows.replaceChildren();
  const placeholder = new Option('카드를 선택하세요', '');
  picker.replaceChildren(placeholder);
  if (!registeredCards.length) {
    const empty = document.createElement('li');
    empty.textContent = '등록한 카드가 없어요.';
    rows.append(empty);
  }
  for (const card of registeredCards) {
    picker.add(new Option(cardLabel(card), card.id));
    const row = document.createElement('li');
    const info = document.createElement('div');
    const nickname = document.createElement('strong');
    nickname.textContent = card.nickname;
    const details = document.createElement('small');
    details.textContent = card.issuer + ' · 끝 ' + card.lastFour;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'soft';
    remove.textContent = '등록 해제';
    remove.setAttribute('aria-label', card.nickname + ' 등록 해제');
    remove.onclick = () => {
      const status = $('registerCardStatus');
      try {
        saveRegisteredCards(registeredCards.filter(item => item.id !== card.id));
        status.textContent = '카드 등록을 해제했어요. 가져온 거래는 차계부에서 확인할 수 있어요.';
      } catch (error) { status.textContent = error.message; }
    };
    info.append(nickname, details);
    row.append(info, remove);
    rows.append(row);
  }
  picker.value = registeredCards.some(card => card.id === selected) ? selected
    : registeredCards.length === 1 ? registeredCards[0].id : '';
  $('cardImportHint').textContent = registeredCards.length
    ? '카드를 고르고 결제 내역 파일을 선택하세요.'
    : '카드를 등록하면 결제 내역을 가져올 수 있어요.';
  setCardImportPending(cardImportPending);
}

function setCardImportPending(pending) {
  cardImportPending = pending;
  for (const id of ['importCardChoice', 'cardFile', 'importCardSubmit']) {
    $(id).disabled = pending || !registeredCards.length;
  }
}

$('registerCard').onsubmit = event => {
  event.preventDefault();
  if (!recordOwner) return;
  const form = event.currentTarget;
  const {issuer, nickname, lastFour} = form.elements;
  const card = {issuer:issuer.value, nickname:nickname.value.trim(), lastFour:lastFour.value.trim()};
  const status = $('registerCardStatus');
  if (!card.issuer || !card.nickname || !/^[0-9]{4}$/.test(card.lastFour)) {
    status.textContent = '카드사, 별명, 끝 4자리를 확인해주세요.';
    return;
  }
  if (registeredCards.some(item => item.issuer === card.issuer && item.lastFour === card.lastFour && item.nickname === card.nickname)) {
    status.textContent = '이미 같은 카드가 등록되어 있어요.';
    return;
  }
  try {
    card.id = cards.find(tx => tx.cardLabel === cardLabel(card))?.cardId ?? crypto.randomUUID();
    saveRegisteredCards([...registeredCards, card]);
    if (!cardImportPending) $('importCardChoice').value = card.id;
    form.reset();
    status.textContent = '카드를 등록했어요.';
  } catch (error) { status.textContent = error.message; }
};

function renderCards() {
  const summary = cardSummary();
  const {remaining, results, counts} = summary;
  const applied = cardExpenses(summary);
  $('cardChargeSummary').textContent = '차계부에 반영된 카드 충전비 ' + applied.length + '건 · '
    + money(applied.reduce((sum, tx) => sum + tx.amount, 0));
  const list = $('cardRows');
  list.replaceChildren();
  if (!cards.length) {
    const empty = document.createElement('li');
    empty.textContent = '가져온 거래가 없어요.';
    list.append(empty);
  }
  for (const tx of cards) {
    const li = document.createElement('li');
    const detail = document.createElement('div');
    const name = document.createElement('strong');
    const meta = document.createElement('small');
    const status = tx.status === 'cancelled' ? results.get(tx.id)
      : remaining.get(tx.id) === 0 ? '결제 취소됨'
      : tx.category === 'charge' ? (counts.has(tx.id) ? '부분 취소 · 차계부 반영' : '차계부 반영')
      : tx.category === 'review' ? '확인 대기' : '제외';
    name.textContent = tx.merchant + ' · ' + money(tx.amount);
    meta.textContent = [tx.date, tx.cardLabel, status].filter(Boolean).join(' · ');
    detail.append(name, meta);
    li.append(detail);
    if (status === '확인 대기') {
      const actions = document.createElement('div');
      actions.className = 'review-actions';
      for (const [label, category] of [['충전비 등록','charge'], ['제외','ignored']]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.onclick = () => {
          try {
            saveCards(cards.map(item => item.id === tx.id ? {...item, category} : item));
            $('cardStatus').textContent = label + ' 처리했어요.';
          } catch (error) { $('cardStatus').textContent = error.message; }
        };
        actions.append(button);
      }
      li.append(actions);
    }
    list.append(li);
  }
}

$('importCardTransactions').onsubmit = async event => {
  event.preventDefault();
  if (!recordOwner || cardImportPending) return;
  const epoch = recordEpoch;
  const card = registeredCards.find(item => item.id === $('importCardChoice').value);
  const file = $('cardFile').files[0];
  if (!card || !file) return;
  setCardImportPending(true);
  $('cardStatus').textContent = '결제 내역을 확인하고 있어요.';
  try {
    if (file.size > 262144) throw new Error('256KB 이하의 CSV 파일을 선택해주세요.');
    const content = await file.text();
    if (epoch !== recordEpoch) return;
    const expectedFields = ['id', 'date', 'merchant', 'amount', 'status', 'original_id'];
    const header = content.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/, 1)[0].split(',');
    if (header.length !== expectedFields.length ||
        expectedFields.some((field, index) => header[index] !== field && header[index] !== '"' + field + '"')) {
      throw new Error('샘플과 같은 6개 열만 포함된 CSV를 선택해주세요.');
    }
    const incoming = await api('cards', content, 'text/csv; charset=utf-8');
    if (epoch !== recordEpoch) return;
    if (!registeredCards.some(item => item.id === card.id)) throw new Error('등록된 카드를 선택하고 다시 가져와주세요.');
    const known = new Map(cards.map(tx => [tx.id, tx]));
    let added = 0;
    for (const tx of incoming) {
      const existing = known.get(tx.id);
      if (existing) {
        if (existing.cardId && existing.cardId !== card.id) {
          throw new Error('다른 카드에 같은 거래 ID가 있어요. 선택한 카드와 CSV를 확인해주세요.');
        }
        if (['date','merchant','amount','status','original'].some(key => existing[key] !== tx[key])) {
          throw new Error('같은 거래 ID에 서로 다른 내역이 있어요. 파일을 확인하세요.');
        }
        continue;
      }
      known.set(tx.id, {...tx, cardId:card.id, cardLabel:cardLabel(card)});
      added++;
    }
    saveCards([...known.values()]);
    $('cardStatus').textContent = added + '건 가져옴 · 중복 ' + (incoming.length - added) + '건 제외';
  } catch (error) {
    if (epoch === recordEpoch) $('cardStatus').textContent = error.message;
  } finally {
    if (epoch === recordEpoch) {
      setCardImportPending(false);
      $('cardFile').value = '';
    }
  }
};

const sandboxForm = $('sandboxApprovals');
const sandboxChoice = $('sandboxCardChoice');
const sandboxStatus = $('cardSandboxStatus');
const sandboxRows = $('sandboxApprovalRows');

function setSandboxPending(pending) {
  for (const id of ['loadSandboxCards', 'loadSandboxApprovals', 'sandboxCardChoice']) {
    $(id).disabled = pending;
  }
}

async function queryCardSandbox(payload, show) {
  if (!recordOwner || $('loadSandboxCards').disabled) return;
  const epoch = recordEpoch;
  setSandboxPending(true);
  sandboxRows.replaceChildren();
  sandboxStatus.textContent = 'CODEF 테스트 서버에 조회하고 있어요.';
  try {
    const result = await api('card-sandbox', JSON.stringify(payload), 'application/json');
    if (epoch === recordEpoch) show(result);
  } catch (error) {
    if (epoch === recordEpoch) sandboxStatus.textContent = error.message;
  } finally {
    if (epoch === recordEpoch) setSandboxPending(false);
  }
}

$('loadSandboxCards').onclick = () => {
  sandboxForm.hidden = true;
  void queryCardSandbox({action:'cards'}, ({cards: testCards}) => {
    sandboxChoice.replaceChildren(...testCards.map(card => new Option(card.name + ' · 끝 ' + card.lastFour, card.id)));
    sandboxForm.hidden = !testCards.length;
    sandboxStatus.textContent = testCards.length ? '테스트 카드 ' + testCards.length + '장을 조회했어요.' : '조회된 테스트 카드가 없어요.';
  });
};

sandboxForm.onsubmit = event => {
  event.preventDefault();
  if (sandboxChoice.value === '') return;
  void queryCardSandbox({action:'approvals', card:Number(sandboxChoice.value)}, ({transactions}) => {
    const masked = transactions.some(tx => !tx.date || !tx.merchant || tx.amount === null);
    sandboxStatus.textContent = masked ? '승인내역 API가 응답했어요. 날짜·가맹점·금액은 테스트 응답에서 가려질 수 있어요.'
      : transactions.length ? '테스트 승인내역을 조회했어요.' : '조회된 테스트 승인내역이 없어요.';
    for (const tx of transactions) {
      const row = document.createElement('li');
      row.textContent = [tx.date || '날짜 비공개', tx.merchant || '가맹점 비공개',
        tx.amount === null ? '금액 비공개' : money(tx.amount), tx.cancelled ? '취소' : '승인'].join(' · ');
      sandboxRows.append(row);
    }
  });
};

window.addEventListener('hashchange', route);
renderRegisteredCards();
route();
render();

function setRecordOwner(userId, signupVehicle) {
  if (recordOwner === userId) return;
  recordOwner = userId;
  recordEpoch++;
  resetDrivingTrips();
  clearManufacturerView();
  expenses = userId ? load('expenses', []) : [];
  cards = userId ? load('cards', []) : [];
  registeredCards = userId ? load('registeredCards', []) : [];
  cardImportPending = false;
  sandboxForm.hidden = true;
  sandboxChoice.replaceChildren();
  sandboxRows.replaceChildren();
  sandboxStatus.textContent = '';
  setSandboxPending(false);
  parking = null;
  parkingLoaded = parkingReading = false;
  allowedParkingPoint = null;
  resetParkingMap();
  $('parkingMapStatus').textContent = '';
  vehicle = userId ? load('vehicle', null) : null;
  if (userId && !vehicle && validVehicle(signupVehicle)) {
    vehicle = {
      displayName: signupVehicle.displayName.trim(), make: signupVehicle.make.trim(),
      model: signupVehicle.model.trim(), year: signupVehicle.year,
    };
    try { store('vehicle', vehicle); }
    catch { /* Account metadata can restore the initial vehicle on the next sign-in. */ }
  }
  resetGuideChat();
  guideListRequest++;
  guideHistory.open = false;
  guideHistoryList.replaceChildren();
  guideHistoryStatus.textContent = '';
  for (const id of ['expense', 'vehicleForm', 'registerCard', 'importCardTransactions']) $(id).reset();
  $('importCardChoice').value = '';
  for (const id of ['feedback', 'cardStatus', 'registerCardStatus', 'vehicleStatus']) $(id).textContent = '';
  $('expense').elements.date.value = today;
  updateExpenseFields();
  vehicleForm.elements.displayName.value = vehicle?.displayName ?? '';
  vehicleForm.elements.make.value = vehicle?.make ?? '';
  vehicleForm.elements.model.value = vehicle?.model ?? '';
  vehicleForm.elements.year.value = vehicle?.year ?? '';
  refreshModelChoices();
  renderVehicle();
  renderRegisteredCards();
  render();
  route();
}
