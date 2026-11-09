"use client";
import {resetTwitterIdentity,twitterOwner} from "@/lib/twitter-storage";
import social from "../social/social.module.css";
import {AppNotificationSetting} from "@/components/social/app-notifications";
import { SocialDisclosure } from "@/components/social-disclosure";
import { socialRelated } from "@/lib/social-identity";
import { resolveUserIdentity } from "@/lib/settings-storage";
import { synchronizeTwitterDisclosure, twitterAccountEnabled } from "@/lib/twitter-storage";
import { parseTwitterCount } from "@/lib/twitter-metrics";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { ArrowLeft, Plus } from "lucide-react";
import type { Character } from "@/lib/character-types";
import { getChatImageFromIndexedDB, saveChatImageToIndexedDB } from "@/lib/chat-asset-storage";
import { createTwitterId, TWITTER_LOCALES, type TwitterCommunity, type TwitterCommunityCharacter, type TwitterProfile, type TwitterState } from "@/lib/twitter-storage";
import { appendPhotoRecords, createPhotoId, loadPhotoLibrary } from "@/lib/photo-library-storage";
import { analyzePhotosInBackground } from "@/lib/photo-library-vision";
import { DEFAULT_ROLE_SOCIAL_SOURCES } from "@/lib/role-social-sources";
import styles from "./twitter-app.module.css";

type Tab = "accounts" | "characters" | "communities" | "world";
type Props = {
  state: TwitterState;
  characters: Character[];
  onChange: (change: (current: TwitterState) => TwitterState) => void;
  onClose: () => void;
  onUserAccount: (id: string) => void;
  onCommunity: (id: string) => void;
  onNotice: (text: string) => void;
  initialTab?: Tab;
  initialAccountId?: string;
  createCommunity?: boolean;
  closeOnSave?: boolean;
  onlyCharacters?: boolean;
};
const defaultHandle = (text: string) => text.trim().replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").slice(0, 22).toLowerCase() || "account";
const blankProfile = (name: string, handle: string): TwitterProfile => ({ name, handle: defaultHandle(handle), bio: "", visibility: "public", followers: 0, followingCount: 0 });
const numberValue = (value: string) => Math.max(0, Math.min(1_000_000_000, Number(value) || 0));

function ManagedImage({ imageRef }: { imageRef?: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!imageRef) { setUrl(""); return; }
    if (/^(https?:|data:)/.test(imageRef)) { setUrl(imageRef); return; }
    let mounted = true;
    void getChatImageFromIndexedDB(imageRef).then(image => { if (mounted) setUrl(image || ""); });
    return () => { mounted = false; };
  }, [imageRef]);
  return url ? <img src={url} alt="" /> : null;
}
function AccountPortrait({ imageRef, name }: { imageRef?: string | null; name: string }) {
  return <span className={styles.manageRowAvatar}>{imageRef ? <ManagedImage imageRef={imageRef} /> : name.slice(0, 1) || "?"}</span>;
}

