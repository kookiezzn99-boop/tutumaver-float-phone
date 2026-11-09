"use client";

import { useAppBack } from "@/lib/back-navigation";
import { AppNotificationSetting } from "@/components/social/app-notifications";
import {syncBilingualEdit,isForeignOriginal} from "@/lib/bilingual-edit";
import {getWvsBackground,setWvsBackground} from "@/lib/weverse-background";
import {calendarForWeverseProjection} from "@/lib/weverse-schedule-sync";
import { hasPhotoMatchDescription } from "@/lib/photo-library-usage";
import {calendarWallTimeToInstant} from "@/lib/calendar-time";
import {formatZonedPromptTimestamp,getSystemTimeZone} from "@/lib/character-time";
import { simpleLLMCall } from "@/lib/api-helpers";
import { resolveAuxiliaryApiConfig } from "@/lib/settings-storage";
import { Toggle } from "@/components/ui/form";
import { LIVE_CHINESE_PROXY_RULE } from "@/lib/live-chinese-proxy";
import { recordWeverseReplaySummary } from "@/lib/weverse-memory";
import { initialWvsViewers, nextWvsViewers } from "@/lib/weverse-live-metrics";
import { unlockedScheduleContent } from "@/lib/schedule-public-content";
import { useGenerationFeedback } from "@/components/generation-feedback";
import { weverseLiveAvailability, claimWeverseLiveOpportunity } from "@/lib/weverse-live-availability";
import { addWeverseLiveGuest, inviteArtistFromLive, isPersonalWeverseCommunity, maybeInviteUserFromLive, removeWeverseLiveGuest, requestWeverseLiveJoin, weverseArtists } from "@/lib/weverse-live-collaboration";
import { preparePhotoStoryCaption } from "@/lib/photo-story-caption";

import { translateContentTexts } from "@/lib/content-translation";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  History,
  Bell,
  Bookmark,
  CalendarDays,
  Camera,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  Heart,
  ImagePlus,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Radio,
  Search,
  Send,
  Settings,
  Sparkles,
  Trash2,
  UserRound,
  UsersRound,
  Video,
  X,
} from "lucide-react";

import { loadCharacters, CHARACTERS_UPDATED_EVENT } from "@/lib/character-storage";
import type { Character } from "@/lib/character-types";
import { resolveUserIdentity, USER_IDENTITIES_UPDATED_EVENT } from "@/lib/settings-storage";
import {
  addWeverseComment,
  addWeverseComments,
  addWeversePost,
  addWeverseNotice,
  addWeverseLive,
  createWeverseId,
  deleteWeverseComment,
  deleteWeverseCommunity,
  deleteWeversePost,
  deleteWeverseNotice,
  deleteWeverseLive,
  loadWeverseState,
  updateWeversePost,
  updateWeverseNotice,
  updateWeverseSettings,
  updateWeverseLive,
  updateWeverseUserProfile,
  upsertWeverseScheduleItem,
  upsertWeverseCommunity,
  WEV_UPDATED_EVENT,
  type WeverseAuthorType,
  type WeverseComment,
  type WeverseCommunity,
  type WeversePost,
  type WeverseNotice,
  type WeverseSettings,
  type WeverseHistoryMode,
  type WeverseLive,
  type WeverseScheduleItem,
  type WeverseScheduleType,
  type WeverseState,
} from "@/lib/weverse-storage";
import {
  generateWeverseArtistPost,
  generateWeverseArtistReply,
  generateWeverseFanBatch,
  generateWeverseOfficialPost,
  generateWeverseOfficialNotice,
  generateWeverseLiveOpening,
  generateWeverseLiveContinuation,
} from "@/lib/weverse-engine";
import { recordPreparedPhotoUse, resolveMediaForUse } from "@/lib/media-resolver";
import {
  recordWeverseArtistPostEvent,
  recordWeverseArtistReplyEvent,
  deleteWeverseProjectionEventForComment,
  deleteWeverseProjectionEventsForPost,
} from "@/lib/weverse-memory";
import { incrementEventCounter } from "@/lib/memory-storage";
import { maybeRunSummarization } from "@/lib/memory-summarizer";
import { getChatImageFromIndexedDB, saveChatImageToIndexedDB } from "@/lib/chat-asset-storage";
import { appendPhotoRecords, createPhotoId, loadPhotoLibrary, PHOTO_LIBRARY_UPDATED_EVENT } from "@/lib/photo-library-storage";
import type { PhotoRecord } from "@/lib/photo-library-types";
import { analyzePhotosInBackground } from "@/lib/photo-library-vision";
import { createWeverseEngagement } from "@/lib/weverse-engagement";
import { WeverseLiveView } from "./weverse-live-view";
import { WeverseVoicePost } from "./weverse-voice-post";
import { formatIsoDate, getMonthMatrix, isSameMonth, parseIsoDate } from "@/lib/calendar-utils";
import { removeWeverseScheduleItemEverywhere, syncWeverseScheduleItemToCalendar } from "@/lib/weverse-schedule-sync";

import styles from "./weverse-app.module.css";

type Props = {
  visible?: boolean;
  onClose: () => void;
  onNotice?: (message: string) => void;
};

type MainTab = "feed" | "community";
type CommunityTab = "home" | "feed" | "media";
type CommunityFeedFilter = "highlight" | "fan" | "artist";
type ArtistTab = "posts" | "comments" | "live";
type OfficialTab = "posts" | "comments";
type MyTab = "posts" | "comments" | "bookmarks";
type Route =
  | { type: "root" }
  | { type: "community"; id: string }
  | { type: "artist"; communityId: string; characterId: string }
  | { type: "post"; postId: string; focusCommentId?: string }
  | { type: "official"; communityId: string }
  | { type: "schedule"; communityId: string }
  | { type: "notices"; communityId: string }
  | { type: "notice"; noticeId: string }
  | { type: "live"; liveId: string }
  | { type: "me"; view: MyTab };

type CommunityEditorDraft = {
  userCommunity?: boolean; liveStyle?: string; chineseProxyInput?: boolean;
  id?: string;
  name: string;
  description: string;
  avatarUrl: string;
  coverUrl: string;
  officialName: string;
  officialAvatarUrl: string;
  officialBio: string;
  selectedCharacterIds: string[];
  fanCount: string;
  historyMode: WeverseHistoryMode;
  historyStartDate: string;
  autoHistory: boolean;
};

type MemberEditorDraft = {
  communityId: string;
  characterId: string;
  displayName: string;
  avatarUrl: string;
  coverUrl: string;
  liveCoverUrl: string;
  bio: string;
};

type UserProfileDraft = {
  displayName: string;
  avatarUrl: string;
  bio: string;
};

type NoticeEditorDraft = {
  originalTitle: string;
  originalBody: string;
  id?: string;
  communityId: string;
  title: string;
  body: string;
};

type LiveCreatorDraft = {
  communityId: string;
  characterId: string;
  liveType: "auto" | "visual" | "voice";
  theme: string;
  coverUrl: string;
};

type ScheduleEditorDraft = {
  contentDescription?: string; publicAt?: string;
  id?: string;
  communityId: string;
  visibility: "public" | "internal";
  type: WeverseScheduleType;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  memberCharacterIds: string[];
  calendarSync: boolean;
};

type AiMenuContext =
  | { type: "global" }
  | { type: "community"; communityId: string }
  | { type: "post"; postId: string; focusCommentId?: string };

type PhotoPickerState = {
  communityId: string;
  mode: "manageOfficial" | "composeOfficial" | "manageArtist" | "composeFan";
  characterId?: string;
} | null;

type LocalWeverseNotification = {
  id: string;
  kind: "artistReply" | "fanReply" | "artistPost" | "officialPost" | "live";
  communityId: string;
  title: string;
  body: string;
  avatarUrl?: string;
  createdAt: number;
  read: boolean;
  targetType: "post" | "live" | "artist" | "official";
  targetId?: string;
  characterId?: string;
};

const WVS_NOTIFICATION_KEY = "ii_phone_weverse_notifications_v1";
const WVS_FOLLOW_KEY = "ii_phone_weverse_follow_state_v1";
const DEFAULT_FAN_AVATAR_URL = "/npc-default-avatar.png";

function loadFollowState(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = JSON.parse(localStorage.getItem(WVS_FOLLOW_KEY) || "{}");
    return raw && typeof raw === "object" ? raw as Record<string, boolean> : {};
  } catch { return {}; }
}

function saveFollowState(value: Record<string, boolean>) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(WVS_FOLLOW_KEY, JSON.stringify(value)); } catch {}
}
function loadLocalWeverseNotifications(): LocalWeverseNotification[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = JSON.parse(localStorage.getItem(WVS_NOTIFICATION_KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((item) => item && typeof item.id === "string").slice(0, 200) : [];
  } catch { return []; }
}
function saveLocalWeverseNotifications(items: LocalWeverseNotification[]) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(WVS_NOTIFICATION_KEY, JSON.stringify(items.slice(0, 200))); } catch {}
}

function fileToDataUrl(file: File, maxSize = 900, quality = 0.86): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("无法读取图片"));
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/webp", quality));
      };
      img.onerror = reject;
      img.src = String(reader.result || "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function relativeTime(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "刚刚";
  if (diff < hour) return `${Math.floor(diff / minute)}分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)}小时前`;
  if (diff < day * 7) return `${Math.floor(diff / day)}天前`;
  const date = new Date(ts);
  const now = new Date();
  return date.toLocaleDateString("zh-CN", date.getFullYear() === now.getFullYear()
    ? { month: "numeric", day: "numeric" }
    : { year: "numeric", month: "numeric", day: "numeric" });
}


function formatCompactCount(value: number): string {
  const count = Math.max(0, Math.round(Number(value) || 0));
  if (count < 10000) return count ? count.toLocaleString("zh-CN") : "";
  if (count < 100000000) {
    const n = count / 10000;
    return `${n >= 100 ? Math.round(n) : n.toFixed(n >= 10 ? 1 : 1).replace(/\.0$/, "")}万`;
  }
  const n = count / 100000000;
  return `${n.toFixed(n >= 10 ? 1 : 1).replace(/\.0$/, "")}亿`;
}

