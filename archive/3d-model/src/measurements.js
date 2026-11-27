// All values in inches (weight in lb).
export const DEFAULTS = {
  height: 62,
  weight: 105,
  // circumferences
  bust: 30,
  ribcage: 27,
  waist: 25,
  stomach: 26,
  hip: 32.5,
  thigh: 17.5,
  calf: 12,
  arm: 9,
  // lengths
  shoulder: 4,
  inseam: 28,
  outseam: 32,
  armLength: 21,
  torso: 14,
};

export const FIELDS = [
  { group: 'Overall', items: [
    ['height', 'Height', 'in'],
    ['weight', 'Weight', 'lb'],
  ] },
  { group: 'Circumference', items: [
    ['bust', 'Bust'],
    ['ribcage', 'Rib cage'],
    ['waist', 'Waist'],
    ['stomach', 'Stomach'],
    ['hip', 'Hip'],
    ['thigh', 'Thigh'],
    ['calf', 'Calf'],
    ['arm', 'Upper arm'],
  ] },
  { group: 'Length', items: [
    ['shoulder', 'Shoulder'],
    ['torso', 'Torso'],
    ['armLength', 'Arm'],
    ['inseam', 'Inner leg'],
    ['outseam', 'Outer leg'],
  ] },
];

const KEY = 'dressup.measurements.v1';

export function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { ...DEFAULTS, ...saved };
  } catch {
    return { ...DEFAULTS };
  }
}

export function save(m) {
  localStorage.setItem(KEY, JSON.stringify(m));
}
