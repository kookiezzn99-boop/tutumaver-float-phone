"use client";

import { useEffect, useState } from "react";
import { isKvHydrated } from "@/lib/kv-db";
import {
    collectSocialNotices,
    enableSocialNotice,
    loadSocialNotices,
    processSocialNotices,
    SOCIAL_APPS,
    SOCIAL_NOTICE_UPDATED,
    type SocialApp,
} from "@/lib/social-notifications";

export function SocialNotificationRuntime() {
    useEffect(() => {
        const sync = () => { if (isKvHydrated()) processSocialNotices(collectSocialNotices()); };
        sync();
        const timer = window.setInterval(sync, 1500);
        return () => window.clearInterval(timer);
    }, []);
    return null;
}

export function useSocialNotices() {
    const [state, setState] = useState(loadSocialNotices);
    useEffect(() => {
        const sync = () => setState(loadSocialNotices());
        window.addEventListener(SOCIAL_NOTICE_UPDATED, sync);
        return () => window.removeEventListener(SOCIAL_NOTICE_UPDATED, sync);
    }, []);
    return state;
}

export function AppNotificationSetting({ app, className = "" }: { app: SocialApp; className?: string }) {
    const state = useSocialNotices();
    const checked = state.enabled[app] === true;
    return (
        <div className={`app-notice-setting ${className}`}>
            <span>新消息通知</span>
            <button
                type="button"
                className="app-notice-switch"
                role="switch"
                aria-label={`${SOCIAL_APPS[app]}新消息通知`}
                aria-checked={checked}
                onClick={() => enableSocialNotice(app, !checked)}
            ><i /></button>
        </div>
    );
}