function formatLiveDuration(startedAt: number, endedAt?: number): string {
  const seconds = Math.max(0, Math.floor(((endedAt || Date.now()) - startedAt) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}` : `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function dateInputValue(ts?: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

function parseDateInput(value: string): number | undefined {
  if (!value) return undefined;
  const ts = new Date(`${value}T12:00:00`).getTime();
  return Number.isFinite(ts) ? ts : undefined;
}

const WVS_SCHEDULE_LABELS: Record<WeverseScheduleType | "live", string> = {
  media: "节目·媒体", anniversary: "纪念日", performance: "舞台·活动", recording: "内部录影", shoot: "内部拍摄", brand: "品牌·时尚", release: "作品·发布", other: "内部行程", live: "Live",
};

const WVS_PUBLIC_SCHEDULE_TYPES: Array<{ type: WeverseScheduleType; label: string }> = [
  { type: "performance", label: "舞台 / 活动" },
  { type: "brand", label: "品牌 / 时尚" },
  { type: "anniversary", label: "纪念日" },
  { type: "release", label: "作品 / 发布" },
  { type: "media", label: "节目 / 媒体" },
];

function scheduleDateTime(date: string, time: string): number {
  return new Date(`${date}T${time || "12:00"}:00`).getTime();
}

function scheduleDateKey(ts: number): string {
  return formatIsoDate(new Date(ts));
}

function scheduleTimeLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function Avatar({
  text,
  imageUrl,
  tone = "dark",
  className = "",
}: {
  text: string;
  imageUrl?: string | null;
  tone?: "dark" | "teal" | "soft";
  className?: string;
}) {
  if (imageUrl) {
    return <span className={`${styles.avatar} ${styles.avatarImage} ${className}`}><img src={imageUrl} alt="" /></span>;
  }
  return <span className={`${styles.avatar} ${styles[tone]} ${className}`}>{text.trim().slice(0, 1) || "W"}</span>;
}

function Verified() {
  return <span className={styles.verify}>✓</span>;
}

function ResolvedAssetImage({ src, className = "", alt = "" }: { src: string; className?: string; alt?: string }) {
  const [resolved, setResolved] = useState(src.startsWith("asset://") ? "" : src);
  useEffect(() => {
    let cancelled = false;
    if (!src.startsWith("asset://")) { setResolved(src); return; }
    getChatImageFromIndexedDB(src.slice(8)).then((url) => { if (!cancelled) setResolved(url || ""); }).catch(() => { if (!cancelled) setResolved(""); });
    return () => { cancelled = true; };
  }, [src]);
  if (!resolved) return <span className={styles.assetImagePlaceholder}>…</span>;
  return <img className={className} src={resolved} alt={alt} />;
}

function WeversePostImage({ src, onClick }: { src: string; onClick?: () => void }) {
  return <button type="button" className={styles.postImageButton} onClick={onClick}><ResolvedAssetImage src={src} className={styles.postImage} alt="Weverse post" /></button>;
}

export function WeverseApp({ visible=true, onClose, onNotice: externalNotice }: Props) {
  const [tab, setTab] = useState<MainTab>("feed");
  const [routeStack, setRouteStack] = useState<Route[]>([{ type: "root" }]);
  const [state, setState] = useState<WeverseState>(() => loadWeverseState());
  useEffect(() => {
    const next = state.schedules.map(item => item.publicAt || item.startsAt).filter(at => at > Date.now()).sort((a,b)=>a-b)[0];
    if (!next) return;
    const timer = window.setTimeout(() => setState(loadWeverseState()), Math.min(2147483647, Math.max(1,next-Date.now()+50)));
    return () => window.clearTimeout(timer);
  }, [state]);

  const [characters, setCharacters] = useState<Character[]>(() => loadCharacters());
  const [, setPhotoTick] = useState(0);

  const [composerOpen, setComposerOpen] = useState(false);
  const [shareLive,setShareLive]=useState<WeverseLive|null>(null);
  const [sharingReplay,setSharingReplay]=useState(false);
  const [userActions,setUserActions]=useState<string|null>(null);
  const [userLiveDraft, setUserLiveDraft] = useState<{ communityId: string; title: string; theme: string; guestIds?: string[] } | null>(null);
  const [liveActions, setLiveActions] = useState<{ liveId: string; artistId?: string } | null>(null);
  const [joinPendingLiveId, setJoinPendingLiveId] = useState<string | null>(null);
  const liveGenerationRef = useRef<string | null>(null);
  const [voicePost,setVoicePost]=useState(false);
  const [composerAuthorType, setComposerAuthorType] = useState<WeverseAuthorType>("user");
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [photoEditor, setPhotoEditor] = useState<{ postId: string; description: string } | null>(null);
  const [noticePhotoEditor, setNoticePhotoEditor] = useState<{ noticeId: string; communityId: string; description: string } | null>(null);
  const [photoGenerating, setPhotoGenerating] = useState(false);
  const photoHoldTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [postMenuId, setPostMenuId] = useState<string | null>(null);
  const [commentMenu, setCommentMenu] = useState<{ postId: string; commentId: string } | null>(null);
  const [communityMenuId, setCommunityMenuId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<LocalWeverseNotification[]>([]);
  const [followState, setFollowState] = useState<Record<string, boolean>>({});
  const [historyDraft, setHistoryDraft] = useState<{ communityId: string; from: string; to: string; count: number; kind: "mixed" | "artist" | "official" | "fan" | "notice" | "schedule" } | null>(null);
  const [historyProgress, setHistoryProgress] = useState("");
  const historyLock = useRef(false);
  const [aiMenuContext, setAiMenuContext] = useState<AiMenuContext | null>(null);
  const [photoPicker, setPhotoPicker] = useState<PhotoPickerState>(null);

  const [communityEditor, setCommunityEditor] = useState<CommunityEditorDraft | null>(null);
  const [communityEditorError, setCommunityEditorError] = useState("");
  const [memberEditor, setMemberEditor] = useState<MemberEditorDraft | null>(null);
  const [userProfileDraft, setUserProfileDraft] = useState<UserProfileDraft | null>(null);
  const translatedNoticeAttempts = useRef(new Set<string>());
  const [noticeEditor, setNoticeEditor] = useState<NoticeEditorDraft | null>(null);
  const [liveCreator, setLiveCreator] = useState<LiveCreatorDraft | null>(null);
  const [generatingLiveId, setGeneratingLiveId] = useState<string | null>(null);
  const [startingLive, setStartingLive] = useState(false);
  const [editingReplayCoverId, setEditingReplayCoverId] = useState<string | null>(null);

  const [draftOriginalText, setDraftOriginalText] = useState("");
  const [translationBusy, setTranslationBusy] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [draftImageUrl, setDraftImageUrl] = useState("");
  const [draftPhotoLibraryId, setDraftPhotoLibraryId] = useState<string | null>(null);
  const [draftCommunityId, setDraftCommunityId] = useState("");
  const [commentDraft, setCommentDraft] = useState("");
  const [replyTarget, setReplyTarget] = useState<{ postId: string; commentId: string; name: string } | null>(null);

  const [communityTab, setCommunityTab] = useState<CommunityTab>("home");
  const [communityFeedFilter, setCommunityFeedFilter] = useState<CommunityFeedFilter>("highlight");
  const [artistTab, setArtistTab] = useState<ArtistTab>("posts");
  const [officialTab, setOfficialTab] = useState<OfficialTab>("posts");
  const [searchText, setSearchText] = useState("");
  const [showOriginalByPost, setShowOriginalByPost] = useState<Record<string, boolean>>({});
  const [showOriginalByComment, setShowOriginalByComment] = useState<Record<string, boolean>>({});
  const [generatingCommunityId, setGeneratingCommunityId] = useState<string | null>(null);
  const [generatingCommentsPostId, setGeneratingCommentsPostId] = useState<string | null>(null);
  const [generatingHistoryCommunityId, setGeneratingHistoryCommunityId] = useState<string | null>(null);
  const [scheduleMonth, setScheduleMonth] = useState(() => formatIsoDate(new Date()).slice(0, 7) + "-01");
  const [selectedScheduleDate, setSelectedScheduleDate] = useState(() => formatIsoDate(new Date()));
  const [scheduleEditor, setScheduleEditor] = useState<ScheduleEditorDraft | null>(null);
  const [generatingScheduleCommunityId, setGeneratingScheduleCommunityId] = useState<string | null>(null);
  const [showInternalSchedule, setShowInternalSchedule] = useState(true);
  const { onNotice, feedback: generationFeedback } = useGenerationFeedback(generatingScheduleCommunityId ? "正在生成 Weverse 日程…" : generatingHistoryCommunityId ? (/^正在/.test(historyProgress) ? historyProgress : "正在补充 Weverse 历史记录…") : startingLive ? "正在生成 Live 开场…" : generatingLiveId ? "正在生成 Live 后续…" : generatingCommentsPostId ? "正在生成 Weverse 评论…" : photoGenerating ? "正在生成 Weverse 图片…" : translationBusy ? "正在翻译…" : generatingCommunityId ? "正在生成 Weverse 社区内容…" : null, externalNotice);
  const [flashCommentId, setFlashCommentId] = useState<string | null>(null);
  const [, setIdentityTick] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const communityAvatarInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const officialAvatarInputRef = useRef<HTMLInputElement>(null);
  const memberAvatarInputRef = useRef<HTMLInputElement>(null);
  const memberCoverInputRef = useRef<HTMLInputElement>(null);
  const memberLiveCoverInputRef = useRef<HTMLInputElement>(null);
  const liveCreatorCoverInputRef = useRef<HTMLInputElement>(null);
  const replayCoverInputRef = useRef<HTMLInputElement>(null);
  const userAvatarInputRef = useRef<HTMLInputElement>(null);
  const officialMediaUploadInputRef = useRef<HTMLInputElement>(null);

  const route = routeStack[routeStack.length - 1] ?? { type: "root" as const };
  const immersiveRoute = route.type === "community" || route.type === "artist" || route.type === "official" || route.type === "live";
  const userIdentity = resolveUserIdentity(undefined, "weverse") ?? resolveUserIdentity();
  const artistName=userIdentity?.name?.trim() || "我";
  const myArtistId = `user:${userIdentity?.id || "user"}`;
  const artistAvatar=userIdentity?.avatarUrl || "";
  const userName = state.userProfile?.displayName?.trim() || "我";
  const userAvatar = state.userProfile?.avatarUrl || "";
  const userBio = state.userProfile?.bio?.trim() || "Fan account";

  useEffect(() => { setNotifications(loadLocalWeverseNotifications()); setFollowState(loadFollowState()); }, []);

  useEffect(() => {
    const reloadState = () => setState(loadWeverseState());
    const reloadCharacters = () => setCharacters(loadCharacters());
    const reloadIdentity = () => setIdentityTick((value) => value + 1);
    const reloadPhotos = () => setPhotoTick((value) => value + 1);
    window.addEventListener(WEV_UPDATED_EVENT, reloadState);
    window.addEventListener(CHARACTERS_UPDATED_EVENT, reloadCharacters);
    window.addEventListener(USER_IDENTITIES_UPDATED_EVENT, reloadIdentity);
    window.addEventListener(PHOTO_LIBRARY_UPDATED_EVENT, reloadPhotos);
    return () => {
      window.removeEventListener(WEV_UPDATED_EVENT, reloadState);
      window.removeEventListener(CHARACTERS_UPDATED_EVENT, reloadCharacters);
      window.removeEventListener(USER_IDENTITIES_UPDATED_EVENT, reloadIdentity);
      window.removeEventListener(PHOTO_LIBRARY_UPDATED_EVENT, reloadPhotos);
    };
  }, []);

  useEffect(() => {
    if (route.type !== "post" || !route.focusCommentId) return;
    const focusId = route.focusCommentId;
    const timer = window.setTimeout(() => {
      document.getElementById(`wvs-comment-${focusId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      setFlashCommentId(focusId);
      window.setTimeout(() => setFlashCommentId((current) => current === focusId ? null : current), 1200);
    }, 100);
    return () => window.clearTimeout(timer);
  }, [route]);

  useEffect(() => {
    if (!draftCommunityId && state.communities[0]?.id) setDraftCommunityId(state.communities[0].id);
    if (draftCommunityId && !state.communities.some((item) => item.id === draftCommunityId)) {
      setDraftCommunityId(state.communities[0]?.id || "");
    }
  }, [draftCommunityId, state.communities]);

  const characterMap = useMemo(() => new Map(characters.map((item) => [item.id, item])), [characters]);
  const communityMap = useMemo(() => new Map(state.communities.map((item) => [item.id, item])), [state.communities]);
  const postMap = useMemo(() => new Map(state.posts.map((item) => [item.id, item])), [state.posts]);
  const noticeMap = useMemo(() => new Map(state.notices.map((item) => [item.id, item])), [state.notices]);
  const retiredLiveIds = useMemo(() => new Set(state.lives.filter(live => live.official).map(live => live.id)), [state.lives]);
  const visibleNotifications = notifications.filter(item => item.targetType !== "live" || !item.targetId || !retiredLiveIds.has(item.targetId));
  const liveMap = useMemo(() => new Map(state.lives.filter(item => !item.official).map((item) => [item.id, item])), [state.lives]);
  const photoLibrary = loadPhotoLibrary();
  const photoMap = new Map(photoLibrary.photos.map((item) => [item.id, item]));

  const filteredCommunities = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) return state.communities;
    return state.communities.filter((item) => item.name.toLowerCase().includes(query));
  }, [searchText, state.communities]);

  const isFollowing = (key: string) => followState[key] === true;
  const toggleFollow = (key: string) => {
    setFollowState((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      saveFollowState(next);
      return next;
    });
  };
  const pushNotification = (item: Omit<LocalWeverseNotification, "id" | "createdAt" | "read"> & { createdAt?: number }) => {
    const latestSettings = loadWeverseState().settings;
    if (!latestSettings.notifications[item.kind]) return;
    const nextItem: LocalWeverseNotification = { ...item, id: createWeverseId("wvs_notice_local"), createdAt: item.createdAt || Date.now(), read: false };
    setNotifications((prev) => { const next = [nextItem, ...prev].slice(0, 200); saveLocalWeverseNotifications(next); return next; });
  };
  const markAllNotificationsRead = () => setNotifications((prev) => { const next = prev.map((item) => ({ ...item, read: true })); saveLocalWeverseNotifications(next); return next; });
  const openNotification = (item: LocalWeverseNotification) => {
    setNotifications((prev) => { const next = prev.map((row) => row.id === item.id ? { ...row, read: true } : row); saveLocalWeverseNotifications(next); return next; });
    setNotificationsOpen(false);
    if (item.targetType === "post" && item.targetId) navigate({ type: "post", postId: item.targetId });
    else if (item.targetType === "live" && item.targetId) navigate({ type: "live", liveId: item.targetId });
    else if (item.targetType === "artist" && item.characterId) navigate({ type: "artist", communityId: item.communityId, characterId: item.characterId });
    else if (item.targetType === "official") navigate({ type: "official", communityId: item.communityId });
  };
  const routeExists = (page: Route) => {
    switch (page.type) {
      case "root":
      case "me": return true;
      case "community": return communityMap.has(page.id);
      case "post": return postMap.has(page.postId);
      case "notice": return noticeMap.has(page.noticeId);
      case "live": return liveMap.has(page.liveId);
      case "artist": return communityMap.get(page.communityId)?.memberCharacterIds.includes(page.characterId) === true;
      default: return communityMap.has(page.communityId);
    }
  };
  const navigate = (next: Route) => {
    const key = (page: Route) => page.type === "post" ? `post:${page.postId}` : JSON.stringify(page);
    setRouteStack(previous => {
      const stack = previous.filter(routeExists);
      const index = stack.findIndex(page => key(page) === key(next));
      return index < 0 ? [...stack, next] : [...stack.slice(0, index), next];
    });
  };
  useEffect(() => {
    const open = (event: Event) => {
      const notice = (event as CustomEvent<{ app: string; targetId: string; targetType: string; id: string }>).detail;
      if (notice?.app !== "weverse") return;
      const item = loadLocalWeverseNotifications().find(row => `weverse:${row.id}` === notice.id);
      if (item) openNotification(item);
      else if (notice.targetType === "live" && liveMap.has(notice.targetId)) navigate({ type: "live", liveId: notice.targetId });
      else if (postMap.has(notice.targetId)) navigate({ type: "post", postId: notice.targetId });
    };
    window.addEventListener("social-notification-open", open);
    return () => window.removeEventListener("social-notification-open", open);
  });
  const back = () => {
    if (settingsOpen) { setSettingsOpen(false); return; }
    if (drawerOpen) { setDrawerOpen(false); return; }
    if(memberEditor){setMemberEditor(null);return;}
    if(liveActions){setLiveActions(null);return;}if(shareLive){setShareLive(null);return;}if(userActions){setUserActions(null);return;}if(userLiveDraft){setUserLiveDraft(null);return;}if(communityEditor){setCommunityEditor(null);return;}if(composerOpen){setComposerOpen(false);return;}
    if (notificationsOpen) { setNotificationsOpen(false); return; }
    if (routeStack.length > 1) setRouteStack(previous => previous.slice(0, -1).filter(routeExists));
    else onClose();
  };
  useAppBack(back, () => visible, 18);
  const goRoot = (nextTab: MainTab) => {
    setTab(nextTab);
    setRouteStack([{ type: "root" }]);
  };

  useEffect(() => {
    if (route.type !== "notice") return;
    const notice = noticeMap.get(route.noticeId);
    if (!notice || notice.translatedTitle || !/[가-힣ぁ-んァ-ン]/.test(notice.title) || translatedNoticeAttempts.current.has(notice.id)) return;
    translatedNoticeAttempts.current.add(notice.id);
    let cancelled = false;
    void translateContentTexts([notice.originalTitle || notice.title], "weverse").then(([title]) => {
      if (cancelled) return;
      const current = loadWeverseState().notices.find(item => item.id === notice.id);
      if (!current || current.title !== notice.title || current.translatedTitle) return;
      setState(updateWeverseNotice(notice.id, { originalTitle: notice.originalTitle || notice.title, translatedTitle: title, title }));
    }).catch(error => { if (!cancelled) onNotice?.(`公告标题翻译失败：${error instanceof Error ? error.message : String(error)}`); });
    return () => { cancelled = true; };
  }, [route.type === "notice" ? route.noticeId : null]);
  const resolveMember = (community: WeverseCommunity, characterId: string) => {
    const char = characterMap.get(characterId);
    const override = community.memberProfiles[characterId];
    return {
      character: char,
      displayName: override?.displayName?.trim() || char?.name?.trim() || (characterId.startsWith("user:") ? artistName : "未命名成员"),
      avatarUrl: override?.avatarUrl || char?.avatar || (characterId.startsWith("user:") ? artistAvatar : ""),
      coverUrl: override?.coverUrl || community.coverUrl || "",
      liveCoverUrl: override?.liveCoverUrl || "",
      bio: override?.bio || (characterId.startsWith("user:") && isPersonalWeverseCommunity(community) ? userIdentity?.bio || "" : ""),
    };
  };

  const resolvePostAuthor = (post: WeversePost) => {
    const community = communityMap.get(post.communityId);
    if (post.authorType === "user") return { name: userName, avatarUrl: userAvatar, verified: false, meta: `${community?.name || "Community"} · Fan` };
    if (post.authorType === "fan") return { name: post.authorName || "익명팬", avatarUrl: DEFAULT_FAN_AVATAR_URL, verified: false, meta: `${community?.name || "Community"} · Fan` };
    if (post.authorType === "official") {
      return { name: community?.official.displayName || `${community?.name || "Community"} Official`, avatarUrl: community?.official.avatarUrl || "", verified: true, meta: `${community?.name || "Community"} · Official` };
    }
    if (community) {
      if(post.authorId.startsWith("user:")){const member=resolveMember(community,post.authorId);return {name:member.displayName,avatarUrl:member.avatarUrl,verified:true,meta:`${community.name} · Artist`};}
      const member = resolveMember(community, post.authorId);
      return { name: member.displayName, avatarUrl: member.avatarUrl, verified: true, meta: `${community.name} · Artist` };
    }
    return { name: characterMap.get(post.authorId)?.name || "Artist", avatarUrl: characterMap.get(post.authorId)?.avatar || "", verified: true, meta: "Artist" };
  };

  const resolveCommentAuthor = (comment: WeverseComment, post: WeversePost) => {
    const community = communityMap.get(post.communityId);
    if (comment.authorType === "user") return { name: userName, avatarUrl: userAvatar, verified: false };
    if (comment.authorType === "fan") return { name: comment.authorName || "익명팬", avatarUrl: DEFAULT_FAN_AVATAR_URL, verified: false };
    if (comment.authorType === "official") return { name: community?.official.displayName || "Official", avatarUrl: community?.official.avatarUrl || "", verified: true };
    if (community) {
      const member = resolveMember(community, comment.authorId);
      return { name: member.displayName, avatarUrl: member.avatarUrl, verified: true };
    }
    return { name: "Artist", avatarUrl: "", verified: true };
  };

  const openCommunityEditor = (community?: WeverseCommunity) => {
    setCommunityEditorError("");
    setCommunityEditor({
      userCommunity: Boolean(community?.userIdentityId), liveStyle:community?.liveStyle || "", chineseProxyInput: community?.chineseProxyInput !== false,
      id: community?.id,
      name: community?.name || "",
      description: community?.description || "",
      avatarUrl: community?.avatarUrl || "",
      coverUrl: community?.coverUrl || "",
      officialName: community?.official.displayName || "",
      officialAvatarUrl: community?.official.avatarUrl || "",
      officialBio: community?.official.bio || "",
      selectedCharacterIds: community ? weverseArtists(community) : [],
      fanCount: String(community?.fanCount || 100000),
      autoHistory: false,
      historyMode: community?.historyMode || "new",
      historyStartDate: dateInputValue(community?.historyStartAt),
    });
  };

  const saveCommunityEditor = () => {
    if (!communityEditor) return;
    const name = communityEditor.name.trim();
    if (!name) { setCommunityEditorError("先填写 Community 名称"); return onNotice?.("先填写 Community 名称"); }
    if (!communityEditor.userCommunity && communityEditor.selectedCharacterIds.length === 0) { setCommunityEditorError("至少选择 1 个成员角色"); return onNotice?.("至少选择 1 个成员角色"); }
    setCommunityEditorError("");
    const existing = communityEditor.id ? communityMap.get(communityEditor.id) : undefined;
    const now = Date.now();
    const id = existing?.id || createWeverseId("wvs_community");
    const fanCount = Math.max(0, Math.round(Number(communityEditor.fanCount.replace(/[,，\s]/g, "")) || 0));
    const historyStartAt = communityEditor.historyMode === "custom" ? parseDateInput(communityEditor.historyStartDate) : communityEditor.historyMode === "existing" ? (existing?.historyStartAt || now - 365 * 24 * 60 * 60 * 1000) : undefined;
    const memberProfiles = { ...(existing?.memberProfiles || {}) };
    const memberCharacterIds = [...new Set([
      ...(communityEditor.userCommunity ? [myArtistId] : []),
      ...communityEditor.selectedCharacterIds.filter(characterId => characterMap.has(characterId)),
    ])];
    if (!memberCharacterIds.length) {
      setCommunityEditorError("至少选择一位成员");
      return;
    }
    Object.keys(memberProfiles).forEach(key => { if (!memberCharacterIds.includes(key)) delete memberProfiles[key]; });
    const next: WeverseCommunity = {
      id, userIdentityId:communityEditor.userCommunity ? userIdentity?.id || "user" : undefined, liveStyle:communityEditor.liveStyle?.trim(), chineseProxyInput: communityEditor.chineseProxyInput !== false,
      name,
      description: communityEditor.description.trim(),
      avatarUrl: communityEditor.avatarUrl || undefined,
      coverUrl: communityEditor.coverUrl || undefined,
      official: {
        displayName: communityEditor.officialName.trim() || `${name} Official`,
        avatarUrl: communityEditor.officialAvatarUrl || undefined,
        bio: communityEditor.officialBio.trim() || "Official Community",
      },
      memberCharacterIds,
      memberProfiles,
      officialMediaPhotoIds: existing?.officialMediaPhotoIds || [],
      fanCount: fanCount || 100000,
      historyMode: communityEditor.historyMode,
      historyStartAt,
      historyInitializedAt: existing?.historyInitializedAt,
      historyCursorAt: existing?.historyCursorAt,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    setState(upsertWeverseCommunity(next));
    setCommunityEditor(null);
    setDraftCommunityId(id);
    setTab("community");
    setRouteStack([{ type: "root" }, { type: "community", id }]);
    onNotice?.(existing ? "Community 已更新" : "Community 已创建");
    if (communityEditor.autoHistory && next.historyMode !== "new" && !next.historyInitializedAt) void initializeCommunityHistory(next);
  };

  const removeCommunity = (community: WeverseCommunity) => {
    if (!window.confirm(`删除「${community.name}」Community？该社区里的 Weverse 帖子与日程也会一起删除。`)) return;
    state.posts.filter((post) => post.communityId === community.id && post.authorType === "artist").forEach((post) => deleteWeverseProjectionEventsForPost(post.id));
    state.schedules.filter((item) => item.communityId === community.id).forEach((item) => removeWeverseScheduleItemEverywhere(item.id));
    setState(deleteWeverseCommunity(community.id));
    setCommunityEditor(null);
    setCommunityMenuId(null);
    setRouteStack([{ type: "root" }]);
    setTab("community");
    onNotice?.("Community 已删除");
  };

  const openMemberEditor = (community: WeverseCommunity, characterId: string) => {
    const member = resolveMember(community, characterId);
    setMemberEditor({ communityId: community.id, characterId, displayName: member.displayName, avatarUrl: member.avatarUrl, coverUrl: community.memberProfiles[characterId]?.coverUrl || "", liveCoverUrl: community.memberProfiles[characterId]?.liveCoverUrl || "", bio: member.bio });
  };

  const saveMemberEditor = () => {
    if (!memberEditor) return;
    const community = communityMap.get(memberEditor.communityId);
    if (!community) return;
    const char = characterMap.get(memberEditor.characterId);
    const next: WeverseCommunity = {
      ...community,
      memberProfiles: {
        ...community.memberProfiles,
        [memberEditor.characterId]: {
          ...(community.memberProfiles[memberEditor.characterId] || {}),
          characterId: memberEditor.characterId,
          displayName: memberEditor.displayName.trim() || char?.name || (memberEditor.characterId.startsWith("user:") ? artistName : "成员"),
          avatarUrl: memberEditor.avatarUrl || undefined,
          coverUrl: memberEditor.coverUrl || undefined,
          liveCoverUrl: memberEditor.liveCoverUrl || undefined,
          bio: memberEditor.bio.trim() || undefined,
        },
      },
      updatedAt: Date.now(),
    };
    setState(upsertWeverseCommunity(next));
    setMemberEditor(null);
    onNotice?.("成员 Weverse 资料已保存，不影响角色本体资料");
  };

  const openUserProfileEditor = () => {
    setDrawerOpen(false);
    setUserProfileDraft({ displayName: state.userProfile?.displayName || "", avatarUrl: state.userProfile?.avatarUrl || "", bio: state.userProfile?.bio || "" });
  };

  const saveUserProfile = () => {
    if (!userProfileDraft) return;
    setState(updateWeverseUserProfile({ displayName: userProfileDraft.displayName.trim() || undefined, avatarUrl: userProfileDraft.avatarUrl || undefined, bio: userProfileDraft.bio.trim() || undefined }));
    setUserProfileDraft(null);
    onNotice?.("Weverse 粉丝资料已保存，只影响 Weverse 展示");
  };

  const updateSettings = (patch: Partial<WeverseSettings>) => setState(updateWeverseSettings(patch));

  const openLiveCreator = (community: WeverseCommunity, characterId: string) => {
    const chosen = characterId;
    if (!chosen) return onNotice?.("这个 Community 还没有成员");
    const active = state.lives.find((live) => live.communityId === community.id && live.status === "live" && !live.official && live.activeCharacterIds.includes(chosen));
    if (active) return navigate({ type: "live", liveId: active.id });
    const member = resolveMember(community, chosen);
    setLiveCreator({ communityId: community.id, characterId: chosen, liveType: "auto", theme: "", coverUrl: member.liveCoverUrl || "" });
  };

  const openCommunitySchedule = (community: WeverseCommunity) => {
    const today = formatIsoDate(new Date());
    setSelectedScheduleDate(today);
    setScheduleMonth(`${today.slice(0, 7)}-01`);
    navigate({ type: "schedule", communityId: community.id });
  };

  const openScheduleEditor = (community: WeverseCommunity, item?: WeverseScheduleItem) => {
    const base = item ? new Date(item.startsAt) : new Date(`${selectedScheduleDate}T12:00:00`);
    const end = item?.endsAt ? new Date(item.endsAt) : new Date(base.getTime() + 60 * 60 * 1000);
    const zone=loadCharacters().find(c=>c.id===weverseArtists(community)[0])?.timeZone||getSystemTimeZone();
    const wall=formatZonedPromptTimestamp(base,zone),endWall=formatZonedPromptTimestamp(end,zone);
    const original=item?calendarForWeverseProjection(item):undefined;
    const pad = (n: number) => String(n).padStart(2, "0");
    setScheduleEditor({
      id: item?.id,
      communityId: community.id,
      visibility: "public",
      type: item?.type || "performance",
      title: item?.title || "",
      contentDescription: item?.contentDescription || "",
      publicAt: item?.publicAt ? formatZonedPromptTimestamp(new Date(item.publicAt),zone).replace(" ","T") : "",
      date: wall.slice(0,10),
      startTime: wall.slice(11,16),
      endTime: endWall.slice(11,16),
      location: original?.location || "",
      memberCharacterIds: item?.memberCharacterIds?.length ? item.memberCharacterIds.slice() : community.memberCharacterIds.slice(),
      calendarSync: item?.visibility === "internal" ? true : (item?.calendarSync ?? true),
    });
  };

  const saveScheduleEditor = () => {
    if (!scheduleEditor) return;
    const community = communityMap.get(scheduleEditor.communityId);
    if (!community) return;
    const title = scheduleEditor.title.trim();
    if (!title) return onNotice?.("请填写日程名称");
    const members = scheduleEditor.memberCharacterIds.filter(id => community.memberCharacterIds.includes(id));
    if (!members.length) return onNotice?.("请至少选择一位参与成员");
    const zone=loadCharacters().find(c=>c.id===weverseArtists(community)[0])?.timeZone||getSystemTimeZone();
    const startsAt = calendarWallTimeToInstant(scheduleEditor.date,scheduleEditor.startTime,zone);
    let endsAt = scheduleEditor.calendarSync?calendarWallTimeToInstant(scheduleEditor.date,scheduleEditor.endTime,zone):startsAt;
    if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt)) return onNotice?.("请填写有效日期和时间");
    if (scheduleEditor.calendarSync && endsAt <= startsAt) return onNotice?.("结束时间需要晚于开始时间");
    const previous = scheduleEditor.id ? state.schedules.find((item) => item.id === scheduleEditor.id) : undefined;
    const item: WeverseScheduleItem = {
      id: scheduleEditor.id || createWeverseId("wvs_schedule"),
      communityId: community.id,
      type: scheduleEditor.type,
      title,
      contentDescription: scheduleEditor.contentDescription?.trim(),
      publicAt: scheduleEditor.calendarSync&&scheduleEditor.publicAt ? calendarWallTimeToInstant(scheduleEditor.publicAt.slice(0,10),scheduleEditor.publicAt.slice(11,16),zone) : undefined,
      startsAt,
      endsAt:scheduleEditor.calendarSync?endsAt:undefined,
      location: scheduleEditor.location.trim() || undefined,
      memberCharacterIds: members,
      source: "manual",
      visibility: scheduleEditor.visibility,
      calendarSync: scheduleEditor.visibility === "internal" ? true : scheduleEditor.calendarSync,
      busyLevel: scheduleEditor.calendarSync ? (previous?.calendarSync ? previous.busyLevel||3 : 3) : 1,
      createdAt: previous?.createdAt || Date.now(),
      updatedAt: Date.now(),
    };
    const applied = syncWeverseScheduleItemToCalendar(item);
    setState(loadWeverseState());
    setScheduleEditor(null);
    setSelectedScheduleDate(scheduleDateKey(item.startsAt));
    setScheduleMonth(`${scheduleDateKey(item.startsAt).slice(0, 7)}-01`);
    onNotice?.(applied.pending ? "时间有冲突，已存入日历待调整行程" : item.visibility === "internal" ? "内部行程已保存，并同步到角色手机日历" : item.calendarSync ? "公开日程已保存，并同步到手机日历" : "公开日程已保存到 Weverse Calendar");
  };

  const removeScheduleItem = (item: WeverseScheduleItem) => {
    if (!window.confirm(`删除日程「${item.title}」？`)) return;
    removeWeverseScheduleItemEverywhere(item.id);
    setState(loadWeverseState());
    if (scheduleEditor?.id === item.id) setScheduleEditor(null);
    onNotice?.("日程已删除");
  };

  

  const scheduleLiveSegments = (
    defaultCharacterId: string,
    items: Array<{ kind: "speech" | "action"; characterId?: string; original: string; translated?: string; replyToCommentIds?: string[] }>,
    startAt: number,
  ) => {
    let cursor = startAt;
    return items.map((item, index) => {
      const textWeight = Math.min(1800, Math.max(0, item.original.length - 18) * 28);
      const gap = item.kind === "action" ? 1200 + Math.round(Math.random() * 700) : 2100 + Math.round(Math.random() * 1100) + textWeight;
      cursor += index === 0 ? 650 : gap;
      return {
        id: createWeverseId("wvs_live_segment"), kind: item.kind, characterId: item.characterId || defaultCharacterId,
        original: item.original, translated: item.translated, replyToCommentIds: item.replyToCommentIds, createdAt: cursor,
      } as const;
    });
  };

  const scheduleLiveFanComments = (items: Array<{ displayName: string; original: string; translated: string }>, startAt: number) => {
    let cursor = startAt + 420;
    return items.map((item) => {
      cursor += 850 + Math.round(Math.random() * 900);
      return {
        id: createWeverseId("wvs_live_fan"), authorType: "fan" as const, authorId: createWeverseId("live_fan"), authorName: item.displayName,
        body: item.translated, originalBody: item.original !== item.translated ? item.original : undefined, createdAt: cursor,
      };
    });
  };

  const scheduleLiveArtistComments = (
    community: WeverseCommunity,
    items: Array<{ characterId: string; original: string; translated: string }>,
    startAt: number,
  ) => {
    let cursor = startAt + 900;
    return items.map((item) => {
      cursor += 1100 + Math.round(Math.random() * 1400);
      const member = resolveMember(community, item.characterId);
      return {
        id: createWeverseId("wvs_live_artist"), authorType: "artist" as const, authorId: item.characterId, authorName: member.displayName,
        authorAvatarUrl: member.avatarUrl || undefined,
        body: item.translated, originalBody: item.original !== item.translated ? item.original : undefined, createdAt: cursor,
      };
    });
  };

  const persistLiveOpening = (community: WeverseCommunity, characterId: string, generated: Awaited<ReturnType<typeof generateWeverseLiveOpening>>, options: {theme?:string;liveType?:"visual"|"voice"|"auto";coverUrl?:string}) => {
      const available=weverseLiveAvailability(characterId);
      if(!available.free)throw new Error(available.reason);
      const member = resolveMember(community, characterId);
      const viewerCount = initialWvsViewers(community.fanCount);
      // 关键：LLM 返回后才开始排播放时间，避免生成耗时把整轮内容“提前播完”。
      const playbackStart = Date.now() + 250;
      const segments = scheduleLiveSegments(characterId, generated.segments, playbackStart);
      const comments = scheduleLiveFanComments(generated.comments, playbackStart);
      const live: WeverseLive = {
        id: createWeverseId("wvs_live"), communityId: community.id, hostCharacterIds: [characterId], activeCharacterIds: [characterId],
        participantPresence: [{ characterId: characterId, joinedAt: playbackStart }], viewerPresence: [], liveType: generated.liveType || (options.liveType === "voice" ? "voice" : "visual"), orientation: "landscape",
        status: "live", title: generated.title || `${member.displayName} Live`, theme: options.theme?.trim() || undefined,
        coverUrl: options.coverUrl || member.liveCoverUrl || undefined, startedAt: playbackStart,
        viewerCount, peakViewerCount: viewerCount, heartCount: Math.max(120, Math.round(viewerCount * (1.5 + Math.random() * 3.5))), roundCount: 0,
        lastConsumedUserCommentAt: playbackStart - 1, segments, comments,
      };
      setState(addWeverseLive(live));
      pushNotification({ kind: "live", communityId: community.id, title: `${member.displayName} 开始了 ${live.liveType === "voice" ? "Voice Live" : "Video Live"}`, body: live.title, avatarUrl: member.avatarUrl, targetType: "live", targetId: live.id, characterId, createdAt: live.startedAt });
      if (community.userIdentityId === (userIdentity?.id || "user")) {
        void maybeInviteUserFromLive(live, community).catch(() => undefined);
      }
      return live;
  };

  const maybeStartCommunityLive = async (community: WeverseCommunity) => {
      if (isPersonalWeverseCommunity(community)) return;
      if(!claimWeverseLiveOpportunity(community.id))return;
      const current=loadWeverseState();
      if(current.lives.some(live=>!live.official&&live.communityId===community.id&&live.status==="live"))return;
      const candidates=weverseArtists(community).filter(id=>weverseLiveAvailability(id).free);
      if(!candidates.length)return;
      const characterId=candidates[Math.floor(Math.random()*candidates.length)];
      const generated=await generateWeverseLiveOpening(characterId,community,{opportunistic:true,liveType:"auto"});
      if(generated.shouldStart===false)return;
      persistLiveOpening(community,characterId,generated,{});
  };

  const startLive = async () => {
    if (!liveCreator || startingLive) return;
    const community = communityMap.get(liveCreator.communityId);
    const character = characterMap.get(liveCreator.characterId);
    if (!community || !character) return onNotice?.("找不到要开播的成员");
    setStartingLive(true);
    onNotice?.("正在准备 Live…");
    try {
      const requestAt = Date.now();
      const generated = await generateWeverseLiveOpening(liveCreator.characterId, community, { theme: liveCreator.theme.trim() || undefined, liveType: liveCreator.liveType, now: new Date(requestAt) });
      const live=persistLiveOpening(community,liveCreator.characterId,generated,liveCreator);
      setLiveCreator(null);
      navigate({ type: "live", liveId: live.id });
      onNotice?.(`${resolveMember(community,liveCreator.characterId).displayName} 开播了`);
    } catch (error) {
      onNotice?.(`Live 生成失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setStartingLive(false);
    }
  };

  const sendLiveUserComment = (live: WeverseLive, body: string) => {
    if (live.status !== "live") return;
    const value = body.trim();
    if (!value) return;
    const current = loadWeverseState().lives.find((item) => item.id === live.id) || live;
    if (current.status !== "live" || current.activeCharacterIds.includes(myArtistId)) return;
    const community = communityMap.get(current.communityId);
    const artist = community?.userIdentityId === (userIdentity?.id || "user") && !isPersonalWeverseCommunity(community)
      ? resolveMember(community, myArtistId) : null;
    const row = {
      id: createWeverseId("wvs_live_user"), authorType: artist ? "artist" as const : "user" as const,
      authorId: artist ? myArtistId : userIdentity?.id || "user",
      authorName: artist?.displayName || userName, authorAvatarUrl: artist?.avatarUrl,
      body: value, createdAt: Date.now(),
    };
    setState(updateWeverseLive(live.id, { comments: [...current.comments, row] }));
  };

  const advanceLive = async (live: WeverseLive) => {
    if (liveGenerationRef.current) return;
    const currentBefore = loadWeverseState().lives.find(item => item.id === live.id);
    if (!currentBefore || currentBefore.official || currentBefore.status !== "live" || currentBefore.endedAt) return;
    const community = communityMap.get(currentBefore.communityId);
    const hostId = currentBefore.hostCharacterIds[0];
    if (!community || !hostId) return onNotice?.("这场 Live 缺少成员信息");
    const userHosted = hostId.startsWith("user:");
    const consumeThrough = Date.now();
    const primaryCharacterId = userHosted
      ? currentBefore.activeCharacterIds.find(id => !id.startsWith("user:") && weverseLiveAvailability(id, consumeThrough, live.id).free)
      : hostId;
    if (!primaryCharacterId) return advanceUserLive(currentBefore, community);
    if (!weverseLiveAvailability(primaryCharacterId, consumeThrough, live.id).free) {
      manuallyEndLive(currentBefore);
      onNotice?.("成员接下来有其他安排，本场 Live 已结束");
      return;
    }
    const consumedAfter = currentBefore.lastConsumedUserCommentAt ?? currentBefore.startedAt - 1;
    const userRows = currentBefore.comments
      .filter((comment) => (comment.authorType === "user" || comment.authorId === myArtistId) && comment.createdAt > consumedAfter && comment.createdAt <= consumeThrough)
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(-12);
    const cleanUserComments = userRows.map(item => `[${item.id}] 用户输入（${item.authorName}）：${item.body.trim()}`);
    liveGenerationRef.current = live.id;
    setGeneratingLiveId(live.id);
    try {
      const generated = await generateWeverseLiveContinuation(primaryCharacterId, community, currentBefore, { userComments: cleanUserComments, now: new Date(consumeThrough) });
      const current = loadWeverseState().lives.find(item => item.id === live.id);
      if (!current || current.status !== "live" || current.endedAt) return;

      const playbackStart = Date.now() + 300;
      const validIds = new Set(community.memberCharacterIds);
      let activeCharacterIds = [...new Set((current.activeCharacterIds?.length ? current.activeCharacterIds : [primaryCharacterId]).filter((id) => validIds.has(id)))];
      if (!activeCharacterIds.includes(hostId)) activeCharacterIds.unshift(hostId);
      let hostCharacterIds = [...new Set(current.hostCharacterIds)];
      let participantPresence = current.participantPresence.map((item) => ({ ...item }));
      let viewerPresence = current.viewerPresence.map((item) => ({ ...item }));

      const joinSystemSegments: WeverseLive["segments"] = [];
      let joinCursor = playbackStart;
      for (const characterId of generated.viewerJoins) {
        if (!validIds.has(characterId) || activeCharacterIds.includes(characterId)) continue;
        if (!viewerPresence.some((item) => item.characterId === characterId && !item.leftAt)) viewerPresence.push({ characterId, joinedAt: playbackStart });
      }
      for (const artistComment of generated.artistComments) {
        if (!validIds.has(artistComment.characterId) || activeCharacterIds.includes(artistComment.characterId)) continue;
        const open = viewerPresence.find((item) => item.characterId === artistComment.characterId && !item.leftAt);
        if (open) open.commented = true;
        else viewerPresence.push({ characterId: artistComment.characterId, joinedAt: playbackStart, commented: true });
      }
      for (const characterId of generated.participantJoins) {
        if (!validIds.has(characterId) || characterId.startsWith("user:") || activeCharacterIds.includes(characterId) || !weverseLiveAvailability(characterId, Date.now(), live.id).free) continue;
        const openViewer = viewerPresence.find((item) => item.characterId === characterId && !item.leftAt);
        joinCursor += 500;
        if (openViewer) openViewer.leftAt = joinCursor;
        activeCharacterIds.push(characterId);
        if (!hostCharacterIds.includes(characterId)) hostCharacterIds.push(characterId);
        participantPresence.push({ characterId, joinedAt: joinCursor, joinedVia: openViewer ? "viewer" : undefined });
        joinSystemSegments.push({ id: createWeverseId("wvs_live_system"), kind: "system", characterId, original: `${resolveMember(community, characterId).displayName} 加入了 Live`, createdAt: joinCursor });
      }

      const segments = scheduleLiveSegments(primaryCharacterId, generated.segments.filter(segment => activeCharacterIds.includes(segment.characterId || primaryCharacterId)), Math.max(playbackStart + 150, joinCursor));
      const lastSegmentAt = segments.reduce((max, item) => Math.max(max, item.createdAt), joinCursor);
      const leaveSystemSegments: WeverseLive["segments"] = [];
      let leaveCursor = lastSegmentAt;
      for (const characterId of generated.participantLeaves) {
        if (characterId === hostId || characterId.startsWith("user:") || !activeCharacterIds.includes(characterId)) continue;
        activeCharacterIds = activeCharacterIds.filter((id) => id !== characterId);
        const openPresence = [...participantPresence].reverse().find((item) => item.characterId === characterId && !item.leftAt);
        leaveCursor += 850;
        if (openPresence) openPresence.leftAt = leaveCursor;
        leaveSystemSegments.push({ id: createWeverseId("wvs_live_system"), kind: "system", characterId, original: `${resolveMember(community, characterId).displayName} 离开了 Live`, createdAt: leaveCursor });
      }
      for (const characterId of generated.viewerLeaves) {
        const openViewer = [...viewerPresence].reverse().find((item) => item.characterId === characterId && !item.leftAt);
        if (openViewer) openViewer.leftAt = Math.max(playbackStart, leaveCursor);
      }

      const comments = scheduleLiveFanComments(generated.comments, playbackStart + 100);
      const artistComments = scheduleLiveArtistComments(community, generated.artistComments, playbackStart + 250);
      const allSegments = [...joinSystemSegments, ...segments, ...leaveSystemSegments];
      const allComments = [...comments, ...artistComments];

      const viewerCount = nextWvsViewers(current.viewerCount,current.roundCount);
      const lastContentAt = Math.max(
        playbackStart,
        ...allSegments.map((item) => item.createdAt),
        ...allComments.map((item) => item.createdAt),
      );
      const endedAt = generated.shouldEnd && !userHosted ? lastContentAt + 1400 : undefined;
      const next: Partial<WeverseLive> = {
        hostCharacterIds,
        activeCharacterIds,
        participantPresence,
        viewerPresence,
        segments: [...current.segments, ...allSegments],
        comments: [...current.comments, ...allComments],
        viewerCount,
        peakViewerCount: Math.max(current.peakViewerCount, viewerCount),
        heartCount: current.heartCount + Math.max(20, Math.round(viewerCount * (0.08 + Math.random() * 0.18))),
        roundCount: current.roundCount + 1,
        lastConsumedUserCommentAt: userRows.length ? Math.max(...userRows.map((item) => item.createdAt)) : current.lastConsumedUserCommentAt,
        ...(endedAt ? { endedAt } : {}),
      };
      setState(updateWeverseLive(live.id, next));
      if (endedAt) onNotice?.(generated.endingReason ? `角色准备收尾：${generated.endingReason}` : "角色准备下播了…");
    } catch (error) {
      onNotice?.(`继续 Live 失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      liveGenerationRef.current = null;
      setGeneratingLiveId(null);
    }
  };

  const addLiveHeart = (live: WeverseLive) => {
    const current = loadWeverseState().lives.find((item) => item.id === live.id) || live;
    setState(updateWeverseLive(live.id, { heartCount: current.heartCount + 1 }));
  };

  const finalizeLive = (live: WeverseLive) => {
    const current = loadWeverseState().lives.find((item) => item.id === live.id) || live;
    if (current.status === "ended") return;
    const endAt = current.endedAt || Date.now();
    const participantPresence = current.participantPresence.map((item) => item.leftAt ? item : { ...item, leftAt: endAt });
    const viewerPresence = current.viewerPresence.map((item) => item.leftAt ? item : { ...item, leftAt: endAt });
    const finalized: WeverseLive = { ...current, status: "ended", endedAt: endAt, activeCharacterIds: [], participantPresence, viewerPresence };
    setState(updateWeverseLive(current.id, finalized));
  };

  const manuallyEndLive = (live: WeverseLive) => {
    const now = Date.now();
    const current = loadWeverseState().lives.find((item) => item.id === live.id) || live;
    const participantPresence = current.participantPresence.map((item) => item.leftAt ? item : { ...item, leftAt: now });
    const viewerPresence = current.viewerPresence.map((item) => item.leftAt ? item : { ...item, leftAt: now });
    const finalized: WeverseLive = {
      ...current,
      status: "ended",
      endedAt: now,
      activeCharacterIds: [],
      participantPresence,
      viewerPresence,
      segments: current.segments.filter((item) => item.createdAt <= now),
      comments: current.comments.filter((item) => item.createdAt <= now),
    };
    setState(updateWeverseLive(live.id, finalized));
    if (getWvsBackground() === live.id) setWvsBackground(null);
    if (route.type === "live" && route.liveId === live.id) back();
    onNotice?.("Live 已结束");
  };

  const removeLiveReplay = (live: WeverseLive) => {
    if (live.status !== "ended") return;
    if (!window.confirm(`删除回放「${live.title}」？删除后会从成员 Live 和 Community 的 Live·Media 中一起移除。`)) return;
    setState(deleteWeverseLive(live.id));
    onNotice?.("直播回放已删除");
  };

  const applyReplayCoverFile = async (file?: File) => {
    const liveId = editingReplayCoverId;
    setEditingReplayCoverId(null);
    if (!file || !liveId) return;
    try {
      const coverUrl = await fileToDataUrl(file, 1400, 0.88);
      setState(updateWeverseLive(liveId, { coverUrl }));
      onNotice?.("回放封面已更新");
    } catch (error) {
      onNotice?.(`封面更新失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  useEffect(()=>{if(!visible&&route.type==="live")setWvsBackground(route.liveId);else if(visible&&route.type==="live"&&getWvsBackground()===route.liveId)setWvsBackground(null);},[visible,route]);
  useEffect(()=>{const fn=(event:Event)=>{const id=(event as CustomEvent<string>).detail;if(id){navigate({type:"live",liveId:id});setWvsBackground(null);}};window.addEventListener("wvs-open-live",fn);return()=>window.removeEventListener("wvs-open-live",fn);},[]);
  const backgroundAdvanceAt=useRef(0);
  const liveAvailabilityCheckedAt=useRef(0);
  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      const background = loadWeverseState().lives.find(live => live.id === getWvsBackground() && !live.official && live.status === "live");
      if (background && !liveGenerationRef.current && !background.endedAt && now - backgroundAdvanceAt.current > 30000
          && Math.max(background.startedAt, ...background.segments.map(segment => segment.createdAt)) <= now) {
        const community = communityMap.get(background.communityId);
        if (community && !isPersonalWeverseCommunity(community)) {
          backgroundAdvanceAt.current = now;
          void advanceLive(background);
        }
      }
      if(getWvsBackground()&&!background)setWvsBackground(null);
      if(now-liveAvailabilityCheckedAt.current>=15000){
        liveAvailabilityCheckedAt.current=now;
        loadWeverseState().lives.filter(item=>!item.official&&item.status==="live").forEach(item=>{
          const host=item.hostCharacterIds[0];
          if(host&&!host.startsWith("user:")&&!weverseLiveAvailability(host,now,item.id).free)manuallyEndLive(item);
        });
      }
      const due = loadWeverseState().lives.filter((item) => !item.official && item.status === "live" && item.endedAt && item.endedAt <= now);
      due.forEach((item) => finalizeLive(item));
    }, 900);
    return () => window.clearInterval(timer);
  });

  const pickArtistForCommunity = (community: WeverseCommunity): string | null => {
    if (!community.memberCharacterIds.length) return null;
    const counts = new Map<string, number>();
    for (const id of community.memberCharacterIds) counts.set(id, state.posts.filter((post) => post.communityId === community.id && post.authorType === "artist" && post.authorId === id).length);
    return weverseArtists(community).sort((a, b) => (counts.get(a) || 0) - (counts.get(b) || 0))[0] || null;
  };

  const generateArtistForCommunity = async (community: WeverseCommunity, options?: { characterId?: string; createdAt?: number; historical?: boolean; historyAgeRatio?: number }): Promise<WeversePost | null> => {
    if (isPersonalWeverseCommunity(community)) return null;
    const characterId = options?.characterId || pickArtistForCommunity(community);
    if (!characterId) { onNotice?.("这个 Community 还没有成员"); return null; }
    const member = resolveMember(community, characterId);
    const createdAt = options?.createdAt ?? Date.now();
    const generated = await generateWeverseArtistPost(characterId, community, { now: new Date(createdAt), historical: options?.historical });
    let imageUrl: string | undefined;
    let photoLibraryId: string | undefined;
    let photoSource: WeversePost["photoSource"];
    let photoDescription: string | undefined;
    if (generated.photoDescription) {
      const media = await resolveMediaForUse({
        deferUsage: true, actor: { type: "character", characterId },
        description: options?.historical ? `过去旧照 / 当时记录：${generated.photoDescription}` : generated.photoDescription,
        intentKind: generated.mediaIntent,
        channel: "wvs_artist",
        targetId: community.id,
        appId: "weverse",
      }).catch(() => null);
      const albumPrefs = loadPhotoLibrary().preferences;
      // Keep the text post when its requested image is unavailable.
      if (media) {
        if (media.imageUrl) { imageUrl = media.imageUrl; photoDescription = generated.photoDescription; }
        photoLibraryId = media.photoLibraryId;
        if (media.source !== "text_placeholder") photoSource = media.source;
        if (media.placeholderDescription) photoDescription = media.placeholderDescription;
      }
    }
    const revised = imageUrl ? await preparePhotoStoryCaption({ photoId: photoLibraryId, characterId, appId: "weverse", original: generated.original, translated: generated.translated,
      accountContext: options?.historical ? "本帖是历史回填，保持原定时间背景；不要提未来事件。" : undefined }) : undefined;
    if (revised) { generated.original = revised.original; generated.translated = revised.translated; }
    const artistPost: WeversePost = {
      photoStoryContext: revised?.photoStoryContext,
      id: createWeverseId("wvs_post"),
      communityId: community.id,
      authorType: "artist",
      authorId: characterId,
      postType: generated.postType,
      body: generated.translated,
      originalBody: generated.original !== generated.translated ? generated.original : undefined,
      imageUrl,
      photoLibraryId,
      photoSource,
      photoDescription,
      createdAt,
      historical: options?.historical === true,
      ...createWeverseEngagement(community, "artist", { hasImage: Boolean(imageUrl), historicalAgeRatio: options?.historyAgeRatio }),
      comments: [],
    };
    recordPreparedPhotoUse(photoLibraryId, "wvs_artist", characterId, community.id);
    addWeversePost(artistPost);
    if (!options?.historical) pushNotification({ kind: "artistPost", communityId: community.id, title: `${member.displayName} 发布了新帖`, body: artistPost.originalBody || artistPost.body, avatarUrl: member.avatarUrl, targetType: "post", targetId: artistPost.id, characterId, createdAt: artistPost.createdAt });
    if (!options?.historical) recordWeverseArtistPostEvent({ characterId, characterName: member.displayName, communityName: community.name, postId: artistPost.id, body: artistPost.body, originalBody: artistPost.originalBody, hasPhoto: Boolean(artistPost.imageUrl), timestamp: new Date(artistPost.createdAt).toISOString() });
    if (!options?.historical) {
      incrementEventCounter(characterId);
      maybeRunSummarization(characterId, member.displayName).catch(() => undefined);
    }
    return artistPost;
  };

  const generateOfficialForCommunity = async (community: WeverseCommunity, options?: { createdAt?: number; historical?: boolean; historyAgeRatio?: number }): Promise<WeversePost | null> => {
    if (isPersonalWeverseCommunity(community)) return null;
    const latestState = loadWeverseState();
    const createdAt = options?.createdAt ?? Date.now();
    const generated = await generateWeverseOfficialPost(community, latestState.posts, { now: new Date(createdAt), historical: options?.historical });
    let imageUrl: string | undefined;
    let photoLibraryId: string | undefined;
    let photoSource: WeversePost["photoSource"];
    let photoDescription: string | undefined;
    if (generated.photoDescription || generated.preferredPhotoId) {
      const excludedPhotoIds = latestState.posts
        .filter((post) => post.communityId === community.id && post.authorType === "official" && post.photoLibraryId)
        .map((post) => post.photoLibraryId!)
        .filter(Boolean);
      const media = await resolveMediaForUse({
        deferUsage: true, actor: {
          type: "official",
          officialId: community.id,
          photoIds: community.officialMediaPhotoIds || [],
          excludedPhotoIds,
          preferredPhotoId: generated.preferredPhotoId,
        },
        description: generated.photoDescription || "当前 Official Media Pool 里的官方素材",
        intentKind: generated.mediaIntent || "official",
        channel: "wvs_official",
        targetId: community.id,
        appId: "weverse",
      }).catch(() => null);
      if (media) {
        if (media.imageUrl) { imageUrl = media.imageUrl; photoDescription = generated.photoDescription; }
        photoLibraryId = media.photoLibraryId;
        if (media.source !== "text_placeholder") photoSource = media.source;
        if (media.placeholderDescription) photoDescription = media.placeholderDescription;
      }
    }
    const revised = imageUrl ? await preparePhotoStoryCaption({ photoId: photoLibraryId, characterId: community.id, appId: "weverse", original: generated.original, translated: generated.translated,
      allowedPhotoIds: community.officialMediaPhotoIds || [], bindingCharacterId: weverseArtists(community)[0], accountContext: `这是官方账号 ${community.official.displayName} 的公开发帖，不能用艺人私人口吻或泄露私事。${options?.historical ? "保持历史回填的时间背景。" : ""}` }) : undefined;
    if (revised) { generated.original = revised.original; generated.translated = revised.translated; }
    const officialPost: WeversePost = {
      photoStoryContext: revised?.photoStoryContext,
      id: createWeverseId("wvs_official_post"),
      communityId: community.id,
      authorType: "official",
      authorId: community.id,
      authorName: community.official.displayName,
      authorAvatarUrl: community.official.avatarUrl,
      body: generated.translated,
      originalBody: generated.original !== generated.translated ? generated.original : undefined,
      imageUrl,
      photoLibraryId,
      photoSource,
      photoDescription,
      createdAt,
      historical: options?.historical === true,
      ...createWeverseEngagement(community, "official", { hasImage: Boolean(imageUrl), historicalAgeRatio: options?.historyAgeRatio }),
      comments: [],
    };
    recordPreparedPhotoUse(photoLibraryId, "wvs_official", community.id, community.id, community.id);
    addWeversePost(officialPost);
    if (!options?.historical) pushNotification({ kind: "officialPost", communityId: community.id, title: `${community.official.displayName} 发布了新帖`, body: officialPost.originalBody || officialPost.body, avatarUrl: community.official.avatarUrl, targetType: "post", targetId: officialPost.id, createdAt: officialPost.createdAt });
    return officialPost;
  };

  const addFanPosts = async (community: WeverseCommunity, targetPost?: WeversePost, includePosts = true, options?: { createdAt?: number; historical?: boolean; historyAgeRatio?: number; activity?: WeverseSettings["fanActivity"]; maxPosts?: number }) => {
    const latestState = loadWeverseState();
    const baseCreatedAt = options?.createdAt ?? Date.now();
    const batch = await generateWeverseFanBatch(community, latestState.posts, { activity: options?.activity || latestState.settings.fanActivity, includePosts, targetPost, now: new Date(baseCreatedAt), historical: options?.historical });
    for (const item of batch.posts.slice(0, options?.maxPosts ?? batch.posts.length)) {
      addWeversePost({
        id: createWeverseId("wvs_fan_post"),
        communityId: community.id,
        authorType: "fan",
        authorId: createWeverseId("fan"),
        authorName: item.displayName,
        body: item.translated,
        originalBody: item.original !== item.translated ? item.original : undefined,
        createdAt: baseCreatedAt + Math.floor(Math.random() * 1200),
        historical: options?.historical === true,
        ...createWeverseEngagement(community, "fan", { historicalAgeRatio: options?.historyAgeRatio }),
        comments: [],
      });
    }
    if (targetPost && batch.comments.length) {
      const currentPost = loadWeverseState().posts.find((post) => post.id === targetPost.id) || targetPost;
      const allowedIds = new Set(currentPost.comments.map((comment) => comment.id));
      const comments: WeverseComment[] = [];
      const allowFanReplies = targetPost.authorType !== "artist" && targetPost.authorType !== "official";
      const maxNested = allowFanReplies && batch.comments.length >= 4 ? Math.max(1, Math.floor(batch.comments.length * 0.3)) : 0;
      let nestedCount = 0;
      const usedParents = new Set<string>();
      batch.comments.forEach((item, index) => {
        const requestedExisting = allowFanReplies && item.replyToId && allowedIds.has(item.replyToId) ? item.replyToId : undefined;
        const requestedGenerated = allowFanReplies && typeof item.replyToIndex === "number" && item.replyToIndex >= 0 && item.replyToIndex < comments.length
          ? comments[item.replyToIndex]?.id
          : undefined;
        const requestedParent = requestedExisting || requestedGenerated;
        const parentId = requestedParent && nestedCount < maxNested && !usedParents.has(requestedParent) ? requestedParent : undefined;
        if (parentId) { nestedCount += 1; usedParents.add(parentId); }
        comments.push({
          id: createWeverseId("wvs_fan_comment"),
          authorType: "fan",
          authorId: createWeverseId("fan"),
          authorName: item.displayName,
          body: item.translated,
          originalBody: item.original !== item.translated ? item.original : undefined,
          parentId,
          createdAt: baseCreatedAt + index * 31 + Math.floor(Math.random() * 500),
        });
      });
      addWeverseComments(targetPost.id, comments);
      for (const comment of comments) {
        if (!comment.parentId) continue;
        const parent = currentPost.comments.find((row) => row.id === comment.parentId) || comments.find((row) => row.id === comment.parentId);
        if (parent?.authorType === "user") pushNotification({ kind: "fanReply", communityId: community.id, title: `${comment.authorName || "一位粉丝"} 回复了你`, body: comment.originalBody || comment.body, avatarUrl: DEFAULT_FAN_AVATAR_URL, targetType: "post", targetId: targetPost.id, createdAt: comment.createdAt });
      }
      return comments;
    }
    return [] as WeverseComment[];
  };

  const maybeAddArtistReply = async (community: WeverseCommunity, post: WeversePost, preferredComments?: WeverseComment[], options?: { createdAt?: number; historical?: boolean }) => {
    if (isPersonalWeverseCommunity(community)) return;
    const latestPost = loadWeverseState().posts.find((item) => item.id === post.id) || post;
    const candidates = (preferredComments?.length ? preferredComments : latestPost.comments)
      .filter((comment) => !comment.deleted && comment.authorType !== "artist" && comment.authorType !== "official");
    if (!candidates.length) return false;
    const activity = loadWeverseState().settings.fanActivity;
    const probability = activity === "quiet" ? 0.16 : activity === "lively" ? 0.58 : 0.38;
    if (Math.random() > probability) return false;
    const userCandidates = candidates.filter((comment) => comment.authorType === "user");
    const target = (userCandidates.length && Math.random() < 0.62 ? userCandidates : candidates).slice(-1)[0];
    const artists = weverseArtists(community);
    const artistId = post.authorType === "artist" && artists.includes(post.authorId)
      ? post.authorId
      : artists[Math.floor(Math.random() * artists.length)];
    if (!artistId) return false;
    const replyAt = options?.createdAt ?? Date.now();
    const reply = await generateWeverseArtistReply(artistId, community, latestPost, target, { now: new Date(replyAt), historical: options?.historical }).catch(() => null);
    if (!reply) return false;
    const artistComment: WeverseComment = {
      id: createWeverseId("wvs_artist_reply"),
      authorType: "artist",
      authorId: artistId,
      body: reply.translated,
      originalBody: reply.original !== reply.translated ? reply.original : undefined,
      parentId: target.id,
      createdAt: replyAt + 90,
    };
    addWeverseComment(post.id, artistComment);
    const member = resolveMember(community, artistId);
    if (!options?.historical && target.authorType === "user") pushNotification({ kind: "artistReply", communityId: community.id, title: `${member.displayName} 回复了你`, body: artistComment.originalBody || artistComment.body, avatarUrl: member.avatarUrl, targetType: "post", targetId: post.id, characterId: artistId, createdAt: artistComment.createdAt });
    const targetAuthor = resolveCommentAuthor(target, latestPost);
    if (!options?.historical) recordWeverseArtistReplyEvent({
      characterId: artistId,
      characterName: member.displayName,
      communityName: community.name,
      postId: post.id,
      commentId: artistComment.id,
      targetName: targetAuthor.name,
      targetBody: target.originalBody || target.body,
      replyBody: artistComment.originalBody || artistComment.body,
      timestamp: new Date(artistComment.createdAt).toISOString(),
    });
    if (!options?.historical) {
      incrementEventCounter(artistId);
      maybeRunSummarization(artistId, member.displayName).catch(() => undefined);
    }
    return true;
  };


  const generateNoticeForCommunity = async (community: WeverseCommunity, options?: { createdAt?: number; historical?: boolean }): Promise<WeverseNotice | null> => {
    const first=!loadWeverseState().notices.some(n=>n.communityId===community.id);
    const createdAt = first ? Math.min(Date.now(),(community.historyStartAt||community.createdAt)+3600000) : options?.createdAt ?? Date.now();
    const latestState = loadWeverseState();
    const generated = await generateWeverseOfficialNotice(community, latestState.posts, { now: new Date(createdAt), historical: options?.historical, opening: !latestState.notices.some(n=>n.communityId===community.id) });
    let imageUrl: string | undefined;
    let photoLibraryId: string | undefined;
    let photoSource: WeverseNotice["photoSource"];
    let photoDescription: string | undefined;
    if (generated.photoDescription || generated.preferredPhotoId) {
      const media = await resolveMediaForUse({ actor: { type: "official", officialId: community.id, photoIds: community.officialMediaPhotoIds || [], preferredPhotoId: generated.preferredPhotoId }, description: generated.photoDescription || "官方公告素材", intentKind: generated.mediaIntent || "official", channel: "wvs_official", targetId: community.id, appId: "weverse" }).catch(() => null);
      if (media?.imageUrl) { imageUrl = media.imageUrl; photoDescription = generated.photoDescription; }
      if (media?.photoLibraryId) photoLibraryId = media.photoLibraryId;
      if (media && media.source !== "text_placeholder") photoSource = media.source;
      if (media?.placeholderDescription) photoDescription = media.placeholderDescription;
    }
    const notice: WeverseNotice = { id: createWeverseId("wvs_notice"), communityId: community.id, title: generated.title, originalTitle: generated.originalTitle, translatedTitle: generated.translatedTitle, body: generated.translated, originalBody: generated.original !== generated.translated ? generated.original : undefined, imageUrl, photoLibraryId, photoSource, photoDescription, createdAt, historical: options?.historical === true };
    addWeverseNotice(notice);
    return notice;
  };

  const generateNoticeOnly = async (community: WeverseCommunity) => {
    if (generatingCommunityId || generatingHistoryCommunityId || generatingScheduleCommunityId) return;
    setAiMenuContext(null);
    setGeneratingCommunityId(community.id);
    onNotice?.(`正在生成 ${community.name} 官方公告…`);
    try { await generateNoticeForCommunity(community); setState(loadWeverseState()); onNotice?.("Official Notice 已生成"); }
    catch (error) { onNotice?.(`公告生成失败：${error instanceof Error ? error.message : String(error)}`); }
    finally { setGeneratingCommunityId(null); }
  };

  const generateCommunityRound = async (community: WeverseCommunity) => {
    if (generatingCommunityId || generatingHistoryCommunityId || generatingScheduleCommunityId) return;
    setCommunityMenuId(null);
    setAiMenuContext(null);
    setGeneratingCommunityId(community.id);
    onNotice?.(`正在刷新 ${community.name}…`);
    try {
      onNotice("正在生成 Artist 动态…");
      const artistPost = await generateArtistForCommunity(community);
      if (!artistPost) return;
      onNotice("正在补充粉丝动态和评论…");
      const newFanComments = await addFanPosts(community, artistPost, true);
      onNotice("正在处理艺人互动…");
      await maybeAddArtistReply(community, artistPost, newFanComments);
      onNotice("正在检查或生成 Live…");
      const liveIssue=await maybeStartCommunityLive(community).then(()=>"",error=>`；Live 生成失败：${error instanceof Error ? error.message : String(error)}`);
      setState(loadWeverseState());
      setCommunityTab("feed");
      setCommunityFeedFilter("highlight");
      onNotice(`已生成 Artist Post，并补充了一轮自然粉丝互动${liveIssue}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onNotice?.(`Weverse 生成失败：${message}`);
    } finally {
      setGeneratingCommunityId(null);
    }
  };

  const generateArtistOnly = async (community: WeverseCommunity) => {
    if (generatingCommunityId || generatingHistoryCommunityId || generatingScheduleCommunityId) return;
    setAiMenuContext(null);
    setGeneratingCommunityId(community.id);
    onNotice?.(`正在生成 ${community.name} Artist Post…`);
    try {
      const artistPost = await generateArtistForCommunity(community);
      if (artistPost) {
        const fanComments = await addFanPosts(community, artistPost, false);
        await maybeAddArtistReply(community, artistPost, fanComments);
      }
      setState(loadWeverseState());
      setCommunityTab("feed");
      setCommunityFeedFilter("artist");
      onNotice?.("Artist Post 已生成，并带入一批可展开评论");
    } catch (error) {
      onNotice?.(`Weverse 生成失败：${error instanceof Error ? error.message : String(error)}`);
    } finally { setGeneratingCommunityId(null); }
  };

  const generateOfficialOnly = async (community: WeverseCommunity) => {
    if (generatingCommunityId || generatingHistoryCommunityId || generatingScheduleCommunityId) return;
    setAiMenuContext(null);
    setGeneratingCommunityId(community.id);
    onNotice?.(`正在生成 ${community.name} Official Post…`);
    try {
      const officialPost = await generateOfficialForCommunity(community);
      if (!officialPost) return;
      const fanComments = await addFanPosts(community, officialPost, false);
      await maybeAddArtistReply(community, officialPost, fanComments);
      setState(loadWeverseState());
      setCommunityTab("feed");
      setCommunityFeedFilter("highlight");
      onNotice?.("Official Post 已生成；图片会优先查官号媒体池，再按智能规则决定是否生图");
    } catch (error) {
      onNotice?.(`Official 生成失败：${error instanceof Error ? error.message : String(error)}`);
    } finally { setGeneratingCommunityId(null); }
  };

  const generateFanOnly = async (community: WeverseCommunity) => {
    if (generatingCommunityId || generatingHistoryCommunityId || generatingScheduleCommunityId) return;
    setAiMenuContext(null);
    setGeneratingCommunityId(community.id);
    onNotice?.(`正在生成 ${community.name} 粉丝内容…`);
    try {
      const latest = loadWeverseState().posts.filter((post) => post.communityId === community.id && (post.authorType === "artist" || post.authorType === "official")).sort((a, b) => b.createdAt - a.createdAt)[0];
      const comments = await addFanPosts(community, latest, true);
      if (latest && !isPersonalWeverseCommunity(community)) await maybeAddArtistReply(community, latest, comments);
      setState(loadWeverseState());
      setCommunityTab("feed");
      setCommunityFeedFilter("fan");
      onNotice?.("已追加一轮粉丝动态与互动");
    } catch (error) {
      onNotice?.(`Weverse 生成失败：${error instanceof Error ? error.message : String(error)}`);
    } finally { setGeneratingCommunityId(null); }
  };

  const generateMoreComments = async (post: WeversePost) => {
    if (generatingCommentsPostId) return;
    const community = communityMap.get(post.communityId);
    if (!community) return;
    setAiMenuContext(null);
    setGeneratingCommentsPostId(post.id);
    onNotice?.("正在追加评论，不会覆盖原评论…");
    try {
      const latest = loadWeverseState().posts.find((item) => item.id === post.id) || post;
      const fanComments = await addFanPosts(community, latest, false);
      await maybeAddArtistReply(community, latest, fanComments);
      setState(loadWeverseState());
      onNotice?.(fanComments.length ? `新增 ${fanComments.length} 条粉丝评论；艺人是否回复由角色自己决定` : "这一轮没有新的粉丝评论");
    } catch (error) {
      onNotice?.(`评论生成失败：${error instanceof Error ? error.message : String(error)}`);
    } finally { setGeneratingCommentsPostId(null); }
  };

  const historyTimestamp = (start: number, end: number, index: number, total: number): number => {
    const safeStart = Math.min(start, end - 60_000);
    const span = Math.max(60_000, end - safeStart);
    const slot = span / Math.max(1, total);
    const from = safeStart + slot * index;
    return Math.round(Math.min(end, from + Math.random() * slot * .82));
  };

  const openHistoryGenerator = (community: WeverseCommunity, kind: "mixed" | "schedule" = "mixed") => {
    setAiMenuContext(null);
    setHistoryProgress("");
    setHistoryDraft({ communityId: community.id, kind, from: formatIsoDate(new Date(Date.now() - 90 * 86400000)), to: formatIsoDate(new Date(Date.now() - 86400000)), count: kind === "schedule" ? 6 : 8 });
  };
  const generateHistoryRange = async () => {
    if(historyDraft?.kind==="schedule"){onNotice?.("请在手机日历补充历史日程");return;}
    if (!historyDraft || historyLock.current || generatingCommunityId || generatingHistoryCommunityId || generatingScheduleCommunityId) return;
    const draft = historyDraft; const community = communityMap.get(draft.communityId); if (!community) return;
    const start = new Date(`${draft.from}T00:00:00`).getTime();
    const end = new Date(`${draft.to}T23:59:59.999`).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || end >= Date.now() || !Number.isInteger(draft.count) || draft.count < 1 || draft.count > 30) { onNotice?.("请选择过去的有效日期范围，数量为 1–30"); return; }
    if (draft.kind === "artist" && !weverseArtists(community).length) { onNotice?.("请先绑定社区成员"); return; }
    historyLock.current = true; setGeneratingHistoryCommunityId(community.id);
    const before = loadWeverseState();
    try {
      {
        for (let i = 0; i < draft.count; i++) {
          const createdAt = historyTimestamp(start, end, i, draft.count);
          const kind = draft.kind === "mixed" ? (["artist", "official", "fan", "notice"] as const)[i % 4] : draft.kind;
          setHistoryProgress(`正在补充 ${i + 1}/${draft.count}…`);
          if (kind === "artist" && weverseArtists(community).length) await generateArtistForCommunity(community, { characterId: weverseArtists(community)[i % weverseArtists(community).length], createdAt, historical: true, historyAgeRatio: (end - createdAt) / Math.max(1, end - start) });
          else if (kind === "notice") await generateNoticeForCommunity(community, { createdAt, historical: true });
          else if (kind === "fan") await addFanPosts(community, undefined, true, { createdAt, historical: true, maxPosts: 1 });
          else await generateOfficialForCommunity(community, { createdAt, historical: true });
          setState(loadWeverseState());
        }
        const latest = loadWeverseState();
        const current = latest.communities.find(item => item.id === community.id) || community;
        setState(upsertWeverseCommunity({ ...current, historyStartAt: Math.min(current.historyStartAt || start, start), historyCursorAt: Math.min(current.historyCursorAt || start, start), historyInitializedAt: current.historyInitializedAt || Date.now(), updatedAt: Date.now() }));
        const saved = latest.posts.length + latest.notices.length - before.posts.length - before.notices.length;
        setHistoryProgress(`已补充 ${saved} 条历史动态`);onNotice(`已补充 ${saved} 条历史动态`);
      }
      setState(loadWeverseState());
    } catch (error) { setState(loadWeverseState()); setHistoryProgress(`生成中断：${error instanceof Error ? error.message : String(error)}。已生成的内容会保留。`);onNotice(`生成中断：${error instanceof Error ? error.message : String(error)}。已生成的内容会保留。`); }
    finally { historyLock.current = false; setGeneratingHistoryCommunityId(null); }
  };
  const initializeCommunityHistory = async (community: WeverseCommunity) => {
    if(isPersonalWeverseCommunity(community)){setGeneratingHistoryCommunityId(community.id);try{await generateNoticeForCommunity(community,{createdAt:Date.now()-86400000,historical:true});await addFanPosts(community);setState(upsertWeverseCommunity({...community,historyInitializedAt:Date.now()}));}catch(e){onNotice?.(`初始化失败：${e instanceof Error?e.message:String(e)}`);}finally{setGeneratingHistoryCommunityId(null);}return;}
    if (generatingHistoryCommunityId) return;
    setGeneratingHistoryCommunityId(community.id);
    onNotice?.(`正在给 ${community.name} 补一小段过去的社区记录…`);
    try {
      const now = Date.now();
      let start = community.historyStartAt || now - 365 * 24 * 60 * 60 * 1000;
      const end = now - 36 * 60 * 60 * 1000;
      if (start >= end) start = now - 180 * 24 * 60 * 60 * 1000;
      const created: WeversePost[] = [];
      const totalSlots = 2 + Math.max(1, community.memberCharacterIds.length) + 2;
      let slot = 0;

      // 历史 Notice 少量正式公告，与普通 Official Post 分开。
      for (let i = 0; i < 1 + (community.id.length % 2); i += 1) {
        const noticeAt = i===0 ? start+3600000 : historyTimestamp(start, end, slot++, totalSlots + 2);
        await generateNoticeForCommunity(community, { createdAt: noticeAt, historical: true });
      }

      // Official 普通动态少量、存在感明确。
      for (let i = 0; i < 2; i += 1) {
        const createdAt = historyTimestamp(start, end, slot++, totalSlots);
        const post = await generateOfficialForCommunity(community, { createdAt, historical: true, historyAgeRatio: (end - createdAt) / Math.max(1, end - start) });
        if (post) created.push(post);
      }

      // 每个成员至少留一条过去的 Artist Post；底层仍绑定同一个 characterId。
      for (const characterId of weverseArtists(community)) {
        const createdAt = historyTimestamp(start, end, slot++, totalSlots);
        const post = await generateArtistForCommunity(community, { characterId, createdAt, historical: true, historyAgeRatio: (end - createdAt) / Math.max(1, end - start) });
        if (post) created.push(post);
      }

      // Fan 比官号/艺人热闹一些：两轮历史粉丝帖，不强迫每轮达到固定数量。
      for (let i = 0; i < 2; i += 1) {
        const createdAt = historyTimestamp(start, end, slot++, totalSlots);
        await addFanPosts(community, undefined, true, { createdAt, historical: true, historyAgeRatio: (end - createdAt) / Math.max(1, end - start), activity: "lively" });
      }

      // 给少量历史 Artist / Official 留下真正可展开的评论样本；总体评论数仍是独立快照。
      const commentTargets = created.filter((post) => post.authorType === "artist" || post.authorType === "official").sort((a,b)=>b.createdAt-a.createdAt).slice(0, 2);
      for (const target of commentTargets) {
        const commentAt = Math.min(end, target.createdAt + (2 + Math.random() * 30) * 60 * 60 * 1000);
        const fanComments = await addFanPosts(community, target, false, { createdAt: commentAt, historical: true, activity: "normal" });
        await maybeAddArtistReply(community, target, fanComments, { createdAt: commentAt + 5 * 60 * 1000, historical: true });
      }

      const latest = loadWeverseState();
      const allHistory = latest.posts.filter((post) => post.communityId === community.id && post.historical);
      const cursor = allHistory.length ? Math.min(...allHistory.map((post) => post.createdAt)) : start;
      const currentCommunity = latest.communities.find((item) => item.id === community.id) || community;
      setState(upsertWeverseCommunity({ ...currentCommunity, historyInitializedAt: Date.now(), historyCursorAt: cursor, updatedAt: Date.now() }));
      onNotice?.(`历史初始化完成：${community.name} 现在不是空白新社区了`);
    } catch (error) {
      setState(loadWeverseState());
      onNotice?.(`历史初始化中断：${error instanceof Error ? error.message : String(error)}。已生成的内容会保留。`);
    } finally {
      setGeneratingHistoryCommunityId(null);
    }
  };

  const loadEarlierHistory = async (community: WeverseCommunity) => {
    if (generatingHistoryCommunityId) return;
    const now = Date.now();
    const hardStart = community.historyStartAt || now - 365 * 24 * 60 * 60 * 1000;
    const cursor = community.historyCursorAt || Math.min(...state.posts.filter((post) => post.communityId === community.id).map((post) => post.createdAt), now);
    if (cursor <= hardStart + 12 * 60 * 60 * 1000) return onNotice?.("已经翻到这个 Community 设定的最早运营时间了");
    const end = cursor - 6 * 60 * 60 * 1000;
    const start = Math.max(hardStart, end - 90 * 24 * 60 * 60 * 1000);
    setGeneratingHistoryCommunityId(community.id);
    onNotice?.("正在加载更早动态…");
    try {
      const created: WeversePost[] = [];
      const officialAt = historyTimestamp(start, end, 0, 4);
      const official = await generateOfficialForCommunity(community, { createdAt: officialAt, historical: true, historyAgeRatio: .7 });
      if (official) created.push(official);
      const historicalCounts = new Map(community.memberCharacterIds.map((id) => [id, state.posts.filter((p) => p.communityId === community.id && p.historical && p.authorType === "artist" && p.authorId === id).length]));
      const artistIds = weverseArtists(community).sort((a,b)=>Number(historicalCounts.get(a) || 0)-Number(historicalCounts.get(b) || 0)).slice(0, Math.min(2, community.memberCharacterIds.length));
      for (let i=0;i<artistIds.length;i+=1) {
        const createdAt = historyTimestamp(start, end, i+1, 4);
        const post = await generateArtistForCommunity(community, { characterId: artistIds[i], createdAt, historical: true, historyAgeRatio: .75 });
        if (post) created.push(post);
      }
      await addFanPosts(community, undefined, true, { createdAt: historyTimestamp(start, end, 3, 4), historical: true, historyAgeRatio: .75, activity: "lively" });
      const target = created.filter((p)=>p.authorType === "artist").sort((a,b)=>b.createdAt-a.createdAt)[0];
      if (target) {
        const fanComments = await addFanPosts(community, target, false, { createdAt: Math.min(end, target.createdAt + 4*60*60*1000), historical: true, activity: "normal" });
        await maybeAddArtistReply(community, target, fanComments, { createdAt: Math.min(end, target.createdAt + 5*60*60*1000), historical: true });
      }
      const latest = loadWeverseState();
      const allHistory = latest.posts.filter((post) => post.communityId === community.id && post.historical);
      const nextCursor = allHistory.length ? Math.min(...allHistory.map((post) => post.createdAt)) : start;
      const currentCommunity = latest.communities.find((item) => item.id === community.id) || community;
      setState(upsertWeverseCommunity({ ...currentCommunity, historyCursorAt: nextCursor, updatedAt: Date.now() }));
      onNotice?.("更早动态已加载");
    } catch (error) {
      setState(loadWeverseState());
      onNotice?.(`加载更早动态失败：${error instanceof Error ? error.message : String(error)}`);
    } finally { setGeneratingHistoryCommunityId(null); }
  };

  const generateAllCommunities = async () => {
    if (generatingCommunityId || generatingHistoryCommunityId || generatingScheduleCommunityId) return;
    setAiMenuContext(null);
    if (!state.communities.length) return onNotice?.("还没有 Community");
    onNotice?.("开始按顺序刷新全部 Community…");
    for (const community of state.communities) await generateCommunityRound(community);
    setState(loadWeverseState());
  };


  const openNoticeEditor = (communityId: string, notice?: WeverseNotice) => {
    setNoticeEditor({ id: notice?.id, communityId, title: notice?.translatedTitle || notice?.title || "", body: notice?.body || "", originalTitle: notice?.originalTitle || notice?.title || "", originalBody: notice?.originalBody || notice?.body || "" });
  };
  const saveNoticeEditor = () => {
    if (!noticeEditor) return;
    const title = noticeEditor.title.trim(); const body = noticeEditor.body.trim();
    if (!title || !body) return onNotice?.("公告标题和正文都要填写");
    if (noticeEditor.id) setState(updateWeverseNotice(noticeEditor.id, { title, translatedTitle: title, originalTitle: noticeEditor.originalTitle.trim() || title, body, originalBody: noticeEditor.originalBody.trim() || undefined }));
    else setState(addWeverseNotice({ id: createWeverseId("wvs_notice"), communityId: noticeEditor.communityId, title, translatedTitle: title, originalTitle: noticeEditor.originalTitle.trim() || title, body, originalBody: noticeEditor.originalBody.trim() || undefined, createdAt: Date.now() }));
    setNoticeEditor(null); onNotice?.(noticeEditor.id ? "公告已更新" : "公告已发布");
  };
  const translateNoticeDraft = async () => {
    if (!noticeEditor || translationBusy) return;
    const draft = noticeEditor; setTranslationBusy(true);
    try { const [title, body] = await translateContentTexts([draft.originalTitle || draft.title, draft.originalBody], "weverse"); setNoticeEditor(current => current === draft ? { ...draft, title, body } : current); }
    catch (error) { onNotice?.(error instanceof Error ? error.message : "翻译失败，原文已保留"); }
    finally { setTranslationBusy(false); }
  };
  const translatePostDraft = async () => {
    if (!draftOriginalText.trim() || translationBusy) return;
    const original = draftOriginalText; setTranslationBusy(true);
    try { const [text] = await translateContentTexts([original], "weverse", editingPostId ? postMap.get(editingPostId)?.authorId : undefined); setDraftText(text); }
    catch (error) { onNotice?.(error instanceof Error ? error.message : "翻译失败，原文已保留"); }
    finally { setTranslationBusy(false); }
  };
  const removeNotice = (notice: WeverseNotice) => {
    if (!window.confirm("删除这条公告？")) return;
    setState(deleteWeverseNotice(notice.id));
    if (route.type === "notice" && route.noticeId === notice.id) back();
    onNotice?.("公告已删除");
  };

  const openComposer = (authorType: "user" | "official" | "artist", communityId: string) => {
    const community = communityMap.get(communityId);
    if (!community) return onNotice?.("Community 不存在");
    setVoicePost(false);
    setComposerAuthorType(authorType);
    setEditingPostId(null);
    setDraftCommunityId(communityId);
    setDraftText("");
    setDraftOriginalText("");
    setDraftImageUrl("");
    setDraftPhotoLibraryId(null);
    setComposerOpen(true);
  };

  const openPostEditor = (post: WeversePost) => {
    setPostMenuId(null);
    setComposerAuthorType(post.authorType);
    setEditingPostId(post.id);
    setDraftCommunityId(post.communityId);
    setDraftText(post.body);
    setDraftOriginalText(post.originalBody || post.body);
    setDraftImageUrl(post.imageUrl || "");
    setDraftPhotoLibraryId(post.photoLibraryId || null);
    setComposerOpen(true);
  };

  const publish = async () => {
    if(translationBusy)return;
    setTranslationBusy(true);
    try {
    const body = draftText.trim();
    if (!body && !draftImageUrl) return onNotice?.("先写点内容或加一张图片吧");
    const community = communityMap.get(draftCommunityId);
    if (!community) return onNotice?.("请选择发布到哪个 Community");
    if (editingPostId) {
      const existingPost = postMap.get(editingPostId);
      if(!existingPost)throw Error('贴文已删除');
      const pair=await syncBilingualEdit({appId:'weverse',characterId:existingPost.authorId,beforeOriginal:[existingPost.originalBody||existingPost.body],beforeChinese:[existingPost.body],original:[isForeignOriginal(existingPost.originalBody||existingPost.body,existingPost.body)?draftOriginalText||body:body],chinese:[body],bilingual:isForeignOriginal(existingPost.originalBody||existingPost.body,existingPost.body)});
      setState(updateWeversePost(editingPostId, { body:pair.chinese[0], originalBody:pair.original[0], imageUrl: draftImageUrl || undefined, photoLibraryId: draftImageUrl ? (draftPhotoLibraryId || existingPost?.photoLibraryId) : undefined, photoSource: draftImageUrl ? (draftPhotoLibraryId ? "album" : existingPost?.photoSource || "manual") : undefined }));
      if (existingPost?.authorType === "artist") {
        const character = characterMap.get(existingPost.authorId);
        recordWeverseArtistPostEvent({ characterId: existingPost.authorId, characterName: character?.name || "Artist", communityName: community.name, postId: existingPost.id, body:pair.chinese[0], hasPhoto: Boolean(draftImageUrl), timestamp: new Date(existingPost.createdAt).toISOString() });
      }
      setComposerOpen(false); setEditingPostId(null); setDraftText(""); setDraftImageUrl(""); setDraftPhotoLibraryId(null); onNotice?.("贴文已更新"); return;
    }
    const post: WeversePost = {
      originalBody: draftOriginalText.trim() || undefined,
      id: createWeverseId("wvs_post"),
      communityId: community.id,
      postType:composerAuthorType === "artist" && voicePost ? "voice" : "text",
      authorName:composerAuthorType === "artist" ? artistName : undefined, authorAvatarUrl:composerAuthorType === "artist" ? artistAvatar : undefined,
      authorType: composerAuthorType,
      authorId: composerAuthorType === "artist" ? `user:${community.userIdentityId}` : composerAuthorType === "user" ? (userIdentity?.id || "user") : community.id,
      body,
      imageUrl: draftImageUrl || undefined,
      photoLibraryId: draftPhotoLibraryId || undefined,
      photoSource: draftImageUrl ? (draftPhotoLibraryId ? "album" : "manual") : undefined,
      createdAt: Date.now(),
      ...createWeverseEngagement(community, composerAuthorType, { hasImage: Boolean(draftImageUrl) }),
      comments: [],
    };
    setState(addWeversePost(post));
    setComposerOpen(false); setDraftText(""); setDraftImageUrl(""); setDraftPhotoLibraryId(null);
    onNotice?.(composerAuthorType === "official" ? "已用 Official Account 发布" : "已发布到 Community");
    }catch(e){onNotice?.(e instanceof Error?e.message:String(e));}finally{setTranslationBusy(false);}
  };

  const removePost = (post: WeversePost) => {
    if (!window.confirm("删除这条贴文？")) return;
    setState(deleteWeversePost(post.id));
    deleteWeverseProjectionEventsForPost(post.id);
    setPostMenuId(null);
    if (route.type === "post" && route.postId === post.id) back();
    onNotice?.("贴文已删除");
  };

  const toggleLike = (post: WeversePost) => {
    const nextLiked = !post.likedByUser;
    setState(updateWeversePost(post.id, { likedByUser: nextLiked, likeCount: Math.max(0, post.likeCount + (nextLiked ? 1 : -1)) }));
  };
  const toggleBookmark = (post: WeversePost) => setState(updateWeversePost(post.id, { bookmarkedByUser: !post.bookmarkedByUser }));

  const submitComment = (post: WeversePost) => {
    const body = commentDraft.trim();
    if (!body) return;
    addWeverseComment(post.id, {
      id: createWeverseId("wvs_comment"),
      authorType: communityMap.get(post.communityId)?.userIdentityId === (userIdentity?.id || "user") ? "artist" : "user",
      authorId: communityMap.get(post.communityId)?.userIdentityId === (userIdentity?.id || "user") ? `user:${userIdentity?.id || "user"}` : userIdentity?.id || "user",
      authorName:communityMap.get(post.communityId)?.userIdentityId ? artistName : userName,authorAvatarUrl:communityMap.get(post.communityId)?.userIdentityId ? artistAvatar : userAvatar,
      body,
      parentId: (post.authorType === "artist" || post.authorType === "official") ? undefined : (replyTarget?.postId === post.id ? replyTarget.commentId : undefined),
      createdAt: Date.now(),
    });
    // 这是用户此刻真的新发出的评论，不是“加载出世界里原本存在的样本”，因此总体评论数 +1。
    setState(updateWeversePost(post.id, { commentCount: Math.max(0, post.commentCount + 1) }));
    setCommentDraft("");
    setReplyTarget(null);
  };

  const removeComment = (post: WeversePost, comment: WeverseComment) => {
    if (!window.confirm("删除这条评论？有回复时会保留“此评论已删除”占位。")) return;
    deleteWeverseComment(post.id, comment.id);
    setState(updateWeversePost(post.id, { commentCount: Math.max(0, post.commentCount - (comment.deleted ? 0 : 1)) }));
    if (comment.authorType === "artist") deleteWeverseProjectionEventForComment(comment.id);
    setCommentMenu(null);
    onNotice?.("评论已删除");
  };

  const openMy = (view: MyTab) => {
    setDrawerOpen(false);
    navigate({ type: "me", view });
  };

  const postShowsOriginal = (post: WeversePost) => showOriginalByPost[post.id] ?? (state.settings.translationDefault === "original");
  const commentShowsOriginal = (comment: WeverseComment) => showOriginalByComment[comment.id] ?? (!state.settings.autoTranslateComments || state.settings.translationDefault === "original");

  const savePhotoDescription = () => {
    if (!photoEditor?.description.trim()) return;
    setState(updateWeversePost(photoEditor.postId, { imageUrl: undefined, photoLibraryId: undefined, photoSource: undefined, photoDescription: photoEditor.description.trim() }));
    setPhotoEditor(null);
  };

  const generatePhotoFromDescription = async () => {
    if (!photoEditor?.description.trim() || photoGenerating) return;
    const draft = photoEditor;
    const post = postMap.get(draft.postId);
    if (!post) return;
    setPhotoGenerating(true);
    setState(updateWeversePost(draft.postId, { imageUrl: undefined, photoLibraryId: undefined, photoSource: undefined, photoDescription: draft.description.trim() }));
    setPhotoEditor(null);
    const actor = post.authorType === "artist" ? { type: "character" as const, characterId: post.authorId } : { type: "official" as const, officialId: post.communityId, photoIds: [] };
    const media = await resolveMediaForUse({ actor, description: draft.description.trim(), channel: "wvs", targetId: post.communityId, appId: "weverse", mode: "generate" }).catch(() => null);
    if (media?.imageUrl) setState(updateWeversePost(draft.postId, { imageUrl: media.imageUrl, photoLibraryId: media.photoLibraryId, photoSource: "generated" }));
    else onNotice?.("生图未配置或生成失败，已保留文字照片");
    setPhotoGenerating(false);
  };

  const saveNoticePhotoDescription = () => {
    if (!noticePhotoEditor?.description.trim()) return;
    setState(updateWeverseNotice(noticePhotoEditor.noticeId, { imageUrl: undefined, photoLibraryId: undefined, photoSource: undefined, photoDescription: noticePhotoEditor.description.trim() }));
    setNoticePhotoEditor(null);
  };

  const generateNoticePhoto = async () => {
    if (!noticePhotoEditor?.description.trim() || photoGenerating) return;
    const draft = noticePhotoEditor;
    setPhotoGenerating(true);
    saveNoticePhotoDescription();
    const media = await resolveMediaForUse({ actor: { type: "official", officialId: draft.communityId, photoIds: [] }, description: draft.description.trim(), channel: "wvs", targetId: draft.communityId, appId: "weverse", mode: "generate" }).catch(() => null);
    if (media?.imageUrl) setState(updateWeverseNotice(draft.noticeId, { imageUrl: media.imageUrl, photoSource: "generated", photoLibraryId: media.photoLibraryId }));
    else onNotice?.("生图未配置或生成失败，已保留文字照片");
    setPhotoGenerating(false);
  };

  const renderPostActions = (post: WeversePost, detail = false) => (
    <div className={styles.actions}>
      <div className={styles.actionLeft}>
        <button type="button" className={`${styles.actionBtn} ${post.likedByUser ? styles.activeAction : ""}`} onClick={() => toggleLike(post)}><Heart size={18} fill={post.likedByUser ? "currentColor" : "none"} />{formatCompactCount(post.likeCount)}</button>
        <button type="button" className={styles.actionBtn} onClick={() => detail ? document.getElementById("wvs-comment-input")?.focus() : navigate({ type: "post", postId: post.id })}><MessageCircle size={18} />{formatCompactCount(post.commentCount)}</button>
      </div>
      <button type="button" className={`${styles.actionBtn} ${post.bookmarkedByUser ? styles.activeAction : ""}`} onClick={() => toggleBookmark(post)}><Bookmark size={18} fill={post.bookmarkedByUser ? "currentColor" : "none"} /></button>
    </div>
  );

  const renderPost = (post: WeversePost, detail = false) => {
    const author = resolvePostAuthor(post);
    const community = communityMap.get(post.communityId);
    const showOriginal = postShowsOriginal(post);
    return (
      <article className={styles.post} key={post.id}>
        <div className={styles.postHead}>
          <button type="button" className={styles.avatarButton} onClick={() => {
            if (post.authorType === "artist" && community) { setArtistTab("posts"); navigate({ type: "artist", communityId: community.id, characterId: post.authorId }); }
            else if (post.authorType === "official" && community) navigate({ type: "official", communityId: community.id });
            else if (community) navigate({ type: "community", id: community.id });
          }}><Avatar text={author.name} imageUrl={author.avatarUrl} tone={post.authorType === "official" ? "teal" : "soft"} /></button>
          <div className={styles.who}><div className={styles.name}>{author.name} {author.verified ? <Verified /> : null}</div><div className={styles.meta}>{author.meta} · {relativeTime(post.createdAt)}</div></div>
          <button type="button" className={styles.more} onClick={() => setPostMenuId(post.id)} aria-label="贴文菜单"><MoreHorizontal size={20} /></button>
        </div>
        {post.postType === "voice" && post.authorType === "artist" ? <WeverseVoicePost post={post} onNotice={onNotice} /> : post.body ? <div className={styles.postBody} onClick={() => !detail && navigate({ type: "post", postId: post.id })}>{showOriginal && post.originalBody ? post.originalBody : post.body}</div> : null}
        {post.imageUrl || post.photoDescription ? <div onContextMenu={event => { event.preventDefault(); setPhotoEditor({ postId: post.id, description: post.photoDescription || "" }); }} onTouchStart={() => { if (photoHoldTimer.current) clearTimeout(photoHoldTimer.current); photoHoldTimer.current = setTimeout(() => { setPhotoEditor({ postId: post.id, description: post.photoDescription || "" }); photoHoldTimer.current = null; }, 520); }} onTouchEnd={() => { if (photoHoldTimer.current) clearTimeout(photoHoldTimer.current); photoHoldTimer.current = null; }} onTouchMove={() => { if (photoHoldTimer.current) clearTimeout(photoHoldTimer.current); photoHoldTimer.current = null; }}>{post.imageUrl ? <WeversePostImage src={post.imageUrl} onClick={() => !detail && !photoEditor && navigate({ type: "post", postId: post.id })} /> : <button type="button" className={styles.textPhotoCard} onClick={() => setPhotoEditor({ postId: post.id, description: post.photoDescription || "" })}><span className={styles.textPhotoScroll}>{post.photoDescription}</span></button>}</div> : null}
        {post.postType !== "voice" && post.originalBody && post.originalBody !== post.body ? <button type="button" className={styles.translateBtn} onClick={() => setShowOriginalByPost((prev) => ({ ...prev, [post.id]: !showOriginal }))}>{showOriginal ? "查看翻译" : "查看原文"}</button> : null}
        {renderPostActions(post, detail)}
      </article>
    );
  };

  const currentTitle = () => {
    if (route.type === "post") return "Post";
    if (route.type === "official") return "Official";
    if (route.type === "schedule") return "日历";
    if (route.type === "notices" || route.type === "notice") return "Notice";
    if (route.type === "me") return "我的内容";
    return null;
  };

  const openAiForCurrentRoute = () => {
    if (route.type === "post") setAiMenuContext({ type: "post", postId: route.postId });
    else if (route.type === "community") setAiMenuContext({ type: "community", communityId: route.id });
    else if ("communityId" in route) setAiMenuContext({ type: "community", communityId: route.communityId });
    else if (route.type === "notice") { const notice = noticeMap.get(route.noticeId); setAiMenuContext(notice ? { type: "community", communityId: notice.communityId } : { type: "global" }); }
    else setAiMenuContext({ type: "global" });
  };

  const renderTopbar = () => {
    if (immersiveRoute) return null;
    return (
      <header className={styles.topbar}>
        <div className={styles.toprow}>
          <div className={styles.leftTop}>
            <button type="button" className={styles.iconBtn} onClick={back} aria-label="返回"><ChevronLeft size={22} /></button>
            {currentTitle() ? <strong className={styles.pageTitle}>{currentTitle()}</strong> : <div className={styles.brand}><img src="/weverse-logo.png" alt="weverse" /></div>}
          </div>
          <div className={styles.topActions}>
            <button type="button" className={`${styles.iconBtn} ${styles.aiStarBtn}`} onClick={openAiForCurrentRoute} aria-label="AI 生成"><Sparkles size={20} /></button>
            <button type="button" className={styles.iconBtn} onClick={() => setNotificationsOpen(true)} aria-label="通知">
              <Bell size={20} />{visibleNotifications.some(item => !item.read) && <i className={styles.notificationDot} />}
            </button>
            <button type="button" className={styles.iconBtn} onClick={() => setDrawerOpen(true)} aria-label="我的"><CircleUserRound size={21} /></button>
          </div>
        </div>
      </header>
    );
  };

  const renderFeed = () => {
    const posts = [...state.posts].filter((post) => post.authorType === "artist" || post.authorType === "official").sort((a, b) => b.createdAt - a.createdAt);
    return <div className={styles.scrollArea}><div className={styles.artistFeedHeading}>艺人动态</div>{posts.length ? posts.map((post) => renderPost(post)) : <div className={styles.emptyState}><Sparkles size={30} /><b>还没有艺人动态</b><p>首页只显示 Artist / Official 内容。Fan Post 会留在各自的 Community 里。</p><button type="button" onClick={() => goRoot("community")}>进入 Community</button></div>}<div className={styles.bottomSpacer} /></div>;
  };

  const renderCommunityList = () => (
    <div className={styles.scrollArea}>
      <div className={styles.communityHeader}><h2>社区</h2></div>
      <div className={styles.search}><Search size={18} /><input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="搜索我的社区" /></div>
      <div className={styles.sectionTitle}>我的社区</div>
      <div className={styles.communityGrid}>
        {filteredCommunities.map((community) => (
          <button type="button" className={styles.communityCard} key={community.id} onClick={() => { setCommunityTab("home"); navigate({ type: "community", id: community.id }); }}>
            <div className={styles.communityLogo}>{community.avatarUrl || community.official.avatarUrl ? <img src={community.avatarUrl || community.official.avatarUrl} alt="" /> : community.name.slice(0, 2)}</div>
            <div className={styles.communityInfo}><b>{community.name}</b><p>{formatCompactCount(community.fanCount)} fans · {community.memberCharacterIds.length} 位成员</p></div><ChevronRight size={21} />
          </button>
        ))}
        <button type="button" className={`${styles.communityCard} ${styles.newCard}`} onClick={() => openCommunityEditor()}><Plus size={18} /> 新建 Community</button>
      </div>
      {!state.communities.length ? <div className={styles.tipCard}><Sparkles size={18} /><div><b>从这里开始</b><p>建立 Community → 设置官号 → 从现有角色里勾选成员。没有勾选的角色不会进入 Weverse。</p></div></div> : null}
      <div className={styles.bottomSpacer} />
    </div>
  );

  const renderCommunityHero = (community: WeverseCommunity) => (
    <div className={styles.communityHero} style={community.coverUrl ? { backgroundImage: `linear-gradient(180deg,rgba(0,0,0,.05),rgba(0,0,0,.72)),url(${community.coverUrl})` } : undefined}>
      <div className={styles.communityHeroText}><span>{formatCompactCount(community.fanCount)} fans · {community.memberCharacterIds.length} members · ✓ 已加入</span><h1>{community.name}</h1></div>
    </div>
  );

  const renderCommunityHome = (community: WeverseCommunity) => {
    const notices = state.notices.filter((notice) => notice.communityId === community.id).sort((a, b) => b.createdAt - a.createdAt);
    return <div className={styles.communityPane}>
      <section className={styles.homeSection}><div className={styles.sectionTitleRow}><h3>公告</h3><button type="button" onClick={() => navigate({ type: "notices", communityId: community.id })}>查看全部</button></div><div className={styles.homeNoticeScroll}>{notices.map(notice=><button type="button" key={notice.id} className={styles.homeCard} onClick={()=>navigate({type:"notice",noticeId:notice.id})}><div><b>{notice.title}</b><small>{new Date(notice.createdAt).toLocaleDateString("zh-CN")}</small></div><ChevronRight size={20}/></button>)}{!notices.length&&<div className={styles.emptyMini}>暂无公告</div>}</div></section>
      <section className={styles.homeSection}><h3>Calendar</h3><button type="button" className={styles.homeCard} onClick={() => openCommunitySchedule(community)}><div><b>请查看 {community.name} 的日程</b><small>舞台 · 节目更新 · 纪念日 · Live 历史</small></div><ChevronRight size={20} /></button></section>
      <section className={styles.homeSection}><h3>About</h3><div className={styles.aboutCard}><div className={styles.aboutMembers}>{community.memberCharacterIds.map((characterId) => { const member = resolveMember(community, characterId); return <button type="button" key={characterId} onClick={() => { setArtistTab("posts"); navigate({ type: "artist", communityId: community.id, characterId }); }}><Avatar text={member.displayName} imageUrl={member.avatarUrl} tone="soft" /><span>{member.displayName}</span></button>; })}</div><p>{community.description || `${community.name} Official Community`}</p></div></section>
    </div>;
  };

  const renderCommunityFeed = (community: WeverseCommunity) => {
    const posts = state.posts.filter((post) => post.communityId === community.id).filter((post) => communityFeedFilter === "highlight" ? post.authorType === "artist" || post.authorType === "official" : communityFeedFilter === "fan" ? post.authorType === "user" || post.authorType === "fan" : post.authorType === "artist").sort((a, b) => b.createdAt - a.createdAt);
    const canLoadEarlier = !isPersonalWeverseCommunity(community) && community.historyMode !== "new" && Boolean(community.historyInitializedAt);
    return <div className={styles.communityPane}><div className={styles.feedFilters}>{(["highlight", "fan", "artist"] as const).map((item) => <button key={item} type="button" className={communityFeedFilter === item ? styles.activeFilter : ""} onClick={() => setCommunityFeedFilter(item)}>{item === "highlight" ? "Highlight" : item === "fan" ? "Fan" : "Artist"}</button>)}</div><div className={styles.communityFeedTitle}>{communityFeedFilter === "fan" ? "粉丝帖子" : communityFeedFilter === "artist" ? "最近艺人帖子" : "Community Highlight"}</div>{posts.length ? posts.map((post) => renderPost(post)) : <div className={styles.emptyMini}>这里还没有对应内容。</div>}{canLoadEarlier ? <button type="button" className={styles.historyLoad} disabled={generatingHistoryCommunityId === community.id} onClick={() => loadEarlierHistory(community)}>{generatingHistoryCommunityId === community.id ? "─── 加载中… ───" : "─── 加载更早动态 ───"}</button> : null}</div>;
  };

  const renderLiveReplayCard = (community: WeverseCommunity, live: WeverseLive, coverOnly = false) => {
    const hostId = live.hostCharacterIds[0];
    const host = hostId ? resolveMember(community, hostId) : null;
    const replayName = host?.displayName || community.name;
    const replayAvatar = host?.avatarUrl || community.avatarUrl || community.official.avatarUrl;
    const coverUrl = live.coverUrl || host?.liveCoverUrl || "";
    const visibleChatCount = live.comments.length;
    return <article key={live.id} className={coverOnly ? styles.latestLiveCover : styles.liveReplayCard}>
      <button type="button" className={styles.liveReplayMain} aria-label={coverOnly ? live.title : undefined} onClick={() => navigate({ type: "live", liveId: live.id })}>
        <div className={styles.replayThumb} style={coverUrl ? { backgroundImage: `url(${coverUrl})` } : undefined}>
          {!coverUrl ? <div className={styles.replayThumbFallback}>{replayAvatar ? <img src={replayAvatar} alt="" /> : <Play size={30} />}</div> : null}
          <span className={live.status === "live" ? styles.liveNowTag : styles.replayDurationTag}>{live.status === "live" ? "Live" : formatLiveDuration(live.startedAt, live.endedAt)}</span>
        </div>
        {!coverOnly && <div className={styles.liveReplayInfo}>
          <div className={styles.liveReplayAccount}><Avatar text={replayName} imageUrl={replayAvatar} tone="soft" /><span><b>{replayName} <Verified /></b><small>{new Date(live.startedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}</small></span></div>
          <h4>{live.title}</h4>
          <div className={styles.liveReplayStats}><span>播放 {formatCompactCount(live.peakViewerCount) || "0"}</span><i>·</i><span>点赞 {formatCompactCount(live.heartCount) || "0"}</span><i>·</i><span>聊天 {formatCompactCount(visibleChatCount) || "0"}</span></div>
        </div>}
      </button>
      {!coverOnly && live.status === "ended" ? <div className={styles.liveReplayActions}>
        <button type="button" onClick={() => { setEditingReplayCoverId(live.id); window.setTimeout(() => replayCoverInputRef.current?.click(), 0); }}><ImagePlus size={14} /> 更换封面</button>
        <button type="button" onClick={() => setShareLive(live)}>分享</button><button type="button" className={styles.liveReplayDelete} onClick={() => removeLiveReplay(live)}><Trash2 size={14} /> 删除回放</button>
      </div> : null}
    </article>;
  };

  const renderCommunityMedia = (community: WeverseCommunity) => {
    const lives = state.lives.filter((live) => !live.official && live.communityId === community.id).sort((a,b) => b.startedAt - a.startedAt);
    const latest = lives[0];
    const replayRows = lives.filter((live) => live.status === "ended").slice(0, 24);
    return <div className={styles.communityPane}>
      <section className={styles.mediaSection}><div className={styles.mediaSectionTitle}><h3>最新 Live</h3><button type="button" onClick={() => latest ? navigate({ type: "live", liveId: latest.id }) : undefined}><ChevronRight size={20} /></button></div>{latest ? renderLiveReplayCard(community, latest, true) : <div className={styles.emptyMini}>还没有 Live。成员开播后会汇总在这里。</div>}</section>
      <section className={styles.mediaSection}><div className={styles.mediaSectionTitle}><h3>Live · 回放</h3><span className={styles.mediaSectionCount}>{replayRows.length}</span></div>{replayRows.length ? <div className={styles.communityReplayList}>{replayRows.map((live) => renderLiveReplayCard(community, live))}</div> : <div className={styles.emptyMini}>还没有直播回放。</div>}</section>
    </div>;
  };

  const renderCommunity = (community: WeverseCommunity) => (
    <div className={styles.scrollArea}>
      <div className={styles.immersiveStickyShell}><div className={styles.immersiveStickyControls}><button type="button" onClick={back}><ChevronLeft size={24} /></button><div><button type="button" className={styles.aiStarGlass} onClick={() => setAiMenuContext({ type: "community", communityId: community.id })}><Sparkles size={20} /></button><button type="button" onClick={() => setNotificationsOpen(true)}><Bell size={20} />{visibleNotifications.some(item => !item.read) && <i className={styles.notificationDot} />}</button><button type="button" onClick={() => setCommunityMenuId(community.id)}><MoreHorizontal size={22} /></button></div></div></div>
      {renderCommunityHero(community)}<div className={styles.communityNav}>{(["home", "feed", "media"] as const).map((item) => <button key={item} type="button" className={communityTab === item ? styles.activeCommunityNav : ""} onClick={() => setCommunityTab(item)}>{item === "home" ? "Home" : item === "feed" ? "Feed" : "Live·Media"}</button>)}</div>{communityTab === "home" ? renderCommunityHome(community) : communityTab === "feed" ? renderCommunityFeed(community) : renderCommunityMedia(community)}<button type="button" className={styles.communityFab} aria-label="发布" onClick={() => community.userIdentityId === (userIdentity?.id || "user") ? setUserActions(community.id) : openComposer("user", community.id)}><Plus size={25} /></button><div className={styles.bottomSpacer} />
    </div>
  );

  const renderArtistPosts = (community: WeverseCommunity, characterId: string) => {
    const posts = state.posts.filter((post) => post.communityId === community.id && post.authorType === "artist" && post.authorId === characterId).sort((a, b) => b.createdAt - a.createdAt);
    return posts.length ? <>{posts.map((post) => renderPost(post))}</> : <div className={styles.emptyMini}>还没有 Artist Post。</div>;
  };

  const renderArtistComments = (community: WeverseCommunity, characterId: string) => {
    const activity = state.posts.filter((post) => post.communityId === community.id).flatMap((post) => post.comments
      .filter((comment) => comment.authorType === "artist" && comment.authorId === characterId && !comment.deleted)
      .map((comment) => ({ post, comment, parent: comment.parentId ? post.comments.find((item) => item.id === comment.parentId) : undefined })))
      .sort((a, b) => b.comment.createdAt - a.comment.createdAt);
    if (!activity.length) return <div className={styles.emptyMini}>这个成员暂时还没有公开回复记录。</div>;
    return <div className={styles.artistCommentActivity}>
      <div className={styles.artistCommentSort}>按从新到旧排序</div>
      {activity.map(({ post, comment, parent }) => {
        const member = resolveMember(community, characterId);
        const parentAuthor = parent ? resolveCommentAuthor(parent, post) : resolvePostAuthor(post);
        const showArtistOriginal = commentShowsOriginal(comment);
        const showParentOriginal = parent ? commentShowsOriginal(parent) : postShowsOriginal(post);
        const focusId = parent?.id || comment.id;
        return <div role="button" tabIndex={0} key={comment.id} className={styles.artistReplyCard} onClick={() => navigate({ type: "post", postId: post.id, focusCommentId: focusId })} onKeyDown={(e) => { if (e.key === "Enter") navigate({ type: "post", postId: post.id, focusCommentId: focusId }); }}>
          <div className={styles.artistReplyContext}>
            <span className={styles.replyRail} />
            <div><b>{parent?.deleted ? "此评论已删除" : parentAuthor.name}</b><p>{parent?.deleted ? "此评论已删除" : parent ? (showParentOriginal && parent.originalBody ? parent.originalBody : parent.body) : (showParentOriginal && post.originalBody ? post.originalBody : post.body)}</p>{parent && !parent.deleted && parent.originalBody && parent.originalBody !== parent.body ? <button type="button" onClick={(e) => { e.stopPropagation(); setShowOriginalByComment((prev) => ({ ...prev, [parent.id]: !showParentOriginal })); }}>{showParentOriginal ? "查看翻译" : "查看原文"}</button> : null}</div>
          </div>
          <div className={styles.artistReplyTop}><Avatar text={member.displayName} imageUrl={member.avatarUrl} tone="soft" /><div><div className={styles.artistReplyName}>{member.displayName} <Verified /></div><p>{showArtistOriginal && comment.originalBody ? comment.originalBody : comment.body}</p>{comment.originalBody && comment.originalBody !== comment.body ? <button type="button" onClick={(e) => { e.stopPropagation(); setShowOriginalByComment((prev) => ({ ...prev, [comment.id]: !showArtistOriginal })); }}>{showArtistOriginal ? "查看翻译" : "查看原文"}</button> : null}<small>{relativeTime(comment.createdAt)}</small></div></div>
        </div>;
      })}
    </div>;
  };

  const renderArtistLive = (community: WeverseCommunity, characterId: string, memberName: string) => {
    const lives = state.lives.filter((live) => live.communityId === community.id && !live.official && (live.status === "live" ? live.activeCharacterIds : live.hostCharacterIds).includes(characterId)).sort((a,b) => b.startedAt - a.startedAt);
    const current = lives.find((live) => live.status === "live" && (live.activeCharacterIds || []).includes(characterId));
    const replays = lives.filter((live) => live.status === "ended").slice(0, 12);
    return <div className={styles.artistLivePane}>
      <section className={styles.artistLiveCurrent}><div><Radio size={20} /><b>当前 Live</b></div>{current ? <><p>{memberName} 正在 Live 中</p><button type="button" onClick={() => navigate({ type: "live", liveId: current.id })}>进入 Live</button></> : <><p>{memberName} 现在没有开播。主题可以留空，让角色自己决定这次想播什么。</p><button type="button" onClick={() => characterId.startsWith("user:") ? setUserLiveDraft({communityId:community.id,title:"",theme:""}) : openLiveCreator(community, characterId)}>生成一场 Live</button></>}</section>
      <section className={styles.artistReplaySection}><h3>过往直播回放</h3>{replays.length ? <div className={styles.artistReplayList}>{replays.map((live) => renderLiveReplayCard(community, live))}</div> : <div className={styles.emptyMini}>还没有直播回放。</div>}</section>
    </div>;
  };

  const renderArtist = (community: WeverseCommunity, characterId: string) => {
    const member = resolveMember(community, characterId);
    const memberPosts = state.posts.filter((post) => post.communityId === community.id && post.authorType === "artist" && post.authorId === characterId).sort((a, b) => b.createdAt - a.createdAt);
    const mediaPosts = memberPosts.filter((post) => post.imageUrl).slice(0, 5);
    const followKey = `artist:${community.id}:${characterId}`;
    const following = isFollowing(followKey);
    return <div className={styles.scrollArea}>
      <div className={styles.immersiveStickyShell}><div className={styles.immersiveStickyControls}><button type="button" onClick={back}><ChevronLeft size={24} /></button><div><button type="button" onClick={() => openMemberEditor(community, characterId)}><Pencil size={20} /></button></div></div></div>
      <div className={styles.artistHero} style={member.coverUrl ? { backgroundImage: `linear-gradient(180deg,rgba(0,0,0,.04),rgba(0,0,0,.72)),url(${member.coverUrl})` } : undefined}><div className={styles.artistIdentity}><Avatar text={member.displayName} imageUrl={member.avatarUrl} className={styles.artistProfileAvatar} /><h1>{member.displayName} <Verified /></h1><p>{member.bio || `${community.name} · Artist`}</p><button type="button" data-following={following ? "true" : undefined} onClick={() => toggleFollow(followKey)}>{following ? "✓ 已关注" : "关注"}</button></div></div>
      <div className={styles.artistMediaStrip}>{mediaPosts.length ? mediaPosts.map((post) => <button type="button" key={post.id} onClick={() => navigate({ type: "post", postId: post.id })}><ResolvedAssetImage src={post.imageUrl!} alt="" /></button>) : <div className={styles.mediaEmpty}>暂无媒体</div>}</div>
      <div className={styles.artistTabs}>{(["posts", "comments", "live"] as const).map((item) => <button type="button" key={item} className={artistTab === item ? styles.activeArtistTab : ""} onClick={() => setArtistTab(item)}>{item === "posts" ? "帖子" : item === "comments" ? "评论" : "Live"}</button>)}</div>
      {artistTab === "posts" ? renderArtistPosts(community, characterId) : artistTab === "comments" ? renderArtistComments(community, characterId) : renderArtistLive(community, characterId, member.displayName)}<div className={styles.bottomSpacer} />
    </div>;
  };

  const renderCommentNode = (post: WeversePost, comment: WeverseComment, childrenByParent: Map<string, WeverseComment[]>, depth = 0): ReactNode => {
    const author = resolveCommentAuthor(comment, post);
    const showOriginal = commentShowsOriginal(comment);
    const children = childrenByParent.get(comment.id) || [];
    const parent = comment.parentId ? post.comments.find((item) => item.id === comment.parentId) : undefined;
    const parentAuthor = parent ? resolveCommentAuthor(parent, post) : null;
    // 只给第一层回复一次轻缩进；更深的楼中楼不继续向右漂。
    const left = depth === 1 ? 24 : 0;
    const replyClass = depth === 1 ? styles.commentReplyNode : depth > 1 ? styles.commentDeepReplyNode : "";
    const canFanReply = post.authorType !== "artist" && post.authorType !== "official";
    return <div id={`wvs-comment-${comment.id}`} key={comment.id} className={`${styles.commentThreadNode} ${replyClass} ${flashCommentId === comment.id ? styles.commentFocusFlash : ""}`} style={{ marginLeft: `${left}px` }}>
      <div className={`${styles.commentCard} ${comment.authorType === "artist" || comment.authorType === "official" ? styles.artistComment : ""}`}>
        {comment.deleted ? <div className={styles.deletedAvatar}>×</div> : <Avatar text={author.name} imageUrl={author.avatarUrl} tone="soft" />}
        <div className={styles.commentMain}>
          {comment.deleted ? <p className={styles.deletedComment}>此评论已删除</p> : <><div className={styles.commentTop}><div><b>{author.name} {author.verified ? <Verified /> : null}</b><small>{relativeTime(comment.createdAt)}</small></div><button type="button" onClick={() => setCommentMenu({ postId: post.id, commentId: comment.id })}><MoreHorizontal size={16} /></button></div>{parentAuthor ? <div className={styles.replyContextLine}>回复 {parentAuthor.name}</div> : null}<p>{showOriginal && comment.originalBody ? comment.originalBody : comment.body}</p>{comment.originalBody && comment.originalBody !== comment.body ? <button type="button" className={styles.commentTranslateBtn} onClick={() => setShowOriginalByComment((prev) => ({ ...prev, [comment.id]: !showOriginal }))}>{showOriginal ? "查看翻译" : "查看原文"}</button> : null}{canFanReply ? <button type="button" className={styles.replyBtn} onClick={() => { setReplyTarget({ postId: post.id, commentId: comment.id, name: author.name }); document.getElementById("wvs-comment-input")?.focus(); }}>回复</button> : null}</>}
        </div>
      </div>
      {children.map((child) => renderCommentNode(post, child, childrenByParent, depth + 1))}
    </div>;
  };


  const renderSchedule = (community: WeverseCommunity) => {
    const storedRows = state.schedules.filter((item) => item.communityId === community.id).map((item) => ({
      id: item.id, title: item.title, startsAt: item.startsAt, endsAt: item.endsAt, type: (item.linkedLiveId?"live":item.type) as WeverseScheduleType | "live",
      location: item.location, contentDescription:unlockedScheduleContent(item), memberCharacterIds: item.memberCharacterIds, calendarSync: item.calendarSync, visibility: item.visibility, stored: item, liveId: item.linkedLiveId as string | undefined,
    }));
    const allRows = storedRows.sort((a,b)=>a.startsAt-b.startsAt);
    const rows = allRows.filter((item) => item.visibility !== "internal");
    const zone=loadCharacters().find(c=>c.id===weverseArtists(community)[0])?.timeZone||getSystemTimeZone();
    const scheduleDateKey=(ts:number)=>formatZonedPromptTimestamp(new Date(ts),zone).slice(0,10);
    const scheduleTimeLabel=(ts:number)=>formatZonedPromptTimestamp(new Date(ts),zone).slice(11,16);
    const monthDays = getMonthMatrix(scheduleMonth);
    const today = scheduleDateKey(Date.now());
    const selectedRows = rows.filter((item) => scheduleDateKey(item.startsAt) === selectedScheduleDate);
    const selectedEnd = calendarWallTimeToInstant(selectedScheduleDate,"23:59",zone)+59999;
    const nextRow = rows.find((item) => item.startsAt > selectedEnd);
    const shiftMonth = (delta: number) => {
      const d = parseIsoDate(scheduleMonth); d.setMonth(d.getMonth()+delta); d.setDate(1);
      const next = formatIsoDate(d); setScheduleMonth(next); setSelectedScheduleDate(next);
    };
    const typeClass = (item: { type: WeverseScheduleType | "live"; visibility: "public" | "internal" }) => item.visibility === "internal"
      ? styles.scheduleTypeInternal
      : item.type === "live" ? styles.scheduleTypeLive
        : item.type === "performance" ? styles.scheduleTypePerformance
          : item.type === "brand" ? styles.scheduleTypeBrand
            : item.type === "anniversary" ? styles.scheduleTypeAnniversary
              : item.type === "release" ? styles.scheduleTypeRelease
                : styles.scheduleTypeMedia;
    const memberNames = (ids: string[]) => ids.map((id) => resolveMember(community, id).displayName).join(" · ");
    const renderRow = (item: typeof rows[number], compact = false) => <button key={item.id} type="button" className={`${styles.scheduleEventCard} ${typeClass(item)} ${compact ? styles.scheduleNextCard : ""}`} onClick={() => item.liveId ? navigate({ type: "live", liveId: item.liveId }) : item.stored ? openScheduleEditor(community, item.stored) : undefined}>
      <span className={styles.scheduleEventRail} />
      <div className={styles.scheduleEventBody}><div className={styles.scheduleEventTop}><b>{item.visibility === "internal" ? "内部行程" : (WVS_SCHEDULE_LABELS as Record<string,string>)[item.type]}</b><time>{scheduleTimeLabel(item.startsAt)}{item.calendarSync&&item.endsAt ? ` - ${scheduleTimeLabel(item.endsAt)}` : ""}</time></div><h4>{item.title}</h4>{item.contentDescription ? <p>{item.contentDescription}</p> : null}{item.memberCharacterIds.length ? <small>{memberNames(item.memberCharacterIds)}</small> : null}</div>
      {item.visibility === "internal" ? <span className={`${styles.scheduleSyncBadge} ${styles.scheduleInternalBadge}`}>仅内部</span> : item.calendarSync ? <span className={styles.scheduleSyncBadge}>手机日历</span> : null}
    </button>;
    return <div className={styles.schedulePage}>
      <section className={styles.scheduleCalendarCard}>
        <div className={styles.scheduleToolbar}><div className={styles.scheduleMonthNav}><button type="button" onClick={() => shiftMonth(-1)}><ChevronLeft size={18}/></button><b>{scheduleMonth.slice(0,7).replace("-", ".")}</b><button type="button" onClick={() => shiftMonth(1)}><ChevronRight size={18}/></button></div><div className={styles.scheduleToolbarActions}><button type="button" onClick={() => { setScheduleMonth(`${today.slice(0,7)}-01`); setSelectedScheduleDate(today); }}>今天</button></div></div>
        <div className={styles.scheduleWeekdays}>{["一","二","三","四","五","六","日"].map((day)=><span key={day}>{day}</span>)}</div>
        <div className={styles.scheduleMonthGrid}>{monthDays.flat().map((date) => {
          const dayRows = rows.filter((item) => scheduleDateKey(item.startsAt) === date);
          const selected = date === selectedScheduleDate;
          const current = date === today;
          return <button type="button" key={date} data-muted={!isSameMonth(date, scheduleMonth) ? "true" : undefined} data-selected={selected ? "true" : undefined} data-today={current ? "true" : undefined} onClick={() => setSelectedScheduleDate(date)}><span>{Number(date.slice(-2))}</span><i>{dayRows.slice(0,3).map((item) => <em key={item.id} className={typeClass(item)} />)}{dayRows.length>3&&<small>+{dayRows.length-3}</small>}</i></button>;
        })}</div>
      </section>
      <div className={styles.scheduleManageBar}><button type="button" onClick={() => openScheduleEditor(community)}><Plus size={16}/> 手动添加</button></div>
      <section className={styles.scheduleDaySection}><h3>{new Date(`${selectedScheduleDate}T00:00:00`).toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "short" })}</h3>{selectedRows.length ? <div className={styles.scheduleEventList}>{selectedRows.map((item) => renderRow(item))}</div> : <div className={styles.scheduleNoEvents}>当前没有日程，选择其他日期</div>}</section>
      {nextRow ? <section className={styles.scheduleNextSection}><h3>下个日程</h3><div className={styles.scheduleNextDate}>{new Date(nextRow.startsAt).toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "short" })}</div>{renderRow(nextRow, true)}</section> : null}
      <div className={styles.bottomSpacer}/>
    </div>;
  };

  const renderOfficialProfile = (community: WeverseCommunity) => {
    const posts = state.posts.filter((post) => post.communityId === community.id && post.authorType === "official").sort((a,b)=>b.createdAt-a.createdAt);
    const comments = state.posts.flatMap((post) => post.comments.filter((comment) => comment.authorType === "official" && !comment.deleted).map((comment) => ({ post, comment }))).sort((a,b)=>b.comment.createdAt-a.comment.createdAt);
    const followKey = `official:${community.id}`;
    const following = isFollowing(followKey);
    return <div className={styles.scrollArea}>
      <div className={styles.immersiveStickyShell}><div className={styles.immersiveStickyControls}><button type="button" onClick={back}><ChevronLeft size={24}/></button><div><button type="button" onClick={() => openCommunityEditor(community)}><Pencil size={20}/></button></div></div></div>
      <div className={styles.artistHero} style={community.coverUrl ? { backgroundImage: `linear-gradient(180deg,rgba(0,0,0,.04),rgba(0,0,0,.72)),url(${community.coverUrl})` } : undefined}>
        <div className={styles.artistIdentity}><Avatar text={community.official.displayName} imageUrl={community.official.avatarUrl} tone="teal" className={styles.artistProfileAvatar}/><h1>{community.official.displayName} <Verified/></h1><p>{formatCompactCount(community.fanCount)} 粉丝</p><button type="button" data-following={following ? "true" : undefined} onClick={() => toggleFollow(followKey)}>{following ? "✓ 已关注" : "关注"}</button></div>
      </div>
      <div className={styles.artistMediaStrip}>{posts.filter((post) => post.imageUrl).slice(0, 5).length ? posts.filter((post) => post.imageUrl).slice(0, 5).map((post) => <button type="button" key={post.id} onClick={() => navigate({ type: "post", postId: post.id })}><ResolvedAssetImage src={post.imageUrl!} alt="" /></button>) : <div className={styles.mediaEmpty}>暂无媒体</div>}</div>
      <div className={styles.officialTabs}>{(["posts","comments"] as const).map((item)=><button type="button" key={item} className={officialTab===item?styles.activeOfficialTab:""} onClick={()=>setOfficialTab(item)}>{item==="posts"?"帖子":"评论"}</button>)}</div>
      {officialTab === "posts" ? <div className={styles.officialPostsPane}>{posts.length ? posts.map((post)=>renderPost(post)) : <div className={styles.emptyMini}>还没有 Official Post。</div>}</div> : <div className={styles.officialCommentsPane}>{comments.length ? comments.map(({post,comment}) => <button type="button" key={comment.id} onClick={() => navigate({ type:"post", postId:post.id, focusCommentId:comment.parentId || comment.id })}><Avatar text={community.official.displayName} imageUrl={community.official.avatarUrl} tone="teal"/><span><b>{community.official.displayName} <Verified/></b><p>{comment.originalBody || comment.body}</p><small>{relativeTime(comment.createdAt)}</small></span></button>) : <div className={styles.officialNoComments}>尚无发表的评论</div>}</div>}
      <div className={styles.bottomSpacer}/>
    </div>;
  };

  const renderNoticeList = (community: WeverseCommunity) => {
    const notices = state.notices.filter((notice)=>notice.communityId===community.id).sort((a,b)=>b.createdAt-a.createdAt);
    return <div className={styles.scrollArea}><div className={styles.noticeListHeader}><h2>公告</h2><button type="button" onClick={()=>openNoticeEditor(community.id)}><Plus size={17}/> 新建</button></div><div className={styles.noticeList}>{notices.map((notice)=><button type="button" key={notice.id} onClick={()=>navigate({type:"notice",noticeId:notice.id})}><time>{new Date(notice.createdAt).toLocaleDateString("zh-CN")}</time><b>{notice.title}</b><ChevronRight size={18}/></button>)}{!notices.length?<div className={styles.emptyMini}>暂无公告。</div>:null}</div></div>;
  };

  const renderNoticeDetail = (notice: WeverseNotice) => {
    const community = communityMap.get(notice.communityId);
    const showOriginal = showOriginalByPost[`notice:${notice.id}`] ?? state.settings.translationDefault === "original";
    return <div className={styles.scrollArea}><article className={styles.noticeDetail}><div className={styles.noticeDetailMeta}>{community?.official.displayName || "Official"} · {new Date(notice.createdAt).toLocaleString("zh-CN")}</div><h1>{showOriginal ? notice.originalTitle || notice.title : notice.translatedTitle || notice.title}</h1><div className={styles.noticeBody}>{showOriginal && notice.originalBody ? notice.originalBody : notice.body}</div>{notice.imageUrl || notice.photoDescription ? <div onContextMenu={event => { event.preventDefault(); setNoticePhotoEditor({ noticeId: notice.id, communityId: notice.communityId, description: notice.photoDescription || "" }); }}>{notice.imageUrl ? <ResolvedAssetImage src={notice.imageUrl} className={styles.noticeImage} alt="Notice"/> : <button type="button" className={styles.textPhotoCard} onClick={() => setNoticePhotoEditor({ noticeId: notice.id, communityId: notice.communityId, description: notice.photoDescription || "" })}><span className={styles.textPhotoScroll}>{notice.photoDescription}</span></button>}</div> : null}{((notice.originalBody && notice.originalBody!==notice.body) || (notice.originalTitle && notice.originalTitle !== (notice.translatedTitle || notice.title)))?<button type="button" className={styles.translateBtn} onClick={()=>setShowOriginalByPost((prev)=>({...prev,[`notice:${notice.id}`]:!showOriginal}))}>{showOriginal?"查看翻译":"查看原文"}</button>:null}<div className={styles.noticeManage}><button type="button" onClick={()=>openNoticeEditor(notice.communityId,notice)}><Pencil size={16}/> 编辑</button>{notice.photoDescription && <button type="button" onClick={() => setNoticePhotoEditor({ noticeId: notice.id, communityId: notice.communityId, description: notice.photoDescription || "" })}><ImagePlus size={16}/> 编辑照片描述</button>}<button type="button" onClick={()=>removeNotice(notice)}><Trash2 size={16}/> 删除</button></div></article></div>;
  };

  const renderPostDetail = (post: WeversePost) => {
    const comments = [...post.comments].filter((comment) => !comment.deleted).sort((a, b) => a.createdAt - b.createdAt);
    const isArtistOrOfficialPost = post.authorType === "artist" || post.authorType === "official";
    const artistComments = comments.filter((comment) => comment.authorType === "artist" || comment.authorType === "official").sort((a,b) => b.createdAt-a.createdAt);
    const fanComments = comments.filter((comment) => comment.authorType !== "artist" && comment.authorType !== "official" && !comment.parentId).sort((a,b) => b.createdAt-a.createdAt);
    const childrenByParent = new Map<string, WeverseComment[]>();
    for (const comment of comments) {
      if (!comment.parentId) continue;
      const list = childrenByParent.get(comment.parentId) || [];
      list.push(comment);
      childrenByParent.set(comment.parentId, list);
    }
    const roots = comments.filter((comment) => !comment.parentId || !comments.some((parent) => parent.id === comment.parentId)).sort((a,b)=>b.createdAt-a.createdAt);
    const renderArtistHighlight = (comment: WeverseComment) => {
      const author = resolveCommentAuthor(comment, post);
      const showOriginal = commentShowsOriginal(comment);
      const parent = comment.parentId ? post.comments.find((item) => item.id === comment.parentId) : undefined;
      return <button type="button" key={comment.id} className={styles.postArtistCommentCard} onClick={() => {
        if (!parent) return;
        const el = document.getElementById(`wvs-comment-${parent.id}`);
        if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); setFlashCommentId(parent.id); window.setTimeout(() => setFlashCommentId((id) => id === parent.id ? null : id), 1200); }
      }}>
        <Avatar text={author.name} imageUrl={author.avatarUrl} tone="soft" />
        <div><div className={styles.postArtistCommentMeta}><b>{author.name} {author.verified ? <Verified /> : null}</b><small>{relativeTime(comment.createdAt)}</small></div><p>{showOriginal && comment.originalBody ? comment.originalBody : comment.body}</p>{comment.originalBody && comment.originalBody !== comment.body ? <span className={styles.commentTranslateBtn} onClick={(e) => { e.stopPropagation(); setShowOriginalByComment((prev) => ({ ...prev, [comment.id]: !showOriginal })); }}>{showOriginal ? "查看翻译" : "查看原文"}</span> : null}{parent ? <small className={styles.postArtistJumpHint}>回复 @{resolveCommentAuthor(parent, post).name} · 点击查看原评论</small> : null}</div>
      </button>;
    };
    return <div className={styles.postDetailPage}>
      <div className={styles.postDetailScroller}>
        <div className={styles.postDetailPost}>{renderPost(post, true)}</div>
        {isArtistOrOfficialPost ? <>
          <section className={styles.artistCommentsSection}>
            <div className={styles.commentSectionHeading}><b>艺人的评论</b><span>{artistComments.length}</span></div>
            {artistComments.length ? <div className={styles.artistCommentHighlightList}>{artistComments.map(renderArtistHighlight)}</div> : <div className={styles.emptyComment}>暂无艺人评论</div>}
          </section>
          <section className={styles.allCommentsSection}>
            <div className={styles.commentSectionHeading}><b>所有评论</b><span>{formatCompactCount(post.commentCount)}</span></div>
            <div className={styles.commentsList}>{fanComments.map((comment) => renderCommentNode(post, comment, new Map()))}{!fanComments.length ? <div className={styles.emptyComment}>还没有展开评论</div> : null}</div>
          </section>
        </> : <>
          <div className={styles.commentsTitleRow}><div className={styles.commentsTitle}>Comments <span>{formatCompactCount(post.commentCount)}</span></div></div>
          <div className={styles.commentsScroller}><div className={styles.commentsList}>{roots.map((comment) => renderCommentNode(post, comment, childrenByParent))}{!post.comments.length ? <div className={styles.emptyComment}>还没有展开评论</div> : null}</div></div>
        </>}
        {post.commentCount > post.comments.filter((comment) => !comment.deleted).length ? <button type="button" className={styles.loadMoreComments} disabled={generatingCommentsPostId === post.id} onClick={() => generateMoreComments(post)}>{generatingCommentsPostId === post.id ? "─── 加载中… ───" : "─── 加载更多评论 ───"}</button> : <div className={styles.commentsExhausted}>─── 已加载全部评论 ───</div>}
      </div>
      {replyTarget?.postId === post.id && !isArtistOrOfficialPost ? <div className={styles.replyingBar}>正在回复 {replyTarget.name}<button type="button" onClick={() => setReplyTarget(null)}><X size={14} /></button></div> : null}
      <div className={styles.commentComposer}><input id="wvs-comment-input" value={commentDraft} onChange={(e) => setCommentDraft(e.target.value)} placeholder={isArtistOrOfficialPost ? "留下评论…" : replyTarget?.postId === post.id ? `回复 ${replyTarget.name}…` : "留下评论…"} onKeyDown={(e) => { if (e.key === "Enter") submitComment(post); }} /><button type="button" onClick={() => submitComment(post)}><Send size={17} /></button></div>
    </div>;
  };

  const renderMy = (view: MyTab) => {
    const userPosts = state.posts.filter((post) => post.authorType === "user").sort((a, b) => b.createdAt - a.createdAt);
    const userComments = state.posts.flatMap((post) => post.comments.filter((comment) => comment.authorType === "user" && !comment.deleted).map((comment) => ({ post, comment }))).sort((a, b) => b.comment.createdAt - a.comment.createdAt);
    const bookmarks = state.posts.filter((post) => post.bookmarkedByUser).sort((a, b) => b.createdAt - a.createdAt);
    return <div className={styles.scrollArea}><div className={styles.myTabs}>{(["posts", "comments", "bookmarks"] as const).map((item) => <button type="button" key={item} className={view === item ? styles.activeMyTab : ""} onClick={() => setRouteStack((prev) => [...prev.slice(0, -1), { type: "me", view: item }])}>{item === "posts" ? "我的帖子" : item === "comments" ? "我的评论" : "收藏"}</button>)}</div>{view === "posts" ? (userPosts.length ? userPosts.map((post) => renderPost(post)) : <div className={styles.emptyMini}>你还没有发布 Fan Post。</div>) : view === "comments" ? (userComments.length ? <div className={styles.myCommentList}>{userComments.map(({ post, comment }) => <button type="button" key={comment.id} onClick={() => navigate({ type: "post", postId: post.id })}><b>{comment.body}</b><span>{communityMap.get(post.communityId)?.name || "Community"} · {relativeTime(comment.createdAt)}</span><small>查看原帖</small></button>)}</div> : <div className={styles.emptyMini}>你还没有留下评论。</div>) : (bookmarks.length ? bookmarks.map((post) => renderPost(post)) : <div className={styles.emptyMini}>还没有收藏内容。</div>)}<div className={styles.bottomSpacer} /></div>;
  };

  const advanceUserLive = async (live: WeverseLive, community: WeverseCommunity) => {
    if (liveGenerationRef.current || live.status !== "live") return;
    liveGenerationRef.current = live.id;
    setGeneratingLiveId(live.id);
    try {
      const aired = live.segments.filter(segment => segment.createdAt <= Date.now());
      const context: WeversePost = {
        id: live.id, communityId: community.id, authorType: "artist", authorId: live.hostCharacterIds[0],
        body: `直播《${live.title}》\n${aired.map(segment => `${segment.kind === "speech" && segment.characterId?.startsWith("user:") ? "用户输入（台词）" : segment.kind}: ${segment.original}`).join("\n").slice(-12000)}`,
        createdAt: Date.now(), likeCount: 0, commentCount: 0, comments: [],
      };
      const result = await generateWeverseFanBatch(community, [context], { targetPost: context, includePosts: false, liveLanguageRule: community.chineseProxyInput !== false ? LIVE_CHINESE_PROXY_RULE : undefined });
      const latest = loadWeverseState().lives.find(item => item.id === live.id);
      if (!latest || latest.status !== "live" || latest.endedAt) return;
      const viewers = nextWvsViewers(latest.viewerCount, latest.roundCount);
      const start = Math.max(Date.now() + 250, ...latest.comments.map(comment => comment.createdAt));
      setState(updateWeverseLive(live.id, {
        comments: [...latest.comments, ...scheduleLiveFanComments(result.comments, start)],
        viewerCount: viewers, peakViewerCount: Math.max(latest.peakViewerCount, viewers),
        heartCount: latest.heartCount + Math.max(20, Math.round(viewers * (0.08 + Math.random() * 0.18))),
        roundCount: latest.roundCount + 1,
      }));
    } catch (error) {
      onNotice?.(`评论生成失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      liveGenerationRef.current = null;
      setGeneratingLiveId(null);
    }
  };

  const startUserLive = () => {
    const draft = userLiveDraft;
    const current = loadWeverseState();
    const community = current.communities.find(item => item.id === draft?.communityId);
    if (!draft || !community || community.userIdentityId !== (userIdentity?.id || "user")) return;
    const existing = current.lives.find(item => !item.official && item.status === "live" && item.activeCharacterIds.includes(myArtistId));
    if (existing) {
      setUserLiveDraft(null);
      navigate({ type: "live", liveId: existing.id });
      return;
    }
    const guests = draft.guestIds || [];
    if (draft.guestIds && !guests.length) return onNotice?.("请先选择一位合作艺人");
    if (guests.some(id => !weverseArtists(community).includes(id) || !weverseLiveAvailability(id).free)) {
      return onNotice?.("有艺人现在无法加入，请重新选择");
    }
    const now = Date.now();
    const id = createWeverseId("wvs_live");
    const artists = [myArtistId, ...guests];
    const host = resolveMember(community, myArtistId);
    const viewers = initialWvsViewers(community.fanCount);
    setState(addWeverseLive({
      id, communityId: community.id, title: draft.title.trim() || `${host.displayName} Live`,
      coverUrl: host.liveCoverUrl || undefined, theme: draft.theme.trim() || undefined,
      hostCharacterIds: artists, activeCharacterIds: artists,
      participantPresence: artists.map(characterId => ({ characterId, joinedAt: now })), viewerPresence: [],
      liveType: "visual", orientation: "landscape", status: "live", startedAt: now,
      viewerCount: viewers, peakViewerCount: viewers, heartCount: Math.max(120, Math.round(viewers * (1.5 + Math.random() * 3.5))),
      roundCount: 0, segments: [], comments: [],
    }));
    setUserLiveDraft(null);
    navigate({ type: "live", liveId: id });
  };

  const askToJoinLive = async (live: WeverseLive, community: WeverseCommunity) => {
    if (joinPendingLiveId) return;
    setLiveActions(null);
    setJoinPendingLiveId(live.id);
    try {
      const joined = await requestWeverseLiveJoin(live.id, myArtistId, resolveMember(community, myArtistId).displayName);
      onNotice?.(joined ? "已加入合播" : "这场暂时无法加入");
    } catch {
      onNotice?.("暂时没收到回应，可以稍后再试");
    } finally {
      setJoinPendingLiveId(null);
    }
  };

  const pickLiveArtists = (community: WeverseCommunity, selected: string[], onSelect: (id: string) => void, live?: WeverseLive) => {
    const candidates = weverseArtists(community).filter(id => !live?.activeCharacterIds.includes(id));
    return <div className={styles.liveArtistChoices}>
      {candidates.map(id => {
        const member = resolveMember(community, id);
        const { free, reason } = weverseLiveAvailability(id, Date.now(), live?.id);
        const checked = selected.includes(id);
        return <button type="button" key={id} disabled={!free && !checked} aria-pressed={checked}
          className={styles.liveArtistChoice} onClick={() => onSelect(id)}>
          <Avatar text={member.displayName} imageUrl={member.avatarUrl} tone="soft" />
          <b title={member.displayName}>{member.displayName}</b>
          <small title={reason}>{free ? (checked ? "已选" : "有空") : "忙碌"}</small>
        </button>;
      })}
      {!candidates.length && <p className={styles.sheetHint}>暂无可邀请的其他艺人</p>}
    </div>;
  };

  const renderLive = (live: WeverseLive) => {
    const community = communityMap.get(live.communityId);
    const hostId = live.hostCharacterIds[0];
    if (!community || !hostId) return <div className={styles.emptyState}><b>这场 Live 的成员信息不存在</b><button type="button" onClick={back}>返回</button></div>;
    const speakerIds = [...new Set([...community.memberCharacterIds, ...live.hostCharacterIds])];
    const speakerNames = Object.fromEntries(speakerIds.map(id => [id, resolveMember(community, id).displayName]));
    const speakerAvatars = Object.fromEntries(speakerIds.map(id => [id, resolveMember(community, id).avatarUrl]));
    const isOnStage = live.activeCharacterIds.includes(myArtistId);
    const isHost = hostId === myArtistId;
    const isShared = community.userIdentityId === (userIdentity?.id || "user") && !isPersonalWeverseCommunity(community);
    const canUseActions = isShared && live.status === "live" && !live.endedAt && (isHost || (!isOnStage && !hostId.startsWith("user:")));
    const leavePage = () => {
      if (live.status === "live") setWvsBackground(live.id);
      back();
    };
    return <WeverseLiveView
      key={live.id}
      isUserHost={isOnStage}
      isUserGuest={isOnStage && !isHost}
      artistViewer={isShared && !isOnStage}
      generationFeedback={generationFeedback}
      onLiveActions={canUseActions ? () => setLiveActions({ liveId: live.id }) : undefined}
      onLeaveStage={isOnStage && !isHost ? () => {
        removeWeverseLiveGuest(live.id, myArtistId, speakerNames[myArtistId]);
        leavePage();
      } : undefined}
      onHostSend={(text, kind) => {
        const latest = loadWeverseState().lives.find(item => item.id === live.id);
        if (!latest || latest.status !== "live" || latest.endedAt || !latest.activeCharacterIds.includes(myArtistId)) return;
        setState(updateWeverseLive(live.id, { segments: [...latest.segments, {
          id: createWeverseId("wvs_segment"), kind, characterId: myArtistId, original: text, createdAt: Date.now(),
        }] }));
      }}
      live={live}
      speakerNames={speakerNames}
      speakerAvatars={speakerAvatars}
      userName={userName}
      busy={generatingLiveId === live.id}
      onBack={leavePage}
      onAdvance={() => void advanceLive(live)}
      onSendComment={body => sendLiveUserComment(live, body)}
      onHeart={() => addLiveHeart(live)}
      onFinalizeEnd={() => finalizeLive(live)}
      onManualEnd={() => manuallyEndLive(live)}
    />;
  };

  const renderContent = () => {
    if (route.type === "community") { const community = communityMap.get(route.id); return community ? renderCommunity(community) : renderCommunityList(); }
    if (route.type === "artist") { const community = communityMap.get(route.communityId); return community ? renderArtist(community, route.characterId) : renderCommunityList(); }
    if (route.type === "post") { const post = postMap.get(route.postId); return post ? renderPostDetail(post) : renderFeed(); }
    if (route.type === "official") { const community = communityMap.get(route.communityId); return community ? renderOfficialProfile(community) : renderCommunityList(); }
    if (route.type === "schedule") { const community = communityMap.get(route.communityId); return community ? renderSchedule(community) : renderCommunityList(); }
    if (route.type === "notices") { const community = communityMap.get(route.communityId); return community ? renderNoticeList(community) : renderCommunityList(); }
    if (route.type === "notice") { const notice = noticeMap.get(route.noticeId); return notice ? renderNoticeDetail(notice) : renderCommunityList(); }
    if (route.type === "live") { const live = liveMap.get(route.liveId); return live ? renderLive(live) : renderCommunityList(); }
    if (route.type === "me") return renderMy(route.view);
    return tab === "feed" ? renderFeed() : renderCommunityList();
  };

  const toggleOfficialMedia = (community: WeverseCommunity, photoId: string) => {
    const current = community.officialMediaPhotoIds || [];
    const next = current.includes(photoId) ? current.filter((id) => id !== photoId) : [...current, photoId];
    setState(upsertWeverseCommunity({ ...community, officialMediaPhotoIds: next, updatedAt: Date.now() }));
  };

  const toggleArtistMedia = (community: WeverseCommunity, characterId: string, photoId: string) => {
    if (!characterId) return;
    const profile = community.memberProfiles[characterId] || { characterId };
    const ids = new Set(profile.wvsMediaPhotoIds || []);
    if (ids.has(photoId)) ids.delete(photoId); else ids.add(photoId);
    setState(upsertWeverseCommunity({ ...community, memberProfiles: { ...community.memberProfiles, [characterId]: { ...profile, characterId, wvsMediaPhotoIds: [...ids] } }, updatedAt: Date.now() }));
  };

  const importArtistMediaFiles = async (community: WeverseCommunity, characterId: string, files: File[]) => {
    if (!files.length || !characterId) return [] as PhotoRecord[];
    const records: PhotoRecord[] = [];
    const now = Date.now();
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      try {
        const assetId = await saveChatImageToIndexedDB(file);
        records.push({
          id: createPhotoId(), assetId, originalName: file.name || undefined,
          linkedCharacterIds: [characterId], sharedPairIds: [], aiUsable: true, visionStatus: "unprocessed", usageHistory: [], origin: "upload", sourceAppId: "weverse",
          createdAt: now + index, updatedAt: now + index,
        });
      } catch { /* 单张失败不阻断其余上传 */ }
    }
    if (!records.length) { onNotice?.("Weverse 公开素材上传失败"); return records; }
    appendPhotoRecords(records);
    const latestCommunity = loadWeverseState().communities.find((item) => item.id === community.id) || community;
    const profile = latestCommunity.memberProfiles[characterId] || { characterId };
    const nextIds = Array.from(new Set([...(profile.wvsMediaPhotoIds || []), ...records.map((record) => record.id)]));
    setState(upsertWeverseCommunity({ ...latestCommunity, memberProfiles: { ...latestCommunity.memberProfiles, [characterId]: { ...profile, characterId, wvsMediaPhotoIds: nextIds } }, updatedAt: Date.now() }));
    analyzePhotosInBackground(records.map((record) => record.id));
    onNotice?.(`已把 ${records.length} 张图片存入 Photos，并加入 ${resolveMember(community, characterId).displayName} 的 Weverse 公开素材池`);
    return records;
  };

  const importOfficialMediaFiles = async (community: WeverseCommunity, files: File[], useFirstForComposer = false) => {
    if (!files.length) return [] as PhotoRecord[];
    const records: PhotoRecord[] = [];
    const now = Date.now();
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      try {
        const assetId = await saveChatImageToIndexedDB(file);
        records.push({
          id: createPhotoId(), assetId, originalName: file.name || undefined,
          linkedCharacterIds: [], sharedPairIds: [], aiUsable: true, visionStatus: "unprocessed", usageHistory: [], origin: "upload", sourceAppId: "weverse", sourceAccountId: community.id,
          createdAt: now + index, updatedAt: now + index,
        });
      } catch { /* 单张失败不阻断其余上传 */ }
    }
    if (!records.length) { onNotice?.("官方素材上传失败"); return records; }
    appendPhotoRecords(records);
    const latestCommunity = loadWeverseState().communities.find((item) => item.id === community.id) || community;
    const nextIds = Array.from(new Set([...(latestCommunity.officialMediaPhotoIds || []), ...records.map((record) => record.id)]));
    setState(upsertWeverseCommunity({ ...latestCommunity, officialMediaPhotoIds: nextIds, updatedAt: Date.now() }));
    analyzePhotosInBackground(records.map((record) => record.id));
    if (useFirstForComposer) {
      setDraftImageUrl(`asset://${records[0].assetId}`);
      setDraftPhotoLibraryId(records[0].id);
    }
    onNotice?.(`已把 ${records.length} 张图片存入 Photos，并加入 ${community.name} Official Media Pool`);
    return records;
  };

  const selectOfficialComposerPhoto = (photo: PhotoRecord) => {
    setDraftImageUrl(`asset://${photo.assetId}`);
    setDraftPhotoLibraryId(photo.id);
    setPhotoPicker(null);
  };

  return (
    <div className={styles.root}>
      {route.type !== "live" && generationFeedback}
      {renderTopbar()}
      <main className={`${styles.main} ${immersiveRoute ? styles.mainImmersive : ""}`}>{renderContent()}</main>

      {route.type === "root" ? <nav className={styles.dock} aria-label="Weverse 导航">
        <button type="button" className={tab === "feed" ? styles.activeDock : ""} onClick={() => goRoot("feed")}>
          <span className={styles.dockSelection}><span className={styles.dockWeverseIcon}><img className={styles.dockWeverseOutline} src="/weverse-home-outline.png" alt="" /><span className={styles.dockWeverseSelected}><img src="/weverse-home-glyph-white.png" alt="" /></span></span></span><small>主页</small>
        </button>
        <button type="button" className={tab === "community" ? styles.activeDock : ""} onClick={() => goRoot("community")}>
          <span className={styles.dockSelection}><span className={styles.dockCommunityIcon} aria-hidden="true"><i/><i/><i/><i/></span></span><small>社区</small>
        </button>
      </nav> : null}

      {shareLive && <div className={styles.sheetMask} onClick={()=>!sharingReplay && setShareLive(null)}><section className={`${styles.sheet} ${styles.actionSheet}`} onClick={e=>e.stopPropagation()}><div className={styles.sheetTitle}><h2>分享回放给谁看</h2><button disabled={sharingReplay} type="button" onClick={()=>setShareLive(null)}><X size={20}/></button></div><p className={styles.editorHint}>整场观看摘要供后续聊天参考，不自动发送消息或触发回复。</p>{characters.map(c=><button type="button" key={c.id} disabled={sharingReplay} onClick={async()=>{const live=shareLive;setSharingReplay(true);try{const api=resolveAuxiliaryApiConfig("memorySummaryApiConfigId");if(!api)throw new Error("请先配置记忆总结 API");const chunks:string[]=[];const source=live.segments.filter(x=>x.createdAt<=(live.endedAt||Date.now())).map(x=>`${x.kind}: ${x.original}`).join("\n");for(let i=0;i<source.length;i+=12000){const out=await simpleLLMCall(api,[{role:"user",content:`将以下直播实际内容概括为第三人称中文观看摘要，保留主播发言、动作和重要事实，省略重复闲聊，约300字。只输出摘要，不替观看者发言，不编造情绪。\n${source.slice(i,i+12000)}`}]);if(!out.content?.trim()||out.wasTruncated)throw new Error("摘要生成失败，请重试");chunks.push(out.content.trim());}if(!chunks.length)throw new Error("这场直播还没有可总结的正文");if(!loadWeverseState().lives.some(x=>x.id===live.id))throw new Error("回放已删除");recordWeverseReplaySummary(c.id,live.id,live.title,chunks.join("\n"));onNotice?.(`已为${c.name}记录观看摘要`);setShareLive(null);}catch(e){onNotice?.(e instanceof Error?e.message:String(e));}finally{setSharingReplay(false);}}}>{sharingReplay?"正在生成摘要…":c.name}</button>)}</section></div>}
      {userActions && <div className={styles.sheetMask} onClick={()=>setUserActions(null)}><section className={`${styles.sheet} ${styles.actionSheet} wvs-create-popover`} onClick={e=>e.stopPropagation()}><div className={styles.sheetTitle}><h2>发布</h2><button type="button" onClick={()=>setUserActions(null)}><X size={20}/></button></div><button type="button" onClick={()=>{openComposer("artist",userActions);setUserActions(null);}}>艺人动态</button><button type="button" onClick={()=>{setUserLiveDraft({communityId:userActions,title:"",theme:""});setUserActions(null);}}>艺人 Live</button></section></div>}
      {userLiveDraft && (() => {
        const community = communityMap.get(userLiveDraft.communityId);
        if (!community) return null;
        const selected = userLiveDraft.guestIds;
        return <div className={styles.sheetMask} onClick={() => setUserLiveDraft(null)}>
          <section className={styles.sheet} onClick={event => event.stopPropagation()} role="dialog" aria-label="开始 Live">
            <div className={styles.sheetHandle} />
            <div className={styles.sheetTitle}><h2>开始 Live</h2><button type="button" className={styles.iconBtn} onClick={() => setUserLiveDraft(null)} aria-label="关闭"><X size={20} /></button></div>
            {!isPersonalWeverseCommunity(community) && <div className={styles.liveModeRow}>
              <button type="button" aria-pressed={!selected} onClick={() => setUserLiveDraft({ ...userLiveDraft, guestIds: undefined })}>自己播</button>
              <button type="button" aria-pressed={!!selected} onClick={() => setUserLiveDraft({ ...userLiveDraft, guestIds: selected || [] })}>合作播</button>
            </div>}
            {selected && <>
              <p className={styles.fieldLabel}>选择合作艺人</p>
              {pickLiveArtists(community, selected, id => setUserLiveDraft({
                ...userLiveDraft, guestIds: selected.includes(id) ? selected.filter(item => item !== id) : [...selected, id],
              }))}
            </>}
            <label className={styles.fieldLabel} htmlFor="wvs-user-live-title">标题</label>
            <input id="wvs-user-live-title" className={styles.select} value={userLiveDraft.title} onChange={event => setUserLiveDraft({ ...userLiveDraft, title: event.target.value })} />
            <label className={styles.fieldLabel} htmlFor="wvs-user-live-theme">本场主题（可选）</label>
            <textarea id="wvs-user-live-theme" className={styles.textareaSmall} value={userLiveDraft.theme} onChange={event => setUserLiveDraft({ ...userLiveDraft, theme: event.target.value })} />
            <button type="button" className={styles.primaryButton} disabled={!!selected && !selected.length} onClick={startUserLive}>开始直播</button>
          </section>
        </div>;
      })()}
      {liveActions && (() => {
        const live = liveMap.get(liveActions.liveId);
        const community = live && communityMap.get(live.communityId);
        if (!live || !community || live.status !== "live" || live.endedAt
          || community.userIdentityId !== (userIdentity?.id || "user") || isPersonalWeverseCommunity(community)) return null;
        const isHost = live.hostCharacterIds[0] === myArtistId;
        const artistId = liveActions.artistId;
        const canAdd = artistId && !live.activeCharacterIds.includes(artistId) && weverseLiveAvailability(artistId, Date.now(), live.id).free;
        const close = () => setLiveActions(null);
        return <div className={styles.sheetMask} onClick={close}>
          <section className={`${styles.sheet} ${styles.actionSheet} ${styles.liveActionSheet}`} onClick={event => event.stopPropagation()} role="dialog" aria-label="合播">
            <div className={styles.sheetHandle} />
            <div className={styles.sheetTitle}><h2>{isHost ? "邀请其他艺人" : "合播"}</h2><button type="button" className={styles.iconBtn} onClick={close} aria-label="关闭"><X size={20} /></button></div>
            {isHost ? <>
              {pickLiveArtists(community, artistId ? [artistId] : [], id => setLiveActions({ liveId: live.id, artistId: id }), live)}
              {artistId && <>
                <button type="button" disabled={!canAdd} onClick={() => {
                  close();
                  void inviteArtistFromLive(live.id, myArtistId, artistId, resolveMember(community, artistId).displayName,
                    () => onNotice?.("已发出 Chat 邀请"))
                    .catch(error => onNotice?.(error instanceof Error ? error.message : "邀请未完成"));
                }}><MessageCircle size={18} /> 发 Chat 邀请</button>
                <button type="button" disabled={!canAdd} onClick={() => {
                  if (addWeverseLiveGuest(live.id, myArtistId, artistId, resolveMember(community, artistId).displayName)) close();
                  else onNotice?.("这位艺人现在无法加入");
                }}><UserRound size={18} /> 直接拉进直播</button>
              </>}
            </> : !live.activeCharacterIds.includes(myArtistId) &&
              <button type="button" disabled={joinPendingLiveId === live.id} onClick={() => void askToJoinLive(live, community)}>
                <Radio size={18} /> {joinPendingLiveId === live.id ? "等待回应…" : "申请加入"}
              </button>}
          </section>
        </div>;
      })()}
      {composerOpen ? <div className={styles.sheetMask} onMouseDown={(event) => { if (event.currentTarget === event.target) { setComposerOpen(false); setEditingPostId(null); } }}><section className={styles.sheet}><div className={styles.sheetHandle} /><div className={styles.sheetTitle}><h2>{editingPostId ? "编辑贴文" : composerAuthorType === "official" ? "Official Post" : composerAuthorType === "artist" ? "Artist Post" : "Fan Post"}</h2><button type="button" className={styles.iconBtn} onClick={() => { setComposerOpen(false); setEditingPostId(null); }}><X size={20} /></button></div><label className={styles.fieldLabel}>发布到</label><div className={styles.lockedCommunity}>{communityMap.get(draftCommunityId)?.name || "Community"}</div><label className={styles.fieldLabel}>{editingPostId?(isForeignOriginal(postMap.get(editingPostId)?.originalBody||"",postMap.get(editingPostId)?.body||"")?"中文译文":"原文"):"正文"}</label><textarea className={styles.textarea} value={draftText} onChange={(event) => setDraftText(event.target.value)} placeholder={composerAuthorType === "official" ? "写一条 Official Post…" : "写点什么吧…"} />{(!editingPostId || isForeignOriginal(postMap.get(editingPostId)?.originalBody||"",postMap.get(editingPostId)?.body||""))&&<><label className={styles.fieldLabel}>原文（可选）</label><textarea className={styles.textareaSmall} value={draftOriginalText} onChange={event => setDraftOriginalText(event.target.value)} placeholder="保留或修改原文"/><button type="button" className={styles.secondaryButton} disabled={translationBusy || !draftOriginalText.trim()} onClick={() => void translatePostDraft() }>{translationBusy ? "翻译中…" : "翻译原文"}</button></>}{draftImageUrl ? <div className={styles.composePreview}><ResolvedAssetImage src={draftImageUrl} alt="预览" /><button type="button" onClick={() => { setDraftImageUrl(""); setDraftPhotoLibraryId(null); }}><X size={16} /></button></div> : null}<div className={styles.mediaTools}><button type="button" onClick={() => fileInputRef.current?.click()}><ImagePlus size={18} /> {composerAuthorType === "official" ? "从手机上传" : "本地图片"}</button>{!(communityMap.get(draftCommunityId) && isPersonalWeverseCommunity(communityMap.get(draftCommunityId)!)) && <button type="button" onClick={() => setPhotoPicker({ communityId: draftCommunityId, mode: composerAuthorType === "official" ? "composeOfficial" : "composeFan" })}><Sparkles size={18} /> {composerAuthorType === "official" ? "官方媒体池" : "照片库"}</button>}{composerAuthorType === "artist" && <button type="button" onClick={()=>setVoicePost(v=>!v)}>{voicePost?"语音动态 ✓":"发送语音动态"}</button>}</div><input ref={fileInputRef} className={styles.hiddenInput} type="file" accept="image/*" onChange={async (event) => { const file = event.target.files?.[0]; if (file) { if (composerAuthorType === "official" && !(communityMap.get(draftCommunityId) && isPersonalWeverseCommunity(communityMap.get(draftCommunityId)!))) { const community = communityMap.get(draftCommunityId); if (community) await importOfficialMediaFiles(community, [file], true); } else { setDraftImageUrl(await fileToDataUrl(file)); setDraftPhotoLibraryId(null); } } event.currentTarget.value = ""; }} /><button type="button" className={styles.primaryButton} disabled={translationBusy} onClick={()=>void publish()}><Send size={18} /> {editingPostId ? "保存修改" : "发布"}</button></section></div> : null}

      {scheduleEditor ? (() => {
        const community = communityMap.get(scheduleEditor.communityId);
        if (!community) return null;
        const autoSyncTypes = new Set<WeverseScheduleType>(["performance", "brand"]);
        const allSelected = community.memberCharacterIds.length > 0 && community.memberCharacterIds.every(id => scheduleEditor.memberCharacterIds.includes(id));
        return <div className={styles.sheetMask} onMouseDown={(event) => { if (event.currentTarget === event.target) setScheduleEditor(null); }}>
          <section className={styles.sheet}>
            <div className={styles.sheetHandle} />
            <div className={styles.sheetTitle}><h2>{scheduleEditor.id ? "编辑日程" : "添加日程"}</h2><button type="button" className={styles.iconBtn} onClick={() => setScheduleEditor(null)}><X size={20} /></button></div>
            <label className={styles.fieldLabel}>行程性质</label>
            <div className={styles.scheduleVisibilityPicker}>
              <button type="button" data-active={scheduleEditor.visibility === "public" ? "true" : undefined} onClick={() => { const nextType = ["performance","brand","anniversary","release","media"].includes(scheduleEditor.type) ? scheduleEditor.type : "performance"; setScheduleEditor({ ...scheduleEditor, visibility: "public", type: nextType, calendarSync: ["performance","brand"].includes(nextType) }); }}><b>对外公开</b><small>粉丝会在 Weverse 日历看到</small></button>

            </div>
            {scheduleEditor.visibility === "public" ? <><label className={styles.fieldLabel}>公开分类</label><div className={styles.schedulePublicTypePicker}>{WVS_PUBLIC_SCHEDULE_TYPES.map(({ type, label }) => <button type="button" key={type} data-active={scheduleEditor.type === type ? "true" : undefined} onClick={() => setScheduleEditor({ ...scheduleEditor, type, calendarSync: autoSyncTypes.has(type) })}>{label}</button>)}</div></> : <p className={styles.editorHint}>电视剧 / 电影拍摄、综艺或团综录制、MV / Teaser / 画报 / 品牌拍摄、彩排、进组、内部会议与移动等都适合记为内部行程。系统生成时会自动判断具体工作类型。</p>}
            <label className={styles.fieldLabel}>日程名称</label>
            <input className={styles.select} value={scheduleEditor.title} onChange={(e) => setScheduleEditor({ ...scheduleEditor, title: e.target.value })} placeholder={scheduleEditor.visibility === "internal" ? "例如：团综录制 / 画报拍摄 / 剧组拍摄" : "例如：Music Bank / 团综 EP.12 更新 / 专辑发行"} />
            <div className={styles.scheduleEditorGrid} data-point={!scheduleEditor.calendarSync}><label><span>日期</span><input type="date" value={scheduleEditor.date} onChange={(e) => setScheduleEditor({ ...scheduleEditor, date: e.target.value })} /></label><label><span>{scheduleEditor.calendarSync?"开始":"发生时间"}</span><input type="time" value={scheduleEditor.startTime} onChange={(e) => setScheduleEditor({ ...scheduleEditor, startTime: e.target.value })} /></label>{scheduleEditor.calendarSync&&<label><span>结束</span><input type="time" value={scheduleEditor.endTime} onChange={(e) => setScheduleEditor({ ...scheduleEditor, endTime: e.target.value })} /></label>}</div>
            <label className={styles.fieldLabel}>内部地点（不对外公开）</label>
            <input className={styles.select} value={scheduleEditor.location} onChange={(e) => setScheduleEditor({ ...scheduleEditor, location: e.target.value })} placeholder="可留空" />
            {scheduleEditor.visibility === "public" && <><label className={styles.fieldLabel}>公开内容描述</label><textarea className={styles.textarea} rows={4} maxLength={4000} value={scheduleEditor.contentDescription || ""} onChange={e => setScheduleEditor({...scheduleEditor,contentDescription:e.target.value})} placeholder="一两句具体内容，到解锁时间后公开"/>{scheduleEditor.calendarSync&&<><label className={styles.fieldLabel}>内容解锁时间（留空按日程开始时间）</label><input className={styles.select} type="datetime-local" value={scheduleEditor.publicAt || ""} onChange={e => setScheduleEditor({...scheduleEditor,publicAt:e.target.value})}/></>}</>}
            <div className={styles.scheduleMemberHeading}>
              <label className={styles.fieldLabel}>参与成员</label>
              {community.memberCharacterIds.length > 1 && <button type="button" aria-pressed={allSelected}
                onClick={() => setScheduleEditor({ ...scheduleEditor, memberCharacterIds: allSelected ? [] : [...community.memberCharacterIds] })}>社区全员</button>}
            </div>
            <div className={styles.scheduleMemberPicker}>{community.memberCharacterIds.map((id) => { const m = resolveMember(community, id); const checked = scheduleEditor.memberCharacterIds.includes(id); return <button type="button" key={id} data-checked={checked ? "true" : undefined} onClick={() => setScheduleEditor({ ...scheduleEditor, memberCharacterIds: checked ? scheduleEditor.memberCharacterIds.filter((value) => value !== id) : [...scheduleEditor.memberCharacterIds, id] })}><Avatar text={m.displayName} imageUrl={m.avatarUrl} tone="soft"/><span>{m.displayName}</span></button>; })}</div>
            {scheduleEditor.visibility === "public" ? <label className={styles.scheduleSyncToggle}><span><b>实际占用角色时间</b><small>全部公开日程都会同步日历。作品上线、节目播出等节点不占用当时的时间，请关闭。</small></span><input type="checkbox" checked={scheduleEditor.calendarSync} onChange={(e) => setScheduleEditor({ ...scheduleEditor, calendarSync: e.target.checked })}/></label> : <div className={`${styles.scheduleSyncToggle} ${styles.scheduleInternalSync}`}><span><b>自动同步角色手机日历</b><small>内部工作行程不会对粉丝公开，但会作为角色真实安排写入 Calendar。</small></span><span>✓</span></div>}
            <div className={styles.scheduleEditorActions}>{scheduleEditor.id ? <button type="button" className={styles.scheduleDeleteButton} onClick={() => { const item = state.schedules.find((row) => row.id === scheduleEditor.id); if (item) removeScheduleItem(item); }}><Trash2 size={16}/> 删除</button> : null}<button type="button" className={styles.primaryButton} onClick={saveScheduleEditor}>保存日程</button></div>
          </section>
        </div>;
      })() : null}

      {liveCreator ? (() => {
        const community = communityMap.get(liveCreator.communityId);
        if (!community) return null;
        const member = resolveMember(community, liveCreator.characterId);
        return <div className={styles.sheetMask} onMouseDown={(event) => { if (event.currentTarget === event.target && !startingLive) setLiveCreator(null); }}>
          <section className={styles.sheet}>
            <div className={styles.sheetHandle} />
            <div className={styles.sheetTitle}><h2>生成成员 Live</h2><button type="button" className={styles.iconBtn} disabled={startingLive} onClick={() => setLiveCreator(null)}><X size={20} /></button></div>
            <div className={styles.liveCreatorMember}><Avatar text={member.displayName} imageUrl={member.avatarUrl} tone="soft" /><div><b>{member.displayName}</b><span>{community.name}</span></div></div>
            <label className={styles.fieldLabel}>直播类型</label>
            <div className={styles.liveTypePicker}>
              <button type="button" className={liveCreator.liveType === "auto" ? styles.liveTypePickerActive : ""} onClick={() => setLiveCreator({ ...liveCreator, liveType: "auto" })}><Sparkles size={15} /><b>角色决定</b><small>按人设和当时状态选择</small></button>
              <button type="button" className={liveCreator.liveType === "visual" ? styles.liveTypePickerActive : ""} onClick={() => setLiveCreator({ ...liveCreator, liveType: "visual" })}><Video size={15} /><b>Video Live</b><small>横屏直播舞台</small></button>
              <button type="button" className={liveCreator.liveType === "voice" ? styles.liveTypePickerActive : ""} onClick={() => setLiveCreator({ ...liveCreator, liveType: "voice" })}><Radio size={15} /><b>Voice Live</b><small>头像、发言气泡与评论</small></button>
            </div>
            <label className={styles.fieldLabel}>本场主题 · 可不填</label>
            <textarea className={styles.textareaSmall} value={liveCreator.theme} onChange={(e) => setLiveCreator({ ...liveCreator, theme: e.target.value })} placeholder={"留空：让角色自己决定为什么开播\n也可以写：活动后台 / 吃饭 / 睡前聊聊天 / 推歌…"} />
            <label className={styles.fieldLabel}>本场回放封面</label>
            <div className={styles.liveCoverEditor}>
              <button type="button" className={`${styles.liveCoverPreview} ${styles.liveCoverPreviewButton}`} onClick={() => liveCreatorCoverInputRef.current?.click()} style={liveCreator.coverUrl ? { backgroundImage: `url(${liveCreator.coverUrl})` } : undefined}>{!liveCreator.coverUrl ? <span>未设置封面</span> : null}</button>
              <div>{member.liveCoverUrl && liveCreator.coverUrl !== member.liveCoverUrl ? <button type="button" onClick={() => setLiveCreator({ ...liveCreator, coverUrl: member.liveCoverUrl })}>使用角色默认封面</button> : null}{liveCreator.coverUrl ? <button type="button" onClick={() => setLiveCreator({ ...liveCreator, coverUrl: "" })}>本场不使用封面</button> : null}</div>
            </div>
            <input ref={liveCreatorCoverInputRef} className={styles.hiddenInput} type="file" accept="image/*" onChange={async (e) => { const file = e.target.files?.[0]; if (file) setLiveCreator({ ...liveCreator, coverUrl: await fileToDataUrl(file, 1400, 0.88) }); e.currentTarget.value = ""; }} />
            <p className={styles.editorHint}>主题只是软方向；直播多久、聊多少、什么时候下播，以及同 Community 成员是否来围观或连线，都按人设和当次情境决定。选择“角色决定”时，角色会自己判断 Video Live 或 Voice Live。</p>
            <button type="button" className={styles.primaryButton} disabled={startingLive} onClick={startLive}><Radio size={18} /> {startingLive ? "正在准备 Live…" : "开始生成 Live"}</button>
          </section>
        </div>;
      })() : null}

      <input ref={replayCoverInputRef} className={styles.hiddenInput} type="file" accept="image/*" onChange={async (e) => { const file = e.target.files?.[0]; await applyReplayCoverFile(file); e.currentTarget.value = ""; }} />

      {photoEditor && <div className={styles.sheetMask} onMouseDown={event => { if (event.currentTarget === event.target) setPhotoEditor(null); }}><section className={styles.sheet}><div className={styles.sheetHandle}/><div className={styles.sheetTitle}><h2>编辑照片描述</h2><button type="button" className={styles.iconBtn} onClick={() => setPhotoEditor(null)}><X size={20}/></button></div><textarea className={styles.textarea} value={photoEditor.description} onChange={event => setPhotoEditor({ ...photoEditor, description: event.target.value })} placeholder="描述照片里看到的内容"/><button type="button" className={styles.secondaryButton} disabled={!photoEditor.description.trim()} onClick={savePhotoDescription}>仅保存文字</button><button type="button" className={styles.primaryButton} disabled={!photoEditor.description.trim() || photoGenerating} onClick={() => void generatePhotoFromDescription()}>开始生图</button></section></div>}
      {noticePhotoEditor && <div className={styles.sheetMask} onMouseDown={event => { if (event.currentTarget === event.target) setNoticePhotoEditor(null); }}><section className={styles.sheet}><div className={styles.sheetHandle}/><div className={styles.sheetTitle}><h2>编辑公告照片描述</h2><button type="button" className={styles.iconBtn} onClick={() => setNoticePhotoEditor(null)}><X size={20}/></button></div><textarea className={styles.textarea} value={noticePhotoEditor.description} onChange={event => setNoticePhotoEditor({ ...noticePhotoEditor, description: event.target.value })} placeholder="描述照片里看到的内容"/><button type="button" className={styles.secondaryButton} disabled={!noticePhotoEditor.description.trim()} onClick={saveNoticePhotoDescription}>仅保存文字</button><button type="button" className={styles.primaryButton} disabled={!noticePhotoEditor.description.trim() || photoGenerating} onClick={() => void generateNoticePhoto()}>开始生图</button></section></div>}
      {postMenuId ? (() => { const post = postMap.get(postMenuId); if (!post) return null; return <div className={styles.sheetMask} onMouseDown={(event) => { if (event.currentTarget === event.target) setPostMenuId(null); }}><section className={`${styles.sheet} ${styles.actionSheet}`}><div className={styles.sheetHandle} /><button type="button" onClick={() => { setPostMenuId(null); setPhotoEditor({ postId: post.id, description: post.photoDescription || "" }); }}><ImagePlus size={18}/> 编辑照片描述</button><button type="button" onClick={() => openPostEditor(post)}><Pencil size={18} /> 编辑贴文</button><button type="button" className={styles.dangerSheetAction} onClick={() => removePost(post)}><Trash2 size={18} /> 删除贴文</button><button type="button" onClick={() => setPostMenuId(null)}>取消</button></section></div>; })() : null}

      {commentMenu ? (() => { const post = postMap.get(commentMenu.postId); const comment = post?.comments.find((item) => item.id === commentMenu.commentId); if (!post || !comment) return null; const allowReply = post.authorType !== "artist" && post.authorType !== "official"; return <div className={styles.sheetMask} onMouseDown={(event) => { if (event.currentTarget === event.target) setCommentMenu(null); }}><section className={`${styles.sheet} ${styles.actionSheet}`}><div className={styles.sheetHandle} />{allowReply ? <button type="button" onClick={() => { const author = resolveCommentAuthor(comment, post); setReplyTarget({ postId: post.id, commentId: comment.id, name: author.name }); setCommentMenu(null); setTimeout(() => document.getElementById("wvs-comment-input")?.focus(), 30); }}><MessageCircle size={18} /> 回复</button> : null}<button type="button" className={styles.dangerSheetAction} onClick={() => removeComment(post, comment)}><Trash2 size={18} /> 删除评论</button><button type="button" onClick={() => setCommentMenu(null)}>取消</button></section></div>; })() : null}

      {communityMenuId ? (() => { const community = communityMap.get(communityMenuId); if (!community) return null; return <div className={styles.sheetMask} onMouseDown={(event) => { if (event.currentTarget === event.target) setCommunityMenuId(null); }}><section className={`${styles.sheet} ${styles.actionSheet}`}><div className={styles.sheetHandle} /><div className={styles.sheetTitle}><h2>{community.name} 管理</h2><button type="button" className={styles.iconBtn} onClick={() => setCommunityMenuId(null)}><X size={19} /></button></div><button type="button" onClick={() => { setCommunityMenuId(null); openCommunityEditor(community); }}><Settings size={18} /> 管理 Community</button><button type="button" onClick={() => { setCommunityMenuId(null); openComposer("official", community.id); }}><Send size={18} /> 发布 Official Post</button><button type="button" onClick={() => { setCommunityMenuId(null); openNoticeEditor(community.id); }}><CalendarDays size={18} /> 发布官方公告</button>{!isPersonalWeverseCommunity(community) && <button type="button" onClick={() => { setCommunityMenuId(null); setPhotoPicker({ communityId: community.id, mode: "manageOfficial" }); }}><ImagePlus size={18} /> 管理官方媒体 · {community.officialMediaPhotoIds?.length || 0}</button>}<button type="button" onClick={() => setCommunityMenuId(null)}>取消</button></section></div>; })() : null}

      {aiMenuContext ? <div className={styles.sheetMask} onMouseDown={(event) => { if (event.currentTarget === event.target) setAiMenuContext(null); }}><section className={`${styles.sheet} ${styles.actionSheet}`}><div className={styles.sheetHandle} /><div className={styles.sheetTitle}><h2>AI 生成</h2><button type="button" className={styles.iconBtn} onClick={() => setAiMenuContext(null)}><X size={19} /></button></div>{aiMenuContext.type === "post" ? (() => { const post = postMap.get(aiMenuContext.postId); return post ? <><button type="button" disabled={generatingCommentsPostId === post.id} onClick={() => generateMoreComments(post)}><MessageCircle size={18} /> {generatingCommentsPostId === post.id ? "正在加载评论…" : "加载更多评论"}</button><p className={styles.sheetHint}>只追加，不覆盖原评论；粉丝语言按“设置 → 粉丝语言”当前预设生成，艺人可能回复，也可能不回复。</p></> : null; })() : aiMenuContext.type === "community" ? (() => { const community = communityMap.get(aiMenuContext.communityId); return community ? <>{!isPersonalWeverseCommunity(community) && <button type="button" onClick={() => generateCommunityRound(community)}><Sparkles size={18} /> 生成一轮混合社区动态</button>}{!isPersonalWeverseCommunity(community) && <button type="button" onClick={() => generateArtistOnly(community)}><UserRound size={18} /> 只生成 Artist Post</button>}<button type="button" onClick={() => generateFanOnly(community)}><UsersRound size={18} /> 只刷新粉丝内容</button>{!isPersonalWeverseCommunity(community) && <button type="button" onClick={() => generateOfficialOnly(community)}><Send size={18} /> 生成 Official Post</button>}<button type="button" onClick={() => generateNoticeOnly(community)}><CalendarDays size={18} /> 生成 Official Notice</button>{!isPersonalWeverseCommunity(community) && <button type="button" onClick={() => openHistoryGenerator(community)}><History size={18}/> 补历史动态</button>}</> : null; })() : <><p className={styles.sheetHint}>选择一个 Community 刷新，或按顺序刷新全部。</p>{state.communities.map((community) => <button type="button" key={community.id} onClick={() => setAiMenuContext({ type: "community", communityId: community.id })}><Sparkles size={18} /> {community.name}</button>)}{state.communities.length > 1 ? <button type="button" onClick={generateAllCommunities}><UsersRound size={18} /> 全部 Community 各生成一轮</button> : null}</>}<button type="button" onClick={() => setAiMenuContext(null)}>取消</button></section></div> : null}

      {communityEditor ? <div className={`${styles.fullModal} wvs-community-dialog`}><div className={styles.modalHeader}><button type="button" className={styles.modalBackBtn} aria-label="返回" onPointerDown={(e) => e.stopPropagation()} onClick={() => { setCommunityEditorError(""); setCommunityEditor(null); }}><ChevronLeft size={22} /></button><b>{communityEditor.id ? "管理 Community" : "新建 Community"}</b><button type="button" className={styles.saveTextBtn} onPointerDown={(e) => e.stopPropagation()} onClick={saveCommunityEditor}>保存</button></div><div className={styles.modalScroll}>{communityEditorError ? <div className={styles.editorError}>{communityEditorError}</div> : null}<div className={styles.editorSection}><h3>Community</h3><label>名称<input value={communityEditor.name} onChange={(e) => setCommunityEditor({ ...communityEditor, name: e.target.value })} placeholder="例如 NCT WISH" /></label><label>简介<textarea value={communityEditor.description} onChange={(e) => setCommunityEditor({ ...communityEditor, description: e.target.value })} placeholder="这个 Community 的简介" /></label><label>当前粉丝数<input inputMode="numeric" value={communityEditor.fanCount} onChange={(e) => setCommunityEditor({ ...communityEditor, fanCount: e.target.value.replace(/[^0-9,，]/g, "") })} placeholder="例如 1850000" /></label><div className={styles.historyEditorRow}><label>历史状态<select value={communityEditor.historyMode} onChange={(e) => setCommunityEditor({ ...communityEditor, historyMode: e.target.value as WeverseHistoryMode })}><option value="new">新社区，不生成旧内容</option><option value="existing">已运营一段时间（默认约 1 年）</option><option value="custom">自定义开始运营日期</option></select>{communityEditor.historyMode!=="new"&&<label className={styles.editorHint} style={{display:"flex",alignItems:"center",gap:8,margin:"12px 0"}}><input type="checkbox" style={{width:16,height:16,flex:"0 0 auto",margin:0}} checked={communityEditor.autoHistory} onChange={e=>setCommunityEditor({...communityEditor,autoHistory:e.target.checked})}/><span style={{whiteSpace:"nowrap"}}>是否自动补过往</span></label>}</label>{communityEditor.historyMode === "custom" ? <label>开始运营日期<input type="date" value={communityEditor.historyStartDate} onChange={(e) => setCommunityEditor({ ...communityEditor, historyStartDate: e.target.value })} /></label> : null}{communityEditor.id && communityMap.get(communityEditor.id)?.historyInitializedAt ? <p className={styles.editorHint}>历史内容已初始化；以后在 Community Feed 底部可以继续「加载更早动态」。</p> : communityEditor.historyMode !== "new" ? <p className={styles.editorHint}>勾选后保存时补一小批过去的 Official / Artist / Fan 内容，不会写进当前近期记忆。</p> : null}</div><div className={styles.imageEditRow}><Avatar text={communityEditor.name || "C"} imageUrl={communityEditor.avatarUrl || communityEditor.officialAvatarUrl} tone="soft" className={styles.editorAvatar} /><button type="button" onClick={() => communityAvatarInputRef.current?.click()}><Camera size={16} /> Community 图标</button>{communityEditor.avatarUrl ? <button type="button" onClick={() => setCommunityEditor({ ...communityEditor, avatarUrl: "" })} aria-label="恢复默认" title="恢复默认">↺</button> : null}</div><div className={styles.imageEditRow}><span className={styles.editorCoverPreview} style={communityEditor.coverUrl?{backgroundImage:`url(${communityEditor.coverUrl})`}:undefined}/><button type="button" onClick={() => coverInputRef.current?.click()}><ImagePlus size={16} /> Community 背景图</button>{communityEditor.coverUrl ? <button type="button" onClick={() => setCommunityEditor({ ...communityEditor, coverUrl: "" })} aria-label="恢复默认" title="恢复默认">↺</button> : null}</div><input ref={communityAvatarInputRef} className={styles.hiddenInput} type="file" accept="image/*" onChange={async (e) => { const file = e.target.files?.[0]; e.currentTarget.value = ""; if (file) { const url=await fileToDataUrl(file, 500); setCommunityEditor(prev=>prev?{...prev,avatarUrl:url}:prev); } }} /><input ref={coverInputRef} className={styles.hiddenInput} type="file" accept="image/*" onChange={async (e) => { const file = e.target.files?.[0]; e.currentTarget.value = ""; if (file) { const url=await fileToDataUrl(file, 1400); setCommunityEditor(prev=>prev?{...prev,coverUrl:url}:prev); } }} /></div><div className={styles.editorSection}><h3>Official Account</h3><label>官号昵称<input value={communityEditor.officialName} onChange={(e) => setCommunityEditor({ ...communityEditor, officialName: e.target.value })} placeholder={communityEditor.name ? `${communityEditor.name} Official` : "Official Account"} /></label><label>官号简介<input value={communityEditor.officialBio} onChange={(e) => setCommunityEditor({ ...communityEditor, officialBio: e.target.value })} placeholder="公告 · Schedule" /></label><div className={styles.imageEditRow}><Avatar text={communityEditor.officialName || communityEditor.name || "O"} imageUrl={communityEditor.officialAvatarUrl} tone="teal" className={styles.editorAvatar} /><button type="button" onClick={() => officialAvatarInputRef.current?.click()}><Camera size={16} /> Official 头像</button>{communityEditor.officialAvatarUrl ? <button type="button" onClick={() => setCommunityEditor({ ...communityEditor, officialAvatarUrl: "" })} aria-label="恢复默认" title="恢复默认">↺</button> : null}</div>{communityEditor.id && (!communityEditor.userCommunity || communityEditor.selectedCharacterIds.length > 0) ? <button type="button" className={styles.mediaPoolButton} onClick={() => setPhotoPicker({ communityId: communityEditor.id!, mode: "manageOfficial" })}><ImagePlus size={17} /> 管理官方媒体池 · {communityMap.get(communityEditor.id)?.officialMediaPhotoIds?.length || 0} 张</button> : <p className={styles.editorHint}>保存 Community 后即可从 Photos 选择官号专用官方素材。</p>}<input ref={officialAvatarInputRef} className={styles.hiddenInput} type="file" accept="image/*" onChange={async (e) => { const file = e.target.files?.[0]; e.currentTarget.value = ""; if (file) { const url=await fileToDataUrl(file, 500); setCommunityEditor(prev=>prev?{...prev,officialAvatarUrl:url}:prev); } }} /></div><div className={styles.editorSection}><h3>绑定成员</h3><label className={styles.fieldLabel}>直播风格</label><textarea className={styles.textareaSmall} value={communityEditor.liveStyle || ""} onChange={e=>setCommunityEditor({...communityEditor,liveStyle:e.target.value})} placeholder="开播习惯、说话方式与常聊内容；留空按人设发挥"/>
              <div className={styles.scheduleSyncToggle}>
                <span><b>中文代输入</b><small>中文台词和留言按直播当前语言理解</small></span>
                <Toggle checked={communityEditor.chineseProxyInput !== false} onChange={checked => setCommunityEditor({ ...communityEditor, chineseProxyInput: checked })} />
              </div><p className={styles.editorHint}>同一个角色可以同时加入多个 Community；底层仍是同一个角色、同一套记忆和相册。</p><div className={styles.memberPicker}><button type="button" className={`${styles.memberPickCard} ${communityEditor.userCommunity ? styles.memberPickActive : ""}`} onClick={()=>setCommunityEditor({...communityEditor,userCommunity:!communityEditor.userCommunity})}><Avatar text={artistName} imageUrl={artistAvatar} tone="soft" className={styles.memberPickAvatar}/><span className={styles.memberPickName}>{artistName}</span><span className="wvs-self-badge">我</span><i>{communityEditor.userCommunity?"✓":"+"}</i></button>{characters.map((char) => { const checked = communityEditor.selectedCharacterIds.includes(char.id); return <button type="button" key={char.id} className={`${styles.memberPickCard} ${checked ? styles.memberPickActive : ""}`} onClick={() => setCommunityEditor({ ...communityEditor, selectedCharacterIds: checked ? communityEditor.selectedCharacterIds.filter((id) => id !== char.id) : [...communityEditor.selectedCharacterIds, char.id] })}><Avatar text={char.name} imageUrl={char.avatar} tone="soft" className={styles.memberPickAvatar} /><span className={styles.memberPickName}>{char.name}</span><i>{checked ? "✓" : "+"}</i></button>; })}</div>{!characters.length ? <div className={styles.emptyMini}>当前还没有角色，请先在「角色」App 建立角色。</div> : null}</div>{communityEditor.id ? <div className={styles.editorSection}><h3>危险操作</h3><button type="button" className={styles.dangerButton} onClick={() => { const community = communityMap.get(communityEditor.id!); if (community) removeCommunity(community); }}><Trash2 size={16} /> 删除 Community</button></div> : null}</div></div> : null}

      {memberEditor ? <div className={styles.sheetMask} onMouseDown={(event) => { if (event.currentTarget === event.target) setMemberEditor(null); }}>
        <section className={styles.sheet} role="dialog" aria-modal="true" aria-label="成员 Weverse 资料" onKeyDown={e=>{if(e.key==="Escape")setMemberEditor(null);}}>
          <div className={styles.sheetHandle} />
          <div className={styles.sheetTitle}><h2>成员 Weverse 资料</h2><button type="button" className={styles.iconBtn} onClick={() => setMemberEditor(null)}><X size={20} /></button></div>
          <div className={styles.memberEditProfile}><Avatar text={memberEditor.displayName} imageUrl={memberEditor.avatarUrl} className={styles.bigAvatar} /><button type="button" onClick={() => memberAvatarInputRef.current?.click()}><Camera size={16} /> 换头像</button><button type="button" onClick={() => memberCoverInputRef.current?.click()}><ImagePlus size={16} /> 换主页背景</button></div>
          <input ref={memberAvatarInputRef} className={styles.hiddenInput} type="file" accept="image/*" onChange={async (e) => { const file = e.target.files?.[0]; if (file) setMemberEditor({ ...memberEditor, avatarUrl: await fileToDataUrl(file, 500) }); e.currentTarget.value = ""; }} />
          <input ref={memberCoverInputRef} className={styles.hiddenInput} type="file" accept="image/*" onChange={async (e) => { const file = e.target.files?.[0]; if (file) setMemberEditor({ ...memberEditor, coverUrl: await fileToDataUrl(file, 1400) }); e.currentTarget.value = ""; }} />
          <input ref={memberLiveCoverInputRef} className={styles.hiddenInput} type="file" accept="image/*" onChange={async (e) => { const file = e.target.files?.[0]; if (file) setMemberEditor({ ...memberEditor, liveCoverUrl: await fileToDataUrl(file, 1400, 0.88) }); e.currentTarget.value = ""; }} />
          <label className={styles.fieldLabel}>Weverse 显示昵称</label><input className={styles.select} value={memberEditor.displayName} onChange={(e) => setMemberEditor({ ...memberEditor, displayName: e.target.value })} />
          <label className={styles.fieldLabel}>简介</label><textarea className={styles.textareaSmall} value={memberEditor.bio} onChange={(e) => setMemberEditor({ ...memberEditor, bio: e.target.value })} placeholder="可选，只影响 Weverse 展示" />
          <label className={styles.fieldLabel}>默认 Live 封面</label>
          <div className={styles.liveCoverEditor}>
            <button type="button" className={`${styles.liveCoverPreview} ${styles.liveCoverPreviewButton}`} onClick={() => memberLiveCoverInputRef.current?.click()} style={memberEditor.liveCoverUrl ? { backgroundImage: `url(${memberEditor.liveCoverUrl})` } : undefined}>{!memberEditor.liveCoverUrl ? <span>未设置默认封面</span> : null}</button>
            <div>{memberEditor.liveCoverUrl ? <button type="button" onClick={() => setMemberEditor({ ...memberEditor, liveCoverUrl: "" })}>清除默认封面</button> : null}</div>
          </div>
          <p className={styles.editorHint}>设置后，这个成员以后新开的个人 Live 默认使用这张回放封面；单场开播前仍可覆盖。</p>
          {!memberEditor.characterId.startsWith("user:") && <>
          <button type="button" className={styles.mediaPoolButton} onClick={() => setPhotoPicker({ communityId: memberEditor.communityId, mode: "manageArtist", characterId: memberEditor.characterId })}><ImagePlus size={17} /> 管理 Weverse 公开素材 · {communityMap.get(memberEditor.communityId)?.memberProfiles[memberEditor.characterId]?.wvsMediaPhotoIds?.length || 0} 张</button>
          </>}
          <button type="button" className={styles.primaryButton} onClick={saveMemberEditor}>保存</button>
        </section>
      </div> : null}

      {userProfileDraft ? <div className={styles.sheetMask} onMouseDown={(event) => { if (event.currentTarget === event.target) setUserProfileDraft(null); }}><section className={styles.sheet}><div className={styles.sheetHandle} /><div className={styles.sheetTitle}><h2>编辑资料</h2><button type="button" className={styles.iconBtn} onClick={() => setUserProfileDraft(null)}><X size={20} /></button></div><p className={styles.editorHint}>默认继承当前 User Identity；这里修改只影响 Weverse 里的粉丝昵称、头像和简介。</p><div className={styles.memberEditProfile}><Avatar text={userProfileDraft.displayName || userName} imageUrl={userProfileDraft.avatarUrl} className={styles.bigAvatar} /><button type="button" onClick={() => userAvatarInputRef.current?.click()}><Camera size={16} /> 换头像</button>{userProfileDraft.avatarUrl ? <button type="button" onClick={() => setUserProfileDraft({ ...userProfileDraft, avatarUrl: "" })}>清除</button> : null}</div><input ref={userAvatarInputRef} className={styles.hiddenInput} type="file" accept="image/*" onChange={async (e) => { const file = e.target.files?.[0]; if (file) setUserProfileDraft({ ...userProfileDraft, avatarUrl: await fileToDataUrl(file, 500) }); e.currentTarget.value = ""; }} /><label className={styles.fieldLabel}>昵称</label><input className={styles.select} value={userProfileDraft.displayName} onChange={(e) => setUserProfileDraft({ ...userProfileDraft, displayName: e.target.value })} placeholder={userIdentity?.name || "我的昵称"} /><label className={styles.fieldLabel}>简介</label><textarea className={styles.textareaSmall} value={userProfileDraft.bio} onChange={(e) => setUserProfileDraft({ ...userProfileDraft, bio: e.target.value })} placeholder="Fan account" /><button type="button" className={styles.primaryButton} onClick={saveUserProfile}>保存资料</button><button type="button" className={styles.secondaryButton} onClick={() => { const nextState = updateWeverseUserProfile({ displayName: undefined, avatarUrl: undefined, bio: undefined }); setState(nextState); setUserProfileDraft({ displayName: userIdentity?.name || "", avatarUrl: userIdentity?.avatarUrl || "", bio: userIdentity?.bio || "" }); onNotice?.("已恢复继承 User Identity"); }}>恢复继承 User Identity</button></section></div> : null}

      {historyDraft ? <div className={styles.sheetMask} onMouseDown={event => { if (event.currentTarget === event.target && !historyLock.current) setHistoryDraft(null); }}><section className={styles.sheet}><div className={styles.sheetHandle}/><div className={styles.sheetTitle}><h2>{historyDraft.kind === "schedule" ? "补历史日程" : "补历史动态"}</h2><button type="button" className={styles.iconBtn} disabled={Boolean(generatingHistoryCommunityId)} onClick={() => setHistoryDraft(null)}><X size={20}/></button></div><label className={styles.fieldLabel}>开始日期</label><input type="date" className={styles.select} value={historyDraft.from} max={historyDraft.to} disabled={Boolean(generatingHistoryCommunityId)} onChange={event => setHistoryDraft({ ...historyDraft, from: event.target.value })}/><label className={styles.fieldLabel}>结束日期</label><input type="date" className={styles.select} value={historyDraft.to} max={formatIsoDate(new Date(Date.now() - 86400000))} disabled={Boolean(generatingHistoryCommunityId)} onChange={event => setHistoryDraft({ ...historyDraft, to: event.target.value })}/>{historyDraft.kind !== "schedule" && <><label className={styles.fieldLabel}>内容类型</label><select className={styles.select} value={historyDraft.kind} disabled={Boolean(generatingHistoryCommunityId)} onChange={event => setHistoryDraft({ ...historyDraft, kind: event.target.value as typeof historyDraft.kind })}><option value="mixed">混合动态</option><option value="artist">Artist Post</option><option value="official">Official Post</option><option value="fan">粉丝动态</option><option value="notice">Official Notice</option></select></>}<label className={styles.fieldLabel}>数量</label><input type="number" min={1} max={30} className={styles.select} value={historyDraft.count} disabled={Boolean(generatingHistoryCommunityId)} onChange={event => setHistoryDraft({ ...historyDraft, count: Number(event.target.value) })}/><p className={styles.editorHint}>{historyProgress || "只补充历史内容，保留现有记录。"}</p><button type="button" className={styles.primaryButton} disabled={Boolean(generatingHistoryCommunityId)} onClick={() => void generateHistoryRange()}>{generatingHistoryCommunityId ? "生成中…" : "开始生成"}</button></section></div> : null}
      {noticeEditor ? <div className={styles.sheetMask} onMouseDown={(event) => { if (event.currentTarget === event.target) setNoticeEditor(null); }}><section className={styles.sheet}><div className={styles.sheetHandle} /><div className={styles.sheetTitle}><h2>{noticeEditor.id ? "编辑公告" : "发布公告"}</h2><button type="button" className={styles.iconBtn} onClick={() => setNoticeEditor(null)}><X size={20} /></button></div><label className={styles.fieldLabel}>标题 / 中文翻译</label><input className={styles.select} value={noticeEditor.title} onChange={(e)=>setNoticeEditor({...noticeEditor,title:e.target.value})} placeholder="公告标题"/><label className={styles.fieldLabel}>正文</label><textarea className={styles.textarea} value={noticeEditor.body} onChange={(e)=>setNoticeEditor({...noticeEditor,body:e.target.value})} placeholder="正式公告正文…"/><label className={styles.fieldLabel}>原文标题</label><input className={styles.select} value={noticeEditor.originalTitle} onChange={event => setNoticeEditor({ ...noticeEditor, originalTitle: event.target.value })}/><label className={styles.fieldLabel}>原文正文</label><textarea className={styles.textareaSmall} value={noticeEditor.originalBody} onChange={event => setNoticeEditor({ ...noticeEditor, originalBody: event.target.value })}/><button type="button" className={styles.secondaryButton} disabled={translationBusy || !noticeEditor.originalBody.trim()} onClick={() => void translateNoticeDraft()}>{translationBusy ? "翻译中…" : "翻译原文标题与正文"}</button><p className={styles.editorHint}>Notice 与 Official Post 分开保存；Notice 没有点赞和评论区。</p><button type="button" className={styles.primaryButton} onClick={saveNoticeEditor}>{noticeEditor.id ? "保存修改" : "发布公告"}</button></section></div> : null}

      {settingsOpen ? <div className={styles.sheetMask} onMouseDown={(event) => { if (event.currentTarget === event.target) setSettingsOpen(false); }}><section className={styles.sheet}><div className={styles.sheetHandle} /><div className={styles.sheetTitle}><h2>设置</h2><button type="button" className={styles.iconBtn} onClick={() => setSettingsOpen(false)}><X size={20} /></button></div><AppNotificationSetting app="weverse" className={styles.noticeSetting} /><div className={styles.settingGroup}><label><span><b>默认语言显示</b><small>单条正文和评论仍然可以切换</small></span><select value={state.settings.translationDefault} onChange={(e) => updateSettings({ translationDefault: e.target.value as WeverseSettings["translationDefault"] })}><option value="translated">中文翻译</option><option value="original">原文</option></select></label><label><span><b>评论自动翻译</b><small>关闭后评论默认显示原文</small></span><input type="checkbox" checked={state.settings.autoTranslateComments} onChange={(e) => updateSettings({ autoTranslateComments: e.target.checked })} /></label></div><div className={styles.settingGroup}><label><span><b>社区活跃度</b><small>影响每轮 Fan Post / 评论数量，不强迫艺人回复</small></span><select value={state.settings.fanActivity} onChange={(e) => updateSettings({ fanActivity: e.target.value as WeverseSettings["fanActivity"] })}><option value="quiet">安静</option><option value="normal">普通</option><option value="lively">热闹</option></select></label><label><span><b>粉丝语言</b><small>控制 Fan Post、普通评论和 Live 观众评论的语言倾向</small></span><select value={state.settings.fanLanguagePreset} onChange={(e) => updateSettings({ fanLanguagePreset: e.target.value as WeverseSettings["fanLanguagePreset"] })}><option value="korean_mixed">韩语多</option><option value="japanese_mixed">日语多</option><option value="chinese_mixed">中文多</option><option value="english_mixed">英语多</option><option value="balanced">平均</option><option value="kr_jp_mixed">日韩多</option></select></label></div><div className={styles.settingGroup}><label><span><b>默认生成范围</b><small>顶部星星菜单仍可手动选择</small></span><select value={state.settings.generationScope} onChange={(e) => updateSettings({ generationScope: e.target.value as WeverseSettings["generationScope"] })}><option value="current">当前 Community</option><option value="all">全部 Community</option></select></label></div><div className={styles.settingGroup}><h3>通知偏好</h3>{([['artistReply','艺人回复我'],['fanReply','粉丝回复我'],['artistPost','Artist 新帖'],['officialPost','Official 新帖'],['live','Live 开播']] as const).map(([key,label]) => <label key={key}><span><b>{label}</b></span><input type="checkbox" checked={state.settings.notifications[key]} onChange={(e) => updateSettings({ notifications: { ...state.settings.notifications, [key]: e.target.checked } })} /></label>)}</div><p className={styles.editorHint}>这些开关会直接控制之后是否写入站内通知。</p></section></div> : null}

      {photoPicker ? (() => {
        const community = communityMap.get(photoPicker.communityId);
        if (!community) return null;
        const artistProfile = photoPicker.characterId ? community.memberProfiles[photoPicker.characterId] : undefined;
        const selected = new Set(photoPicker.mode === "manageArtist" ? (artistProfile?.wvsMediaPhotoIds || []) : photoPicker.mode === "manageOfficial" || photoPicker.mode === "composeOfficial" ? (community.officialMediaPhotoIds || []) : []);
        const usablePhotos = photoLibrary.photos.filter(photo => hasPhotoMatchDescription(photo) || selected.has(photo.id));
        const displayPhotos = photoPicker.mode === "composeOfficial" ? usablePhotos.filter((photo) => selected.has(photo.id)) : usablePhotos;
        return <div className={styles.fullModal}><div className={styles.modalHeader}><button type="button" className={styles.modalBackBtn} onClick={() => setPhotoPicker(null)}><ChevronLeft size={22} /></button><b>{photoPicker.mode === "manageArtist" ? `${resolveMember(community, photoPicker.characterId || "").displayName} · Weverse 媒体` : photoPicker.mode === "manageOfficial" ? `${community.name} 官方媒体` : photoPicker.mode === "composeFan" ? "选择照片" : "选择官方素材"}</b><button type="button" className={styles.saveTextBtn} onClick={() => setPhotoPicker(null)}>完成</button></div><div className={styles.modalScroll}><div className={styles.officialMediaIntro}><b>{photoPicker.mode === "manageArtist" ? resolveMember(community, photoPicker.characterId || "").displayName : photoPicker.mode === "composeFan" ? "我的 Photos" : community.official.displayName}</b><p>{photoPicker.mode === "manageArtist" ? "这里是该成员的 Weverse 公开素材池。图片本体仍保存在 Photos；只有加入这里的照片才会被 Weverse Artist Post 调用，Chat / Bubble 等私人途径不会因为加入本池而自动使用。" : photoPicker.mode === "manageOfficial" ? "官号仍然只属于 Weverse。下方可以从 Photos 勾选，也可以直接从手机上传；手机上传会先进入 Photos、自动识图，再引用到当前 Official Media Pool。" : photoPicker.mode === "composeFan" ? "从 Photos 里选择一张已经完成识图的照片作为这条 Fan Post 的图片。" : "只显示已经加入该官号媒体池的素材。"}</p></div>{photoPicker.mode === "manageOfficial" || photoPicker.mode === "manageArtist" ? <><div className={styles.officialMediaActions}><button type="button" onClick={() => document.getElementById("wvs-official-photo-grid")?.scrollIntoView({ behavior: "smooth" })}><Sparkles size={16} /> 从 Photos 选择</button><button type="button" onClick={() => officialMediaUploadInputRef.current?.click()}><ImagePlus size={16} /> 从手机上传</button></div><input ref={officialMediaUploadInputRef} className={styles.hiddenInput} type="file" accept="image/*" multiple onChange={async (event) => { const files = Array.from(event.currentTarget.files || []) as File[]; if (files.length) { if (photoPicker.mode === "manageArtist") await importArtistMediaFiles(community, photoPicker.characterId || "", files); else await importOfficialMediaFiles(community, files); } event.currentTarget.value = ""; }} /></> : null}{displayPhotos.length ? <div id="wvs-official-photo-grid" className={styles.officialMediaGrid}>{displayPhotos.map((photo) => <button type="button" key={photo.id} className={(photoPicker.mode === "manageOfficial" || photoPicker.mode === "manageArtist") && selected.has(photo.id) ? styles.officialMediaSelected : ""} onClick={() => photoPicker.mode === "manageArtist" ? toggleArtistMedia(community, photoPicker.characterId || "", photo.id) : photoPicker.mode === "manageOfficial" ? toggleOfficialMedia(community, photo.id) : selectOfficialComposerPhoto(photo)}><ResolvedAssetImage src={`asset://${photo.assetId}`} alt="" /><span>{photo.subject || photo.visionTags?.slice(0,2).join(" · ") || "媒体素材"}</span>{photoPicker.mode === "manageOfficial" || photoPicker.mode === "manageArtist" ? <i>{selected.has(photo.id) ? "✓" : "+"}</i> : null}</button>)}</div> : <div className={styles.emptyMini}>{photoPicker.mode === "manageArtist" ? "Photos 里还没有完成识图的素材。先去 Photos 导入图片。" : photoPicker.mode === "manageOfficial" ? "Photos 里还没有完成识图的素材。先去 Photos 导入图片。" : photoPicker.mode === "composeFan" ? "Photos 里还没有完成识图的照片。先去 Photos 导入图片。" : "这个官号媒体池还是空的。先在 Community 管理里添加官方媒体。"}</div>}</div></div>;
      })() : null}


      {notificationsOpen ? <div className={styles.fullModal}>
        <div className={styles.modalHeader}><button type="button" className={styles.modalBackBtn} onClick={() => setNotificationsOpen(false)}><ChevronLeft size={22}/></button><b>通知</b><button type="button" className={styles.saveTextBtn} onClick={markAllNotificationsRead}>全部已读</button></div>
        <div className={`${styles.modalScroll} ${styles.notificationPage}`}>{visibleNotifications.length ? <>{["今天","更早"].map((group) => { const today = new Date(); today.setHours(0,0,0,0); const rows = visibleNotifications.filter((item) => group === "今天" ? item.createdAt >= today.getTime() : item.createdAt < today.getTime()); return rows.length ? <section key={group} className={styles.notificationGroup}><h3>{group}</h3>{rows.map((item) => <button type="button" key={item.id} className={`${styles.notificationRow} ${!item.read ? styles.notificationUnread : ""}`} onClick={() => openNotification(item)}><Avatar text={item.title} imageUrl={item.avatarUrl} tone="soft"/><span><b>{item.title}</b><small>{relativeTime(item.createdAt)}</small></span>{!item.read ? <i/> : null}</button>)}</section> : null; })}</> : <div className={styles.emptyMini}>还没有通知。</div>}</div>
      </div> : null}
      <div className={`${styles.drawerMask} ${drawerOpen ? styles.show : ""}`} onClick={() => setDrawerOpen(false)} />
      <aside className={`${styles.drawer} ${drawerOpen ? styles.show : ""}`}>
        <button type="button" className={styles.userCardButton} onClick={openUserProfileEditor}><div className={styles.userCard}><Avatar text={userName} imageUrl={userAvatar} tone="soft" className={styles.userAvatar} /><div><h3>{userName}</h3><p>{userBio}</p></div></div><Pencil size={16} /></button>
        <button type="button" className={styles.drawerItem} onClick={openUserProfileEditor}><UserRound size={20} /><span>编辑资料</span></button>
        <button type="button" className={styles.drawerItem} onClick={() => openMy("posts")}><MessageCircle size={20} /><span>我的内容</span></button>
        <button type="button" className={styles.drawerItem} onClick={() => { setDrawerOpen(false); setSettingsOpen(true); }}><Settings size={20} /><span>设置</span></button>
        <button type="button" className={styles.drawerItem} onClick={onClose}><ChevronLeft size={20} /><span>返回桌面</span></button>
      </aside>
    </div>
  );
}
