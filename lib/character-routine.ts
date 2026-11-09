import { loadChatSessions, loadChatContacts, loadChatMessages } from './chat-storage';
import {kvGet,kvSet,registerKvMigration} from './kv-db';
import {loadCharacters} from './character-storage';
import {loadOwnerCalendarPlans} from './calendar-storage';
import {formatZonedPromptTimestamp,getSystemTimeZone,normalizeTimeZone} from './character-time';
export const ROUTINE_KEY='ai_phone_character_routines_v1';
const CYCLE_KEY='ai_phone_sleep_cycles_v1';
registerKvMigration(ROUTINE_KEY);registerKvMigration(CYCLE_KEY);
export type CharacterRoutine={enabled:boolean;sleepFrom:string;sleepTo:string;minHours:number;maxHours:number;regularity:'regular'|'flexible';};
export const DEFAULT_ROUTINE:CharacterRoutine={enabled:false,sleepFrom:'00:00',sleepTo:'02:00',minHours:6,maxHours:8,regularity:'flexible'};
export function loadCharacterRoutine(id:string):CharacterRoutine {try{return {...DEFAULT_ROUTINE,...JSON.parse(kvGet(ROUTINE_KEY)||'{}')[id]};}catch{return {...DEFAULT_ROUTINE};}}
export function saveCharacterRoutine(id:string,value:CharacterRoutine){let all:Record<string,CharacterRoutine>={};try{all=JSON.parse(kvGet(ROUTINE_KEY)||'{}');}catch{}all[id]=value;kvSet(ROUTINE_KEY,JSON.stringify(all));try{const cycles=JSON.parse(kvGet(CYCLE_KEY)||'{}');for(const key of Object.keys(cycles))if(key.startsWith(id+':')&&cycles[key].start>Date.now())delete cycles[key];kvSet(CYCLE_KEY,JSON.stringify(cycles));}catch{}}
function minute(s:string){const [h,m]=s.split(':').map(Number);return (Number.isFinite(h)&&Number.isFinite(m))?h*60+m:0;}
export function zonedEpoch(stamp:number,zone:string){let real=stamp;for(let i=0;i<4;i++){const local=Date.parse(formatZonedPromptTimestamp(new Date(real),zone).replace(' ','T')+':00Z');real+=stamp-local;}return real;}
export type SleepState={sleeping:boolean;briefAwake:boolean;endsAt:number;cycleId:string};
/** Persist the random seed of a cycle; calendar changes adjust availability without re-rolling. */
export function getCharacterSleep(id:string,at=new Date()):SleepState|null{
 const r=loadCharacterRoutine(id);if(!r.enabled)return null;
 const zone=normalizeTimeZone(loadCharacters().find(c=>c.id===id)?.timeZone)||getSystemTimeZone();
 const now=at.getTime(),wall=Date.parse(formatZonedPromptTimestamp(at,zone).slice(0,10)+'T00:00:00Z');
 let cycles:Record<string,{start:number;duration:number;night:number}>={};try{cycles=JSON.parse(kvGet(CYCLE_KEY)||'{}');}catch{}
 const work=loadOwnerCalendarPlans('character',id).flatMap(p=>p.items).filter(i=>i.kind!=='milestone'&&(i.busyLevel||(i.source==='manual'?1:/工作|拍摄|录制|演出|彩排|会议|采访|课程|训练|上班|夜班/.test(i.title)?3:2))>=2).map(i=>{let start=zonedEpoch(Date.parse(`${i.date}T${i.startTime}:00Z`),zone),end=zonedEpoch(Date.parse(`${i.date}T${i.endTime}:00Z`),zone);if(end<=start)end=zonedEpoch(Date.parse(`${i.date}T${i.endTime}:00Z`)+86400000,zone);return {start,end};}).sort((a,b)=>a.start-b.start);
 let changed=false;
 for(let d=-2;d<=1;d++){
  const day=wall+d*86400000,key=id+':'+new Date(day).toISOString().slice(0,10);let c=cycles[key];
  if(!c){let from=minute(r.sleepFrom),to=minute(r.sleepTo);if(to<from)to+=1440;const spread=r.regularity==='regular'?.35:1,mid=(from+to)/2;const m=mid+(Math.random()-.5)*(to-from)*spread;c={start:zonedEpoch(day+Math.round(m)*60000,zone),duration:(Math.max(1,r.minHours)+Math.random()*Math.max(0,r.maxHours-r.minHours))*3600000,night:Math.random()};cycles[key]=c;changed=true;}
  let start=c.start,end=start+c.duration;
  // An already active conversation may postpone this one persisted sleep cycle.
  const contacts=loadChatContacts().filter(x=>x.characterId===id).map(x=>x.id);
  const history=loadChatSessions().filter(x=>!x.isGroup&&(x.contactId===id||contacts.includes(x.contactId))).flatMap(x=>loadChatMessages(x.id,30)).filter(m=>!m.isRetracted&&(m.role==='user'||m.role==='assistant')&&Date.parse(m.createdAt)<=now).sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt));
  const recent=history.filter(m=>Date.parse(m.createdAt)>=now-12*60000);
  const engaged=recent.some(m=>m.role==='user')&&recent.some(m=>m.role==='assistant')&&!recent.slice(-3).some(m=>/^(晚安[。！!～~ ]*|good night[.! ]*)$/i.test(m.content.trim()));
  let to=minute(r.sleepTo);if(to<minute(r.sleepFrom))to+=1440;
  const latest=zonedEpoch(day+to*60000,zone);
  const saved=c as typeof c & {postponedUntil?:number};
  if(engaged&&now>=c.start-12*60000&&now<=latest+15*60000){const defer=Math.min(latest+15*60000,Date.parse(recent[recent.length-1].createdAt)+12*60000);if(defer>(saved.postponedUntil||c.start)){saved.postponedUntil=defer;changed=true;}}
  start=Math.max(start,saved.postponedUntil||start);end=start+c.duration;
  for(const event of work){if(event.end<=start||event.start>=end)continue;if(event.start<=start+30*60000){start=event.end+30*60000;end=start+c.duration;}else{end=event.start-30*60000;}}
  // A short wake window is only an opportunity, never an automatic outgoing message.
  const wakeAt=start+(end-start)*.55,hasWake=c.night<(r.regularity==='regular'?.12:.35),brief=hasWake&&now>=wakeAt&&now<wakeAt+8*60000;
  if(now>=start&&now<end){if(changed)kvSet(CYCLE_KEY,JSON.stringify(cycles));return {sleeping:!brief,briefAwake:brief,endsAt:brief?wakeAt+8*60000:end,cycleId:key};}
 }
 if(changed){const cutoff=new Date(wall-7*86400000).toISOString().slice(0,10);cycles=Object.fromEntries(Object.entries(cycles).filter(([k])=>k.slice(-10)>=cutoff));kvSet(CYCLE_KEY,JSON.stringify(cycles));}return null;
}

export function routineConversationPrompt(id:string):string {
 const r=loadCharacterRoutine(id);if(!r.enabled)return '';
 return `\n【弹性作息】通常在角色当地时间 ${r.sleepFrom}～${r.sleepTo} 之间自然准备入睡。这是浮动范围，不是到最早时间必须说晚安的指令。正在来回聊天时先接住话题，可自然表达困意或今晚晚点睡；不要机械催睡或突然结束。对方明确道别或话题告一段落后再自然休息；不要把刚才仍在聊的人写成已经睡着。`;
}
