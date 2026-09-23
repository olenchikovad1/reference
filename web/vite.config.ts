import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Приложение живёт под своим сегментом пути и в корне не располагается никогда.
// В разработке префикс тот же, что в бою, — иначе зашитый корень обнаружится
// только после выкладки.
const BASE = '/reference/'

export default defineConfig({
  base: BASE,
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    // Запросы к сервису идут по тому же префиксу, что и в платформе за шлюзом.
    proxy: {
      '/reference/api': {
        target: 'http://api:8000',
        changeOrigin: true,
      },
    },
  },
})
