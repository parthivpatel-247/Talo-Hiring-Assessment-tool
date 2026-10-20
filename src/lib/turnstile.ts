import type { Env } from '../env';
import { HttpError } from './http';

/** Cloudflare Turnstile (privacy-friendly CAPTCHA) on the public sign-in forms. */
export function turnstileEnabled(env: Env): boolean {
  return !!(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET);
}

export async function verifyTurnstile(env: Env, token: unknown, ip: string): Promise<void> {
  if (!turnstileEnabled(env)) return;
  if (typeof token !== 'string' || !token || token.length > 2048) {
    throw new HttpError(400, 'Please complete the security check.', 'captcha_required');
  }
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET!);
  form.append('response', token);
  form.append('remoteip', ip);
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
    const data = (await res.json()) as { success?: boolean };
    if (!data.success) throw new HttpError(400, 'The security check failed. Please try again.', 'captcha_failed');
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(503, 'The security check is unavailable. Please try again in a moment.', 'captcha_unavailable');
  }
}
