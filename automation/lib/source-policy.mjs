// Source changes are never learned from site text. Integrate only a fetched, pinned upstream commit.
export function classifySourceChanges(files,lineCount){
 const content=files.filter(path=>path.startsWith('data/'));
 const source=files.filter(path=>!path.startsWith('data/'));
 const sensitive=source.filter(path=>!(/^(?:assets\/(?:css\/|img\/|i18n\/)|assets\/js\/(?:app|theme|news-shared|pinned)\.js$|index\.html$|README\.md$|EDITOR\.md$)/.test(path)));
 return{content,source,reviewRequired:sensitive.length>0||lineCount>350,reasons:[...sensitive.map(p=>`Sensitive or structural file: ${p}`),...(lineCount>350?['Large source patch (>350 changed lines)']:[])]};
}
