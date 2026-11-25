const liveVehicle = $('liveVehicle');
const liveMonitorStatus = $('liveMonitorStatus');
const liveChargingDetails = $('liveChargingDetails');
const vehicleSummary = $('vehicleSummary');
const sampleToggle = $('showHyundaiSample');
const liveBatteryVisual = $('liveBatteryVisual');
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
const chargingStaleMs = 5 * 60_000;
let chargingMonitorRun = 0;
let chargingMonitorTimer;
let lastChargingSnapshot = null;
let interruptedCharge = null;
let showingHyundaiSample = false;
const chargingHistory = new Map();
let chargingHistoryOwner;
const trendTime = new Intl.DateTimeFormat('ko-KR', {hour:'2-digit', minute:'2-digit', timeZone:'Asia/Seoul'});

const chargingCheckSteps = {
  interrupted: [
    '충전기 화면의 종료 사유, 계기판 경고 문구와 차량의 예약 충전 설정을 확인하세요.',
    '충전기와 커넥터의 외관을 확인하세요. 손상이 보이면 해당 장비 사용을 중지하고 충전기 운영사에 문의하세요.',
    '정상 작동하는 다른 충전기에서도 같은 증상이 반복되면 현대차 서비스센터에 점검을 요청하세요.',
  ],
  data: [
    '차량이 마지막으로 전송한 시각을 확인하고 다음 조회까지 기다려보세요.',
    '마이현대 앱이나 계기판에서 현재 충전 상태를 확인해보세요.',
    '계속 갱신되지 않으면 블루링크 연결과 차량 데이터 제공 동의를 확인하세요.',
  ],
};

function isBatteryPercent(value) {
  return Number.isFinite(value) && value >= 0 && value <= 100;
}

function checkChargingReading(previous, current, interruption, now) {
  const reportedAt = Date.parse(current.vehicle_reported_at);
  const lastReportedAt = Date.parse(previous?.vehicle_reported_at);
  const elapsed = reportedAt - lastReportedAt;
  const dataIssue = (observation, discard = true) => ({type:'data', observation, discard});
  if (!Number.isFinite(reportedAt) || reportedAt - now > 2 * chargingRefreshMs)
    return dataIssue('차량 전송 시각을 확인할 수 없어요.');
  if (!isBatteryPercent(current.soc) || (current.target_soc != null && !isBatteryPercent(current.target_soc)))
    return dataIssue('배터리 잔량 또는 충전 목표가 0~100% 범위를 벗어났어요.');
  if (current.battery_charge && current.battery_plugin === 0)
    return dataIssue('차량이 충전 중이라고 응답했지만 플러그 상태는 미연결로 들어왔어요.');
  if (elapsed < 0) return dataIssue('이전 조회보다 오래된 차량 데이터가 들어왔어요.');
  if (now - reportedAt > chargingStaleMs)
    return dataIssue('차량이 보낸 충전 상태가 5분 넘게 갱신되지 않았어요.', false);
  if (elapsed === 0 && (previous.soc !== current.soc || previous.battery_charge !== current.battery_charge
      || previous.battery_plugin !== current.battery_plugin))
    return dataIssue('같은 차량 전송 시각에 서로 다른 배터리 또는 충전 상태가 들어왔어요.');
  if (elapsed > 0 && elapsed <= chargingRefreshMs && Math.abs(current.soc - previous.soc) >= 20)
    return dataIssue('차량이 1분 이내에 배터리 잔량이 20%p 이상 바뀌었다고 응답했어요. 표시값을 확인해주세요.');

  const samePlug = current.battery_plugin > 0 && previous?.battery_plugin === current.battery_plugin;
  const target = current.target_soc ?? (samePlug ? previous.target_soc ?? interruption?.target : null);
  const stopped = samePlug && previous.battery_charge && elapsed > 0 && elapsed <= chargingStaleMs;
  if (!current.battery_charge && samePlug && isBatteryPercent(target) && current.soc < target && (stopped || interruption)) {
    return {type:'interrupted', target, discard:false,
      observation:`충전 플러그가 연결된 상태에서 충전이 멈췄어요. 배터리 ${current.soc}% · 목표 ${target}%`};
  }
  return null;
}

