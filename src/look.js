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

function render() {
  for (const el of model.querySelectorAll('.layer')) el.remove();
  const worn = SLOTS.map(([s]) => closet.items.find((i) => i.id === outfit[s])).filter(Boolean).sort((a, b) => a.z - b.z);
  for (const it of worn) {
    const [x, y, w, h] = it.box;
    const img = document.createElement('img');
    img.className = 'layer';
    img.src = it.src;
    img.alt = '';
    Object.assign(img.style, { left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%`, zIndex: it.z });
    model.appendChild(img);
  }
  cap.innerHTML = worn.length
    ? worn.slice().sort((a, b) => b.z - a.z).map((i) => (i.url ? `<a class="what" href="${i.url}" target="_blank" rel="noopener">${i.name}</a>` : `<span class="what">${i.name}</span>`)).join('')
    : '<span class="what">Black sports bra, black shorts</span>';
  model.querySelector('.base').alt = worn.length ? `You wearing ${worn.map((i) => i.name).join(', ')}` : 'You in a black sports bra and black shorts';
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

fetch('/closet/closet.json').then((r) => (r.ok ? r.json() : { items: [] })).then((c) => {
  closet = c;
  if (!closet.items.length) { closetEl.hidden = true; return render(); }
  const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
  outfit = saved ?? Object.fromEntries(SLOTS.map(([s]) => [s, closet.items.find((i) => i.slot === s)?.id ?? null]));
  buildCloset();
  render();
});
