import { reconcileCalendarMaster } from "./calendar-master";
import type { PhotoStorySnapshot } from "./photo-story-data";
import { deleteWeverseLiveMemory } from "./weverse-memory";
import { kvGet, kvSet, registerKvMigration } from "./kv-db";

export const WEV_STATE_KEY = "ai_phone_weverse_state_v1";
export const WEV_UPDATED_EVENT = "weverse-updated";
registerKvMigration(WEV_STATE_KEY);

export type WeverseAccountProfile = { displayName: string; avatarUrl?: string; bio?: string };
export type WeverseMemberProfile = {
  liveStyle?: string;
  characterId: string;
  displayName?: string;
  avatarUrl?: string;
  coverUrl?: string;
  liveCoverUrl?: string;
  bio?: string;
  /** Weverse 公开素材池：仅保存 Photos photoId 引用，不复制图片本体。 */
  wvsMediaPhotoIds?: string[];
  /** 仅记录角色自主修改，用于低频冷却；用户手动编辑/推荐头像不占用。 */
  lastAutonomousNameAt?: number;
  lastAutonomousAvatarAt?: number;
};
export type WeverseHistoryMode = "new" | "existing" | "custom";

export type WeverseCommunity = {
  userIdentityId?: string;
  liveStyle?: string;
  chineseProxyInput?: boolean;
  id: string; name: string; description?: string; avatarUrl?: string; coverUrl?: string;
  official: WeverseAccountProfile;
  memberCharacterIds: string[];
  memberProfiles: Record<string, WeverseMemberProfile>;
  officialMediaPhotoIds?: string[];
  /** 用于模拟公开互动量，不等于本地真正生成的 fan 账号数量。 */
  fanCount: number;
  historyMode?: WeverseHistoryMode;
  historyStartAt?: number;
  historyInitializedAt?: number;
  /** 已生成历史内容里最早的时间；继续“加载更早动态”时从这里往前延伸。 */
  historyCursorAt?: number;
  createdAt: number; updatedAt: number;
};

export type WeverseAuthorType = "user" | "fan" | "official" | "artist";
export type WeverseComment = {
  id: string; authorType: WeverseAuthorType; authorId: string; authorName?: string; authorAvatarUrl?: string;
  body: string; originalBody?: string; parentId?: string; deleted?: boolean; createdAt: number;
};
export type WeverseNotice = {
  id: string; communityId: string; title: string; originalTitle?: string; translatedTitle?: string; body: string; originalBody?: string; imageUrl?: string; photoLibraryId?: string; photoSource?: "album" | "generated" | "manual"; photoDescription?: string; createdAt: number; historical?: boolean;
};

export type WeverseScheduleType = "media" | "anniversary" | "performance" | "recording" | "shoot" | "brand" | "release" | "other";
export type WeverseScheduleVisibility = "public" | "internal";
export type WeverseScheduleItem = {
  linkedLiveId?: string;
  contentDescription?: string;
  publicAt?: number;
  id: string;
  communityId: string;
  type: WeverseScheduleType;
  title: string;
  startsAt: number;
  endsAt?: number;
  location?: string;
  memberCharacterIds: string[];
  source: "manual" | "generated";
  /** public = 粉丝可见公开日程；internal = 仅用户/角色管理视图可见的内部工作安排。 */
  visibility: WeverseScheduleVisibility;
  /** 现实工作/出行类日程同步到角色手机日历；平台内 Live 不走这里。 */
  calendarSync: boolean;
  busyLevel?: 1 | 2 | 3 | 4;
  createdAt: number;
  updatedAt: number;
};
export type WeversePost = {
  photoStoryContext?: PhotoStorySnapshot;
  id: string; communityId: string; authorType: WeverseAuthorType; authorId: string; authorName?: string; authorAvatarUrl?: string;
  /** Artist Post can be published as a compact voice post. The transcript stays in body/originalBody. */
  postType?: "text" | "voice";
  body: string; originalBody?: string; imageUrl?: string; photoLibraryId?: string; photoSource?: "album" | "generated" | "manual"; photoDescription?: string;
  createdAt: number; likedByUser?: boolean; bookmarkedByUser?: boolean;
  /** 公开 UI 展示的模拟互动总量；和 comments[] 可见样本数量分开。 */
  likeCount: number; commentCount: number;
  /** 历史回填内容不会当作“刚发生”写入角色近期记忆。 */
  historical?: boolean;
  comments: WeverseComment[];
};

