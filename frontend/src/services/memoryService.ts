import apiClient, { type APIEnvelope } from "./apiClient";
import type {
  MemoryItem,
  MemoryItemListResponse,
  MemoryListFilters,
  StructuredNode,
  ExtractionMetadata,
} from "../types/memory";

export async function fetchMemoryItems(
  page = 1,
  perPage = 20,
  filters: MemoryListFilters = {},
): Promise<MemoryItemListResponse> {
  const params: Record<string, string | number> = { page, per_page: perPage };
  for (const [key, value] of Object.entries(filters)) {
    if (value) params[key] = value;
  }
  const resp = await apiClient.get<APIEnvelope<MemoryItemListResponse>>("/memory-items", {
    params,
  });
  return resp.data.data;
}

/** One save. Opening a save also queues its summary (S5), within the daily limit. */
export async function fetchMemoryItem(id: string): Promise<MemoryItem> {
  const resp = await apiClient.get<APIEnvelope<MemoryItem>>(`/memory-items/${id}`);
  return resp.data.data;
}

/** Give a save a new title (1-300 characters). */
export async function renameMemoryItem(id: string, title: string): Promise<MemoryItem> {
  const resp = await apiClient.patch<APIEnvelope<MemoryItem>>(`/memory-items/${id}`, { title });
  return resp.data.data;
}

/**
 * Summarise a save now (summary, key points). 202 with the save; the API
 * answers 409 ENRICHMENT_ALREADY_QUEUED, 429 RATE_LIMITED (daily limit) or
 * 403 PRIVACY_CONSENT_REQUIRED.
 */
export async function enrichMemoryItem(id: string): Promise<MemoryItem> {
  const resp = await apiClient.post<APIEnvelope<MemoryItem>>(`/memory-items/${id}/enrich`);
  return resp.data.data;
}

export async function deleteMemoryItem(id: string): Promise<void> {
  await apiClient.delete(`/memory-items/${id}`);
}

export interface CreateMemoryItemPayload {
  source_type: "webpage" | "pdf" | "youtube";
  title: string;
  url: string;
  content: string;
  author?: string;
  favicon_url?: string;
  thumbnail_url?: string;
  structured_content?: StructuredNode[];
  extraction?: ExtractionMetadata;
}

export async function createMemoryItem(
  payload: CreateMemoryItemPayload
): Promise<MemoryItem> {
  const resp = await apiClient.post<APIEnvelope<MemoryItem>>(
    "/memory-items",
    payload
  );
  return resp.data.data;
}
