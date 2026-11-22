import { PRIVACY_NOTICE_VERSION } from "@shared/ui";
import apiClient, { type APIEnvelope } from "./apiClient";

/** Whether the signed-in user accepted the current privacy notice (D10). */
export interface PrivacyConsent {
  privacy_consent_version: string | null;
  privacy_consent_current: boolean;
}

/** Read consent from GET /auth/me. */
export async function fetchPrivacyConsent(): Promise<PrivacyConsent> {
  const resp = await apiClient.get<APIEnvelope<PrivacyConsent>>("/auth/me");
  return {
    privacy_consent_version: resp.data.data.privacy_consent_version ?? null,
    privacy_consent_current: Boolean(resp.data.data.privacy_consent_current),
  };
}

/** Accept the current notice; AI answers and summaries work afterwards. */
export async function acceptPrivacyNotice(): Promise<PrivacyConsent> {
  const resp = await apiClient.post<APIEnvelope<PrivacyConsent>>("/users/me/privacy-consent", {
    version: PRIVACY_NOTICE_VERSION,
  });
  return resp.data.data;
}
