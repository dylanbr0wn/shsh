import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:34115',
    headless: true,
  },
  // Don't auto-start webServer — wails dev must be running manually or via CI script
})
