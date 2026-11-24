const connectionStatus = $('connectedVehicleStatus');
const connectionList = $('connectedVehicleList');
const vehicleCallbackPath = '/vehicle-connect/callback';
const vehicleCallback = location.pathname === vehicleCallbackPath ? new URLSearchParams(location.search) : null;
if (vehicleCallback) history.replaceState(null,'','/#parking');

async function manufacturerRequest(action, brand, extra = {}) {
  return api('vehicle-connect', JSON.stringify({action,brand,...extra}), 'application/json');
}
function clearManufacturerView() {
  connectionList.replaceChildren();
  connectionStatus.textContent = '';
}
function showManufacturerVehicles(vehicles) {
  connectionList.replaceChildren();
  for (const {name,nickname} of vehicles) {
    const item = document.createElement('li');
    item.textContent = nickname ? name + ' · ' + nickname : name;
    connectionList.append(item);
  }
  connectionStatus.textContent = vehicles.length ? '연결된 전기차 ' + vehicles.length + '대' : '승인된 전기차가 목록에 없어요.';
}
async function vehicleConnectionAction(brand, action) {
  const epoch = recordEpoch;
  clearManufacturerView();
  try {
    const result = await manufacturerRequest(action, brand);
    if (epoch !== recordEpoch) return;
    if (action === 'start') {
      sessionStorage.setItem('evlog-vehicle-link', JSON.stringify({brand,state:result.state}));
      location.assign(result.url);
    } else if (action === 'vehicles') {
      showManufacturerVehicles(result.vehicles);
    } else {
      connectionStatus.textContent = '현재 서버에서 제조사 연결을 해제했어요.';
    }
  } catch (error) {
    if (epoch === recordEpoch) connectionStatus.textContent = error.message;
  }
}
let callbackHandled = false;
async function finishManufacturerConnection() {
  if (!vehicleCallback || callbackHandled || !accessToken) return;
  callbackHandled = true;
  const epoch = recordEpoch;
  try {
    const pending = JSON.parse(sessionStorage.getItem('evlog-vehicle-link') || 'null');
    sessionStorage.removeItem('evlog-vehicle-link');
    if (vehicleCallback.has('error') || !pending || pending.state !== vehicleCallback.get('state')) {
      throw new Error('차량 연결이 완료되지 않았어요. 다시 연결해주세요.');
    }
    await manufacturerRequest('finish', pending.brand, {state:pending.state, code:vehicleCallback.get('code')});
    if (epoch !== recordEpoch) return;
    connectionStatus.textContent = '제조사 인증을 확인했어요. 차량 목록을 조회할 수 있어요.';
  } catch (error) {
    if (epoch === recordEpoch) connectionStatus.textContent = error.message;
  }
}
document.querySelectorAll('[data-vehicle-action]').forEach(button => {
  button.onclick = async () => {
    button.disabled = true;
    try { await vehicleConnectionAction(button.dataset.brand, button.dataset.vehicleAction); }
    finally { button.disabled = false; }
  };
});
