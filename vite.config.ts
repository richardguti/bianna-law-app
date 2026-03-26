import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

const isPWA = process.env.BUILD_TARGET === 'pwa'

export default defineConfig({
  base: isPWA ? '/bianna-law-app/' : './',
  build: {
    outDir: isPWA ? 'dist-pwa' : 'dist-react',
  },
  plugins: [
    react(),
    tailwindcss(),
    // Strip crossorigin attributes — file:// protocol in Electron doesn't support CORS
    ...(!isPWA ? [{
      name: 'electron-html-fix',
      transformIndexHtml: (html: string) => html.replace(/ crossorigin/g, ''),
    }] : []),
    ...(isPWA ? [VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.png'],
      manifest: {
        name: 'Senior Law Partner',
        short_name: 'Law Partner',
        description: 'AI legal study companion for 1L law students',
        theme_color: '#1a1a2e',
        background_color: '#0f0f1a',
        display: 'standalone',
        orientation: 'any',
        scope: '/bianna-law-app/',
        start_url: '/bianna-law-app/',
        icons: [
          { src: 'icon.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
            handler: 'NetworkFirst',
            options: { cacheName: 'supabase-cache', networkTimeoutSeconds: 10 },
          },
        ],
      },
    })] : []),
  ],
})