export type WeverseLiveOrientation = "landscape";
export type WeverseLiveStatus = "live" | "ended";
export type WeverseLiveType = "visual" | "voice";
export type WeverseLiveSegmentKind = "speech" | "action" | "system";
export type WeverseLiveSegment = {
  id: string;
  kind: WeverseLiveSegmentKind;
  characterId?: string;
  original: string;
  translated?: string;
  replyToCommentIds?: string[];
  createdAt: number;
};
export type WeverseLiveComment = {
  id: string;
  authorType: "user" | "fan" | "artist";
  authorId: string;
  authorName: string;
  authorAvatarUrl?: string;
  body: string;
  originalBody?: string;
  createdAt: number;
};
export type WeverseLivePresence = {
  characterId: string;
  joinedAt: number;
  leftAt?: number;
  commented?: boolean;
  joinedVia?: "invitation" | "viewer";
};
export type WeverseLive = {
  id: string;
  communityId: string;
  /** 本场实际作为主播/连线嘉宾出现过的全部角色。第一个始终是最初开播者。 */
  hostCharacterIds: string[];
  /** 当前仍在 Stage 上的角色；结束后为空。 */
  activeCharacterIds: string[];
  participantPresence: WeverseLivePresence[];
  viewerPresence: WeverseLivePresence[];
  liveType: WeverseLiveType;
  orientation: WeverseLiveOrientation;
  status: WeverseLiveStatus;
  title: string;
  theme?: string;
  /** Live 列表/回放卡片封面；正在直播页不重复展示。 */
  coverUrl?: string;
  startedAt: number;
  endedAt?: number;
  viewerCount: number;
  peakViewerCount: number;
  heartCount: number;
  roundCount: number;
  /** 已经提交给角色处理过的用户评论时间上界。 */
  lastConsumedUserCommentAt?: number;
  /** 官方账号名义的 Live；Stage 仍由实际参与成员发言。 */
  official?: boolean;
  segments: WeverseLiveSegment[];
  comments: WeverseLiveComment[];
};

export type WeverseUserProfile = { displayName?: string; avatarUrl?: string; bio?: string };
export type WeverseSettings = {
  translationDefault: "translated" | "original";
  autoTranslateComments: boolean;
  fanActivity: "quiet" | "normal" | "lively";
  fanLanguagePreset: "korean_mixed" | "japanese_mixed" | "chinese_mixed" | "english_mixed" | "balanced" | "kr_jp_mixed";
  generationScope: "current" | "all";
  notifications: { artistReply: boolean; fanReply: boolean; artistPost: boolean; officialPost: boolean; live: boolean };
};
export type WeverseState = { version: 8; communities: WeverseCommunity[]; posts: WeversePost[]; notices: WeverseNotice[]; lives: WeverseLive[]; schedules: WeverseScheduleItem[]; userProfile?: WeverseUserProfile; settings: WeverseSettings };

