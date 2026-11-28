// Editorial prose is translatable; code/repository/hardware identifiers remain protected.
const prose=new Set(['ray-traced','ray-tracing','in-game','in-world','close-to-retail','open-world','all-amd','first-run','self-reported','real-time','off-screen','shader-heavy','stand-in','one-to-one','ai-generated','fan-made','proof-of-concept','frame-rate','wine-style','french-language','best-rated','top-rated','single-player','low-res']);
export const isProseCompound=s=>prose.has(s.toLowerCase())||/^\d+-(?:hour|year|day|month|week)(?:-old)?$/i.test(s);
export function editorialQualityIssue(source,ar){
 const text=ar.normalize('NFKC').replace(/[\u064B-\u065F\u0670]/g,'');
 if(/^Exclusive:/i.test(source)&&!/(?:حصري|خاص)/.test(text))return 'exclusive_label_omitted';
 if(/repository\s+and\s+[^.]{0,50}\baccount\b/i.test(source)&&!/(?:مستودع|المستودع)[\s\S]*و(?:ال)?حساب/.test(text))return 'repository_account_omitted';
 for(const word of source.match(/[A-Za-z0-9]+(?:[-_.][A-Za-z0-9]+)+/g)||[])if(isProseCompound(word)&&ar.toLowerCase().includes(word.toLowerCase()))return 'untranslated_prose';
 if(/\bshaders?\b/i.test(source)&&!/(?:تظليل|مظلل)/.test(text))return 'shader_terminology';
 if(/DMCA/.test(source)&&/إلقاء الضوء/.test(text))return 'dmca_terminology';
 if(/\ba traitor\b/i.test(source)&&!/(?:خائن|خيانة)/.test(text))return 'omitted_qualification';
 if(/vibecoders?/i.test(source)&&!/(?:ذكاء الاصطناعي|الذكاء الاصطناعي|Vibe)/i.test(text))return 'vibecoding_terminology';
 if(/ينطوح|(?:إلى|من)\s*fps|\bAI-(?:\s|[،.])/i.test(text))return 'invalid_fluency';
 if(/reach gameplay/i.test(source)&&/قابلية|قابليتها|قابل للعب/.test(text))return 'milestone_meaning_changed';
 if(/\bports?\b/i.test(source)&&!/\b(?:native|original)\b/i.test(source)&&/نسخة أصلية|نسخ أصلية|النسخة الأصلية/.test(text))return 'port_classification_changed';
 if(source.includes('Arion Kurtaj')&&!ar.includes('Arion Kurtaj'))return 'identifier_changed';
 if(/\bprobably\b/i.test(source)&&!/(?:ربما|الأرجح|غالبا|يرجح|قد)/.test(text))return 'certainty_changed';
 if(/\bhaven't\b/i.test(source)&&!/(?:لم|ليس|لا|غير|دون)/.test(text))return 'negation_changed';
 const account=/the ([A-Za-z0-9_.-]+) account/.exec(source);if(account&&text.includes(`على ${account[1]}`))return 'invented_platform';
 if(/rising to [\d.]+%/.test(source)&&/(?:ارتفع|يرتفع|ليرتفع) الأداء/.test(text))return 'score_meaning_changed';
 return null;
}
