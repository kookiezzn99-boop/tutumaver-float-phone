import { kvGet, kvKeysWithPrefix, kvRemove, kvSet, registerDynamicPrefix } from "./kv-db";
import { revokeMemorySources } from "./memory-event-meta";
import { formatChatTimestamp } from "./llm-prompt-assembler";
import { loadCharacters } from "./character-storage";
import { resolveUserIdentity } from "./settings-storage";
import { buildWeverseLiveMemory } from "./weverse-live-memory";

const WEV_EVENT_PREFIX = "ai_phone_weverse_events_";
const MAX_EVENTS_PER_CHARACTER = 120;

registerDynamicPrefix(WEV_EVENT_PREFIX);

export type WeverseProjectionEntry = {
  id: string;
  timestamp: string;
  content: string;
  postId?: string;
  commentId?: string;
  shared?: boolean;
  sourceKeys?: string[];
};

function storageKey(characterId: string): string {
  return `${WEV_EVENT_PREFIX}${characterId}`;
}

function cleanText(value: unknown, maxLength: number): string {
  const text = String(value ?? "").replace(/\r\n?/g, "\n").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function loadEventsByKey(key: string): WeverseProjectionEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = kvGet(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is WeverseProjectionEntry => Boolean(entry)
        && typeof (entry as Partial<WeverseProjectionEntry>).id === "string"
        && typeof (entry as Partial<WeverseProjectionEntry>).timestamp === "string"
        && typeof (entry as Partial<WeverseProjectionEntry>).content === "string")
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  } catch {
    return [];
  }
}

function saveEventsByKey(key: string, events: WeverseProjectionEntry[]): void {
  if (typeof window === "undefined") return;
  const compacted = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp)).slice(-MAX_EVENTS_PER_CHARACTER);
  kvSet(key, JSON.stringify(compacted));
}

function upsert(characterId: string, entry: WeverseProjectionEntry): void {
  const key = storageKey(characterId);
  const current = loadEventsByKey(key);
  saveEventsByKey(key, [...current.filter((item) => item.id !== entry.id), entry]);
}

export function recordWeverseArtistPostEvent(input: {
  characterId: string;
  characterName: string;
  communityName: string;
  postId: string;
  body: string;
  originalBody?: string;
  hasPhoto?: boolean;
  timestamp?: string;
}): void {
  const timestamp = input.timestamp || new Date().toISOString();
  const name = cleanText(input.characterName, 80) || "角色";
  const community = cleanText(input.communityName, 80) || "Community";
  const body = cleanText(input.originalBody || input.body, 520);
  if (!body && !input.hasPhoto) return;
  upsert(input.characterId, {
    id: `weverse_post_${input.postId}`,
    postId: input.postId,
    timestamp,
    content: `[Weverse ${formatChatTimestamp(timestamp)}] ${name}在 WVS 的「${community}」社区发了艺人动态${body ? `：“${body}”` : ""}${input.hasPhoto ? "，并附带了一张照片" : ""}。`,
  });
}

export function recordWeverseArtistReplyEvent(input: {
  characterId: string;
  characterName: string;
  communityName: string;
  postId: string;
  commentId: string;
  targetName: string;
  targetBody?: string;
  replyBody: string;
  timestamp?: string;
}): void {
  const timestamp = input.timestamp || new Date().toISOString();
  const name = cleanText(input.characterName, 80) || "角色";
  const target = cleanText(input.targetName, 80) || "粉丝";
  const reply = cleanText(input.replyBody, 360);
  if (!reply) return;
  upsert(input.characterId, {
    id: `weverse_reply_${input.commentId}`,
    postId: input.postId,
    commentId: input.commentId,
    timestamp,
    content: `[Weverse ${formatChatTimestamp(timestamp)}] ${name}在「${cleanText(input.communityName, 80) || "Community"}」回复了${target}${input.targetBody ? `的内容“${cleanText(input.targetBody, 220)}”` : ""}，回复：“${reply}”。`,
  });
}

