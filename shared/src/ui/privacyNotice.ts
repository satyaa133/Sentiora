/**
 * The privacy notice users accept at sign-up and before AI features
 * (REBUILD_PLAN D10). The version must match the API's PRIVACY_NOTICE_VERSION;
 * changing the text means a new version, which asks every user again.
 */
export const PRIVACY_NOTICE_VERSION = "2026-11-20";

export const PRIVACY_NOTICE_TEXT =
  "To write AI answers and summaries, Sentiora sends your question and the relevant " +
  "excerpts from your saved items to our AI providers (Anthropic, and Google as a " +
  "backup). These providers process the text only to produce the response and do not " +
  "use it to train their models. Instant answers and search run on our own servers " +
  "and send nothing to AI providers.";
