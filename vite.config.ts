import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  build: {
    // Enable source maps for production debugging (not inlined to avoid large bundles)
    sourcemap: false,
    // Shared hosting can publish index.html before every split chunk arrives.
    // Keep the executable application together so a loaded dashboard always
    // has every workspace required by that release.
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
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
