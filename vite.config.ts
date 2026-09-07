import { defineConfig } from 'vite';

// GitHub Project Pages liegen unter /<repo>/, nicht unter /.
// Im Dev-Server soll die Basis '/' bleiben.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/InfiniteSettler/' : '/',
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
}));
