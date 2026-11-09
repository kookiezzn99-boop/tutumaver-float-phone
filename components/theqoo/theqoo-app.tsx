"use client";
import {syncBilingualEdit} from "@/lib/bilingual-edit";
import { useGenerationFeedback } from "@/components/generation-feedback";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Bookmark, Check, ChevronRight, ImagePlus, Languages, Menu, Pencil, RefreshCw, Search, Send, Star, Trash2, X } from "lucide-react";
import { ensureSettingsStorageHydrated } from "@/lib/settings-storage";
import { hydrateKvDb } from "@/lib/kv-db";
import { migrateLegacyTheqooTranslator } from "@/lib/theqoo-translation-migration";
import { loadCharacters } from "@/lib/character-storage";
import { createOrGetSession, pushChatMessage } from "@/lib/chat-storage";
import { generateImageFromConfiguredApi } from "@/lib/image-generation-service";
import { isMediaStoreRef, loadMediaObjectUrl } from "@/lib/media-cache-storage";
import { getChatImageFromIndexedDB, saveChatImageToIndexedDB } from "@/lib/chat-asset-storage";
import { dedupeTheqooPosts, generateTheqooCommentFollowups, generateTheqooMoreComments, generateTheqooPosts } from "@/lib/theqoo-engine";
import { translateTheqooTexts } from "@/lib/theqoo-translation";
import { loadTheqooState, saveTheqooState, theqooPostLanguage, type TheqooImage, type TheqooPost, type TheqooState, type TheqooTranslationMode, type TheqooForumLanguage } from "@/lib/theqoo-storage";
import styles from "./theqoo-app.module.css";

