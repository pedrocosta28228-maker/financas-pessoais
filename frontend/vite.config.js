import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// O "proxy" redireciona qualquer chamada "/api/..." do React (porta 5173)
// automaticamente para o nosso servidor Node.js (porta 3001).
export default defineConfig({
  plugins: [react()],
  build: {
    // Nunca publicar mapas do código-fonte original (.map) em produção
    sourcemap: false,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
});
