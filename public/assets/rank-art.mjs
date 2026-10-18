// Keep artwork separate from course order and rank progression.
export const RANK_ART_PATHS = Object.freeze({
  quail: '/assets/ranks/quail.png',
  pigeon: '/assets/ranks/pigeon.png',
  chicken: '/assets/ranks/chicken.png',
  goose: '/assets/ranks/goose.png',
  ostrich: '/assets/ranks/ostrich.png',
  dinosaur: '/assets/ranks/dinosaur.png',
  'peak-phoenix': '/assets/ranks/phoenix.png',
  'super-phoenix': '/assets/ranks/super-phoenix.png',
  'invincible-phoenix': '/assets/ranks/invincible-phoenix.png'
});

// Rank names remain in the adjacent text; the image is decorative.
export function rankArtMarkup(rankId, { eager = false } = {}) {
  const src = Object.hasOwn(RANK_ART_PATHS, rankId) ? RANK_ART_PATHS[rankId] : '';
  return src ? `<img class="rank-art" src="${src}" alt="" width="256" height="256" loading="${eager ? 'eager' : 'lazy'}" decoding="async" draggable="false">` : '';
}
