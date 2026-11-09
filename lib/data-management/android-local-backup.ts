import { Directory, Filesystem } from "@capacitor/filesystem";
import { isAndroidApp } from "@/lib/android-runtime";
import { isKvHydrated, kvGet, kvSet, registerKvMigration } from "@/lib/kv-db";
import { createBackupBlob } from "./backup";

export const LOCAL_BACKUP_FOLDER = "Rabbit Float/Backups";
export const LOCAL_BACKUP_INTERVALS = [8, 12, 24] as const;
export type LocalBackupHours = (typeof LOCAL_BACKUP_INTERVALS)[number];
export const LOCAL_BACKUP_UPDATED = "rabbit-local-backup-updated";
const KEY = "ai_phone_android_local_backup_v1";
registerKvMigration(KEY);

type LocalBackupSettings = {
    enabled: boolean;
    hours: LocalBackupHours;
    lastSuccess?: number;
    lastError?: string;
};

export function loadLocalBackupSettings(): LocalBackupSettings {
    try {
        const data = JSON.parse(kvGet(KEY) || "{}") as Partial<LocalBackupSettings>;
        return { ...data, enabled: data.enabled === true, hours: data.hours === 8 || data.hours === 24 ? data.hours : 12 };
    } catch {
        return { enabled: false, hours: 12 };
    }
}

export function saveLocalBackupSettings(patch: Partial<LocalBackupSettings>) {
    kvSet(KEY, JSON.stringify({ ...loadLocalBackupSettings(), ...patch }));
    window.dispatchEvent(new Event(LOCAL_BACKUP_UPDATED));
}

function readBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

let pending: Promise<void> | null = null;
let lastAttempt = 0;

export async function runAndroidLocalBackup(force = false): Promise<void> {
    if (!isAndroidApp() || !isKvHydrated()) return;
    if (pending) return pending;
    const settings = loadLocalBackupSettings();
    const now = Date.now();
    if (!force && (!settings.enabled || document.hidden
        || (settings.lastSuccess !== undefined && now - settings.lastSuccess < settings.hours * 3600_000)
        || now - lastAttempt < 15 * 60_000)) return;

    lastAttempt = now;
    pending = writeBackupPair().finally(() => { pending = null; });
    return pending;
}

async function writeBackupPair() {
    saveLocalBackupSettings({ lastError: undefined });
    const directory = Directory.Documents;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const base = `${LOCAL_BACKUP_FOLDER}/rabbit-float-${stamp}`;
    const paths = [`${base}-1.zip`, `${base}-2.zip`];
    const temporary = paths.map(path => `${path}.partial`);
    const created: string[] = [];
    try {
        const { blob, warnings } = await createBackupBlob(undefined, { excludeMedia: false });
        if (warnings.length) throw new Error(warnings.join("；"));
        if (!blob.size) throw new Error("备份文件为空");
        const chunkSize = 768 * 1024;
        for (let offset = 0; offset < blob.size; offset += chunkSize) {
            const data = await readBase64(blob.slice(offset, offset + chunkSize));
            if (offset === 0) await Filesystem.writeFile({ directory, path: temporary[0], data, recursive: true });
            else await Filesystem.appendFile({ directory, path: temporary[0], data });
        }
        await Filesystem.copy({ directory, from: temporary[0], to: temporary[1] });
        for (let index = 0; index < paths.length; index++) {
            const info = await Filesystem.stat({ directory, path: temporary[index] });
            if (info.size !== blob.size) throw new Error("备份副本大小校验失败");
        }
        for (let index = 0; index < paths.length; index++) {
            await Filesystem.rename({ directory, from: temporary[index], to: paths[index] });
            created.push(paths[index]);
        }
        saveLocalBackupSettings({ lastSuccess: Date.now(), lastError: undefined });
    } catch (error) {
        await Promise.allSettled([...temporary, ...created].map(path => Filesystem.deleteFile({ directory, path })));
        saveLocalBackupSettings({ lastError: error instanceof Error ? error.message : String(error) });
        throw error;
    }
}
