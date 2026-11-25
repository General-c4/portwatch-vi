// Optional editorial translations. Exact source matching prevents stale translations after scout updates.
// This module never modifies tracker objects, identifiers, sources, scores or URLs.
let translations = {};
export function setContentTranslations(value = {}) {
  translations = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
export function contentText(value) {
  if (typeof value !== 'string') return value;
  if (Object.hasOwn(translations, value) && typeof translations[value] === 'string') return translations[value];
  // The scout emits this fixed sentence. Translate its grammar while retaining the exact repo and score.
  if (Object.keys(translations).length) {
    const match = /^Scout spotted ([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+) \((possible effort|tool), substance (\d+)\)\.$/.exec(value);
    if (match) return `رصد الكاشف \u2068${match[1]}\u2069 (${match[2] === 'tool' ? 'أداة' : 'مشروع محتمل'}، المحتوى التقني ${match[3]}).`;
  }
  return value;
}
export async function loadContentTranslations(lang) {
  setContentTranslations();
  if (lang !== 'ar') return;
  try {
    const response = await fetch(new URL('../i18n/content/ar.json', import.meta.url), { cache: 'no-cache' });
    if (response.ok) setContentTranslations(await response.json());
  } catch { /* Optional content must never block the tracker or English fallback. */ }
}
