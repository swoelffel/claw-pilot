# Budget Alerts and Overrides

ClawPilot budgets emit alerts at configurable thresholds and enforce hard stops
when spending limits are reached. Overrides allow temporary extension of a budget,
and manual resets zero out accumulated spending.

## Soft Alert

When spending reaches the `soft_threshold_pct` percentage of the budget limit, a
`budget.soft_alert` event is emitted. This serves as an early warning before
the hard stop kicks in.

| Notification channel | Behavior |
|----------------------|-------------------------------------------------------|
| Dashboard | Banner notification in the instance Budget panel |
| Telegram | Message sent to paired Telegram users (if configured) |

The soft alert fires once per threshold crossing. If spending drops (e.g., after
a period reset) and then rises again past the threshold, the alert fires again.

## Hard Stop

When spending reaches 100% of `limit_usd`, a `budget.hard_stop` event is emitted.
All further LLM calls for the affected scope are blocked until one of:

- An override is granted.
- The budget is reset.
- The budget period rolls over (for daily, weekly, or monthly budgets).
- The budget is deleted or its limit is increased.

Blocked LLM calls return an error indicating budget exhaustion, including the
budget name and scope for diagnosis.

## Override

An override temporarily extends the budget ceiling by 20% above the original
limit, allowing work to continue while the operator reviews spending.

```
POST /api/instances/:slug/budgets/:id/override
```

| Detail | Value |
|--------------------|---------------------------------------------|
| Extension amount | +20% of `limit_usd` |
| Duration | Until next period reset or manual reset |
| Audit event type | `override` |
| Repeated overrides | Allowed; each adds +20% of original limit |

The override is recorded as an audit event with metadata including the original
limit, the new effective limit, and the requesting user.

## Manual Reset

A manual reset sets the `spent_usd` counter back to zero, effectively
restarting the budget cycle.

```
POST /api/instances/:slug/budgets/:id/reset
```

This action is manual only and is not triggered automatically. It produces a
`reset` audit event. After a reset, the budget resumes enforcement from zero
spend against the original limit (overrides are cleared).

## Audit Events

Every budget mutation is recorded in the `rt_budget_events` table and
retrievable via the API.

```
GET /api/instances/:slug/budgets/:id/events
```

### Event Types

| Event type | Trigger |
|---------------|-------------------------------------------------------------|
| `create` | Budget created |
| `update` | Budget configuration changed (limit, threshold, period) |
| `soft_alert` | Spending crossed soft threshold percentage |
| `hard_stop` | Spending reached budget limit; LLM calls blocked |
| `override` | Temporary +20% extension granted |
| `reset` | Spent amount manually zeroed |

### Event Record Structure

| Column | Type | Description |
|--------------|----------|---------------------------------------------|
| `id` | integer | Auto-incremented primary key |
| `budget_id` | integer | Foreign key to the budget |
| `event_type` | string | One of the event types listed above |
| `metadata` | JSON | Context-specific payload (amounts, user, etc)|
| `timestamp` | datetime | UTC timestamp of the event |

## Telegram Alert Configuration

Budget alerts are sent to Telegram when:

1. The instance has a Telegram bot token configured.
2. At least one user is paired with the bot.
3. The budget event is `soft_alert` or `hard_stop`.

Alert messages include the budget name, current spending, limit, and scope
details formatted in MarkdownV2 for Telegram rendering.

## Monitoring Recommendations

- Set `soft_threshold_pct` to 70-80% for early visibility into spending trends.
- Review audit events periodically to detect agents with abnormal cost patterns.
- Use overrides sparingly; prefer adjusting the budget limit for sustained
  increases in expected usage.

*ClawPilot v0.74.1*
