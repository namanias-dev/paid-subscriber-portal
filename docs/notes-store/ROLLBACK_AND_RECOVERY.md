# Notes Store — rollback and recovery

## Soft off (preferred)

1. Set `notes_store` `enabled=false` and/or `kill_switch=true` in `app_feature_flags`.  
2. Remove or unset preview `NOTES_STORE_PREVIEW_ENABLE` if needed.  
3. Public `/notes` goes dark; nav hides via status API.  
4. **Paid orders remain in `store_*`** — do not delete.

## Code rollback

- Revert/deploy previous commit or tag. Prefer revert commits over force-push.  
- Handoff tag `notes-store-handoff-2026-09-19` is recovery reference for this snapshot.  
- Do not merge destructive schema drops for `store_*` without a plan that preserves paid rows.

## Payment safety during rollback

- Open `PAYMENT_PENDING` rows may still Verify via cron if cron remains deployed.  
- Disabling storefront does not cancel ICICI charges.  
- Never roll back by wiping `store_order_payments` for captured money.

## What must never be rolled back destructively

Customer PII in `store_orders` / addresses; captured payment rows; inventory ledger history needed for ops reconciliation.
