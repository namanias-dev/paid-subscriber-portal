# Notes Store — DLT templates to submit

Drafted 2026-09-17. **Not yet submitted** — I cannot access the TRAI DLT operator account from this environment.

Submit these four as **transactional / service** templates under sender ID `NAMIAS`, entity **Naman Sharma IAS Academy**. Quiet hours do not apply (transactional). GSM-7, "Rs" not "₹", no emoji.

Paste the registered Template IDs back into the portal before flipping `notes_store_sms`.

## 1. Order confirmed  `notes_order_confirmed`

**DLT body:**

```
Hi {#var#}, order {#var#} is confirmed. We are preparing your notes. Track: {#var#} Naman Sharma IAS Academy.
```

| Slot | Variable |
|---|---|
| 1 | first_name |
| 2 | order_no |
| 3 | track_url |

## 2. Shipped + AWB  `notes_order_shipped`

**DLT body:**

```
Hi {#var#}, order {#var#} has shipped via {#var#} AWB {#var#}. Track: {#var#} Naman Sharma IAS Academy.
```

| Slot | Variable |
|---|---|
| 1 | first_name |
| 2 | order_no |
| 3 | courier |
| 4 | awb |
| 5 | track_url |

## 3. Delivered  `notes_order_delivered`

**DLT body:**

```
Hi {#var#}, order {#var#} has been delivered. Thank you. Naman Sharma IAS Academy.
```

| Slot | Variable |
|---|---|
| 1 | first_name |
| 2 | order_no |

## 4. Action required  `notes_order_action_required`

**DLT body:**

```
Hi {#var#}, delivery of order {#var#} needs your action. Please call {#var#}. Naman Sharma IAS Academy.
```

| Slot | Variable |
|---|---|
| 1 | first_name |
| 2 | order_no |
| 3 | support_phone |

Human step: log into the DLT portal, paste the four bodies, save the Template IDs, reply here with the IDs and the submission date.
