-- Timeline event types for proof → payment recording / reversal.
alter table public.student_access_events drop constraint if exists student_access_events_event_type_check;
alter table public.student_access_events add constraint student_access_events_event_type_check
  check (event_type in (
    'reminder_sent','reminder_failed','extension_granted','extension_revoked','extension_expired',
    'call_task_created','access_blocked','access_restored','admin_flag',
    'proof_uploaded','proof_approved','proof_approved_recorded','proof_rejected','provisional_access_granted','proof_superseded',
    'payment_recorded','proof_payment_reversed'
  ));
