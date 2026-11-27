import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

/*
 * Dev-only "add to closet" API (runs on your Mac; the Gemini key never reaches the page).
 *   POST /api/garment/preview { url }  → product name, photo, guessed slot, already-owned?
 *   POST /api/garment/add     { url, name, image, slot } → try-on (Gemini, billed) + cutout
 * Nothing is generated until /add is called, which the page only does after you click Add.
 */
const ROOT = process.cwd();
const PY = path.join(ROOT, '.venv/bin/python');
const CLOSET = path.join(ROOT, 'public/closet/closet.json');
const BASE = path.join(ROOT, 'captures/base-v3.png');
const BASE_CUTOUT = path.join(ROOT, 'captures/base-v3-cutout.png');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Safari/537.36';

const SLOT_WORDS = {
  shoes: /\b(sneakers?|shoes?|boots?|loafers?|sandals?|heels?|mules?|flats?|slippers?|trainers?|clogs?)\b/i,
  bottom: /\b(jeans|pants|trousers|joggers|sweatpants|skirts?|shorts|slacks|leggings|denim|cargos?|culottes)\b/i,
  top: /\b(t-?shirts?|tees?|tops?|shirts?|blouses?|knits?|sweaters?|cardigans?|hoodies?|sweatshirts?|tanks?|camis?|camisoles?|long ?sleeves?|henleys?|polos?|bustiers?|corsets?|jackets?|coats?|blazers?|vests?|jumpers?|pullovers?)\b/i,
};
const guessSlot = (name) => ['shoes', 'bottom', 'top'].find((s) => SLOT_WORDS[s].test(name)) || 'top';

const PROMPT = {
  top: (n) => `Replace only her black sports bra with the ${n} shown in image 2 (if a model wears it there, copy only the garment, not the model). Reproduce it faithfully: same color, fabric, fit, length, neckline, sleeves, prints and details. It sits naturally on her body; the hand on her hip stays in front of it.`,
  bottom: (n) => `Replace only her black shorts with the ${n} shown in image 2 (if a model wears it there, copy only the garment, not the model). Reproduce it faithfully: same color, wash, fabric, rise, fit, length, pockets and details. Because she is only 5'2", long legs bunch or stack naturally at the bottom. Keep her white socks visible below if the hem is above them.`,
  shoes: (n) => `Put the ${n} shown in image 2 on her feet, worn over her white ankle socks, exactly where her feet are now. Reproduce them faithfully: same color, material, shape and details.`,
};
const KEEP = `Image 1 is the person. Keep image 1 EXACTLY the same everywhere except that one garment: same face, hair, skin tone, body size and proportions, same pose (one hand on her hip, the other arm relaxed at her side), same smile, same position in the frame, same camera, same plain white backdrop and lighting, and all her other clothing unchanged. Output an image with exactly the same size, framing and composition as image 1.`;

const readJSON = (req) => new Promise((res, rej) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { res(JSON.parse(b || '{}')); } catch (e) { rej(e); } }); });
const send = (res, code, obj) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)); };
const closet = () => (fs.existsSync(CLOSET) ? JSON.parse(fs.readFileSync(CLOSET, 'utf8')) : { items: [] });
const idFor = (url) => {
  const u = new URL(url);
  const num = u.pathname.match(/(\d{4,})/)?.[1];
  return (u.hostname.replace(/^www\.|^global\./, '').split('.')[0] + '-' + (num || Buffer.from(u.pathname).toString('base64url').slice(0, 12))).toLowerCase();
};
const run = (cmd, args) => new Promise((res, rej) => execFile(cmd, args, { cwd: ROOT, maxBuffer: 1 << 24, timeout: 600000 }, (err, out, errOut) => (err ? rej(new Error((errOut || out || err.message).split('\n').filter((l) => !/warn/i.test(l)).slice(-6).join('\n'))) : res(out))));

async function readProduct(url) {
  if (!/^https?:\/\//i.test(url)) throw new Error('Not a web link');
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en' } });
  const html = await r.text();
  const meta = (p) => html.match(new RegExp(`<meta[^>]+property=["']og:${p}["'][^>]+content=["']([^"']+)`, 'i'))?.[1];
  const decode = (s) => s?.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  let name = decode(meta('title') || html.match(/<title>([^<]*)/i)?.[1] || 'New item').replace(/^MUSINSA \| /, '').trim();
  let image = decode(meta('image'));
  if (!image) throw new Error("Couldn't find a product photo on that page");
  image = image.replace(/_500\.(jpe?g|png)$/i, '_big.$1'); // Musinsa: larger photo
  return { name, image };
}

function garmentApi() {
  return {
    name: 'garment-api',
    configureServer(server) {
      server.middlewares.use('/api/garment/preview', async (req, res) => {
        try {
          const { url } = await readJSON(req);
          const id = idFor(url);
          const owned = closet().items.find((i) => i.url === url || i.id.startsWith(id + '-') || i.id === id);
          if (owned) return send(res, 200, { owned: true, item: owned });
          const p = await readProduct(url);
          send(res, 200, { owned: false, id, url, ...p, slot: guessSlot(p.name), cost: 0.07 });
        } catch (e) { send(res, 400, { error: e.message }); }
      });

      server.middlewares.use('/api/garment/add', async (req, res) => {
        try {
          const { url, name, image, slot } = await readJSON(req);
          if (!PROMPT[slot]) throw new Error('Unsupported slot: ' + slot);
          const id = idFor(url) + '-' + slot;
          if (closet().items.some((i) => i.id === id)) return send(res, 200, { item: closet().items.find((i) => i.id === id), reused: true });
          // job folder: 1 = you, 2 = the product photo
          const job = path.join(ROOT, 'captures/handoff', id);
          fs.mkdirSync(job, { recursive: true });
          fs.copyFileSync(BASE, path.join(job, '1-model.png'));
          const img = await fetch(image, { headers: { 'User-Agent': UA, Referer: url } });
          if (!img.ok) throw new Error('Could not download the product photo');
          fs.writeFileSync(path.join(job, '2-garment.jpg'), Buffer.from(await img.arrayBuffer()));
          fs.writeFileSync(path.join(job, 'PROMPT.txt'), `Generated by the drop-to-closet flow.\n${'-'.repeat(40)}\n${KEEP}\n\n${PROMPT[slot](name)}\n\nRealistic fabric folds. Photorealistic.\n`);
          for (const f of fs.readdirSync(job)) if (f.startsWith('RESULT')) fs.unlinkSync(path.join(job, f));
          await run(PY, ['scripts/generate.py', job, '--provider', 'gemini', '--resolution', '1K', '--yes']);
          await run(PY, ['scripts/extract_garments.py', '--base', BASE, '--base-cutout', BASE_CUTOUT, '--tryon', path.join(job, 'RESULT.png'),
            '--piece', `${slot}:${id}:${name.replace(/:/g, ' ')}:${url}`]);
          const c = closet();
          c.base = c.base || '/looks/base.png';
          fs.writeFileSync(CLOSET, JSON.stringify(c, null, 2));
          send(res, 200, { item: c.items.find((i) => i.id === id) });
        } catch (e) { send(res, 500, { error: e.message }); }
      });
    },
  };
}

export default defineConfig({ plugins: [garmentApi()] });
