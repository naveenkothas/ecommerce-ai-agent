import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/admin/chat/',
  build: {
    outDir: '../public/admin/chat',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: 'index.js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: (info) => {
          if (info.name?.endsWith('.css')) return 'index.css';
          return 'assets/[name]-[hash][extname]';
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
