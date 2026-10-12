# Notes Store SMS (DLT-approved templates)

Source of truth for the text: `Naman_IAS_Notes_SMS_Template_Approval_Tracker Final.xlsx`, sheet "Notes SMS Templates", rows 6–10 (all "Approved"). The canonical copy in code is `lib/sms/notesApproved.ts`. `tests/notes-sms/approved-templates.test.ts` holds an independent copy typed from the tracker, and the migration `supabase/migrations/2026-10-11-notes-sms-approved-templates.sql` is checked against the fixture.

| Key | DLT id | Type | Variables (slot order) | Automation |
|---|---|---|---|---|
| NOTES_ORDER_CONFIRMED_01 | 1777179058711611732 | Service Implicit | `{#alp#}` subject · `{#num#}` amount · `{#urg#}` `/notes/track` | `notes_order_confirmed` |
| NOTES_PAYMENT_PENDING_01 | 1777179057396343991 | Service Implicit | `{#alp#}` subject · `{#num#}` amount due · `{#urg#}` product page or `/notes` | `notes_payment_pending` (delay ≥ 60 min) |
| NOTES_CHECKOUT_INCOMPLETE_01 | 1777179058827172599 | Service Implicit | `{#urg#}` `/notes` | `notes_checkout_incomplete` |
| NOTES_NEW_LEAD_PROMO_01 | 1777179057434102445 | Promotional | `{#urg#}` `/notes` | `notes_new_lead_promo` |
| NOTES_DISCOUNT_NOTES500_01 | 1777179057448502622 | Promotional | `{#urg#}` `/notes` | none (manual only) |

Text is never edited: `Rs.` stays `Rs.`, the brand suffix stays, and templates 3–5 keep U+2019 (’).

## How a send happens

1. **Plan** (`lib/store/sms/plan.ts`, pure). `buildAndValidateNotesOrderSms` / `buildAndValidateNotesLeadSms` / `buildAndValidateNotesAcademyLeadPromo` take one order or lead and return the exact text, the masked destination, an idempotency key, record blockers, and a template hold. Phone, subject, amount and link all come from that one record. The client only names the template and the record.
2. **Send** (`lib/store/sms/send.ts`). Checks the `notes_store_sms` flag, rebuilds the plan from the database and refuses if anything changed, then calls the academy sender `sendSms` with `notesExpectedBody`.
3. **sendSms** (`lib/sms/service.ts`). Refuses a Notes template whose stored row drifted from the approved one, refuses one sent without the Notes path, refuses Notes promos in quiet hours (no deferral), and refuses when the rendered body differs from the plan text. The UNIQUE `sms_logs.dedupe_key` makes repeated callbacks and cron runs collapse to one message.
4. **Gateway** (`lib/sms/gateway.ts`). A message under a Notes DLT id must match the approved skeleton with valid slot values. Notes ids are refused in bulk sends.

The generic Mission Control send, batch, resend and template edit paths refuse Notes templates.

## Holds (template-level, shown in Mission Control)

- `template_drift:<fields>`: the stored `sms_templates` row differs (body, DLT id, type, category, sender, route, status). Fix with the Super Admin "Replace with approved text" action, or re-run the migration.
- `approved_text_not_gsm7`: templates 3–5 contain ’ (U+2019). The send guard blocks non-GSM-7 bodies, and no Unicode SMS has been proven on this gateway. They stay held until the owner confirms with the DLT agency which character is registered, or a Unicode send is proven.
- `promo_code_*` (NOTES500): the code must exist, be active, be in date, have redemptions left, and be a fixed Rs.500 discount.

## Automations and cutover

Switched on in Mission Control → Notes Store (Super Admin). Switching one on records `sms_settings.data.notesCutover[trigger] = now`. Only orders and leads after the cutover are considered, so enabling never backfills. The cron `sms-dispatch` runs the jobs. Each job sends at most 20 messages per pass.

- Order confirmed: the payment capture schedules the send (`lib/store/notifications.ts` → `fireNotesOrderConfirmedSms`). The cron catch-up covers 48 h inside the send window.
- Payment pending: orders in PAYMENT_PENDING/FAILED/EXPIRED, at least `delay` minutes old and at most 24 h old, with no open bank attempt, no capture, no later order on the same phone, and no pending SMS to that phone in 24 h.
- Checkout incomplete: CHECKOUT_ABANDONED leads with consent, no order, not test, and no recovery SMS in 7 days. Held while the template is held.
- New lead promo: academy leads with `consent_status = explicit` only, in promo hours, once per template per phone, at most one Notes promo per 7 days. Held while the template is held.

## Manual send

- Mission Control → Notes Store: dry run by order number or checkout lead id, then send.
- Order detail → Customer SMS.
- Checkout leads drawer → Customer SMS.

Permissions: preview needs `send_sms` + `store_view_orders`. Service sends need `store_manage_orders`. Promotional sends and template reconcile need a Super Admin. Manual sends reuse the automation key, so an order never gets the same message twice. After a provider failure, up to 2 retries are allowed.

## Audit

- `sms_logs`: `audience_type = notes_store`, `trigger_event` = the automation trigger or `notes_manual_send`, and `dedupe_key`.
- Order events: `store_order_events` gets `sms_submitted` / `sms_failed` with the template key, DLT id, log id and the masked phone.
- Status wording: "Accepted" means the provider accepted the request. "Delivered" comes only from the delivery report.
