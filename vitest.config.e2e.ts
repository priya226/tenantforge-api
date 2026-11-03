import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // e2e files share one database and reset it, so they must not run at the same time
    fileParallelism: false,
    env: { DB_NAME: 'tenantforge_test' },
  },
});
