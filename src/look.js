import { FIELDS, load } from './measurements.js';
import './look.css';

const m = load();
const ft = Math.floor(m.height / 12), inch = +(m.height - ft * 12).toFixed(1);
document.getElementById('summary').textContent = `${ft}′${inch}″ · ${m.weight} lb · ${m.bust}–${m.waist}–${m.hip}`;

const list = document.getElementById('measurements');
for (const g of FIELDS) {
  if (g.group === 'Overall') continue;
  const h = document.createElement('div');
  h.className = 'group';
  h.textContent = g.group;
  list.appendChild(h);
  for (const [k, label, unit = 'in'] of g.items) {
    const row = document.createElement('div');
    row.className = 'item';
    row.innerHTML = `<dt>${label}</dt><dd>${m[k]}<i>${unit === 'in' ? '″' : ' ' + unit}</i></dd>`;
    list.appendChild(row);
  }
}

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
  for (const b of closetEl.querySelectorAll('button')) b.setAttribute('aria-pressed', String((outfit[b.dataset.slot] ?? null) === (b.dataset.id || null)));
  localStorage.setItem(KEY, JSON.stringify(outfit));
}

function wear(slot, id) {
  outfit[slot] = id;
  render();
}

function buildCloset() {
  closetEl.innerHTML = '';
  for (const [slot, label] of SLOTS) {
    const items = closet.items.filter((i) => i.slot === slot);
    if (!items.length) continue;
    const group = document.createElement('div');
    group.className = 'slot';
    group.innerHTML = `<p class="slot-label">${label}</p>`;
    const row = document.createElement('div');
    row.className = 'slot-items';
    const none = document.createElement('button');
    none.dataset.slot = slot; none.dataset.id = '';
    none.className = 'none'; none.textContent = 'None';
    none.addEventListener('click', () => wear(slot, null));
    row.appendChild(none);
    for (const it of items) {
      const b = document.createElement('button');
      b.dataset.slot = slot; b.dataset.id = it.id; b.title = it.name;
      b.innerHTML = `<img src="${it.src}" alt="${it.name}">`;
      b.addEventListener('click', () => wear(slot, it.id));
      row.appendChild(b);
    }
    group.appendChild(row);
    closetEl.appendChild(group);
  }
}

fetch('/closet/closet.json').then((r) => r.json()).catch(() => ({ items: [] })).then((c) => {
  closet = c;
  if (!closet.items.length) { closetEl.hidden = true; return render(); }
  const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
  outfit = saved ?? Object.fromEntries(SLOTS.map(([s]) => [s, closet.items.find((i) => i.slot === s)?.id ?? null]));
  buildCloset();
  render();
});
