# HDB Resale Intelligence — Singapore HDB Resale Flat Prices Archive 1990–Present

Searchable, programmatic access to every HDB resale flat transaction published on data.gov.sg — the complete archive from January 1990 to the current month — plus genuinely derived analytics computed from that archive: median resale price and median price-per-sqm by town and flat type, and transaction volume by month and year.

Built for property analysts, agents, valuers, researchers, and the agents and tools that work for them — inside Apify, where per-result pricing means you pay only for the rows you pull.

## What you get

- **Resale rows** matching your filters (town, flat type, flat model, floor area range, price range, month range, lease commence year), each with: month, town, flat type, block, street name, storey range, floor area (sqm), flat model, lease commence year, remaining lease (where published), and resale price (SGD).
- **Derived analytics** (key-value store record `ANALYTICS`): transaction count, median resale price and median price-per-sqm overall, per town, per flat type, and per town × flat type; volume by year and by month — all computed over the full filtered set, not a sample.

## Coverage — read this first

- **Months 1990-01 to 2026-11** (443 months, 27 towns), 989,625 transactions after removing exact duplicate rows as published (991,554 raw rows; 1,929 removed — rows identical on every published field).
- **Date basis changes in Mar 2012.** Transactions before Mar 2012 are dated by **approval date**; from Mar 2012 onwards by **registration date**. This is the source's own basis — month-level comparisons across that boundary should be read with it in mind.
- **`remaining_lease` exists only from Jan 2015.** In the 2015–2016 segment it is published as whole years (e.g. `70`); from Jan 2017 as text (e.g. `61 years 04 months`). Rows before Jan 2015 carry `null`. Values are reproduced exactly as published, in both formats.
- **Flat model casing varies by era** (e.g. `IMPROVED` in the 1990s segment, `Improved` later). Values are as published; the `flatModel` filter is case-insensitive.
- The archive is refreshed when data.gov.sg updates the source collection (the 2017-onwards segment updates daily; historical segments are static). It is a transaction archive, not a listings feed: it records completed resales, not flats currently for sale.
- Resale prices are as agreed between buyers and sellers and published by HDB; as the source itself notes, they should be taken as indicative.

## Data source, licence and attribution

Source dataset: **"Resale Flat Prices"** collection, Housing & Development Board, published on data.gov.sg (dataset resources `d_ebc5ab87086db484f88045b47411ebc5`, `d_43f493c6c50d54243cc1eab0df142d6a`, `d_2d5ff9ea31397b66239f245f57751537`, `d_ea9ed51da2787afaf8e51f827c304208`, `d_8b84c4ee58e3cfc0ece0d773c8ca6abc`), accessed 21 Nov 2026. Contains information from the Government of Singapore accessed via data.gov.sg, used under the **Singapore Open Data Licence v1.0** (https://data.gov.sg/open-data-licence).

**Independent tool; not affiliated with HDB or GovTech, and not endorsed by them.**

Personal-data handling: none is required — the source dataset contains no personal data. Its columns are transaction attributes only (month, town, flat type, block, street, storey range, floor area, flat model, lease years, price); there are no names, identification numbers or contact details in any field. Block and street are the transacted flat's address, as published by HDB.

## Pricing

**US$20 per 1,000 results** (US$0.020 per resale row returned to the dataset), with a free allowance of 250 results. Analytics are delivered to the key-value store and are not metered per row.

## Input

| Field | Meaning |
|---|---|
| `mode` | `rows`, `analytics`, or `both` (default) |
| `town` | case-insensitive substring match on town |
| `flatType` | case-insensitive substring match on flat type |
| `flatModel` | case-insensitive substring match on flat model |
| `floorAreaMin` / `floorAreaMax` | floor area bounds in sqm |
| `priceMin` / `priceMax` | resale price bounds in SGD |
| `monthFrom` / `monthTo` | month range as `YYYY-MM` |
| `leaseCommenceYearFrom` / `leaseCommenceYearTo` | lease commence year bounds |
| `limit` | max rows returned (default: all matching) |

## Terms

Outputs are derived from the source dataset named above and are provided as-is for business intelligence. Prices, dates and coverage are exactly as published by the source, subject to the basis and field differences in the coverage statement above; check it before relying on any aggregate.
