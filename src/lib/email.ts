import type { Env } from '../env';

/**
 * Transactional email (login codes, invites, password reset).
 * Provider is chosen by EMAIL_PROVIDER: "resend" or "sendgrid". With no provider
 * configured, email features report "not configured" and the UI falls back to
 * codes the admin hands out (printable slips) — nothing breaks.
 */

export function emailConfigured(env: Env): boolean {
  const p = (env.EMAIL_PROVIDER || '').toLowerCase();
  return (p === 'resend' || p === 'sendgrid') && !!env.EMAIL_API_KEY && !!env.EMAIL_FROM;
}

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export async function sendEmail(env: Env, mail: Mail): Promise<{ ok: boolean; error?: string }> {
  if (!emailConfigured(env)) return { ok: false, error: 'Email is not configured.' };
  const provider = (env.EMAIL_PROVIDER || '').toLowerCase();
  try {
    let res: Response;
    if (provider === 'resend') {
      res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.EMAIL_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: env.EMAIL_FROM,
          to: [mail.to],
          subject: mail.subject,
          text: mail.text,
          html: mail.html,
          ...(env.EMAIL_REPLY_TO ? { reply_to: env.EMAIL_REPLY_TO } : {}),
        }),
      });
    } else {
      res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.EMAIL_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: mail.to }] }],
          from: { email: parseAddress(env.EMAIL_FROM!).email, name: parseAddress(env.EMAIL_FROM!).name || 'Talo' },
          ...(env.EMAIL_REPLY_TO ? { reply_to: { email: env.EMAIL_REPLY_TO } } : {}),
          subject: mail.subject,
          content: [
            { type: 'text/plain', value: mail.text },
            { type: 'text/html', value: mail.html },
          ],
        }),
      });
    }
    if (!res.ok) {
      const body = (await res.text()).slice(0, 200);
      console.error(`email send failed (${res.status}): ${body}`);
      return { ok: false, error: `The email provider rejected the message (${res.status}).` };
    }
    return { ok: true };
  } catch (err) {
    console.error('email send error', err);
    return { ok: false, error: 'Could not reach the email provider.' };
  }
}

function parseAddress(v: string): { name: string; email: string } {
  const m = v.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
  return m ? { name: m[1].trim(), email: m[2].trim() } : { name: '', email: v.trim() };
}

export function maskEmail(e: string): string {
  const [local, domain] = e.split('@');
  if (!domain) return e;
  const shown = local.length <= 2 ? local[0] : local.slice(0, 2);
  return `${shown}${'•'.repeat(Math.max(2, Math.min(6, local.length - shown.length)))}@${domain}`;
}

