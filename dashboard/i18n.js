// The private dashboard is never deployed. Localize its UI without touching editable or user-authored text.
import { initI18n, getLang, t } from '../assets/js/i18n.js';
await initI18n();
if (getLang() === 'ar') {
  document.querySelector('#pin-input')?.setAttribute('dir','auto');
  for (const el of document.querySelectorAll('input[type="email"],input[type="password"]')) el.setAttribute('dir','ltr');
  const response = await fetch(new URL('../assets/i18n/dashboard/ar.json', import.meta.url), {cache:'no-cache'}).catch(()=>null);
  const dictionary = response?.ok ? await response.json().catch(()=>({})) : {};
  const translate = (source) => {
    if (Object.hasOwn(dictionary,source)) return dictionary[source];
    const patterns = [
      [/^(\d+)m ago$/, (_,n)=>t('time.minutes',{n})],
      [/^(\d+)h ago$/, (_,n)=>t('time.hours',{n})],
      [/^(\d+)d ago$/, (_,n)=>t('time.days',{n})],
      [/^Couldn't count live visitors: (.*)$/,(_,msg)=>`تعذر إحصاء المتابعين الآن: ${msg}`],
      [/^Stats error: (.*)$/,(_,msg)=>`خطأ في الإحصاءات: ${msg}`],
      [/^active in the last (\d+) minutes · (.*)$/,(_,n,time)=>`نشطون خلال آخر ${n} دقائق · ${time}`],
      [/^Admin · updated (.*)$/,(_,time)=>`المسؤول · آخر تحديث ${time}`],
      [/^GitHub answered HTTP (\d+)\.$/,(_,code)=>`أجاب GitHub برمز HTTP ${code}.`],
      [/^(.*) isn't the admin of this site\. Only the first account to sign in becomes admin\.$/,(_,email)=>`الحساب ${email} ليس مسؤول هذا الموقع. يصبح أول حساب يسجل الدخول هو المسؤول فقط.`],
      [/^· held: (.*)$/,(_,reason)=>`· قيد المراجعة: ${reason}`],
      [/^(.*): (\d+) views, (\d+) visitors$/,(_,label,views,visitors)=>`${label}: ${views} مشاهدة، ${visitors} زائر`],
    ];
    for (const [pattern,fn] of patterns) if (pattern.test(source)) return source.replace(pattern,fn);
    return source;
  };
  const update = (root) => {
    if (root.nodeType===Node.TEXT_NODE) {
      if (!root.parentElement || root.parentElement.closest('script,style,textarea,.p-body,.pin-text,.lang-pick,.theme-pick')) return;
      const source=root.textContent.trim().replace(/\s+/g,' ');
      const value=translate(source);
      if (source && value!==source) root.textContent=root.textContent.replace(root.textContent.trim(),value);
      return;
    }
    if (root.nodeType!==Node.ELEMENT_NODE && root!==document) return;
    for (const el of root.querySelectorAll('[placeholder],[aria-label]')) for (const attr of ['placeholder','aria-label']) {
      const source=el.getAttribute(attr);if(source) {const value=translate(source);if(value!==source)el.setAttribute(attr,value);}
    }
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
    nodes.forEach(update);
  };
  update(document);
  new MutationObserver(records=>{
    for (const record of records) {
      if(record.type==='characterData')update(record.target);
      else for(const node of record.addedNodes)update(node);
    }
  }).observe(document.body,{subtree:true,childList:true,characterData:true});
}
