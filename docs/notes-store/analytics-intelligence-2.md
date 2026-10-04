NAMAN IAS NOTES STORE — ANALYTICS INTELLIGENCE 2.0

SALES + SUBJECTS + CUMULATIVE GROWTH + GEOGRAPHY + SHIPPING ECONOMICS + INDIA HEATMAP + FULFILLMENT

Production routes:

[https://www.namanias.com/admin/notes/analytics?range=30d](https://www.namanias.com/admin/notes/analytics?range=30d)

[https://www.namanias.com/admin/notes](https://www.namanias.com/admin/notes)

THIS IS A LIVE PRODUCTION SYSTEM.

The current Notes Store Analytics dashboard is good but incomplete.

Today it primarily answers:

- Visitors

- Product viewers

- Add to cart

- Checkout

- Paid orders

- Conversion

- Revenue

- AOV

- Sales over time

- Funnel

- existing acquisition/product/city analytics further down the page

I want to upgrade this into a serious ecommerce + fulfillment intelligence dashboard.

The owner should be able to answer from ONE page:

1. What are we selling?

2. Which subject is performing best?

3. Where are orders coming from?

4. Which states/cities generate the most revenue?

5. How quickly is cumulative sales growing?

6. How many parcels are being picked up/shipped/delivered?

7. What are we paying for shipping?

8. Which state/city/courier is expensive?

9. Are any shipping rates anomalous?

10. Are we suddenly paying ₹200–₹250 for a lane that is normally ₹80–₹120?

11. Which couriers are economical/reliable?

12. Where should we investigate operationally?

Build all of this in ONE production-safe upgrade.

NO midpoint approval required.

Audit → implement → test → build → deploy → production smoke.

==================================================

0. CRITICAL PRODUCTION / BRANCH PREFLIGHT

==================================================

We recently had production regressions caused by feature branches missing previously-live commits.

DO NOT repeat this.

Before changing anything:

1. identify the EXACT commit currently serving [namanias.com](http://namanias.com)

2. identify deployed production branch

3. diff working branch against production

4. start from exact live production

5. verify currently-live functionality remains present

Important currently-live capabilities include:

- manual courier selection after Packed

- Compare Couriers workflow

- safe courier city/district normalization

- strict shipping PIN/state checks

- Delhivery blank-phone read-back fix

- invoice invariant/self-healing

- ICICI merchant-amount/card-fee handling

- customer-centric Notes Orders view

- package resolution

- tracking

- current Notes analytics

- existing Notes attribution/funnel

- current admin auth

Do NOT deploy from stale master.

Do NOT silently remove any feature because another branch lacks it.

Final report must state:

previous production SHA

working branch

new SHA

preservation verification

==================================================

1. PRODUCTION SAFETY

==================================================

This upgrade is:

READ-ONLY ANALYTICS

+

ADMIN UI

+

SAFE AGGREGATION

DO NOT change:

- checkout

- payment

- captured amounts

- orders

- invoices

- discounts

- leads

- addresses

- fulfillment statuses

- package values

- courier selection

- Shiprocket

- Delhivery

- AWBs

- pickup

- tracking

- customer tracking

- Telegram

No real production shipping write during QA.

No test payment.

No real order changes.

Zero downtime.

==================================================

2. AUDIT EXISTING ANALYTICS ARCHITECTURE

==================================================

Before implementation inspect:

/admin/notes/analytics

Find:

- current date range implementation

- KPI API/query

- analytics_events aggregation

- paid-order aggregation

- daily sales buckets

- revenue definition

- paid units definition

- city analytics

- product analytics

- attribution analytics

- shipping data available

- shipment rate fields

- current shipment resolver

- current order destination snapshot

- current tracking/event timestamps

- current chart library

- Motion / Framer Motion

- existing tooltips/components

- current caching/revalidation

Do not build duplicate analytics infrastructure.

==================================================

3. VISUAL SYSTEM

==================================================

Keep the design language already established.

Think:

Stripe analytics

Shopify Admin

Linear

Vercel

premium logistics intelligence

Use:

navy

warm ivory

neutral gray

restrained gold

subtle green/red for positive/issues

No:

rainbow dashboard

Power BI appearance

huge gradients

neon

3D

gimmicky charts

generic admin template

The current dashboard is already visually clean.

UPGRADE IT.

Do not redesign it from scratch.

==================================================

4. LIBRARY POLICY

==================================================

Audit existing packages first.

For charts:

reuse the current chart library.

The current Sales over time chart already exists, so DO NOT install a competing chart system if current library can support:

- bars

- lines

- area

- tooltips

- responsive layout

For animations:

reuse Motion / Framer Motion already used in the portal.

For map:

First check whether a geography/SVG map library or India state asset already exists.

If none exists and a dependency is genuinely necessary:

install ONE small, mature, actively-maintained React/SVG geography solution.

Preferred architecture:

React/SVG map

+

locally bundled India states/UT GeoJSON/TopoJSON

No runtime request to a third-party mapping service.

NO Google Maps API.

NO Mapbox billing.

NO external map tiles.

NO heavy WebGL.

Use a properly licensed/open-data India states/UT boundary asset and document its source/license in repo docs.

Map code must be admin-route scoped.

==================================================

5. DATE RANGE — ONE SOURCE OF TRUTH

==================================================

Existing:

Today

Yesterday

Last 7 days

Last 30 days

This month

Custom

must control all COHORT analytics:

sales

revenue

units

subject performance

geographic sales

shipping economics for orders captured in period

Do not add random independent date selectors to every section.

However distinguish:

A. SALES COHORT ANALYTICS

orders captured/paid in selected range

B. FULFILLMENT ACTIVITY

pickup/shipped/delivered EVENTS that happened during selected range

C. FULFILLMENT NOW

current operational snapshot independent of range

Label these clearly.

==================================================

6. BUSINESS TIMEZONE

==================================================

Use:

Asia/Kolkata / IST

for:

daily sales buckets

pickup activity

shipped events

delivered events

Today/Yesterday

chart labels

unless current analytics has another explicit established business timezone.

Do not group Indian sales by UTC.

==================================================

7. TOP KPI AREA — DO NOT JUST CRAM MORE CARDS

==================================================

Current primary KPI row:

Visitors

Product viewers

Add to cart

Checkout

Paid orders

Conversion

Revenue

AOV

KEEP IT.

Do not squeeze 12 tiny cards into one row.

Below it add a compact second intelligence strip:

COMMERCE & FULFILLMENT

Suggested cards:

AVG BOOKED SHIPPING

CURRENT PACKED

CURRENT PICKUP

CURRENT IN TRANSIT

DELIVERED TODAY

Potential sixth if layout fits:

SHIPPED TODAY

These should visually belong to analytics but remain secondary to revenue/conversion KPIs.

==================================================

8. AVG BOOKED SHIPPING RATE

==================================================

Bring the shipping KPI from Notes Orders into Analytics.

Display:

AVG SHIPPING RATE

₹XX.XX

₹YY min · ₹ZZ max

Example only.

Use actual data.

IMPORTANT:

This is NOT customer shipping charged at checkout.

Do NOT use:

₹59

₹79

₹99

unless those happen to be provider rates.

Use the saved BOOKED COURIER RATE of the canonical active/final shipment.

Label/tooltip:

“Booked courier rate. Provider invoice charge may differ.”

==================================================

9. SHIPPING RATE ELIGIBILITY

==================================================

For selected-range shipping economics:

Start with CAPTURED Notes orders whose payment occurred within selected analytics range.

For each order select maximum ONE valid canonical shipment:

- active shipment

- or final successful shipment if delivered

Include known booked rate from:

pickup

picked up

shipped

in transit

out for delivery

delivered

and any valid booked pre-pickup shipment if that is the canonical shipment.

Exclude:

cancelled

superseded

failed candidates

test

duplicate AWBs

unpaid

raw quote options never booked

If booked rate missing:

do not treat as zero.

Track:

rate coverage

Example:

Shipping rate available:

31 / 38 orders

==================================================

10. CURRENT FULFILLMENT CARDS

==================================================

Bring useful operational counts from the Notes Orders page.

CURRENT PACKED

CURRENT PICKUP

CURRENT IN TRANSIT

DELIVERED TODAY

These are current/live operational state.

They do NOT need to equal sales selected date range.

Add a subtle label:

“Current fulfillment”

so nobody confuses these with selected-range sales.

Clicking a card may link to:

/admin/notes?status=packed

or corresponding existing filter if route/query architecture supports it safely.

Do not duplicate filter logic.

==================================================

11. SUBJECT PERFORMANCE — DYNAMIC

==================================================

Add a new section:

SUBJECT PERFORMANCE

Do NOT hardcode:

Polity

Economy

Read current Notes products dynamically.

Future:

Modern History

Ethics

Geography

etc.

should automatically appear when live and sold.

==================================================

12. SUBJECT CARDS

==================================================

Show compact premium subject cards.

Example:

INDIAN POLITY

11 orders

12 units

₹27,450

Net product revenue

42% of units

small sparkline

Then:

INDIAN ECONOMY

...

Make them visually compact.

==================================================

13. SUBJECT SORT CONTROL

==================================================

Section control:

Revenue | Orders | Units

Default:

Revenue

Cards reorder smoothly when selected.

Use subtle Motion layout animation.

Do not reload page.

==================================================

14. SUBJECT METRIC DEFINITIONS

==================================================

ORDERS:

unique captured orders containing subject

UNITS:

sum quantity for subject

SUBJECT REVENUE:

DO NOT assign full order revenue to every product.

That would double-count mixed orders.

Calculate NET PRODUCT REVENUE.

Use order line merchandise values.

If order-level discount applies:

allocate discount proportionally across eligible product line gross values using deterministic integer-paise allocation.

Exclude customer shipping charge from SUBJECT revenue.

Therefore label:

Net product revenue

not simply:

Revenue

Subject revenue totals should reconcile to:

captured merchandise revenue

after allocated discounts

before customer shipping charge

Document this.

==================================================

15. SUBJECT CARD DETAILS

==================================================

Useful subject card data:

Orders

Units

Net product revenue

Average net merchandise/order

Share of units

Share of product revenue

Optional:

small daily sales sparkline

Do not overload.

Primary:

Revenue / Orders / Units based on selected subject ranking mode.

==================================================

16. SALES OVER TIME — UPGRADE

==================================================

Current chart:

Sales over time

with:

Paid orders

Revenue

Units

KEEP these.

Upgrade controls to:

METRIC:

Paid orders

Revenue

Units

Picked up

Shipped

Delivered

MODE:

Daily

Cumulative

==================================================

17. DAILY MODE

==================================================

Existing Daily mode can remain:

Paid orders:

bar chart

Revenue:

bar chart or existing style

Units:

bar chart

Picked up:

bars

Shipped:

bars

Delivered:

bars

Subtle animation on metric change.

==================================================

18. CUMULATIVE MODE

==================================================

This is a major new feature.

When:

CUMULATIVE

selected:

switch visualization into a premium animated line/area chart.

Examples:

Cumulative Paid Orders

0

1

1

3

8

12

19

...

Cumulative Revenue

₹0

₹2.6K

₹7.6K

₹...

Cumulative Units

...

Line must NEVER decrease.

Use running sum from selected period start.

==================================================

19. CUMULATIVE DESIGN

==================================================

Use:

thin navy line

restrained translucent area under line if tasteful

small current endpoint

subtle tooltip

very light grid

On toggle:

bar chart crossfades/morphs to line chart.

Line draws left → right.

Use Motion or chart library's efficient path animation.

No bouncing.

No looping animation.

Reduced motion:

render static.

==================================================

20. CUMULATIVE RECONCILIATION

==================================================

For sales metrics:

last cumulative Paid Orders value

=

Paid Orders KPI for selected period

last cumulative Revenue

=

Revenue KPI

last cumulative Units

=

paid units for selected range

Required tests.

==================================================

21. FULFILLMENT EVENT METRICS

==================================================

Picked up

Shipped

Delivered

are EVENT metrics.

Bucket using authoritative event timestamp.

Examples:

picked_up_at

shipped_at

delivered_at

or actual canonical equivalents.

Do not use:

order created_at

generic updated_at

as substitutes.

==================================================

22. “IN TRANSIT” SEMANTICS

==================================================

Do NOT plot “In transit per day” as if it were an event unless there is a canonical entered_in_transit event.

Instead:

Current In Transit

=

snapshot KPI

If actual transition event exists:

metric may be called:

Entered transit

not:

In transit orders

Avoid semantic confusion.

==================================================

23. TODAY GRANULARITY

==================================================

For Today/Yesterday:

sales chart may use hourly buckets if current architecture already supports it cleanly.

Cumulative Today:

running hourly total.

For >=7 days:

daily buckets.

==================================================

24. ZERO DAYS

==================================================

Include empty date buckets as zero.

Do not omit days.

Otherwise trend shape becomes misleading.

==================================================

25. GEOGRAPHIC INTELLIGENCE — NEW MAJOR SECTION

==================================================

Create:

GEOGRAPHIC INTELLIGENCE

Desktop preferred:

LEFT:

India state heatmap

RIGHT:

state ranking

Below:

city ranking / detail

Mobile:

stack map → ranking → city.

==================================================

26. INDIA HEATMAP

==================================================

Build a clean India states + union territories choropleth.

Not a generic map screenshot.

Use vector SVG.

Default metric:

PAID ORDERS

Controls:

Orders

Revenue

Units

Avg shipping

Possibly:

Shipping anomalies

if visually useful.

==================================================

27. MAP COLORS

==================================================

Stay within brand.

Use a monochromatic navy/gold scale.

Example:

low:

very pale neutral/navy

high:

deep navy

For Avg Shipping:

could use neutral → restrained gold/amber at expensive end

Do NOT use rainbow heatmaps.

No red/green map where color meaning becomes confusing.

==================================================

28. STATE NORMALIZATION

==================================================

Build/reuse canonical India state normalization.

Examples:

Odisha / Orissa

NCT of Delhi / Delhi

Uttaranchal / Uttarakhand

should map appropriately.

Do not merge unrelated states.

Use immutable order delivery-state snapshot.

Unknown/unrecognized:

separate “Unknown” bucket.

Do not drop those orders from totals.

==================================================

29. MAP TOOLTIP

==================================================

Hover desktop / tap mobile:

ODISHA

Paid orders: 10

Units: 12

Revenue: ₹28,490

Polity: 7 units

Economy: 5 units

Avg booked shipping: ₹96.20

Min: ₹65.98

Max: ₹156.84

Top courier:

Xpressbees Surface

Shipping-rate coverage:

8 / 10 orders

Use actual values.

Do not show fields without data.

==================================================

30. MAP CLICK

==================================================

Clicking a state should NOT unexpectedly filter the entire analytics page.

Preferred:

select state locally within Geographic Intelligence.

Then update:

state detail

city ranking

Example:

Selected:

Maharashtra

Cities:

Mumbai

Pune

Nagpur

Thane

Provide:

Clear selection

Keep global date range untouched.

==================================================

31. STATE RANKING

==================================================

Next to map create ranked state list.

Controls shared with map:

Orders | Revenue | Units | Avg shipping

Example:

1 Odisha             10 orders

2 Maharashtra         8

3 Delhi               6

Use compact horizontal bars.

Top 8–10.

View all optional.

==================================================

32. STATE ANALYTICS TABLE

==================================================

Provide compact expandable/detail table:

State

Paid orders

Units

Revenue

AOV

Shipments with rate

Avg shipping

Median shipping

Min

Max

Top courier

Rate anomalies

Sortable.

Do not show 20 columns simultaneously on mobile.

Desktop can use more.

==================================================

33. CITY ANALYTICS — EXPAND EXISTING

==================================================

If Paid Orders by City already exists:

upgrade it rather than duplicating.

Add metric toggle:

Orders

Revenue

Units

Avg shipping

For each city show:

City, State

Orders

Units

Revenue

Avg booked shipping

Optional secondary:

top courier

==================================================

34. CITY NORMALIZATION

==================================================

Use canonical delivery city/state.

Safe normalization only:

trim

case

spacing

known exact aliases

Do NOT aggressively fuzzy merge different places.

Use PIN-derived canonical location only if existing address infrastructure safely supports it.

==================================================

35. SHIPPING INTELLIGENCE — NEW SECTION

==================================================

Create:

SHIPPING INTELLIGENCE

This should answer:

Where are we overpaying?

Which courier costs what?

Which states/cities are expensive?

Are there unusual shipments?

==================================================

36. SHIPPING INTELLIGENCE SUMMARY

==================================================

Top mini KPIs inside section:

Avg booked rate

Median booked rate

Min

Max

Optional:

Rate coverage

Example:

AVG

₹96.40

MEDIAN

₹93.72

MIN

₹45.68

MAX

₹156.84

No giant cards.

==================================================

37. WHY MEDIAN MATTERS

==================================================

Include median internally.

Shipping rates can have outliers.

Average alone can be misleading.

Use median in anomaly logic.

==================================================

38. SHIPPING BY STATE

==================================================

Create ranked/table view:

State

Shipments

Avg shipping

Median shipping

Min

Max

Avg parcel weight

Top courier

Example:

Odisha

10 shipments

₹105 avg

₹94 median

₹66 min

₹250 max

Then a ₹250 shipment becomes obvious.

==================================================

39. SHIPPING BY CITY

==================================================

Same concept:

City

State

Shipments

Avg rate

Median

Min

Max

Top city list can use compact bars.

Avoid giant tables by default.

==================================================

40. SHIPPING BY COURIER

==================================================

Add:

COURIER PERFORMANCE

For each courier/service:

Courier

Provider

Booked shipments

Avg rate

Median rate

Min

Max

Pickup success if reliable data exists

Delivered count

Rate share

Examples:

Delhivery Surface

Xpressbees Surface

Ekart Surface

Blue Dart Air

DTDC Air

Do not combine:

Blue Dart Air

Blue Dart Surface

unless provider/service taxonomy says they are same product.

==================================================

41. PROVIDER VS COURIER

==================================================

Preserve distinction:

Provider:

Shiprocket / Delhivery Direct

Courier:

Xpressbees / Ekart / Blue Dart / DTDC etc.

Analytics should allow:

courier/service performance

and optionally:

provider rollup.

==================================================

42. SHIPPING RATE DISTRIBUTION

==================================================

Add a simple distribution visualization.

Example buckets:

< ₹60

₹60–79

₹80–99

₹100–149

₹150–199

₹200+

Show shipment count.

This immediately answers:

“How many parcels are costing >₹100?”

Use compact bars.

No unnecessary histogram library.

==================================================

43. SHIPPING TARGET

==================================================

Owner goal:

prefer shipping <= ₹100 where a valid service exists.

Add:

UNDER ₹100

XX%

of shipments with known booked rate

and:

OVER ₹100

X shipments

Do NOT imply rates >₹100 are automatically wrong.

Just surface them.

==================================================

44. SHIPPING COST AS % OF ORDER VALUE

==================================================

Useful derived metric:

shipping burden

booked courier rate / captured order amount

Example:

₹94 shipping on ₹2,599 order

=

3.6%

This helps compare rates across different order sizes.

Add this in tooltip/table, not necessarily another huge KPI.

==================================================

45. PACKAGE WEIGHT NORMALIZATION

==================================================

Shipping analytics must understand package weight.

Do NOT compare:

500g single-book

against:

1kg two-book parcel

as though rate differences are necessarily anomalous.

Persist/read actual resolved package weight:

shipment snapshot

or order package

or product profile

according to canonical package resolver.

==================================================

46. SHIPPING ANOMALY DETECTION

==================================================

Create a small:

RATE ANOMALIES

card/table.

The goal is not machine learning.

Use a transparent robust heuristic.

Do NOT label orders fraudulent.

Call:

Rate anomaly

or

Unusually high rate

==================================================

47. ANOMALY COMPARISON GROUP

==================================================

Compare a shipment primarily against similar historical shipments:

same destination state

+

similar package weight band

Suggested weight bands:

<= 600g

601g–1100g

1101g–2000g

>2000g

Use actual data.

If enough observations, optionally further compare same courier/service.

==================================================

48. ANOMALY HEURISTIC

==================================================

Use robust statistics.

Preferred:

median + MAD/IQR type rule

but keep interpretation simple.

For small current datasets:

Only flag state/weight group anomaly when:

comparable shipment count >= 3

AND booked rate is materially above baseline.

One reasonable transparent condition:

rate >= 1.5 × peer median

AND

rate - peer median >= ₹40

OR a robust IQR/MAD outlier if existing stats helper supports it.

Choose ONE documented method.

Do not secretly change rule.

==================================================

49. ANOMALY EXAMPLE

==================================================

Concept:

Odisha

<=600g

median:

₹94

Order #1055:

₹245

+₹151

+161%

Display:

HIGH RATE

₹245

Typical similar shipments:

₹94 median

Not:

ERROR

FRAUD

==================================================

50. FALLBACK ANOMALY GROUP

==================================================

If state does not have enough comparable shipments:

fallback to:

same weight band nationally

but label comparison:

“Compared with similar-weight shipments”

Do not pretend it is Odisha-specific.

==================================================

51. ANOMALY TABLE

==================================================

Columns:

Order

City / State

Package

Courier

Booked rate

Peer median

Difference

Reason

Example reason:

“61% above similar 500g Maharashtra shipments”

Click:

View order

read-only navigation to order detail.

==================================================

52. DO NOT FLAG MISSING RATES

==================================================

Missing booked rate is:

Missing rate data

not:

₹0

not anomaly.

==================================================

53. SHIPPING RATE COVERAGE

==================================================

Display somewhere in shipping section:

Booked rate coverage

31 of 38 shipments

because historical orders may lack saved rate.

This prevents misleading averages.

==================================================

54. DO NOT CALL BOOKED RATE “ACTUAL COST”

==================================================

Important.

Current system may not have final provider invoice charge.

Therefore UI language:

Booked shipping rate

Avg shipping rate

Tooltip:

“Based on the rate saved when courier was booked. Final provider billing may differ.”

If provider_charge_paise becomes available later:

architecture can add:

Actual provider cost

separately.

Do not mix them.

==================================================

55. SALES VS SHIPPING RANGE SEMANTICS

==================================================

Geo/shipping economics should normally use:

orders CAPTURED in selected date range

Then inspect their canonical shipment.

This keeps:

orders

revenue

state

shipping

cohort-consistent.

However:

Picked up/Shipped/Delivered activity chart

uses event timestamp during selected range.

Document this distinction.

==================================================

56. REVENUE BY STATE

==================================================

Use same authoritative Revenue definition as current dashboard.

State revenue totals:

sum captured order totals assigned to each delivery state.

All states + Unknown

must equal Revenue KPI for selected range.

Required invariant.

==================================================

57. ORDERS BY STATE

==================================================

One captured order counts ONCE in one state.

A Polity + Economy order:

one order

two units

Do not count twice in state order total.

==================================================

58. UNITS BY STATE

==================================================

Sum item quantities.

Mixed order can contribute 2 units.

==================================================

59. SUBJECT BREAKDOWN INSIDE STATE

==================================================

Map tooltip/state details:

subject unit mix

Example:

Polity 6

Economy 4

Use units, not order occurrences, unless explicitly labelled.

==================================================

60. TOP SELLING SUBJECTS

==================================================

Subject performance section should answer:

Top by Revenue

Top by Orders

Top by Units

Do not create three separate massive sections.

Use one segmented control.

==================================================

61. SUBJECT SPARKLINES

==================================================

Optional but preferred:

tiny 7/30-day order or unit sparkline on subject card.

Use existing microchart component if available.

No new chart dependency.

==================================================

62. EXISTING FUNNEL

==================================================

KEEP the Funnel.

It remains highly useful.

Do not replace it.

Possible page structure:

1. Date range

2. Primary conversion KPIs

3. Commerce & Fulfillment summary

4. Subject Performance

5. Sales over time

6. Funnel

7. Geographic Intelligence

8. Shipping Intelligence

9. Existing acquisition/campaign diagnostics

Use existing page content intelligently.

Do not duplicate sections already below current screenshot.

==================================================

63. SMART DESKTOP LAYOUT

==================================================

Desktop 1280+:

Primary KPI row

Commerce/Fulfillment mini strip

Subject cards

Sales over time — full width

Funnel — full width or 7/12 depending existing lower cards

Geographic Intelligence:

Map 7/12

State ranking 5/12

City ranking below or side

Shipping Intelligence:

Cost analytics 7/12

Courier performance 5/12

Rate anomalies:

full-width compact table

Keep the dashboard visually balanced.

==================================================

64. MOBILE

==================================================

Do NOT simply squeeze desktop maps/tables.

At 390px:

KPI cards:

horizontal scroll

Subject cards:

horizontal snap/scroll or compact stack

Sales chart:

full width

Map:

full width

State ranking:

below map

Shipping stats:

2-column compact cards

Tables:

convert to compact ranked cards or horizontal internal scroll where necessary

No horizontal PAGE overflow.

==================================================

65. MAP MOBILE

==================================================

India map should remain tappable.

Tap a state:

show a compact bottom/inline detail card:

Odisha

10 orders

₹28,490 revenue

₹96 avg shipping

Polity 7 · Economy 5

Then city breakdown below.

No tooltip that requires hover on phone.

==================================================

66. MOTION

==================================================

Continue using current premium motion language.

Use Motion/Framer Motion for:

- subject card reordering

- chart metric toggle

- Daily ↔ Cumulative switch

- map state selection

- ranking updates

- tooltip appearance

- filter transitions

Subtle only.

No looping dashboard animations.

==================================================

67. CUMULATIVE CHART MOTION

==================================================

When entering Cumulative:

bar series fades

line draws left→right

area softly appears

When switching metric:

small crossfade

No full-page rerender.

==================================================

68. MAP MOTION

==================================================

Hover:

state fill changes subtly

Selected:

thin gold/navy outline

No zoom animation necessary.

No map pan/scroll complexity.

==================================================

69. NUMBER FORMATTING

==================================================

Use existing India-friendly formatter.

Examples:

₹2,599

₹49,822

₹1.14L where compact mode is appropriate

But tooltips can show exact value.

Orders/units:

integer only.

Shipping:

₹93.72

Do not round shipping rates to whole rupees if paise exists.

==================================================

70. AOV

==================================================

Keep existing AOV:

captured revenue / paid orders

Do not change definition.

==================================================

71. SHIPPING RATE KPI RECONCILIATION

==================================================

Analytics Avg Shipping Rate must match Notes Orders Avg Shipping Rate when:

same eligible shipment population/time semantics apply.

If Notes Orders uses all-time current shipments while Analytics is range-filtered:

values can differ.

Document why.

Do not create a hidden formula mismatch.

==================================================

72. STATE SHIPPING RECONCILIATION

==================================================

For selected range:

sum shipments-with-rate across state buckets

=

global shipping-rate coverage count

including Unknown.

==================================================

73. GEO RECONCILIATION

==================================================

State paid orders:

sum = Paid Orders KPI

State revenue:

sum = Revenue KPI

State units:

sum = Paid Units

including Unknown bucket.

==================================================

74. SUBJECT REVENUE RECONCILIATION

==================================================

Because subject revenue excludes customer shipping:

sum subject net product revenue

=

total captured merchandise revenue after discounts

NOT necessarily global Revenue KPI.

Add tooltip:

“Subject revenue excludes customer shipping.”

==================================================

75. SERVER-SIDE ANALYTICS MODEL

==================================================

Do NOT download all orders/shipments and aggregate in React.

Create/reuse efficient server-side aggregation.

Conceptual response:

summary

subjectPerformance

salesSeries

fulfillmentSeries

geoByState

geoByCity

shippingSummary

shippingByState

shippingByCity

shippingByCourier

shippingRateDistribution

shippingAnomalies

Use actual architecture/naming conventions.

==================================================

76. AVOID ONE GIANT API IF UNHEALTHY

==================================================

Balance intelligently.

Could use:

core analytics request

geo/shipping request

so a map failure does not blank Funnel/KPIs.

Use parallel server queries where appropriate.

Do not create 15 browser API calls.

==================================================

77. FAILURE ISOLATION

==================================================

If India map data fails:

sales dashboard remains usable.

If shipping analytics fails:

sales/funnel remain usable.

Each major section gets small local error state.

Do not 500 entire analytics page.

==================================================

78. PERFORMANCE

==================================================

No N+1.

Use:

SQL aggregation

joins

RPC

server service

according to current architecture.

Target data scale:

100

1,000

10,000+

orders

without architecture rewrite.

==================================================

79. DATABASE INDEX AUDIT

==================================================

Inspect indexes supporting:

paid/captured timestamp

order status

shipment order_id

shipment status

shipment booked rate

delivery state/city

order lines

Only add indexes if query plan genuinely needs them.

Migration if needed:

additive only.

No destructive changes.

==================================================

80. MAP DATA MUST NOT REQUIRE DB GEO COORDINATES

==================================================

State-level map uses normalized state names/codes.

No geocoding API.

No latitude/longitude required.

==================================================

81. SHIPPING OUTLIER DATA IS READ-ONLY

==================================================

Do not automatically:

cancel shipment

change courier

refund shipping

alert customer

because analytics flags a high rate.

It is decision support only.

==================================================

82. OPTIONAL ACTION FROM ANOMALY

==================================================

Allow:

View order →

to inspect order.

No mutation from analytics card.

==================================================

83. COURIER PRICE ANOMALY TOOLTIP

==================================================

Example:

₹156.84

Typical 500g Maharashtra:

₹68.94–₹98.72

+₹58 vs median

Use real data.

==================================================

84. FULFILLMENT “TODAY” SUMMARY

==================================================

Add compact activity card/strip:

TODAY

Picked up:

X

Shipped:

Y

Delivered:

Z

This uses today's event timestamps in IST.

Could live inside Commerce/Fulfillment strip.

Do not confuse with current In Transit count.

==================================================

85. CURRENT OPERATIONAL SNAPSHOT

==================================================

Potential secondary section/card:

FULFILLMENT NOW

Packed

Pickup

In transit

Out for delivery

Each count clickable to Orders page filters.

Keep compact.

==================================================

86. DO NOT DUPLICATE ORDERS PAGE

==================================================

Analytics should summarize.

Orders page handles individual parcel operations.

Do not create courier booking actions inside Analytics.

==================================================

87. TOOLTIP QUALITY

==================================================

Replace default chart-library tooltips if ugly.

Use same admin surface:

white/ivory

thin border

12px radius

navy values

muted labels

Tooltips should feel like product UI.

==================================================

88. LOADING

==================================================

Use section-shaped skeletons.

Date range switch:

keep previous data visible with subtle loading state where possible.

Do not blank entire dashboard.

==================================================

89. EMPTY STATES

==================================================

Example:

No paid orders in this period.

No shipping rates available.

No delivered orders in this period.

No fake zero maps/graphs that imply data.

==================================================

90. CURRENT 30-DAY SCREEN

==================================================

Use current production data to validate:

Visitors 2348

Product viewers 618

Add to cart 142

Checkout 113

Paid orders 38

Conversion 1.6%

Revenue approximately ₹1.14L

AOV approximately ₹3,002

These are screenshot observations, not hardcoded expected values.

The actual production query is authoritative.

Do not bake screenshot values into tests.

==================================================

91. TEST — CUMULATIVE SALES

==================================================

Input daily paid orders:

1, 0, 2, 3

Expected cumulative:

1, 1, 3, 6

Last value:

6

==================================================

92. TEST — REVENUE

==================================================

Daily revenue:

₹2,000

₹0

₹5,000

Cumulative:

₹2,000

₹2,000

₹7,000

Use paise internally.

==================================================

93. TEST — STATE

==================================================

Order A:

Odisha

Polity ×1

₹2,599

Order B:

Odisha

Economy ×1

₹2,579

Order C:

Maharashtra

Polity + Economy

₹5,099

Expected:

Odisha:

2 orders

Maharashtra:

1 order

Units based on actual quantities.

==================================================

94. TEST — SUBJECT REVENUE

==================================================

Mixed order:

Polity gross ₹2,500

Economy gross ₹2,500

order discount ₹500

shipping ₹99

captured total ₹4,599

Subject net product revenue:

Polity ₹2,250

Economy ₹2,250

Shipping ₹99 is not allocated to subjects.

Total subject revenue:

₹4,500

Order captured revenue:

₹4,599

This difference is expected and clearly documented.

Use the real discount allocation rules from current checkout/invoice model.

==================================================

95. TEST — SHIPPING

==================================================

Odisha 500g shipments:

₹90

₹95

₹92

₹245

Median around ₹93–₹94.

₹245 should be flagged under chosen documented heuristic.

Do not hardcode this exact threshold into production unless it matches selected algorithm.

==================================================

96. TEST — WEIGHT DIFFERENCE

==================================================

Odisha:

500g ₹95

500g ₹98

1000g ₹145

Do NOT flag ₹145 merely because 500g median is ₹96.

Weight band differs.

==================================================

97. TEST — CANCELLED SHIPMENT

==================================================

Order has:

cancelled Blue Dart ₹156

active Xpressbees ₹94

Shipping analytics:

₹94 only.

No double-counting.

==================================================

98. TEST — NO RATE

==================================================

Delivered historical order with missing booked rate:

counts in:

orders

revenue

delivered

does NOT contribute ₹0 to:

avg shipping

Rate coverage decreases.

==================================================

99. TEST — MULTI SUBJECT

==================================================

One order:

Polity ×1

Economy ×1

State orders:

1

Units:

2

Subject orders:

Polity +1

Economy +1

Do not confuse these metrics.

==================================================

100. INDIA MAP ACCESSIBILITY

==================================================

Do not rely on color only.

State map gets accessible names where practical.

Ranking list provides equivalent readable data.

Map is supplemental, not only way to access geography numbers.

==================================================

101. DATA PRIVACY

==================================================

No individual:

name

phone

street address

in Analytics.

Geo aggregation:

city/state only.

No PII in tooltips.

==================================================

102. PUBLIC BUNDLE

==================================================

All new analytics libraries/assets must remain scoped to admin analytics.

Do NOT materially increase:

/notes

checkout

tracking

public JS.

Lazy-load India map if helpful.

==================================================

103. VISUAL QA

==================================================

Test:

1440

1280

1024

768

430

390

375

Check:

KPI density

subject cards

Sales chart

cumulative line

map

state ranking

shipping cards

city ranking

anomaly table

No page-level horizontal overflow.

==================================================

104. REGRESSION

==================================================

Run:

Notes analytics tests

orders tests

shipping tests

tracking tests

package resolver tests

payment tests

invoice tests

discount tests

leads tests

address tests

attribution tests

Telegram tests

Then:

typecheck

production build

Compare failures against live production baseline.

==================================================

105. ZERO-DOWNTIME DEPLOY

==================================================

Proceed autonomously.

No midpoint approval required.

Safe sequence:

production SHA audit

→ data semantics audit

→ server aggregations

→ subject performance

→ cumulative sales

→ fulfillment analytics

→ state/city analytics

→ India map

→ shipping economics

→ anomaly detection

→ responsive UI

→ tests

→ typecheck

→ production build

→ zero-downtime deploy

→ read-only production smoke

If a destructive migration becomes necessary:

do not perform it.

Find an additive/read-only approach.

==================================================

106. PRODUCTION SMOKE

==================================================

Verify live:

/admin/notes/analytics?range=30d

Today

Yesterday

7d

30d

This month

Custom

Primary KPIs

PASS

Commerce/Fulfillment

PASS

Subject performance

PASS

Daily sales

PASS

Cumulative sales

PASS

Fulfillment activity

PASS

Funnel

PASS

India map

PASS

State ranking

PASS

City ranking

PASS

Shipping intelligence

PASS

Courier performance

PASS

Anomalies

PASS

Mobile

PASS

No real production records changed.

==================================================

107. FINAL REPORT

==================================================

Return exactly:

PRODUCTION BASE

Previous live SHA:

...

Working branch:

...

New SHA:

...

Live functionality preserved:

PASS/FAIL

==================================================

SUBJECT PERFORMANCE

Subjects found:

...

Orders:

PASS

Units:

PASS

Net product revenue:

PASS

Discount allocation:

PASS

Shipping excluded from subject revenue:

PASS

Dynamic future subjects:

PASS

==================================================

SALES OVER TIME

Metrics:

Paid orders:

PASS

Revenue:

PASS

Units:

PASS

Picked up:

PASS

Shipped:

PASS

Delivered:

PASS

Daily:

PASS

Cumulative:

PASS

Cumulative end-value reconciliation:

PASS

==================================================

FULFILLMENT

Current Packed:

...

Current Pickup:

...

Current In Transit:

...

Delivered today:

...

Picked up today:

...

Shipped today:

...

==================================================

GEOGRAPHIC INTELLIGENCE

India map:

PASS

State normalization:

PASS

Orders by state:

PASS

Revenue by state:

PASS

Units by state:

PASS

Avg shipping by state:

PASS

State totals reconcile:

PASS

Unknown bucket:

<count>

City analytics:

PASS

==================================================

SHIPPING INTELLIGENCE

Shipments with known booked rate:

...

Rate coverage:

... / ...

Average:

₹...

Median:

₹...

Minimum:

₹...

Maximum:

₹...

Under ₹100:

<count / %>

Over ₹100:

<count / %>

Shipping by state:

PASS

Shipping by city:

PASS

Shipping by courier:

PASS

Rate distribution:

PASS

==================================================

ANOMALIES

Algorithm:

<exact transparent rule>

Comparable group:

<state + weight band, fallback>

Orders flagged:

<count>

False zero/missing-rate handling:

PASS

No automatic shipping mutation:

PASS

==================================================

DATA INTEGRITY

Paid-order state total = Paid Orders:

PASS

State revenue total = Revenue:

PASS

State unit total = Paid Units:

PASS

Subject revenue reconciliation:

PASS

Cancelled shipment excluded:

PASS

One canonical shipment/order:

PASS

Customer checkout shipping excluded from courier-rate analytics:

PASS

Provider final invoice not falsely claimed:

PASS

==================================================

DESIGN

Existing dashboard language preserved:

YES

Current chart library reused:

YES / NO

Motion reused:

YES / NO

India map dependency:

...

Map asset source/license:

...

Desktop:

PASS

Mobile:

PASS

No horizontal page overflow:

PASS

No heavy public bundle impact:

PASS

==================================================

PERFORMANCE

N+1:

MUST BE NO

Server-side aggregation:

YES

Analytics requests:

<count/description>

Map lazy-loaded:

YES/NO

Public Notes bundle impact:

NONE / negligible

==================================================

REGRESSION

Notes Store:

PASS

Checkout:

PASS

Payments:

PASS

Invoices:

PASS

Orders:

PASS

Courier selection:

PASS

Shipping:

PASS

Tracking:

PASS

Leads:

PASS

Attribution:

PASS

Telegram:

PASS

==================================================

PRODUCTION

Downtime:

NO

Migration:

NONE / additive only

Tests:

...

Typecheck:

PASS

Build:

PASS

Deployment:

...

Production smoke:

PASS

==================================================

FINAL DASHBOARD DESCRIPTION

In 8–12 concise lines describe:

- the new subject intelligence

- cumulative sales view

- fulfillment activity

- India map

- state/city analytics

- shipping economics

- courier analysis

- anomaly detection

- mobile behavior

If everything is verified, finish exactly:

THE NOTES ANALYTICS DASHBOARD NOW COMBINES CONVERSION, SALES, PRODUCT, GEOGRAPHIC AND FULFILLMENT INTELLIGENCE IN ONE VIEW. SUBJECT PERFORMANCE IS RANKED BY ORDERS, UNITS AND NET PRODUCT REVENUE; SALES CAN BE VIEWED DAILY OR CUMULATIVELY; INDIA STATE AND CITY ANALYTICS EXPLAIN WHERE DEMAND AND REVENUE COME FROM; AND SHIPPING INTELLIGENCE SURFACES BOOKED RATE TRENDS, COURIER PERFORMANCE AND UNUSUALLY EXPENSIVE SHIPMENTS WITHOUT CHANGING ANY ORDER, PAYMENT OR FULFILLMENT BEHAVIOR. 