-- Webinar hosted recordings (video FILE upload) — reuses the R2 multipart
-- pipeline used by course lectures. These columns hold the upload/multipart
-- state and the final playable object key. A non-empty recording_key with
-- recording_upload_status = 'completed' means a hosted recording is ready;
-- it is served via a short-lived signed URL (never stored as a public link).
-- The existing recording_link (pasted YouTube/Drive/etc.) is left untouched.

alter table public.webinars
  add column if not exists recording_upload_status   text,   -- null | uploading | completed | failed
  add column if not exists recording_upload_id       text,   -- active multipart upload id (resume)
  add column if not exists recording_multipart_key   text,   -- R2 key being/was uploaded
  add column if not exists recording_key             text,   -- final playable R2 object key
  add column if not exists recording_duration_seconds integer,
  add column if not exists recording_file_size       bigint;
