import './look.css';

// ---------- closet ----------
// The base photo never changes. Each garment is a transparent layer cut out once (one AI
// try-on), positioned in base-photo coordinates, so outfits are composed for free.
const SLOTS = [['top', 'Top'], ['bottom', 'Bottom'], ['shoes', 'Shoes']];
const model = document.getElementById('model');
const cap = document.getElementById('look-caption');
const closetEl = document.getElementById('closet');
const KEY = 'dressup.outfit.v1';

let closet = { items: [] };
let outfit = {};

// Composite on a canvas: your cutout → erase what worn garments hide → garments on top.
const canvas = document.getElementById('model-canvas');
const ctx = canvas.getContext('2d');
const cache = new Map();
const loadImg = (src) => {
  if (!cache.has(src)) cache.set(src, new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; }));
  return cache.get(src);
};
let drawToken = 0;

async function draw(worn) {
  const token = ++drawToken;
  const base = await loadImg(closet.base || '/looks/base.png');
  const layers = await Promise.all(worn.map(async (it) => ({ it, img: await loadImg(it.src), erase: it.erase && await loadImg(it.erase.src) })));
  if (token !== drawToken) return; // a newer outfit was picked meanwhile
  const W = base.naturalWidth, H = base.naturalHeight;
  canvas.width = W; canvas.height = H;
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(base, 0, 0);
  const at = (box) => [box[0] * W, box[1] * H, box[2] * W, box[3] * H];
  ctx.globalCompositeOperation = 'destination-out';
  for (const l of layers) if (l.erase) ctx.drawImage(l.erase, ...at(l.it.erase.box));
  ctx.globalCompositeOperation = 'source-over';
  for (const l of layers) ctx.drawImage(l.img, ...at(l.it.box));
}

function render() {
  const worn = SLOTS.map(([s]) => closet.items.find((i) => i.id === outfit[s])).filter(Boolean).sort((a, b) => a.z - b.z);
  draw(worn);
  cap.innerHTML = worn.length
    ? worn.slice().sort((a, b) => b.z - a.z).map((i) => (i.url ? `<a class="what" href="${i.url}" target="_blank" rel="noopener">${i.name}</a>` : `<span class="what">${i.name}</span>`)).join('')
    : '';
  canvas.setAttribute('aria-label', worn.length ? `You wearing ${worn.map((i) => i.name).join(', ')}` : 'You in a black sports bra and black shorts');
  for (const b of closetEl.querySelectorAll('.card')) b.setAttribute('aria-pressed', String(outfit[b.dataset.slot] === b.dataset.id));
  localStorage.setItem(KEY, JSON.stringify(outfit));
}

function wear(slot, id) {
  outfit[slot] = id;
  render();
}
const isWorn = (it) => outfit[it.slot] === it.id;
const toggle = (it) => wear(it.slot, isWorn(it) ? null : it.id);

// ---------- closet: cards you drag onto the model (or click) ----------
function buildCloset() {
  closetEl.innerHTML = '';
  for (const [slot] of SLOTS) {
    const items = closet.items.filter((i) => i.slot === slot);
    const group = document.createElement('div');
    group.className = 'slot';
    const row = document.createElement('div');
    row.className = 'slot-items';
    row.dataset.slot = slot;
    for (const it of items) {
      const b = document.createElement('button');
      b.className = 'card';
      b.dataset.slot = slot; b.dataset.id = it.id;
      b.title = it.name;
      b.innerHTML = `<img src="${it.src}" alt="${it.name}" draggable="false">`;
      b.addEventListener('pointerdown', (e) => startDrag(e, it, b.querySelector('img')));
      b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(it); } });
      row.appendChild(b);
    }
    group.appendChild(row);
    closetEl.appendChild(group);
  }
}

// Pointer-based drag (works with mouse and touch). A short press without moving = click.
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let drag = null;

