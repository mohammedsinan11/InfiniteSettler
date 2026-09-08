import { defineConfig } from 'vite';

// GitHub Project Pages liegen unter /<repo>/, nicht unter /.
// Im Dev-Server soll die Basis '/' bleiben.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/InfiniteSettler/' : '/',
  build: {
    target: 'es2022',
    outDir: 'dist',
    // Grafiken NIE als base64 ins Skript einbetten.
    //
    // Vite bettet Dateien unter 4 KiB standardmaessig ein. Von den 82 PNGs
    // liegen 65 darunter, wodurch der Bundle von 31 auf 322 KiB wuchs. Das
    // hat drei Nachteile: das Spiel laedt alle Texturen, bevor die erste
    // Zeile Code laeuft; der Browser kann sie nicht getrennt vom Code
    // cachen, also werden sie bei jeder Codeaenderung neu uebertragen; und
    // base64 ist rund 37 % groesser als die Binaerform.
    assetsInlineLimit: 0,
  },
}));
