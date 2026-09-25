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
    // Опрос вместо подписки на события файловой системы: исходники приходят с
    // тома хозяйской машины, и уведомления об изменениях через границу не
    // доходят — браузер молча отдаёт старый модуль, а правка выглядит
    // непримененной. Проверено 23.09.2026.
    watch: { usePolling: true, interval: 300 },
    // Шлюз платформы шлёт Host приложения из реестра — reference-web
    // (infra/compose.platform.yaml). Vite 6 незнакомому хосту отвечает 403
    // «Blocked request», и за шлюзом экран был бы пустым. Проверено 25.09.2026.
    allowedHosts: ['reference-web'],
    // Запросы к сервису идут по тому же префиксу, что и в платформе за шлюзом.
    proxy: {
      '/reference/api': {
        target: 'http://api:8000',
        changeOrigin: true,
      },
    },
  },
})
