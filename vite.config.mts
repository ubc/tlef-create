import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8092,
    proxy: {
      '/api': {
        target: 'http://localhost:8051',
        changeOrigin: true,
        secure: false,
      }
    }
  },
  plugins: [
    react(),
    mode === 'development' &&
    componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  css: {
    modules: {
      // Enable CSS modules for .module.css files
      localsConvention: 'camelCase',
    },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
}));