function showChargingCheck(check) {
  const panel = $('chargingCheck');
  panel.hidden = !check;
  if (!check) return;
  const interrupted = check.type === 'interrupted';
  $('chargingCheckBadge').textContent = interrupted ? '충전 중단 확인' : '데이터 확인';
  $('chargingCheckObservation').textContent = check.observation;
  $('chargingManualLink').hidden = !interrupted;
  const steps = chargingCheckSteps[check.type].map(step => {
    const item = document.createElement('li');
    item.textContent = step;
    return item;
  });
  $('chargingCheckSteps').replaceChildren(...steps);
}

function resetChargingCheck() {
  lastChargingSnapshot = null;
  interruptedCharge = null;
  showChargingCheck(null);
}

function renderChargingTrend(points, target) {
  const toY = soc => 150 - 1.3 * soc;
  const first = points[0];
  const last = points.at(-1);
  const span = last.time - first.time;
  const plot = points.map(({time, soc}) => [span ? 48 + 414 * (time - first.time) / span : 255, toY(soc)]);
  const coords = plot.map(point => point.join(',')).join(' ');
  const [lastX, lastY] = plot.at(-1);
  $('chartLine').setAttribute('points', span ? coords : '');
  $('chartArea').setAttribute('d', span ? `M${coords.replaceAll(' ', ' L')} L${lastX},150 L48,150 Z` : '');
  $('chartPoint').setAttribute('cx', lastX);
  $('chartPoint').setAttribute('cy', lastY);
  const targetLine = $('chartTargetLine');
  targetLine.toggleAttribute('hidden', target == null);
  if (target != null) {
    targetLine.setAttribute('y1', toY(target));
    targetLine.setAttribute('y2', toY(target));
  }
  $('chartFirstTime').textContent = trendTime.format(first.time);
  $('chartLastTime').textContent = span ? trendTime.format(last.time) : '';
  $('chargingTrendNote').textContent = showingHyundaiSample ? '공식 예시 관측값 1건' : span ? `이 탭에서 받은 최근 ${points.length}건` : '새 차량 전송값이 들어오면 추이가 표시돼요.';
  $('chargingChartDescription').textContent = `최근 차량 잔량 ${last.soc}%${target == null ? '' : `, 충전 목표 ${target}%`}`;
}

function displayDistance(row) {
  const unit = ['ft', 'km', 'm', 'mi'][row?.unit];
  return Number.isFinite(row?.value) && row.value >= 0 && unit ? `${row.value.toLocaleString('ko-KR')} ${unit}` : '조회값 없음';
}

function showVehicleSummary(summary) {
  const odometers = summary.odometer?.odometers;
  const latest = Array.isArray(odometers) ? odometers.filter(row => row && typeof row.date === 'string')
    .sort((a, b) => b.date.localeCompare(a.date))[0] : null;
  $('summaryRange').textContent = displayDistance(summary.range);
  $('summaryOdometer').textContent = displayDistance(latest);
  const soc = summary.battery?.soc;
  $('summaryBattery').textContent = isBatteryPercent(soc) ? `${soc}%` : '조회값 없음';
  vehicleSummary.hidden = false;
}

