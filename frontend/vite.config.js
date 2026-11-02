import { defineConfig } from 'vite';

// In development the page is served by Vite on 5173; forward API calls to the backend
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
