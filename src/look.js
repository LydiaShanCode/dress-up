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
