"use client";

import { useAppBack } from "@/lib/back-navigation";
import {deleteWeverseLive} from "@/lib/weverse-storage";
import { formatZonedPromptTimestamp, getSystemTimeZone } from "@/lib/character-time";
import { useGenerationFeedback } from "@/components/generation-feedback";
import { PendingCalendarEvents } from "./calendar/pending-events";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Check, ChevronLeft, HeartPulse, Plus, Trash2, Wand2, X } from "lucide-react";
import { Avatar } from "./ui/primitives";
import { SessionCustomCSS } from "@/components/ui/session-custom-css";
import CSSSchemeBar from "@/components/ui/css-scheme-picker";
import { CALENDAR_CSS_EXAMPLE } from "@/lib/css-examples";
import { kvGet, kvSet, kvRemove } from "@/lib/kv-db";
import { Input } from "./ui/form";
import type { CalendarOwnerType, CalendarScheduleItem, CalendarWeekPlan } from "@/lib/calendar-types";
import {
  CALENDAR_DAYS_PER_PAGE_OPTIONS,
  CALENDAR_THEME_IDS,
  deleteCalendarScheduleItem,
  checkCalendarSyncConflicts,
  deleteLinkedCalendarScheduleItem,
  syncCalendarScheduleItemToCharacters,
  updateLinkedCalendarScheduleItem,
  loadCalendarConfig,
  loadOwnerCalendarPlans,
  saveCalendarConfig,
  upsertCalendarScheduleItem,
  validateScheduleDraft,
} from "@/lib/calendar-storage";
import { createDefaultScheduleDraft, generateCalendarScheduleRange, generateWeeklyCalendarSchedule } from "@/lib/calendar-engine";
import { loadCharacters } from "@/lib/character-storage";
import { loadChatSessions } from "@/lib/chat-storage";
import { resolveUserIdentity } from "@/lib/settings-storage";
import {
  formatIsoDate,
  getWeekStartIso,
  parseIsoDate,
  pickScheduleColorKey,
  sanitizeScheduleEmoji,
} from "@/lib/calendar-utils";
import {
  buildMenstrualDayMap,
  cancelFinishCurrentPeriod,
  cancelCurrentPeriodStart,
  finishCurrentPeriod,
  deleteMenstrualRecord,
  getMenstrualSummary,
  loadMenstrualConfig,
  loadMenstrualRecords,
  saveMenstrualConfig,
  startCurrentPeriod,
  validateMenstrualSettings,
  type MenstrualRecord,
} from "@/lib/menstrual-storage";
import { CalendarMonthPage } from "./calendar/month-page";
import { CalendarDetailPage } from "./calendar/detail-page";
import { CalendarEventEditModal, type CalendarEventDraft } from "./calendar/event-edit-modal";
import { removeWeverseScheduleItemEverywhere, syncCalendarProjectionBackToWeverse } from "@/lib/weverse-schedule-sync";

type OwnerOption = {
  key: string;
  ownerType: CalendarOwnerType;
  ownerId: string;
  name: string;
  avatar?: string | null;
};

const CALENDAR_THEMES: Array<{ id: (typeof CALENDAR_THEME_IDS)[number]; name: string }> = [
  { id: "light", name: "默认" },
  { id: "dark", name: "深色" },
  { id: "cream", name: "奶油" },
  { id: "mint", name: "薄荷" },
  { id: "mist", name: "雾紫" },
  { id: "sakura", name: "樱粉" },
];

function buildOwnerOptions(): OwnerOption[] {
  const options: OwnerOption[] = [];
  const identity = resolveUserIdentity(undefined, "calendar") ?? resolveUserIdentity() ?? null;
  options.push({
    key: "user:me",
    ownerType: "user",
    ownerId: "self",
    name: identity?.name?.trim() || "我",
    avatar: identity?.avatarUrl || null,
  });
  for (const char of loadCharacters()) {
    options.push({
      key: `character:${char.id}`,
      ownerType: "character",
      ownerId: char.id,
      name: char.name,
      avatar: char.avatar,
    });
  }
  return options;
}

type PeriodCareCharacterOption = {
  characterId: string;
  name: string;
  avatar?: string | null;
};

function buildPeriodCareCharacterOptions(): PeriodCareCharacterOption[] {
  const characters = loadCharacters();
  const characterById = new Map(characters.map(char => [char.id, char]));
  const latestSessionByCharacter = new Map<string, ReturnType<typeof loadChatSessions>[number]>();
  for (const session of loadChatSessions()) {
    if (session.isGroup) continue;
    const character = characterById.get(session.contactId);
    if (!character) continue;
    const existing = latestSessionByCharacter.get(session.contactId);
    if (!existing || session.updatedAt > existing.updatedAt) {
      latestSessionByCharacter.set(session.contactId, session);
    }
  }
  return Array.from(latestSessionByCharacter.values())
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(session => {
      const character = characterById.get(session.contactId)!;
      return {
        characterId: character.id,
        name: session.alias || character.name,
        avatar: character.avatar,
      };
    });
}

