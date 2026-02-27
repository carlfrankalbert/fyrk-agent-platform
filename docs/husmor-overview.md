# Husmor — Functional Overview

## What it is

Husmor is an AI-powered meal planning assistant for a Norwegian family, living inside a Slack channel. It has a strong persona — a warm, decisive, traditional Scandinavian housekeeper who values health, routine, seasonal ingredients, and zero waste. It speaks Norwegian, plans weekly dinners, tracks nutrition, learns family preferences over time, and manages shopping lists.

## Architecture

```
Slack ──→ Fly.io (2 machines) ──→ Claude Opus 4.6 (conversation)
  ↑                  │             Claude Haiku 4.5 (learning extraction)
  │                  │             Claude Sonnet 4.5 (proactive messages)
  │                  ↓
  └──── Supabase (all state) ────→ Matvaretabellen (2121 Norwegian foods)
```

The system is stateless at the compute layer — all persistent state lives in Supabase. Two Fly.io machines handle requests with DB-based dedup so Slack retries don't cause duplicate processing.

## Core conversation flow

1. **Slack event arrives** at `POST /slack/husmor-events`
2. **Signature verified** via HMAC, retries ignored, event deduped via DB atomic claim
3. **Async dispatch** — returns 200 immediately (Slack's 3-second timeout), posts "Husmor tenker..." placeholder
4. **Per-thread concurrency guard** queues overlapping messages for the same thread
5. **DB context loaded** in parallel: weekly plan, preferences, pantry, inventory, seasonal produce, food traditions, nutrition knowledge, learnings, meal patterns, recipes, child reactions, suggestion metrics, rejection patterns, reaction signals, knowledge gaps, weekly nutrition totals
6. **System prompt built** with token budget (80k chars) and prioritized sections
7. **Thread history fetched** (for replies) and converted to Claude message format
8. **Claude Opus called** with full context + conversation
9. **Response parsed** — JSON `{ reply, actions[] }`, with fallback to plain text
10. **Thinking placeholder updated** with the reply
11. **Actions executed** against Supabase (meals, preferences, recipes, etc.)
12. **Learnings extracted** asynchronously via Claude Haiku

## 18 action types Claude can trigger

| Action | What it does |
|--------|-------------|
| `add_meals` | Add meals to the weekly plan (days 1-7) |
| `update_meal` | Change a planned meal (tracks if it was a Husmor suggestion that got modified) |
| `remove_meal` | Remove a meal from a day (tracks suggestion rejections) |
| `set_preference` | Upsert a family preference (allergies, dislikes, cooking skill, etc.) |
| `add_inventory_note` | Track what's in the fridge/pantry |
| `update_inventory_status` | Mark items as used/depleted |
| `rate_meal` | Rate a meal 1-5, add emoji feedback, text feedback |
| `generate_shopping_list` | Create a categorized shopping list, syncs to a Slack Canvas |
| `add_shopping_items` | Add items to the active shopping list (creates one if none exists) |
| `remove_shopping_items` | Remove items from the active shopping list (case-insensitive) |
| `check_off_items` | Mark items as bought/checked off on the shopping list |
| `clear_shopping_list` | Mark the active shopping list as completed |
| `update_plan_status` | Move plan through draft → proposed → approved → active → completed |
| `set_week_context` | Flag travel week, guests, holidays — adjusts complexity |
| `save_recipe` | Save recipe with ingredients + steps, auto-enriches nutrition from Matvaretabellen |
| `propose_learning` | Propose an insight about the family (posted to Slack for confirmation via reactions) |
| `log_child_reaction` | Track how kids react to specific meals (loved/liked/neutral/disliked/refused) |
| `sync_oda_cart` | Search and add items to the Oda.com shopping cart |

## Learning system (4 mechanisms)

### 1. Conversation extraction
After each message, Claude Haiku analyzes the conversation and extracts durable learnings (preferences, household info, feedback, constraints, routines). Stored in `household_learnings` with confidence scores. New learnings can supersede old ones. Batch-inserted with per-learning error handling.

### 2. Meal pattern analysis
Computes patterns from historical meal data with recency weighting (recent weeks count more):
- **Favorites** — meals scoring 4.0+ weighted average, served 2+ times
- **Avoid** — meals scoring 2.0 or below
- **Weekday patterns** — "Friday: Taco (5 of 8 weeks)"
- **Category balance** — fish/vegetarian/red meat/legume frequency per week
- **Feedback text analysis** — keyword extraction from written feedback (positive/negative phrases)

### 3. Cross-signal contradiction detection
Compares learnings against patterns to surface conflicts: e.g., a learning says "family likes salmon" but pattern shows salmon scores 1.5/5. Surfaced in the prompt so Claude can ask the family to clarify.

### 4. Proposed learnings with human confirmation
Claude can propose learnings mid-conversation. These get posted to Slack with reaction prompts (white_check_mark / x). Confirmed learnings get higher weight; rejected ones are filtered out.

## Intelligence signals fed to Claude

The system prompt is built from ~15 data sources, prioritized by importance:

1. **Persona + date** — always included
2. **Dietary guidelines** — Norwegian health authority recommendations
3. **Current weekly plan** — meals with nutrition data (from recipes or fuzzy Matvaretabellen estimates)
4. **Family preferences** — allergies, dislikes, household size
5. **Learnings** — grouped by category, with "use these actively" instructions
6. **Meal patterns** — favorites, avoid, weekday habits, category balance
7. **Contradictions** — conflicting signals between learnings and patterns
8. **Suggestion metrics** — acceptance rate, per-category breakdown (adjusts suggestions)
9. **Rejection patterns** — which categories/meals keep getting replaced
10. **Reaction signals** — emoji sentiment from last 30 days
11. **Knowledge gaps** — missing info to ask about naturally (allergies, family size, cooking time)
12. **Inventory** — pantry staples, items to use soon
13. **Seasonal produce** — what's in season this month
14. **Food traditions** — Norwegian/Swedish seasonal dishes
15. **Nutrition knowledge** — supplementary dietary advice by age group
16. **Child taste profiles** — per-child liked/disliked meals
17. **Recent meals** — last 3 weeks with ratings and feedback
18. **Weekly nutrition totals** — actual macros/micros from Matvaretabellen
19. **Saved recipes** — with ratings, prep time, last used date

## Proactive messages (4 types)

Triggered via `POST /husmor/proactive` (called by n8n on a schedule), rate-limited to once per type per 4 hours:

| Type | When | What |
|------|------|------|
| `inventory_reminder` | When items are marked "use soon" | Suggests 1-2 meals using those items |
| `midweek_checkin` | Mid-week | Asks if meals are working, offers to adjust |
| `weekend_prep` | Friday | Reminds about weekend meals + unhandled shopping items |
| `weekly_learning_summary` | Sunday | Warm summary of what Husmor learned about the family this week |

## Shopping list management

Shopping lists can be created via `generate_shopping_list` or incrementally via `add_shopping_items`. Users can add, remove, check off, and clear items conversationally. The prompt distinguishes between the internal shopping list ("handlelisten") and Oda cart sync ("Oda-handlekurven") — "legg på handlelisten" triggers list management, while "legg i Oda" triggers `sync_oda_cart`.

## Slack Canvas sync

When a shopping list is generated, it syncs to a Slack Canvas — creating one if it doesn't exist, or updating the existing one. The canvas shows the weekly plan + categorized shopping checklist.

## Reaction handling

Slack emoji reactions drive two systems:
- **Plan status**: thumbsup → approved, thumbsdown → rejected, repeat → regenerate (back to draft)
- **Learning confirmation**: white_check_mark → confirmed, x → rejected
- **All other reactions**: stored in `message_reactions` for sentiment mining

## Nutrition enrichment

Two paths for meal nutrition data:
- **Recipe-based** (accurate): Saved recipes with ingredients get matched against the Matvaretabellen (2121 foods) for per-serving macros + micros
- **Estimate-based** (fuzzy): Meals without recipes get a single batch fuzzy lookup against food names via `pg_trgm` similarity

Weekly totals are computed and included in the prompt so Claude can flag nutritional gaps ("low on omega-3 — add a fish dinner").

## Production hardening

- DB-based event dedup across 2 Fly machines (atomic INSERT ON CONFLICT)
- Per-thread concurrency guard (promise chaining)
- Token budget on system prompt (80k chars, prioritized sections)
- Batch food lookup (single SQL call instead of N+1)
- Cache with periodic prune + stampede protection
- Batch learning inserts with partial failure handling
- Proactive message rate-limiting via DB log
