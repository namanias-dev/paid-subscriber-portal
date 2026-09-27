# Notes Store campaign links

Use these on the first URL only. The site stores first touch and last touch in a first-party cookie, then copies that snapshot onto the order before ICICI opens. Later pages do not need the parameters.

Always use `https://www.namanias.com` so the www redirect does not split the visit.

| Place | Example |
| --- | --- |
| Instagram Story, Polity | `https://www.namanias.com/notes/polity?utm_source=instagram&utm_medium=story&utm_campaign=notes_launch&utm_content=polity_story_01` |
| Instagram Story, Economy | `https://www.namanias.com/notes/economy?utm_source=instagram&utm_medium=story&utm_campaign=notes_launch&utm_content=economy_story_01` |
| Instagram Auto-DM / ManyChat | `https://www.namanias.com/notes?utm_source=instagram&utm_medium=autodm&utm_campaign=notes_launch&utm_content=reel_polity_01` |
| WhatsApp | `utm_source=whatsapp&utm_medium=message` |
| Telegram | `utm_source=telegram&utm_medium=community` |
| YouTube | `utm_source=youtube&utm_medium=organic` |
| Meta Ads | `utm_source=meta&utm_medium=paid_social` plus `utm_campaign`, `utm_content`, and the platform click id (`fbclid`) |
| Google Ads | `utm_source=google&utm_medium=cpc` plus `gclid` / `gbraid` / `wbraid` from auto-tagging |

`utm_content` is the creative: one value per Reel, Story frame, or DM, not one generic Auto-DM link for every Reel.

Build the same URLs in Admin → Notes Store → Analytics → Campaign links.

QA traffic uses `utm_source=qa` or `utm_campaign=notes_analytics_validation`. Those events are stored and excluded from the business totals.
