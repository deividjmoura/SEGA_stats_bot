// Optional web evidence for current MLBB patch/meta questions.
// Default OFF. Fixed Brave Search endpoint, allowlisted sources, timeouts and
// short sanitized snippets prevent arbitrary URL fetching and prompt injection.
const SEARCH_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';
const DEFAULT_DOMAINS = [
  'mobilelegends.com', 'oneesports.gg', 'liquipedia.net', 'esports.gg',
  'dotesports.com',
];
function safeText(s,max) {
  return String(s ?? '').replace(/<[^>]{1,200}>/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
}
export function allowedWebHost(url, domains = DEFAULT_DOMAINS) {
  try {
    const uri = new URL(url);
    if (uri.protocol !== 'https:' || uri.username || uri.password || uri.port ||
        uri.hostname.length > 160) return false;
    const host=uri.hostname.toLowerCase();
    return domains.some(d => host===d || host.endsWith('.'+d));
  } catch { return false; }
}
export function createNoxBraveSearch({
  env=process.env, fetchImpl=globalThis.fetch, timeoutMs=6500,
}={}) {
  const key=String(env.NOX_AI_SEARCH_API_KEY||'');
  const enabled=env.NOX_AI_WEB_SEARCH_ENABLED==='true' && Boolean(key);
  const domains=String(env.NOX_AI_SEARCH_DOMAINS||'').split(',')
    .map(d=>d.trim().toLowerCase()).filter(d=>/^[a-z0-9.-]{4,90}$/.test(d));
  const allowed=domains.length?domains:DEFAULT_DOMAINS;
  return async function search({question,hero=null}={}) {
    if(!enabled || typeof fetchImpl!=='function')return [];
    const q=safeText((hero ? hero + ' ' : '')+'Mobile Legends Bang Bang '+
      safeText(question,210),300);
    if(!q)return [];
    const url=new URL(SEARCH_ENDPOINT);
    url.searchParams.set('q',q);
    url.searchParams.set('count','8');
    url.searchParams.set('search_lang','pt');
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),Math.max(3000,Math.min(timeoutMs,10000)));
    try{
      const response=await fetchImpl(url.href,{
        method:'GET',
        signal:controller.signal,
        headers:{'Accept':'application/json','X-Subscription-Token':key},
      });
      if(!response?.ok)return [];
      const data=await response.json();
      const items=Array.isArray(data?.web?.results)?data.web.results:[];
      const seen=new Set();
      return items.filter(item=>{
        if(!allowedWebHost(item?.url,allowed))return false;
        const host=new URL(item.url).hostname.toLowerCase();
        if(seen.has(host))return false; // diversify sources
        seen.add(host);
        return true;
      }).slice(0,4).map(item=>({
        title:safeText(item.title,130)||'Fonte MLBB',
        url:String(item.url).slice(0,400),
        snippet:safeText(item.description,300),
      }));
    }catch {return [];}
    finally{clearTimeout(timer);}
  };
}
