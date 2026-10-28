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
