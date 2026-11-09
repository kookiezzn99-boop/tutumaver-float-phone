import {kvGet,kvSet,registerKvMigration} from './kv-db';
export const NOVEL_NPC_AVATAR='/npc-default-avatar.png';
export const NOVEL_KEY='ai_phone_novelnow_v1';registerKvMigration(NOVEL_KEY);
export const novelId=()=>globalThis.crypto?.randomUUID?.()||'novel_'+Date.now().toString(36)+'_'+Array.from(globalThis.crypto.getRandomValues(new Uint8Array(12)),v=>v.toString(16).padStart(2,'0')).join('');
export type NovelStyle={id:string;name:string;content:string;worldBookIds?:string[]};
export type NovelRelation={from:string;to:string;kind:string};
export type NovelSpec={tagMatch?:"all"|"any";people:string[];supportingPeople?:string[];relationNotes?:string;outlineHint?:string;relations:NovelRelation[];referenceRelations:boolean;tags:string[];exclude:string[];world:string;perspective:string;tone:string;length:string;totalMin:number;totalMax:number;min:number;max:number;language:string;styleIds:string[];requirements:string};
export type NovelComment={id:string;author:string;text:string;zh?:string;at:number;rating?:number;own?:boolean};
export type NovelChapter={id:string;title:string;titleZh?:string;text:string;zh?:string;translations?:Record<string,{title:string;text:string}>;published:boolean;previous?:{title:string;text:string;zh?:string};comments:NovelComment[];at:number};
export type NovelBook={id:string;title:string;titleZh?:string;author:string;originLanguage?:string;description:string;descriptionZh?:string;cover:string;mine:boolean;saved:boolean;finished:boolean;spec:NovelSpec;styleSnapshot?:NovelStyle;outline:string;summary:string;state:string;threads:string;contextDirty?:boolean;chapters:NovelChapter[];reviews:NovelComment[];zoneIds:string[];at:number;updatedAt:number};
export type NovelPost={id:string;zoneId:string;author:string;text:string;zh?:string;comments:NovelComment[];saved:boolean;liked:boolean;at:number};
export type NovelZone={id:string;name:string;spec:NovelSpec};
export type NovelState={version:1;pen:string;bio:string;avatar:string;langs:string[];postTranslationView?:'replace'|'expand';tagGroups:Record<string,string[]>;styles:NovelStyle[];defaultStyleIds:string[];defaultRange:[number,number];books:NovelBook[];posts:NovelPost[];zones:NovelZone[];drafts:Record<string,string>};
export function defaultNovelSpec():NovelSpec{return{people:[],supportingPeople:[],relationNotes:'',outlineHint:'',relations:[],referenceRelations:false,tags:[],exclude:[],world:'',perspective:'第三人称',tone:'',length:'短篇',totalMin:5000,totalMax:15000,min:2000,max:3500,language:'跟随系统',styleIds:[],requirements:''}}
export function emptyNovelState():NovelState{return{version:1,pen:'未命名作者',bio:'',avatar:'',langs:['简中'],postTranslationView:'expand',tagGroups:{},styles:[],defaultStyleIds:[],defaultRange:[2000,3500],books:[],posts:[],zones:[],drafts:{}}}
export function loadNovel():NovelState{try{const raw=kvGet(NOVEL_KEY);if(raw){const n=JSON.parse(raw);return{...emptyNovelState(),...n,tagGroups:normalizeNovelTagGroups(n.tagGroups),books:Array.isArray(n.books)?n.books:[],posts:Array.isArray(n.posts)?n.posts:[],zones:Array.isArray(n.zones)?n.zones:[]}}}catch{}return emptyNovelState()}
export function saveNovel(s:NovelState){kvSet(NOVEL_KEY,JSON.stringify(s));window.dispatchEvent(new Event('novelnow-updated'))}
export function newNovelBook(s:NovelState):NovelBook{const spec=defaultNovelSpec();spec.styleIds=s.defaultStyleIds.slice(0,1);[spec.min,spec.max]=s.defaultRange;return{id:novelId(),title:'',author:s.pen,description:'',cover:'',mine:true,saved:false,finished:false,spec,outline:'',summary:'',state:'',threads:'',chapters:[],reviews:[],zoneIds:[],at:Date.now(),updatedAt:Date.now()}}
export function novelWordCount(text:string){const compact=text.replace(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g,'');const cjk=(text.match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g)||[]).length;return cjk+(compact.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)||[]).length}
export function sortedNovelBooks(a:NovelBook[]){return [...a].sort((x,y)=>y.updatedAt-x.updatedAt)}

/** User-added options belong to the community catalog, never rewrite saved book specifications. */
export function normalizeNovelTagGroups(input:unknown):Record<string,string[]>{
 if(!input||typeof input!=='object'||Array.isArray(input))return{};
 return Object.fromEntries(Object.entries(input).flatMap(([group,values])=>Array.isArray(values)?[[group,[...new Set(values.filter((v):v is string=>typeof v==='string').map(v=>v.trim()).filter(Boolean))]]]:[]));
}
export function addNovelTagGroup(groups:Record<string,string[]>,group:string,text:string):Record<string,string[]>{const tag=text.trim();if(!tag||tag.length>30)throw Error('标签请填写1—30个字');return{...groups,[group]:[...new Set([...(groups[group]||[]),tag])]};}
export function removeNovelTagGroup(groups:Record<string,string[]>,group:string,text:string):Record<string,string[]>{return{...groups,[group]:(groups[group]||[]).filter(t=>t!==text)};}
