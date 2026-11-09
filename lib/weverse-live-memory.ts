import type { WeverseLive, WeverseLivePresence } from "./weverse-storage";
import type { WeverseProjectionEntry } from "./weverse-memory";

type LiveRecord = Pick<WeverseLive, "id" | "communityId" | "hostCharacterIds" | "startedAt" | "endedAt" | "status" | "official" | "title" | "segments" | "comments">
    & Partial<Pick<WeverseLive, "participantPresence" | "viewerPresence">>;
type Span = { id: string; from: number; to: number; joinedVia?: WeverseLivePresence["joinedVia"] };
type Witnessed = { at: number; text: string };

const byTime = (a: Witnessed, b: Witnessed) => a.at - b.at;
const displayTime = (at: number) => new Date(at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
const compact = (text: string) => text.replace(/\s+/g, " ").trim();
const overlap = (a: Span, b: Span) => a.from < b.to && b.from < a.to;

function spans(rows: WeverseLivePresence[], start: number, end: number): Span[] {
    return rows.flatMap(row => {
        if (!row.characterId || !Number.isFinite(row.joinedAt)) return [];
        const from = Math.max(start, row.joinedAt);
        const to = Math.min(end, row.leftAt ?? end);
        return from <= to ? [{ id: row.characterId, from, to, joinedVia: row.joinedVia }] : [];
    }).sort((a, b) => a.from - b.from);
}

/** Derive memory from the ended replay so existing lives and interrupted app sessions use the same path. */
export function buildWeverseLiveMemory(
    live: LiveRecord,
    characterId: string,
    communityName: string,
    nameOf: (id: string) => string,
): WeverseProjectionEntry[] {
    const start = live.startedAt;
    const end = live.endedAt;
    if (live.official || live.status !== "ended" || end === undefined || !Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
    const participants = spans(live.participantPresence?.length
        ? live.participantPresence
        : (live.hostCharacterIds || []).slice(0, 1).map(id => ({ characterId: id, joinedAt: start, leftAt: end })), start, end);
    const onStage = participants.filter(span => span.id === characterId);
    const watching = spans(live.viewerPresence || [], start, end).filter(span => span.id === characterId);
    const attended = [...onStage, ...watching].sort((a, b) => a.from - b.from);
    if (!attended.length) return [];

    const watched = (at: number) => attended.some(span => span.from <= at && (at < span.to || (span.to === end && at === end)));
    const publishedAt = new Date(end).toISOString();
    const label = `[WVS Live] 「${communityName}」《${live.title || "Live"}》`;
    const host = live.hostCharacterIds?.[0];
    const joined = onStage.map(span => {
        const role = host === characterId && span.from === start ? "你开播"
            : span.from === start ? "你从开场就在台上" : "你中途上台";
        const together = [...new Set(participants.filter(other => other.id !== characterId && overlap(span, other) && other.from <= span.from).map(other => nameOf(other.id)))];
        const path = span.joinedVia === "invitation" ? "（接受合播邀请）" : span.joinedVia === "viewer" ? "（从观众席加入）" : "";
        return `${displayTime(span.from)} ${role}${path}${together.length ? `，当时同台：${together.join("、")}` : ""}；${displayTime(span.to)} ${span.to < end ? "你离开舞台" : "下播"}`;
    });
    const stageChanges = participants.flatMap(span => {
        if (span.id === characterId) return [];
        const name = nameOf(span.id);
        const out: Witnessed[] = [];
        if (watched(span.from) && span.from > start) out.push({ at: span.from, text: `${displayTime(span.from)} ${name}加入舞台。` });
        if (span.to < end && watched(span.to)) out.push({ at: span.to, text: `${displayTime(span.to)} ${name}中途离场。` });
        return out;
    });
    const sawOpening = watched(start);
    const stageNames = [...new Set(participants.filter(span => span.id !== characterId && attended.some(own => overlap(own, span))).map(span => nameOf(span.id)))];
    const shared = onStage.some(span => participants.some(other => other.id.startsWith("user:") && overlap(span, other)));
    const prefix = `weverse_live_${onStage.length ? "participant" : "viewer"}_${live.id}_${characterId}`;
    const sourceKeys = [`wvs:${live.id}`];
    const entries: WeverseProjectionEntry[] = [{
        id: prefix,
        timestamp: publishedAt,
        shared,
        sourceKeys,
        content: [
            `${label}，${onStage.length ? "你上过台" : "你围观过"}。`,
            sawOpening && host ? `开播者：${host === characterId ? "你" : nameOf(host)}。` : "",
            ...joined,
            ...watching.map(span => `${displayTime(span.from)}–${displayTime(span.to)} 你在台下围观。`),
            stageNames.length ? `在你在场时见到的台上成员：${stageNames.join("、")}。` : "",
        ].filter(Boolean).join("\n"),
    }];

    const visibleComments = (live.comments || []).filter(row => watched(row.createdAt));
    const commentById = new Map(visibleComments.map(row => [row.id, row]));
    const fanComments = visibleComments.filter(row => row.authorType === "fan");
    const sampleSize = Math.min(fanComments.length, 5);
    const sampledFanIds = new Set(Array.from({ length: sampleSize }, (_, index) =>
        fanComments[Math.floor((index + 0.5) * fanComments.length / sampleSize)].id));
    const facts: Witnessed[] = [...stageChanges];
    for (const row of visibleComments) {
        if (row.authorType === "fan" && !sampledFanIds.has(row.id)) continue;
        const who = row.authorId === characterId ? "你" : row.authorName || (row.authorType === "user" ? "用户" : "观众");
        facts.push({ at: row.createdAt, text: `${displayTime(row.createdAt)} ${who}${row.authorType === "fan" ? "（普通观众，抽样）" : ""}留言：${compact(row.originalBody || row.body)}` });
    }
    for (const row of live.segments || []) {
        if (row.kind === "system" || !watched(row.createdAt)) continue;
        const who = row.characterId === characterId ? "你" : row.characterId ? nameOf(row.characterId) : "台上";
        const replies = (row.replyToCommentIds || []).flatMap(id => {
            const comment = commentById.get(id);
            return comment && comment.createdAt <= row.createdAt ? [`${comment.authorName}的「${compact(comment.originalBody || comment.body)}」`] : [];
        });
        facts.push({ at: row.createdAt, text: `${displayTime(row.createdAt)} ${who}${row.kind === "action" ? "做了" : replies.length ? `回应${replies.join("、")}` : "说"}：${compact(row.original)}` });
    }

    // Small chronological events keep a long live from taking up the whole Chat context at once.
    let block: Witnessed[] = [];
    let size = 0;
    const flush = () => {
        if (!block.length) return;
        entries.push({
            id: `${prefix}_detail_${entries.length}`,
            timestamp: publishedAt,
            shared,
            sourceKeys,
            content: `${label} 在你在场的这段：\n${block.map(item => item.text).join("\n")}`,
        });
        block = [];
        size = 0;
    };
    for (const fact of facts.sort(byTime)) {
        if (size + fact.text.length > 850) flush();
        block.push(fact);
        size += fact.text.length;
    }
    flush();
    return entries;
}
