export const $ = id => document.getElementById(id);
export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const lines = text => String(text ?? '').split('\n').map(x => x.trim()).filter(Boolean);
export const list = values => `<ul>${(values || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;
export const uid = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
export const today = () => new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const STATUS = {'not-started':'未开始',active:'练习中',blocked:'待解决',review:'待复核',accepted:'已验收'};
export function download(name, data) { const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)+'\n'],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000); }
export async function request(path, options={}) { const res=await fetch(path,{cache:'no-store',signal:AbortSignal.timeout(20000),...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}});let data;try{data=await res.json();}catch{throw Error(`服务器响应无法读取（${res.status}）`);}if(!res.ok){const e=Error(data.error||`请求失败（${res.status}）`);e.status=res.status;e.code=data.code;throw e;}return{data,etag:res.headers.get('ETag')}; }
const KEY='embedded-study-theme-v1',media=matchMedia('(prefers-color-scheme: dark)');let preference=null;try{const stored=localStorage.getItem(KEY);if(['dark','light'].includes(stored))preference=stored;}catch{}
const themeLabels={dark:'深色',light:'浅色',system:'系统'};
const nextTheme=()=>preference==='dark'?'light':preference==='light'?null:'dark';
function applyTheme(){const dark=preference==='dark'||(preference===null&&media.matches);document.documentElement.dataset.theme=dark?'dark':'light';const button=$('theme');if(button){const current=preference||'system',next=nextTheme()||'system';button.textContent=themeLabels[current];const description=`当前主题：${current==='system'?`系统（当前为${dark?'深色':'浅色'}）`:current==='dark'?'深色':'浅色'}；点击切换为${next==='system'?'系统':next==='dark'?'深色':'浅色'}`;button.title=description;button.setAttribute('aria-label',description);}document.dispatchEvent(new Event('themechange'));}
$('theme')?.addEventListener('click',()=>{preference=nextTheme();try{if(preference===null)localStorage.removeItem(KEY);else localStorage.setItem(KEY,preference);}catch{}applyTheme();});media.addEventListener('change',()=>{if(preference===null)applyTheme();});applyTheme();
