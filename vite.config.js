
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],

  // Required for GitHub Pages
  base: '/GizmoNest/',

  // Local development API proxy
  server: {
    proxy: {
      '/api': 'http://localhost:4000'
    }
  }
})
