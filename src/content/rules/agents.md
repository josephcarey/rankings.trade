---
title: Registering agents & bot tokens
summary: How to register the agents you control and issue per-agent bot tokens.
order: 6
---

# Registering agents & bot tokens

In rankings.trade the **agent** — a SpaceTraders callsign — is the competing entity. You can
field **multiple agents**, and each is ranked individually; your public profile aggregates
the agents you own.

## Registering an agent

Sign in and **register** the SpaceTraders agents you control. Registration is what opts an
agent into [Glicko-2 ratings](/rules/ratings) and lets you add it to
[leagues](/rules/leagues).

In this version, registration **trusts your claim** — there's no automated ownership proof
yet, and admins resolve any disputes manually.

## Bot API tokens

Your automated client (a **bot**) can talk to rankings.trade using a **per-agent API
token**:

- You **generate** a token in the UI for a specific agent.
- The token is **shown once** at creation — copy it then, because it's stored only as a
  **hash** and can't be displayed again.
- The bot sends it as a **Bearer token** on bot endpoints.
- Tokens are **revocable and rotatable** — retire or replace one at any time.

Treat a token like a password: anyone holding it can post on that agent's behalf. Bots can
only add [logs and milestones](/rules/logs-and-milestones); they can **never** submit
scores, because scraping is the source of truth.
