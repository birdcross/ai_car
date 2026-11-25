const liveVehicle = $('liveVehicle');
const liveMonitorStatus = $('liveMonitorStatus');
const liveChargingDetails = $('liveChargingDetails');
const vehicleSummary = $('vehicleSummary');
const sampleToggle = $('showHyundaiSample');
const hyundaiSampleSummary = {
  range: {value: 32.3, unit: 1},
  odometer: {odometers: [{date: '20190821', value: 12320, unit: 1}]},
  battery: {soc: 100},
  charging: {
    soc: 51, battery_charge: true, battery_plugin: 1, target_soc: 80,
    remaining_value: 17, remaining_unit: 1, vehicle_reported_at: '2020-07-01T10:10:11+09:00',
  },
};
const chargingTime = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Asia/Seoul',
});
const chargingRefreshMs = 60_000;
let chargingMonitorRun = 0;
let chargingMonitorTimer;
let lastChargingSnapshot = null;
let showingHyundaiSample = false;

function displayDistance(row) {
  const unit = ['ft', 'km', 'm', 'mi'][row?.unit];
  return Number.isFinite(row?.value) && unit ? `${row.value.toLocaleString('ko-KR')} ${unit}` : '조회값 없음';
}

function showVehicleSummary(summary) {
  const odometers = summary.odometer?.odometers;
  const latest = Array.isArray(odometers) ? odometers.filter(row => row && typeof row.date === 'string')
    .sort((a, b) => b.date.localeCompare(a.date))[0] : null;
  $('summaryRange').textContent = displayDistance(summary.range);
  $('summaryOdometer').textContent = displayDistance(latest);
  const soc = summary.battery?.soc;
  $('summaryBattery').textContent = Number.isFinite(soc) ? `${soc}%` : '조회값 없음';
  vehicleSummary.hidden = false;
}

function showChargingSnapshot(snapshot) {
  $('liveSoc').textContent = snapshot.soc + '%';
  $('liveCharging').textContent = snapshot.battery_charge ? '충전 중' : '충전 중 아님';
  $('livePlug').textContent = ['미연결', '급속 연결', '완속 연결'][snapshot.battery_plugin];
  $('liveTarget').textContent = snapshot.target_soc == null ? '미제공' : snapshot.target_soc + '%';
  const unit = ['시간', '분', '밀리초', '초'][snapshot.remaining_unit];
  $('liveRemaining').textContent = !snapshot.battery_charge ? '—' : snapshot.remaining_value != null && unit
    ? snapshot.remaining_value + ' ' + unit : '미제공';
  $('liveReported').textContent = chargingTime.format(new Date(snapshot.vehicle_reported_at));
  liveChargingDetails.hidden = false;
}

function chargingMonitorActive() {
  return Boolean(accessToken) && !$('monitor').hidden && !document.hidden;
}

async function refreshChargingStatus(run, includeSummary = false) {
  if (run !== chargingMonitorRun || !chargingMonitorActive() || !liveVehicle.value) return;
  try {
    const result = await manufacturerRequest(includeSummary ? 'vehicle-summary' : 'charging', 'hyundai', {carId: liveVehicle.value});
    if (run !== chargingMonitorRun) return;
    if (includeSummary) showVehicleSummary(result.summary);
    const snapshot = includeSummary ? result.summary.charging : result.snapshot;
    if (!snapshot) throw new Error('충전 상태를 가져오지 못했어요. 차량의 데이터 제공 동의와 API 권한을 확인해주세요.');
    if (!lastChargingSnapshot || Date.parse(snapshot.vehicle_reported_at) >= Date.parse(lastChargingSnapshot.vehicle_reported_at)) {
      lastChargingSnapshot = snapshot;
      showChargingSnapshot(snapshot);
    }
    const stale = Date.now() - Date.parse(lastChargingSnapshot.vehicle_reported_at) > 5 * 60_000;
    liveMonitorStatus.textContent = (stale ? '차량이 보낸 최근 값입니다. ' : '') +
      '마지막 확인 · ' + chargingTime.format(new Date(snapshot.fetched_at));
  } catch (error) {
    if (run === chargingMonitorRun) {
      liveMonitorStatus.textContent = (lastChargingSnapshot ? '이전 상태를 표시하고 있어요. ' : '') + error.message;
    }
  } finally {
    if (run === chargingMonitorRun && chargingMonitorActive()) {
      chargingMonitorTimer = setTimeout(() => void refreshChargingStatus(run), chargingRefreshMs);
    }
  }
}

async function loadChargingMonitor() {
  if (showingHyundaiSample && accessToken && !$('monitor').hidden) return;
  showingHyundaiSample = false;
  sampleToggle.textContent = '현대 공식 샘플 보기';
  sampleToggle.setAttribute('aria-pressed', 'false');
  clearTimeout(chargingMonitorTimer);
  const run = ++chargingMonitorRun;
  const previous = liveVehicle.value;
  lastChargingSnapshot = null;
  liveChargingDetails.hidden = true;
  vehicleSummary.hidden = true;
  $('liveVehicleField').hidden = true;
  liveVehicle.replaceChildren();
  if (!chargingMonitorActive()) return;
  liveMonitorStatus.textContent = '연결된 현대 전기차를 확인하고 있어요.';
  try {
    const {vehicles} = await manufacturerRequest('monitor-vehicles', 'hyundai');
    if (run !== chargingMonitorRun) return;
    if (!vehicles.length) {
      liveMonitorStatus.textContent = '조회가 승인된 현대 전기차가 없어요.';
      return;
    }
    for (const {id, name, nickname} of vehicles) liveVehicle.add(new Option(nickname ? name + ' · ' + nickname : name, id));
    if (vehicles.some(vehicle => vehicle.id === previous)) liveVehicle.value = previous;
    $('liveVehicleField').hidden = false;
    liveMonitorStatus.textContent = '충전 상태를 확인하고 있어요.';
    void refreshChargingStatus(run, true);
  } catch (error) {
    if (run === chargingMonitorRun) liveMonitorStatus.textContent = error.message;
  }
}

liveVehicle.addEventListener('change', () => {
  clearTimeout(chargingMonitorTimer);
  lastChargingSnapshot = null;
  liveChargingDetails.hidden = true;
  vehicleSummary.hidden = true;
  liveMonitorStatus.textContent = '충전 상태를 확인하고 있어요.';
  void refreshChargingStatus(++chargingMonitorRun, true);
});
sampleToggle.addEventListener('click', () => {
  if (showingHyundaiSample) {
    showingHyundaiSample = false;
    void loadChargingMonitor();
    return;
  }
  showingHyundaiSample = true;
  chargingMonitorRun++;
  clearTimeout(chargingMonitorTimer);
  $('liveVehicleField').hidden = true;
  sampleToggle.textContent = '연결 차량 보기';
  sampleToggle.setAttribute('aria-pressed', 'true');
  liveMonitorStatus.textContent = '현대 공식 규격서 예시 · API별 예시 값이며 실제 차량 데이터는 저장되지 않습니다.';
  showVehicleSummary(hyundaiSampleSummary);
  showChargingSnapshot(hyundaiSampleSummary.charging);
});
document.addEventListener('evlog-route', loadChargingMonitor);
document.addEventListener('visibilitychange', loadChargingMonitor);
