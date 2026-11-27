import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// Dev-only: POST /__save?name=x.png with a PNG body writes it to ./captures (used by ?capture=1)
export default defineConfig({
  build: { rollupOptions: { input: { main: 'index.html', studio: 'studio.html' } } },
  plugins: [{
    name: 'save-captures',
    configureServer(server) {
      server.middlewares.use('/__save', (req, res) => {
        const name = path.basename(new URL(req.url, 'http://x').searchParams.get('name') || 'capture.png');
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          fs.mkdirSync('captures', { recursive: true });
          fs.writeFileSync(path.join('captures', name), Buffer.concat(chunks));
          res.end('ok');
        });
      });
    },
  }],
});