export function TwitterManagement({ state, characters, onChange, onClose, onUserAccount, onCommunity, onNotice, initialTab = "accounts", initialAccountId, createCommunity, closeOnSave, onlyCharacters }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [editAccount, setEditAccount] = useState<string | null>(null);
  const [draft, setDraft] = useState<TwitterProfile>(blankProfile("", ""));
  const [followersDraft, setFollowersDraft] = useState("");
  const [followingDraft, setFollowingDraft] = useState("");
  const [editCommunity, setEditCommunity] = useState<string | null>(null);
  const [community, setCommunity] = useState<TwitterCommunity>({ id: "", name: "", fans: 0, characterIds: [], manualCharacters: [], includeUserPersona: false, createdAt: 0 });
  const [manualName, setManualName] = useState("");
  const [manualHandle, setManualHandle] = useState("");
  const [manualBio, setManualBio] = useState("");
  const [manualPersona, setManualPersona] = useState("");
  const [communityCharDrafts, setCommunityCharDrafts] = useState<Record<string, TwitterCommunityCharacter>>({});
  const [world, setWorld] = useState(state.publicWorldContext);
  const [locales, setLocales] = useState<string[]>(state.audienceLocales);
  const [privateRules, setPrivateRules] = useState(state.worldRules);
  const [sensitiveTopics, setSensitiveTopics] = useState(state.sensitiveTopics);
  const inputRef = useRef<HTMLInputElement>(null);
  const sensitiveCoverInputRef = useRef<HTMLInputElement>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [imageTarget, setImageTarget] = useState<"avatarUrl" | "bannerUrl">("avatarUrl");
  const imported = characters;
  const userIdentity = resolveUserIdentity(undefined, "twitter");
  const calendarSources = [
    { id: "user", name: "我", avatar: state.profile.avatarUrl || userIdentity?.avatarUrl },
    ...imported.map(char => ({ id: char.id, name: char.name, avatar: state.characterProfiles[char.id]?.avatarUrl || char.avatar })),
  ];
  const getProfile = (id: string) => id === "user" ? state.profile : state.characterProfiles[id] || state.accounts[id];
  const startProfile = (id: string) => {
    const char = characters.find(c => c.id === id.replace(/:alt$/, ""));
    const old = getProfile(id);
    const isAlt = id.endsWith(":alt");
    const fallback = isAlt ? "副账号" : char?.name || state.communityCharacters[id]?.name || "我的账号";
    setDraft(old || { ...blankProfile(fallback, id === "user:alt" ? "my_alt" : char?.name || id), avatarUrl: isAlt ? "" : char?.avatar || "" });
    setFollowersDraft(String(old?.followers ?? 0));
    setFollowingDraft(String(old?.followingCount ?? 0));
    setEditAccount(id);
  };
  const saveProfile = () => {
    if (!editAccount) return;
    const followers = parseTwitterCount(followersDraft);
    const followingCount = parseTwitterCount(followingDraft);
    if (followers === null || followingCount === null) { onNotice("请输入有效数量，例如 27、1.2万、128万。"); return; }
    const next = { ...draft, enabled: true, name: draft.name.trim() || "未命名账号", handle: defaultHandle(draft.handle), followers, followingCount };
    onChange(current => editAccount === "user" ? { ...current, profile: next } : characters.some(c => c.id === editAccount) ? { ...current, characterProfiles: { ...current.characterProfiles, [editAccount]: next } } : synchronizeTwitterDisclosure(current, editAccount, next));
    setEditAccount(null);
    if (closeOnSave) onClose();
  };
  const startCommunity = (id?: string) => {
    const existing = state.communities.find(c => c.id === id);
    setCommunityCharDrafts({});
    setCommunity(existing ? { ...existing, characterIds: [...existing.characterIds], manualCharacters: [...(existing.manualCharacters || [])] } : { id: createTwitterId(), name: "", fans: 0, characterIds: [], manualCharacters: [], includeUserPersona: false, createdAt: Date.now() });
    setEditCommunity(id || "new");
  };
  useEffect(() => {
    if (initialAccountId) startProfile(initialAccountId);
    else if (createCommunity) startCommunity();
    // The destination is selected once when this page opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const saveCommunity = () => {
    if (!community.name.trim()) { onNotice("请先填写社区名称。"); return; }
    const next = { ...community, name: community.name.trim(), fans: numberValue(String(community.fans)) };
    onChange(current => ({ ...current, communityCharacters: { ...current.communityCharacters, ...Object.fromEntries(Object.entries(communityCharDrafts).filter(([id]) => next.communityCharacterIds?.includes(id))) }, communities: current.communities.some(c => c.id === next.id) ? current.communities.map(c => c.id === next.id ? next : c) : [...current.communities, next] }));
    setEditCommunity(null);
    if (closeOnSave) onClose();
  };
  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { onNotice("请选择图片。"); return; }
    try {
      const ref = await saveChatImageToIndexedDB(file);
      if (editAccount) setDraft(current => ({ ...current, [imageTarget]: ref }));
      else if (editCommunity) setCommunity(current => ({ ...current, [imageTarget]: ref }));
    } catch { onNotice("图片保存失败，请重试。"); }
  };
  const chooseImage = (field: "avatarUrl" | "bannerUrl") => { setImageTarget(field); inputRef.current?.click(); };
  const deleteAccount = () => {
    if (!editAccount?.endsWith(":alt") || !window.confirm("确定删除这个副账号？对应帖子、私信及专用媒体池也会一并删除。")) return;
    const accountId = editAccount;
    onChange(current => { const accounts = { ...current.accounts }; delete accounts[accountId]; const pools = { ...current.alternateMediaPhotoIds }; delete pools[accountId]; return { ...current, accounts, alternateMediaPhotoIds: pools, following: current.following.filter(id => id !== accountId), posts: current.posts.filter(post => post.authorId !== accountId), conversations: current.conversations.filter(convo => convo.userAccountId !== accountId && convo.recipientAccountId !== accountId) }; });
    setEditAccount(null); if (accountId === "user:alt") onUserAccount("user"); else if (closeOnSave) onClose();
  };
  const deleteCommunity = () => {
    if (!editCommunity || editCommunity === "new" || !window.confirm("确定删除这个社群？其中的帖子与评论也会删除。")) return;
    const id = community.id;
    onChange(current => ({ ...current, communities: current.communities.filter(c => c.id !== id), posts: current.posts.filter(p => p.communityId !== id), actions: current.actions.filter(a => a.communityId !== id) }));
    setEditCommunity(null); if (closeOnSave) onClose();
  };
  const uploadMedia = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files || [])].filter(file => file.type.startsWith("image/")); event.target.value = "";
    if (!editAccount || !files.length) return;
    try {
      const now = Date.now(); const records = await Promise.all(files.map(async (file, index) => ({ id: createPhotoId(), assetId: await saveChatImageToIndexedDB(file), originalName: file.name, linkedCharacterIds: [], sharedPairIds: [], aiUsable: true, visionStatus: "unprocessed" as const, usageHistory: [], origin: "upload" as const, sourceAccountId: editAccount, createdAt: now + index, updatedAt: now + index })));
      appendPhotoRecords(records);
      analyzePhotosInBackground(records.map(row => row.id));
      const accountId = editAccount;
      onChange(current => ({ ...current, alternateMediaPhotoIds: { ...current.alternateMediaPhotoIds, [accountId]: [...new Set([...(current.alternateMediaPhotoIds[accountId] || []), ...records.map(row => row.id)])] } }));
    } catch { onNotice("媒体上传失败，请重试。"); }
  };
  return <>{editCommunity && <div className={styles.communitySheetScrim} onClick={() => { setEditCommunity(null); if (createCommunity) onClose(); }} />}<div className={`${styles.page} ${styles.managementPage} ${editCommunity ? styles.communitySheetPage : ""}`}>
    <div className={styles.pageHeader}><button onClick={() => { if (editAccount) { if (initialAccountId) onClose(); else setEditAccount(null); } else if (editCommunity) { if (createCommunity) onClose(); else setEditCommunity(null); } else onClose(); }} aria-label="返回"><ArrowLeft size={21} /></button><b>{editAccount ? "编辑主页" : editCommunity ? "添加社群" : onlyCharacters ? "角色资料" : initialTab === "world" ? "世界观" : initialTab === "communities" ? "社群" : "账号"}</b>{(editAccount || editCommunity) && <button className={styles.publish} onClick={editAccount ? saveProfile : saveCommunity}>保存</button>}{!editAccount && !editCommunity && tab === "communities" && <button onClick={() => startCommunity()} aria-label="添加社群"><Plus size={22} /></button>}</div>
    <input ref={inputRef} hidden type="file" accept="image/*" onChange={event => { void upload(event); }} />
    <input ref={sensitiveCoverInputRef} hidden type="file" accept="image/*" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; if (!file.type.startsWith("image/")) { onNotice("请选择图片。"); return; } void saveChatImageToIndexedDB(file).then(ref => setSensitiveTopics(current => ({ ...current, coverRef: ref }))).catch(() => onNotice("封面保存失败，请重试。")); }} />
    <input ref={mediaInputRef} hidden type="file" multiple accept="image/*" onChange={event => { void uploadMedia(event); }} />
    {editAccount ? <div className={styles.manageScroll}>
      <button type="button" className={`${styles.manageCover} ${styles.manageCoverPick}`} onClick={() => chooseImage("bannerUrl")} aria-label="点击封面更换图片"><ManagedImage imageRef={draft.bannerUrl} /></button>
      <div className={styles.manageAvatar}><button type="button" className={styles.manageAvatarPreview} onClick={() => chooseImage("avatarUrl")} aria-label="点击头像更换图片">{draft.avatarUrl ? <ManagedImage imageRef={draft.avatarUrl} /> : draft.name.slice(0, 1) || "我"}</button></div>
      <label>昵称<input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
      {editAccount === "user" && <label>网友对你的称呼（可选）<input value={draft.publicAddress || ""} onChange={e => setDraft({ ...draft, publicAddress: e.target.value })} placeholder={draft.name || "默认使用 X 昵称"} /><small>留空时按 X 昵称称呼；想使用本名，可以在这里填写。</small></label>}
      <label>账号名 @<input value={draft.handle} onChange={e => setDraft({ ...draft, handle: e.target.value })} /></label>
      <label>运营与发言方式<textarea value={draft.operationStyle || ""} onChange={e => setDraft({ ...draft, operationStyle: e.target.value })} placeholder="例如：本人运营，分享正常日常；或团队运营，以工作公告与宣传为主" /><small>留空按角色本人习惯使用；大小号分别设置。</small></label>
      <label>简介<textarea value={draft.bio} onChange={e => setDraft({ ...draft, bio: e.target.value })} /></label>
      <label>生日（可选）<input type="date" value={draft.birthday || ""} onChange={e => setDraft({ ...draft, birthday: e.target.value || undefined })} /></label>
      <label>加入时间（可选）<input type="month" value={draft.createdAt ? new Date(draft.createdAt).toISOString().slice(0, 7) : ""} onChange={e => setDraft({ ...draft, createdAt: e.target.value ? new Date(`${e.target.value}-01T00:00:00`).getTime() : undefined })} /></label>
      <label>认证标识<select value={draft.verification || "none"} onChange={e => setDraft({ ...draft, verification: e.target.value as TwitterProfile["verification"] })}><option value="none">无</option><option value="blue">蓝标 · 已认证账号</option><option value="gold">金标 · 组织账号</option><option value="grey">灰标 · 官方或多边组织</option></select></label>
      {editAccount.endsWith(":alt") && <>
        <label>对外身份与活动方式<textarea value={draft.identity || ""} onChange={e => setDraft({ ...draft, identity: e.target.value })} placeholder="例：不露脸的游戏博主，直播风格、日常行为等" /></label>
        <h3>副账号披露设置</h3>
        <label>与主账号关联<select value={draft.disclosure || "independent"} onChange={e => setDraft({ ...draft, disclosure: e.target.value as TwitterProfile["disclosure"] })}><option value="independent">独立身份 · 默认不披露</option><option value="full">完全披露</option><option value="clues">有线索披露</option></select></label>
        <p>选择「有线索披露」后，可设置网友目前知道什么，以及之后是否继续猜测。</p>
        {draft.disclosure === "clues" && <>
          <label>可被发现的线索及目前网友的认知<textarea value={draft.disclosureClues || ""} onChange={e => setDraft({ ...draft, disclosureClues: e.target.value })} placeholder="例：两个账号晒过同款手表；目前只有少数网友觉得眼熟，还没人确定归属" /><small>自由描述公开线索，以及网友现在知道或怀疑到哪一步；不用填写百分比。</small></label>
          <label>后续怎么猜<select value={draft.allowClueProgression ? "slow" : "limited"} onChange={e => setDraft({ ...draft, allowClueProgression: e.target.value === "slow" })}><option value="limited">只停留在当前线索和认知</option><option value="slow">遇到新的公开线索时慢慢继续猜</option></select><small>默认不继续猜。开启后也只看后来实际公开的内容，不会按固定速度推进。</small></label>
        </>}
      </>}
      <label>账号可见范围<select value={draft.visibility || "public"} onChange={e => setDraft({ ...draft, visibility: e.target.value === "protected" ? "protected" : "public" })}><option value="public">公开</option><option value="protected">私密</option></select></label>
      <div className={styles.manageCounts}><label>粉丝数<input type="text" inputMode="text" placeholder="例如：128万" value={followersDraft} onChange={e => setFollowersDraft(e.target.value)} /></label><label>关注数<input type="text" inputMode="text" placeholder="例如：27" value={followingDraft} onChange={e => setFollowingDraft(e.target.value)} /></label></div>
      {editAccount.endsWith(':alt')&&<section><h3>私下向谁披露</h3><p>按本人设置；对方切换账号仍能认出你。移除披露不会抹掉已知身份。</p><div className={social.grid}>{[...(editAccount!=='user:alt'?[{id:'user',name:'User',avatar:null}]:[]),...characters.filter(c=>twitterOwner(editAccount)!==c.id&&socialRelated(editAccount==='user:alt'?`user:${resolveUserIdentity()?.id}`:twitterOwner(editAccount),c.id))].map(c=><button type="button" className={social.person} key={c.id} aria-pressed={(draft.disclosedTo||[]).some(id=>twitterOwner(id)===c.id)} onClick={()=>setDraft({...draft,disclosedTo:(draft.disclosedTo||[]).some(id=>twitterOwner(id)===c.id)?draft.disclosedTo?.filter(id=>twitterOwner(id)!==c.id):[...(draft.disclosedTo||[]),c.id],mutualWith:[]})}><span>{c.avatar?<img src={c.avatar} alt=""/>:c.name.slice(0,1)}</span><b>{c.name}</b></button>)}</div><h3>重置身份认知</h3><p>重置指定对象对本小号的私下身份关联，保留帖子和私信正文；公开关联身份仍可被认出。</p><div className={social.actions}>{[...new Set([...(draft.knownBy||[]),...(draft.disclosedTo||[])].map(twitterOwner))].map(id=><button type="button" key={id} onClick={()=>{if(!window.confirm('重置对方对这个小号的身份认知？保留会话正文，旧有独立Chat对话不会被重写。'))return;onChange(current=>resetTwitterIdentity(current,editAccount,id));setDraft(d=>({...d,disclosedTo:(d.disclosedTo||[]).filter(x=>twitterOwner(x)!==id),knownBy:(d.knownBy||[]).filter(x=>twitterOwner(x)!==id),identityResetAt:{...d.identityResetAt,[id]:Date.now()},mutualWith:[]}));}}>{id==='user'?'User':characters.find(c=>c.id===id)?.name||'对方'} · 重置</button>)}</div></section>}
      <p>主账号与副账号的粉丝数、身份、互动分别保存。</p>
      {editAccount.endsWith(":alt") && <><h3>副账号专用媒体池</h3><p>副账号只从此处选中的照片中挑选，不直接使用主账号的照片。</p><button className={styles.manageCreate} onClick={() => setMediaOpen(open => !open)}>从已有照片选择 · {(state.alternateMediaPhotoIds[editAccount] || []).length} 张</button>{mediaOpen && <div className={styles.mediaPoolGrid}>{loadPhotoLibrary().photos.map(photo => <button type="button" key={photo.id} className={(state.alternateMediaPhotoIds[editAccount] || []).includes(photo.id) ? styles.mediaPoolSelected : ""} onClick={() => { const id = editAccount; onChange(current => { const selected = current.alternateMediaPhotoIds[id] || []; return { ...current, alternateMediaPhotoIds: { ...current.alternateMediaPhotoIds, [id]: selected.includes(photo.id) ? selected.filter(value => value !== photo.id) : [...selected, photo.id] } }; }); }}><ManagedImage imageRef={photo.assetId} /></button>)}</div>}<button className={styles.manageCreate} onClick={() => mediaInputRef.current?.click()}>从设备上传到媒体池</button><button className={styles.dangerAction} onClick={deleteAccount}>删除副账号</button></>}
    </div> : editCommunity ? <div className={styles.manageScroll}>
      <button type="button" className={`${styles.manageCover} ${styles.manageCoverPick}`} onClick={() => chooseImage("bannerUrl")} aria-label="点击社群封面更换图片"><ManagedImage imageRef={community.bannerUrl} /></button>
      <div className={styles.manageAvatar}><button type="button" className={styles.manageAvatarPreview} onClick={() => chooseImage("avatarUrl")} aria-label="点击社群头像更换图片">{community.avatarUrl ? <ManagedImage imageRef={community.avatarUrl} /> : community.name.slice(0, 1) || "社"}</button></div>
      <label>社区名称<input value={community.name} onChange={e => setCommunity({ ...community, name: e.target.value })} placeholder="输入社区名称" /></label>
      <label>粉丝数<input type="number" min="0" value={community.fans} onChange={e => setCommunity({ ...community, fans: numberValue(e.target.value) })} /></label>
      <label>社群内容 · 主要讨论什么<textarea value={community.description || ""} onChange={e => setCommunity({ ...community, description: e.target.value })} placeholder="例如：某个组合的日常、成员互动、粉丝分享……" /></label>
      <h3>关联角色（可多选）</h3>{imported.map(char => <label key={char.id} className={styles.manageCheck}><input type="checkbox" checked={community.characterIds.includes(char.id)} onChange={e => setCommunity({ ...community, characterIds: e.target.checked ? [...community.characterIds, char.id] : community.characterIds.filter(id => id !== char.id) })} />{char.name}</label>)}
      <h3>手动添加社群角色</h3><div className={styles.manualCharacterInput}><input value={manualName} onChange={e => setManualName(e.target.value)} placeholder="角色名称" /><input value={manualHandle} onChange={e => setManualHandle(e.target.value)} placeholder="账号 @" /><input value={manualBio} onChange={e => setManualBio(e.target.value)} placeholder="简介" /><textarea value={manualPersona} onChange={e => setManualPersona(e.target.value)} placeholder="人设与发言习惯" /><button type="button" onClick={() => { const name = manualName.trim(); if (!name || !manualHandle.trim() || !manualPersona.trim()) { onNotice("请填写角色名称、账号和人设。"); return; } const id = `community:${createTwitterId()}`; setCommunityCharDrafts(current => ({ ...current, [id]: { id, name, handle: defaultHandle(manualHandle), bio: manualBio.trim(), persona: manualPersona.trim(), communityId: community.id } })); setCommunity(current => ({ ...current, communityCharacterIds: [...(current.communityCharacterIds || []), id] })); setManualName(""); setManualHandle(""); setManualBio(""); setManualPersona(""); }}>添加角色</button></div>
      {(community.communityCharacterIds || []).map(id => <div key={id} className={styles.manualCharacterRow}><span>{(communityCharDrafts[id] || state.communityCharacters[id])?.name || "社群角色"} · @{(communityCharDrafts[id] || state.communityCharacters[id])?.handle || "community"}</span><button type="button" onClick={() => setCommunity(current => ({ ...current, communityCharacterIds: (current.communityCharacterIds || []).filter(item => item !== id) }))}>移除</button></div>)}
      <label className={styles.manageCheck}><input type="checkbox" checked={community.includeUserPersona} onChange={e => setCommunity({ ...community, includeUserPersona: e.target.checked })} />关联我的人设</label>
      <p>创建社区不会自动将你显示为主持人，也不会公开关联角色的小号。</p>
      {editCommunity !== "new" && <button className={styles.dangerAction} onClick={deleteCommunity}>删除社群</button>}
    </div> : <><div className={styles.manageScroll}>
      {tab === "accounts" && <>
        {!onlyCharacters && <><h3>我的账号</h3>{(["user", ...(state.accounts["user:alt"] ? ["user:alt"] : [])]).map(id => <div key={id} className={styles.manageRow}><AccountPortrait imageRef={getProfile(id)?.avatarUrl} name={getProfile(id)?.name || "我"} /><span>{getProfile(id)?.name || "我的账号"}<small>@{getProfile(id)?.handle || "my_twitter"} · {id.endsWith(":alt") ? "副账号" : "主账号"}</small></span><button onClick={() => onUserAccount(id)}>使用</button><button onClick={() => startProfile(id)}>设置</button></div>)}
        {!state.accounts["user:alt"] && <button className={styles.manageCreate} onClick={() => startProfile("user:alt")}><Plus size={18} />创建我的副账号</button>}</>}
        <h3>角色资料</h3>{imported.map(char => <div key={char.id} className={styles.accountGroup}><div className={styles.manageRow}><AccountPortrait imageRef={getProfile(char.id)?.avatarUrl || char.avatar} name={getProfile(char.id)?.name || char.name} /><span>{getProfile(char.id)?.name || char.name}<small>主账号 · 跟随人设</small></span><button onClick={() => { if (!twitterAccountEnabled(state,char.id)) onChange(p=>({...p,characterProfiles:{...p.characterProfiles,[char.id]:{...blankProfile(char.name,char.name),enabled:true,avatarUrl:char.avatar||undefined}}})); else startProfile(char.id); }}>{twitterAccountEnabled(state,char.id)?"设置":"启用"}</button></div><div className={styles.manageRow}><AccountPortrait imageRef={getProfile(`${char.id}:alt`)?.avatarUrl} name={getProfile(`${char.id}:alt`)?.name || "副"} /><span>{getProfile(`${char.id}:alt`)?.name || "未创建副账号"}<small>副账号 · 独立身份</small></span><button onClick={() => startProfile(`${char.id}:alt`)}>{state.accounts[`${char.id}:alt`] ? "设置" : "创建"}</button></div></div>)}
      </>}
      {tab === "characters" && <><h3>已有角色</h3>{characters.map(char => <div key={char.id} className={styles.accountGroup}><div className={styles.manageRow}><span>{char.name}<small>主账号</small></span><button onClick={() => { if (!twitterAccountEnabled(state,char.id)) onChange(p=>({...p,characterProfiles:{...p.characterProfiles,[char.id]:{...blankProfile(char.name,char.name),enabled:true,avatarUrl:char.avatar||undefined}}})); else startProfile(char.id); }}>{twitterAccountEnabled(state,char.id)?"设置":"启用"}</button></div><div className={styles.manageRow}><span>{state.accounts[`${char.id}:alt`]?.name || "未创建副账号"}<small>副账号</small></span><button onClick={() => startProfile(`${char.id}:alt`)}>设置</button></div></div>)}{Object.values(state.communityCharacters).map(char => <div key={char.id} className={styles.manageRow}><span>{char.name}<small>社群角色 · @{char.handle}</small></span><button onClick={() => startProfile(char.id)}>编辑主页</button></div>)}</>}
      {tab === "communities" && <><h3>关注的社群</h3>{state.communities.length ? state.communities.map(item => <div key={item.id} className={styles.manageRow}><span>{item.name}<small>{item.description || `${item.fans.toLocaleString()} 位粉丝`}</small></span><button onClick={() => onCommunity(item.id)}>进入</button><button onClick={() => startCommunity(item.id)}>编辑</button></div>) : <p className={styles.communityEmpty}>暂无关注</p>}</>}
      {tab === "world" && <><h3>世界与趋势</h3><AppNotificationSetting app="twitter" className={styles.noticeSetting} /><label>公开世界背景<textarea value={world} onChange={e => setWorld(e.target.value)} placeholder="写这里的人们生活在什么样的世界，以及常讨论的事。" /></label><p>世界书统一在系统设置的配置绑定中选择。</p><h3>是否关联角色日历</h3><p>点击头像选择，可多选。选中变灰表示参考日历；再次点击取消。</p><div className={styles.calendarSourceGrid}>{calendarSources.map(source => { const selected = (state.socialSourcesByCharacter[source.id] || DEFAULT_ROLE_SOCIAL_SOURCES).includeCalendar; return <button key={source.id} type="button" className={styles.calendarSourceButton} aria-label={`参考${source.name}的日历`} aria-pressed={selected} onClick={() => onChange(current => ({ ...current, socialSourcesByCharacter: { ...current.socialSourcesByCharacter, [source.id]: { ...(current.socialSourcesByCharacter[source.id] || DEFAULT_ROLE_SOCIAL_SOURCES), includeCalendar: !(current.socialSourcesByCharacter[source.id] || DEFAULT_ROLE_SOCIAL_SOURCES).includeCalendar } } }))}><AccountPortrait imageRef={source.avatar} name={source.name} /><span className={styles.calendarSourceName}>{source.name}</span></button>; })}</div><p>仅本人发言或关联社群生成时参考，普通路人首页不读取私人日历。默认不选。</p><h3>生成内容的语言与地区</h3><p>影响路人动态、评论、转帖和陌生人私信。全部选中时平均生成；角色仍按各自人设说话。</p>{TWITTER_LOCALES.map(locale => <label className={styles.manageCheck} key={locale}><input type="checkbox" checked={locales.includes(locale)} onChange={e => setLocales(current => e.target.checked ? [...current, locale] : current.filter(item => item !== locale))} />{locale}</label>)}<label>角色公开发言补充规则（可留空）<textarea value={privateRules} onChange={e => setPrivateRules(e.target.value)} placeholder="例如角色公开发言时需遵守的边界；不会提供给路人或趋势生成。" /></label><h3>限制级话题</h3><p>默认关闭；只影响「为你推荐」每批刷新。由你定义话题内容与所用世界书，文字图片默认盖上封面，点击后再查看。</p><label>出现比例<select value={sensitiveTopics.frequency} onChange={e => setSensitiveTopics(current => ({ ...current, frequency: Number(e.target.value) as typeof current.frequency }))}>{[0,30,50,70,100].map(value => <option key={value} value={value}>{value === 0 ? "关闭 · 0%" : `${value}%`}</option>)}</select></label><label>描述要生成的内容<textarea value={sensitiveTopics.description} onChange={e => setSensitiveTopics(current => ({ ...current, description: e.target.value }))} placeholder="自行定义这一类话题、世界设定和内容方向。留空则不生成此类内容。" /></label><div className={styles.coverSettings}><span className={styles.coverSample}>{sensitiveTopics.coverRef ? <ManagedImage imageRef={sensitiveTopics.coverRef} /> : <span className={styles.defaultRestrictedCover} />}</span><button type="button" onClick={() => sensitiveCoverInputRef.current?.click()}>更换遮罩封面</button>{sensitiveTopics.coverRef && <button type="button" onClick={() => setSensitiveTopics(current => ({ ...current, coverRef: "" }))}>恢复默认</button>}</div><button className={styles.manageCreate} onClick={() => { onChange(current => ({ ...current, publicWorldContext: world.trim(), audienceLocales: locales, worldRules: privateRules.trim(), sensitiveTopics })); onNotice("X 世界观与话题设置已保存。"); }}>保存设置</button><p>世界背景可随时修改；刷新趋势不读取角色私密规则或副账号归属。</p></>}
    </div></>}
  </div></>;
}
