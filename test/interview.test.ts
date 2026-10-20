import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { env, fetchMock } from 'cloudflare:test';
import { migrate, req, adminCookie, seedQuestions, openAiReply } from './helpers';

// Isolated file so the grading suite's persisted OpenAI interceptor can't leak in.
describe('interview questions (personalised, with model answers)', () => {
  beforeEach(async () => { await migrate(); await seedQuestions(); fetchMock.activate(); fetchMock.disableNetConnect(); });
  afterEach(() => { try { fetchMock.assertNoPendingInterceptors(); } catch {} });

  it('generates project/skill-based questions with model answers, from the latest attempt', async () => {
    await env.DB.prepare(
      "INSERT INTO candidates (id,email,name,resume_r2_key,status,skills,projects) VALUES ('iv','iv@x.com','IV','resumes/iv.pdf','evaluated',?,?)"
    ).bind(
      JSON.stringify(['Python', 'SQL', 'Node JS']),
      JSON.stringify([{ name: 'CloudRail', description: 'AWS railway ticket booking', technologies: ['Node.js', 'MySQL'] }])
    ).run();

    fetchMock.get('https://api.openai.com').intercept({ path: '/v1/chat/completions', method: 'POST' })
      .reply(200, openAiReply({ questions: [
        { question: 'In CloudRail, why did you choose MySQL over a NoSQL store?', model_answer: 'A strong answer weighs relational integrity vs scale and names when NoSQL would be better.', follow_up: 'How would you shard it?', based_on: 'CloudRail' },
      ] })).persist();

    const admin = await adminCookie();
    const res = await req('/api/admin/candidates/iv/interview', { method: 'POST', headers: { Cookie: admin } });
    expect(res.status).toBe(200);
    expect((await res.json<any>()).count).toBeGreaterThanOrEqual(1);

    const row = await env.DB.prepare("SELECT question, model_answer, based_on FROM interview_questions WHERE candidate_id='iv'").first<any>();
    expect(row.model_answer).toContain('strong answer');
    expect(row.based_on).toBe('CloudRail');

    const detail = await (await req('/api/admin/candidates/iv', { headers: { Cookie: admin } })).json<any>();
    expect(detail.interviewQuestions[0].model_answer).toBeTruthy();
  });
});
