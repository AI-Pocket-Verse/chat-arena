import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5040,
    proxy: {
      '/api': { target: 'http://localhost:4040', changeOrigin: true },
      '/ws': { target: 'ws://localhost:4040', ws: true },
    },
  },
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
})
