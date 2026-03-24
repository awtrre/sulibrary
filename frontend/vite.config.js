import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        runtimeCaching: [
          {
            // 👇 核心修改：去掉开头的限制，只要 URL 包含 /api/static/books/ 统统拦截
            urlPattern: /.*\/api\/static\/books\/.*/i,
            // 👇 改用 StaleWhileRevalidate，容错率更高
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'epub-chapters-cache',
              expiration: {
                maxEntries: 5000, 
                maxAgeSeconds: 60 * 60 * 24 * 30, // 保留 30 天
              },
              cacheableResponse: {
                // 👇 核心修改：增加 206 状态码（非常重要，解决分块传输不缓存的问题）
                statuses: [0, 200, 206]
              }
            }
          }
        ]
      }
    })
  ],
})
