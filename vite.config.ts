import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist-react',
  },
  plugins: [
    react(),
    tailwindcss(),
    // Strip crossorigin attributes — file:// protocol in Electron doesn't support CORS
    {
      name: 'electron-html-fix',
      transformIndexHtml: (html: string) => html.replace(/ crossorigin/g, ''),
    },
  ],
})
