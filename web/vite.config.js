import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const dir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: dir,
  plugins: [react()],
  server: {
    port: 5173,
    host: '127.0.0.1',
    watch: {
      // 编辑器保存时会先写临时目录再改名，Windows 上会让 watcher 抛 EBUSY
      ignored: ['**/.*tmpdir/**', '**/*.tmp', '**/node_modules/**', '**/server/data/**'],
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: path.join(dir, 'dist'),
    emptyOutDir: true,
  },
})
