import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  /* Set from day one rather than when Pages is switched on. Getting this wrong
     later shows up as the optimizer worker 404-ing in production while working
     perfectly in dev, which is a miserable thing to debug at milestone 6. */
  base: '/roomarr/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
