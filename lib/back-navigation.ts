import {useEffect,useRef} from 'react';
type Entry={run:()=>void;active:()=>boolean;priority:number;id:symbol};
const entries:Entry[]=[];
export function registerBack(run:()=>void,active:()=>boolean=()=>true,priority=10){const entry={run,active,priority,id:Symbol()};entries.push(entry);return()=>{const i=entries.indexOf(entry);if(i>=0)entries.splice(i,1);};}
export function useAppBack(run:()=>void,active:()=>boolean=()=>true,priority=10){const latest=useRef({run,active});latest.current={run,active};useEffect(()=>registerBack(()=>latest.current.run(),()=>latest.current.active(),priority),[priority]);}
export function dispatchAppBack(){
 if(document.body.dataset.reverseActive==='true')return true;
 const dialogs=Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"],.modal-overlay')).filter(e=>e.getClientRects().length);
 if(dialogs.length){const top=dialogs.at(-1)!;const close=Array.from(top.querySelectorAll<HTMLButtonElement>('button')).find(b=>!b.disabled&&b.getClientRects().length&&/^(关闭|取消|返回|结束|×|✕|✖)/.test(b.getAttribute('aria-label')||b.textContent?.trim()||''));close?.click();return true;}

 const candidates=entries.map((entry,i)=>({...entry,order:i})).filter(e=>{try{return e.active();}catch{return false;}}).sort((a,b)=>b.priority-a.priority||b.order-a.order);
 if(candidates[0]?.priority>1){candidates[0].run();return true;}
 const activeShell = document.querySelector<HTMLElement>('.phone-shell[data-active-app]:not([data-active-app=""])');
 if (activeShell) {
  const visiblePanes = Array.from(activeShell.querySelectorAll<HTMLElement>('.phone-app-pane')).filter(pane => pane.getClientRects().length > 0);
  const pane = visiblePanes.at(-1) ?? activeShell;
  const back = Array.from(pane.querySelectorAll<HTMLButtonElement>('button[data-app-back], button[aria-label^="返回"], button[aria-label="Back"]'))
   .reverse().find(button => button.getClientRects().length && !button.disabled && button.getAttribute('aria-label') !== '返回桌面');
  if (back) { back.click(); return true; }
 }
 if(candidates.length){candidates[0].run();return true;}return false;
}
