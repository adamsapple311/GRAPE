"use client";

type UiSound = "hover" | "click";

let audioContext: AudioContext | null = null;

export function playUiSound(sound: UiSound): void {
  if (typeof window === "undefined" || !("AudioContext" in window)) {
    return;
  }

  audioContext ??= new window.AudioContext();
  const context = audioContext;
  if (context.state === "suspended") {
    void context.resume().catch((error: unknown) => {
      console.error("Unable to resume dashboard audio:", error);
    });
  }

  const startAt = context.currentTime;
  const oscillator = context.createOscillator();
  const volume = context.createGain();
  const isHover = sound === "hover";
  const duration = isHover ? 0.075 : 0.16;

  oscillator.type = isHover ? "sine" : "triangle";
  oscillator.frequency.setValueAtTime(isHover ? 980 : 520, startAt);
  oscillator.frequency.exponentialRampToValueAtTime(
    isHover ? 720 : 880,
    startAt + duration,
  );
  volume.gain.setValueAtTime(0.0001, startAt);
  volume.gain.exponentialRampToValueAtTime(isHover ? 0.025 : 0.055, startAt + 0.012);
  volume.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  oscillator.connect(volume);
  volume.connect(context.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + duration);
}
