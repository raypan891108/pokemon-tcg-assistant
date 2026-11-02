import { defineConfig } from 'vite';

// In development the page is served by Vite on 5173; forward API calls to the backend
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      // 127.0.0.1, not localhost: the backend listens on IPv4 only, and localhost may resolve to IPv6
      '/api': 'http://127.0.0.1:3001',
    },
  },
});
