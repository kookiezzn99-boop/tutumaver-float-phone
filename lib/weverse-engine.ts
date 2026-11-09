import { LIVE_CHINESE_PROXY_RULE } from "./live-chinese-proxy";
// Public audiences must receive only published dialogue/visible scenes; never host-private calendar or memories.
import { loadSchedulePrompts } from "./schedule-prompt-settings";
import { publicCalendarContext } from "./calendar-public-context";
import { schedulePublicContentSuffix } from "./schedule-public-content";
import { weverseLiveAvailability } from "./weverse-live-availability";
import { worldlineContextForApp } from "./worldline-storage";
import { isPublicCalendarItem } from "./calendar-master";
import { photoStoryReplyContext } from "./photo-story-data";
import { translateContentTexts } from "./content-translation";
import { allowMediaIntent, recordMediaDecision } from "./media-preferences";
import { loadCharacters } from "./character-storage";
import type { Character } from "./character-types";
import { sendLLMRequest, ChatEngineError } from "./chat-engine";
import { assemblePromptPayload, type LLMMessage } from "./llm-prompt-assembler";
import {
  loadApiConfigs,
  loadBindingConfig,
  loadPresets,
  loadRegexes,
  loadWorldBooks,
  resolveBinding,
  resolveUserIdentity,
} from "./settings-storage";
import type { ApiConfig, PresetConfig, RegexConfig, WorldBookConfig } from "./settings-types";
import { loadMemoryConfig } from "./memory-storage";
import { retrieveCoreMemoriesForPrompt, retrieveMemoriesForPrompt } from "./memory-service";
import { formatCoreMemories, formatLongTermMemories } from "./memory-injector";
import { prepareShortTermContext } from "./short-term-assembler";
import { buildCalendarScheduleMarker, loadOwnerCalendarPlans } from "./calendar-storage";
import { getWeekStartIso } from "./calendar-utils";
import { buildCharacterTimeContext, buildGroupTimeContext, getSystemTimeZone, formatZonedChineseDateTime, getZonedWeekday } from "./character-time";
import { loadPhotoLibrary } from "./photo-library-storage";
import { loadWeverseState, type WeverseComment, type WeverseCommunity, type WeversePost, type WeverseSettings, type WeverseLive, type WeverseScheduleItem, type WeverseScheduleType } from "./weverse-storage";

export type WeverseMediaIntent = "selfie" | "portrait" | "group" | "food" | "scenery" | "object" | "pet" | "official" | "other";

export type GeneratedWeverseArtistPost = {
  postType: "text" | "voice";
  original: string;
  translated: string;
  photoDescription?: string;
  mediaIntent?: WeverseMediaIntent;
};

export type GeneratedWeverseNotice = {
  title: string; originalTitle?: string; translatedTitle?: string; original: string; translated: string; photoDescription?: string; mediaIntent?: WeverseMediaIntent; preferredPhotoId?: string;
};

export type GeneratedWeverseOfficialPost = {
  original: string;
  translated: string;
  photoDescription?: string;
  mediaIntent?: WeverseMediaIntent;
  /** 若模型从当前 Official Media Pool 里看中了某张素材，直接返回 photoId。 */
  preferredPhotoId?: string;
};

export type GeneratedWeverseFanPost = {
  displayName: string;
  original: string;
  translated: string;
};

export type GeneratedWeverseFanComment = {
  displayName: string;
  original: string;
  translated: string;
  /** 回复既有评论。 */
  replyToId?: string;
  /** 也可回复“本批前面已经生成的评论”，0-based。 */
  replyToIndex?: number;
};

export type GeneratedWeverseArtistReply = {
  original: string;
  translated: string;
};

export type GeneratedWeverseScheduleItem = {
  contentDescription?: string; publicAt?: string;
  type: WeverseScheduleType;
  visibility: "public" | "internal";
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  location?: string;
  memberCharacterIds: string[];
  calendarSync: boolean;
  busyLevel?: 1 | 2 | 3 | 4;
};

type ResolvedGeneration = {
  character: Character;
  apiConfig: ApiConfig;
  preset: PresetConfig | null;
  regexes: RegexConfig[];
  messages: LLMMessage[];
  userName: string;
};

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1));
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function parseMediaIntent(value: unknown): WeverseMediaIntent | undefined {
  const text = String(value ?? "").trim().toLowerCase();
  return ["selfie", "portrait", "group", "food", "scenery", "object", "pet", "official", "other"].includes(text)
    ? text as WeverseMediaIntent
    : undefined;
}

async function resolveCharacterGeneration(characterId: string, community: WeverseCommunity, options?: { now?: Date; historical?: boolean }): Promise<ResolvedGeneration> {
  const character = loadCharacters().find((item) => item.id === characterId);
  if (!character) throw new ChatEngineError("找不到要生成 Weverse 内容的角色。");

  const bindings = loadBindingConfig();
  const slot = resolveBinding(bindings, character.id, "weverse");
  const apiConfig = loadApiConfigs().find((item) => item.id === slot.apiConfigId) ?? loadApiConfigs()[0];
  if (!apiConfig) throw new ChatEngineError(`未给 ${character.name} 配置可用 API。`);

  const presets = loadPresets();
  let preset = slot.presetId ? presets.find((item) => item.id === slot.presetId) ?? null : null;
  if (!preset) preset = presets.find((item) => item.builtIn) ?? null;

  const allWorldBooks = loadWorldBooks();
  const worldBooks = (slot.worldBookIds || []).map((id) => allWorldBooks.find((item) => item.id === id)).filter(Boolean) as WorldBookConfig[];
  const allRegexes = loadRegexes();
  const regexes = (slot.regexIds || []).map((id) => allRegexes.find((item) => item.id === id)).filter(Boolean) as RegexConfig[];

  const fan=loadWeverseState().userProfile;
  const userIdentity = {id:"wvs-fan",name:fan?.displayName || "我",avatarUrl:fan?.avatarUrl,bio:fan?.bio || "",gender:"",age:"",occupation:"",customSettings:""};
  const userName = userIdentity?.name || "用户";
  const prepared = prepareShortTermContext(character.id, "weverse", { history: [] });
  const memConfig = loadMemoryConfig();
  const historical = options?.historical === true;
  const activationContext = historical ? "" : prepared.wbActivationContext;
  const [memories, coreMemories] = historical ? [[], []] : await Promise.all([
    retrieveMemoriesForPrompt(character.id, activationContext, memConfig).catch(() => []),
    retrieveCoreMemoriesForPrompt(character.id, memConfig).catch(() => []),
  ]);

  const now = options?.now ?? new Date();
  const scheduleSummary = historical ? "" : loadOwnerCalendarPlans("character", character.id).flatMap(p=>p.items).map(i=>`${i.visibility === "public" ? "公开" : "私人，仅本人可知"} ${i.date} ${i.startTime} ${i.title}${schedulePublicContentSuffix(i,now.getTime(),character.timeZone)}`).slice(0,24).join("\n");
  const messages = assemblePromptPayload({
    character,
    history: [],
    preset,
    worldBooks,
    regexes,
    userIdentity,
    appId: "weverse",
    appTags: ["weverse", "public-community"],
    longTermMemories: formatLongTermMemories(memories),
    coreMemories: formatCoreMemories(coreMemories),
    scheduleSummary,
    worldBookActivationContext: activationContext,
    recentBlocks: historical ? [] : prepared.recentBlocks,
    unifiedRecentItems: historical ? [] : prepared.unifiedRecentItems,
    timeContext: buildCharacterTimeContext(character.timeZone, now),
  });

  messages.push({
    role: "system",
    content: [
      `你现在正在使用韩国粉丝社区 Weverse 的「${community.name}」Community。`,
      "这是公开社区，不是私聊。你可以知道自己的私人经历与关系，但公开发言时必须自然判断什么能对粉丝说、什么不能说。",
      "不要主动公开地下关系、私人秘密、只在私聊里成立的称呼或对单一对象的私密承诺。",
      "说话方式必须保持本人语言习惯；不要因为平台是韩国 App 就把所有非韩国角色强行写成同一种口吻。",
      "公开内容可以很日常、短、碎碎念，也可以偶尔认真写长文；不要每次都像营业文案。",
      buildCharacterTimeContext(character.timeZone, now).timeContext,
      "时间相关措辞必须符合上面的真实本地时间。除非上下文真的涉及睡觉、深夜、早起，否则不要习惯性写晚安、早点睡、今天结束了、夜宵等强时间段话术。",
      historical ? "这是历史回填：只写目标时间点当时可能公开发生的普通内容，不要引用目标日期之后才发生的近期记忆、行程或关系变化。" : "",
    ].join("\n"),
  });
  return { character, apiConfig, preset, regexes, messages, userName };
}

