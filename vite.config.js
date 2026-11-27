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
const BASE = path.join(ROOT, 'captures/base-v4.png');
const BASE_CUTOUT = path.join(ROOT, 'captures/base-v4-cutout.png');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Safari/537.36';

const SLOT_WORDS = {
  eyewear: /\b(sunglass(es)?|glasses|eyewear|eyeglass(es)?|shades|spectacles|optical|frames?|goggles)\b/i,
  hat: /\b(hats?|caps?|beanies?|bucket|berets?|visors?|bonnets?|balaclavas?|fedoras?|trucker|snapback|headwear|hood(?!ie))\b/i,
  shoes: /\b(sneakers?|shoes?|boots?|loafers?|sandals?|heels?|mules?|flats?|slippers?|trainers?|clogs?)\b/i,
  bottom: /\b(jeans|pants|trousers|joggers|sweatpants|skirts?|shorts|slacks|leggings|denim|cargos?|culottes)\b/i,
  top: /\b(t-?shirts?|tees?|tops?|shirts?|blouses?|knits?|sweaters?|cardigans?|hoodies?|sweatshirts?|tanks?|camis?|camisoles?|long ?sleeves?|henleys?|polos?|bustiers?|corsets?|jackets?|coats?|blazers?|vests?|jumpers?|pullovers?)\b/i,
};
const SLOT_ORDER = ['eyewear', 'hat', 'shoes', 'bottom', 'top'];
const keywordSlot = (name) => SLOT_ORDER.find((s) => SLOT_WORDS[s].test(name));

// When the name gives no hint ("ARGON C1 BLACK"), ask Gemini to look at the product photo.
// One text answer from a small model: a tiny fraction of a cent.
function envKey(name) {
  const env = path.join(ROOT, '.env');
  if (!fs.existsSync(env)) return null;
  const line = fs.readFileSync(env, 'utf8').split('\n').find((l) => l.startsWith(name + '='));
  return line ? line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '') : null;
}
async function photoSlot(name, image) {
  const key = envKey('GEMINI_API_KEY');
  if (!key) return 'top';
  try {
    const img = await fetch(image, { headers: { 'User-Agent': UA } });
    const data = Buffer.from(await img.arrayBuffer()).toString('base64');
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ parts: [
        { text: `Product: "${name}". Which ONE category is the product for sale in this photo? Answer with one word: top, bottom, shoes, hat, eyewear.` },
        { inline_data: { mime_type: img.headers.get('content-type') || 'image/jpeg', data } }] }],
        generationConfig: { maxOutputTokens: 200, temperature: 0 } }),
    }).then((x) => x.json());
    const word = (r.candidates?.[0]?.content?.parts?.[0]?.text || '').toLowerCase();
    return SLOT_ORDER.find((s) => word.includes(s)) || 'top';
  } catch { return 'top'; }
}
const guessSlot = async (name, image) => keywordSlot(name) || photoSlot(name, image);

// For a screenshot/photo with no product page: name it and pick its slot from the picture.
async function describePhoto(buf, mime) {
  const key = envKey('GEMINI_API_KEY');
  if (!key) return { name: 'New item', slot: 'top' };
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ parts: [
        { text: 'This image shows a clothing product, possibly in a screenshot of a shop or worn by a model. Identify the ONE main item for sale. Reply only as JSON: {"slot": one of top|bottom|shoes|hat|eyewear, "name": short product description, e.g. "Black lace henley long sleeve" (max 6 words), "material": fabric if visible as text in the image, else null}.' },
        { inline_data: { mime_type: mime, data: buf.toString('base64') } }] }],
        generationConfig: { maxOutputTokens: 400, temperature: 0, responseMimeType: 'application/json' } }),
    }).then((x) => x.json());
    const out = JSON.parse(r.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text || '{}');
    return { name: out.name || 'New item', slot: SLOT_ORDER.includes(out.slot) ? out.slot : 'top', material: out.material || null };
  } catch { return { name: 'New item', slot: 'top', material: null }; }
}

