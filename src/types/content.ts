export type ContentType = "text" | "image" | "url" | "mixed";

export interface CapturedContent {
  id: string;
  content_type: ContentType;
  raw_text?: string;
  image_path?: string;
  thumbnail_path?: string;
  source_app: string;
  source_bundle_id?: string;
  source_url?: string;
  user_note?: string;
  captured_at: string;
  content_hash: string;
  byte_size: number;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
  digested_at?: string;
  digest_action?: string;
  summary?: string;
  tags?: string;
  digest?: string;
  wiki_compile_hash?: string;
  wiki_assessed_hash?: string;
}

export interface CaptureEvent {
  content_type: string;
  preview: string;
  source_app: string;
  raw_text?: string;
  image_path?: string;
}
