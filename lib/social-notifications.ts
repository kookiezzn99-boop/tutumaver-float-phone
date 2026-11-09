import {kvGet,kvSet,registerKvMigration} from './kv-db';
export type SocialApp='twitter'|'diary'|'weverse'|'xiaohongshu'|'theqoo'|'question_box';
export const SOCIAL_APPS:Record<SocialApp,string>={twitter:'X',diary:'iCity',weverse:'WVS',xiaohongshu:'小红书',theqoo:'theqoo',question_box:'提问箱'};
export type SocialNotice={id:string;app:SocialApp;kind:'like'|'reply'|'dm'|'question'|'follow'|'save'|'live'|'post';targetId:string;targetType:string;at:number;accountId?:string;read:boolean;count:number;sourceIds?:string[]};
type State={enabled:Partial<Record<SocialApp,boolean>>;seen:string[];initialized:boolean;notices:SocialNotice[]};const KEY='ai_phone_social_notifications_v1';registerKvMigration(KEY);export const SOCIAL_NOTICE_UPDATED='social-notices-updated';
export function loadSocialNotices():State{try{return {...{enabled:{},seen:[],initialized:false,notices:[]},...JSON.parse(kvGet(KEY)||'{}')}}catch{return {enabled:{},seen:[],initialized:false,notices:[]}}}
function save(s:State){kvSet(KEY,JSON.stringify(s));if(typeof window!=='undefined')window.dispatchEvent(new Event(SOCIAL_NOTICE_UPDATED));}
export function enableSocialNotice(app:SocialApp,enabled:boolean){save({...loadSocialNotices(),enabled:{...loadSocialNotices().enabled,[app]:enabled}});}
export const socialNoticeText=(n:Pick<SocialNotice,'app'|'kind'>)=>SOCIAL_APPS[n.app]+({like:' 有新点赞',reply:' 有新回复',dm:' 有新私信',question:' 有新提问',follow:' 有新关注',save:' 有新收藏',live:' 有新直播',post:' 有新动态'}[n.kind]);
export function readSocialNotice(id?:string,app?:SocialApp){const s=loadSocialNotices(),chosen=s.notices.filter(n=>n.id===id||!id&&n.app===app);save({...s,notices:s.notices.map(n=>chosen.some(c=>c.id===n.id)?{...n,read:true}:n)});for(const [key,local,collection,field,event] of [['ai_phone_twitter_v1',false,'notices','read','twitter-updated'],['ai_phone_icity_v1',false,'notices','read','icity-updated'],['ii_phone_weverse_notifications_v1',true,'','read','weverse-updated'],['ai_phone_xiaohongshu_state_v1',false,'notifications','unread','xiaohongshu-updated']] as const){const value=raw(key,local),rows=collection?value[collection]:value;if(!Array.isArray(rows))continue;let changed=false;for(const row of rows)if(chosen.some(n=>(n.sourceIds||[n.id]).includes(n.app+':'+row.id))){row[field]=field!=='unread';changed=true;}if(changed){if(local)localStorage.setItem(key,JSON.stringify(value));else kvSet(key,JSON.stringify(value));window.dispatchEvent(new Event(event));}}}

