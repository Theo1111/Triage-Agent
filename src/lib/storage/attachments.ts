// Supabase Storage backend for email attachments.
//
// Requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and ATTACHMENT_STORAGE_BUCKET.
// Uploads go directly from memory buffer → Supabase Storage via the REST API,
// so no local filesystem writes occur (safe on Vercel / serverless).

export interface StoredAttachment {
  bucket: string;
  storagePath: string;
}

function getConfig(): { baseUrl: string; serviceRoleKey: string; bucket: string } {
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.ATTACHMENT_STORAGE_BUCKET;

  if (!supabaseUrl || !serviceRoleKey || !bucket) {
    throw new Error(
      "Supabase Storage is not configured. " +
      "Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and ATTACHMENT_STORAGE_BUCKET in environment variables."
    );
  }

  return { baseUrl: `${supabaseUrl}/storage/v1`, serviceRoleKey, bucket };
}

function sanitizeFilename(filename: string): string {
  // Strip directory components, then replace unsafe chars.
  const base = filename.replace(/.*[/\\]/, "");
  return base.replace(/[^a-zA-Z0-9._-]/g, "_") || "attachment";
}

// Upload an attachment buffer directly to Supabase Storage.
// Uses x-upsert: true so a retry on the same (emailId, attachmentId) is safe.
export async function storeAttachment(input: {
  emailId: string;
  attachmentId: string;
  filename: string;
  data: Buffer;
  mimeType?: string;
}): Promise<StoredAttachment> {
  const { baseUrl, serviceRoleKey, bucket } = getConfig();

  const safeName = sanitizeFilename(input.filename);
  const storagePath = `${input.emailId}/${input.attachmentId}_${safeName}`;
  const url = `${baseUrl}/object/${bucket}/${storagePath}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": input.mimeType ?? "application/octet-stream",
      "x-upsert": "true",
    },
    body: new Uint8Array(input.data),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "(no body)");
    throw new Error(`Supabase Storage upload failed [HTTP ${res.status}]: ${body}`);
  }

  return { bucket, storagePath };
}

// Download an attachment from Supabase Storage.
export async function readAttachment(storagePath: string): Promise<Buffer> {
  const { baseUrl, serviceRoleKey, bucket } = getConfig();

  const url = `${baseUrl}/object/${bucket}/${storagePath}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${serviceRoleKey}` },
  });

  if (!res.ok) {
    throw new Error(`Supabase Storage read failed [HTTP ${res.status}] for path: ${storagePath}`);
  }

  return Buffer.from(await res.arrayBuffer());
}
