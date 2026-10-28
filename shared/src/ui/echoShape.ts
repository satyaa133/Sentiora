/** Echo's body outline in the 0 0 120 120 viewBox (DESIGN.md §4). */
export const ECHO_BODY_PATH =
  "M30 60 C30 22 90 22 90 60 V100 L80 92 L70 100 L60 92 L50 100 L40 92 L30 100 Z";

/** Every Echo state (DESIGN.md §4, §8.3). */
export type EchoState =
  | "idle"
  | "saving"
  | "happy"
  | "faded"
  | "guarding"
  | "searching"
  | "thinking"
  | "reading"
  | "love"
  | "sleeping"
  | "chomp"
  | "scared"
  | "giggle";

export const ECHO_STATES: readonly EchoState[] = [
  "idle",
  "saving",
  "happy",
  "faded",
  "guarding",
  "searching",
  "thinking",
  "reading",
  "love",
  "sleeping",
  "chomp",
  "scared",
  "giggle",
];
