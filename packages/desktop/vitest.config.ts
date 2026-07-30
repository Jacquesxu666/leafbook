import { defineConfig } from 'vitest/config'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['test/unit/specs/**/*.spec.ts'],
    globals: true
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src'),
      'leafbook-muya-heading-analyzer': resolve(__dirname, '../muya/src/state/analyzeHeadings.ts'),
      common: resolve(__dirname, 'src/common'),
      muya: resolve(__dirname, '../muyajs'),
      '@shared': resolve(__dirname, 'src/shared'),
      main_renderer: resolve(__dirname, 'src/main')
    },
    extensions: ['.mjs', '.ts', '.js', '.json']
  }
})