function startDrag(e, it, fromImg, fromModel = false) {
  if (e.button !== undefined && e.button !== 0) return;
  e.preventDefault();
  const r = fromImg ? fromImg.getBoundingClientRect() : null;
  drag = { it, x0: e.clientX, y0: e.clientY, moved: false, fromModel, ghost: null, rect: r };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp, { once: true });
}

function makeGhost(it, e) {
  const g = document.createElement('img');
  g.className = 'drag-ghost';
  g.src = it.src;
  // size the ghost like the garment will look on the model, so the drop feels physical
  const mr = canvas.getBoundingClientRect();
  g.style.width = `${it.box[2] * mr.width}px`;
  g.style.height = `${it.box[3] * mr.height}px`;
  document.body.appendChild(g);
  drag.grab = [g.offsetWidth / 2, g.offsetHeight / 2];
  if (drag.fromModel) { outfit[it.slot] = null; render(); }   // lift it off the body
  return g;
}

function onMove(e) {
  if (!drag) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6) return;
  if (!drag.moved) { drag.moved = true; drag.ghost = makeGhost(drag.it, e); document.body.classList.add('dragging'); }
  drag.ghost.style.transform = `translate(${e.clientX - drag.grab[0]}px, ${e.clientY - drag.grab[1]}px)`;
  const toCloset = overCloset(e);
  closetEl.classList.toggle('drop-target', toCloset && drag.fromModel);
  model.classList.toggle('drop-target', !toCloset && overModel(e) && !drag.fromModel);
}

const overCloset = (e) => { const r = closetEl.getBoundingClientRect(); return !closetEl.hidden && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom; };

const overModel = (e) => { const r = model.getBoundingClientRect(); return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom; };

function onUp(e) {
  window.removeEventListener('pointermove', onMove);
  const d = drag; drag = null;
  document.body.classList.remove('dragging');
  model.classList.remove('drop-target');
  closetEl.classList.remove('drop-target');
  if (!d) return;
  if (!d.moved) { if (!d.fromModel) toggle(d.it); return; }   // plain click
  const g = d.ghost;
  const fly = (rect, ms, ease, done, shrink = false) => {
    if (reduceMotion) { g.remove(); done(); return; }
    g.style.transition = `transform ${ms}ms ${ease}, opacity ${ms}ms ease-out`;
    if (shrink) {
      // shrink into the card, keeping the garment's proportions
      const s2 = Math.min(rect.width / g.offsetWidth, rect.height / g.offsetHeight) * 0.85;
      const tx = rect.left + (rect.width - g.offsetWidth * s2) / 2, ty = rect.top + (rect.height - g.offsetHeight * s2) / 2;
      g.style.transformOrigin = '0 0';
      g.style.transform = `translate(${tx}px, ${ty}px) scale(${s2})`;
      g.style.opacity = '0.4';
    } else {
      g.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
    }
    g.addEventListener('transitionend', () => { done(); requestAnimationFrame(() => g.remove()); }, { once: true });
  };
  const onBody = () => {
    const mr = canvas.getBoundingClientRect(), [x, y] = d.it.box;
    return { left: mr.left + x * mr.width, top: mr.top + y * mr.height };
  };
  if (overCloset(e)) {
    // put it away: shrink back into its card (takes it off if it was worn)
    const card = closetEl.querySelector(`.card[data-id="${d.it.id}"]`);
    fly(card.getBoundingClientRect(), 220, 'cubic-bezier(.3,.7,.2,1)', () => { if (isWorn(d.it)) wear(d.it.slot, null); else render(); }, true);
  } else if (overModel(e) || d.fromModel) {
    // dropped on the body, or let go somewhere random while taking it off: snap (back) on
    fly(onBody(), 260, 'cubic-bezier(.2,.9,.3,1.15)', () => wear(d.it.slot, d.it.id));
  } else {
    // dragged out of the closet and dropped nowhere: just disappear
    g.style.transition = 'opacity 120ms linear';
    g.style.opacity = '0';
    g.addEventListener('transitionend', () => g.remove(), { once: true });
  }
}