export async function generateWeverseArtistPost(characterId: string, community: WeverseCommunity, options?: { now?: Date; historical?: boolean }): Promise<GeneratedWeverseArtistPost> {
  const resolved = await resolveCharacterGeneration(characterId, community, options);
  const prompt: LLMMessage[] = [
    ...resolved.messages,
    {
      role: "system",
      content: [
        "现在生成一条新的 Artist Post。",
        "你可以按角色当时的状态自然选择普通文字动态 text 或语音动态 voice。语音动态表示角色不打字，直接发一段短语音；适合懒得打字、想让粉丝听语气、随口分享或简短问候，但不要为了新功能每次都选 voice。",
        "若 postType=voice，不配图，正文内容就是这段语音的逐字稿；保持口语、自然、适合直接念出来。若 postType=text，则沿用普通 Artist Post。",
        "如果自然适合配图，给出 photoDescription，并用 mediaIntent 标记想发的图是什么：selfie / portrait / group / food / scenery / object / pet / other。若不需要配图，photoDescription 与 mediaIntent 留空。",
        "mediaIntent 只表达内容意图，不决定相册还是生图；图片来源由宿主 Media Resolver 决定。",
        "必须使用角色本人最自然的语言作为 original；若 original 不是简体中文，同时给出忠实自然的简体中文 translated；若 original 本身就是简体中文，两者相同。",
        "只输出 JSON，不要 Markdown。格式：{\"postType\":\"text或voice\",\"mediaReason\":\"真实视觉分享动机，无图留空\",\"original\":\"...\",\"translated\":\"...\",\"photoDescription\":\"...或空\",\"mediaIntent\":\"selfie等或空\"}",
      ].join("\n"),
    },
    { role: "user", content: "现在发一条新的 Weverse Artist Post。" },
  ];
  const raw = await sendLLMRequest(
    resolved.apiConfig,
    resolved.preset,
    prompt,
    resolved.regexes,
    { characterName: `Weverse:${resolved.character.name}`, userName: resolved.userName },
    { appId: "weverse", translationCharacterId: characterId, appTags: ["weverse", "post"], skipOutputRegex: true },
  );
  const parsed = extractJsonObject(raw);
  const original = String(parsed?.original ?? "").trim();
  const translated = String(parsed?.translated ?? original).trim() || original;
  let photoDescription = String(parsed?.photoDescription ?? "").trim();
  if (!options?.historical && photoDescription && !allowMediaIntent("weverse", characterId, photoDescription, String(parsed?.mediaReason || ""))) photoDescription = "";
  if (!options?.historical) recordMediaDecision("weverse", characterId, Boolean(photoDescription), photoDescription);
  const mediaIntent = parseMediaIntent(parsed?.mediaIntent);
  const postType: "text" | "voice" = parsed?.postType === "voice" ? "voice" : "text";
  if (!original && !translated) throw new ChatEngineError("这次没有生成有效 Weverse 内容，请重试。");
  return {
    postType,
    original: original || translated,
    translated: translated || original,
    photoDescription: postType === "voice" ? undefined : photoDescription || undefined,
    mediaIntent: postType === "voice" ? undefined : photoDescription ? mediaIntent || "other" : undefined,
  };
}

function recentCommunityContext(posts: WeversePost[], community: WeverseCommunity): string {
  const recent = posts.filter((post) => post.communityId === community.id).sort((a, b) => b.createdAt - a.createdAt).slice(0, 12);
  if (!recent.length) return "暂无近期帖子。";
  return recent.map((post) => `${post.id} | ${post.authorType}: ${post.originalBody || post.body}`).join("\n");
}

function commentContext(post: WeversePost): string {
  const comments = post.comments.filter((comment) => !comment.deleted).slice(-30);
  if (!comments.length) return "暂无评论。";
  return comments.map((comment) => `${comment.id} | ${comment.authorType} | ${comment.authorName || comment.authorId}: ${comment.originalBody || comment.body}${comment.parentId ? ` | replyTo=${comment.parentId}` : ""}`).join("\n");
}

function communityTimeContext(community: WeverseCommunity, now = new Date()): string {
  const chars = loadCharacters().filter((item) => community.memberCharacterIds.includes(item.id));
  const zone = getSystemTimeZone();
  const time = chars.length ? buildGroupTimeContext(chars.map((item) => ({ name: item.name, timeZone: item.timeZone })), now).timeContext : `当前社区参考时间：${formatZonedChineseDateTime(now, zone)} ${zone}，${getZonedWeekday(now, zone)}`;
  const schedules = publicCalendarContext(now.getTime());
  return [time,schedules.length ? `可参考的公开日程（未来只谈安排，已解锁内容可供讨论）：\n${schedules.join("\n")}` : ""].filter(Boolean).join("\n");
}

function officialMediaContext(community: WeverseCommunity): string {
  const allowed = new Set(community.officialMediaPhotoIds || []);
  if (!allowed.size) return "当前 Official Media Pool 为空。";
  const rows = loadPhotoLibrary().photos
    .filter((photo) => allowed.has(photo.id))
    .slice(0, 40)
    .map((photo) => {
      const summary = [photo.subject, photo.visionSummary, photo.appearance?.scene, ...(photo.visionTags || [])].filter(Boolean).join(" / ");
      return `${photo.id} | ${summary || "未完成描述的官方素材"}`;
    });
  return rows.length ? `当前 Official Media Pool 可用素材：\n${rows.join("\n")}` : "当前 Official Media Pool 暂无可描述素材。";
}

async function resolveCommunityApi(community: WeverseCommunity): Promise<{ apiConfig: ApiConfig; preset: PresetConfig | null; regexes: RegexConfig[] }> {
  const firstMemberId = community.memberCharacterIds.find(id => !id.startsWith("user:"));
  const bindings = loadBindingConfig();
  const slot = firstMemberId ? resolveBinding(bindings, firstMemberId, "weverse") : undefined;
  const apiConfig = loadApiConfigs().find((item) => item.id === slot?.apiConfigId) ?? loadApiConfigs()[0];
  if (!apiConfig) throw new ChatEngineError("没有可用 API，无法生成社区粉丝内容。");
  const presets = loadPresets();
  let preset = slot?.presetId ? presets.find((item) => item.id === slot.presetId) ?? null : null;
  if (!preset) preset = presets.find((item) => item.builtIn) ?? null;
  const allRegexes = loadRegexes();
  const regexes = (slot?.regexIds || []).map((id) => allRegexes.find((item) => item.id === id)).filter(Boolean) as RegexConfig[];
  return { apiConfig, preset, regexes };
}

