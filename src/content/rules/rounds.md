---
title: Rounds & finalization
summary: How a universe reset closes a round and archives final standings.
order: 2
---

# Rounds & finalization

A **round** is one universe-reset cycle, keyed by the SpaceTraders `resetDate`. Every
league — and the Universe league — plays out the current round as agents accumulate
credits, captured by 15-minute **snapshots**.

## Finalization is automatic

When SpaceTraders begins a **new universe reset**, the previous round is **finalized
automatically** — there is no human in the loop. At finalization:

- The round's **final standings** are captured and archived in each league.
- Each finalized **ranked** round produces one [rating](/rules/ratings) update per agent.

## Participation

Per-round **participation** is tracked explicitly. For the Universe league, a participant
is a **registered** agent that had at least one snapshot during the round. For a league, a
participant must also be a member of that league at finalization.

Agents that miss a finalized round are excluded from that round's rating match and have
their rating **deviation (RD)** inflated for each missed round, reflecting the growing
uncertainty about their strength.

## Unranked rounds

A round can be flagged **unranked** — for example during a [season](/rules/seasons) gap.
Unranked rounds still archive standings but **do not affect ratings**.
