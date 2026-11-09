import {dispatchAppBack} from "./back-navigation";
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
export const isAndroidApp = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
const SERVICE_KEY='float_android_service_origin_v1';
export function readAndroidServiceOrigin(){try{return localStorage.getItem(SERVICE_KEY)||'';}catch{return '';}}
export function normalizeAndroidServiceOrigin(value:string){if(!value.trim())return '';const u=new URL(value.trim());if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw new Error('请填写 HTTPS 网站根地址，不含路径、密码或参数。');return u.origin;}
export function saveAndroidServiceOrigin(value:string){const next=normalizeAndroidServiceOrigin(value);localStorage.setItem(SERVICE_KEY,next);return next;}
function decodeBase64(value:string){const binary=atob(value),data=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)data[i]=binary.charCodeAt(i);return data;}
let installed=false;
export function installAndroidRuntime(){
 if(installed||!isAndroidApp())return;installed=true;
 const originalFetch=window.fetch.bind(window);
 window.fetch=async(input,init)=>{
  const request=new Request(input,init),url=new URL(request.url);
  if(url.origin!==location.origin||!url.pathname.startsWith('/api/'))return originalFetch(input,init);
  const origin=readAndroidServiceOrigin();
  if(!origin)return new Response(JSON.stringify({error:'此功能需要网站服务，请在设置 → 安卓应用中填写原网站地址。'}),{status:503,headers:{'Content-Type':'application/json'}});
  if(request.signal.aborted)throw new DOMException('Aborted','AbortError');
  // Keep API keys/URLs scoped to requests already targeting our own server routes.
  const headers=Object.fromEntries(request.headers.entries());
  const method=request.method;let data:unknown;
  if(!['GET','HEAD'].includes(method)){
    const type=request.headers.get('content-type')||'';
    if(type.includes('multipart/form-data'))return new Response(JSON.stringify({error:'安卓版暂不支持此服务器表单上传；请使用网页端。'}),{status:501,headers:{'Content-Type':'application/json'}});
    const body=await request.text();data=type.includes('application/json')&&body?JSON.parse(body):body;
  }
  const pending=CapacitorHttp.request({url:origin+url.pathname+url.search,method,headers,data,responseType:'arraybuffer',connectTimeout:30000,readTimeout:180000,disableRedirects:true});
  const response=await new Promise<Awaited<typeof pending>>((resolve,reject)=>{
    const abort=()=>reject(new DOMException('Aborted','AbortError'));request.signal.addEventListener('abort',abort,{once:true});
    pending.then(resolve,reject).finally(()=>request.signal.removeEventListener('abort',abort));
  });
  if(response.status>=300&&response.status<400)throw new Error('网站服务发生重定向，请使用最终的 HTTPS 根地址。');
  const contentType=Object.entries(response.headers).find(([key])=>key.toLowerCase()==='content-type')?.[1]||'';
  const body=contentType.includes('json')?new TextEncoder().encode(JSON.stringify(response.data)):response.status>=400?new TextEncoder().encode(String(response.data)):decodeBase64(String(response.data));
  return new Response([204,205,304].includes(response.status)?null:body,{status:response.status,headers:response.headers});
 };
 // Native WebView does not download blob: links itself; use Android's share/save sheet.
 document.addEventListener('click',event=>{
  const link=(event.target as Element|null)?.closest?.('a[download]') as HTMLAnchorElement|null;
  if(!link||!link.href.startsWith('blob:'))return;event.preventDefault();
  void (async()=>{const blob=await originalFetch(link.href).then(r=>r.blob());
   const safe=(link.download||'float-export').replace(/[^\p{L}\p{N}._-]/gu,'_');const name=`exports/${Date.now()}-${safe}`;
   const chunk=512*1024;
   for(let offset=0;offset<blob.size;offset+=chunk){const part=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob.slice(offset,offset+chunk));});
    if(offset===0)await Filesystem.writeFile({path:name,directory:Directory.Cache,data:part,recursive:true});else await Filesystem.appendFile({path:name,directory:Directory.Cache,data:part});
   }
   if(blob.size===0)await Filesystem.writeFile({path:name,directory:Directory.Cache,data:'',recursive:true});
   const file=await Filesystem.getUri({path:name,directory:Directory.Cache});await Share.share({title:safe,files:[file.uri]});
  })().catch(error=>window.alert(`导出失败：${error instanceof Error?error.message:String(error)}`));
 },true);
 void App.addListener('backButton', ({ canGoBack }) => {
  if (dispatchAppBack()) return;
  if (canGoBack) history.back();
  else if (window.confirm('退出 float？本地数据会保留。')) void App.exitApp();
 });
 // No service worker in the APK: every launch must use its bundled version.
}
