# Section 3110 — Expedited Application Processing

Source: Georgia DFCS SNAP Policy Manual (MT-87, June 2026)
URL: https://pamms.dhs.ga.gov/dfcs/snap/3110/

---

Expedited SNAP is a fast-track process that delivers benefits within 7 calendar days of application for households in urgent need.

## Who qualifies for expedited processing

A household is entitled to expedited processing if it meets ANY of the following:

1. **Low income and low liquid resources**
   - Gross monthly income is less than $150, AND
   - Countable liquid resources (cash, bank accounts) are $100 or less

2. **Migrant or seasonal farmworker household**
   - Household is a destitute migrant or seasonal farmworker household, AND
   - Countable liquid resources are $100 or less
   - "Destitute" generally means the household's only income for the certification month is from a terminated source or a new source that will not provide income within 10 days of application

3. **Combined income and resources below rent + utilities**
   - The household's combined monthly gross income plus liquid resources is less than the household's monthly rent or mortgage plus utility standard

## Timeframes

- Expedited benefits must be made available no later than the 7th calendar day after the date of application
- The application filing date is the date DFCS receives a signed application (in person, by mail, fax, or through Georgia Gateway)

## Verification requirements

For expedited processing, only the applicant's identity must be verified before benefits are issued. Verification of income, resources, and other factors is postponed and must be completed by the end of the certification period (typically 1-3 months for expedited cases).

## Application channels

- Online: gateway.ga.gov
- Phone: 1-877-423-4746
- In person at any DFCS county office
- By mail

## Notes for the eligibility tool

- If a user's situation appears to meet any of the three expedited triggers, the tool should set `expedited_possible: true` in the result and highlight this prominently in the user message — 7-day vs 30-day matters a lot when someone is hungry.
- Expedited eligibility does not change whether the household qualifies for SNAP at all — it only changes how fast benefits arrive.
- If the user indicates they are in an emergency (no food today, being evicted), the tool should also point them to a local food bank (foodbank.org / feedingamerica.org) in parallel with the SNAP application.
