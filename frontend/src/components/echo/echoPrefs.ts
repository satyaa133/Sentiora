/** Echo's two remembered choices (DESIGN.md §8.4). Storage may be unavailable. */
const PAUSED_KEY = "sentiora-echo-paused";
const SOUND_KEY = "sentiora-echo-sound";

function read(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function write(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // Not remembered; the choice still applies until reload.
  }
}

export const readEchoPaused = () => read(PAUSED_KEY);
export const writeEchoPaused = (paused: boolean) => write(PAUSED_KEY, paused);
/** Sound is off unless the user turned it on. */
export const readEchoSound = () => read(SOUND_KEY);
export const writeEchoSound = (on: boolean) => write(SOUND_KEY, on);