export async function generateWeverseOfficialPost(
  community: WeverseCommunity,
  posts: WeversePost[],
  options?: { now?: Date; historical?: boolean },
): Promise<GeneratedWeverseOfficialPost> {
  const resolved = await resolveCommunityApi(community);
  const now = options?.now ?? new Date();
  const contextPosts = options?.historical ? posts.filter((post) => post.createdAt <= now.getTime()) : posts;
  const messages: LLMMessage[] = [
    {
      role: "system",
      content: [
        `你正在运营 Weverse 的「${community.name}」Official Account：${community.official.displayName}。`,
        community.official.bio ? `官号简介：${community.official.bio}` : "",
        "这是公开官方账号，不是某个成员本人。不要读取、暗示或泄露任何成员私聊、私人关系、地下恋或非公开记忆。",
        "本轮生成一条自然的 Official Post。它是社交动态，不是正式 Notice：可以是公开问候、幕后/现场图片分享、活动宣传短文、活动后的感谢等。正式规则、参与说明、长篇通知应交给 Notice，不要在这里写成公告格式。不要凭空宣布回归、演唱会、获奖、事故等重大事实。",
        "韩国 Weverse 社区默认以自然韩语作为 original；若社区语境明显更适合其他语言可以调整。始终同时提供简体中文 translated。",
        communityTimeContext(community, now),
        "时间相关措辞必须符合当前参考时间；除非内容真的涉及睡觉/深夜/早起，否则不要无缘无故写晚安、早点睡、夜宵等。",
        options?.historical ? "这是历史回填。内容必须像目标日期当时已经存在的普通公开记录，不要借用未来才发生的事件。" : "",
        officialMediaContext(community),
        options?.historical ? "历史回填时，只有当媒体池素材描述明确适合目标日期/旧内容时才使用 preferredPhotoId；不要把明显属于现在的素材倒灌到过去。" : "",
        "如果适合配图，给出 photoDescription，并用 mediaIntent 标记：group / portrait / food / scenery / object / pet / official / other。若上面的 Official Media Pool 有自然吻合的素材，优先围绕其中一张发带图内容并把 preferredPhotoId 填成真实 photoId。Official Post 可以纯文字，但不要为了用图硬写帖子，也不要长期无视已经存在的媒体池。",
        `近期公开社区内容：\n${recentCommunityContext(contextPosts, community)}`,
        "只输出 JSON，不要 Markdown。格式：{\"original\":\"...\",\"translated\":\"...\",\"photoDescription\":\"...或空\",\"mediaIntent\":\"official等或空\",\"preferredPhotoId\":\"photoId或空\"}",
      ].filter(Boolean).join("\n"),
    },
    { role: "user", content: "现在发布一条新的 Official Post。" },
  ];
  const raw = await sendLLMRequest(
    resolved.apiConfig,
    resolved.preset,
    messages,
    resolved.regexes,
    { characterName: `Weverse Official:${community.name}` },
    { appId: "weverse", appTags: ["weverse", "official-post"], skipOutputRegex: true },
  );
  const parsed = extractJsonObject(raw);
  const original = String(parsed?.original ?? "").trim();
  const translated = String(parsed?.translated ?? original).trim() || original;
  const photoDescription = String(parsed?.photoDescription ?? "").trim();
  const mediaIntent = parseMediaIntent(parsed?.mediaIntent);
  const preferredPhotoId = String(parsed?.preferredPhotoId ?? "").trim();
  if (!original && !translated) throw new ChatEngineError("这次没有生成有效 Official 内容，请重试。");
  return {
    original: original || translated,
    translated: translated || original,
    photoDescription: photoDescription || undefined,
    mediaIntent: photoDescription ? mediaIntent || "official" : undefined,
    preferredPhotoId: preferredPhotoId && (community.officialMediaPhotoIds || []).includes(preferredPhotoId) ? preferredPhotoId : undefined,
  };
}


export async function generateWeverseOfficialNotice(
  community: WeverseCommunity,
  contextPosts: WeversePost[],
  options?: { now?: Date; historical?: boolean; opening?: boolean },
): Promise<GeneratedWeverseNotice> {
  const resolved = await resolveCommunityApi(community);
  const now = options?.now ?? new Date();
  const messages: LLMMessage[] = [
    {
      role: "system",
      content: [
        `你正在运营 Weverse 的「${community.name}」官方公告（Notice）系统。`,
        `Official Account：${community.official.displayName}`,
        options?.opening?"本社区尚无公告，优先写社区开通欢迎粉丝或使用规则公告，日期靠近开通时间。":"按已有公开事项选择公告内容，可以是粉丝送信地址说明、活动出席、病休、约束私生行为、取消活动、回归等；无事实依据不编重大变故，不为凑数宣布工作。",
        "Notice 不是普通社交动态。它用于正式说明公开事项，必须有清晰标题和完整信息，语气正式、克制、事实优先。",
        "不要写成社交媒体碎碎念，不要用‘大家今天也辛苦啦’之类互动口吻；不要添加评论区邀请。",
        "可以是公开活动说明、运营通知、公开日程提醒、规则/参与方式、纪念日说明等；不要凭空捏造严重事件或高风险事实。",
        "韩国 Weverse 社区默认以自然韩语作为 original；同时提供简体中文 translated。",
        communityTimeContext(community, now),
        options?.historical ? "这是历史回填：内容必须符合目标日期，不引用未来事件。" : "",
        officialMediaContext(community),
        "如公告天然需要海报/专辑图/活动图，可提供 photoDescription 和 preferredPhotoId；不需要配图则留空。",
        `近期公开社区内容：\n${recentCommunityContext(contextPosts, community)}`,
        "只输出 JSON，不要 Markdown。格式：{\"title\":\"原文标题\",\"originalTitle\":\"原文标题\",\"translatedTitle\":\"中文标题\",\"original\":\"...\",\"translated\":\"...\",\"photoDescription\":\"...或空\",\"mediaIntent\":\"official等或空\",\"preferredPhotoId\":\"photoId或空\"}",
      ].filter(Boolean).join("\n"),
    },
    { role: "user", content: "现在生成一条正式 Weverse Notice。" },
  ];
  const raw = await sendLLMRequest(resolved.apiConfig, resolved.preset, messages, resolved.regexes, { characterName: `Weverse Notice:${community.name}` }, { appId: "weverse", appTags: ["weverse", "official-notice"], skipOutputRegex: true });
  const parsed = extractJsonObject(raw);
  const title = String(parsed?.title ?? "").trim();
  const original = String(parsed?.original ?? "").trim();
  const translated = String(parsed?.translated ?? original).trim() || original;
  const photoDescription = String(parsed?.photoDescription ?? "").trim();
  const mediaIntent = parseMediaIntent(parsed?.mediaIntent);
  const preferredPhotoId = String(parsed?.preferredPhotoId ?? "").trim();
  if (!title || (!original && !translated)) throw new ChatEngineError("这次没有生成有效 Notice，请重试。");
  const originalTitle = String(parsed?.originalTitle || title);
  const translatedTitle = String(parsed?.translatedTitle || "").trim() || (await translateContentTexts([originalTitle], "weverse", undefined, resolved.apiConfig))[0];
  return { title: translatedTitle, originalTitle, translatedTitle, original: original || translated, translated: translated || original, photoDescription: photoDescription || undefined, mediaIntent: photoDescription ? mediaIntent || "official" : undefined, preferredPhotoId: preferredPhotoId && (community.officialMediaPhotoIds || []).includes(preferredPhotoId) ? preferredPhotoId : undefined };
}

function fanLanguageRules(preset: WeverseSettings["fanLanguagePreset"] = "korean_mixed"): string[] {
  const rule = preset === "japanese_mixed"
    ? "普通粉丝内容以自然日语为主，约 60%~75%；其余自然混入韩语、英语、简体中文。"
    : preset === "chinese_mixed"
      ? "普通粉丝内容以简体中文为主，约 60%~75%；其余自然混入韩语、日语、英语。"
      : preset === "english_mixed"
        ? "普通粉丝内容以自然英语为主，约 60%~75%；其余自然混入韩语、日语、简体中文。"
        : preset === "balanced"
          ? "普通粉丝内容在韩语、日语、英语、简体中文之间尽量均衡，但不要机械轮流或强行每批四种语言齐全。"
          : preset === "kr_jp_mixed"
            ? "普通粉丝内容以韩语和日语为主，两者合计约 75%~90%，其余少量英语与简体中文。"
            : "普通粉丝内容明显以自然韩语为主，约 75%~90%；其余少量日语、英语、简体中文。";
  return [
    rule,
    "语言分布是软倾向，不要机械按固定比例排队，也不要为了凑语言而写不自然内容。",
    "每条内容都输出 original 与简体中文 translated；若 original 本身是简体中文，则 translated 与 original 相同。",
  ];
}

