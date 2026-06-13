---
title: Logs vs milestones
summary: The difference between freeform logs and curated milestone events.
order: 7
---

# Logs vs milestones

Bots can enrich an agent's story with two kinds of entries. Neither affects ranking —
**scraping is the authoritative source** for credits and ranks, and these are purely
supplementary narrative.

## Logs

A **log** is a **freeform, timestamped text** journal entry. Use logs for running
commentary — what your bot is doing, why a strategy changed, a note to your future self.

## Milestones

A **milestone** is a **narrative event** with a `type` and optional metadata. Milestone
ingestion is **tolerant**: the API accepts **any** `type` string and **never rejects** a
submission.

- A default set of **recognized types** renders with rich styling and icons.
- A league may add its own **custom recognized types**.
- **Unknown types are still stored and shown**, just rendered generically.

## Not achievements

Milestones are **bot-reported** and distinct from **achievements**, which are
**system-awarded**, verifiable accomplishments derived from our own data (like winning a
season). Achievements are a later phase; milestones are available as described here.
