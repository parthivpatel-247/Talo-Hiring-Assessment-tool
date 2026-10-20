import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { env, fetchMock } from 'cloudflare:test';
import { migrate, req, adminCookie, openAiReply } from './helpers';
import { extractResumeText } from '../src/lib/resume';
import { MAILTO_ONLY_PDF_B64, NO_EMAIL_PDF_B64 } from './fixtures/resumes';

function bytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function upload(id: string, b64: string) {
  await env.RESUMES.put(`resumes/${id}.pdf`, bytes(b64));
  await env.DB.prepare(
    "INSERT INTO candidates (id, email, resume_r2_key, resume_filename, status) VALUES (?, ?, ?, ?, 'uploaded')"
  ).bind(id, `pending+${id}@unresolved.local`, `resumes/${id}.pdf`, `${id}.pdf`).run();
}

function mockParse(result: unknown) {
  fetchMock.get('https://api.openai.com')
    .intercept({ path: '/v1/chat/completions', method: 'POST' })
    .reply(200, openAiReply(result));
}

async function processAll() {
  const admin = await adminCookie();
  const res = await req('/api/admin/resumes/process', { method: 'POST', headers: { Cookie: admin } });
  expect(res.status).toBe(200);
  return res.json<any>();
}

async function row(id: string) {
  return env.DB.prepare('SELECT email, name, status FROM candidates WHERE id = ?').bind(id).first<any>();
}

describe('resume parsing — email hidden behind a "Mail" link', () => {
  beforeEach(async () => { await migrate(); fetchMock.activate(); fetchMock.disableNetConnect(); });
  afterEach(() => { try { fetchMock.assertNoPendingInterceptors(); } catch {} });

  it('extractResumeText includes mailto: link targets that are not in the visible text', async () => {
    const text = await extractResumeText(bytes(MAILTO_ONLY_PDF_B64).buffer as ArrayBuffer);
    expect(text).toContain('ASHA KULKARNI');
    expect(text).toContain('asha.k@college.edu');
  });

  it('a resume whose email exists only as a link is parsed and made ready', async () => {
    await upload('m1', MAILTO_ONLY_PDF_B64);
    mockParse({ name: 'Asha Kulkarni', email: 'asha.k@college.edu', skills: ['Python'], projects: [] });
    await processAll();
    const r = await row('m1');
    expect(r.status).toBe('part2_ready');
    expect(r.email).toBe('asha.k@college.edu');
    expect(r.name).toBe('Asha Kulkarni');
  });

  it('never trusts an invented email/name: uses the real address from the resume and drops "John Doe"', async () => {
    await upload('m2', MAILTO_ONLY_PDF_B64);
    mockParse({ name: 'John Doe', email: 'johndoe@example.com', skills: [], projects: [] });
    await processAll();
    const r = await row('m2');
    expect(r.email).toBe('asha.k@college.edu'); // from the resume, not the AI's invention
    expect(r.name).toBeNull();                   // "John Doe" isn't in the resume
    expect(r.status).toBe('part2_ready');
  });

  it('no email anywhere: marked parse_failed but the name is still saved for "Fix email"', async () => {
    await upload('n1', NO_EMAIL_PDF_B64);
    mockParse({ name: 'Asha Kulkarni', email: null, skills: ['SQL'], projects: [] });
    const out = await processAll();
    const r = await row('n1');
    expect(r.status).toBe('parse_failed');
    expect(r.name).toBe('Asha Kulkarni');
    expect(String(out.processed[0].error)).toMatch(/Fix email/);
  });

  it('no email anywhere and the AI invents one: still parse_failed, the invented address is never used', async () => {
    await upload('n2', NO_EMAIL_PDF_B64);
    mockParse({ name: 'Asha Kulkarni', email: 'johndoe@example.com', skills: [], projects: [] });
    await processAll();
    const r = await row('n2');
    expect(r.status).toBe('parse_failed');
    expect(r.email).not.toBe('johndoe@example.com');
  });
});
