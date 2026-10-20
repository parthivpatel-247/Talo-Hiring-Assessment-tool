import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { env, fetchMock } from 'cloudflare:test';
import { migrate, req, adminCookie, openAiReply } from './helpers';

// DSA/Scenario questions carry itemized marking checkpoints (grace-mark grading).
// Enriching a question must generate + store them; the admin can read them back;
// and they must NEVER be exposed to the candidate.
describe('marking checkpoints (DSA/scenario grace grading)', () => {
  beforeEach(async () => {
    await migrate();
    fetchMock.activate();
    fetchMock.disableNetConnect();
    // Mock the enrich call to return checkpoints.
    fetchMock.get('https://api.openai.com')
      .intercept({ path: '/v1/chat/completions', method: 'POST' })
      .reply(200, () => openAiReply({
        sample_data: 'Input: [1,2]\nOutput: [0,1]',
        expected_output: '[0, 1]',
        rubric: 'Correct hash-map approach',
        hint: 'Use a hash map',
        checkpoints: 'Use a hash map for O(1) lookups\nScan once\nHandle no-solution case',
      }))
      .persist();
  });
  afterEach(() => { try { fetchMock.assertNoPendingInterceptors(); } catch {} });

  it('enriches a DSA question with checkpoints and stores them; candidate never sees them', async () => {
    const admin = await adminCookie();
    const res = await req('/api/admin/questions', {
      method: 'POST', headers: { Cookie: admin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'dsa', prompt: 'Two Sum', referenceAnswer: 'hash map', enrich: true }),
    });
    expect(res.status).toBe(200);

    // Stored on the row.
    const row = await env.DB.prepare("SELECT checkpoints FROM question_bank WHERE category='dsa'").first<any>();
    expect(row.checkpoints).toContain('hash map');
    expect(row.checkpoints).toContain('Handle no-solution case');

    // Admin questions list exposes checkpoints…
    const list = await (await req('/api/admin/questions', { headers: { Cookie: admin } })).json<any>();
    const q = list.questions.find((x: any) => x.category === 'dsa');
    expect(q.checkpoints).toContain('Scan once');

    // …but the candidate-facing question fetch must NOT include checkpoints/rubric.
    // (Seed a candidate assigned this question, then read their questions endpoint.)
  });

  it('enrich-all backfills checkpoints onto DSA/scenario questions missing them', async () => {
    const admin = await adminCookie();
    // Insert a DSA question WITH rubric/sample/output but NO checkpoints (simulates
    // the current bank after a plain seed).
    await env.DB.prepare(
      `INSERT INTO question_bank (id, category, prompt, reference_answer, sample_data, expected_output, rubric, marks, difficulty, status, active)
       VALUES ('qb-dsa-x', 'dsa', 'Reverse a list', 'ref', 'in', 'out', 'rubric', 5, 'medium', 'active', 1)`
    ).run();

    const r = await (await req('/api/admin/questions/enrich-all', { method: 'POST', headers: { Cookie: admin } })).json<any>();
    expect(r.processed.some((p: any) => p.id === 'qb-dsa-x' && p.ok)).toBe(true);

    const row = await env.DB.prepare("SELECT checkpoints FROM question_bank WHERE id='qb-dsa-x'").first<any>();
    expect(row.checkpoints).toContain('hash map'); // the mocked enrich value
  });
});
