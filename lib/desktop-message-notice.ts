import type { IconId } from "./desktop-config";
import type { SocialNotice } from "./social-notifications";

export type DesktopMessageNotice = {
    sessionId: string;
    title: string;
    body: string;
    avatar: string | null;
    app?: IconId;
    social?: SocialNotice;
    isGroup?: boolean;
    count?: number;
};

export function privateDesktopNotice(notice: DesktopMessageNotice): DesktopMessageNotice {
    const app = notice.app || (notice.sessionId.startsWith("sms:") ? "sms"
        : notice.sessionId.startsWith("phone:") ? "phone"
        : notice.sessionId.startsWith("lysn:") ? "lysn" : "chat");
    const name = notice.title;
    const body = app === "chat" ? `${name}的消息`
        : app === "sms" ? `有来自${name}的短信`
        : app === "lysn" ? `有[${name}]的新消息。`
        : app === "phone" ? "电话"
        : `有${name}新提示`;
    return { ...notice, app, title: app === "phone" ? `${name} · 未接来电` : name, body, count: notice.count || 1 };
}

export function mergeDesktopNotice(previous: DesktopMessageNotice, next: DesktopMessageNotice): DesktopMessageNotice {
    return { ...next, count: (previous.count || 1) + (next.count || 1) };
}