export function readSocialTarget(app: SocialApp, targetId: string) { const state=loadSocialNotices(); if(!state.notices.some(n=>n.app===app&&n.targetId===targetId&&!n.read))return;save({...state,notices:state.notices.map(n=>n.app===app&&n.targetId===targetId?{...n,read:true}:n)});}
export function processSocialNotices(rows:SocialNotice[],now=Date.now()){
 const s=loadSocialNotices(),seen=new Set(s.seen),live=new Set(rows.map(r=>r.id)),fresh=rows.filter(r=>!seen.has(r.id)&&r.at<=now&&r.at>=now-120000&&!r.read);let notices=s.notices.filter(n=>(n.sourceIds||[n.id]).some(id=>live.has(id))).map(n=>({...n,read:n.read||(n.sourceIds||[n.id]).every(id=>rows.find(r=>r.id===id)?.read),sourceIds:(n.sourceIds||[n.id]).filter(id=>live.has(id)),count:(n.sourceIds||[n.id]).filter(id=>live.has(id)).length}));
 if(s.initialized)for(const row of fresh){const existing=(row.kind==='like'||row.kind==='save')?notices.find(n=>!n.read&&n.app===row.app&&n.kind===row.kind&&n.targetId===row.targetId&&n.accountId===row.accountId):undefined;if(existing){existing.count++;existing.sourceIds=[...(existing.sourceIds||[existing.id]),row.id];existing.at=row.at;}else notices=[{...row,count:row.count||1,sourceIds:[row.id]},...notices];}
 const next={...s,initialized:true,seen:[...new Set([...s.seen,...rows.map(r=>r.id)])].slice(-15000),notices:notices.slice(0,500)};
 if(JSON.stringify(next)!==JSON.stringify(s))save(next);
 if(s.initialized){const batches=new Map<SocialApp,SocialNotice>();for(const n of fresh){if(s.enabled[n.app]!==true)continue;const previous=batches.get(n.app);const latest=previous&&previous.at>n.at?previous:n;batches.set(n.app,{...latest,count:(previous?.count||0)+n.count});}for(const n of batches.values())window.dispatchEvent(new CustomEvent('social-message-notice',{detail:n}));}
}
function raw(key:string,local=false):any{try{return JSON.parse((local?localStorage.getItem(key):kvGet(key)||localStorage.getItem(key))||'{}')}catch{return {}}}
/** Read actual domain records only. No generated engagement totals, no network/model calls. */
export function collectSocialNotices():SocialNotice[]{const out:SocialNotice[]=[];const add=(app:SocialApp,id:string,kind:SocialNotice['kind'],targetId:string,targetType:string,at:number|string,accountId?:string,read=false)=>out.push({app,id:app+':'+id,kind,targetId,targetType,at:typeof at==='string'?Date.parse(at):at,accountId,read,count:1});
 const x=raw('ai_phone_twitter_v1');for(const n of x.notices||[]){const p=x.posts?.find((p:any)=>p.id===n.postId);const recipient=n.recipientId||p?.authorId;if(recipient?.startsWith('user')&&!n.actorId?.startsWith('user')&&['like','reply'].includes(n.kind))add('twitter',n.id,n.kind,n.postId,'post',n.createdAt,recipient,n.read===true);}for(const c of x.conversations||[])for(const m of c.messages||[])if(m.role==='character'&&!c.blocked)add('twitter',m.id,'dm',c.id,'dm',m.createdAt,c.userAccountId||'user');
 const city=raw('ai_phone_icity_v1');for(const n of city.notices||[])if(n.to==='user'&&(n.entry||n.book))add('diary',n.id,/喜欢/.test(n.text)?'like':'reply',n.entry||n.book,n.entry?'entry':'book',n.createdAt,undefined,n.read===true);
 const weverse=raw('ii_phone_weverse_notifications_v1',true);if(Array.isArray(weverse))for(const n of weverse){if(!n?.id||!n.targetId||!['post','live'].includes(n.targetType))continue;const kind=n.kind==='live'?'live':/Reply$/.test(n.kind)?'reply':'post';add('weverse',n.id,kind,n.targetId,n.targetType,n.createdAt,undefined,n.read===true)}

 const xhs=raw('ai_phone_xiaohongshu_state_v1');
 for(const n of xhs.notifications||[]){
  if(n.direction==='outgoing'||!['like','save','comment','dm','follow'].includes(n.type))continue;
  const dm=n.type==='dm',follow=n.type==='follow';
  const kind:SocialNotice['kind']=n.type==='comment'?'reply':n.type;
  const targetId=dm?(n.threadId?.trim()||`dm:${n.threadName?.trim()||n.actorName?.trim()||'小红书用户'}`):follow?'follow':n.noteId||'all';
  add('xiaohongshu',n.id,kind,targetId,dm?'dm':follow||!n.noteId?'messages':'post',n.createdAt,undefined,n.unread===false);
 }
 const qb=raw('ai_phone_question_box_v2');for(const b of qb.sessions||[])for(const q of b.questions||[]){if(b.ownerId==='user'&&q.senderId!=='user')add('question_box',q.id,'question',b.id,'session',q.createdAt);if(q.senderId==='user'&&q.answer)add('question_box',q.id+':answer','reply',b.id,'session',q.answer.createdAt);}
 return out.filter(n=>n.targetId&&Number.isFinite(n.at));}