const PROMPT = {
  top: (n) => `Replace only her black sports bra with the ${n} shown in image 2 (if a model wears it there, copy only the garment, not the model). Reproduce it faithfully: same color, fabric, fit, length, neckline, sleeves, prints and details. It sits naturally on her body; her arms stay exactly where they are.`,
  bottom: (n) => `Replace only her black shorts with the ${n} shown in image 2 (if a model wears it there, copy only the garment, not the model). Reproduce it faithfully: same color, wash, fabric, rise, fit, length, pockets and details. Because she is only 5'2", long legs bunch or stack naturally at the bottom. Keep her white socks visible below if the hem is above them.`,
  eyewear: (n) => `Put the ${n} shown in image 2 on her face (if a person wears them there, copy only the eyewear). Cool, editorial vibe: they sit naturally on her nose and over her ears, sized correctly for her face, and the dark lenses fully cover her eyes so her eyes are not visible. Reproduce the frame shape, thickness, color, finish, lens tint and any logo exactly. Keep her smile, mouth, hair and the rest of her face unchanged.`,
  hat: (n) => `Put the ${n} shown in image 2 on her head (if a person wears it there, copy only the hat). Cool, editorial vibe: she wears it low on her head, pulled down so the brim or front edge shades and partly covers her eyes, at a realistic size for her head; her hair falls naturally out from under it at the sides and back, keeping its length and color. Reproduce the hat's shape, brim, crown, material, color, stitching and any logo exactly. Keep her smile, mouth and the rest of her face below the eyes unchanged.`,
  shoes: (n) => `Put the ${n} shown in image 2 on her feet, worn over her white ankle socks, exactly where her feet are now. Reproduce them faithfully: same color, material, shape and details.`,
};
const KEEP = `Image 1 is the person. Keep image 1 EXACTLY the same everywhere except that one garment: same face, hair, skin tone, body size and proportions, same pose and arm position as image 1, same smile, same position in the frame, same camera, same plain white backdrop and lighting, and all her other clothing unchanged. Output an image with exactly the same size, framing and composition as image 1.`;

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
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en' } }).catch(() => null);
  if (!r || !r.ok) throw new Error("Couldn't read that page. Drop or paste a screenshot instead.");
  const html = await r.text();
  const meta = (p) => html.match(new RegExp(`<meta[^>]+property=["']og:${p}["'][^>]+content=["']([^"']+)`, 'i'))?.[1];
  const decode = (s) => s?.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  let name = decode(meta('title') || html.match(/<title>([^<]*)/i)?.[1] || 'New item').replace(/^MUSINSA \| /, '').trim();
  let image = decode(meta('image'));
  if (!image) throw new Error("Couldn't read that page. Drop or paste a screenshot instead.");
  image = image.replace(/_500\.(jpe?g|png)$/i, '_big.$1'); // Musinsa: larger photo
  return { name, image, material: findMaterial(html, decode) };
}

// Material/composition as the shop lists it in the page's public text or structured data.
function findMaterial(html, decode) {
  const found = new Set();
  for (const m of html.matchAll(/"material"\s*:\s*"([^"]{2,120})"/gi)) found.add(m[1]);
  const text = decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, '\n'))
    .replace(/[ \t]+/g, ' ');
  const re = /(?:^|\n)\s*(?:composition|material|materials|fabric|fabrication|shell|소재|혼용률)\s*[:\n]\s*([^\n]{2,120})/gi;
  for (const m of text.matchAll(re)) found.add(m[1].trim());
  const pct = text.match(/\b\d{1,3}%\s*(?:cotton|polyester|nylon|wool|cashmere|linen|silk|viscose|rayon|spandex|elastane|polyurethane|acrylic|modal|lyocell|leather)[^\n]{0,80}/i);
  if (pct) found.add(pct[0].trim());
  return [...found].slice(0, 3).join('; ') || null;
}

// Fabric guidance for every render: the listed material if we have it, and always the photo.
const MATERIAL = (material) =>
  (material ? `The shop lists the material as: ${material}. ` : '') +
  `Make the fabric behave like that material as seen in image 2: its weight and thickness, stiffness or drape, stretch, sheen or matte finish, and surface texture (for example rigid denim holds structured folds, rib knit hugs the body, satin catches light, fleece looks soft and thick).`;

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
          send(res, 200, { owned: false, id, url, ...p, slot: await guessSlot(p.name, p.image), cost: 0.07 });
        } catch (e) { send(res, 400, { error: e.message }); }
      });

      // An image instead of a product page: a dropped/pasted screenshot or a bare image link.
      server.middlewares.use('/api/garment/image', async (req, res) => {
        try {
          const { data, mime = 'image/png', url } = await readJSON(req);
          let buf, type = mime;
          if (url) {
            const r = await fetch(url, { headers: { 'User-Agent': UA } });
            type = r.headers.get('content-type') || 'image/jpeg';
            if (!r.ok || !type.startsWith('image/')) throw new Error('Not an image');
            buf = Buffer.from(await r.arrayBuffer());
          } else {
            buf = Buffer.from(data, 'base64');
          }
          const hash = (await import('node:crypto')).createHash('sha1').update(buf).digest('hex').slice(0, 10);
          const dirUp = path.join(ROOT, 'public/closet/uploads');
          fs.mkdirSync(dirUp, { recursive: true });
          const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
          fs.writeFileSync(path.join(dirUp, `${hash}.${ext}`), buf);
          const owned = closet().items.find((i) => i.id.startsWith(`image-${hash}-`));
          if (owned) return send(res, 200, { owned: true, item: owned });
          const d = await describePhoto(buf, type);
          send(res, 200, { owned: false, id: `image-${hash}`, url: url || `upload:${hash}`, image: `/closet/uploads/${hash}.${ext}`, ...d, cost: 0.07 });
        } catch (e) { send(res, 400, { error: e.message }); }
      });

      // Queue a garment. Returns immediately; the work runs on its own (see processJob),
      // so reloading or closing the page can't lose it.
      server.middlewares.use('/api/garment/add', async (req, res) => {
        try {
          const { url, name, image, slot, material = null } = await readJSON(req);
          if (!PROMPT[slot]) throw new Error('Unsupported slot: ' + slot);
          const id = (url.startsWith('upload:') ? `image-${url.slice(7)}` : /^https?:\/\/[^ ]+\.(png|jpe?g|webp)(\?|$)/i.test(url) ? `image-${(await import('node:crypto')).createHash('sha1').update(url).digest('hex').slice(0, 10)}` : idFor(url)) + '-' + slot;
          const owned = closet().items.find((i) => i.id === id);
          if (owned) return send(res, 200, { job: { id, status: 'done', item: owned } });
          const jobs = readJobs();
          const job = jobs[id] && jobs[id].status !== 'failed'
            ? jobs[id]
            : { id, url, name, image, slot, material, status: 'queued', created: new Date().toISOString() };
          if (jobs[id]?.status === 'failed') { job.status = 'queued'; delete job.error; }
          saveJob(job);
          processJob(id);
          send(res, 202, { job });
        } catch (e) { send(res, 400, { error: e.message }); }
      });

      // Everything not yet finished (queued / generating / cutting / failed), for the page to show.
      server.middlewares.use('/api/garment/jobs', (req, res) => {
        const jobs = Object.values(readJobs()).filter((j) => j.status !== 'done' || Date.now() - Date.parse(j.finished || 0) < 60000);
        send(res, 200, { jobs });
      });

      // Resume anything left unfinished by a server restart.
      for (const j of Object.values(readJobs())) if (['queued', 'generating', 'cutting'].includes(j.status)) processJob(j.id);
    },
  };
}

