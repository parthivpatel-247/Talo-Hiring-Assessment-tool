import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

// Tests run inside the real Workers runtime (workerd) with an in-memory D1 and R2,
// driving the actual Worker in src/index.ts. Secrets are injected for tests only.
export default defineWorkersConfig({
  test: {
    include: ['test/**/*.test.ts'],
    poolOptions: {
      workers: {
        singleWorker: true,
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          bindings: {
            ENVIRONMENT: 'test',
            APP_ORIGIN: 'https://test.local',
            ADMIN_EMAIL: 'admin@test.local',
            ADMIN_PASSWORD: 'bootstrap-setup-pass',
            SESSION_SECRET: 'test-session-secret-0123456789abcdef',
            OPENAI_API_KEY: 'test-openai-key',
            OPENAI_MODEL: 'gpt-4o-mini',
            EMAIL_PROVIDER: '',
            EMAIL_FROM: '',
            TURNSTILE_SITE_KEY: '',
          },
        },
      },
    },
  },
});
