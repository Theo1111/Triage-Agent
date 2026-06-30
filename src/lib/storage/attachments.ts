import fs from "fs/promises";
import path from "path";
import { env } from "@/src/config/env";

// V1: store attachments on the local filesystem under ./storage/attachments/.
// Replace this file's implementation to swap in S3, GCS, or Supabase Storage.
const STORAGE_ROOT = path.join(process.cwd(), "storage", "attachments");

export interface StoredAttachment {
  bucket: string;
  storagePath: string;
}

// Returns { bucket, storagePath } for use in the DB record.
export async function storeAttachment(input: {
  emailId: string;
  attachmentId: string;
  filename: string;
  data: Buffer;
}): Promise<StoredAttachment> {
  const dir = path.join(STORAGE_ROOT, input.emailId);
  await fs.mkdir(dir, { recursive: true });

  // Sanitize filename to avoid path traversal.
  const safeName = path.basename(input.filename).replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = path.join(input.emailId, `${input.attachmentId}_${safeName}`);
  const fullPath = path.join(STORAGE_ROOT, storagePath);

  await fs.writeFile(fullPath, input.data);

  return {
    bucket: env.ATTACHMENT_STORAGE_BUCKET,
    storagePath,
  };
}

export async function readAttachment(storagePath: string): Promise<Buffer> {
  const fullPath = path.join(STORAGE_ROOT, storagePath);
  return fs.readFile(fullPath);
}
