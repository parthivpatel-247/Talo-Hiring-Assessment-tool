import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

// Free-plan budget check (npm run test:limits). Runs a whole 100-candidate drive
// through the writers site in one shared database, so storage is NOT isolated
// per test here: each step builds on the previous one.
export default defineWorkersConfig({
  test: {
    include: ['test-limits/**/*.test.ts'],
    poolOptions: {
      workers: {
        isolatedStorage: false,
        singleWorker: true,
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
            COLLEGES: 'College A',
          },
        },
      },
    },
  },
});
