import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_PORT = process.env.API_PORT || 3001;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // ── Proxy API calls to Express server ─────────────────────────────────────
    // During dev, /api/* requests go to localhost:3001 automatically.
    // No need for hardcoded URLs in frontend components.
    proxy: {
      '/api': {
        target: `http://localhost:${API_PORT}`,
        changeOrigin: true,
        rewrite: (path) => path,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: {
          react:    ['react','react-dom'],
          charting: ['lightweight-charts'],
        },
      },
    },
  },
  define: {
    // VITE_API_BASE_URL: override in .env for non-localhost deployments
    // e.g.  VITE_API_BASE_URL=https://api.myserver.com
    '__API_BASE__': JSON.stringify(
      process.env.VITE_API_BASE_URL || ''
    ),
  },
});
