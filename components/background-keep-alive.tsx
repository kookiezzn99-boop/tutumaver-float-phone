"use client";

import { useEffect } from "react";

// 极短静音 WAV Base64 (44 字节)
const SILENT_WAV =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";

export function BackgroundKeepAlive() {
  useEffect(() => {
    let audio: HTMLAudioElement | null = null;

    const startAudio = () => {
      if (audio) return;
      try {
        audio = new Audio(SILENT_WAV);
        audio.loop = true;
        audio.volume = 0.01;
        audio.play().catch(() => {});
      } catch {
        // 忽略静默失败
      }
    };

    // 监听首次手势激活音频
    window.addEventListener("touchstart", startAudio, { once: true, passive: true });
    window.addEventListener("click", startAudio, { once: true });

    return () => {
      window.removeEventListener("touchstart", startAudio);
      window.removeEventListener("click", startAudio);
      if (audio) {
        audio.pause();
        audio = null;
      }
    };
  }, []);

  return null;
}