/* ---------------- templates ---------------- */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function layout(title: string, bodyHtml: string, org: string): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#F7F7F7;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;color:#171717">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F7F7F7;padding:32px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border-radius:16px;border:1px solid #EBEBEB">
<tr><td style="padding:28px 32px 8px 32px;font-size:18px;font-weight:700;letter-spacing:-0.01em">talo <span style="font-weight:500;color:#5C5C5C;font-size:13px">by ${esc(org)}</span></td></tr>
<tr><td style="padding:8px 32px 0 32px"><h1 style="margin:0 0 12px 0;font-size:20px;line-height:1.3;font-weight:600">${esc(title)}</h1></td></tr>
<tr><td style="padding:0 32px 28px 32px;font-size:15px;line-height:1.6;color:#262626">${bodyHtml}</td></tr>
</table>
<p style="font-size:12px;color:#A3A3A3;margin:16px 0 0 0">You received this because your email is registered with ${esc(org)}'s campus hiring assessment.</p>
</td></tr></table></body></html>`;
}

function codeBlock(code: string): string {
  return `<div style="margin:16px 0;padding:14px 18px;background:#F7F7F7;border-radius:12px;font-size:28px;font-weight:700;letter-spacing:0.18em;font-variant-numeric:tabular-nums">${esc(code)}</div>`;
}

function button(href: string, label: string): string {
  return `<p style="margin:20px 0"><a href="${esc(href)}" style="display:inline-block;background:#171717;color:#FFFFFF;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600;font-size:15px">${esc(label)}</a></p>`;
}

export function adminCodeEmail(org: string, name: string, code: string): Omit<Mail, 'to'> {
  return {
    subject: `${code} is your Talo sign-in code`,
    text: `Hi ${name},\n\nYour Talo sign-in code is ${code}. It expires in 10 minutes.\n\nIf you did not try to sign in, change your password and tell your manager.`,
    html: layout('Your sign-in code', `<p style="margin:0">Hi ${esc(name)}, use this code to finish signing in to the Talo admin portal. It expires in 10 minutes.</p>${codeBlock(code)}<p style="margin:0;color:#5C5C5C;font-size:13px">If you did not try to sign in, change your password and tell your manager.</p>`, org),
  };
}

export function candidateOtpEmail(org: string, name: string, code: string): Omit<Mail, 'to'> {
  return {
    subject: `${code} is your assessment sign-in code`,
    text: `Hi ${name},\n\nYour assessment sign-in code is ${code}. It expires in 10 minutes. Do not share it with anyone.`,
    html: layout('Your sign-in code', `<p style="margin:0">Hi ${esc(name)}, enter this code on the assessment page to sign in. It expires in 10 minutes. Do not share it with anyone.</p>${codeBlock(code)}`, org),
  };
}

export function candidateInviteEmail(org: string, name: string, link: string, code: string, extra: { driveName?: string | null; date?: string | null; minutes: number }): Omit<Mail, 'to'> {
  const when = extra.driveName ? `${extra.driveName}${extra.date ? ` on ${extra.date}` : ''}` : 'your campus hiring assessment';
  return {
    subject: `Your ${org} assessment link and access code`,
    text: `Hi ${name},\n\nYou are invited to ${when}. The assessment is ${extra.minutes} minutes long and must be taken on a laptop or desktop in full-screen mode.\n\nAssessment link: ${link}\nYour personal access code: ${code}\n\nKeep this code private: it is linked to you and works only with your email address.`,
    html: layout(`You're invited to ${when}`,
      `<p style="margin:0 0 8px 0">Hi ${esc(name)}, the assessment is ${extra.minutes} minutes long and must be taken on a laptop or desktop, in full-screen mode.</p>
       <p style="margin:12px 0 0 0;color:#5C5C5C;font-size:13px">Your personal access code</p>${codeBlock(code)}
       ${button(link, 'Open the assessment')}
       <p style="margin:0;color:#5C5C5C;font-size:13px">Keep this code private. It is linked to you and only works with your email address.</p>`, org),
  };
}

export function resetEmail(org: string, name: string, link: string): Omit<Mail, 'to'> {
  return {
    subject: 'Reset your Talo password',
    text: `Hi ${name},\n\nReset your password with this link (valid for 30 minutes):\n${link}\n\nIf you did not ask for this, you can ignore this email.`,
    html: layout('Reset your password', `<p style="margin:0">Hi ${esc(name)}, use the button below to choose a new password. The link is valid for 30 minutes.</p>${button(link, 'Choose a new password')}<p style="margin:0;color:#5C5C5C;font-size:13px">If you did not ask for this, you can ignore this email.</p>`, org),
  };
}

export function memberInviteEmail(org: string, name: string, inviter: string, link: string, role: string): Omit<Mail, 'to'> {
  return {
    subject: `${inviter} invited you to Talo`,
    text: `Hi ${name},\n\n${inviter} added you to Talo, ${org}'s campus hiring assessment, as a ${role}. Set your password with this link (valid for 72 hours):\n${link}`,
    html: layout('You have been invited to Talo', `<p style="margin:0">Hi ${esc(name)}, ${esc(inviter)} added you to Talo as a <strong>${esc(role)}</strong>. Set a password to verify your email and sign in. The link is valid for 72 hours.</p>${button(link, 'Set your password')}`, org),
  };
}
