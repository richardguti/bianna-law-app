import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { fileURLToPath } from 'url'

// Resolve paths relative to this config file so the build works from any cwd.
// vite.config.ts lives in  jsons/
// React source lives in    jsons/../src/
// index.html lives in      jsons/index.html
// Output goes to           jsons/../dist-react/   (sibling of src/)
const configDir = path.dirname(fileURLToPath(import.meta.url)) // …/jsons
const projectRoot = path.resolve(configDir, '..')               // …/Bianna-Law-Final

export default defineConfig({
  root: configDir,                   // Vite root = jsons/ (where index.html lives)
  base: './',
  // Secrets live in .env.local at the project root (gitignored), not in jsons/,
  // so local builds and CI have one predictable place to put them.
  envDir: projectRoot,
  resolve: {
    alias: {
      // Allow /src/... imports in index.html to resolve from the parent src/ dir
      '/src': path.resolve(projectRoot, 'src'),
    },
  },
  build: {
    outDir: path.resolve(projectRoot, 'dist-react'),
    emptyOutDir: true,
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