// ---------- jobs: saved to disk so nothing in progress is ever lost ----------
const JOBS = path.join(ROOT, 'captures/jobs.json');
const readJobs = () => (fs.existsSync(JOBS) ? JSON.parse(fs.readFileSync(JOBS, 'utf8')) : {});
function saveJob(job) {
  const jobs = readJobs();
  jobs[job.id] = { ...jobs[job.id], ...job };
  fs.mkdirSync(path.dirname(JOBS), { recursive: true });
  fs.writeFileSync(JOBS, JSON.stringify(jobs, null, 2));
  return jobs[job.id];
}
const running = new Set();

// Each step is skipped if its output already exists, so a resumed job never pays for a render twice.
async function processJob(id) {
  if (running.has(id)) return;
  running.add(id);
  let job = readJobs()[id];
  try {
    const dir = path.join(ROOT, 'captures/handoff', id);
    const result = path.join(dir, 'RESULT.png');
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(path.join(dir, '1-model.png'))) fs.copyFileSync(BASE, path.join(dir, '1-model.png'));
    if (!fs.existsSync(path.join(dir, '2-garment.jpg'))) {
      if (job.image.startsWith('/')) {
        fs.copyFileSync(path.join(ROOT, 'public', job.image), path.join(dir, '2-garment.jpg'));
      } else {
        const img = await fetch(job.image, { headers: { 'User-Agent': UA, Referer: job.url } });
        if (!img.ok) throw new Error("Couldn't download the product photo");
        fs.writeFileSync(path.join(dir, '2-garment.jpg'), Buffer.from(await img.arrayBuffer()));
      }
    }
    if (!fs.existsSync(path.join(dir, 'PROMPT.txt'))) {
      fs.writeFileSync(path.join(dir, 'PROMPT.txt'), `Generated by the drop-to-closet flow.\n${'-'.repeat(40)}\n${KEEP}\n\n${PROMPT[job.slot](job.name)}\n\n${MATERIAL(job.material)}\n\nRealistic fabric folds. Photorealistic.\n`);
    }
    if (!fs.existsSync(result)) {
      job = saveJob({ id, status: 'generating' });
      await run(PY, ['scripts/generate.py', dir, '--provider', 'gemini', '--resolution', '1K', '--yes']);
    }
    job = saveJob({ id, status: 'cutting' });
    await run(PY, ['scripts/extract_garments.py', '--base', BASE, '--base-cutout', BASE_CUTOUT, '--tryon', result,
      '--piece', `${job.slot}:${id}:${job.name.replace(/:/g, ' ')}:${job.url}`]);
    const c = closet();
    c.base = c.base || '/looks/base.png';
    fs.writeFileSync(CLOSET, JSON.stringify(c, null, 2));
    saveJob({ id, status: 'done', finished: new Date().toISOString(), item: c.items.find((i) => i.id === id) });
  } catch (e) {
    saveJob({ id, status: 'failed', error: e.message.split('\n').pop().slice(0, 200) });
  } finally {
    running.delete(id);
  }
}

export default defineConfig({ plugins: [garmentApi()] });
