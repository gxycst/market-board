import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const buildDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })

export default defineConfig({
  plugins: [vue()],
  define: {
    __BUILD_DATE__: JSON.stringify(buildDate)
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001'
    }
  }
})