function normalizeBilingualItems(value: unknown): Array<{ displayName: string; original: string; translated: string; replyToId?: string; replyToIndex?: number }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    const original = String(item.original ?? item.body ?? "").trim();
    const translated = String(item.translated ?? original).trim() || original;
    if (!original && !translated) return [];
    return [{
      displayName: String(item.displayName ?? "익명팬").trim() || "익명팬",
      original: original || translated,
      translated: translated || original,
      replyToId: String(item.replyToId ?? "").trim() || undefined,
      replyToIndex: Number.isInteger(Number(item.replyToIndex)) && Number(item.replyToIndex) >= 0 ? Number(item.replyToIndex) : undefined,
    }];
  });
}

function activityCounts(activity: WeverseSettings["fanActivity"]): { postRange: string; commentRange: string; maxPosts: number; maxComments: number } {
  if (activity === "quiet") return { postRange: "0~1", commentRange: "0~2", maxPosts: 1, maxComments: 2 };
  if (activity === "lively") return { postRange: "2~4", commentRange: "3~7", maxPosts: 4, maxComments: 7 };
  return { postRange: "1~3", commentRange: "1~5", maxPosts: 3, maxComments: 5 };
}

export async function generateWeverseFanBatch(
  community: WeverseCommunity,
  posts: WeversePost[],
  options?: { activity?: WeverseSettings["fanActivity"]; includePosts?: boolean; targetPost?: WeversePost; now?: Date; historical?: boolean; liveLanguageRule?: string },
): Promise<{ posts: GeneratedWeverseFanPost[]; comments: GeneratedWeverseFanComment[] }> {
  const resolved = await resolveCommunityApi(community);
  const memberNames = community.memberCharacterIds.map(id => liveMemberName(community, id)).join("、");
  const counts = activityCounts(options?.activity || "normal");
  const includePosts = options?.includePosts !== false;
  const targetPost = options?.targetPost;
  const now = options?.now ?? new Date();
  const contextPosts = options?.historical ? posts.filter((post) => post.createdAt <= now.getTime()) : posts;
  const messages: LLMMessage[] = [
    {
      role: "system",
      content: [
        "你在模拟一个真实的 Weverse 粉丝社区里的普通粉丝，不扮演艺人本人。",
        `Community：${community.name}`,
        `成员：${memberNames || "未提供"}`,
        ...fanLanguageRules(loadWeverseState().settings.fanLanguagePreset),
        communityTimeContext(community, now),
        "不要把整批粉丝都写成同一时间段的口吻。除非目标帖子/评论明确涉及睡觉或深夜，否则不要集体说晚安、早点睡、快去睡等。",
        options?.historical ? "这是历史回填：请写成目标日期当时的公开粉丝内容，不要引用未来事件。" : "",
        "粉丝昵称要像真实网络昵称，可用韩文、拉丁字母、少量日文/中文；不要全部叫匿名粉丝。",
        "内容要有轻重差异和不同立场：粉丝自己的生活、追星记录、问答求助、接梗、具体舞台细节、不同审美、温和批评与运营抱怨都可以。不要整批夸奖、期待、催回归，也不要机械凑齐类型或凭空编重大丑闻。评论围绕主帖和已有讨论，自然重复少量梗但不复读模板。",
        "不要编造严重绯闻、违法事件或重大官方消息，不要替艺人本人宣布未发生的官方事项。",
        options?.liveLanguageRule || "",
        `近期社区内容：\n${recentCommunityContext(contextPosts, community)}`,
        targetPost ? `本轮主要给这条帖子增加互动：\n${targetPost.id} | ${targetPost.authorType}: ${targetPost.originalBody || targetPost.body}` : "",
        targetPost ? `现有评论（replyToId 只能引用这里真实存在的评论 id，或留空）：\n${commentContext(targetPost)}` : "",
        includePosts ? `posts 生成 ${counts.postRange} 条；如果这轮没有自然的新粉丝帖，可以为 0。` : "posts 必须为空数组。",
        targetPost ? (targetPost.authorType === "artist" || targetPost.authorType === "official"
          ? `comments 生成 ${counts.commentRange} 条，允许为 0。这个帖子属于艺人/官方评论区：所有粉丝评论都必须是独立顶级评论，禁止粉丝回复粉丝，replyToId 与 replyToIndex 必须留空。艺人/官方回复由另外的角色逻辑处理。`
          : `comments 生成 ${counts.commentRange} 条，允许为 0。默认大多数（至少约 70%）必须是独立顶级评论；只允许少量自然的粉丝互回小楼。不要把本批后续评论全部挂到第一条下面。艺人回复由另一个角色模型处理。`) : "comments 必须为空数组；没有指定目标帖子时，本轮只负责生成 Fan Post。",
        targetPost && (targetPost.authorType === "artist" || targetPost.authorType === "official")
          ? "本轮禁止任何粉丝互回；所有 comments 都不要填写 replyToId / replyToIndex。"
          : "若某条新评论确实需要回复本批前面已经生成的评论，可填 replyToIndex；若回复既有评论则填 replyToId；否则必须留空作为顶级评论。连续多条指向同一个 parent 是不自然的，应避免。",
        "只输出 JSON，不要 Markdown。格式：{\"posts\":[{\"displayName\":\"...\",\"original\":\"...\",\"translated\":\"...\"}],\"comments\":[{\"displayName\":\"...\",\"original\":\"...\",\"translated\":\"...\",\"replyToId\":\"现有评论id或空\",\"replyToIndex\":null或前面评论序号}]}。",
      ].filter(Boolean).join("\n"),
    },
    { role: "user", content: targetPost ? "给这条帖子追加一批自然的粉丝评论。" : "生成这一轮自然的粉丝社区内容。" },
  ];
  const raw = await sendLLMRequest(resolved.apiConfig, resolved.preset, messages, resolved.regexes, { characterName: `Weverse:${community.name}` }, { appId: "weverse", appTags: ["weverse", "fan"], skipOutputRegex: true });
  const parsed = extractJsonObject(raw);
  const fanPosts = normalizeBilingualItems(parsed?.posts).slice(0, counts.maxPosts).map(({ displayName, original, translated }) => ({ displayName, original, translated }));
  const allowedReplyIds = new Set(targetPost?.comments.map((comment) => comment.id) || []);
  const fanRepliesAllowed = !targetPost || (targetPost.authorType !== "artist" && targetPost.authorType !== "official");
  const comments = normalizeBilingualItems(parsed?.comments).slice(0, counts.maxComments).map((item) => ({
    displayName: item.displayName,
    original: item.original,
    translated: item.translated,
    replyToId: fanRepliesAllowed && item.replyToId && allowedReplyIds.has(item.replyToId) ? item.replyToId : undefined,
    replyToIndex: fanRepliesAllowed ? item.replyToIndex : undefined,
  }));
  return { posts: fanPosts, comments };
}