export function deleteWeverseProjectionEventForComment(commentId: string): void {
  if (!commentId || typeof window === "undefined") return;
  for (const key of kvKeysWithPrefix(WEV_EVENT_PREFIX)) {
    const current = loadEventsByKey(key);
    const next = current.filter((entry) => entry.commentId !== commentId && entry.id !== `weverse_reply_${commentId}`);
    if (next.length === current.length) continue;
    if (next.length === 0) kvRemove(key);
    else saveEventsByKey(key, next);
  }
}

export function deleteWeverseProjectionEventsForPost(postId: string): void {
  if (!postId || typeof window === "undefined") return;
  for (const key of kvKeysWithPrefix(WEV_EVENT_PREFIX)) {
    const current = loadEventsByKey(key);
    const next = current.filter((entry) => entry.postId !== postId && entry.id !== `weverse_post_${postId}`);
    if (next.length === current.length) continue;
    if (next.length === 0) kvRemove(key);
    else saveEventsByKey(key, next);
  }
}

export function loadWeverseProjectionEntries(characterId: string, options?: { afterTimestamp?: string }): WeverseProjectionEntry[] {
  type Live = Parameters<typeof buildWeverseLiveMemory>[0];
  let raw: { lives?: Live[]; communities?: Array<{ id: string; name: string; memberProfiles?: Record<string, { displayName?: string }> }> } = {};
  try { raw = JSON.parse(kvGet("ai_phone_weverse_state_v1") || "{}"); } catch {}
  const lives = Array.isArray(raw.lives) ? raw.lives : [];
  const communities = Array.isArray(raw.communities) ? raw.communities : [];
  const entries = loadEventsByKey(storageKey(characterId)).flatMap(entry => {
    if (entry.id.startsWith("weverse_post_")) {
      return [{ ...entry, content: entry.content.replace(/在「([^」]*)」Community 发布了 Artist Post/, "在 WVS 的「$1」社区发了艺人动态") }];
    }
    if (!/^weverse_live_(participant|viewer|replay)_/.test(entry.id)) return [entry];
    if (!entry.id.startsWith("weverse_live_replay_") && !entry.content.startsWith("[Weverse 回放观看]")) return [];
    const live = lives.find(row => entry.id === `weverse_live_replay_${row.id}_${characterId}` || entry.id === `weverse_live_viewer_${row.id}_${characterId}`);
    return live ? [{ ...entry, sourceKeys: [`wvs:${live.id}`], shared: false }] : [];
  });
  const namesById = new Map(loadCharacters().map(character => [character.id, character.name]));
  const userName = resolveUserIdentity(undefined, "weverse")?.name || "用户";
  const resolveLiveCharacterName = (id: string) => id.startsWith("user:") ? userName : namesById.get(id) || "艺人";
  for (const live of lives) {
    if (!live || live.status !== "ended") continue;
    const community = communities.find(row => row.id === live.communityId);
    const names = (id: string) => community?.memberProfiles?.[id]?.displayName?.trim()
      || resolveLiveCharacterName(id);
    entries.push(...buildWeverseLiveMemory(live, characterId, community?.name || "Weverse 社区", names));
  }
  return entries.filter(entry => !options?.afterTimestamp || entry.timestamp > options.afterTimestamp)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export function deleteWeverseLiveMemory(liveId: string): void {
  revokeMemorySources([`wvs:${liveId}`]);
  for (const key of kvKeysWithPrefix(WEV_EVENT_PREFIX)) {
    const characterId = key.slice(WEV_EVENT_PREFIX.length);
    const next = loadEventsByKey(key).filter(e => e.id !== `weverse_live_participant_${liveId}_${characterId}` && e.id !== `weverse_live_viewer_${liveId}_${characterId}` && e.id !== `weverse_live_replay_${liveId}_${characterId}`);
    saveEventsByKey(key, next);
  }
}

/** A later replay view, not a live presence or a reply task. */
export function recordWeverseReplaySummary(characterId:string,liveId:string,title:string,summary:string):void {
 upsert(characterId,{id:`weverse_live_replay_${liveId}_${characterId}`,timestamp:new Date().toISOString(),shared:false,sourceKeys:[`wvs:${liveId}`],content:`[Weverse 回放观看] 该角色后来观看了直播《${title}》的整场回放：${summary}`});
}
