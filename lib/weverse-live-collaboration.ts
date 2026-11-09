import { flattenCompletionResult, generateChatCompletion } from "./chat-engine";
import { dispatchChatMessageNotice } from "./chat-notification-events";
import { createOrGetSession, loadChatMessages, pushChatMessage, updateMessageMediaData, type ChatMessage } from "./chat-storage";
import { resolveUserIdentity } from "./settings-storage";
import { weverseLiveAvailability } from "./weverse-live-availability";
import { createWeverseId, loadWeverseState, updateWeverseLive, type WeverseCommunity, type WeverseLive } from "./weverse-storage";

export type WeverseLiveInvite = {
  liveId: string;
  title: string;
  artistId: string;
  userId: string;
  status: "pending" | "accepted" | "declined" | "expired" | "failed";
};

export const WEV_INVITE_UPDATED = "weverse-live-invite-updated";
export const WEV_OPEN_CHAT_LIVE = "weverse-open-live-from-chat";

export function weverseArtists(community: WeverseCommunity) {
  return community.memberCharacterIds.filter(id => !id.startsWith("user:"));
}

export function isPersonalWeverseCommunity(community: WeverseCommunity) {
  return Boolean(community.userIdentityId) && !weverseArtists(community).length;
}

function collaboration(liveId: string, userId: string) {
  const state = loadWeverseState();
  const live = state.lives.find(item => item.id === liveId && !item.official && item.status === "live" && !item.endedAt);
  const community = live && state.communities.find(item => item.id === live.communityId);
  if (!live || !community || !community.userIdentityId || `user:${community.userIdentityId}` !== userId || !weverseArtists(community).length) return null;
  return { live, community, state };
}

export function addWeverseLiveGuest(liveId: string, userId: string, guestId: string, displayName: string) {
  const context = collaboration(liveId, userId);
  if (!context) return false;
  const { live, community, state } = context;
  if (live.activeCharacterIds.includes(guestId)) return true;
  if (guestId === userId) {
    if (state.lives.some(item => !item.official && item.id !== liveId && item.status === "live" && item.activeCharacterIds.includes(userId))) return false;
  } else if (live.hostCharacterIds[0] !== userId || !weverseArtists(community).includes(guestId) || !weverseLiveAvailability(guestId, Date.now(), liveId).free) {
    return false;
  }

  const now = Date.now();
  updateWeverseLive(live.id, {
    activeCharacterIds: [...live.activeCharacterIds, guestId],
    hostCharacterIds: [...new Set([...live.hostCharacterIds, guestId])],
    participantPresence: [...live.participantPresence, { characterId: guestId, joinedAt: now, joinedVia: "invitation" }],
    viewerPresence: live.viewerPresence.map(item => item.characterId === guestId && !item.leftAt ? { ...item, leftAt: now } : item),
    segments: [...live.segments, { id: createWeverseId("wvs_live_system"), characterId: guestId, kind: "system", original: `${displayName} 加入了 Live`, createdAt: now }],
  });
  return true;
}

export function removeWeverseLiveGuest(liveId: string, userId: string, displayName: string) {
  const live = collaboration(liveId, userId)?.live;
  if (!live || live.hostCharacterIds[0] === userId || !live.activeCharacterIds.includes(userId)) return;
  const now = Date.now();
  updateWeverseLive(live.id, {
    activeCharacterIds: live.activeCharacterIds.filter(id => id !== userId),
    participantPresence: live.participantPresence.map(item => item.characterId === userId && !item.leftAt ? { ...item, leftAt: now } : item),
    segments: [...live.segments, { id: createWeverseId("wvs_live_system"), characterId: userId, kind: "system", original: `${displayName} 退出了合播`, createdAt: now }],
  });
}

function notifyChatReply(message: ChatMessage) {
  refreshChatMessages(message.sessionId);
  if (message.status !== "rejected") dispatchChatMessageNotice({ sessionId: message.sessionId, body: message.content });
}

function refreshChatMessages(sessionId: string) {
  window.dispatchEvent(new CustomEvent("chat-messages-updated", { detail: { sessionId } }));
}

async function decideInCharacter(artistId: string, instruction: string) {
  const session = createOrGetSession(artistId);
  const result = await generateChatCompletion(session, loadChatMessages(session.id), {
    appTags: ["chat", "text"],
    toolsAllowed: false,
    callFormatInstruction: instruction + '\n只输出 JSON {"accepted":true,"reply":"一小句自然的回复"}。accepted 只能是布尔值。',
  });
  const raw = flattenCompletionResult(result);
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("没收到有效回复");
  const reply: { accepted?: boolean; reply?: string } = JSON.parse(match[0]);
  if (typeof reply.accepted !== "boolean") throw new Error("没收到有效回复");
  return { accepted: reply.accepted, reply: typeof reply.reply === "string" ? reply.reply.trim().slice(0, 240) : "" };
}

function inviteData(live: WeverseLive, artistId: string, userId: string): WeverseLiveInvite {
  return { liveId: live.id, title: live.title, artistId, userId, status: "pending" };
}

function markInvite(card: ChatMessage, status: WeverseLiveInvite["status"]) {
  const invite = card.mediaData?.weverseLiveInvite;
  if (!invite) return;
  updateMessageMediaData(card.id, { ...card.mediaData, weverseLiveInvite: { ...invite, status } });
  window.dispatchEvent(new Event(WEV_INVITE_UPDATED));
}

