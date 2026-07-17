export const AUTH_EXPIRED_EVENT = 'tlef:auth-expired';

export function notifyAuthExpired(): void {
  window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
}