// Drag a garment OFF the model: pick the top-most worn layer under the pointer.
canvas.addEventListener('pointerdown', (e) => {
  const worn = SLOTS.map(([s]) => closet.items.find((i) => i.id === outfit[s])).filter(Boolean).sort((a, b) => b.z - a.z);
  const r = canvas.getBoundingClientRect();
  const u = (e.clientX - r.left) / r.width, v = (e.clientY - r.top) / r.height;
  for (const it of worn) {
    const [x, y, w, h] = it.box;
    if (u < x || u > x + w || v < y || v > y + h) continue;
    const img = cache.get(it.src);
    if (!img) continue;
    img.then((im) => {
      const c = document.createElement('canvas'); c.width = 1; c.height = 1;
      const cx = c.getContext('2d');
      cx.drawImage(im, ((u - x) / w) * im.naturalWidth, ((v - y) / h) * im.naturalHeight, 1, 1, 0, 0, 1, 1);
      if (cx.getImageData(0, 0, 1, 1).data[3] > 40 && !drag) startDrag(e, it, null, true);
    });
    break;
  }
});

fetch('/closet/closet.json').then((r) => r.json()).catch(() => ({ items: [] })).then((c) => {
  closet = c;
  const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
  outfit = saved ?? {};
  for (const [s] of SLOTS) if (outfit[s] && !closet.items.some((i) => i.id === outfit[s])) outfit[s] = null;
  buildCloset();
  render();
});

// ---------- drop a product link from a shopping tab to add it to the closet ----------
const stage = document.querySelector('.look-stage');
const dropHint = document.createElement('div');
dropHint.className = 'drop-hint';
stage.appendChild(dropHint);
const sheet = document.createElement('div');
sheet.className = 'add-sheet';
sheet.hidden = true;
stage.appendChild(sheet);

const droppedUrl = (dt) => {
  const uri = (dt.getData('text/uri-list') || '').split('\n').find((l) => l && !l.startsWith('#'));
  const href = dt.getData('text/html').match(/href="([^"]+)"/)?.[1];
  const text = dt.getData('text/plain');
  return [uri, href, text].find((u) => u && /^https?:\/\//.test(u.trim()))?.trim();
};
const isLinkDrag = (e) => !drag && [...e.dataTransfer.types].some((t) => t === 'text/uri-list' || t === 'text/plain' || t === 'text/html');
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { if (isLinkDrag(e)) { dragDepth++; stage.classList.add('link-over'); } });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; stage.classList.remove('link-over'); } });
window.addEventListener('dragover', (e) => { if (isLinkDrag(e)) e.preventDefault(); });
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  stage.classList.remove('link-over');
  const url = droppedUrl(e.dataTransfer);
  if (!url) return showSheet('<p class="sheet-msg">That drop had no product link. Drag the product photo or name from the shop tab.</p>', true);
  const r = await postJSON('/api/garment/preview', { url });
  if (r.error) return showSheet(`<p class="sheet-msg">${r.error}</p>`, true);
  if (r.owned) { sheet.hidden = true; wear(r.item.slot, r.item.id); return; } // already in your closet: free
  addGarment(r); // new: add straight away (cost is known, ~$0.07)
});

const postJSON = (u, body) => fetch(u, { method: 'POST', body: JSON.stringify(body) })
  .then((x) => x.json()).catch(() => ({ error: "The local server isn't running (npm run dev)." }));

function showSheet(html, dismissable = false) {
  sheet.innerHTML = html + (dismissable ? '<div class="sheet-actions"><button class="ghost" data-act="close">OK</button></div>' : '');
  sheet.hidden = false;
  sheet.querySelector('[data-act="close"]')?.addEventListener('click', () => { sheet.hidden = true; });
}

