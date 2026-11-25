// Optional editorial translations. Exact source matching prevents stale translations after scout updates.
// This module never modifies tracker objects, identifiers, sources, scores or URLs.
let translations = {};
let reviewedTranslations={},newsTranslations={};
export function setContentTranslations(value = {},reviewed=value) {
  translations = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  reviewedTranslations=reviewed&&typeof reviewed==='object'&&!Array.isArray(reviewed)?reviewed:{};
}
export function setNewsTranslations(value={}) {newsTranslations=value?.version===1&&value.articles&&typeof value.articles==='object'?value.articles:{};}
export function newsText(value,id,field){
 if(typeof value!=='string')return value;
 if(Object.hasOwn(reviewedTranslations,value)&&typeof reviewedTranslations[value]==='string')return reviewedTranslations[value];
 const article=Object.hasOwn(newsTranslations,id)?newsTranslations[id]:null;
 const entry=article?.fields&&Object.hasOwn(article.fields,field)?article.fields[field]:null;
 return entry?.source===value&&typeof entry.ar==='string'&&entry.ar.trim()?entry.ar:contentText(value);
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
  setNewsTranslations();
  if (lang !== 'ar') return;
  try {
    const get=async file=>{try{const r=await fetch(new URL(`../i18n/content/${file}`,import.meta.url),{cache:'no-cache'});return r.ok?await r.json():{};}catch{return{};}};
    const [automatic,human,news]=await Promise.all([get('ar.auto.json'),get('ar.json'),get('../news/ar.json')]);
    setContentTranslations({...automatic,...human},human);setNewsTranslations(news);
  } catch { /* Optional content must never block the tracker or English fallback. */ }
}
