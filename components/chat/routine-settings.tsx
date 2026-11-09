"use client";
import styles from "./routine-settings.module.css";
import {Toggle} from "@/components/ui/form";
import {cancelBailoutPrefix,cancelFollowUpBailout} from "@/lib/push-bailout-client";
import {loadChatSessions} from "@/lib/chat-storage";
import {loadIdleReconnectRules} from "@/lib/idle-reconnect-storage";
import {useState} from 'react';
import {loadCharacters} from '@/lib/character-storage';
import {DEFAULT_ROUTINE,loadCharacterRoutine,saveCharacterRoutine,type CharacterRoutine} from '@/lib/character-routine';
export function RoutineSettings(){
 const characters=loadCharacters();const [id,setId]=useState('');const [r,setR]=useState<CharacterRoutine>({...DEFAULT_ROUTINE});const [notice,setNotice]=useState('');
 const update=(patch:Partial<CharacterRoutine>)=>{const next={...r,...patch};setR(next);setNotice('');};
 const save=()=>{
  if(!r.sleepFrom||!r.sleepTo||!Number.isFinite(r.minHours)||!Number.isFinite(r.maxHours)||r.minHours<1||r.maxHours>16||r.maxHours<r.minHours){setNotice('请填写有效时间和1～16小时的睡眠范围。');return;}
  saveCharacterRoutine(id,r);
  if(r.enabled){for(const rule of loadIdleReconnectRules().filter(x=>x.characterId===id))void cancelBailoutPrefix(`idle:${rule.id}:`);for(const session of loadChatSessions().filter(x=>x.contactId===id&&!x.isGroup))cancelFollowUpBailout(session.id);}
  setNotice('已保存；当前睡眠周期保留，新的范围从后续周期生效。');
 };
 return <section className={styles.section} aria-label="角色作息">
  <h3 className={styles.heading}>角色 · {characters.find(character => character.id === id)?.timeZone || "设备时区"}</h3>
  <div className={styles.group}><label className={styles.row}><span className={styles.label}>角色</span><select className={`${styles.field} ${styles.select}`} value={id} onChange={e=>{setId(e.target.value);setR(loadCharacterRoutine(e.target.value));setNotice('');}}><option value="">选择角色</option>{characters.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label></div>
  {id&&<>
   <h3 className={styles.heading}>作息</h3>
   <div className={styles.group}>
    <label className={styles.row}><span className={styles.label}>启用作息</span><Toggle checked={r.enabled} onChange={enabled=>update({enabled})}/></label>
    <div className={styles.block}><span className={styles.label}>通常入睡范围</span><div className={styles.range}><input className={styles.field} aria-label="最早入睡" type="time" value={r.sleepFrom} onChange={e=>update({sleepFrom:e.target.value})}/><span className={styles.separator}>至</span><input className={styles.field} aria-label="最晚入睡" type="time" value={r.sleepTo} onChange={e=>update({sleepTo:e.target.value})}/></div></div>
    <div className={styles.block}><span className={styles.label}>睡眠时长（小时）</span><div className={styles.range}><input className={styles.field} aria-label="最短睡眠小时" type="number" min={1} max={16} value={r.minHours} onChange={e=>update({minHours:Number(e.target.value)})}/><span className={styles.separator}>至</span><input className={styles.field} aria-label="最长睡眠小时" type="number" min={1} max={16} value={r.maxHours} onChange={e=>update({maxHours:Number(e.target.value)})}/></div></div>
    <label className={styles.row}><span className={styles.label}>规律程度</span><select className={`${styles.field} ${styles.select}`} value={r.regularity} onChange={e=>update({regularity:e.target.value as CharacterRoutine['regularity']})}><option value="regular">比较规律</option><option value="flexible">经常浮动</option></select></label>
   </div>
   <p className={styles.note}>日历工作优先调整睡眠；偶尔夜醒仅提供简短回复机会。需在对应单聊开启「忙时挂起」。</p>
   <button type="button" className={styles.save} onClick={save}>保存作息</button>
   {notice&&<p className={styles.notice} role="status">{notice}</p>}
  </>}
 </section>;
}
