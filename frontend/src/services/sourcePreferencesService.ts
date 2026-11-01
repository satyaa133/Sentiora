import apiClient, { type APIEnvelope } from "./apiClient";
import type {
  SourceId,
  SourcePreferencesResponse,
  SourceStatus,
} from "../types/sourcePreferences";

export async function fetchSourcePreferences(): Promise<SourcePreferencesResponse> {
  const response = await apiClient.get<APIEnvelope<SourcePreferencesResponse>>(
    "/users/me/source-preferences",
  );
  return response.data.data;
}

export async function completeOnboarding(
  selectedSources: SourceId[],
): Promise<SourcePreferencesResponse> {
  const response = await apiClient.post<APIEnvelope<SourcePreferencesResponse>>(
    "/users/me/onboarding/complete",
    { selected_sources: selectedSources },
  );
  return response.data.data;
}

export async function updateSourceStatus(
  sourceId: SourceId,
  status: SourceStatus,
): Promise<SourcePreferencesResponse> {
  const response = await apiClient.patch<APIEnvelope<SourcePreferencesResponse>>(
    `/users/me/source-preferences/${sourceId}`,
    { status },
  );
  return response.data.data;
}