export const DEFAULT_WEV_SETTINGS: WeverseSettings = {
  translationDefault: "translated", autoTranslateComments: true, fanActivity: "normal", fanLanguagePreset: "korean_mixed", generationScope: "current",
  notifications: { artistReply: true, fanReply: true, artistPost: true, officialPost: true, live: true },
};
const EMPTY_STATE: WeverseState = { version: 8, communities: [], posts: [], notices: [], lives: [], schedules: [], userProfile: {}, settings: DEFAULT_WEV_SETTINGS };
function cloneEmpty(): WeverseState { return { version: 8, communities: [], posts: [], notices: [], lives: [], schedules: [], userProfile: {}, settings: { ...DEFAULT_WEV_SETTINGS, notifications: { ...DEFAULT_WEV_SETTINGS.notifications } } }; }
function uniqueStrings(value: unknown): string[] { return Array.isArray(value) ? Array.from(new Set(value.filter((v): v is string => typeof v === "string" && Boolean(v.trim())).map(v => v.trim()))) : []; }
function finiteNonNegative(value: unknown, fallback = 0): number { const n = Number(value); return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback; }
function normalizeSettings(value: unknown): WeverseSettings {
  const raw = value && typeof value === "object" ? value as Partial<WeverseSettings> : {};
  const notifications = raw.notifications && typeof raw.notifications === "object" ? raw.notifications : {} as Partial<WeverseSettings["notifications"]>;
  return { translationDefault: raw.translationDefault === "original" ? "original" : "translated", autoTranslateComments: raw.autoTranslateComments !== false,
    fanActivity: raw.fanActivity === "quiet" || raw.fanActivity === "lively" ? raw.fanActivity : "normal",
    fanLanguagePreset: ["korean_mixed","japanese_mixed","chinese_mixed","english_mixed","balanced","kr_jp_mixed"].includes(String(raw.fanLanguagePreset)) ? raw.fanLanguagePreset as WeverseSettings["fanLanguagePreset"] : "korean_mixed",
    generationScope: raw.generationScope === "all" ? "all" : "current",
    notifications: { artistReply: notifications.artistReply !== false, fanReply: notifications.fanReply !== false, artistPost: notifications.artistPost !== false, officialPost: notifications.officialPost !== false, live: notifications.live !== false } };
}
function normalizeLiveSegment(raw: unknown): WeverseLiveSegment | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Partial<WeverseLiveSegment>;
  if (typeof item.id !== "string") return null;
  const kind: WeverseLiveSegmentKind = item.kind === "action" || item.kind === "system" ? item.kind : "speech";
  const original = typeof item.original === "string" ? item.original.trim() : "";
  if (!original) return null;
  return {
    id: item.id, kind, characterId: typeof item.characterId === "string" && item.characterId ? item.characterId : undefined,
    original, translated: typeof item.translated === "string" && item.translated.trim() ? item.translated.trim() : undefined,
    replyToCommentIds: uniqueStrings(item.replyToCommentIds),
    createdAt: typeof item.createdAt === "number" && Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
  };
}
function normalizeLiveComment(raw: unknown): WeverseLiveComment | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Partial<WeverseLiveComment>;
  if (typeof item.id !== "string") return null;
  const body = typeof item.body === "string" ? item.body.trim() : "";
  if (!body) return null;
  const authorType: WeverseLiveComment["authorType"] = item.authorType === "user" || item.authorType === "artist" ? item.authorType : "fan";
  return {
    id: item.id, authorType,
    authorId: typeof item.authorId === "string" && item.authorId ? item.authorId : authorType === "artist" ? "artist" : "fan",
    authorName: typeof item.authorName === "string" && item.authorName.trim() ? item.authorName.trim() : authorType === "artist" ? "Artist" : "익명팬",
    authorAvatarUrl: typeof item.authorAvatarUrl === "string" && item.authorAvatarUrl ? item.authorAvatarUrl : undefined,
    body, originalBody: typeof item.originalBody === "string" && item.originalBody.trim() ? item.originalBody.trim() : undefined,
    createdAt: typeof item.createdAt === "number" && Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
  };
}
function normalizeLivePresence(raw: unknown): WeverseLivePresence | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Partial<WeverseLivePresence>;
  if (typeof item.characterId !== "string" || !item.characterId.trim()) return null;
  const joinedAt = typeof item.joinedAt === "number" && Number.isFinite(item.joinedAt) ? item.joinedAt : Date.now();
  return { characterId: item.characterId.trim(), joinedAt, leftAt: typeof item.leftAt === "number" && Number.isFinite(item.leftAt) ? item.leftAt : undefined, commented: item.commented === true, joinedVia: item.joinedVia === "invitation" || item.joinedVia === "viewer" ? item.joinedVia : undefined };
}
function normalizeLive(raw: unknown): WeverseLive | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Partial<WeverseLive>;
  if (typeof item.id !== "string" || typeof item.communityId !== "string") return null;
  const startedAt = typeof item.startedAt === "number" && Number.isFinite(item.startedAt) ? item.startedAt : Date.now();
  const status: WeverseLiveStatus = item.status === "ended" ? "ended" : "live";
  const segments = Array.isArray(item.segments) ? item.segments.map(normalizeLiveSegment).filter((v): v is WeverseLiveSegment => Boolean(v)) : [];
  const comments = Array.isArray(item.comments) ? item.comments.map(normalizeLiveComment).filter((v): v is WeverseLiveComment => Boolean(v)) : [];
  const viewerCount = finiteNonNegative(item.viewerCount, 0);
  const hostCharacterIds = uniqueStrings(item.hostCharacterIds);
  const activeCharacterIds = status === "ended" ? [] : (uniqueStrings((item as any).activeCharacterIds).length ? uniqueStrings((item as any).activeCharacterIds) : hostCharacterIds.slice());
  const participantPresenceRaw = Array.isArray((item as any).participantPresence) ? (item as any).participantPresence : [];
  const participantPresence = participantPresenceRaw.map(normalizeLivePresence).filter((v: WeverseLivePresence | null): v is WeverseLivePresence => Boolean(v));
  if (!participantPresence.length) {
    for (const characterId of (status === "ended" ? hostCharacterIds.slice(0, 1) : hostCharacterIds)) participantPresence.push({ characterId, joinedAt: startedAt, leftAt: status === "ended" ? (typeof item.endedAt === "number" ? item.endedAt : startedAt) : undefined });
  }
  const viewerPresenceRaw = Array.isArray((item as any).viewerPresence) ? (item as any).viewerPresence : [];
  const viewerPresence = viewerPresenceRaw.map(normalizeLivePresence).filter((v: WeverseLivePresence | null): v is WeverseLivePresence => Boolean(v));
  return {
    id: item.id, communityId: item.communityId, hostCharacterIds, activeCharacterIds, participantPresence, viewerPresence, liveType: item.liveType === "voice" ? "voice" : "visual", orientation: "landscape",
    status, title: typeof item.title === "string" && item.title.trim() ? item.title.trim() : "Live",
    theme: typeof item.theme === "string" && item.theme.trim() ? item.theme.trim() : undefined,
    coverUrl: typeof (item as any).coverUrl === "string" && (item as any).coverUrl ? (item as any).coverUrl : undefined, startedAt,
    endedAt: typeof item.endedAt === "number" && Number.isFinite(item.endedAt) ? item.endedAt : undefined,
    viewerCount, peakViewerCount: Math.max(viewerCount, finiteNonNegative(item.peakViewerCount, viewerCount)),
    heartCount: finiteNonNegative(item.heartCount, 0), roundCount: finiteNonNegative(item.roundCount, 0),
    lastConsumedUserCommentAt: typeof (item as any).lastConsumedUserCommentAt === "number" && Number.isFinite((item as any).lastConsumedUserCommentAt) ? (item as any).lastConsumedUserCommentAt : startedAt - 1,
    official: (item as any).official === true,
    segments, comments,
  };
}

