import { toHex, safeEqual } from './security';

/**
 * PBKDF2-SHA256 password hashing (100,000 iterations: the Workers runtime cap).
 * Policy follows NIST 800-63B: length over composition, block common and
 * context-specific passwords.
 */
export const PBKDF2_ITERATIONS = 100_000;
export const MIN_PASSWORD_LENGTH = 12;

function hexToBytes(h: string): Uint8Array {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}

export async function hashPassword(password: string, saltHex?: string, iterations = PBKDF2_ITERATIONS): Promise<{ salt: string; hash: string; iterations: number }> {
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256);
  return { salt: toHex(salt), hash: toHex(bits), iterations };
}

export async function verifyPassword(password: string, saltHex: string | null, hashHex: string | null, iterations = PBKDF2_ITERATIONS): Promise<boolean> {
  if (!saltHex || !hashHex) {
    // Spend comparable time so "no such user" and "wrong password" take as long.
    await hashPassword(password);
    return false;
  }
  const { hash } = await hashPassword(password, saltHex, iterations);
  return safeEqual(hash, hashHex);
}

const COMMON = new Set([
  'password', 'password1', 'password123', '123456789012', 'qwertyuiop12', 'iloveyou1234', 'admin1234567', 'welcome12345',
  'letmein12345', 'changeme1234', 'hevodata1234', 'talo12345678', 'qwerty123456', '111111111111', 'abcdefghijkl',
]);

/** Returns an error message, or null when the password is acceptable. */
export function passwordProblem(password: string, context: { email?: string; name?: string } = {}): string | null {
  if (typeof password !== 'string') return 'Enter a password.';
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > 128) return 'Use at most 128 characters.';
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return 'That password is too common. Choose something less predictable.';
  if (/^(.)\1+$/.test(password)) return 'Do not repeat a single character.';
  const local = (context.email || '').split('@')[0].toLowerCase();
  if (local.length >= 4 && lower.includes(local)) return 'Do not include your email address in the password.';
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length;
  if (classes < 2 && password.length < 16) return 'Mix letters with numbers or symbols, or use 16+ characters.';
  return null;
}
