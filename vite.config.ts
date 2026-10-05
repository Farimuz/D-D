import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': { target: `http://127.0.0.1:${process.env.DND_SERVER_PORT ?? '8787'}`, changeOrigin: false }, '/socket': { target: `ws://127.0.0.1:${process.env.DND_SERVER_PORT ?? '8787'}`, ws: true, changeOrigin: false } } },
  build: { target: ['chrome109', 'edge109', 'firefox115', 'safari16'] },
})
