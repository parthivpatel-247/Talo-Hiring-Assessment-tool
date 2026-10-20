import type { Router } from '../router';
import { json, readJson, str, email as emailField, oneOf, bad } from '../lib/http';
import { getSettings, paperTotal } from '../lib/settings';
import { emailConfigured } from '../lib/email';
import { turnstileEnabled, verifyTurnstile } from '../lib/turnstile';
import { enforce } from '../lib/ratelimit';
import { ANALYTICS_EVENTS, recordError, track } from '../lib/telemetry';
import { LANGUAGES } from '../lib/exam';
import { newId } from '../db/db';

export function registerPublic(r: Router): void {
  r.add('GET', '/api/health', 'public', async () => json({ ok: true, time: new Date().toISOString() }));

  // Pre-login configuration for the candidate and admin sign-in pages. No candidate data.
  r.add('GET', '/api/public/config', 'public', async (ctx) => {
    const s = await getSettings(ctx.env, ctx.db);
    return json({
      orgName: s.orgName,
      contactEmail: s.contactEmail || null,
      assessmentMinutes: s.assessmentMinutes,
      questionCount: paperTotal(s),
      retentionDays: s.retentionDays,
      emailEnabled: emailConfigured(ctx.env),
      turnstileEnabled: turnstileEnabled(ctx.env),
      wordLimit: s.wordLimit,
      awayGraceSeconds: s.awayGraceSeconds,
      requireFullscreenDevice: s.requireFullscreenDevice,
      loginMode: s.loginMode === 'otp' && !emailConfigured(ctx.env) ? 'code' : s.loginMode,
      turnstileSiteKey: turnstileEnabled(ctx.env) ? ctx.env.TURNSTILE_SITE_KEY : null,
      languages: LANGUAGES,
      year: new Date().getUTCFullYear(),
    });
  });

  // First-party, cookieless page/event counter (aggregated per day; no personal data).
  r.add('POST', '/api/public/event', 'public', async (ctx) => {
    await enforce(ctx.db, `ev:${ctx.ip}`, 120, 600);
    const body = await readJson(ctx.request, 2048);
    const event = str(body, 'event', { max: 40 });
    if (!ANALYTICS_EVENTS.has(event) || !event.startsWith('view_')) throw bad('Unknown event.');
    const path = str(body, 'path', { max: 120, optional: true }).replace(/[?#].*$/, '');
    await track(ctx.db, event, path);
    return json({ ok: true });
  });

  // Error tracking for the browser apps.
  r.add('POST', '/api/public/client-error', 'public', async (ctx) => {
    await enforce(ctx.db, `cerr:${ctx.ip}`, 30, 600);
    const body = await readJson(ctx.request, 16 * 1024);
    await recordError(ctx.db, {
      surface: oneOf(body, 'surface', ['candidate', 'admin', 'public'] as const) ?? 'public',
      message: str(body, 'message', { max: 500 }),
      source: str(body, 'source', { max: 300, optional: true }),
      stack: str(body, 'stack', { max: 4000, optional: true, trim: false }),
      url: str(body, 'url', { max: 300, optional: true }).replace(/[?#].*$/, ''),
      userAgent: ctx.ua,
    });
    return json({ ok: true });
  });

  // Privacy page: request deletion of / access to / correction of personal data.
  r.add('POST', '/api/public/data-request', 'public', async (ctx) => {
    await enforce(ctx.db, `dreq:${ctx.ip}`, 5, 3600);
    const body = await readJson(ctx.request, 8 * 1024);
    await verifyTurnstile(ctx.env, body.turnstileToken, ctx.ip);
    const email = emailField(body);
    const kind = oneOf(body, 'kind', ['deletion', 'access', 'correction'] as const)!;
    const message = str(body, 'message', { max: 2000, optional: true });
    await ctx.db.run('INSERT INTO data_requests (id, email, kind, message) VALUES (?, ?, ?, ?)', newId('dr'), email, kind, message || null);
    return json({ ok: true, message: 'Thanks. Your request has been recorded and the hiring team will reply by email within 30 days.' });
  });
}
