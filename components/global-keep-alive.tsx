"use client";

import { useEffect, useRef } from "react";
import { loadChatAppSettings } from "@/lib/chat-storage";

// 极短静音 WAV Base64 (1秒 PCM 静音采样，兼容 iOS WebKit 音频会话)
const SILENT_WAV =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";

export function GlobalKeepAlive() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const wakeLockRef = useRef<any>(null);

  useEffect(() => {
    let active = false;

    const checkAndApply = async () => {
      const settings = loadChatAppSettings();
      const enabled = Boolean(settings.iosKeepAliveEnabled);

      if (enabled && !active) {
        active = true;

        // 1. 启动循环静音音频通道
        if (!audioRef.current) {
          const audio = new Audio(SILENT_WAV);
          audio.loop = true;
          audio.volume = 0.01;
          audioRef.current = audio;
        }

        const playAudio = () => {
          if (audioRef.current && audioRef.current.paused) {
            audioRef.current.play().catch(() => {});
          }
        };

        playAudio();
        window.addEventListener("touchstart", playAudio, { passive: true });
        window.addEventListener("click", playAudio);

        // 2. 申请屏幕常亮唤醒锁 (iOS 16.4+ / modern browsers)
        if ("wakeLock" in navigator && !wakeLockRef.current) {
          try {
            wakeLockRef.current = await (navigator as any).wakeLock.request("screen");
          } catch {}
        }
      } else if (!enabled && active) {
        active = false;
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current = null;
        }
        if (wakeLockRef.current) {
          wakeLockRef.current.release().catch(() => {});
          wakeLockRef.current = null;
        }
      }
    };

    void checkAndApply();

    const handleStorage = (e: StorageEvent) => {
      if (e.key === "chat_app_settings" || !e.key) {
        void checkAndApply();
      }
    };

    const handleCustomChange = () => {
      void checkAndApply();
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener("chat-app-settings-changed", handleCustomChange);

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("chat-app-settings-changed", handleCustomChange);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
    };
  }, []);

  return null;
}
