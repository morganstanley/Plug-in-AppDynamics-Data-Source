import { defineConfig } from 'eslint/config';
import baseConfig from './.config/eslint.config.mjs';

export default defineConfig([
  { ignores: ['dist/**', 'coverage/**', 'playwright-report/**', 'test-results/**'] },
  ...baseConfig,
]);
