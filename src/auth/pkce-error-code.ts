export const PKCE_ERROR_CODES = [
  'USER_CANCEL',
  'AUTH_TIMEOUT',
  'INVALID_REQUEST',
  'INVALID_STATE',
  'EMAIL_CONFLICT',
  'PKCE_VERIFY_FAIL',
  'INTERNAL_ERROR',
] as const;

export type PkceErrorCode = (typeof PKCE_ERROR_CODES)[number];

export function isPkceErrorCode(value: unknown): value is PkceErrorCode {
  return (
    typeof value === 'string' &&
    (PKCE_ERROR_CODES as readonly string[]).includes(value)
  );
}
