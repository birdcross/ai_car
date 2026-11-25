function authErrorMessage(error, signup) {
  switch (error.code) {
    case 'email_address_not_authorized':
      return '이메일 확인을 보낼 수 없는 주소예요. 다른 이메일을 사용하거나 서비스 관리자에게 문의해주세요.';
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return '요청이 너무 많아요. 잠시 뒤 다시 시도해주세요.';
    case 'weak_password':
      return '더 강한 비밀번호를 입력해주세요.';
    case 'email_not_confirmed':
      return '받은 편지함에서 가입 확인 링크를 먼저 열어주세요.';
    case 'signup_disabled':
      return '현재 신규 회원가입이 닫혀 있어요.';
    default:
      return signup ? '가입하지 못했어요. 이메일과 비밀번호를 확인해주세요.'
        : '로그인하지 못했어요. 이메일과 비밀번호를 확인해주세요.';
  }
}

async function initializeAuth() {
  const status = $('authStatus');
  const form = $('authForm');
  const logout = $('logoutButton');
  const vehicleFields = $('signupVehicle');
  const submit = $('authSubmit');
  const mode = $('authMode');
  let signup = false;

  mode.onclick = () => {
    signup = !signup;
    vehicleFields.hidden = vehicleFields.disabled = !signup;
    $('accountHeading').textContent = signup ? '회원가입' : '로그인';
    submit.textContent = signup ? '가입 확인 메일 보내기' : '로그인';
    mode.textContent = signup ? '로그인으로 돌아가기' : '회원가입';
    form.elements.password.autocomplete = signup ? 'new-password' : 'current-password';
    form.elements.password.value = '';
    status.textContent = signup ? '이메일과 비밀번호, 내 전기차 정보를 입력하세요.' : '이메일과 비밀번호를 입력하세요.';
    form.elements.email.focus();
  };
  try {
    const response = await fetch('/api/auth-config');
    const config = response.ok ? await response.json() : {};
    if (!config.url || !config.key) {
      status.textContent = 'Supabase Auth 설정 후 가입하고 로그인할 수 있어요.';
      return;
    }
    const sdk = document.createElement('script');
    sdk.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.2/dist/umd/supabase.js';
    sdk.integrity = 'sha384-A97u3Qnt9GZHURO9YJZRe7VQgGUeFzcv6I1oIGnUTxQrCxnpQMwR0/G8F2zt9abZ';
    sdk.crossOrigin = 'anonymous';
    await new Promise((resolve, reject) => {
      sdk.onload = resolve;
      sdk.onerror = reject;
      document.head.append(sdk);
    });
    const callbackUrl = new URL(location.href);
    const callbackHash = new URLSearchParams(callbackUrl.hash.slice(1));
    const callbackError = callbackUrl.searchParams.has('error') || callbackHash.has('error');
    const client = window.supabase.createClient(config.url, config.key, {
      auth: {flowType: 'pkce'},
    });
    parkingClient = client;
    client.auth.onAuthStateChange((event, session) => {
      const user = session?.user;
      accessToken = session?.access_token ?? null;
      setRecordOwner(user?.id ?? null, user?.user_metadata?.evlog_vehicle);
      if (user) setTimeout(finishManufacturerConnection, 0);
      form.hidden = Boolean(user);
      if (user) $('accountHeading').textContent = '내 계정';
      else if (!signup) $('accountHeading').textContent = '로그인';
      logout.hidden = !user;
      $('loginLink').textContent = user ? '내 계정' : '로그인';
      status.textContent = user ? user.email + '로 로그인했어요.' : '이메일로 가입하거나 로그인하세요.';
      if (event === 'INITIAL_SESSION' && !user && callbackError) {
        status.textContent = '인증이 취소되었거나 완료되지 않았어요. 다시 시도해주세요.';
        history.replaceState(null, '', '/#account');
      }
      if (event === 'SIGNED_OUT') {
        if (signup) mode.onclick();
        location.hash = 'account';
      }
    });
    form.elements.make.addEventListener('input', refreshModelChoices);
    form.onsubmit = async event => {
      event.preventDefault();
      const credentials = {
        email: form.elements.email.value.trim(),
        password: form.elements.password.value,
      };
      if (!credentials.email || form.elements.email.validity.typeMismatch) {
        status.textContent = '올바른 이메일 주소를 입력해주세요.';
        form.elements.email.focus();
        return;
      }
      if (!credentials.password) {
        status.textContent = '비밀번호를 입력해주세요.';
        form.elements.password.focus();
        return;
      }
      let profile;
      if (signup) {
        profile = {
          displayName: form.elements.displayName.value.trim(),
          make: form.elements.make.value.trim(),
          model: form.elements.model.value.trim(),
          year: Number(form.elements.year.value),
        };
        if (!validVehicle(profile)) {
          status.textContent = '이름 또는 닉네임, 제조사, 차종, 연식을 확인해주세요.';
          return;
        }
        if (!form.elements.vehicleConsent.checked) {
          status.textContent = '가입 계정에 차량 정보를 저장하려면 동의해주세요.';
          return;
        }
      }
      status.textContent = signup ? '가입 요청을 보내고 있어요.' : '로그인하고 있어요.';
      const buttons = [submit, mode];
      buttons.forEach(button => button.disabled = true);
      try {
        const result = signup
          ? await client.auth.signUp({
              ...credentials,
              options: {emailRedirectTo: location.origin + '/', data: {evlog_vehicle: profile}},
            })
          : await client.auth.signInWithPassword(credentials);
        if (result.error) {
          status.textContent = authErrorMessage(result.error, signup);
        } else {
          form.reset();
          if (result.data.session) location.hash = needsOnboarding() ? 'settings' : 'monitor';
          else if (signup) {
            const message = '가입 확인 메일 발송 요청이 정상적으로 처리되었어요. 받은 편지함을 확인해주세요.';
            status.textContent = message;
            window.alert(message);
          }
        }
      } catch {
        status.textContent = '계정 서비스에 연결하지 못했어요. 다시 시도해주세요.';
      } finally {
        buttons.forEach(button => button.disabled = false);
      }
    };
    logout.onclick = async () => {
      logout.disabled = true;
      try {
        const {error} = await client.auth.signOut({scope:'local'});
        if (error) throw error;
      } catch {
        location.hash = 'account';
        status.textContent = '로그아웃하지 못했어요. 다시 시도해주세요.';
      } finally {
        logout.disabled = false;
      }
    };
  } catch {
    status.textContent = '로그인 서비스를 불러오지 못했어요. 새로고침 후 다시 시도해주세요.';
  }
}
initializeAuth();
