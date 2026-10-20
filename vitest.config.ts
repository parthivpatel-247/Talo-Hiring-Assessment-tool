import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

// Runs tests INSIDE the real Workers runtime (workerd) with a real in-memory
// D1 and R2, driving the actual Worker in src/index.ts. Secrets that live
// outside wrangler.toml are injected here for the test environment only.
export default defineWorkersConfig({
  test: {
    include: ['test/**/*.test.ts'],
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          bindings: {
            ADMIN_EMAIL: 'admin@test.local',
            ADMIN_PASSWORD: 'test-admin-pass',
            PANEL_EMAIL: 'panel@test.local',
            PANEL_PASSWORD: 'test-panel-pass',
            SESSION_SECRET: 'test-session-secret-0123456789abcdef',
            OPENAI_API_KEY: 'test-openai-key',
            OPENAI_MODEL: 'gpt-4o-mini',
            COLLEGES: 'College Name 1,College Name 2,College Name 3,College Name 4',
          },
        },
      },
    },
  },
});
