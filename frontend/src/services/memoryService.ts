import apiClient from "./apiClient";
import type { MemoryItem, MemoryItemListResponse, StructuredNode, ExtractionMetadata } from "../types/memory";

interface APIEnvelope<T> {
  success: boolean;
  data: T;
}

export async function fetchMemoryItems(
  page = 1,
  perPage = 20
): Promise<MemoryItemListResponse> {
  const resp = await apiClient.get<APIEnvelope<MemoryItemListResponse>>(
    `/memory-items?page=${page}&per_page=${perPage}`
  );
  return resp.data.data;
}

export async function fetchMemoryItemById(id: string): Promise<MemoryItem> {
  const resp = await apiClient.get<APIEnvelope<MemoryItem>>(`/memory-items/${id}`);
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