export async function generateWeverseArtistReply(
  characterId: string,
  community: WeverseCommunity,
  post: WeversePost,
  targetComment: WeverseComment,
  options?: { now?: Date; historical?: boolean },
): Promise<GeneratedWeverseArtistReply | null> {
  const resolved = await resolveCharacterGeneration(characterId, community, options);
  const authorLabel = targetComment.authorType === "user" ? "这个用户" : targetComment.authorName || "一位粉丝";
  const raw = await sendLLMRequest(
    resolved.apiConfig,
    resolved.preset,
    [
      ...resolved.messages,
      {
        role: "system",
        content: [
          "现在判断你会不会在公开 Weverse 评论区回复下面这条评论。",
          "回复不是义务。若按你的性格、当前状态、帖子语境并不想回，输出 reply=false；不要为了互动率强行回复。",
          "如果回复，必须像本人真正会打出来的一小段公开评论，可短可玩笑，不要写旁白或动作。",
          "使用你本人自然语言作为 original；若不是简体中文，提供简体中文 translated。",
          "只输出 JSON：{\"reply\":true或false,\"original\":\"...\",\"translated\":\"...\"}",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          photoStoryReplyContext(post.photoStoryContext, characterId),
          `帖子：${post.originalBody || post.body}`,
          `${authorLabel}的评论：${targetComment.originalBody || targetComment.body}`,
        ].join("\n"),
      },
    ],
    resolved.regexes,
    { characterName: `Weverse:${resolved.character.name}`, userName: resolved.userName },
    { appId: "weverse", appTags: ["weverse", "comment-reply"], skipOutputRegex: true },
  );
  const parsed = extractJsonObject(raw);
  if (parsed?.reply === false || String(parsed?.reply).toLowerCase() === "false") return null;
  const original = String(parsed?.original ?? "").trim();
  const translated = String(parsed?.translated ?? original).trim() || original;
  if (!original && !translated) return null;
  return { original: original || translated, translated: translated || original };
}


function scheduleType(value: unknown): WeverseScheduleType {
  const text = String(value ?? "").trim().toLowerCase();
  return ["media","anniversary","performance","recording","shoot","brand","release","other"].includes(text)
    ? text as WeverseScheduleType : "other";
}

function communityCalendarContext(community: WeverseCommunity, now: Date): string {
  const rows: string[] = [];
  const threshold = now.getTime() - 7 * 86400000;
  for (const characterId of community.memberCharacterIds) {
    const character = loadCharacters().find((item) => item.id === characterId);
    const items = loadOwnerCalendarPlans("character", characterId)
      .flatMap((plan) => plan.items)
      .filter((item) => new Date(`${item.date}T${item.endTime || "23:59"}:00`).getTime() >= threshold)
      .sort((a,b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`))
      .slice(0, 16);
    if (!items.length) continue;
    rows.push(`${character?.name || characterId}：${items.map((item) => `${item.date} ${item.startTime}-${item.endTime} ${item.title}${item.contentDescription ? `｜内容底稿：${item.contentDescription}` : ""}${item.location ? ` @${item.location}` : ""}`).join("；")}`);
  }
  return rows.length ? rows.join("\n") : "成员手机日历中暂无可参考的近期工作安排。";
}

export async function generateWeverseScheduleBatch(
  community: WeverseCommunity,
  existing: WeverseScheduleItem[],
  options?: { now?: Date; startDate?: string; endDate?: string; count?: number },
): Promise<GeneratedWeverseScheduleItem[]> {
  const resolved = await resolveCommunityApi(community);
  const now = options?.now ?? new Date();
  const identity = community.userIdentityId ? resolveUserIdentity(undefined,"weverse") : null;
  const characters: Array<{id: string; name: string; persona?: string; timeZone?: string}> = loadCharacters().filter(item => community.memberCharacterIds.includes(item.id));
  if (community.userIdentityId) {
    const id = `user:${community.userIdentityId}`;
    const profile = community.memberProfiles[id];
    characters.push({ id, name: profile?.displayName || (identity?.id === community.userIdentityId ? identity.name : community.name), persona: profile?.bio || "", timeZone: getSystemTimeZone() });
  }
  const memberRows = characters.map((item) => `${item.id} = ${item.name}：${(item.persona||"").slice(0,1200)}`).join("\n").slice(0,6000);
  const existingRows = existing
    .filter((item) => item.communityId === community.id)
    .sort((a,b) => a.startsAt-b.startsAt)
    .slice(-24)
    .map((item) => `${new Date(item.startsAt).toISOString()} | ${item.type} | ${item.title}${item.contentDescription ? `｜内容底稿：${item.contentDescription}` : ""} | members=${item.memberCharacterIds.join(",")}`)
    .join("\n") || "暂无 Weverse Schedule 条目。";
  const messages: LLMMessage[] = [
    {
      role: "system",
      content: [
        `为 Weverse「${community.name}」生成日程。`,
        loadSchedulePrompts().weverse,
        "公开日程标题和时间提前可见；contentDescription用一两句写清具体内容，到publicAt解锁，留空按开始时间解锁。location可留空或填发布平台。",
        `参考时间：${now.toISOString()}。成员 ID：\n${memberRows || "无"}`,
        options?.startDate && options?.endDate ? `补充 ${options.startDate} 至 ${options.endDate} 的历史公开日程，参考当时的职业阶段。数量约 ${options.count || 6} 条。` : "补充未来4至6周的少量具体事项，节奏随工作推进自然疏密。",
        "分类：performance舞台/活动，brand品牌/时尚活动，media节目播出/幕后/采访公开，release作品/预告/专辑发布，anniversary纪念节点。visibility统一public。",
        "实际参加的工作calendarSync=true，安排合理准备与通勤，并参考已有占用时段；上线或播出节点calendarSync=false。busyLevel按手机可用程度填1随时回复、2短暂回复、3忙时等待、4无法看手机；发布节点填1。内部工作和私人生活由手机日历管理。",
        worldlineContextForApp("weverse", {publicEvents:true}).slice(0,2400),
        `现有 Weverse Schedule：\n${existingRows}`,
        `成员手机日历参考：\n${communityCalendarContext(community, now)}`,
        "memberCharacterIds 只能使用上面提供的真实 ID；团体共同活动可填多个。",
        `只输出 JSON，不要 Markdown。格式：{"items":[{"visibility":"public","type":"performance","title":"...","contentDescription":"一两句具体看点","publicAt":"","date":"YYYY-MM-DD","startTime":"HH:MM","endTime":"HH:MM","location":"...或空","memberCharacterIds":["真实ID"],"calendarSync":true,"busyLevel":3}]}。只返回有依据的具体事项。`,
      ].join("\n"),
    },
    { role: "user", content: "刷新生成这段时间的 Community Schedule。" },
  ];
  const raw = await sendLLMRequest(resolved.apiConfig, resolved.preset, messages, resolved.regexes, { characterName: `Weverse Schedule:${community.name}` }, { appId: "weverse", appTags: ["weverse","schedule"], skipOutputRegex: true });
  const parsed = extractJsonObject(raw);
  const rawItems = Array.isArray(parsed?.items) ? parsed.items : [];
  const allowed = new Set(community.memberCharacterIds);
  return rawItems.slice(0, options?.count || 12).map((rawItem) => {
    const item = rawItem && typeof rawItem === "object" ? rawItem as Record<string, unknown> : {};
    const date = String(item.date ?? "").trim();
    const startTime = String(item.startTime ?? "").trim();
    const endTime = String(item.endTime ?? "").trim();
    const title = String(item.title ?? "").trim();
    const members = Array.isArray(item.memberCharacterIds) ? item.memberCharacterIds.map(String).filter((id) => allowed.has(id)) : [];
    const type = scheduleType(item.type);
    const visibility: "internal" | "public" = "public";
    const normalizedType: WeverseScheduleType = ["performance", "brand", "anniversary", "release", "media"].includes(type) ? type : "media";
    const calendarSync = item.calendarSync === true;
    return {
      type: normalizedType,
      contentDescription: typeof item.contentDescription === "string" ? item.contentDescription.slice(0,4000) : undefined,
      publicAt: typeof item.publicAt === "string" ? item.publicAt : undefined,
      visibility,
      title,
      date,
      startTime,
      endTime,
      location: String(item.location ?? "").trim() || undefined,
      memberCharacterIds: members.length ? Array.from(new Set(members)) : community.memberCharacterIds.slice(),
      calendarSync,
      busyLevel: calendarSync ? ([1,2,3,4].includes(Number(item.busyLevel)) ? Number(item.busyLevel) as 1|2|3|4 : 3) : 1,
    };
  }).filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.date) && /^\d{2}:\d{2}$/.test(item.startTime) && /^\d{2}:\d{2}$/.test(item.endTime) && Boolean(item.title));
}

export type GeneratedWeverseLiveSegment = {
  kind: "speech" | "action";
  characterId?: string;
  original: string;
  translated?: string;
  replyToCommentIds?: string[];
};

export type GeneratedWeverseLiveComment = {
  displayName: string;
  original: string;
  translated: string;
};

export type GeneratedWeverseLiveArtistComment = {
  characterId: string;
  original: string;
  translated: string;
};

export type GeneratedWeverseLiveRound = {
  shouldStart?: boolean;
  liveType?: "visual" | "voice";
  title?: string;
  segments: GeneratedWeverseLiveSegment[];
  comments: GeneratedWeverseLiveComment[];
  artistComments: GeneratedWeverseLiveArtistComment[];
  viewerJoins: string[];
  viewerLeaves: string[];
  participantJoins: string[];
  participantLeaves: string[];
  shouldEnd: boolean;
  endingReason?: string;
};

function normalizeLiveSegments(value: unknown, allowedIds?: Set<string>, fallbackId?: string, commentIds?: Set<string>): GeneratedWeverseLiveSegment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    const kind: "speech" | "action" = String(item.kind || "").toLowerCase() === "action" ? "action" : "speech";
    const original = String(item.original ?? item.text ?? "").trim();
    const translated = String(item.translated ?? "").trim();
    if (!original) return [];
    const requestedId = String(item.characterId ?? "").trim();
    const characterId = requestedId && (!allowedIds || allowedIds.has(requestedId)) ? requestedId : fallbackId;
    const replyToCommentIds = kind === "speech" && commentIds && Array.isArray(item.replyToCommentIds)
      ? [...new Set(item.replyToCommentIds.filter((id): id is string => typeof id === "string" && commentIds.has(id)))]
      : undefined;
    return [{ kind, characterId, original, translated: kind === "speech" && translated && translated !== original ? translated : undefined, replyToCommentIds }];
  }).slice(0, 10);
}

function normalizeLiveComments(value: unknown): GeneratedWeverseLiveComment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    const original = String(item.original ?? item.body ?? "").trim();
    const translated = String(item.translated ?? original).trim() || original;
    if (!original && !translated) return [];
    return [{
      displayName: String(item.displayName ?? "익명팬").trim() || "익명팬",
      original: original || translated,
      translated: translated || original,
    }];
  }).slice(0, 18);
}

function normalizeLiveArtistComments(value: unknown, validIds: Set<string>, activeIds: Set<string>): GeneratedWeverseLiveArtistComment[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    const characterId = String(item.characterId ?? "").trim();
    if (!characterId || !validIds.has(characterId) || activeIds.has(characterId)) return [];
    const original = String(item.original ?? item.body ?? "").trim();
    const translated = String(item.translated ?? original).trim() || original;
    if (!original && !translated) return [];
    const key = `${characterId}:${original || translated}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ characterId, original: original || translated, translated: translated || original }];
  }).slice(0, 4);
}

