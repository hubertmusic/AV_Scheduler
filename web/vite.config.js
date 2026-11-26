import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the API runs on :4000; nginx does this proxying in Docker.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
      '/cal': 'http://localhost:4000',
    },
  },
});
