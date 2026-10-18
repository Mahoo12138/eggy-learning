const KEY = 'eggy-code-park-comfort-v1';
const subscribers = new Set();
let preferences;
let explicitMotion = false;
let unpersisted = false;
let media;

function stored() {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return null; }
}

function fromStorage() {
  const value = stored();
  if (value === null && preferences) return { ...preferences };
  const saved = value || {};
  explicitMotion = typeof saved.reducedMotion === 'boolean';
  media ||= matchMedia('(prefers-reduced-motion: reduce)');
  return { muted: saved.muted === true, reducedMotion: explicitMotion ? saved.reducedMotion : media.matches };
}

export function readComfort() { preferences ||= fromStorage(); return { ...preferences }; }

export function applyComfort(value) {
  document.documentElement.dataset.motion = value.reducedMotion ? 'reduced' : 'full';
  document.documentElement.dataset.sound = value.muted ? 'muted' : 'on';
}

function publish() {
  applyComfort(readComfort());
  for (const listener of subscribers) listener(readComfort());
}

export function toggleComfort(kind) {
  const next = readComfort();
  if (kind === 'sound') next.muted = !next.muted;
  else if (kind === 'motion') { next.reducedMotion = !next.reducedMotion; explicitMotion = true; }
  else return;
  preferences = next;
  // Toggling sound must not freeze the system-derived motion preference.
  const saved = explicitMotion ? next : { muted: next.muted };
  try { localStorage.setItem(KEY, JSON.stringify(saved)); unpersisted = false; }
  catch { unpersisted = true; }
  publish();
}

function storageChanged(event) {
  if (event.key !== KEY && event.key !== null) return;
  unpersisted = false;
  preferences = fromStorage(); publish();
}
function systemChanged() {
  if (!explicitMotion) { preferences = { ...readComfort(), reducedMotion: media.matches }; publish(); }
}

export function subscribeComfort(listener) {
  readComfort();
  if (!subscribers.size) {
    // Resync after every detached period; no listener remains on a disconnected UI.
    if (!unpersisted) preferences = fromStorage();
    else if (!explicitMotion) preferences = { ...preferences, reducedMotion: media.matches };
    window.addEventListener('storage', storageChanged);
    media.addEventListener('change', systemChanged);
  }
  subscribers.add(listener);
  applyComfort(readComfort()); listener(readComfort());
  return () => {
    subscribers.delete(listener);
    if (!subscribers.size) {
      window.removeEventListener('storage', storageChanged);
      media.removeEventListener('change', systemChanged);
    }
  };
}
