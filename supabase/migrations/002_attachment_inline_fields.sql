-- 002_attachment_inline_fields.sql
-- Adds inline/embedded attachment support to email_attachments.

alter table email_attachments
  add column if not exists is_inline boolean not null default false,
  add column if not exists content_id text,
  add column if not exists content_disposition text;
