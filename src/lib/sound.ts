// Client-side scan-completion sound alerts using the Web Audio API.
// No audio files needed — short synthesized chime/error tones.
//
// The preference is read from localStorage AT PLAY TIME (not React state)
// so callers inside long-lived polling closures can never read a stale
// value — mirrors the desktop-notification design in notify.ts.

export type SoundPreference = "on" | "off";

const PREF_KEY = "arbitrage_sound_preference";

export function getSoundPreference(): SoundPreference {
  if (typeof window === "undefined") return "off";
  try {
    return (localStorage.getItem(PREF_KEY) as SoundPreference) ?? "off";
  } catch {
    return "off";
  }
}

export function setSoundPreference(pref: SoundPreference): void {
  try {
    localStorage.setItem(PREF_KEY, pref);
  } catch {
    // private mode / storage disabled — preference just won't persist
  }
}

// Singleton AudioContext. Browsers require a user gesture before audio can
// start; enabling the sound toggle IS a gesture, and we resume on demand in
// case the context was auto-suspended (tab backgrounded, etc.).
let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    if (!audioCtx) audioCtx = new Ctor();
    if (audioCtx.state === "suspended") void audioCtx.resume();
    return audioCtx;
  } catch {
    return null;
  }
}

/** Synthesize one enveloped tone — no clicks, exponential decay tail. */
function tone(
  ctx: AudioContext,
  freq: number,
  start: number,
  dur: number,
  type: OscillatorType = "sine",
  peak = 0.07,
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.02); // fast attack
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur); // decay
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + dur + 0.05);
}

/** Short ascending two-note chime — "scan finished". */
export function playScanCompleteSound(): void {
  if (getSoundPreference() !== "on") return;
  try {
    const ctx = getCtx();
    if (!ctx) return;
    const t0 = ctx.currentTime + 0.01;
    tone(ctx, 659.25, t0, 0.18); // E5
    tone(ctx, 880.0, t0 + 0.16, 0.28); // A5
  } catch {
    // audio unavailable — alerts are best-effort
  }
}

/** Low descending two-note fall — "scan failed". */
export function playScanFailedSound(): void {
  if (getSoundPreference() !== "on") return;
  try {
    const ctx = getCtx();
    if (!ctx) return;
    const t0 = ctx.currentTime + 0.01;
    tone(ctx, 220.0, t0, 0.22, "triangle", 0.06); // A3
    tone(ctx, 164.81, t0 + 0.18, 0.3, "triangle", 0.06); // E3
  } catch {
    // ignore
  }
}

/** One-note confirmation blip used as audible feedback when enabling. */
export function playTestBlip(): void {
  try {
    const ctx = getCtx();
    if (!ctx) return;
    const t0 = ctx.currentTime + 0.01;
    tone(ctx, 987.77, t0, 0.15); // B5
  } catch {
    // ignore
  }
}