function normalizeCharacterIds(value: unknown, validIds: Set<string>, options?: { exclude?: Set<string>; max?: number }): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const raw of value) {
    const id = String(raw ?? "").trim();
    if (!id || !validIds.has(id) || options?.exclude?.has(id) || out.includes(id)) continue;
    out.push(id);
    if (out.length >= (options?.max ?? 3)) break;
  }
  return out;
}

function liveMemberName(community: WeverseCommunity, characterId: string): string {
  const character = loadCharacters().find((item) => item.id === characterId);
  const identity = characterId.startsWith("user:") ? resolveUserIdentity(undefined, "weverse") ?? resolveUserIdentity() : null;
  const publicUserName = identity && `user:${identity.id}` === characterId ? identity.name : "共同社区艺人";
  return community.memberProfiles[characterId]?.displayName?.trim() || character?.name || (characterId.startsWith("user:") ? publicUserName : characterId);
}

function liveCommunityRosterContext(community: WeverseCommunity): string {
  const all = loadCharacters();
  const rows = community.memberCharacterIds.map((characterId) => {
    const character = all.find((item) => item.id === characterId);
    const name = liveMemberName(community, characterId);
    const brief = (character?.briefPersona || character?.personality || character?.persona || "").replace(/\s+/g, " ").trim().slice(0, 700);
    return `- ${characterId} | ${name}${brief ? ` | ${brief}` : ""}`;
  });
  return rows.length ? rows.join("\n") : "（无其他成员）";
}

function liveTranscriptContext(live: WeverseLive, community: WeverseCommunity, now: number): string {
  const segments = live.segments.filter(segment => segment.createdAt <= now).sort((a, b) => a.createdAt - b.createdAt).slice(-18).map((segment) => {
    const kind = segment.kind === "action" ? "动作" : segment.kind === "system" ? "系统" : "发言";
    const who = segment.characterId ? liveMemberName(community, segment.characterId) : "Live";
    return `${segment.kind === "speech" && segment.characterId?.startsWith("user:") ? "用户输入 · " : ""}${kind}[${who}]: ${segment.original}${segment.translated ? ` / ${segment.translated}` : ""}`;
  });
  const comments = live.comments.filter(comment => comment.createdAt <= now).sort((a, b) => a.createdAt - b.createdAt).slice(-24).map((comment) => {
    const type = comment.authorType === "user" ? "用户" : comment.authorType === "artist" ? `艺人 ${comment.authorName}` : comment.authorName;
    return `[${comment.id}] ${comment.authorType === "user" || comment.authorId.startsWith("user:") ? "用户输入 · " : ""}${type}: ${comment.originalBody || comment.body}`;
  });
  return [segments.length ? `最近直播内容：\n${segments.join("\n")}` : "", comments.length ? `最近弹幕：\n${comments.join("\n")}` : ""].filter(Boolean).join("\n\n");
}

async function publicLiveComments(community:WeverseCommunity, visible:string, count:number){
 const cfg=await resolveCommunityApi(community);
 const raw=await sendLLMRequest(cfg.apiConfig,cfg.preset,[{role:'system',content:'你只生成普通观众的直播评论。只知道已经播出的言语、可见画面和公开日历，不知道主播私下行程、心理、地点和未公开项目。不补造信息；可以不知道、问问题或根据可见线索不确定地猜测。只输出JSON {"comments":[{"displayName":"网名","original":"评论","translated":"中文翻译"}]}。'},{role:'user',content:communityTimeContext(community)+(community.chineseProxyInput !== false ? '\n'+LIVE_CHINESE_PROXY_RULE : '')+'\n已播出的片段：'+visible+'\n生成最多'+count+'条评论。'}],cfg.regexes,undefined,{appId:'weverse',skipOutputRegex:true});
 return normalizeLiveComments(extractJsonObject(raw)?.comments).slice(0,count);
}