function normalizeComment(raw: unknown): WeverseComment | null {
  if (!raw || typeof raw !== "object") return null; const item = raw as Partial<WeverseComment>; if (typeof item.id !== "string" || typeof item.authorId !== "string") return null;
  const authorType: WeverseAuthorType = item.authorType === "fan" || item.authorType === "official" || item.authorType === "artist" ? item.authorType : "user";
  return { id: item.id, authorType, authorId: item.authorId, authorName: typeof item.authorName === "string" ? item.authorName : undefined, authorAvatarUrl: typeof item.authorAvatarUrl === "string" ? item.authorAvatarUrl : undefined,
    body: typeof item.body === "string" ? item.body : "", originalBody: typeof item.originalBody === "string" ? item.originalBody : undefined, parentId: typeof item.parentId === "string" && item.parentId ? item.parentId : undefined,
    deleted: item.deleted === true, createdAt: typeof item.createdAt === "number" && Number.isFinite(item.createdAt) ? item.createdAt : Date.now() };
}
function normalizeCommunity(raw: unknown): WeverseCommunity | null {
  if (!raw || typeof raw !== "object") return null; const item = raw as Partial<WeverseCommunity>; if (typeof item.id !== "string" || typeof item.name !== "string") return null;
  const officialRaw = item.official && typeof item.official === "object" ? item.official : { displayName: `${item.name} Official` };
  const profiles = item.memberProfiles && typeof item.memberProfiles === "object" ? item.memberProfiles : {};
  const historyMode: WeverseHistoryMode = item.historyMode === "new" || item.historyMode === "custom" ? item.historyMode : item.historyMode === "existing" ? "existing" : "new";
  return { id: item.id, name: item.name, description: typeof item.description === "string" ? item.description : undefined, avatarUrl: typeof item.avatarUrl === "string" ? item.avatarUrl : undefined, coverUrl: typeof item.coverUrl === "string" ? item.coverUrl : undefined,
    official: { displayName: typeof officialRaw.displayName === "string" && officialRaw.displayName.trim() ? officialRaw.displayName : `${item.name} Official`, avatarUrl: typeof officialRaw.avatarUrl === "string" ? officialRaw.avatarUrl : undefined, bio: typeof officialRaw.bio === "string" ? officialRaw.bio : undefined },
    userIdentityId: typeof item.userIdentityId === "string" ? item.userIdentityId : undefined,
    liveStyle: typeof item.liveStyle === "string" ? item.liveStyle : undefined,
    chineseProxyInput: item.chineseProxyInput !== false,
    memberCharacterIds: uniqueStrings(item.memberCharacterIds), memberProfiles: profiles as Record<string, WeverseMemberProfile>, officialMediaPhotoIds: uniqueStrings(item.officialMediaPhotoIds), fanCount: finiteNonNegative(item.fanCount, 100000),
    historyMode, historyStartAt: typeof item.historyStartAt === "number" && Number.isFinite(item.historyStartAt) ? item.historyStartAt : undefined,
    historyInitializedAt: typeof item.historyInitializedAt === "number" && Number.isFinite(item.historyInitializedAt) ? item.historyInitializedAt : undefined,
    historyCursorAt: typeof item.historyCursorAt === "number" && Number.isFinite(item.historyCursorAt) ? item.historyCursorAt : undefined,
    createdAt: typeof item.createdAt === "number" && Number.isFinite(item.createdAt) ? item.createdAt : Date.now(), updatedAt: typeof item.updatedAt === "number" && Number.isFinite(item.updatedAt) ? item.updatedAt : Date.now() };
}
function normalizeSchedule(raw: unknown): WeverseScheduleItem | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Partial<WeverseScheduleItem>;
  if (typeof item.id !== "string" || typeof item.communityId !== "string" || typeof item.title !== "string") return null;
  const type: WeverseScheduleType = ["media","anniversary","performance","recording","shoot","brand","release","other"].includes(String(item.type))
    ? item.type as WeverseScheduleType : "other";
  const startsAt = typeof item.startsAt === "number" && Number.isFinite(item.startsAt) ? item.startsAt : Date.now();
  const endsAt = typeof item.endsAt === "number" && Number.isFinite(item.endsAt) && item.endsAt > startsAt ? item.endsAt : undefined;
  return {
    id: item.id,
    communityId: item.communityId,
    type,
    title: item.title.trim() || "Schedule",
    contentDescription: typeof item.contentDescription === "string" ? item.contentDescription.slice(0,4000) : undefined,
    linkedLiveId: typeof item.linkedLiveId === "string" ? item.linkedLiveId : undefined,
    publicAt: typeof item.publicAt === "number" && Number.isFinite(item.publicAt) ? item.publicAt : undefined,
    startsAt,
    endsAt,
    location: typeof item.location === "string" && item.location.trim() ? item.location.trim() : undefined,
    memberCharacterIds: uniqueStrings(item.memberCharacterIds),
    source: item.source === "generated" ? "generated" : "manual",
    visibility: (item as Partial<WeverseScheduleItem>).visibility === "internal"
      ? "internal"
      : (item as Partial<WeverseScheduleItem>).visibility === "public"
        ? "public"
        : (["recording", "shoot", "other"].includes(type) ? "internal" : "public"),
    calendarSync: item.calendarSync === true,
    busyLevel: [1,2,3,4].includes(Number(item.busyLevel)) ? Number(item.busyLevel) as 1|2|3|4 : (item.calendarSync ? 3 : 1),
    createdAt: typeof item.createdAt === "number" && Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
    updatedAt: typeof item.updatedAt === "number" && Number.isFinite(item.updatedAt) ? item.updatedAt : Date.now(),
  };
}

