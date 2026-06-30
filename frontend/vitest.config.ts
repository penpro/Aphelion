import { defineConfig } from 'vitest/config'

// Unit tests for the app's pure logic (prompt building, JSON extraction, sampler mapping,
// model-name cleanup, code-fence stripping). Node environment — no DOM/Tauri needed.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
