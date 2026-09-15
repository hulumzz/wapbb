import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Jangan memuat `.env` backend dari root monorepo. Vite memperlakukan
  // NODE_ENV secara khusus dan frontend hanya membutuhkan variabel VITE_*.
  envDir: '.',
  server: {
    port: 5173,
  },
})