function hash01(text: string): number { let h = 2166136261; for (let i=0;i<text.length;i+=1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; }
function legacyCounts(id: string, type: WeverseAuthorType, fanCount: number, visibleComments: number): { likeCount:number; commentCount:number } {
  const r = hash01(id); const base = Math.max(1000, fanCount);
  const likeRatio = type === "artist" ? .035 + r*.085 : type === "official" ? .018+r*.05 : .00008+r*.0012;
  const commentRatio = type === "artist" ? .0015+r*.008 : type === "official" ? .0007+r*.004 : .00001+r*.00018;
  return { likeCount: Math.max(type === "fan" ? 3 : 30, Math.round(base*likeRatio)), commentCount: Math.max(visibleComments, Math.round(base*commentRatio)) };
}
function normalizeState(raw: unknown): WeverseState {
  if (!raw || typeof raw !== "object") return cloneEmpty(); const source = raw as Partial<WeverseState>;
  const communities = Array.isArray(source.communities) ? source.communities.map(normalizeCommunity).filter((v): v is WeverseCommunity => Boolean(v)) : [];
  const communityMap = new Map(communities.map(c=>[c.id,c]));
  const posts = Array.isArray(source.posts) ? source.posts.filter((item): item is WeversePost => Boolean(item && typeof item.id === "string" && typeof item.communityId === "string" && typeof item.body === "string")).map((item) => {
    const comments = Array.isArray(item.comments) ? item.comments.map(normalizeComment).filter((c): c is WeverseComment => Boolean(c)) : [];
    const fallback = legacyCounts(item.id, item.authorType, communityMap.get(item.communityId)?.fanCount || 100000, comments.length);
    const postType: WeversePost["postType"] = item.postType === "voice" && item.authorType === "artist" ? "voice" : "text";
    return { ...item, postType, comments, likeCount: finiteNonNegative(item.likeCount, fallback.likeCount), commentCount: finiteNonNegative(item.commentCount, fallback.commentCount), historical: item.historical === true, photoDescription: typeof item.photoDescription === "string" ? item.photoDescription : undefined };
  }) : [];
  const rawNotices = Array.isArray((source as any).notices) ? (source as any).notices : [];
  const notices: WeverseNotice[] = rawNotices.filter((item: any) => item && typeof item.id === "string" && typeof item.communityId === "string" && typeof item.title === "string").map((item: any) => ({
    id: item.id, communityId: item.communityId, title: item.title, originalTitle: typeof item.originalTitle === "string" ? item.originalTitle : undefined, translatedTitle: typeof item.translatedTitle === "string" ? item.translatedTitle : undefined, body: typeof item.body === "string" ? item.body : "", originalBody: typeof item.originalBody === "string" ? item.originalBody : undefined, imageUrl: typeof item.imageUrl === "string" ? item.imageUrl : undefined, photoLibraryId: typeof item.photoLibraryId === "string" ? item.photoLibraryId : undefined, photoSource: item.photoSource === "album" || item.photoSource === "generated" || item.photoSource === "manual" ? item.photoSource : undefined, photoDescription: typeof item.photoDescription === "string" ? item.photoDescription : undefined, createdAt: typeof item.createdAt === "number" && Number.isFinite(item.createdAt) ? item.createdAt : Date.now(), historical: item.historical === true,
  }));
  const lives = Array.isArray((source as any).lives) ? (source as any).lives.map(normalizeLive).filter((v: WeverseLive | null): v is WeverseLive => Boolean(v)) : [];
  const schedules = Array.isArray((source as any).schedules) ? (source as any).schedules.map(normalizeSchedule).filter((v: WeverseScheduleItem | null): v is WeverseScheduleItem => Boolean(v)) : [];
  return { version: 8, communities, posts, notices, lives, schedules, userProfile: source.userProfile && typeof source.userProfile === "object" ? source.userProfile as WeverseUserProfile : {}, settings: normalizeSettings(source.settings) };
}
export function loadWeverseState(): WeverseState { reconcileCalendarMaster(); if (typeof window === "undefined") return EMPTY_STATE; try { const raw=kvGet(WEV_STATE_KEY); return raw ? normalizeState(JSON.parse(raw)) : cloneEmpty(); } catch { return cloneEmpty(); } }
export function saveWeverseState(state: WeverseState): WeverseState { const normalized=normalizeState(state); if (typeof window !== "undefined") { kvSet(WEV_STATE_KEY, JSON.stringify(normalized)); reconcileCalendarMaster(); window.dispatchEvent(new CustomEvent(WEV_UPDATED_EVENT)); } return typeof window!=="undefined"?normalizeState(JSON.parse(kvGet(WEV_STATE_KEY)||JSON.stringify(normalized))):normalized; }
export function updateWeverseUserProfile(patch: Partial<WeverseUserProfile>): WeverseState { const state=loadWeverseState(); return saveWeverseState({...state,userProfile:{...(state.userProfile||{}),...patch}}); }

export function getWeverseCommunitiesForCharacter(characterId: string): WeverseCommunity[] {
  const id = characterId.trim();
  if (!id) return [];
  return loadWeverseState().communities.filter((community) => community.memberCharacterIds.includes(id));
}

/**
 * 更新角色在某个 Weverse Community 中的独立资料；不触碰 Character 本体。
 * 未指定 communityId 时使用该角色加入的第一个 Community（当前 UI 的主资料语义）。
 */
export function updateWeverseMemberProfile(
  characterId: string,
  patch: Partial<Omit<WeverseMemberProfile, "characterId">>,
  communityId?: string,
): WeverseState {
  const state = loadWeverseState();
  const candidates = state.communities.filter((community) => community.memberCharacterIds.includes(characterId));
  const target = communityId
    ? candidates.find((community) => community.id === communityId)
    : candidates[0];
  if (!target) return state;

  const previous = target.memberProfiles[characterId] || { characterId };
  const nextProfile: WeverseMemberProfile = {
    ...previous,
    ...patch,
    characterId,
  };
  const communities = state.communities.map((community) => community.id === target.id
    ? {
        ...community,
        memberProfiles: { ...community.memberProfiles, [characterId]: nextProfile },
        updatedAt: Date.now(),
      }
    : community);
  return saveWeverseState({ ...state, communities });
}
export function updateWeverseSettings(patch: Partial<WeverseSettings>): WeverseState { const state=loadWeverseState(); return saveWeverseState({...state,settings:normalizeSettings({...state.settings,...patch,notifications:{...state.settings.notifications,...(patch.notifications||{})}})}); }
export function upsertWeverseCommunity(community: WeverseCommunity): WeverseState { const state=loadWeverseState(); const i=state.communities.findIndex(v=>v.id===community.id); const communities=[...state.communities]; if(i>=0) communities[i]=community; else communities.unshift(community); return saveWeverseState({...state,communities}); }
export function deleteWeverseCommunity(communityId:string):WeverseState { const state=loadWeverseState(); state.lives.filter(l => l.communityId === communityId).forEach(l => deleteWeverseLiveMemory(l.id)); return saveWeverseState({...state,communities:state.communities.filter(v=>v.id!==communityId),posts:state.posts.filter(v=>v.communityId!==communityId),notices:state.notices.filter(v=>v.communityId!==communityId),lives:state.lives.filter(v=>v.communityId!==communityId),schedules:state.schedules.filter(v=>v.communityId!==communityId)}); }
export function addWeversePost(post:WeversePost):WeverseState { const state=loadWeverseState(); return saveWeverseState({...state,posts:[post,...state.posts]}); }
export function addWeversePosts(posts:WeversePost[]):WeverseState { if(!posts.length) return loadWeverseState(); const state=loadWeverseState(); return saveWeverseState({...state,posts:[...posts,...state.posts]}); }
export function updateWeversePost(postId:string,patch:Partial<WeversePost>):WeverseState { const state=loadWeverseState(); return saveWeverseState({...state,posts:state.posts.map(v=>v.id===postId?{...v,...patch}:v)}); }
export function deleteWeversePost(postId:string):WeverseState { const state=loadWeverseState(); return saveWeverseState({...state,posts:state.posts.filter(v=>v.id!==postId)}); }
export function addWeverseComment(postId:string,comment:WeverseComment):WeverseState { const state=loadWeverseState(); return saveWeverseState({...state,posts:state.posts.map(v=>v.id===postId?{...v,comments:[...v.comments,comment]}:v)}); }
export function addWeverseComments(postId:string,comments:WeverseComment[]):WeverseState { if(!comments.length)return loadWeverseState(); const state=loadWeverseState(); return saveWeverseState({...state,posts:state.posts.map(v=>v.id===postId?{...v,comments:[...v.comments,...comments]}:v)}); }
export function deleteWeverseComment(postId:string,commentId:string):WeverseState { const state=loadWeverseState(); return saveWeverseState({...state,posts:state.posts.map(post=>{ if(post.id!==postId)return post; const hasChildren=post.comments.some(c=>c.parentId===commentId); const comments=hasChildren?post.comments.map(c=>c.id===commentId?{...c,body:"",originalBody:undefined,deleted:true}:c):post.comments.filter(c=>c.id!==commentId); return {...post,comments}; })}); }
export function createWeverseId(prefix:string):string { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`; }

export function addWeverseNotice(notice:WeverseNotice):WeverseState { const state=loadWeverseState(); return saveWeverseState({...state,notices:[notice,...state.notices]}); }
export function updateWeverseNotice(noticeId:string,patch:Partial<WeverseNotice>):WeverseState { const state=loadWeverseState(); return saveWeverseState({...state,notices:state.notices.map(v=>v.id===noticeId?{...v,...patch}:v)}); }
export function deleteWeverseNotice(noticeId:string):WeverseState { const state=loadWeverseState(); return saveWeverseState({...state,notices:state.notices.filter(v=>v.id!==noticeId)}); }

export function upsertWeverseScheduleItem(item: WeverseScheduleItem): WeverseState {
  const state = loadWeverseState();
  const schedules = [item, ...state.schedules.filter((entry) => entry.id !== item.id)];
  return saveWeverseState({ ...state, schedules });
}
export function deleteWeverseScheduleItem(itemId: string): WeverseState {
  const state = loadWeverseState();
  return saveWeverseState({ ...state, schedules: state.schedules.filter((entry) => entry.id !== itemId) });
}

export function addWeverseLive(live: WeverseLive): WeverseState {
  const state = loadWeverseState();
  return saveWeverseState({ ...state, lives: [live, ...state.lives.filter((item) => item.id !== live.id)] });
}
export function updateWeverseLive(liveId: string, patch: Partial<WeverseLive>): WeverseState {
  const state = loadWeverseState();
  return saveWeverseState({ ...state, lives: state.lives.map((item) => item.id === liveId ? { ...item, ...patch } : item) });
}
export function deleteWeverseLive(liveId: string): WeverseState {
  deleteWeverseLiveMemory(liveId);
  const state = loadWeverseState();
  return saveWeverseState({ ...state, lives: state.lives.filter((item) => item.id !== liveId) });
}