// Vertical band of the body each slot changes (fractions of the model's height).
const BAND = { top: [0.17, 0.56], bottom: [0.42, 0.97], shoes: [0.84, 1] };

// ---------- jobs: adding a garment is a saved job on your Mac, so reloads can't lose it ----------
const jobUI = new Map(); // id → { card, shimmer }
let polling = null;

async function addGarment(p) {
  sheet.hidden = true;
  const r = await postJSON('/api/garment/add', p);
  if (r.error) return showSheet(`<p class="sheet-msg">${r.error}</p>`, true);
  if (r.job.status === 'done') return finishJob(r.job);
  // only show the generating state if it takes longer than a second
  setTimeout(() => syncJobs([r.job]), 1000);
  poll();
}

function jobVisuals(job) {
  let ui = jobUI.get(job.id);
  if (!ui) {
    const card = document.createElement('button');
    card.className = 'card generating';
    card.innerHTML = '<img alt=""><span class="dots"></span>';
    card.querySelector('img').src = job.image;
    card.addEventListener('click', async () => {
      if (!card.classList.contains('failed')) return;
      card.classList.remove('failed');
      await postJSON('/api/garment/add', job); // retry: resumes, never re-pays for a finished render
      poll();
    });
    const shimmer = document.createElement('div');
    shimmer.className = 'gen-shimmer';
    const [b0, b1] = BAND[job.slot] || [0, 1];
    Object.assign(shimmer.style, { top: `${b0 * 100}%`, height: `${(b1 - b0) * 100}%` });
    shimmer.setAttribute('role', 'status');
    shimmer.setAttribute('aria-label', `Rendering ${job.name} on you`);
    ui = { card, shimmer, slot: job.slot };
    jobUI.set(job.id, ui);
  }
  const row = closetEl.querySelector(`.slot-items[data-slot="${job.slot}"]`) || closetEl;
  if (!ui.card.isConnected) row.appendChild(ui.card);
  return ui;
}

function syncJobs(jobs) {
  for (const job of jobs) {
    if (job.status === 'done') { if (jobUI.has(job.id)) finishJob(job); continue; }
    const ui = jobVisuals(job);
    const failed = job.status === 'failed';
    ui.card.classList.toggle('failed', failed);
    ui.card.title = failed ? `${job.name}: ${job.error}. Click to retry.` : job.name;
    if (failed) ui.shimmer.remove(); else if (!ui.shimmer.isConnected) model.appendChild(ui.shimmer);
  }
}

async function finishJob(job) {
  const ui = jobUI.get(job.id);
  jobUI.delete(job.id);
  closet = await fetch('/closet/closet.json', { cache: 'no-store' }).then((x) => x.json());
  buildCloset();
  // the closet was rebuilt: put still-pending cards back in their rows
  for (const o of jobUI.values()) (closetEl.querySelector(`.slot-items[data-slot="${o.slot}"]`) || closetEl).appendChild(o.card);
  if (job.item) wear(job.item.slot, job.item.id);
  if (ui) { ui.shimmer.classList.add('done'); setTimeout(() => ui.shimmer.remove(), 500); } // dots fade out as it appears
  poll();
}

function poll() {
  if (polling) return;
  polling = setInterval(async () => {
    const { jobs = [] } = await fetch('/api/garment/jobs').then((x) => x.json()).catch(() => ({}));
    syncJobs(jobs);
    const active = jobs.some((j) => ['queued', 'generating', 'cutting'].includes(j.status));
    if (!active && ![...jobUI.values()].length) { clearInterval(polling); polling = null; }
  }, 2000);
}

// On load: show anything still in progress (or failed) from before a reload.
fetch('/api/garment/jobs').then((x) => x.json()).then(({ jobs = [] }) => {
  const pending = jobs.filter((j) => j.status !== 'done');
  if (pending.length) { syncJobs(pending); poll(); }
}).catch(() => {});
