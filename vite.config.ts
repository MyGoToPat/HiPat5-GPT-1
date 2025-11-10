import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'deployment-lock-check',
      buildStart() {
        const unlockFile = path.join(__dirname, 'DEPLOY_UNLOCKED');
        const isUnlocked = existsSync(unlockFile) || process.env.VITE_DEPLOYMENT_UNLOCKED === 'true';

        if (!isUnlocked) {
          const message = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ⚠️  DEPLOYMENT LOCKED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

This build is locked to prevent accidental deployments.

To unlock (choose one):
  1. Create empty file: touch DEPLOY_UNLOCKED
  2. Or set env var: export VITE_DEPLOYMENT_UNLOCKED=true

Then run: npm run build

Why? Manual unlock prevents CI/CD from deploying
incomplete code during development sprints.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          `.trim();
          console.error('\n' + message + '\n');
          throw new Error('DEPLOYMENT_LOCKED');
        }
      }
    }
  ],
  server: { port: 5176, strictPort: true },
  preview: { port: 5176, strictPort: true },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});
