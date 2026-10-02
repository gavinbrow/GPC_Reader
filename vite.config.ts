/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base: './'` keeps the build relocatable so it can be hosted from any
// sub-path (GitHub Pages, a file share, an intranet server, ...).
export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 60000,
  },
});
