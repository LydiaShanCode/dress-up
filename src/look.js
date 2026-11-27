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

// ---------- looks (generated photos live in public/looks, git-ignored) ----------
const img = document.getElementById('look-img');
const cap = document.getElementById('look-caption');
const nav = document.getElementById('looks');

function show(look) {
  img.src = look.image;
  img.alt = `You wearing ${look.items.map((i) => i.name).join(' and ')}`;
  cap.innerHTML = `<span class="who">${look.title === 'Base' ? 'You' : look.title}</span>` +
    look.items.map((i) => (i.url ? `<a class="what" href="${i.url}" target="_blank" rel="noopener">${i.name}</a>` : `<span class="what">${i.name}</span>`)).join('');
  for (const b of nav.children) b.setAttribute('aria-pressed', String(b.dataset.id === look.id));
  history.replaceState(null, '', `#${look.id}`);
}

fetch('/looks/looks.json').then((r) => (r.ok ? r.json() : [])).then((looks) => {
  if (looks.length < 2) { nav.hidden = true; return; }
  for (const look of looks) {
    const b = document.createElement('button');
    b.dataset.id = look.id;
    b.title = look.title;
    b.innerHTML = `<img src="${look.image}" alt="">`;
    b.addEventListener('click', () => show(look));
    nav.appendChild(b);
  }
  show(looks.find((l) => `#${l.id}` === location.hash) ?? looks.at(-1));
});
