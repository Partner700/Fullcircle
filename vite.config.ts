import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  // Keep production assets relative to the document. The same verified build
  // can then run at a domain root, a repository subpath, or an emergency CDN
  // mirror without rebuilding or rewriting its asset URLs.
  base: './',
  plugins: [react()],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  build: {
    // Keep the installed app compatible with older Android WebViews and iOS
    // home-screen browsers still used by camp members.
    target: 'es2017',
    // Enable source maps for production debugging (not inlined to avoid large bundles)
    sourcemap: false,
    // Load only the active role workspace. GitHub Pages publishes each branch
    // snapshot atomically, and stale chunk recovery refreshes older clients.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/@supabase')) return 'app-runtime';
          return undefined;
        },
      },
    },
    // Minify with esbuild (faster than terser)
    minify: 'esbuild',
    cssCodeSplit: false,
    // Generate manifest.json for asset tracking
    manifest: true,
  },
  // Enable CSS source maps for development
  css: {
    devSourcemap: true,
  },
});
