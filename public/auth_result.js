// URL fragment(#...) 우선 파싱, 없으면 query 파싱(하위 호환)
let frag = window.location.hash?.startsWith('#') ? window.location.hash.slice(1) : '';
const query = window.location.search?.startsWith('?') ? window.location.search.slice(1) : '';

// 해시 라우팅/이중 해시 등 특이 케이스 방어: 마지막 '#' 이후만 사용
if (frag.includes('#')) {
  frag = frag.split('#').pop() || frag;
}
// "#/status=success..." 같은 형태 방어
frag = frag.replace(/^\/+/, '');

const params = new URLSearchParams(frag || query);

const rawStatus = (params.get('status') || '').trim().toLowerCase();
const status = rawStatus === 'success' ? 'success' : 'error';
const state = params.get('state') || undefined;
const provider = (params.get('provider') || '').trim().toLowerCase();
const errorCode = (params.get('errorCode') || '').trim() || undefined;
const errorMessage = (params.get('errorMessage') || '').trim() || undefined;
const existingProvider = (params.get('existingProvider') || '').trim().toLowerCase() || undefined;

const iconEl = document.getElementById('icon');
const titleEl = document.getElementById('title');
const messageEl = document.getElementById('message');

const providerKo =
  provider === 'google'
    ? '구글'
    : provider === 'kakao'
      ? '카카오'
      : provider === 'naver'
        ? '네이버'
        : '소셜';

const existingProviderKo =
  existingProvider === 'google'
    ? '구글'
    : existingProvider === 'kakao'
      ? '카카오'
      : existingProvider === 'naver'
        ? '네이버'
        : existingProvider === 'local'
          ? '이메일/비밀번호(일반 로그인)'
          : existingProvider
            ? '기존 계정'
            : '기존 계정';

const errorMessageByCode = {
  USER_CANCEL: '로그인을 취소하셨습니다.',
  AUTH_TIMEOUT: '인증 시간이 만료되었습니다. 다시 시도해 주세요.',
  INVALID_STATE: '비정상적인 접근입니다.',
  INVALID_REQUEST: '요청이 올바르지 않습니다. 다시 시도해주세요.',
  PKCE_VERIFY_FAIL: '로그인 처리 중 기술적 오류가 발생했습니다.',
  INTERNAL_ERROR: '서버 점검 중입니다. 잠시 후 이용해 주세요.',
};

if (status === 'success') {
  if (iconEl) {
    iconEl.innerText = '✅';
    iconEl.style.color = '#00C897';
  }
  if (titleEl) titleEl.innerText = '로그인 성공!';
  if (messageEl) messageEl.innerText = `${providerKo} 로그인이 완료되었습니다.`;

  // 앱(WebView)으로 데이터 전달
  if (window.ReactNativeWebView) {
    const upper = provider ? provider.toUpperCase() : 'SOCIAL';
    window.ReactNativeWebView.postMessage(
      JSON.stringify({
        type: `${upper}_LOGIN_SUCCESS`,
        provider,
        status: 'success',
        state,
        existingProvider,
      }),
    );
  }
} else {
  if (iconEl) {
    iconEl.innerText = '❌';
    iconEl.style.color = '#FF4D4F';
  }
  if (titleEl) titleEl.innerText = '로그인 실패';
  const detail = (() => {
    if (errorCode === 'EMAIL_CONFLICT') {
      if (existingProvider === 'local') {
        return '이미 이메일/비밀번호(일반 로그인)로 가입된 이메일입니다.\n일반 로그인으로 진행해주세요.';
      }
      if (existingProvider) {
        return `이미 ${existingProviderKo}로 가입된 이메일입니다.\n${existingProviderKo}로 로그인해주세요.`;
      }
      return '이미 사용 중인 이메일입니다.\n기존 방식으로 로그인해주세요.';
    }
    return (
      (errorCode && errorMessageByCode[errorCode]) ||
      '인증 처리 중 오류가 발생했습니다.\n다시 시도해주세요.'
    );
  })();
  if (messageEl) messageEl.innerText = detail;

  if (window.ReactNativeWebView) {
    const upper = provider ? provider.toUpperCase() : 'SOCIAL';
    window.ReactNativeWebView.postMessage(
      JSON.stringify({
        type: `${upper}_LOGIN_ERROR`,
        provider,
        status: 'error',
        errorCode: errorCode || 'unknown',
        existingProvider,
        // UI에는 노출하지 않되, RN에서 디버깅/분기용으로만 전달
        errorMessage: errorMessage || undefined,
      }),
    );
  }
}

// 3초 후 자동 창 닫기 시도
setTimeout(() => {
  if (window.close) window.close();
}, 3000);

