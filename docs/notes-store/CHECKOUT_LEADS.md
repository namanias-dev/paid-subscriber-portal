# Notes checkout leads

A checkout lead is created only after a valid Indian mobile number is known and the cart has at least one item. Adding a product to the cart does not create a lead.

The save runs in the background from checkout, and again when Pay creates the order. A failure is ignored. Checkout and ICICI are not blocked.

## Status

`checkout_stage` is the commerce state: `CONTACT_CAPTURED`, `DETAILS_IN_PROGRESS`, `PAYMENT_INITIATED`, `CHECKOUT_ABANDONED`, `PAYMENT_ABANDONED`, `CONVERTED`, `EXPIRED`.

`sales_status` is the staff state: `NEW`, `CONTACTED`, `FOLLOW_UP`, `CONVERTED`, `NOT_INTERESTED`, `DO_NOT_CONTACT`.

Someone still typing is not abandoned. Contact-only and address-in-progress leads become `CHECKOUT_ABANDONED` after 2 hours without activity. A payment that was started becomes `PAYMENT_ABANDONED` after 6 hours without activity. A later visit or a successful payment updates the same open lead. One open lead per phone. A later separate purchase can create a new lead after the earlier one is `CONVERTED`.

## Consent

The WhatsApp/SMS checkbox is optional and unchecked. Shipping a phone number is not promotional consent. Automated abandoned-checkout messages are off. They need a production messaging provider, `marketing_consent = true`, and a sales status other than `DO_NOT_CONTACT` or `NOT_INTERESTED`. Before any future send, the order must be checked so a paid student is not asked to complete a purchase they already made.

## Retention

Unconverted leads with no order and no do-not-contact flag leave the active queue after 180 days. Name, email, and address are cleared and the stage becomes `EXPIRED`. Paid order contact data on `store_orders` is not deleted. `DO_NOT_CONTACT` is kept so a later checkout does not open a fresh promotional lead for that phone.

## Sales Telegram

Abandoned leads are not sent when the phone is first saved. The existing sweep is the only abandonment clock: 2 hours without activity for checkout, 6 hours after payment was started. After that transition, one message goes to the existing Sales & Admissions channel. A later payment abandonment can send one hotter update. A paid order suppresses an unsent abandonment alert, and a lead that was already alerted is then marked converted on that same message. Do-not-contact leads are not given a call instruction. Leads that were already due before this alert cutoff are not sent. Telegram failure does not change the lead, the checkout, or the payment.

## Admin

`/admin/notes/leads` for staff with `store_view_orders` or `store_manage_orders`. The list shows a masked phone. The detail view can call or copy the phone. Recovery links and sales-status updates are Super Admin only. The recovery URL contains only a random token. `/admin/notes/analytics` is Super Admin only and adds lead, abandoned, recovered, and recovered-revenue figures without changing the purchase funnel.
