import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The dashboard calls the backend at :4000. This proxy lets the frontend
// use same-origin "/api/..." URLs in dev (no CORS headaches).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
})