function liveFormatRules(opening = false, liveType: "visual" | "voice" | "auto" = "visual"): string[] {
  return [
    "这是 Weverse 的成员私人 Live，不是私聊，也不是正式节目主持。角色可以随意聊天、吃饭、推荐歌、等人进来、发呆、准备工作或睡前陪粉丝一会儿。",
    "直播持续多久完全按角色人设与当次情境决定：有人会黏很久，有人活动后台只匆匆播几分钟。不要预设固定轮数。",
    opening
      ? "现在是刚开播阶段。通常先调一下状态、等观众陆续进来、随口说几句；不要一开场就进入高强度问答或大型节目。"
      : "这是直播中途的一小段推进。延续之前的话题与状态，不要像新开一场直播一样重新自我介绍。",
    liveType === "voice"
      ? "这是 Voice Live：前台只有渐变语音舞台、成员头像、当前发言文字气泡与评论，不展示画面环境。所有 segment 必须为 speech，绝对不要输出 action 或任何动作/画面描写。"
      : liveType === "auto"
        ? "本场类型尚未指定。请按角色当时状态自然选择 Video Live（visual）或 Voice Live（voice）；若选择 voice，所有 segment 必须为 speech，绝对不要输出 action 或画面描写。"
        : "这是 Video Live，使用横屏 Live Stage。不要讨论竖屏模板，也不要描述真实视频文件、编码、清晰度等技术细节。",
    "speech 使用该角色本人最自然的语言；若不是简体中文，同时给出简体中文 translated。",
    liveType === "voice" ? "Voice Live 不输出动作。" : "visual 模式下 action 不是必填：只有角色真的发生了新的动作、姿态变化或环境操作时才输出；动作没变化就完全省略，禁止为了凑格式硬写。action 使用省略主语的现场描写，不写‘他/她/角色/姓名……’这类第三人称主语，不加括号，只写简体中文、不做双语。",
    `粉丝留言要像真实直播间：在线人数远高于活跃发言人数，观众里可以有核心粉丝、普通关注者和路人。${fanLanguageRules(loadWeverseState().settings.fanLanguagePreset)[0]}不要人人都像资深粉丝。`,
    opening
      ? "开场留言以轻松即时反应为主，例如终于开播、爱你、今天好帅/可爱、最近吃什么、是不是瘦了胖了、最近在忙什么等；不要一上来全是深度问题。"
      : "中途留言可以逐渐更具体，但仍要混入很短的感叹、路人式发言、造型/吃饭/近况问题，避免所有评论都像采访提纲。",
    "角色不需要回应每条普通观众评论。即使用户发了多条，也可以只看到其中一条、综合回应、完全没看到，或继续自己原本的话题。",
    "同 Community 艺人的评论比普通观众评论更容易被主播注意到，主播通常会回应，但仍然不要机械逐条必回；关系、人设、当时是否看到和正在做什么都可以影响回应。",
    "不要公开地下关系、私人秘密、只在私聊成立的称呼或单一对象的私密承诺。",
  ];
}

export async function generateWeverseLiveOpening(
  characterId: string,
  community: WeverseCommunity,
  options?: { theme?: string; now?: Date; liveType?: "visual" | "voice" | "auto"; opportunistic?: boolean },
): Promise<GeneratedWeverseLiveRound> {
  const now = options?.now ?? new Date();
  const available=weverseLiveAvailability(characterId,now.getTime());
  if(!available.free)throw new ChatEngineError(available.reason);
  const resolved = await resolveCharacterGeneration(characterId, community, { now });
  const theme = String(options?.theme || available.scheduledTheme || "").trim();
  const requestedLiveType = options?.liveType === "voice" || options?.liveType === "visual" ? options.liveType : "auto";
  const raw = await sendLLMRequest(
    resolved.apiConfig,
    resolved.preset,
    [
      ...resolved.messages,
      {
        role: "system",
        content: [
          ...liveFormatRules(true, requestedLiveType),
          (community.memberProfiles[characterId]?.liveStyle || community.liveStyle) ? `直播风格：${(community.memberProfiles[characterId]?.liveStyle || community.liveStyle || "").slice(0,6000)}。作为长期倾向，结合本次主题自然变化。` : "",
          options?.opportunistic ? '这是刷新时的一次随性开播机会。结合本人心情、近期生活和世界线中的直播习惯决定现在是否想播；想播时返回shouldStart:true与开场，不想播时只返回{"shouldStart":false}。' : "按本人状态自然开播，延续世界线中设定的直播习惯。",
          theme ? `用户给了一个软主题：${theme}。这是方向，不是脚本；按人设自然发挥、允许跑题。` : "用户没有指定主题。请结合人设、近期经历、当前时间与状态，自然决定为什么突然开播以及想聊什么。",
          "开场先只让最初开播者自己在 Stage 上，不要立刻安排其他艺人连线。",
          requestedLiveType === "voice" ? "生成本场直播标题、开场的 3~5 个短 speech segment 和 9~14 条初始观众留言。" : "生成本场直播标题、开场的 3~5 个短 segment（以说话为主；visual 模式只有确实出现新动作时才插入 action）和 9~14 条初始观众留言。",
          `每个 segment 都可以带 characterId；当前只能是最初开播者 ${characterId}。`,
          requestedLiveType === "auto" ? "必须返回 liveType，值只能是 visual 或 voice；按人设和当时情境自然选择，不要永远固定一种。" : `liveType 固定为 ${requestedLiveType}。`,
          "只输出 JSON，不要 Markdown。格式：{\"liveType\":\"visual或voice\",\"title\":\"...\",\"segments\":[{\"kind\":\"speech\",\"characterId\":\"角色ID\",\"original\":\"角色原话\",\"translated\":\"中文翻译\"}],\"comments\":[{\"displayName\":\"...\",\"original\":\"...\",\"translated\":\"...\"}],\"shouldEnd\":false}",
        ].join("\n"),
      },
      { role: "user", content: theme ? `现在按这个主题开一场 Live：${theme}` : "现在自然地开一场 Weverse Live。" },
    ],
    resolved.regexes,
    { characterName: `Weverse Live:${resolved.character.name}`, userName: resolved.userName },
    { appId: "weverse", appTags: ["weverse", "live"], skipOutputRegex: true },
  );
  const parsed = extractJsonObject(raw);
  if(options?.opportunistic && parsed?.shouldStart === false)return {shouldStart:false,segments:[],comments:[],artistComments:[],viewerJoins:[],viewerLeaves:[],participantJoins:[],participantLeaves:[],shouldEnd:false};
  const liveType: "visual" | "voice" = requestedLiveType === "auto" ? (parsed?.liveType === "voice" ? "voice" : "visual") : requestedLiveType;
  const allowed = new Set([characterId]);
  const segments = normalizeLiveSegments(parsed?.segments, allowed, characterId).filter((segment) => liveType === "visual" || segment.kind === "speech");
  const comments = await publicLiveComments(community, segments.map(s=>s.original).join("\n"),14).catch(()=>[]);
  const title = String(parsed?.title ?? "").trim() || `${resolved.character.name} Live`;
  if (!segments.length) throw new ChatEngineError("这次没有生成有效 Live 开场，请重试。");
  return { liveType, title, segments, comments, artistComments: [], viewerJoins: [], viewerLeaves: [], participantJoins: [], participantLeaves: [], shouldEnd: false };
}

