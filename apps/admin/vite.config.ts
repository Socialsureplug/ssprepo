import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// In development the API is proxied under /api so the session cookie is first-party.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    strictPort: true,
    host: true,
    // Allow access through preview proxies and tunnels in development.
    allowedHosts: true,
    proxy: { '/api': { target: process.env.API_URL ?? 'http://localhost:4000', changeOrigin: false, rewrite: (p) => p.replace(/^\/api/, '') } },
  },
  build: { sourcemap: false, chunkSizeWarningLimit: 900 },
});
