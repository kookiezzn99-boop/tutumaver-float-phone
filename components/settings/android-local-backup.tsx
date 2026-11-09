"use client";

import { useEffect, useState } from "react";
import { Filesystem } from "@capacitor/filesystem";
import { isAndroidApp } from "@/lib/android-runtime";
import {
    LOCAL_BACKUP_FOLDER,
    LOCAL_BACKUP_INTERVALS,
    LOCAL_BACKUP_UPDATED,
    loadLocalBackupSettings,
    runAndroidLocalBackup,
    saveLocalBackupSettings,
    type LocalBackupHours,
} from "@/lib/data-management/android-local-backup";
import { Select, Toggle } from "@/components/ui/form";

export function AndroidLocalBackupScheduler() {
    useEffect(() => {
        if (!isAndroidApp()) return;
        const tick = () => { void runAndroidLocalBackup().catch(() => {}); };
        const initial = window.setTimeout(tick, 3000);
        const interval = window.setInterval(tick, 60_000);
        document.addEventListener("visibilitychange", tick);
        return () => {
            window.clearTimeout(initial);
            window.clearInterval(interval);
            document.removeEventListener("visibilitychange", tick);
        };
    }, []);
    return null;
}

export function AndroidLocalBackupSettings() {
    const [settings, setSettings] = useState(loadLocalBackupSettings);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        const refresh = () => setSettings(loadLocalBackupSettings());
        window.addEventListener(LOCAL_BACKUP_UPDATED, refresh);
        return () => window.removeEventListener(LOCAL_BACKUP_UPDATED, refresh);
    }, []);

    if (!isAndroidApp()) return null;

    const runNow = async (enable = false) => {
        setBusy(true);
        try {
            const status = await Filesystem.checkPermissions();
            if (status.publicStorage === "prompt" || status.publicStorage === "prompt-with-rationale") {
                await Filesystem.requestPermissions();
            }
            if (enable) saveLocalBackupSettings({ enabled: true });
            await runAndroidLocalBackup(true);
        } catch (error) {
            saveLocalBackupSettings({ lastError: error instanceof Error ? error.message : String(error) });
        } finally {
            setBusy(false);
        }
    };

    return <div className="data-section">
        <div className="menu-group">
            <div className="menu-item">
                <div className="menu-label-group">
                    <span className="menu-label">本地自动备份</span>
                    <span className="menu-desc">每次保存两个 ZIP。退出应用期间到期，下次打开时补备份。</span>
                </div>
                <Toggle checked={settings.enabled} disabled={busy} onChange={enabled => {
                    if (enabled) void runNow(true);
                    else saveLocalBackupSettings({ enabled: false });
                }} />
            </div>
            <label className="menu-item">
                <span className="menu-label">备份间隔</span>
                <Select value={settings.hours} disabled={busy} onChange={event => {
                    saveLocalBackupSettings({ hours: Number(event.target.value) as LocalBackupHours });
                }}>
                    {LOCAL_BACKUP_INTERVALS.map(hours => <option value={hours} key={hours}>每 {hours} 小时</option>)}
                </Select>
            </label>
            <div className="menu-item">
                <div className="menu-label-group">
                    <span className="menu-label">保存位置</span>
                    <span className="menu-desc">内部存储 / Documents / {LOCAL_BACKUP_FOLDER}</span>
                    {settings.lastSuccess && <span className="menu-desc">最近成功 {new Date(settings.lastSuccess).toLocaleString()}</span>}
                    {settings.lastError && <span className="menu-desc" role="status">备份失败：{settings.lastError}</span>}
                </div>
                <button className="ui-btn ui-btn-outline shrink-0" type="button" disabled={busy} onClick={() => void runNow()}>
                    {busy ? "备份中…" : "立即备份"}
                </button>
            </div>
        </div>
    </div>;
}