function formatSimpleDate(dateText: string | null): string {
  if (!dateText) return "待记录";
  const date = parseIsoDate(dateText);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export function PhoneCalendarApp({
  onClose,
  onNotice: externalNotice,
}: {
  onClose: () => void;
  onNotice?: (text: string) => void;
}) {
  const todayIso = formatIsoDate(new Date());
  const [owners, setOwners] = useState<OwnerOption[]>(() => buildOwnerOptions());
  const [selectedKey, setSelectedKey] = useState<string>(() => owners[0]?.key ?? "user:me");
  const [view, setView] = useState<"month" | "detail">("month");
  const [selectedDate, setSelectedDate] = useState<string>(todayIso);
  const [detailKey, setDetailKey] = useState(0);
  const [ownerPlans, setOwnerPlans] = useState<CalendarWeekPlan[]>([]);
  const [config, setConfig] = useState(() => loadCalendarConfig());
  const [menstrualConfig, setMenstrualConfig] = useState(() => loadMenstrualConfig());
  const [menstrualRecords, setMenstrualRecords] = useState<MenstrualRecord[]>(() => loadMenstrualRecords());
  const [showThemePanel, setShowThemePanel] = useState(false);
  const [showDaysPanel, setShowDaysPanel] = useState(false);
  const [showMenstrualSettings, setShowMenstrualSettings] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const { onNotice, feedback: generationFeedback } = useGenerationFeedback(isGenerating ? "正在生成日历行程…" : null, externalNotice);
  const [showGenerateConfirm, setShowGenerateConfirm] = useState(false);
  const [generationPrompt,setGenerationPrompt]=useState("");
  const [generationFromDate, setGenerationFromDate] = useState(() => {
    const start = new Date(); start.setDate(start.getDate() - 7); return formatIsoDate(start);
  });
  const [generationToDate, setGenerationToDate] = useState(() => {
    const end = new Date(); end.setDate(end.getDate() + 28); return formatIsoDate(end);
  });
  const [generationCharacterIds, setGenerationCharacterIds] = useState<string[]>([]);
  const [generationMode, setGenerationMode] = useState<"together" | "separate">("separate");
  const [generationSharedPairs, setGenerationSharedPairs] = useState<string[][]>([]);
  const [generationExistingMode, setGenerationExistingMode] = useState<"supplement" | "replan">("supplement");
  const [syncPickerOpen, setSyncPickerOpen] = useState(false);
  const [syncTargets, setSyncTargets] = useState<string[]>([]);
  const [syncConflictMessage, setSyncConflictMessage] = useState("");
  const [showAutoConfirm, setShowAutoConfirm] = useState(false);
  const [fabMenuOpen, setFabMenuOpen] = useState(false);
  const autoAttemptedRef = useRef<Set<string>>(new Set());
  const [editingItem, setEditingItem] = useState<(CalendarEventDraft & { originalDate?: string }) | null>(null);
  const autoGenerateEnabled = config.autoGenerateEnabled;

  const [menstrualDraft, setMenstrualDraft] = useState<{
    cycleLength: string;
    periodLength: string;
    periodCareEnabled: boolean;
    periodCareCharacterIds: string[];
    periodCareLeadDays: "1" | "2" | "3";
  }>(() => {
    const initial = loadMenstrualConfig();
    return {
      cycleLength: String(initial.cycleLength),
      periodLength: String(initial.periodLength),
      periodCareEnabled: initial.periodCareEnabled,
      periodCareCharacterIds: initial.periodCareCharacterIds,
      periodCareLeadDays: String(initial.periodCareLeadDays) as "1" | "2" | "3",
    };
  });

  const [calendarCustomCss, setCalendarCustomCss] = useState(() =>
    typeof window !== "undefined" ? kvGet("calendar-custom-css") || "" : ""
  );
  const [appliedCalendarCss, setAppliedCalendarCss] = useState(() =>
    typeof window !== "undefined" ? kvGet("calendar-custom-css") || "" : ""
  );
  const handleApplyCalendarCss = () => {
    const trimmed = calendarCustomCss.trim();
    if (trimmed) kvSet("calendar-custom-css", trimmed);
    else kvRemove("calendar-custom-css");
    setAppliedCalendarCss(trimmed);
    window.dispatchEvent(new CustomEvent("calendar-css-updated", { detail: trimmed }));
  };
  // 小卷等外部来源实时更新日历自定义 CSS
  useEffect(() => {
    const onCSSUpdate = (e: Event) => {
      const css = (e as CustomEvent).detail || "";
      setAppliedCalendarCss(css);
      setCalendarCustomCss(css);
    };
    window.addEventListener("calendar-css-updated", onCSSUpdate);
    return () => window.removeEventListener("calendar-css-updated", onCSSUpdate);
  }, []);

  const selectedOwner = useMemo(
    () => owners.find(owner => owner.key === selectedKey) ?? owners[0] ?? null,
    [owners, selectedKey],
  );
  const weekStart = useMemo(() => getWeekStartIso(parseIsoDate(selectedDate)), [selectedDate]);

  const itemsByDate = useMemo(() => {
    const map = new Map<string, CalendarScheduleItem[]>();
    for (const plan of ownerPlans) {
      for (const item of plan.items) {
        const list = map.get(item.date) || [];
        list.push(item);
        map.set(item.date, list);
      }
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.startTime.localeCompare(b.startTime));
    }
    return map;
  }, [ownerPlans]);

  // 经期标注：覆盖月历页 ±1 年范围
  const cycleMap = useMemo(() => {
    if (selectedOwner?.ownerType !== "user") return null;
    const today = parseIsoDate(todayIso);
    const start = formatIsoDate(new Date(today.getFullYear() - 1, today.getMonth(), 1));
    const end = formatIsoDate(new Date(today.getFullYear() + 1, today.getMonth() + 1, 0));
    return buildMenstrualDayMap(start, end, menstrualRecords, menstrualConfig);
  }, [selectedOwner, todayIso, menstrualRecords, menstrualConfig]);

  const menstrualSummary = useMemo(
    () => getMenstrualSummary(menstrualRecords, menstrualConfig, selectedDate),
    [menstrualRecords, menstrualConfig, selectedDate],
  );
  const periodCareCharacterOptions = useMemo(
    () => (showMenstrualSettings ? buildPeriodCareCharacterOptions() : []),
    [showMenstrualSettings],
  );

  useEffect(() => {
    setOwners(buildOwnerOptions());
  }, []);

  const refreshPlans = () => {
    if (!selectedOwner) return;
    setOwnerPlans(loadOwnerCalendarPlans(selectedOwner.ownerType, selectedOwner.ownerId));
  };

  useEffect(() => {
    if (!selectedOwner) return;
    setOwnerPlans(loadOwnerCalendarPlans(selectedOwner.ownerType, selectedOwner.ownerId));
  }, [selectedOwner]);

  // 聊天/工具调用改动日程后刷新
  useEffect(() => {
    const handler = () => {
      if (!selectedOwner) return;
      setOwnerPlans(loadOwnerCalendarPlans(selectedOwner.ownerType, selectedOwner.ownerId));
    };
    window.addEventListener("calendar-updated", handler);
    return () => window.removeEventListener("calendar-updated", handler);
  }, [selectedOwner]);

  // 每周自动生成（仅角色）
  useEffect(() => {
    if (!selectedOwner || !autoGenerateEnabled || selectedOwner.ownerType !== "character" || isGenerating) return;
    const autoKey = `${selectedOwner.ownerType}:${selectedOwner.ownerId}:${weekStart}`;
    if (autoAttemptedRef.current.has(autoKey)) return;
    const existing = loadOwnerCalendarPlans(selectedOwner.ownerType, selectedOwner.ownerId)
      .find(plan => plan.weekStart === weekStart);
    if (existing && existing.items.length > 0) return;
    void (async () => {
      autoAttemptedRef.current.add(autoKey);
      setIsGenerating(true);
      try {
        const result = await generateWeeklyCalendarSchedule(selectedOwner.ownerType, selectedOwner.ownerId, weekStart);
        if (!result.success) { onNotice(`自动生成失败：${result.error || "请重试"}`); return; }
        refreshPlans(); onNotice("已自动生成本周角色日程");
      } catch(error) { onNotice(`自动生成失败：${error instanceof Error ? error.message : String(error)}`); }
      finally { setIsGenerating(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoGenerateEnabled, isGenerating, selectedOwner, weekStart]);

  // ── 事件编辑 ──
  const openNewDraft = (date: string) => {
    const base = createDefaultScheduleDraft(date);
    setEditingItem({
      date: base.date,
      startTime: base.startTime,
      endTime: base.endTime,
      location: base.location,
      title: base.title,
      emoji: base.emoji,
      busyLevel: 1,
    });
  };

  const openEditItem = (item: CalendarScheduleItem) => {
    setEditingItem({
      contentDescription:item.contentDescription,encounterScene:item.encounterScene,visibility:item.visibility,kind:item.kind,publicAt:item.publicAt && /[zZ]|[+-]\d\d:\d\d$/.test(item.publicAt) ? formatZonedPromptTimestamp(new Date(item.publicAt),loadCharacters().find(c=>c.id===selectedOwner?.ownerId)?.timeZone||getSystemTimeZone()).replace(" ","T") : item.publicAt,
      id: item.id,
      date: item.date,
      endDate: item.date,
      originalDate: item.date,
      startTime: item.startTime,
      endTime: item.endTime,
      location: item.location,
      title: item.title,
      emoji: item.emoji || "",
      colorKey: item.colorKey,
      busyLevel: item.busyLevel ?? 1,
      externalSource: item.externalSource,
      externalId: item.externalId,
      sharedGroupId: item.sharedGroupId,
      sharedCharacterIds: item.sharedCharacterIds,
    });
  };

  const handleSaveDraft = () => {
    if (!selectedOwner || !editingItem) return;
    const error = validateScheduleDraft(editingItem);
    if (error) {
      onNotice?.(error);
      return;
    }
    const startDate = editingItem.date;
    const endDate = editingItem.kind==="milestone"?editingItem.date:editingItem.endDate || editingItem.date;
    if (endDate < startDate) {
      onNotice?.("结束日期不能早于开始日期");
      return;
    }
    if (editingItem.sharedGroupId && endDate !== startDate) {
      onNotice?.("已同步的共同日程暂不支持改为跨天；请先调整为单日再保存");
      return;
    }
    if (editingItem.externalSource === "weverse" && endDate !== startDate) {
      onNotice?.("Weverse 同步日程暂时只支持单日日程；请在 Weverse 日历中调整参与成员或日期");
      return;
    }
    const dayCount = Math.round((parseIsoDate(endDate).getTime() - parseIsoDate(startDate).getTime()) / 86400000) + 1;
    if (dayCount > 31) {
      onNotice?.("一次最多创建 31 天的日程");
      return;
    }
    if (editingItem.externalSource === "weverse" && editingItem.externalId) {
      const result = syncCalendarProjectionBackToWeverse(editingItem.externalId, selectedOwner.ownerId, editingItem);
      if (result) {
        setEditingItem(null);
        refreshPlans();
        onNotice?.(result.pending ? "时间有冲突，已存入日历待调整行程" : "日程已保存");
        return;
      }
    }
    const firstWeekStart = getWeekStartIso(parseIsoDate(startDate));
    // 跨周移动：先从原来的周删除
    if (editingItem.id && editingItem.originalDate) {
      const originalWeekStart = getWeekStartIso(parseIsoDate(editingItem.originalDate));
      if (originalWeekStart !== firstWeekStart) {
        deleteCalendarScheduleItem(selectedOwner.ownerType, selectedOwner.ownerId, originalWeekStart, editingItem.id);
      }
    }
    // 多天：第一天沿用原 id（编辑场景），其余每天各生成一条独立日程
    for (let offset = 0; offset < dayCount; offset++) {
      const day = parseIsoDate(startDate);
      day.setDate(day.getDate() + offset);
      const dayIso = formatIsoDate(day);
      upsertCalendarScheduleItem(selectedOwner.ownerType, selectedOwner.ownerId, getWeekStartIso(parseIsoDate(dayIso)), {
        id: offset === 0 ? editingItem.id : undefined,
        date: dayIso,
        startTime: editingItem.startTime,
        endTime: editingItem.endTime,
        location: editingItem.location,
        title: editingItem.title,
        emoji: sanitizeScheduleEmoji(editingItem.emoji),
        contentDescription:editingItem.contentDescription,encounterScene:editingItem.encounterScene,visibility:editingItem.visibility||"private",kind:editingItem.kind||"event",publicAt:editingItem.publicAt,
        source: editingItem.externalSource === "weverse" ? "weverse" : "manual",
        externalSource: editingItem.externalSource,
        externalId: editingItem.externalId,
        sharedGroupId: editingItem.sharedGroupId,
        sharedCharacterIds: editingItem.sharedCharacterIds,
        busyLevel: editingItem.busyLevel ?? 1,
        colorKey: editingItem.colorKey ?? pickScheduleColorKey(editingItem.startTime),
      });
    }
    if (editingItem.sharedGroupId && dayCount === 1) {
      const saved = loadOwnerCalendarPlans(selectedOwner.ownerType, selectedOwner.ownerId)
        .flatMap(plan => plan.items).find(item => item.id === editingItem.id);
      if (saved) updateLinkedCalendarScheduleItem(editingItem.sharedGroupId, saved);
    }
    setEditingItem(null);
    refreshPlans();
    onNotice?.(dayCount > 1 ? `已创建 ${dayCount} 天的日程` : "日程已保存");
  };

  const handleDeleteItem = () => {
    if (!selectedOwner || !editingItem?.id) return;
    const original=loadOwnerCalendarPlans(selectedOwner.ownerType,selectedOwner.ownerId).flatMap(p=>p.items).find(i=>i.id===editingItem.id);
    if(original?.linkedLiveId){deleteWeverseLive(original.linkedLiveId);setEditingItem(null);refreshPlans();onNotice?.("直播回放及关联日程已删除");return;}
    const targetWeekStart = getWeekStartIso(parseIsoDate(editingItem.originalDate || editingItem.date));
    if (editingItem.externalSource === "weverse" && editingItem.externalId) {
      removeWeverseScheduleItemEverywhere(editingItem.externalId);
    } else if (editingItem.sharedGroupId) {
      deleteLinkedCalendarScheduleItem(editingItem.sharedGroupId);
    } else {
      deleteCalendarScheduleItem(selectedOwner.ownerType, selectedOwner.ownerId, targetWeekStart, editingItem.id);
    }
    setEditingItem(null);
    refreshPlans();
    onNotice?.("日程已删除");
  };

  const handleGenerate = async () => {
    if (isGenerating || generationCharacterIds.length < 1 || generationCharacterIds.length > 3) return;
    setShowGenerateConfirm(false);
    setIsGenerating(true);
    try {
    const result = await generateCalendarScheduleRange({
      additionalPrompt:generationPrompt,
      characterIds: generationCharacterIds,
      fromDate: generationFromDate,
      toDate: generationToDate,
      mode: generationMode,
      sharedPairs: generationMode === "together" ? generationSharedPairs : [],
      existingMode: generationExistingMode,
    });
    if (!result.success) {
      onNotice(`生成失败：${result.error || "请重试"}`);
      return;
    }
    refreshPlans();
    onNotice?.(result.generatedCount || result.pendingCount
      ? `已添加 ${result.generatedCount} 条，另有 ${result.pendingCount||0} 条待调整`
      : "AI 本次没有生成值得记录的日程（0 条）");
    } catch(error) { onNotice(`生成失败：${error instanceof Error ? error.message : String(error)}`); }
    finally { setIsGenerating(false); }
  };

  const openGenerateDialog = () => {
    const today = parseIsoDate(todayIso);
    const previousWeekStart = parseIsoDate(getWeekStartIso(today));
    previousWeekStart.setDate(previousWeekStart.getDate() - 7);
    const end = parseIsoDate(getWeekStartIso(today)); end.setDate(end.getDate() + 27);
    setGenerationFromDate(formatIsoDate(previousWeekStart));
    setGenerationToDate(formatIsoDate(end));
    setGenerationCharacterIds(selectedOwner ? [selectedOwner.ownerType==="user"?"user:self":selectedOwner.ownerId] : []);
    setGenerationMode("separate");
    setGenerationSharedPairs([]);
    setGenerationExistingMode("supplement");
    setShowGenerateConfirm(true);
  };

  const handleSyncToSelected = (force = false) => {
    if (!selectedOwner || !editingItem?.id || !syncTargets.length) return;
    const saved = loadOwnerCalendarPlans(selectedOwner.ownerType, selectedOwner.ownerId)
      .flatMap(plan => plan.items).find(item => item.id === editingItem.id);
    if (!saved) { onNotice?.("请先保存该日程，再进行同步"); return; }
    const conflicts = checkCalendarSyncConflicts(saved, syncTargets);
    if (conflicts.length && !force) {
      const descriptions = conflicts.map(conflict => {
        const name = owners.find(owner => owner.ownerId === conflict.ownerId)?.name || "角色";
        return `${name}：${conflict.date} ${conflict.reason === "overlap" ? "时间重叠" : "当天已达 3 条上限"}`;
      });
      setSyncConflictMessage(descriptions.join("\n"));
      return;
    }
    syncCalendarScheduleItemToCharacters(selectedOwner.ownerId, saved, syncTargets);
    setSyncPickerOpen(false);
    setSyncConflictMessage("");
    setSyncTargets([]);
    setEditingItem(null);
    refreshPlans();
    onNotice?.(`已同步给 ${syncTargets.length} 位角色`);
  };

  // ── 经期 ──
  const refreshMenstrual = () => {
    setMenstrualConfig(loadMenstrualConfig());
    setMenstrualRecords(loadMenstrualRecords());
  };

  const openMenstrualSettings = () => {
    setMenstrualDraft({
      cycleLength: String(menstrualConfig.cycleLength),
      periodLength: String(menstrualConfig.periodLength),
      periodCareEnabled: menstrualConfig.periodCareEnabled,
      periodCareCharacterIds: menstrualConfig.periodCareCharacterIds,
      periodCareLeadDays: String(menstrualConfig.periodCareLeadDays) as "1" | "2" | "3",
    });
    setShowMenstrualSettings(true);
  };

  const togglePeriodCareCharacter = (characterId: string) => {
    setMenstrualDraft(prev => {
      const selected = new Set(prev.periodCareCharacterIds);
      if (selected.has(characterId)) selected.delete(characterId);
      else selected.add(characterId);
      return { ...prev, periodCareCharacterIds: Array.from(selected) };
    });
  };

  const handleSaveMenstrualSettings = () => {
    const cycleLength = Number(menstrualDraft.cycleLength);
    const periodLength = Number(menstrualDraft.periodLength);
    const error = validateMenstrualSettings({ cycleLength, periodLength });
    if (error) {
      onNotice?.(error);
      return;
    }
    const availableCharacterIds = new Set(periodCareCharacterOptions.map(option => option.characterId));
    const periodCareCharacterIds = menstrualDraft.periodCareCharacterIds.filter(id => availableCharacterIds.has(id));
    if (menstrualDraft.periodCareEnabled && periodCareCharacterIds.length === 0) {
      onNotice?.("请选择至少一个已有聊天角色");
      return;
    }
    const savedConfig = saveMenstrualConfig({
      ...menstrualConfig,
      cycleLength,
      periodLength,
      periodCareEnabled: menstrualDraft.periodCareEnabled,
      periodCareCharacterIds,
      periodCareLeadDays: Number(menstrualDraft.periodCareLeadDays) as 1 | 2 | 3,
    });
    setMenstrualConfig(savedConfig);
    window.dispatchEvent(new CustomEvent("menstrual-period-care-updated"));
    setShowMenstrualSettings(false);
    onNotice?.("周期设置已保存");
  };

  const canCancelSelectedStart = menstrualSummary.currentPeriodStartDate === selectedDate && !menstrualSummary.todayFinished;
  const canStartSelected = !menstrualSummary.todayStarted && !menstrualSummary.isPeriodActive;
  const canCancelSelectedFinish = menstrualSummary.todayFinished;
  const canFinishSelected =
    menstrualSummary.isPeriodActive &&
    !!menstrualSummary.currentPeriodStartDate &&
    selectedDate >= menstrualSummary.currentPeriodStartDate &&
    !menstrualSummary.todayFinished;

  const cycleStateForSelected = cycleMap?.get(selectedDate) ?? null;
  const cycleSummaryLine = cycleStateForSelected
    ? `周期 · ${cycleStateForSelected.label || cycleStateForSelected.shortLabel}`
    : menstrualSummary.isPeriodActive && menstrualSummary.currentPeriodStartDate
      ? `本次经期从 ${formatSimpleDate(menstrualSummary.currentPeriodStartDate)} 开始`
      : menstrualSummary.latest
        ? null
        : "点「经期来了」开始记录与预测";

  // 详情页经期打卡行（仅用户视图）
  const cyclePanel = selectedOwner?.ownerType === "user" ? (
    <div className="calendar-cycle-line">
      <i className="calendar-cycle-dot" data-type={cycleStateForSelected?.type ?? "period"} aria-hidden="true" />
      <span className="calendar-cycle-line-text">{cycleSummaryLine ?? "周期记录"}</span>
      {canCancelSelectedStart ? (
        <button type="button" className="calendar-mini-btn" data-variant="primary" onClick={() => {
          setMenstrualConfig(cancelCurrentPeriodStart(selectedDate));
          setMenstrualRecords(loadMenstrualRecords());
          onNotice?.("已取消这一天的经期来了");
        }}>撤销来了</button>
      ) : (
        <button type="button" className="calendar-mini-btn" data-variant="primary" disabled={!canStartSelected} onClick={() => {
          setMenstrualConfig(startCurrentPeriod(selectedDate));
          setMenstrualRecords(loadMenstrualRecords());
          onNotice?.("已记录经期来了");
        }}>经期来了</button>
      )}
      {canCancelSelectedFinish ? (
        <button type="button" className="calendar-mini-btn" data-variant="primary" onClick={() => {
          const result = cancelFinishCurrentPeriod(selectedDate);
          if (!result.restored) {
            onNotice?.("这一天还没有记录经期走了");
            return;
          }
          setMenstrualConfig(result.config);
          setMenstrualRecords(result.records);
          onNotice?.("已取消这一天的经期走了");
        }}>撤销走了</button>
      ) : (
        <button type="button" className="calendar-mini-btn" data-variant="ghost" disabled={!canFinishSelected} onClick={() => {
          const result = finishCurrentPeriod(selectedDate);
          if (!result.saved) {
            onNotice?.("请先记录经期来了");
            return;
          }
          setMenstrualConfig(result.config);
          setMenstrualRecords(result.records);
          onNotice?.("已记录经期走了");
        }}>经期走了</button>
      )}
    </div>
  ) : null;

  const ownerStripRef = useRef<HTMLElement>(null);
  const ownerStrip = (
    <section ref={ownerStripRef} className="calendar-owner-strip hide-scrollbar">
      {owners.map(owner => (
        <button
          key={owner.key}
          type="button"
          className="calendar-owner-chip"
          data-active={owner.key === selectedKey ? "true" : undefined}
          onClick={() => {
            setFabMenuOpen(false);
            setSelectedKey(owner.key);
            setSelectedDate(todayIso);
          }}
        >
          <Avatar src={owner.avatar || undefined} name={owner.name} size="md" />
          <span>{owner.name}</span>
        </button>
      ))}
    </section>
  );

  useAppBack(() => {
    if (fabMenuOpen) setFabMenuOpen(false);
    else if (showThemePanel) setShowThemePanel(false);
    else if (showDaysPanel) setShowDaysPanel(false);
    else if (view === "detail") setView("month");
    else onClose();
  }, () => !!document.querySelector(".calendar-app-shell")?.getClientRects().length, 18);

  const openDetail = (date: string) => {
    setSelectedDate(date);
    setDetailKey(k => k + 1);
    setView("detail");
  };

  return (
    <div className="calendar-app-shell" data-calendar-theme={config.theme}>
      {generationFeedback}
      {appliedCalendarCss && <SessionCustomCSS css={appliedCalendarCss} scope=".calendar-app-shell" />}
      <div className="calendar-app">
        {view === "month" ? (
          <CalendarMonthPage
            headerActions={<PendingCalendarEvents/>}
            todayIso={todayIso}
            itemsByDate={itemsByDate}
            cycleMap={cycleMap}
            ownerStrip={ownerStrip}
            onPickDay={openDetail}
            onSwipeOwner={direction => {
              const index = owners.findIndex(owner => owner.key === selectedKey);
              const next = owners[index + direction];
              if (index < 0 || !next) return;
              setFabMenuOpen(false);
              setSelectedKey(next.key);
              requestAnimationFrame(() => {
                const strip = ownerStripRef.current;
                const chip = strip?.querySelector<HTMLElement>('.calendar-owner-chip[data-active="true"]');
                if (!strip || !chip) return;
                const viewport = strip.getBoundingClientRect();
                const target = chip.getBoundingClientRect();
                if (target.left < viewport.left) strip.scrollBy({ left: target.left - viewport.left });
                else if (target.right > viewport.right) strip.scrollBy({ left: target.right - viewport.right });
              });
            }}
            onClose={onClose}
            onOpenTheme={() => setShowThemePanel(true)}
          />
        ) : (
          <CalendarDetailPage
            headerActions={<PendingCalendarEvents/>}
            key={detailKey}
            initialDate={selectedDate}
            todayIso={todayIso}
            itemsByDate={itemsByDate}
            cycleMap={cycleMap}
            cyclePanel={cyclePanel}
            daysPerPage={config.daysPerPage}
            onOpenDaysPicker={() => setShowDaysPanel(true)}
            onOpenCycleSettings={selectedOwner?.ownerType === "user" ? openMenstrualSettings : null}
            onBack={() => setView("month")}
            onSelectedChange={setSelectedDate}
            onEditItem={openEditItem}
          />
        )}

        {fabMenuOpen ? <div className="calendar-fab-backdrop" onClick={() => setFabMenuOpen(false)} /> : null}
        <div className="calendar-fab-stack">
          {fabMenuOpen && selectedOwner ? (
            <div className="calendar-fab-menu" role="menu">
              <button
                type="button"
                className="calendar-fab-menu-item"
                onClick={() => {
                  setFabMenuOpen(false);
                  openNewDraft(view === "detail" ? selectedDate : todayIso);
                }}
              >
                <Plus size={15} />
                新增日程
              </button>
              <button
                type="button"
                className="calendar-fab-menu-item"
                disabled={isGenerating}
                onClick={() => {
                  setFabMenuOpen(false);
                  openGenerateDialog();
                }}
              >
                <Wand2 size={15} />
                {isGenerating ? "生成中…" : "AI 生成日程"}
              </button>
              <button
                type="button"
                className="calendar-fab-menu-item"
                data-on={autoGenerateEnabled ? "true" : undefined}
                onClick={() => {
                  setFabMenuOpen(false);
                  setShowAutoConfirm(true);
                }}
              >
                <Bot size={15} />
                每周自动生成
                <i className="calendar-fab-menu-state">{autoGenerateEnabled ? "已开" : "已关"}</i>
              </button>
            </div>
          ) : null}
          <button
            type="button"
            className="calendar-fab calendar-fab-primary"
            data-loading={isGenerating ? "true" : undefined}
            onClick={() => {
              if (selectedOwner) {
                setFabMenuOpen(prev => !prev);
              } else {
                openNewDraft(view === "detail" ? selectedDate : todayIso);
              }
            }}
            aria-label="日程操作菜单"
            aria-expanded={fabMenuOpen}
          >
            <Plus size={20} style={{ transform: fabMenuOpen ? "rotate(45deg)" : undefined, transition: "transform 0.2s" }} />
          </button>
        </div>
      </div>

      {showThemePanel && (
        <div className="modal-overlay calendar-edit-modal-overlay" onClick={() => setShowThemePanel(false)}>
          <div className="calendar-edit-modal calendar-theme-modal" onClick={e => e.stopPropagation()}>
            <div className="calendar-theme-modal-head">
              <strong>主题</strong>
              <button type="button" onClick={() => setShowThemePanel(false)} className="calendar-icon-btn" aria-label="关闭">
                <X size={16} />
              </button>
            </div>
            <div className="calendar-theme-grid">
              {CALENDAR_THEMES.map(theme => (
                <button
                  key={theme.id}
                  type="button"
                  className="calendar-theme-option"
                  data-active={config.theme === theme.id ? "true" : undefined}
                  onClick={() => {
                    const nextConfig = { ...config, theme: theme.id };
                    setConfig(nextConfig);
                    saveCalendarConfig(nextConfig);
                  }}
                >
                  <span className="calendar-theme-swatch" data-theme-id={theme.id} aria-hidden="true" />
                  <span>{theme.name}</span>
                </button>
              ))}
            </div>

            <div className="calendar-theme-css-label">自定义 CSS</div>
            <textarea
              className="calendar-css-textarea"
              value={calendarCustomCss}
              onChange={e => setCalendarCustomCss(e.target.value)}
              placeholder="/* 输入 CSS 覆盖日历样式... */"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
            <div className="calendar-theme-css-actions">
              <CSSSchemeBar
                target="calendar"
                currentCSS={calendarCustomCss}
                onLoad={setCalendarCustomCss}
                btnStyle={{
                  width: 30,
                  height: 30,
                  border: "none",
                  background: "var(--c-calendar-surface)",
                  color: "var(--c-calendar-ink)",
                }}
                modalVars={{
                  panel: "var(--c-calendar-bg)",
                  border: "var(--c-calendar-surface-2)",
                  text: "var(--c-calendar-ink)",
                  textDim: "var(--c-calendar-sub)",
                  input: "var(--c-calendar-surface)",
                  inputBorder: "var(--c-calendar-surface-2)",
                  accent: "var(--c-calendar-today)",
                }}
              />
              <button type="button" className="calendar-block-btn" data-variant="ghost" onClick={() => setCalendarCustomCss(CALENDAR_CSS_EXAMPLE)}>示例</button>
              <button type="button" className="calendar-block-btn" data-variant="ghost" onClick={() => setCalendarCustomCss("")}>清空</button>
              <button type="button" className="calendar-block-btn" data-variant="primary" onClick={handleApplyCalendarCss}>应用</button>
            </div>
          </div>
        </div>
      )}

      {showDaysPanel && (
        <div className="modal-overlay calendar-edit-modal-overlay" onClick={() => setShowDaysPanel(false)}>
          <div className="calendar-edit-modal calendar-days-modal" onClick={e => e.stopPropagation()}>
            <div className="calendar-theme-modal-head">
              <strong>每页天数</strong>
              <button type="button" onClick={() => setShowDaysPanel(false)} className="calendar-icon-btn" aria-label="关闭">
                <X size={16} />
              </button>
            </div>
            <div className="calendar-days-options">
              {CALENDAR_DAYS_PER_PAGE_OPTIONS.map(n => (
                <button
                  key={n}
                  type="button"
                  className="calendar-days-option"
                  data-active={config.daysPerPage === n ? "true" : undefined}
                  onClick={() => {
                    const nextConfig = { ...config, daysPerPage: n };
                    setConfig(nextConfig);
                    saveCalendarConfig(nextConfig);
                    setShowDaysPanel(false);
                  }}
                >
                  <b>{n}</b>
                  <span>{n === 1 ? "单日" : `${n} 天`}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {editingItem && (
        <CalendarEventEditModal
          draft={editingItem}
          onChange={next => setEditingItem(prev => (prev ? { ...prev, ...next } : next))}
          onSave={handleSaveDraft}
          onDelete={handleDeleteItem}
          showBusyLevel={selectedOwner?.ownerType === "character"}
          onSync={editingItem.id && !editingItem.externalSource && selectedOwner?.ownerType === "character" ? () => {
            setSyncTargets([]);
            setSyncConflictMessage("");
            setSyncPickerOpen(true);
          } : undefined}
          onClose={() => setEditingItem(null)}
        />
      )}

      {syncPickerOpen && selectedOwner && editingItem ? (
        <div className="modal-overlay calendar-edit-modal-overlay" onClick={() => setSyncPickerOpen(false)}>
          <div className="calendar-edit-modal calendar-confirm-dialog calendar-sync-dialog" onClick={event => event.stopPropagation()}>
            <div className="calendar-confirm-title">同步日程给其他角色</div>
            <div className="calendar-confirm-desc">会按当前保存的日期和时间复制日程，不调用 AI。同步副本会关联，之后编辑或删除会一起更新。</div>
            <div className="calendar-sync-target-list">
              {owners.filter(owner => owner.ownerType === "character" && owner.ownerId !== selectedOwner.ownerId).map(owner => (
                <label key={owner.ownerId} className="calendar-sync-target">
                  <input type="checkbox" checked={syncTargets.includes(owner.ownerId)} onChange={() => { setSyncConflictMessage(""); setSyncTargets(prev => prev.includes(owner.ownerId) ? prev.filter(id => id !== owner.ownerId) : [...prev, owner.ownerId]); }} />
                  <Avatar src={owner.avatar || undefined} name={owner.name} size="sm" />
                  <span>{owner.name}</span>
                </label>
              ))}
            </div>
            {syncConflictMessage ? (
              <div className="calendar-sync-conflict">
                <strong>发现冲突</strong>
                <span>{syncConflictMessage}</span>
                <span>仍要同步吗？继续后会保留原有日程，并允许当天超过 3 条。</span>
              </div>
            ) : null}
            <div className="calendar-confirm-footer">
              <button type="button" className="calendar-block-btn" data-variant="ghost" onClick={() => setSyncPickerOpen(false)}>取消</button>
              <button type="button" className="calendar-block-btn" data-variant="primary" disabled={!syncTargets.length} onClick={() => handleSyncToSelected(Boolean(syncConflictMessage))}>
                {syncConflictMessage ? "仍然同步" : "检查并同步"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showMenstrualSettings && (
        <div className="modal-overlay calendar-edit-modal-overlay" onClick={() => setShowMenstrualSettings(false)}>
          <div className="calendar-edit-modal calendar-menstrual-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header" data-ui="modal-header">
              <button onClick={() => setShowMenstrualSettings(false)} className="modal-header-btn modal-header-btn-muted" aria-label="返回">
                <ChevronLeft size={18} />
              </button>
              <span className="modal-header-title">周期设置</span>
              <button onClick={handleSaveMenstrualSettings} className="modal-header-btn modal-header-btn-action" aria-label="保存">
                <Check size={18} />
              </button>
            </div>

            <div className="modal-body hide-scrollbar flex flex-col gap-3 pb-10" data-ui="modal-body">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="menu-desc ml-1">周期长度</label>
                  <Input
                    type="number"
                    min={21}
                    max={60}
                    value={menstrualDraft.cycleLength}
                    onChange={e => setMenstrualDraft(prev => ({ ...prev, cycleLength: e.target.value }))}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="menu-desc ml-1">经期天数</label>
                  <Input
                    type="number"
                    min={2}
                    max={10}
                    value={menstrualDraft.periodLength}
                    onChange={e => setMenstrualDraft(prev => ({ ...prev, periodLength: e.target.value }))}
                  />
                </div>
              </div>

              <div className="calendar-menstrual-care-panel">
                <button
                  type="button"
                  className="calendar-menstrual-care-toggle"
                  data-active={menstrualDraft.periodCareEnabled ? "true" : undefined}
                  onClick={() => setMenstrualDraft(prev => ({ ...prev, periodCareEnabled: !prev.periodCareEnabled }))}
                >
                  <span className="calendar-menstrual-care-toggle-icon">
                    <HeartPulse size={16} />
                  </span>
                  <span className="calendar-menstrual-care-toggle-copy">
                    <strong>让TA关心我的经期</strong>
                    <span>只显示已有聊天会话的角色</span>
                  </span>
                  <span className="calendar-menstrual-pill-switch" aria-hidden="true">
                    <span className="calendar-menstrual-pill-switch-thumb" />
                  </span>
                </button>

                {menstrualDraft.periodCareEnabled ? (
                  <div className="calendar-menstrual-care-body">
                    <div className="calendar-menstrual-care-section">
                      <label className="menu-desc ml-1">提前多久关心</label>
                      <div className="calendar-period-care-lead-row">
                        {(["1", "2", "3"] as const).map(value => (
                          <button
                            key={value}
                            type="button"
                            className="calendar-period-care-lead"
                            data-active={menstrualDraft.periodCareLeadDays === value ? "true" : undefined}
                            onClick={() => setMenstrualDraft(prev => ({ ...prev, periodCareLeadDays: value }))}
                          >
                            {value}天
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="calendar-menstrual-care-section">
                      <label className="menu-desc ml-1">选择角色</label>
                      {periodCareCharacterOptions.length > 0 ? (
                        <div className="calendar-period-care-avatars">
                          {periodCareCharacterOptions.map(option => {
                            const selected = menstrualDraft.periodCareCharacterIds.includes(option.characterId);
                            return (
                              <button
                                key={option.characterId}
                                type="button"
                                className="calendar-period-care-avatar"
                                data-active={selected ? "true" : undefined}
                                onClick={() => togglePeriodCareCharacter(option.characterId)}
                              >
                                <Avatar src={option.avatar || undefined} name={option.name} size="md" />
                                <span>{option.name}</span>
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="calendar-menstrual-empty">已有聊天会话的角色会显示在这里。</div>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>

              {menstrualRecords.length > 0 ? (
                <div className="calendar-menstrual-modal-history">
                  <label className="menu-desc ml-1">最近完成的经期</label>
                  <div className="calendar-menstrual-modal-list">
                    {menstrualRecords.slice(0, 4).map(record => (
                      <div key={record.id} className="calendar-menstrual-modal-item">
                        <div>
                          <strong>{formatSimpleDate(record.startDate)} - {formatSimpleDate(record.endDate)}</strong>
                          <span>{record.startDate} 至 {record.endDate}</span>
                        </div>
                        <button
                          type="button"
                          className="calendar-menstrual-modal-delete"
                          onClick={() => {
                            setMenstrualRecords(deleteMenstrualRecord(record.id));
                            refreshMenstrual();
                            onNotice?.("经期记录已删除");
                          }}
                          aria-label="删除记录"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="calendar-menstrual-empty">还没有完成的经期记录。先在日程页点“经期来了”，结束时再点“经期走了”。</div>
              )}
            </div>
          </div>
        </div>
      )}

      {showGenerateConfirm && selectedOwner && (
        <div className="modal-overlay calendar-edit-modal-overlay" onClick={() => setShowGenerateConfirm(false)}>
          <div className="calendar-edit-modal calendar-generate-dialog" onClick={e => e.stopPropagation()}>
            <div className="calendar-generate-heading"><Wand2 size={21} /><span>AI 生成日程</span></div>
            <p className="calendar-generate-caption">一次最多选择 3 位角色，一次请求完成。重要安排优先，空白日可以保留。</p>
            <div className="calendar-generate-section">
              <span className="calendar-generate-label">生成日期</span>
              <div className="grid grid-cols-2 gap-2">
                <label className="calendar-generate-date"><small>开始</small><Input type="date" value={generationFromDate} onChange={event => setGenerationFromDate(event.target.value)} /></label>
                <label className="calendar-generate-date"><small>结束</small><Input type="date" value={generationToDate} onChange={event => setGenerationToDate(event.target.value)} /></label>
              </div>
            </div>
            <div className="calendar-generate-section">
              <span className="calendar-generate-label">选择角色（最多 3 位）</span>
              <div className="calendar-generate-people">
                {owners.map(owner => {
                  const generationId=owner.ownerType==="user"?"user:self":owner.ownerId;
                  const checked = generationCharacterIds.includes(generationId);
                  return <button type="button" key={owner.ownerId} className="calendar-generate-person" data-active={checked ? "true" : undefined} disabled={!checked && generationCharacterIds.length >= 3} onClick={() => setGenerationCharacterIds(prev => checked ? prev.filter(id => id !== generationId) : [...prev, generationId])}><Avatar src={owner.avatar || undefined} name={owner.name} size="sm" /><span>{owner.name}</span>{checked ? <Check size={15} /> : null}</button>;
                })}
              </div>
            </div>
            <div className="calendar-generate-section"><label className="calendar-generate-label" htmlFor="calendar-generation-extra">本次生成要求（可选）</label><textarea id="calendar-generation-extra" className="ui-input" rows={3} maxLength={3000} value={generationPrompt} onChange={e=>setGenerationPrompt(e.target.value)} placeholder="想补充的工作、企划或私人安排…"/></div>
            {generationCharacterIds.length > 1 ? <div className="calendar-generate-section">
              <span className="calendar-generate-label">生成方式</span>
              <div className="calendar-generate-mode-row">
                <button type="button" data-active={generationMode === "separate" ? "true" : undefined} onClick={() => { setGenerationMode("separate"); setGenerationSharedPairs([]); }}>各自安排</button>
                <button type="button" data-active={generationMode === "together" ? "true" : undefined} onClick={() => setGenerationMode("together")}>一起考虑</button>
              </div>
              {generationMode === "together" ? <div className="calendar-generate-pairs"><span>可选共同参与（默认不安排共同日程）</span>{generationCharacterIds.flatMap((id, i) => generationCharacterIds.slice(i + 1).map(otherId => {
                const pair = [id, otherId].sort(); const active = generationSharedPairs.some(entry => entry.length === 2 && pair.every(value => entry.includes(value)));
                return <label key={`${pair[0]}-${pair[1]}`}><input type="checkbox" checked={active} onChange={() => setGenerationSharedPairs(prev => active ? prev.filter(entry => !(entry.length === 2 && pair.every(value => entry.includes(value)))) : [...prev, pair])} />{owners.find(owner => (owner.ownerType==="user"?"user:self":owner.ownerId) === id)?.name} + {owners.find(owner => (owner.ownerType==="user"?"user:self":owner.ownerId) === otherId)?.name}</label>;
              }))}</div> : null}
            </div> : null}
            {generationCharacterIds.some(id => loadOwnerCalendarPlans(id.startsWith("user:")?"user":"character",id.startsWith("user:")?"self":id).some(plan => plan.items.some(item => item.date >= generationFromDate && item.date <= generationToDate))) ? <div className="calendar-generate-section">
              <span className="calendar-generate-label">这段时间已有日程</span>
              <div className="calendar-generate-mode-row">
                <button type="button" data-active={generationExistingMode === "supplement" ? "true" : undefined} onClick={() => setGenerationExistingMode("supplement")}>在现有安排上补充</button>
                <button type="button" data-active={generationExistingMode === "replan" ? "true" : undefined} onClick={() => setGenerationExistingMode("replan")}>重新安排 AI 日程</button>
              </div>
              <small className="calendar-generate-hint">重新安排只替换 AI 生成项，手动和 Weverse 日程保留。</small>
            </div> : null}
            <div className="calendar-confirm-footer">
              <button type="button" className="calendar-block-btn" data-variant="ghost" onClick={() => setShowGenerateConfirm(false)}>取消</button>
              <button
                type="button"
                className="calendar-block-btn"
                data-variant="primary"
                data-loading={isGenerating ? "true" : undefined}
                onClick={handleGenerate}
                disabled={isGenerating || generationCharacterIds.length === 0 || generationFromDate > generationToDate}
                aria-busy={isGenerating}
              >
                {isGenerating ? "生成中…" : "开始生成"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAutoConfirm && selectedOwner && (
        <div className="modal-overlay calendar-edit-modal-overlay" onClick={() => setShowAutoConfirm(false)}>
          <div className="calendar-edit-modal calendar-confirm-dialog" onClick={e => e.stopPropagation()}>
            <Bot size={26} className="calendar-confirm-icon" />
            <div className="calendar-confirm-title">
              {autoGenerateEnabled ? "关闭自动生成？" : "开启自动生成？"}
            </div>
            <div className="calendar-confirm-desc">
              {autoGenerateEnabled
                ? "关闭后将不再自动为角色生成每周日程"
                : <>每周将自动为 <strong>{selectedOwner.name}</strong> 生成日程安排</>}
            </div>
            <div className="calendar-confirm-footer">
              <button type="button" className="calendar-block-btn" data-variant="ghost" onClick={() => setShowAutoConfirm(false)}>取消</button>
              <button
                type="button"
                className="calendar-block-btn"
                data-variant="primary"
                onClick={() => {
                  const next = !autoGenerateEnabled;
                  const nextConfig = { ...config, autoGenerateEnabled: next };
                  setConfig(nextConfig);
                  saveCalendarConfig(nextConfig);
                  setShowAutoConfirm(false);
                  onNotice?.(next ? "已开启每周自动生成" : "已关闭每周自动生成");
                }}
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
