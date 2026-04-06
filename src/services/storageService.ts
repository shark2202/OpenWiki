import { invoke } from "@tauri-apps/api/core";
import type { CapturedContent } from "../types/content";

export async function getAllContent(
  limit?: number,
  offset?: number
): Promise<CapturedContent[]> {
  return invoke("get_all_content", { limit, offset });
}

export async function deleteContent(id: string): Promise<void> {
  return invoke("delete_content", { id });
}

export async function retryUrlFetch(contentId: string): Promise<void> {
  return invoke("retry_url_fetch", { contentId });
}

export async function ocrImage(contentId: string): Promise<string> {
  return invoke("ocr_image", { contentId });
}

export async function getContentsByIds(ids: string[]): Promise<CapturedContent[]> {
  return invoke("get_contents_by_ids", { ids });
}

export async function saveSpotlightContent(
  contentType: string,
  rawText: string | null,
  imagePath: string | null,
  sourceApp: string,
  userNote: string
): Promise<CapturedContent> {
  return invoke("save_spotlight_content", {
    contentType,
    rawText,
    imagePath,
    sourceApp,
    userNote,
  });
}
