/**
 * Echo's sounds, generated with Web Audio (DESIGN.md §8.4): soft sine and
 * triangle tones, no files. Loaded only after the user turns sound on, and the
 * AudioContext is created on that first use, never before.
 */
const MASTER_GAIN = 0.7;

interface ToneOptions {
  type?: "sine" | "triangle";
  /** Individual volume, 0.03–0.3. */
  volume?: number;
  /** Seconds from now. */
  delay?: number;
}

export interface EchoSound {
  /** Quiet two-note chime when sound is turned on. */
  chime(): void;
  /** Tiny tick on new saves and clicks (corner mode). */
  tick(): void;
  /** Landing only: one soft blip per letter of a speech line, at most 7. */
  babble(text: string): void;
  chomp(): void;
  giggle(): void;
  whee(): void;
  scared(): void;
  wake(): void;
  pop(): void;
  close(): void;
}

type AudioContextCtor = typeof AudioContext;

export function createEchoSound(): EchoSound | null {
  const Ctor: AudioContextCtor | undefined =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
  if (!Ctor) return null;

  let context: AudioContext;
  try {
    context = new Ctor();
  } catch {
    return null;
  }
  const master = context.createGain();
  master.gain.value = MASTER_GAIN;
  master.connect(context.destination);

  function tone(frequency: number, duration: number, options: ToneOptions = {}) {
    const { type = "sine", volume = 0.1, delay = 0 } = options;
    const start = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  function play(fn: () => void) {
    if (context.state === "suspended") void context.resume();
    try {
      fn();
    } catch {
      // Audio failures are never worth surfacing.
    }
  }

  return {
    chime: () =>
      play(() => {
        tone(660, 0.22, { type: "triangle", volume: 0.08 });
        tone(880, 0.3, { type: "triangle", volume: 0.07, delay: 0.12 });
      }),
    tick: () => play(() => tone(1250, 0.045, { volume: 0.04 })),
    babble: (text) =>
      play(() => {
        const letters = text.replace(/[^a-z]/gi, "").slice(0, 7);
        [...letters].forEach((letter, i) => {
          const pitch = 420 + ((letter.toLowerCase().charCodeAt(0) - 97) % 12) * 28;
          tone(pitch, 0.06, { type: "triangle", volume: 0.05, delay: i * 0.07 });
        });
      }),
    chomp: () =>
      play(() => {
        tone(220, 0.07, { type: "triangle", volume: 0.12 });
        tone(180, 0.07, { type: "triangle", volume: 0.1, delay: 0.09 });
      }),
    giggle: () =>
      play(() => {
        for (let i = 0; i < 4; i += 1) tone(700 + i * 60, 0.06, { volume: 0.06, delay: i * 0.08 });
      }),
    whee: () =>
      play(() => {
        for (let i = 0; i < 6; i += 1) tone(500 + i * 90, 0.07, { volume: 0.05, delay: i * 0.05 });
      }),
    scared: () =>
      play(() => {
        tone(900, 0.08, { type: "triangle", volume: 0.07 });
        tone(600, 0.12, { type: "triangle", volume: 0.06, delay: 0.08 });
      }),
    wake: () =>
      play(() => {
        tone(440, 0.12, { volume: 0.05 });
        tone(660, 0.16, { volume: 0.05, delay: 0.12 });
      }),
    pop: () => play(() => tone(980, 0.05, { volume: 0.08 })),
    close: () => void context.close().catch(() => undefined),
  };
}
