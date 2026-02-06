// URL fragment(#...) 우선 파싱, 없으면 query 파싱(하위 호환)
const frag = window.location.hash?.startsWith('#')
  ? window.location.hash.slice(1)
  : '';
const query = window.location.search?.startsWith('?')
  ? window.location.search.slice(1)
  : '';
const params = new URLSearchParams(frag || query);

const status = params.get('status') || 'error';
const state = params.get('state');
const provider = (params.get('provider') || '').toLowerCase();
const errorCode = params.get('errorCode');
const errorMessage = params.get('errorMessage');

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

const errorMessageByCode = {
  USER_CANCEL: '로그인을 취소하셨습니다.',
  AUTH_TIMEOUT: '인증 시간이 만료되었습니다. 다시 시도해 주세요.',
  INVALID_STATE: '비정상적인 접근입니다.',
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
      }),
    );
  }
} else {
  if (iconEl) {
    iconEl.innerText = '❌';
    iconEl.style.color = '#FF4D4F';
  }
  if (titleEl) titleEl.innerText = '로그인 실패';
  const detail =
    (errorCode && errorMessageByCode[errorCode]) ||
    '인증 처리 중 오류가 발생했습니다.\n다시 시도해주세요.';
  if (messageEl) messageEl.innerText = detail;

  if (window.ReactNativeWebView) {
    const upper = provider ? provider.toUpperCase() : 'SOCIAL';
    window.ReactNativeWebView.postMessage(
      JSON.stringify({
        type: `${upper}_LOGIN_ERROR`,
        provider,
        status: 'error',
        errorCode: errorCode || 'unknown',
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

