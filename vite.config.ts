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
    // Chunk splitting strategy
    rollupOptions: {
      output: {
        manualChunks: {
          // React core
          'react-vendor': ['react', 'react-dom'],
          // Supabase
          supabase: ['@supabase/supabase-js'],
          // UI icons
          icons: ['lucide-react'],
        },
      },
    },
    // Minify with esbuild (faster than terser)
    minify: 'esbuild',
    // CSS code splitting
    cssCodeSplit: true,
    // Generate manifest.json for asset tracking
    manifest: true,
  },
  // Enable CSS source maps for development
  css: {
    devSourcemap: true,
  },
});