/// <reference types="vitest" />
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'packages/template/*'],
    coverage: {
      enabled: true,
      include: ['src/**/*'],
      reporter: ['cobertura', 'text', 'html'],
    },
  },
});
