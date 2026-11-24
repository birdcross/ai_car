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
const month = today.slice(0, 7);
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
const exampleParking = {spot:'서울특별시 중구 세종대로 110', latitude:37.5665, longitude:126.9780};
let recordEpoch = 0;
let cards = [];
$('expense').elements.date.value = today;
const vehicleModels = {
  '현대': ['아이오닉 5', '아이오닉 5 N', '아이오닉 6', '아이오닉 9', '코나 일렉트릭', '캐스퍼 일렉트릭'],
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
    ? '이름 또는 닉네임과 차량을 등록하면 대시보드를 사용할 수 있어요.'
    : '목록에서 고르거나 제조사와 차종을 직접 입력하세요.';
  $('vehicleSave').textContent = onboarding ? '저장하고 시작하기' : '저장하기';
  vehicleForm.hidden = !recordOwner;
  $('vehicleLoginPrompt').hidden = Boolean(recordOwner);
  $('selectedVehicle').textContent = vehicle ? vehicle.make + ' ' + vehicle.model : '차량 미등록';
  $('selectedYear').textContent = vehicle ? vehicle.year + '년형' : '내 전기차를 등록하세요';
  $('headerVehicle').textContent = vehicle ? vehicle.model + ' · ' + vehicle.year : '차량 등록';
  $('guideSubtitle').textContent = vehicle
    ? vehicle.make + ' ' + vehicle.model + ' ' + vehicle.year + '년형 설명서 지원 여부를 확인합니다.'
    : '먼저 내 전기차를 등록해주세요.';
  $('guideSettings').hidden = Boolean(vehicle);
  $('diagnose').hidden = !vehicle;
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
  const onboarding = needsOnboarding();
  const next = {make: make.value.trim(), model: model.value.trim(), year: Number(year.value), displayName: displayName.value.trim()};
  if (!validVehicle(next)) {
    $('vehicleStatus').textContent = '이름 또는 닉네임, 제조사, 차종, 연식을 확인해주세요.';
    return;
  }
  try {
    store('vehicle', next);
    vehicle = next;
    renderVehicle();
    $('answer').hidden = true;
    $('vehicleStatus').textContent = '내 전기차를 저장했어요.';
    if (onboarding) {
      location.hash = 'home';
      route();
    }
  } catch {
    $('vehicleStatus').textContent = '차량을 저장하지 못했어요.';
  }
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
  const pages = ['home', 'ledger', 'parking', 'guide', 'cards', 'monitor', 'settings', 'sources', 'account'];
  const active = !recordOwner ? 'account' : needsOnboarding() && id !== 'account' ? 'settings' : pages.includes(id) ? id : 'home';
  for (const key of ['mainNav', 'vehicleSidebar', 'headerVehicle']) $(key).hidden = !recordOwner || needsOnboarding();
  pages.forEach(page => $(page).hidden = page !== active);
  document.querySelectorAll('nav a').forEach(a => {
    if (a.hash === '#' + active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  $('feedback').textContent = '';
  if (recordOwner && (active === 'home' || active === 'parking')) setTimeout(refreshParking, 0);
  if (recordOwner && active === 'parking') setTimeout(() => {
    if ($('parking').hidden) return;
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
    meta.textContent = item.date + (item.kwh ? ' · ' + item.kwh + ' kWh' : '');
    const amount = document.createElement('strong');
    amount.textContent = money(item.amount);
    label.append(title, meta);
    li.append(label, amount);
    list.append(li);
  }
}
function render() {
  const records = [...expenses, ...cardExpenses()];
  renderCards();
  const charges = records.filter(e => e.type === '충전' && e.date.startsWith(month));
  $('total').textContent = money(charges.reduce((sum, e) => sum + e.amount, 0));
  $('summary').textContent = '충전 ' + charges.length + '회 · ' + Number(charges.reduce((sum, e) => sum + (e.kwh ?? 0), 0).toFixed(2)) + ' kWh';
  const sorted = records.sort((a,b) => b.date.localeCompare(a.date));
  recordList($('recent'), sorted.slice(0,3));
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
    const L = await leaflet();
    if (epoch !== recordEpoch || pendingParkingKey !== key || $('parking').hidden) return;
    if (!parkedMap) {
      parkedMap = L.map(map, {scrollWheelZoom:false});
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom:19, attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(parkedMap);
      parkingMarker = L.circleMarker(point, {radius:9,color:'#165741',fillColor:'#c7f485',fillOpacity:1}).addTo(parkedMap);
    } else {
      parkingMarker.setLatLng(point);
    }
    parkedMap.setView(point,17);
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
  $('homeParking').textContent = parking ? spot || '마지막 주차 위치' : '저장된 주차 위치가 없어요.';
  $('parkCurrent').textContent = spot || (row ? '주소 정보가 없어요.' : '최근 주차 위치를 확인하고 있어요.');
  $('parkDetail').textContent = parking
    ? '마지막 갱신 · ' + new Date(parking.updated_at).toLocaleString('ko-KR', {timeZone:'Asia/Seoul'})
    : row ? '차량 위치 데이터가 없어 예시 위치를 표시합니다.' : '';
  if (recordOwner && !$('parking').hidden) void showParkingMap(row);
}
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

$('expense').onsubmit = event => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  const type = values.get('type');
  const kwh = type === '충전' && values.get('kwh') ? Number(values.get('kwh')) : null;
  const next = [{date: values.get('date'), type, amount: Number(values.get('amount')), kwh}, ...expenses];
  try { store('expenses', next); }
  catch { $('feedback').textContent = '기록을 저장하지 못했습니다. 브라우저 저장소를 확인하세요.'; return; }
  expenses = next;
  form.reset();
  form.elements.date.value = today;
  render();
  $('feedback').textContent = '지출 기록을 저장했어요.';
};
async function api(path, body, contentType) {
  if (!accessToken) throw new Error('로그인 후 이용해주세요.');
  const response = await fetch('/api/' + path, {
    method: 'POST', headers: {'Content-Type': contentType, Authorization: 'Bearer ' + accessToken}, body,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error || 'EV Log Python 서버로 접속해주세요.');
  return data;
}

const dashboardPhoto = $('dashboardPhoto');
let dashboardPhotoUrl = null;

function renderDashboardPreview() {
  if (dashboardPhotoUrl) URL.revokeObjectURL(dashboardPhotoUrl);
  const file = dashboardPhoto.files[0];
  dashboardPhotoUrl = file ? URL.createObjectURL(file) : null;
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
    $('feedback').textContent = '';
  } catch (error) {
    dashboardPhoto.value = '';
    $('feedback').textContent = error.message;
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

async function requestGuide(question, file) {
  $('answer').hidden = true;
  $('feedback').textContent = file ? '사진을 읽고 설명서를 찾고 있어요.' : '설명서를 검색하고 있어요.';
  try {
    const requestedVehicle = vehicle;
    const epoch = recordEpoch;
    const photo = file ? await encodeDashboardPhoto(file) : null;
    if (epoch !== recordEpoch || requestedVehicle !== vehicle) return;
    const answer = await api('guide', JSON.stringify({question, vehicle: requestedVehicle, photo}), 'application/json');
    if (epoch !== recordEpoch || requestedVehicle !== vehicle) return;
    $('answerTitle').textContent = answer.kind;
    $('guidance').textContent = answer.text;
    const photoResult = answer.photo_warning ? '사진에서 읽은 내용: ' + answer.photo_warning : answer.photo_notice;
    $('photoResult').textContent = photoResult || '';
    $('photoResult').hidden = !photoResult;
    $('generationNotice').textContent = answer.generation_notice || '';
    $('generationNotice').hidden = !answer.generation_notice;
    $('manualExcerpt').hidden = !answer.manual;
    $('manualExcerpt').textContent = answer.manual ? '설명서 근거: ' + answer.manual : '';
    $('guideSource').href = answer.source;
    $('answer').hidden = false;
    $('feedback').textContent = '';
  } catch (error) {
    $('feedback').textContent = error.message;
  }
}

$('diagnose').onsubmit = async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button');
  const question = form.elements.warning.value.trim();
  const file = dashboardPhoto.files[0];
  if (!question && !file) {
    $('feedback').textContent = '계기판 문구를 입력하거나 사진을 첨부해주세요.';
    return;
  }
  button.disabled = dashboardPhoto.disabled = $('removeDashboardPhoto').disabled = true;
  try { await requestGuide(question, file); }
  finally { button.disabled = dashboardPhoto.disabled = $('removeDashboardPhoto').disabled = false; }
};

function cardSummary() {
  const originals = new Map(cards.filter(tx => tx.status === 'approved').map(tx => [tx.id, tx]));
  const remaining = new Map([...originals].map(([id, tx]) => [id, tx.amount]));
  const results = new Map();
  const counts = new Map();
  for (const tx of cards) {
    if (tx.status !== 'cancelled') continue;
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

function cardExpenses() {
  const {originals, remaining} = cardSummary();
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

function renderCards() {
  const {remaining, results, counts} = cardSummary();
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
    meta.textContent = tx.date + ' · ' + status;
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

async function importCards(readContent) {
  $('importSample').disabled = $('cardFile').disabled = true;
  try {
    const incoming = await api('cards', await readContent(), 'text/csv; charset=utf-8');
    if (epoch !== recordEpoch) return;
    const known = new Map(cards.map(tx => [tx.id, tx]));
    let added = 0;
    for (const tx of incoming) {
      const existing = known.get(tx.id);
      if (existing) {
        if (['date','merchant','amount','status','original'].some(key => existing[key] !== tx[key])) {
          throw new Error('같은 거래 ID에 서로 다른 내역이 있어요. 파일을 확인하세요.');
        }
        continue;
      }
      known.set(tx.id, tx);
      added++;
    }
    saveCards([...known.values()]);
    $('cardStatus').textContent = added + '건 가져옴 · 중복 ' + (incoming.length - added) + '건 제외';
  } catch (error) {
    $('cardStatus').textContent = error.message;
  } finally {
    $('importSample').disabled = $('cardFile').disabled = false;
    $('cardFile').value = '';
  }
}

$('importSample').onclick = () => importCards(async () => {
  const response = await fetch('sample-cards.csv');
  if (!response.ok) throw new Error('샘플 파일을 불러오지 못했어요.');
  return response.text();
});
$('cardFile').onchange = event => {
  const file = event.currentTarget.files[0];
  if (file) importCards(() => file.text());
};

const target = 80;
let battery = 72;
let timer = null;
const timeNow = () => new Date().toLocaleTimeString('ko-KR', {timeZone:'Asia/Seoul'});
function drawMonitor() {
  $('soc').textContent = battery + '%';
  $('battery').value = battery;
  $('chargeStatus').textContent = battery >= target ? '목표 80% 도달' : timer ? '충전 중 · 6.4 kW' : '시뮬레이션 대기';
  $('toggleMonitor').textContent = timer ? '일시 정지' : battery >= target ? '다시 시작' : '시뮬레이션 시작';
}
function logVehicle(label, question) {
  const li = document.createElement('li');
  li.textContent = timeNow() + ' · ' + label;
  if (question) {
    const link = document.createElement('a');
    link.href = '#guide';
    link.textContent = '설명서에서 확인';
    link.onclick = () => { $('diagnose').elements.warning.value = question; };
    li.append(link);
  }
  const list = $('vehicleEvents');
  list.prepend(li);
  if (list.children.length > 8) list.lastElementChild.remove();
}
$('toggleMonitor').onclick = () => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  } else {
    if (battery >= target) battery = 72;
    logVehicle('충전 시작');
    timer = setInterval(() => {
      battery++;
      $('received').textContent = '마지막 샘플 수신 · ' + timeNow();
      if (battery >= target) {
        clearInterval(timer);
        timer = null;
        logVehicle('목표 충전량 도달');
      }
      drawMonitor();
    }, 2000);
  }
  drawMonitor();
};
$('simulateWarning').onclick = () => logVehicle('서비스 경고등 점등', '서비스 경고등');
drawMonitor();

window.addEventListener('hashchange', route);
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
  parking = null;
  parkingLoaded = parkingReading = false;
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
  clearInterval(timer);
  timer = null;
  battery = 72;
  $('received').textContent = '';
  $('vehicleEvents').replaceChildren();
  drawMonitor();
  $('answer').hidden = true;
  for (const id of ['expense', 'diagnose', 'vehicleForm']) $(id).reset();
  renderDashboardPreview();
  for (const id of ['feedback', 'cardStatus', 'vehicleStatus']) $(id).textContent = '';
  $('expense').elements.date.value = today;
  vehicleForm.elements.displayName.value = vehicle?.displayName ?? '';
  vehicleForm.elements.make.value = vehicle?.make ?? '';
  vehicleForm.elements.model.value = vehicle?.model ?? '';
  vehicleForm.elements.year.value = vehicle?.year ?? '';
  refreshModelChoices();
  renderVehicle();
  render();
  route();
}
