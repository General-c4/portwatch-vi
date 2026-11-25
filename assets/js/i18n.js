// Interface translations for the public pages (index.html, board.html).
// UI strings live in assets/i18n/<code>.json; en.json is the fallback for any key a language lacks.
// Canonical tracker data stays in English; Arabic editorial text uses the optional content catalog.
// Milestone, groundwork and stability names come from scoring.js in English and are translated under
// the ms.*, gw.* and stab.* keys of each non-English file. See assets/i18n/README.md.

import { loadContentTranslations } from './content-i18n.js';

export const LANGS = [
  { code: 'en', name: 'English', short: 'EN' },
  { code: 'pt-BR', name: 'Português (Brasil)', short: 'PT' },
  { code: 'es', name: 'Español', short: 'ES' },
  { code: 'ar', name: 'العربية', short: 'AR' },
];
const KEY = 'pw-lang';
const CODES = LANGS.map((l) => l.code);

let lang = 'en';
let dict = {};
let en = {};

export const getLang = () => lang;
// For dates and numbers. English keeps the browser's own locale (en-GB, en-US…), as before.
export const locale = () => (lang === 'en' ? undefined : lang);

function savedLang() {
  try { const v = localStorage.getItem(KEY); return CODES.includes(v) ? v : null; } catch { return null; }
}

// Saved choice first, then the first browser language we have, else English.
export function pickLang() {
  const saved = savedLang();
  if (saved) return saved;
  for (const l of navigator.languages?.length ? navigator.languages : [navigator.language || 'en']) {
    const low = String(l).toLowerCase();
    if (low === 'ar' || low.startsWith('ar-')) return 'ar';
    if (low.startsWith('pt')) return 'pt-BR';
    if (low.startsWith('es')) return 'es';
    if (low.startsWith('en')) return 'en';
  }
  return 'en';
}

async function load(code) {
  const res = await fetch(new URL(`../i18n/${code}.json`, import.meta.url), { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${code}.json: HTTP ${res.status}`);
  return res.json();
}

// Never throws: if a language file can't load, the page stays in English.
export async function initI18n() {
  lang = pickLang();
  const [base, own] = await Promise.all([
    load('en').catch(() => ({})),
    lang === 'en' ? null : load(lang).catch(() => null),
  ]);
  en = base;
  if (lang !== 'en' && !own) lang = 'en';
  dict = lang === 'en' ? en : own;
  if(lang==='ar'){
    const [automatic,autoSources,reviewedSources]=await Promise.all([load('ar.auto').catch(()=>({})),load('ar.auto.sources').catch(()=>({})),load('ar.sources').catch(()=>({}))]);
    const validAuto=Object.fromEntries(Object.entries(automatic).filter(([key])=>autoSources[key]===en[key]));
    const validHuman=Object.fromEntries(Object.entries(dict).filter(([key])=>reviewedSources[key]===undefined||reviewedSources[key]===en[key]));
    dict={...validAuto,...validHuman};
  }
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  await loadContentTranslations(lang);
  if (lang !== 'en') applyStatic();
  if (typeof window.pwSetThemeLabels === 'function') {
    window.pwSetThemeLabels({ system: t('theme.system'), light: t('theme.light'), dark: t('theme.dark') }, t('theme.label'));
  }
  mountPicker();
}

// Isolate substitutions from surrounding Arabic; values remain plain text and callers still escape HTML.
const fill = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? (lang === 'ar' ? `\u2068${vars[k]}\u2069` : String(vars[k])) : m)) : s);

// Active language, then English, then the key itself.
export function t(key, vars) {
  if (lang === 'ar' && vars && 'n' in vars) {
    const n = Number(String(vars.n).replace(/[٠-٩]/g, (c) => '٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/[,٬]/g, ''));
    const counted = Number.isFinite(n) ? dict[`${key}_${new Intl.PluralRules('ar').select(n)}`] : null;
    if (typeof counted === 'string') return fill(counted, vars);
  }
  return fill(dict[key] ?? en[key] ?? key, vars);
}

// For strings whose English lives in code (scoring.js): the active language's translation, else that English.
export function tr(key, english, vars) {
  return fill(lang !== 'en' && typeof dict[key] === 'string' ? dict[key] : english, vars);
}

// Arabic uses all six CLDR categories; existing languages retain one/other selection.
export function tn(key, n, vars) {
  const form = lang === 'ar' ? new Intl.PluralRules('ar').select(n) : n === 1 ? 'one' : 'other';
  return t(`${key}_${dict[`${key}_${form}`] ? form : n === 1 ? 'one' : 'other'}`, { n, ...vars });
}

// Static markup: data-i18n="key" sets the text; data-i18n-attr="title:key;aria-label:key2" sets attributes.
// Translations are always inserted as text, never as HTML.
export function applyStatic(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of el.dataset.i18nAttr.split(';')) {
      const [attr, key] = pair.split(':').map((s) => s.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    }
  }
}

const GLOBE = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M1.8 8h12.4M8 1.6c1.8 1.9 2.6 4 2.6 6.4S9.8 12.5 8 14.4M8 1.6C6.2 3.5 5.4 5.6 5.4 8s.8 4.5 2.6 6.4" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
const escText = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Language menu in the nav bar, next to the theme menu and styled like it. Choosing a language saves it and reloads.
function mountPicker() {
  const nav = document.querySelector('.nav-inner');
  if (!nav || nav.querySelector('.lang-pick')) return;
  const cur = LANGS.find((l) => l.code === lang) || LANGS[0];
  const label = `${t('lang.label')}: ${cur.name}`;
  const wrap = document.createElement('div');
  wrap.className = 'lang-pick';
  wrap.innerHTML =
    `<button type="button" class="lang-btn" aria-haspopup="true" aria-expanded="false" aria-label="${escText(label)}" title="${escText(label)}">${GLOBE}<span>${cur.short}</span></button>` +
    '<div class="theme-menu lang-menu" role="menu" hidden>' +
    LANGS.map((l) => `<button type="button" role="menuitemradio" lang="${l.code}" data-lang="${l.code}" aria-checked="${l.code === lang}"><span>${escText(l.name)}</span></button>`).join('') +
    `<p class="lang-note">${escText(t('lang.note'))}</p></div>`;
  nav.insertBefore(wrap, nav.querySelector('.theme-pick'));

  const btn = wrap.querySelector('.lang-btn');
  const menu = wrap.querySelector('.lang-menu');
  const items = () => [...menu.querySelectorAll('[data-lang]')];
  const open = (v) => {
    menu.hidden = !v;
    btn.setAttribute('aria-expanded', String(v));
    if (v) (menu.querySelector('[aria-checked="true"]') || items()[0]).focus();
  };
  btn.addEventListener('click', () => open(menu.hidden));
  menu.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-lang]');
    if (!b) return;
    const code = b.dataset.lang;
    try { localStorage.setItem(KEY, code); } catch { /* the choice lasts for this page only */ }
    if (code === lang) { open(false); btn.focus(); return; }
    location.reload();
  });
  document.addEventListener('click', (ev) => { if (!wrap.contains(ev.target)) open(false); });
  wrap.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !menu.hidden) { open(false); btn.focus(); }
    if ((ev.key === 'ArrowDown' || ev.key === 'ArrowUp') && !menu.hidden) {
      ev.preventDefault();
      const list = items();
      const i = list.indexOf(document.activeElement);
      list[(i + (ev.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length].focus();
    }
  });
}