export async function generateWeverseLiveContinuation(
  characterId: string,
  community: WeverseCommunity,
  live: WeverseLive,
  options?: { userComments?: string[]; now?: Date },
): Promise<GeneratedWeverseLiveRound> {
  const now = options?.now ?? new Date();
  const resolved = await resolveCharacterGeneration(characterId, community, { now });
  const userComments = (options?.userComments || []).map((item) => item.trim()).filter(Boolean).slice(0, 12);
  const validCommunityIds = new Set(community.memberCharacterIds.filter(id => !id.startsWith("user:")));
  const currentActiveIds = new Set((live.activeCharacterIds?.length ? live.activeCharacterIds : [characterId]).filter((id) => validCommunityIds.has(id)));
  currentActiveIds.add(characterId);
  const currentViewerIds = new Set(live.viewerPresence.filter((item) => !item.leftAt && validCommunityIds.has(item.characterId) && !currentActiveIds.has(item.characterId)).map((item) => item.characterId));
  const activeLabel = [...currentActiveIds].map((id) => `${id}(${liveMemberName(community, id)})`).join("、") || `${characterId}(${resolved.character.name})`;
  const userOnStage = live.activeCharacterIds.filter(id => id.startsWith("user:")).map(id => liveMemberName(community, id)).join("、");
  const userHosted = live.hostCharacterIds[0]?.startsWith("user:");
  const viewerLabel = [...currentViewerIds].map((id) => `${id}(${liveMemberName(community, id)})`).join("、") || "无";
  const raw = await sendLLMRequest(
    resolved.apiConfig,
    resolved.preset,
    [
      ...resolved.messages,
      {
        role: "system",
        content: [
          ...liveFormatRules(false, live.liveType),
          community.chineseProxyInput !== false ? LIVE_CHINESE_PROXY_RULE : "",
          (community.memberProfiles[characterId]?.liveStyle || community.liveStyle) ? `直播风格：${(community.memberProfiles[characterId]?.liveStyle || community.liveStyle || "").slice(0,6000)}` : "",
          `本场 Live 标题：${live.title}`,
          live.theme ? `最初的软主题：${live.theme}` : "本场没有预设主题。",
          `这已经是第 ${Math.max(1, live.roundCount + 1)} 段推进。`,
          `当前正在 Stage 连线中的角色：${activeLabel}。`,
          userOnStage ? `由用户亲自扮演的台上艺人：${userOnStage}。只回应其已经公开发送的发言和动作，严禁代写其台词、动作、加入或离开。` : "",
          userHosted ? "本场由用户主持。你负责角色发言和动作，是否结束整场由用户决定，shouldEnd 必须为 false。" : "",
          `当前作为普通艺人观众围观、但没有连线的角色：${viewerLabel}。`,
          "只有同一个 Community 的成员才允许围观、发艺人评论或加入连线；严禁引入其他 Community 的角色。",
          "同 Community 成员清单如下。characterId 必须严格从这些 ID 中选择；简略人设仅用于避免明显 OOC：",
          liveCommunityRosterContext(community),
          "艺人围观和艺人连线是两种不同状态：围观者只能在 artistComments 里留言，不可直接出现在 Stage 发言；只有 activeCharacterIds 或本轮 participantJoins 的角色才能出现在 segments。",
          "艺人活动不是每轮必有。大多数时候可以完全没有 viewerJoins / artistComments / participantJoins。只有按关系、当时空闲程度和直播内容自然时才发生。",
          "允许某个同 Community 成员中途进入直播围观；如果留言，写入 artistComments。艺人评论会在普通评论流里出现，同时被收进独立的‘艺人评论’入口。",
          "允许普通围观艺人随后被主播邀请或自己接入连线：把角色 ID 放进 participantJoins；加入后该角色本轮即可在 segments 里说话。也允许已连线的非最初开播者中途离开，放进 participantLeaves。最初开播者若要离开，应直接 shouldEnd=true，而不是 participantLeaves。",
          live.liveType === "voice" ? "如果 participantJoins 发生，仍然留在同一个语音 Stage，以成员头像和每段 characterId 区分；不要生成动作。" : "如果 participantJoins 发生，不需要视频分屏描述；仍然是同一个文字 Live Stage。多人 Stage 里不要机械轮流说话，谁说几句、谁沉默都按现场自然发生。",
          liveTranscriptContext(live, community, now.getTime()),
          userComments.length ? `用户自上次推进后已经公开发到直播间的评论如下。可能带有共同社区艺人的公开署名，你不必逐条回应：\n${userComments.map((item, index) => `${index + 1}. ${item}`).join("\n")}` : "用户这一轮没有新的公开评论，只是在继续观看。",
          "生成接下来的 2~5 个短 segment 和 7~12 条新普通观众留言。以说话为主；只有确实有新动作时才生成 action。",
          "如果台词确实回复了一条已有评论，segment 的 replyToCommentIds 数组填写真实评论 ID。否则留空。",
          "每个 segment 必须尽量提供 characterId。speech 的 characterId 只能来自当前 Stage 角色或本轮 participantJoins。action 若属于某个角色也给 characterId。",
          "可以生成 0~2 条艺人评论；artistComments 里的角色不能是当前 Stage 角色。主播通常会更容易注意艺人评论并自然回应，但不是强制。",
          "根据角色人设与当前情境判断是否自然到收尾时机。若该下播，shouldEnd=true，并让最后的 segment 自然告别；否则 false。不要因为用户点了继续播放就机械延长，也不要因为已经播了几轮就强制结束。",
          "只输出 JSON，不要 Markdown。格式：{\"segments\":[{\"kind\":\"speech\",\"characterId\":\"角色ID\",\"original\":\"原话\",\"translated\":\"中文\",\"replyToCommentIds\":[]}],\"comments\":[{\"displayName\":\"...\",\"original\":\"...\",\"translated\":\"...\"}],\"artistComments\":[{\"characterId\":\"同社区角色ID\",\"original\":\"艺人原话\",\"translated\":\"中文\"}],\"viewerJoins\":[\"角色ID\"],\"viewerLeaves\":[\"角色ID\"],\"participantJoins\":[\"角色ID\"],\"participantLeaves\":[\"角色ID\"],\"shouldEnd\":true或false,\"endingReason\":\"可空\"}",
        ].filter(Boolean).join("\n"),
      },
      { role: "user", content: userComments.length ? "这些评论已经发在直播间里。结合它们和当前现场，继续这一小段 Live。" : "继续播放下一小段 Live。" },
    ],
    resolved.regexes,
    { characterName: `Weverse Live:${resolved.character.name}`, userName: resolved.userName },
    { appId: "weverse", appTags: ["weverse", "live"], skipOutputRegex: true },
  );
  const parsed = extractJsonObject(raw);

  const primaryHost = live.hostCharacterIds[0] || characterId;
  const participantJoinExclude = new Set(currentActiveIds);
  const participantJoins = normalizeCharacterIds(parsed?.participantJoins, validCommunityIds, { exclude: participantJoinExclude, max: 2 });
  const activeForSegments = new Set([...currentActiveIds, ...participantJoins]);
  const participantLeaveEligible = new Set([...currentActiveIds].filter((id) => id !== primaryHost));
  const participantLeaves = normalizeCharacterIds(parsed?.participantLeaves, participantLeaveEligible, { max: 2 });

  const viewerJoinExclude = new Set([...activeForSegments, ...currentViewerIds]);
  const viewerJoins = normalizeCharacterIds(parsed?.viewerJoins, validCommunityIds, { exclude: viewerJoinExclude, max: 2 });
  const viewerPoolForComments = new Set([...currentViewerIds, ...viewerJoins]);
  for (const id of participantJoins) viewerPoolForComments.delete(id);
  const viewerLeaves = normalizeCharacterIds(parsed?.viewerLeaves, viewerPoolForComments, { max: 2 });

  const suppliedSegments = Array.isArray(parsed?.segments) ? parsed.segments.filter(item => !String(item?.characterId || "").startsWith("user:")) : [];
  const airedCommentIds = new Set(live.comments.filter(comment => comment.createdAt <= now.getTime()).map(comment => comment.id));
  const segments = normalizeLiveSegments(suppliedSegments, activeForSegments, characterId, airedCommentIds).filter((segment) => live.liveType === "visual" || segment.kind === "speech");
  const comments = await publicLiveComments(community, liveTranscriptContext(live, community, now.getTime()),12).catch(()=>[]);
  const artistComments = normalizeLiveArtistComments(parsed?.artistComments, validCommunityIds, activeForSegments)
    .filter((item) => !viewerLeaves.includes(item.characterId))
    .slice(0, 3);
  for (const item of artistComments) {
    if (!currentViewerIds.has(item.characterId) && !viewerJoins.includes(item.characterId)) viewerJoins.push(item.characterId);
  }

  const shouldEnd = !userHosted && (parsed?.shouldEnd === true || String(parsed?.shouldEnd).toLowerCase() === "true");
  const endingReason = String(parsed?.endingReason ?? "").trim() || undefined;
  if (!segments.length && !comments.length && !artistComments.length && !participantJoins.length && !participantLeaves.length) {
    throw new ChatEngineError("这次 Live 没有生成新的内容，请重试。");
  }
  return { segments, comments, artistComments, viewerJoins, viewerLeaves, participantJoins, participantLeaves, shouldEnd, endingReason };
}
