const liveVehicle = $('liveVehicle');
const liveMonitorStatus = $('liveMonitorStatus');
const liveChargingDetails = $('liveChargingDetails');
const chargingTime = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Asia/Seoul',
});
const chargingRefreshMs = 60_000;
let chargingMonitorRun = 0;
let chargingMonitorTimer;
let lastChargingSnapshot = null;

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

async function refreshChargingStatus(run) {
  if (run !== chargingMonitorRun || !chargingMonitorActive() || !liveVehicle.value) return;
  try {
    const {snapshot} = await manufacturerRequest('charging', 'hyundai', {carId: liveVehicle.value});
    if (run !== chargingMonitorRun) return;
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
  clearTimeout(chargingMonitorTimer);
  const run = ++chargingMonitorRun;
  const previous = liveVehicle.value;
  lastChargingSnapshot = null;
  liveChargingDetails.hidden = true;
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
    void refreshChargingStatus(run);
  } catch (error) {
    if (run === chargingMonitorRun) liveMonitorStatus.textContent = error.message;
  }
}

liveVehicle.addEventListener('change', () => {
  clearTimeout(chargingMonitorTimer);
  lastChargingSnapshot = null;
  liveChargingDetails.hidden = true;
  liveMonitorStatus.textContent = '충전 상태를 확인하고 있어요.';
  void refreshChargingStatus(++chargingMonitorRun);
});
document.addEventListener('evlog-route', loadChargingMonitor);
document.addEventListener('visibilitychange', loadChargingMonitor);
