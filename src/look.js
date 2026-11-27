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
    : '<span class="what">Black sports bra, black shorts</span>';
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
  closetEl.innerHTML = '<p class="closet-title">Closet</p>';
  for (const [slot, label] of SLOTS) {
    const items = closet.items.filter((i) => i.slot === slot);
    if (!items.length) continue;
    const group = document.createElement('div');
    group.className = 'slot';
    group.innerHTML = `<p class="slot-label">${label}</p>`;
    const row = document.createElement('div');
    row.className = 'slot-items';
    for (const it of items) {
      const b = document.createElement('button');
      b.className = 'card';
      b.dataset.slot = slot; b.dataset.id = it.id;
      b.title = `${it.name}. Drag onto yourself, or click to wear`;
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
  if (!closet.items.length) { closetEl.hidden = true; return render(); }
  const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
  outfit = saved ?? {};
  for (const [s] of SLOTS) if (outfit[s] && !closet.items.some((i) => i.id === outfit[s])) outfit[s] = null;
  buildCloset();
  render();
});
