import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { fileURLToPath } from 'url'

// Resolve paths relative to this config file so the build works from any cwd.
// vite.config.ts lives in  jsons/
// React source lives in    jsons/../src/
// index.html lives in      jsons/index.html
// Output goes to           jsons/dist-react/     (the folder the packager reads)
const configDir  = path.dirname(fileURLToPath(import.meta.url)) // …/jsons
const projectRoot = path.resolve(configDir, '..')               // …/Bianna-Law-Final

export default defineConfig(({ mode }) => {
  // ─── Environment loading ────────────────────────────────────────────────────
  // Vite reads env from exactly ONE directory (`envDir`). It was pointed at the project
  // root so CI had one predictable place to write .env.local -- and that silently
  // stopped Vite from ever reading jsons/.env, which is where the Supabase values
  // actually lived. VITE_SUPABASE_URL therefore inlined as `void 0`, so the bundle
  // contained `createClient(void 0, void 0)`; supabase-js throws "supabaseUrl is
  // required." while the bundle is still being evaluated, React never mounted, and the
  // window stayed white. did-finish-load and ready-to-show both still fired, which is
  // why every renderer-liveness check reported success on a blank app.
  //
  // Merging BOTH directories removes that whole class of failure: a value placed in
  // either location is now honoured. The root wins, because that is the file CI writes.
  const fromJsons = loadEnv(mode, configDir,   'VITE_')
  const fromRoot  = loadEnv(mode, projectRoot, 'VITE_')
  const env = { ...fromJsons, ...fromRoot }

  // Vite folds VITE_-prefixed process.env entries into import.meta.env, so seeding
  // process.env is sufficient. No hand-rolled `define` is used: a manual
  // `import.meta.env.X` define can collide with Vite's own replacement of
  // import.meta.env and produce output neither side intended.
  for (const [key, value] of Object.entries(env)) {
    if (value && !process.env[key]) process.env[key] = value
  }

  // A warning, not a failure. The app is designed to boot and save locally without
  // Supabase (see src/lib/supabase.ts), so a missing key degrades a feature rather than
  // breaking the build. CI fails hard instead: build-mac.yml asserts that the packaged
  // bundle contains a Supabase host, so a broken Vault cannot be released silently.
  const REQUIRED = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']
  const missing = REQUIRED.filter((key) => !env[key])
  if (missing.length) {
    console.warn(
      '[vite] not configured: ' + missing.join(', ') +
      ' -- the renderer will boot without cloud sync and the Vault will save locally.',
    )
  }

  return {
    root: configDir,                   // Vite root = jsons/ (where index.html lives)
    base: './',
    // Kept so CI has the one documented place to write .env.local; jsons/.env is now
    // additionally merged above.
    envDir: projectRoot,
    resolve: {
      alias: {
        // Allow /src/... imports in index.html to resolve from the parent src/ dir
        '/src': path.resolve(projectRoot, 'src'),
      },
    },
    build: {
      // jsons/dist-react, NOT ../dist-react.
      //
      // electron-builder resolves `files` relative to the app dir (jsons/), so it packages
      // jsons/dist-react; main.js loads <__dirname>/dist-react, which is that same folder
      // both in the dev tree and inside app.asar. Writing to ../dist-react meant the
      // compiler and the packager disagreed about where the renderer lived, and CI hid the
      // disagreement with a `cp -R`. The cost was invisible and severe: every local
      // `electron-builder --dir` packaged whatever stale bundle happened to sit in
      // jsons/dist-react, so a Windows test run "passed" on a bundle that contained the
      // Supabase URL while the shipped artifact -- staged by CI from an unconfigured build
      // -- did not, and opened a white window. One tree, no copy step, nothing to go stale.
      outDir: path.resolve(configDir, 'dist-react'),
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
  }
})
