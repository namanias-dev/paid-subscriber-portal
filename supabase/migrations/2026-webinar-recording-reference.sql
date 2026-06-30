-- Allow a webinar to REUSE (reference) an already-uploaded hosted video as its
-- recording instead of re-uploading. When true, recording_key points to an R2
-- object OWNED by another row (a course/lecture content_item). It must therefore
-- never be deleted when the webinar's recording is removed/replaced — only the
-- reference is cleared. Webinar-owned uploads keep this false (default).
alter table public.webinars
  add column if not exists recording_is_reference boolean default false;