function showChargingSnapshot(snapshot) {
  $('liveSoc').textContent = snapshot.soc + '%';
  $('liveCharging').textContent = snapshot.battery_charge ? '충전 중' : '충전 중 아님';
  $('liveCharging').classList.toggle('is-charging', snapshot.battery_charge);
  $('batteryMeter').setAttribute('aria-valuenow', snapshot.soc);
  $('batteryFill').style.width = `${snapshot.soc}%`;
  $('batteryGoal').textContent = snapshot.target_soc == null ? '' : `목표 ${snapshot.target_soc}%`;
  const targetMarker = $('batteryTargetMarker');
  targetMarker.hidden = snapshot.target_soc == null;
  targetMarker.style.left = `${snapshot.target_soc ?? 0}%`;
  $('livePlug').textContent = ['미연결', '급속 연결', '완속 연결'][snapshot.battery_plugin];
  $('liveTarget').textContent = snapshot.target_soc == null ? '미제공' : snapshot.target_soc + '%';
  const unit = ['시간', '분', '밀리초', '초'][snapshot.remaining_unit];
  $('liveRemaining').textContent = !snapshot.battery_charge ? '—' : snapshot.remaining_value != null && unit
    ? snapshot.remaining_value + ' ' + unit : '미제공';
  $('liveReported').textContent = chargingTime.format(new Date(snapshot.vehicle_reported_at));
  const point = {time: Date.parse(snapshot.vehicle_reported_at), soc: snapshot.soc};
  const history = showingHyundaiSample ? [] : chargingHistory.get(liveVehicle.value) ?? [];
  if (point.time === history.at(-1)?.time) history[history.length - 1] = point;
  else if (!history.length || point.time > history.at(-1).time) history.push(point);
  if (history.length > 30) history.shift();
  if (!showingHyundaiSample) chargingHistory.set(liveVehicle.value, history);
  renderChargingTrend(history, snapshot.target_soc);
  liveBatteryVisual.hidden = false;
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
    if (result.chargingDataIssue) {
      showChargingCheck({type:'data', observation:result.chargingDataIssue});
      liveMonitorStatus.textContent = lastChargingSnapshot ? '마지막 정상 조회값을 표시하고 있어요.' : '표시할 수 있는 충전 상태가 없어요.';
      return;
    }
    if (!snapshot) throw new Error('충전 상태를 가져오지 못했어요. 차량의 데이터 제공 동의와 API 권한을 확인해주세요.');
    const check = checkChargingReading(lastChargingSnapshot, snapshot, interruptedCharge, Date.now());
    const summarySoc = includeSummary ? result.summary.battery?.soc : null;
    showChargingCheck(check ?? (summarySoc != null && !isBatteryPercent(summarySoc)
      ? {type:'data', observation:'배터리 잔량 조회 응답의 값이 0~100% 범위를 벗어났어요.'} : null));
    if (!check?.discard) {
      if (check?.type !== 'data') interruptedCharge = check;
      lastChargingSnapshot = snapshot;
      showChargingSnapshot(snapshot);
    }
    const checkedAt = Date.parse(snapshot.fetched_at);
    const lastChecked = Number.isFinite(checkedAt) ? '마지막 확인 · ' + chargingTime.format(checkedAt) : '';
    liveMonitorStatus.textContent = (check?.discard && lastChargingSnapshot ? '마지막 정상 조회값을 표시하고 있어요. ' : '') + lastChecked;
  } catch (error) {
    if (run === chargingMonitorRun) {
      showChargingCheck({type:'data', observation:'차량의 최신 충전 상태를 확인하지 못했어요.'});
      liveMonitorStatus.textContent = (lastChargingSnapshot ? '이전 상태를 표시하고 있어요. ' : '') + error.message;
    }
  } finally {
    if (run === chargingMonitorRun && chargingMonitorActive()) {
      chargingMonitorTimer = setTimeout(() => void refreshChargingStatus(run), chargingRefreshMs);
    }
  }
}

async function loadChargingMonitor() {
  if (recordOwner !== chargingHistoryOwner) {
    chargingHistory.clear();
    chargingHistoryOwner = recordOwner;
    showingHyundaiSample = false;
  }
  if (showingHyundaiSample && accessToken && !$('monitor').hidden) return;
  showingHyundaiSample = false;
  sampleToggle.textContent = '현대 공식 샘플 보기';
  sampleToggle.setAttribute('aria-pressed', 'false');
  clearTimeout(chargingMonitorTimer);
  const run = ++chargingMonitorRun;
  const previous = liveVehicle.value;
  resetChargingCheck();
  liveChargingDetails.hidden = true;
  liveBatteryVisual.hidden = true;
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
  resetChargingCheck();
  liveChargingDetails.hidden = true;
  liveBatteryVisual.hidden = true;
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
  resetChargingCheck();
  $('liveVehicleField').hidden = true;
  sampleToggle.textContent = '연결 차량 보기';
  sampleToggle.setAttribute('aria-pressed', 'true');
  liveMonitorStatus.textContent = '현대 공식 규격서 예시 · API별 예시 값이며 실제 차량 데이터는 저장되지 않습니다.';
  showVehicleSummary(hyundaiSampleSummary);
  showChargingSnapshot(hyundaiSampleSummary.charging);
});
document.addEventListener('evlog-route', loadChargingMonitor);
document.addEventListener('visibilitychange', loadChargingMonitor);
