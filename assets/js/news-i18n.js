// Enhance generated English articles in place, retaining canonical paths, source links and no-JS content.
import { initI18n, getLang, t, tr, locale } from './i18n.js';
import { contentText } from './content-i18n.js';

await initI18n();
if (getLang() !== 'en') {
  const labels = {
    'Race':'nav.race', 'News':'news.title', 'Scoring':'nav.scoring',
    'Sources':'news.sources', 'All news':'news.all', "What's happening":'news.kicker',
    'Written automatically by Claude from the linked sources.':'news.byClaude',
    'Written by PortWatch from the linked sources.':'news.byPortWatch',
    'Reported by PortWatch; not yet confirmed by a public source.':'news.byReport',
    'More news':'news.more', 'Live tracker':'hero.live', 'RSS feed':'news.rss',
    'News RSS feed':'news.rss', 'No stories yet.':'news.empty',
    'GTA VI on PC: the news':'news.pageTitle',
    'Breadcrumb':'news.breadcrumb',
    'Every PortWatch VI story about the leaked GTA VI build and PC ports: takedowns, legal news, scams and real port milestones, with links to the original reporting.':'news.archiveDescription',
    'Does GTA VI run on PC yet? See the live tracker.':'news.tracker',
  };
  const translate = (text) => labels[text] ? t(labels[text]) : contentText(text);
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    if (node.parentElement.closest('script,style,.lang-pick,.theme-pick')) continue;
    const source = node.textContent.trim();
    let value = translate(source);
    const category = /^(Leak|Takedown|Legal|Security|Official|Port|Safety)\s*·$/.exec(source);
    if (category) value = `${tr(`cat.${category[1]}`, category[1])} ·`;
    if (source === 'Image:') value = t('news.image');
    if (node.parentElement.closest('.sources li')) {
      const colon = source.indexOf(': ');
      if (colon >= 0) value = source.slice(0, colon + 2) + contentText(source.slice(colon + 2));
    }
    if (node.parentElement.closest('.sources .fine')) {
      for (const [english,key] of Object.entries(labels)) {
        if (english.startsWith('Written ') || english.startsWith('Reported ')) value = value.replace(english,t(key));
      }
    }
    if (source.startsWith('Fan-made tracker. Not affiliated')) value = t('footer.disclaimer');
    if (source.startsWith('The moves that matter around the leak:')) value = t('news.sub');
    if (source && value !== source) node.textContent = node.textContent.replace(source, value);
  }
  for (const el of document.querySelectorAll('.story-cat')) el.textContent = tr(`cat.${el.textContent}`, el.textContent);
  for (const el of document.querySelectorAll('time[datetime]')) {
    el.textContent = new Date(`${el.dateTime}T12:00:00Z`).toLocaleDateString(locale(), {day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
  }
  const heading = document.querySelector('.reader-page h1');
  if (heading) document.title = `${heading.textContent} · PortWatch VI`;
  else document.title = `${t('news.pageTitle')} · PortWatch VI`;
  for (const el of document.querySelectorAll('meta[name="description"],meta[property="og:title"],meta[property="og:description"]')) {
    const source = el.content;
    const suffix = ' · PortWatch VI';
    el.content = source.endsWith(suffix) ? `${translate(source.slice(0,-suffix.length))}${suffix}` : translate(source);
  }
  document.querySelector('.brand')?.setAttribute('aria-label',t('nav.home'));
  document.querySelector('.nav-links')?.setAttribute('aria-label',t('nav.sections'));
  document.querySelector('.crumbs')?.setAttribute('aria-label',t('news.breadcrumb'));
}
