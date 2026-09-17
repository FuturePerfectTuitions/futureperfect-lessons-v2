import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  build: {
    sourcemap: true,
    rollupOptions: {
      external: id => id === './protected-viewer.js' || id.endsWith('/protected-viewer.js'),
      output: {
        entryFileNames: 'assets/portal-[hash].js',
        chunkFileNames: 'assets/portal-[hash].js',
        assetFileNames: 'assets/portal-[hash][extname]'
      }
    }
  }
});