type Page = "home" | "detail" | "settings" | "my" | "favorites" | "published" | "translation" | "sources" | "editor";
const CATEGORIES = ["전체", "HOT", "뉴스", "정보", "생활", "잡담", "유머", "뷰티", "영화·방송", "아이돌"];
const CAT_ZH: Record<string, string> = { "전체": "全部", "HOT": "HOT", "뉴스": "新闻", "정보": "资讯", "생활": "生活", "잡담": "闲谈", "유머": "幽默", "뷰티": "美妆", "영화·방송": "影视", "아이돌": "偶像", "이슈": "资讯", "기사·뉴스": "新闻", "드영배": "影视", "일상토크": "生活" };
const LEGACY_CAT: Record<string, string> = { "이슈": "정보", "기사·뉴스": "뉴스", "드영배": "영화·방송", "일상토크": "생활" };
const MODES: TheqooTranslationMode[] = ["original", "repost"];
const MODE_ZH: Record<TheqooTranslationMode, string> = { original: "显示原文", chinese: "中文", folded: "折叠翻译", repost: "搬运风翻译" };
const MODE_KO: Record<TheqooTranslationMode, string> = { original: "原文表示", chinese: "중국어", folded: "접기 번역", repost: "번역본 스타일" };
const CAT_JA: Record<string,string> = {"전체":"すべて","HOT":"HOT","뉴스":"ニュース","정보":"情報","생활":"暮らし","잡담":"雑談","유머":"おもしろ","뷰티":"美容","영화·방송":"映画・テレビ","아이돌":"アイドル","이슈":"情報","일상토크":"暮らし"};
const UI_JA: Record<string,string> = {
 "인터페이스 언어":"表示言語","포럼 언어":"フォーラム言語","한국어 포럼":"韓国語フォーラム","일본어 포럼":"日本語フォーラム","검색":"検索","검색 중…":"検索中…","검색어를 입력하세요":"キーワードで検索","게시글 표시 방식":"投稿の表示方法","게시판":"掲示板","게시하기":"投稿する","글쓰기":"投稿する","글쓴이":"投稿者","내 글":"自分の投稿","다시 생성":"再生成","다음 새로고침 후 더 보기":"次の更新で続きを見る","댓글":"コメント","댓글 더 보기":"コメントをもっと見る","댓글 불러오는 중…":"読み込み中…","댓글을 입력하세요…":"コメントを書く…","마이":"マイページ","무명의 더쿠":"名無しさん","번역 API":"翻訳API","번역 API 테스트":"翻訳APIをテスト","번역 모드 사용":"翻訳モード","번역 설정":"翻訳設定","사진 관리":"画像管理","사진 파일 추가":"画像を追加","생성 이미지":"生成画像","생성 중…":"生成中…","설정":"設定","수정":"編集","스크랩":"保存した投稿","아직 게시글이 없습니다.":"投稿はまだありません。","연동 설정":"連携設定","연락처가 없습니다.":"連絡先がありません。","이 게시글을 삭제할까요?":"この投稿を削除しますか？","이미지 생성":"画像を生成","이미지 재생성 · 중국어 설명":"画像を再生成・中国語の説明","재생성":"再生成","제목 · 중국어":"タイトル・中国語","제목 · 중국어 또는 한국어":"タイトル・中国語または日本語","본문 · 중국어":"本文・中国語","본문 · 중국어 또는 한국어":"本文・中国語または日本語","조회":"閲覧","중국어로 댓글을 입력하세요…":"中国語でコメントを書く…","처리 중…":"処理中…","테스트 중…":"テスト中…","Chat으로 공유":"Chatで共有","WVS 공개 일정 연동":"WVSの公開予定を参照","휴대폰 캘린더 연동":"カレンダーを参照","문자 이미지 · 중국어":"文字画像・中国語","문자 이미지 저장":"文字画像を保存","문자 이미지 추가":"文字画像を追加","AI 이미지 · 중국어 설명":"AI画像・中国語の説明"
};
const newId = () => `tq_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
const imagesOf = (post: TheqooPost): TheqooImage[] => [
  ...(post.imageRef ? [{ id: `legacy_${post.id}`, kind: "generated" as const, mediaRef: post.imageRef, prompt: post.imagePrompt }] : []),
  ...(post.images || []),
];

function ForumImage({ assetId }: { assetId: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let alive = true;
    let result = "";
    (async () => {
      result = (isMediaStoreRef(assetId) ? await loadMediaObjectUrl(assetId) : await getChatImageFromIndexedDB(assetId)) || "";
      if (alive) setUrl(result);
    })();
    return () => {
      alive = false;
      if (result.startsWith("blob:")) URL.revokeObjectURL(result);
    };
  }, [assetId]);
  return url ? <img className={styles.postImage} src={url} alt="帖子配图" /> : null;
}

export function TheqooApp({ onClose, onNotice: externalNotice, visible = true, onBusyChange, onIdle }: {
  onClose: (isBusy?: boolean) => void;
  onNotice?: (message: string) => void;
  visible?: boolean;
  onBusyChange?: (isBusy: boolean) => void;
  onIdle?: () => void;
}) {
  useEffect(()=>{const fn=(e:Event)=>{const n=(e as CustomEvent).detail;if(n.app==='theqoo'){setPostId(n.targetId);setPage('detail');}};window.addEventListener('social-notification-open',fn);return()=>window.removeEventListener('social-notification-open',fn);},[]);
  const [state, setState] = useState<TheqooState>(() => loadTheqooState());
  const [category, setCategory] = useState("전체");
  const [page, setPage] = useState<Page>("home");
  const [postId, setPostId] = useState<string | null>(null);
  const [previousPage, setPreviousPage] = useState<Page>("home");
  const [keyword, setKeyword] = useState("");
  const [busy, setBusy] = useState(false);
  const [moreCommentsPostId, setMoreCommentsPostId] = useState<string | null>(null);
  const moreBusyRef = useRef(false);
  const [generationKind, setGenerationKind] = useState<"refresh" | "search" | null>(null);
  const busyRef = useRef(false);
  const [publishing, setPublishing] = useState(false);
  const [commentBusy, setCommentBusy] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [imageBusy, setImageBusy] = useState(false);
  const { onNotice, feedback: generationFeedback } = useGenerationFeedback(busy ? (generationKind === "search" ? "正在生成搜索结果…" : "正在刷新 theqoo 帖子…") : moreCommentsPostId ? "正在生成更多评论…" : imageBusy ? "正在生成图片…" : publishing ? "正在发布帖子…" : commentBusy ? "正在发布评论…" : null, externalNotice, visible);
  const [imagePrompt, setImagePrompt] = useState("");
  const [textImageDraft, setTextImageDraft] = useState("");
  const [textImageTargetId, setTextImageTargetId] = useState<string | null>(null);
  const [imageTargetId, setImageTargetId] = useState<string | null>(null);
  const [imageEditor, setImageEditor] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [postTranslation, setPostTranslation] = useState<"none" | TheqooForumLanguage>("ko");
  const [shareOpen, setShareOpen] = useState(false);
  const [openTranslations, setOpenTranslations] = useState<Record<string, boolean>>({});
  const [originalDraft,setOriginalDraft]=useState({title:"",body:""});
  const [draft, setDraft] = useState({ category: "잡담", title: "", body: "" });
  const scrollRef = useRef<HTMLElement | null>(null);
  const characters = useMemo(() => loadCharacters(), []);

  useEffect(() => {
    const id = sessionStorage.getItem("theqoo-open-post");
    if (!id) return;
    sessionStorage.removeItem("theqoo-open-post");
    if (state.posts.some(p => p.id === id)) {
      setPostId(id);
      setPreviousPage("home");
      setPage("detail");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = state.posts.find(p => p.id === postId) || null;
  const zh = state.uiLanguage === "zh";
  const ja = state.uiLanguage === "ja";
  const t = (ko: string, cn: string) => zh ? cn : ja ? UI_JA[ko] || cn : ko;
  const categoryLabel = (value: string) => zh ? CAT_ZH[value] || value : ja ? CAT_JA[value] || value : value;
  useEffect(() => saveTheqooState(state), [state]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([hydrateKvDb(), ensureSettingsStorageHydrated()]).then(() => {
      if (!cancelled && migrateLegacyTheqooTranslator()) {
        setState(previous => ({ ...previous, translator: undefined, translationApiMigrated: true }));
      }
    }).catch(() => { /* Keep the legacy data for the next migration attempt. */ });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    const generating = busy || moreCommentsPostId !== null;
    onBusyChange?.(generating);
    if (!visible && !generating) onIdle?.();
  }, [busy, moreCommentsPostId, visible, onBusyChange, onIdle]);

  const visiblePosts = dedupeTheqooPosts(state.posts).filter(p => {
    if (page === "favorites" && !p.favorite) return false;
    if (page === "published" && !p.authoredByUser) return false;
    if (page === "home" && category !== "전체" && (LEGACY_CAT[p.category] || p.category) !== category) return false;
    return true;
  });

  const goBack = () => {
    if (shareOpen) { setShareOpen(false); return; }
    if (imageEditor) { setImageEditor(false); return; }
    if (page === "detail") { setPage(previousPage); return; }
    if (page === "editor") { setPage(selected ? "detail" : "home"); return; }
    if (languageOpen) { setLanguageOpen(false); return; }
    if (["favorites", "published", "translation", "sources"].includes(page)) {
      setPage(["translation", "sources"].includes(page) ? "settings" : "my");
      return;
    }
    if (page === "my") { setPage("settings"); return; }
    if (page === "settings") { setPage("home"); return; }
    onClose(busyRef.current || moreBusyRef.current);
  };

  const openPost = (p: TheqooPost) => {
    setPostId(p.id);
    setPreviousPage(page);
    setPage("detail");
  };
  const updatePost = (id: string, patch: Partial<TheqooPost>) => setState(s => ({ ...s, posts: s.posts.map(p => p.id === id ? { ...p, ...patch } : p) }));
  const replaceImages = (post: TheqooPost, images: TheqooImage[]) => updatePost(post.id, { images, imageRef: undefined, imagePrompt: undefined });

  const generateBatch = async (searchKeyword: string, processPending: boolean) => {
    if (busyRef.current || moreBusyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setGenerationKind(processPending ? "refresh" : "search");
    try {
      const rows = await generateTheqooPosts(
        state.worldBookIds,
        searchKeyword,
        { includeCalendar: state.includeCalendar, includeWeverseSchedule: state.includeWeverseSchedule },
        state.translationEnabled,
        state.posts,
        state.forumLanguage,
      );
      if (!rows.length) throw new Error("这次没有生成帖子，请重试。");

      let followups: Record<string, import("@/lib/theqoo-storage").TheqooComment[]> | null = null;
      let followupsFailed = false;
      if (processPending && state.posts.some(post => post.comments.some(c => c.authoredByUser && c.pendingRefresh))) {
        try {
          followups = await generateTheqooCommentFollowups(state.posts, state.worldBookIds, state.translationEnabled, state.forumLanguage);
        } catch {
          followupsFailed = true;
        }
      }
      const done = followups;
      setState(s => ({
        ...s,
        posts: [
          ...rows,
          ...s.posts.map(post => done && Object.prototype.hasOwnProperty.call(done, post.id)
            ? {
                ...post,
                comments: [
                  ...post.comments.map(c => c.pendingRefresh ? { ...c, pendingRefresh: false } : c),
                  ...done[post.id],
                ],
              }
            : post),
        ],
      }));
      setCategory("전체");
      onNotice?.(processPending ? `已随机刷新 ${rows.length} 条帖子${followupsFailed ? "；旧帖的后续讨论生成失败，下次刷新还会尝试。" : "，待回复评论已处理。"}` : `已按关键词生成 ${rows.length} 条帖子。`);
    } catch (error) {
      onNotice?.(error instanceof Error ? `操作失败：${error.message}` : "刷新失败，请重试。");
    } finally {
      busyRef.current = false;
      setBusy(false);
      setGenerationKind(null);
    }
  };

  const searchPosts = async () => {
    const query = keyword.trim();
    if (!query) {
      onNotice?.("请输入关键词后再搜索。");
      return;
    }
    await generateBatch(query, false);
  };
  const refreshPosts = async () => generateBatch("", true);

  const loadMoreComments = async () => {
    const post = selected;
    if (!post || !post.comments.length || busyRef.current || moreBusyRef.current || post.comments.some(c => c.authoredByUser && c.pendingRefresh)) return;
    moreBusyRef.current = true;
    setMoreCommentsPostId(post.id);
    try {
      const extra = await generateTheqooMoreComments(post, state.worldBookIds, state.translationEnabled, state.forumLanguage);
      setState(s => ({ ...s, posts: s.posts.map(item => item.id === post.id
        ? { ...item, comments: [...item.comments, ...extra] } : item) }));
      onNotice(extra.length ? `已加载 ${extra.length} 条新评论` : "本次没有新的评论");
    } catch (error) {
      onNotice?.(error instanceof Error ? `操作失败：${error.message}` : "评论加载失败，请重试。");
    } finally {
      moreBusyRef.current = false;
      setMoreCommentsPostId(null);
    }
  };

  const openEditor = (p?: TheqooPost) => {
    setOriginalDraft({title:p?.titleOriginal||"",body:p?.bodyOriginal||""});
    setPostTranslation(p ? theqooPostLanguage(p) === "zh" ? "none" : theqooPostLanguage(p) as TheqooForumLanguage : state.translationEnabled ? state.forumLanguage : "none");
    setPostId(p?.id || null);
    setDraft({
      category: LEGACY_CAT[p?.category || ""] || p?.category || "잡담",
      title: p ? p.titleTranslated : "",
      body: p ? p.bodyTranslated : "",
    });
    setPage("editor");
  };

  const saveDraft = async () => {
    if (!draft.title.trim() || !draft.body.trim()) { onNotice?.("请填写标题和正文。"); return; }
    if (publishing) return;
    setPublishing(true);
    try {
      let patch: Pick<TheqooPost, "category" | "titleOriginal" | "titleTranslated" | "bodyOriginal" | "bodyTranslated">;
      if(selected){
        const pair=await syncBilingualEdit({appId:'theqoo',beforeOriginal:[selected.titleOriginal,selected.bodyOriginal],beforeChinese:[selected.titleTranslated,selected.bodyTranslated],original:postTranslation==='none'?[draft.title,draft.body]:[originalDraft.title,originalDraft.body],chinese:[draft.title,draft.body],bilingual:postTranslation!=='none'});
        patch={category:draft.category,titleOriginal:pair.original[0],bodyOriginal:pair.original[1],titleTranslated:pair.chinese[0],bodyTranslated:pair.chinese[1]};
      }else if (postTranslation !== "none") {
        const result = await translateTheqooTexts({ title: draft.title, body: draft.body }, postTranslation);
        patch = {
          category: draft.category,
          titleOriginal: result.title.original,
          titleTranslated: result.title.zh,
          bodyOriginal: result.body.original,
          bodyTranslated: result.body.zh,
        };
      } else {
        const titleText = draft.title.trim();
        const bodyText = draft.body.trim();
        patch = {
          category: draft.category,
          titleOriginal: titleText,
          titleTranslated: titleText,
          bodyOriginal: bodyText,
          bodyTranslated: bodyText,
        };
      }
      if (selected) {
        updatePost(selected.id, { ...patch, forumLanguage: postTranslation === "none" ? "zh" : postTranslation });
        setPage("detail");
      } else {
        const post: TheqooPost = {
          id: newId(),
          ...patch, forumLanguage: postTranslation === "none" ? "zh" : postTranslation,
          views: 0,
          createdAt: Date.now(),
          comments: [],
          favorite: false,
          authoredByUser: true,
          images: [],
        };
        setState(s => ({ ...s, posts: [post, ...s.posts] }));
        setPostId(post.id);
        setPreviousPage("home");
        setPage("detail");
      }
    } catch (error) {
      onNotice?.(error instanceof Error ? `操作失败：${error.message}` : "保存失败，输入已保留，请重试。");
    } finally {
      setPublishing(false);
    }
  };

  const deletePost = () => {
    if (!selected || !window.confirm(t("이 게시글을 삭제할까요?", "确定删除这篇帖子吗？"))) return;
    setState(s => ({ ...s, posts: s.posts.filter(p => p.id !== selected.id) }));
    setPostId(null);
    setPage(previousPage);
  };

  const sendComment = async (event: React.FormEvent) => {
    event.preventDefault();
    const post = selected;
    const input = commentText.trim();
    if (!post || !input || commentBusy || moreBusyRef.current) return;
    setCommentBusy(true);
    try {
      let original = input;
      let translated = input;
      if (state.translationEnabled && theqooPostLanguage(post) !== "zh") {
        const result = await translateTheqooTexts({ comment: input }, theqooPostLanguage(post) === "ja" ? "ja" : "ko");
        original = result.comment.original;
        translated = result.comment.zh;
      }
      const comment = { id: newId(), original, translated, createdAt: Date.now(), authoredByUser: true, pendingRefresh: true };
      setState(s => ({ ...s, posts: s.posts.map(p => p.id === post.id ? { ...p, comments: [...p.comments, comment] } : p) }));
      setCommentText("");
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }));
    } catch (error) {
      onNotice?.(error instanceof Error ? `操作失败：${error.message}` : "评论发布失败，请重试。");
    } finally {
      setCommentBusy(false);
    }
  };

  const deleteComment = (id: string) => {
    if (!selected) return;
    updatePost(selected.id, { comments: selected.comments.filter(c => c.id !== id) });
  };

  const generateImage = async () => {
    const post = selected;
    if (!post || imageBusy) return;
    setImageBusy(true);
    try {
      const description = `韩国匿名论坛 theqoo 帖子配图。图片生成提示词与画面中出现的所有可见文字都必须使用简体中文，禁止出现韩文/韩语文字。排版清楚，不使用真人肖像。${imagePrompt.trim() ? `中文画面描述：${imagePrompt.trim()}` : "以简约论坛信息卡片或氛围配图呈现，不包含具体人物姓名或帖子标题。"}`;
      const result = await generateImageFromConfiguredApi({ description, appId: "theqoo" });
      if (!result) throw new Error("生图没有返回图片，请检查生图设置。");
      const images = imagesOf(post);
      const next = { id: imageTargetId || newId(), kind: "generated" as const, mediaRef: result.mediaRef, prompt: imagePrompt.trim() };
      if (imageTargetId) {
        const index = images.findIndex(image => image.id === imageTargetId);
        if (index >= 0) images[index] = next; else images.push(next);
      } else images.push(next);
      replaceImages(post, images);
      setImageEditor(false);
      setImagePrompt("");
      setImageTargetId(null);
      onNotice("图片已生成并添加");
    } catch (error) {
      onNotice?.(error instanceof Error ? `操作失败：${error.message}` : "生图失败，请重试。");
    } finally {
      setImageBusy(false);
    }
  };

  const addTextImage = async () => {
    const post = selected;
    const text = textImageDraft.trim();
    if (!post || !text || imageBusy) return;
    setImageBusy(true);
    try {
      const image: TheqooImage = { id: textImageTargetId || newId(), kind: "text", originalText: text, translatedText: text };
      const images = imagesOf(post);
      const index = images.findIndex(item => item.id === textImageTargetId);
      if (index >= 0) images[index] = image; else images.push(image);
      replaceImages(post, images);
      setTextImageDraft("");
      setTextImageTargetId(null);
    } finally {
      setImageBusy(false);
    }
  };

  const removeImage = (id: string) => {
    if (!selected) return;
    replaceImages(selected, imagesOf(selected).filter(image => image.id !== id));
  };

  const uploadImage = async (file: File | null) => {
    const post = selected;
    if (!post || !file) return;
    if (!file.type.startsWith("image/")) { onNotice?.("请选择图片文件。"); return; }
    setImageBusy(true);
    try {
      const mediaRef = await saveChatImageToIndexedDB(file);
      replaceImages(post, [...imagesOf(post), { id: newId(), kind: "generated", mediaRef, prompt: "本地图片" }]);
    } catch {
      onNotice?.("图片添加失败，请重试。");
    } finally {
      setImageBusy(false);
    }
  };

  const testTranslationApi = async () => {
    if (!state.translationEnabled) return;
    setPublishing(true);
    try {
      const result = await translateTheqooTexts({ test: "今天吃完饭去散步吧" }, state.forumLanguage);
      onNotice?.(`翻译测试成功：${result.test.original}`);
    } catch (error) {
      onNotice?.(error instanceof Error ? `操作失败：${error.message}` : "翻译测试失败。");
    } finally {
      setPublishing(false);
    }
  };

  const shareTo = (characterId: string) => {
    if (!selected) return;
    const session = createOrGetSession(characterId);
    const snapshot = { ...selected, images: imagesOf(selected).map(image => ({ ...image })), imageRef: undefined, comments: selected.comments.map(c => ({ ...c })), translationMode: state.translationMode, translationEnabled: state.translationEnabled };
    const comments = [...snapshot.comments].sort((a, b) => b.original.length - a.original.length).slice(0, 5);
    const bilingualHeader = state.translationEnabled
      ? `原文标题：${selected.titleOriginal}\n中文标题：${selected.titleTranslated}\n原文正文：${selected.bodyOriginal}\n中文正文：${selected.bodyTranslated}`
      : `标题：${selected.titleTranslated || selected.titleOriginal}\n正文：${selected.bodyTranslated || selected.bodyOriginal}`;
    const context = `[Theqoo 匿名论坛帖子分享快照]\n板块：${CAT_ZH[selected.category] || selected.category}\n${bilingualHeader}\n文字图（中文）：${snapshot.images.filter(image => image.kind === "text").map(image => image.originalText).join("；")}\n评论摘录：${comments.map((c, i) => `\n${i + 1}. ${state.translationEnabled ? `${c.original} / ${c.translated}` : (c.translated || c.original)}${((selected.authoredByUser && c.authoredByUser) || c.authoredByOP) ? "（楼主发言）" : ""}`).join("")}\n（以上是用户发给你看的匿名论坛帖子，评论为发送时选取的代表性留言。不要假设自己知道未展示的评论或发帖者身份。）`;
    const cardTitle = state.translationEnabled ? selected.titleOriginal : (selected.titleTranslated || selected.titleOriginal);
    const cardBody = state.translationEnabled ? selected.bodyOriginal : (selected.bodyTranslated || selected.bodyOriginal);
    pushChatMessage({
      sessionId: session.id,
      role: "user",
      content: context,
      mediaType: "app_card",
      mediaData: {
        appId: "theqoo",
        appName: "theqoo",
        appCardTitle: cardTitle,
        appCardBody: cardBody.slice(0, 110),
        appCardSummary: selected.titleTranslated || selected.titleOriginal,
        appHistoryText: context,
        theqooSnapshot: snapshot,
        appCardLayout: { appLabel: "theqoo", subtitle: CAT_ZH[selected.category] || selected.category, body: cardBody.slice(0, 110), accentColor: "#315777" },
      },
    });
    window.dispatchEvent(new CustomEvent("chat-messages-updated", { detail: { sessionId: session.id } }));
    setShareOpen(false);
    onNotice?.("已分享到 Chat。");
    window.dispatchEvent(new CustomEvent("open-app", { detail: { appId: "chat", sessionId: session.id } }));
  };

  const translation = (key: string, original: string, translated: string) => {
    if (!state.translationEnabled) return <div className={styles.chineseText}>{translated || original}</div>;
    if (state.translationMode === "original") return <div className={styles.original}>{original}</div>;
    return <><div className={styles.original}>{original}</div><div className={styles.repost}>{translated || original}</div></>;
  };

  const title = page === "detail"
    ? categoryLabel(selected?.category || "theqoo")
    : {
        home: "theqoo",
        settings: t("설정", "设置"),
        my: t("마이", "我的"),
        favorites: t("스크랩", "我的收藏"),
        published: t("내 글", "我的发布"),
        translation: t("번역 설정", "翻译设置"),
        sources: t("연동 설정", "内容关联"),
        editor: t("글쓰기", "发帖"),
      }[page];

  return <div className={styles.app}>
      {generationFeedback}
    {languageOpen && <div className={styles.overlay} onClick={() => setLanguageOpen(false)}><section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="theqoo-language-title" onClick={e => e.stopPropagation()}><div className={styles.dialogTitle}><span id="theqoo-language-title">{t("인터페이스 언어", "界面语言")}</span><button type="button" onClick={() => setLanguageOpen(false)} aria-label="关闭"><X size={19}/></button></div><div className={styles.languageChoices}>{([{value:"zh",label:"中文 UI"},{value:"ko",label:"韩语 UI"},{value:"ja",label:"日语 UI"}] as const).map(language => <button type="button" key={language.value} aria-pressed={language.value===state.uiLanguage} onClick={() => {setState(previous => ({...previous,uiLanguage:language.value}));setLanguageOpen(false);}}><span>{language.label}</span>{state.uiLanguage===language.value && <Check size={17}/>}</button>)}</div></section></div>}
    <header className={styles.top}>
      <div className={styles.bar}>
        <button className={styles.back} onClick={goBack} aria-label="返回"><ArrowLeft size={24} /></button>
        {page === "home" && <img className={styles.logoMark} src="/images/theqoo-logo.png" alt="theqoo" />}
        <span className={styles.brand}>{title}</span><span className={styles.spacer} />
        {page === "home" && <>
          <button className={styles.icon} disabled={busy} onClick={() => void refreshPosts()} aria-label="随机刷新并处理评论"><RefreshCw size={21} className={generationKind === "refresh" ? styles.refreshSpin : undefined} /></button>
          <button className={styles.icon} onClick={() => openEditor()} aria-label="发帖"><Pencil size={21} /></button>
          <button className={styles.icon} onClick={() => setLanguageOpen(true)} aria-label="界面语言"><Languages size={22} /></button>
          <button className={styles.icon} onClick={() => setPage("settings")} aria-label="设置"><Menu size={23} /></button>
        </>}
        {page === "detail" && selected && <>
          <button className={styles.icon} onClick={() => updatePost(selected.id, { favorite: !selected.favorite })} aria-label="收藏"><Star size={21} fill={selected.favorite ? "currentColor" : "none"} /></button>
          <button className={styles.icon} onClick={() => setShareOpen(true)} aria-label="分享给 Chat"><Send size={21} /></button>
        </>}
      </div>
      {page === "home" && <div className={styles.searchBand}><div className={styles.searchBox}>
        <Search size={18} />
        <input value={keyword} onChange={e => setKeyword(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && keyword.trim()) void searchPosts(); }} placeholder={t("검색어를 입력하세요", "输入关键词搜索")}/>
        <button disabled={busy || !keyword.trim()} onClick={() => void searchPosts()}>{generationKind === "search" ? t("검색 중…", "搜索中…") : t("검색", "搜索")}</button>
      </div></div>}
    </header>

    {page === "home" && <main className={styles.content}>
      <nav className={styles.categories}>{CATEGORIES.map(c => <button key={c} className={category === c ? styles.active : ""} onClick={() => setCategory(c)}>{categoryLabel(c)}</button>)}</nav>
      <PostList posts={visiblePosts} zh={zh} ja={ja} translationEnabled={state.translationEnabled} onOpen={openPost} empty={t("아직 게시글이 없습니다.", "这里还没有帖子。")} />
    </main>}

    {page === "detail" && selected && <>
      <main className={styles.content} key={selected.id} ref={scrollRef}>
        <section className={styles.detailHead}>
          {translation(`title_${selected.id}`, selected.titleOriginal, selected.titleTranslated)}
          <div className={styles.postMeta}>
            <span>{t("무명의 더쿠", "匿名用户")}</span><span>·</span><span>{new Date(selected.createdAt).toLocaleString(zh ? "zh-CN" : ja ? "ja-JP" : "ko-KR")}</span><span>·</span><span>{t("조회", "浏览量")} {selected.views.toLocaleString()}</span>
            <span className={styles.metaActions}>
              <button onClick={() => { setImagePrompt(""); setImageTargetId(null); setTextImageDraft(""); setTextImageTargetId(null); setImageEditor(true); }} aria-label="图片管理"><ImagePlus size={16} /></button>
              <button onClick={() => openEditor(selected)} aria-label="编辑"><Pencil size={15} /></button>
              <button onClick={deletePost} aria-label="删除"><Trash2 size={15} /></button>
            </span>
          </div>
        </section>
        <section className={styles.body}>
          {translation(`body_${selected.id}`, selected.bodyOriginal, selected.bodyTranslated)}
          {imagesOf(selected).map(image => <div className={styles.inlineImage} key={image.id}>
            {image.kind === "text"
              ? <div className={styles.textImageCard}>{image.translatedText || image.originalText}</div>
              : image.mediaRef ? <ForumImage assetId={image.mediaRef} /> : null}
          </div>)}
        </section>
        <div className={styles.commentsTitle}>{t("댓글", "评论")} {selected.comments.length}</div>
        {selected.comments.map((c, i) => {
          const isOP = selected.authoredByUser ? c.authoredByUser === true : c.authoredByOP === true;
          return <article className={styles.comment} key={c.id}>
            <div className={styles.commentHead}>
              {i + 1}. {t("무명의 더쿠", "匿名用户")}
              {isOP && <span className={styles.opBadge}>{t("글쓴이", "楼主")}</span>}
              <span className={styles.commentTime}>{new Date(c.createdAt).toLocaleTimeString(zh ? "zh-CN" : ja ? "ja-JP" : "ko-KR", { hour: "2-digit", minute: "2-digit" })}</span>
              {c.authoredByUser && <button className={styles.deleteComment} onClick={() => deleteComment(c.id)} aria-label="删除我的评论"><Trash2 size={14} /></button>}
            </div>
            {translation(`comment_${c.id}`, c.original, c.translated)}
          </article>;
        })}
        {selected.comments.length > 0 && <button
          type="button"
          className={styles.loadMoreComments}
          disabled={busy || moreCommentsPostId !== null || selected.comments.some(c => c.authoredByUser && c.pendingRefresh)}
          onClick={() => void loadMoreComments()}
        >{moreCommentsPostId === selected.id
          ? t("댓글 불러오는 중…", "正在加载评论…")
          : selected.comments.some(c => c.authoredByUser && c.pendingRefresh)
            ? t("다음 새로고침 후 더 보기", "下次刷新后可查看更多")
            : t("댓글 더 보기", "查看更多评论")}</button>}
      </main>
      <form className={styles.commentComposer} onSubmit={sendComment}>
        <input value={commentText} onChange={e => setCommentText(e.target.value)} placeholder={state.translationEnabled ? t("댓글을 입력하세요…", "写下评论…中文或韩文都可以") : t("중국어로 댓글을 입력하세요…", "写下评论…关闭翻译时请直接输入中文")} />
        <button type="submit" disabled={commentBusy || moreCommentsPostId !== null || !commentText.trim()} aria-label="发送评论"><Send size={19} /></button>
      </form>
    </>}

    {page === "settings" && <main className={styles.content}><div className={styles.settingsList}>
      <button onClick={() => setPage("my")}><Bookmark size={19} />{t("마이", "我的")}<ChevronRight size={17} /></button>
      <button onClick={() => setPage("translation")}><Languages size={19} />{t("번역 설정", "翻译设置")}<ChevronRight size={17} /></button>
      <button onClick={() => setPage("sources")}><ChevronRight size={19} />{t("연동 설정", "内容关联")}<ChevronRight size={17} /></button>
    </div></main>}

    {page === "my" && <main className={styles.content}><div className={styles.settingsList}>
      <button onClick={() => setPage("favorites")}><Star size={19} />{t("스크랩", "我的收藏")}<ChevronRight size={17} /></button>
      <button onClick={() => setPage("published")}><Pencil size={19} />{t("내 글", "我的发布")}<ChevronRight size={17} /></button>
    </div></main>}

    {(page === "favorites" || page === "published") && <main className={styles.content}>
      <PostList posts={visiblePosts} zh={zh} ja={ja} translationEnabled={state.translationEnabled} onOpen={openPost} empty={t("아직 게시글이 없습니다.", "这里还没有帖子。")} />
    </main>}

    {page === "translation" && <main className={styles.content}>
      <label className={styles.check}><input type="checkbox" checked={state.translationEnabled} onChange={e => setState(s => ({ ...s, translationEnabled: e.target.checked }))} />{t("번역 모드 사용", "开启翻译模式")}</label>
      {!state.translationEnabled && <p className={styles.hint}>{t("번역 모드를 끄면 새 글과 댓글은 중국어만 생성되며 번역 API를 호출하지 않습니다. 표현은 한국 커뮤니티 번역체를 유지합니다.", "关闭后，新帖子直接生成中文，不调用翻译 API；已有帖子及其语言保持不变。")}</p>}
      {state.translationEnabled && <>
        <label className={styles.languageRow}><span>{t("포럼 언어", "论坛语言")}</span><select aria-label="论坛语言" value={state.forumLanguage} onChange={e => setState(previous => ({...previous,forumLanguage:e.target.value as TheqooForumLanguage}))}><option value="ko">{t("한국어 포럼", "韩语论坛")}</option><option value="ja">{t("일본어 포럼", "日语论坛")}</option></select></label>
        <div className={styles.sectionTitle}>{t("게시글 표시 방식", "帖子显示方式")}</div>
        {MODES.map(mode => <button key={mode} className={styles.modeRow} onClick={() => setState(s => ({ ...s, translationMode: mode }))}>{zh ? MODE_ZH[mode] : ja ? mode === "original" ? "原文を表示" : "中国語の翻訳付き" : mode === "original" ? "원문 표시" : MODE_KO[mode]}{state.translationMode === mode && <Check size={18} />}</button>)}
        <div className={styles.sectionTitle}>{t("번역 API", "翻译 API")}</div>
        <p className={styles.hint}>{t("번역 API는 사용자가 직접 작성한 게시글과 댓글만 번역합니다. AI가 생성한 게시글·댓글은 생성 단계에서 바로 현재 언어 모드로 출력되며, 문자 이미지와 이미지 설명은 항상 중국어라 번역 API를 사용하지 않습니다.", "翻译 API 只翻译用户自己发布的帖子和评论。AI 生成的帖子与回复会在生成时直接按当前语言模式输出；文字图和所有生图文字描述始终使用中文，不调用翻译 API。")}</p>
        <p className={styles.hint}>{t("휴대폰 설정 → 구성 연결 → Global Defaults의 번역 API를 사용합니다. Theqoo만 다른 API를 쓰려면 전역 APP 연결 → Theqoo에서 선택하세요.", "统一使用小手机设置 → 配置绑定 → Global Defaults 的翻译 API；若 Theqoo 需要单独使用另一套，在全局APP绑定 → Theqoo 中选择。")}</p>
        <button className={styles.repairButton} disabled={publishing} onClick={() => void testTranslationApi()}>{publishing ? t("테스트 중…", "测试中…") : t("번역 API 테스트", "测试翻译 API")}</button>
        <p className={styles.hint}>{t("번역 API를 따로 선택하지 않으면 전역 텍스트 API를 사용합니다.", "没有单独选择翻译 API 时，沿用全局文本 API。")}</p>
      </>}
    </main>}

    {page === "sources" && <main className={styles.content}>
      <p className={styles.hint}>{t("연동된 일정은 가끔 주제 참고용으로만 사용하며, 모든 새 글에 등장하지 않습니다. 휴대폰 캘린더의 개인 일정은 공개 제보처럼 사용하지 않고, WVS는 공개 일정만 참고합니다.", "关联日程只偶尔作为话题参考，不会每次刷新都出现。手机日历中的私人安排不会被当作公开爆料；仅参考日历中已公开的行程和节点。")}</p>
      <label className={styles.check}><input type="checkbox" checked={state.includeCalendar} onChange={e => setState(s => ({ ...s, includeCalendar: e.target.checked }))} />{t("휴대폰 캘린더 연동", "参考手机日历")}</label>
    </main>}

    {page === "editor" && <main className={styles.content}><div className={styles.editor}>
      <label className={styles.languageRow}><span>发布语言</span><select aria-label="发布语言" value={postTranslation} onChange={e => setPostTranslation(e.target.value as "none" | TheqooForumLanguage)}><option value="ko">翻译为韩语</option><option value="ja">翻译为日语</option><option value="none">不翻译</option></select></label>
      <label>{t("게시판", "分类")}<select value={draft.category} onChange={e => setDraft(s => ({ ...s, category: e.target.value }))}>{CATEGORIES.slice(2).map(c => <option key={c} value={c}>{categoryLabel(c)}</option>)}</select></label>
      <label>标题<input value={draft.title} onChange={e => setDraft(s => ({ ...s, title: e.target.value }))} /></label>
      <label>{selected&&postTranslation!=="none"?"正文 · 中文译文":"正文"}<textarea value={draft.body} onChange={e => setDraft(s => ({ ...s, body: e.target.value }))} /></label>
      <p className={styles.hint}>{postTranslation === "none" ? "按输入原样发布，不调用翻译 API。" : "仅翻译你输入的内容，使用已绑定的翻译 API。"}</p>
      {selected&&postTranslation!=="none"&&<><label>标题 · 原文<input value={originalDraft.title} onChange={e=>setOriginalDraft(d=>({...d,title:e.target.value}))}/></label><label>正文 · 原文<textarea value={originalDraft.body} onChange={e=>setOriginalDraft(d=>({...d,body:e.target.value}))}/></label></>}
      <button className={styles.primary} disabled={publishing} onClick={() => void saveDraft()}>{publishing ? t("처리 중…", "处理中…") : t("게시하기", "保存帖子")}</button>
    </div></main>}

    {shareOpen && selected && <div className={styles.overlay} onClick={() => setShareOpen(false)}><div className={styles.dialog} onClick={e => e.stopPropagation()}>
      <div className={styles.dialogTitle}>{t("Chat으로 공유", "分享到 Chat")}<button onClick={() => setShareOpen(false)}><X size={20} /></button></div>
      <div className={styles.recipientList}>{characters.map(char => <button key={char.id} onClick={() => shareTo(char.id)}>{char.name}<ChevronRight size={17} /></button>)}{!characters.length && <p>{t("연락처가 없습니다.", "还没有角色联系人。")}</p>}</div>
    </div></div>}

    {imageEditor && selected && <div className={styles.overlay} onClick={() => setImageEditor(false)}><div className={styles.dialog} onClick={e => e.stopPropagation()}>
      <div className={styles.dialogTitle}>{t("사진 관리", "配图管理")}<button onClick={() => setImageEditor(false)}><X size={20} /></button></div>
      <div className={styles.imageList}>{imagesOf(selected).map(image => <div className={styles.imageListRow} key={image.id}>
        <span>{image.kind === "text" ? (image.translatedText || image.originalText || "文字图") : image.prompt || t("생성 이미지", "生成图片")}</span>
        {image.kind === "text"
          ? <button onClick={() => { setTextImageTargetId(image.id); setTextImageDraft(image.translatedText || image.originalText || ""); }}>{t("수정", "编辑")}</button>
          : <button onClick={() => { setImageTargetId(image.id); setImagePrompt(image.prompt || ""); }}>{t("재생성", "重生")}</button>}
        <button onClick={() => removeImage(image.id)} aria-label="删除配图"><Trash2 size={15} /></button>
      </div>)}</div>
      <label className={styles.fileButton}>{t("사진 파일 추가", "添加本地图片")}<input type="file" accept="image/*" disabled={imageBusy} onChange={e => { void uploadImage(e.target.files?.[0] || null); e.target.value = ""; }} /></label>
      <label className={styles.imageLabel}>{t("문자 이미지 · 중국어", "添加文字图 · 仅中文")}<textarea value={textImageDraft} onChange={e => setTextImageDraft(e.target.value)} placeholder="输入中文文字图内容；不会调用翻译 API" /></label>
      <button className={styles.secondary} disabled={imageBusy || !textImageDraft.trim()} onClick={() => void addTextImage()}>{textImageTargetId ? t("문자 이미지 저장", "保存文字图") : t("문자 이미지 추가", "添加文字图")}</button>
      <label className={styles.imageLabel}>{imageTargetId ? t("이미지 재생성 · 중국어 설명", "重新生成 · 中文描述") : t("AI 이미지 · 중국어 설명", "AI 生图 · 中文描述")}<textarea value={imagePrompt} onChange={e => setImagePrompt(e.target.value)} placeholder="图片描述请直接写中文；生成图内文字也只使用中文" /></label>
      <button className={styles.primary} disabled={imageBusy} onClick={() => void generateImage()}>{imageBusy ? t("생성 중…", "生成中…") : imageTargetId ? t("다시 생성", "重新生图") : t("이미지 생성", "生成并添加图片")}</button>
    </div></div>}
  </div>;
}

function PostList({ posts, zh, ja, translationEnabled, onOpen, empty }: { posts: TheqooPost[]; zh: boolean; ja: boolean; translationEnabled: boolean; onOpen: (p: TheqooPost) => void; empty: string }) {
  return posts.length ? <>{posts.map(p => {
    const title = zh || !translationEnabled ? (p.titleTranslated || p.titleOriginal) : p.titleOriginal;
    return <button key={p.id} className={styles.postRow} onClick={() => onOpen(p)}>
      <span className={styles.postTitle}>{title}</span>
      <span className={styles.postMeta}>
        <span className={styles.cat}>{zh ? CAT_ZH[p.category] || p.category : ja ? CAT_JA[p.category] || p.category : p.category}</span><span>·</span><span>{zh ? "匿名用户" : ja ? "名無しさん" : "무명의 더쿠"}</span><span>·</span><span>{new Date(p.createdAt).toLocaleDateString(zh ? "zh-CN" : ja ? "ja-JP" : "ko-KR")}</span><span>·</span><span>{zh ? "浏览" : ja ? "閲覧" : "조회"} {p.views.toLocaleString()}</span><span>💬 {p.comments.length}</span>
      </span>
    </button>;
  })}</> : <div className={styles.empty}>{empty}</div>;
}
