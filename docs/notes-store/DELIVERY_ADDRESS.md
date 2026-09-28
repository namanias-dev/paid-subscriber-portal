# Delivery address confirmation

Checkout still uses the existing PIN, city, and state check. After that check passes, the student confirms the formatted address with “Yes, deliver here”. Opening Google Maps is optional and uses a normal Maps search URL. There is no Google API key and no Maps Platform billing.

Pay stores that confirmation on the new `store_addresses` row, together with the raw lines and a spacing-normalized copy. The order points `shipping_address_id` at that row. Billing stays on the original row when staff later change only the delivery address.

A delivery-address change depends on the shipment:

- No shipment: the order points at the new address. The next fulfillment reads that address.
- AWB exists and the courier has not taken the parcel: staff must confirm. The current shipment is cancelled first. A new shipment is created only after that cancellation is accepted. If cancellation is unclear, nothing new is booked.
- The courier already has the parcel, or the order is delivered: the delivery address is not rewritten. Staff can record that a change was requested.

Older orders have no confirmation status. They show “Legacy order / not recorded”.