export async function inviteArtistFromLive(liveId: string, userId: string, artistId: string, name: string, onSent?: () => void) {
  const context = collaboration(liveId, userId);
  if (!context || context.live.hostCharacterIds[0] !== userId || !weverseArtists(context.community).includes(artistId)
      || context.live.activeCharacterIds.includes(artistId) || !weverseLiveAvailability(artistId, Date.now(), liveId).free) {
    throw new Error("这位艺人现在无法加入");
  }
  const session = createOrGetSession(artistId);
  if (session.isBlacklisted) throw new Error("这个 Chat 会话已拉黑");
  const previous = loadChatMessages(session.id).some(message =>
    message.mediaData?.weverseLiveInvite?.liveId === liveId && message.mediaData.weverseLiveInvite.status === "pending");
  if (previous) throw new Error("已经发出邀请，等对方回复");
  const card = pushChatMessage({
    sessionId: session.id, role: "user", content: `邀请你来 Weverse 合播：${context.live.title}`,
    mediaType: "weverse_live_invite", mediaData: { weverseLiveInvite: inviteData(context.live, artistId, userId) },
  });
  refreshChatMessages(session.id);
  onSent?.();
  try {
    const decision = await decideInCharacter(artistId,
      "你刚在 Chat 收到对方发来的 Weverse 合播邀请。按你的人设、关系和当前时间决定来不来。reply 是你在 Chat 私下回复对方的一句话。");
    if (!collaboration(liveId, userId)) return markInvite(card, "expired");
    const joined = decision.accepted && addWeverseLiveGuest(liveId, userId, artistId, name);
    markInvite(card, joined ? "accepted" : "declined");
    const reply = decision.accepted && !joined ? "我现在走不开，先不来啦。" : decision.reply || (joined ? "好，我现在过来。" : "这次我先不来啦。");
    notifyChatReply(pushChatMessage({ sessionId: session.id, role: "assistant", content: reply }));
  } catch (error) {
    markInvite(card, "failed");
    throw error;
  }
}

export async function maybeInviteUserFromLive(live: WeverseLive, community: WeverseCommunity) {
  const artistId = live.hostCharacterIds[0];
  const userId = `user:${community.userIdentityId}`;
  if (!artistId || !collaboration(live.id, userId) || Math.random() >= 0.25) return;
  const session = createOrGetSession(artistId);
  if (session.isBlacklisted) return;
  const generated = await decideInCharacter(artistId,
    `你刚在 Weverse 开播，标题是《${live.title}》。按人设在 Chat 私下主动发一句简短自然的话，邀请对方来一起直播。accepted 填 true。`).catch(() => null);
  if (!collaboration(live.id, userId) || !weverseLiveAvailability(artistId, Date.now(), live.id).free) return;
  pushChatMessage({ sessionId: session.id, role: "assistant", content: generated?.reply || "我在直播，你要来一起播吗？" });
  const card = pushChatMessage({
    sessionId: session.id, role: "assistant", content: "Weverse 合作直播邀请",
    mediaType: "weverse_live_invite", mediaData: { weverseLiveInvite: inviteData(live, artistId, userId) },
  });
  notifyChatReply(card);
}

export async function requestWeverseLiveJoin(liveId: string, userId: string, displayName: string) {
  const context = collaboration(liveId, userId);
  const artistId = context?.live.hostCharacterIds[0];
  if (!context || !artistId || artistId === userId || !weverseLiveAvailability(artistId, Date.now(), liveId).free) return false;
  const decision = await decideInCharacter(artistId,
    `你正在主持 Weverse 公开直播《${context.live.title}》。同社区艺人「${displayName}」申请上台合播。按人设和这场公开直播的情境判断是否同意。reply 不会发到直播间。`);
  return decision.accepted && weverseLiveAvailability(artistId, Date.now(), liveId).free && addWeverseLiveGuest(liveId, userId, userId, displayName);
}

export function actOnWeverseLiveInvite(card: ChatMessage, accept: boolean): boolean {
  const invite = card.mediaData?.weverseLiveInvite;
  const actual = loadChatMessages(card.sessionId).find(item => item.id === card.id);
  if (!invite || actual?.role !== "assistant" || actual.mediaData?.weverseLiveInvite?.status !== "pending") return false;
  const context = collaboration(invite.liveId, invite.userId);
  const userIdentity = resolveUserIdentity(undefined, "weverse") ?? resolveUserIdentity();
  if (!context || context.live.hostCharacterIds[0] !== invite.artistId || !weverseLiveAvailability(invite.artistId, Date.now(), invite.liveId).free) {
    markInvite(card, "expired");
    return false;
  }
  if (invite.userId !== `user:${userIdentity?.id || "user"}`) return false;
  if (!accept) {
    markInvite(card, "declined");
    pushChatMessage({ sessionId: card.sessionId, role: "user", content: "我现在有事，先不过来啦。" });
    refreshChatMessages(card.sessionId);
    return true;
  }
  const displayName = context.community.memberProfiles[invite.userId]?.displayName || userIdentity?.name || "我";
  if (!addWeverseLiveGuest(invite.liveId, invite.userId, invite.userId, displayName)) return false;
  markInvite(card, "accepted");
  window.dispatchEvent(new CustomEvent(WEV_OPEN_CHAT_LIVE, { detail: invite.liveId }));
  return true;
}
