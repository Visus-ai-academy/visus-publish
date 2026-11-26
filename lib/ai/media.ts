import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Db = SupabaseClient<Database>;

export type NewMedia = { kind: "image" | "video"; mime: string; bytes: Uint8Array };

/** Apaga a mídia anterior do post e grava a nova no Storage e em post_media. */
export async function replaceMedia(db: Db, tenantId: string, postId: string, media: NewMedia[]) {
  const { data: old } = await db.from("post_media").select("storage_path").eq("tenant_id", tenantId).eq("post_id", postId);
  if (old?.length) {
    await db.storage.from("media").remove(old.map((m) => m.storage_path));
    await db.from("post_media").delete().eq("tenant_id", tenantId).eq("post_id", postId);
  }
  const stamp = Date.now().toString(36);
  const ext: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "video/mp4": "mp4" };
  const rows = [];
  for (const [i, m] of media.entries()) {
    const path = `${tenantId}/${postId}/ai-${stamp}-${String(i).padStart(2, "0")}.${ext[m.mime] ?? "bin"}`;
    const { error } = await db.storage.from("media").upload(path, m.bytes, { contentType: m.mime, upsert: true });
    if (error) throw new Error(`upload: ${error.message}`);
    rows.push({ tenant_id: tenantId, post_id: postId, position: i, kind: m.kind, storage_path: path });
  }
  const { error } = await db.from("post_media").insert(rows);
  if (error) throw new Error(`post_media: ${error.message}`);
}
