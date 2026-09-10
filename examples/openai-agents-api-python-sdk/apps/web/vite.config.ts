import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import viteTsConfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [
    viteTsConfigPaths({ projects: ['./tsconfig.json'] }),
    tailwindcss(),
    tanstackRouter(),
    // React Compiler: auto-memoizes components/hooks at build time. Rules of
    // React violations make it skip a component (bail out), never miscompile.
    viteReact({
      babel: { plugins: [['babel-plugin-react-compiler', {}]] },
    }),
  ],
  server: {
    port: 3000,
    // Backend contract lives at openapi/openapi.yaml; the Flask app serves it
    // on PORT (default 8000). Same-origin in dev via this proxy — no CORS.
    proxy: {
      '/api': `http://127.0.0.1:${process.env.BACKEND_PORT ?? '8000'}`,
    },
  },
})
