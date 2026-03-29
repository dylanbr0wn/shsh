import path from 'path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Map wailsjs imports to committed stubs so tests work without wails generate
      '../wailsjs': path.resolve(__dirname, './src/test/wailsjs-stubs'),
      '../../wailsjs': path.resolve(__dirname, './src/test/wailsjs-stubs'),
      '../../../wailsjs': path.resolve(__dirname, './src/test/wailsjs-stubs'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    globals: true,
  },
})
