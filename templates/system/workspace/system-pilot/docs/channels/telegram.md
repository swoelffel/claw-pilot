# Telegram Channel

The Telegram channel connects ClawPilot agents to Telegram via the Bot API,
allowing users to interact with agents directly from the Telegram messaging
app. Multiple users can pair with the same instance, and primary agents share
a single permanent session across both Telegram and web chat.

## Setup Procedure

### Step 1: Create a Telegram Bot

1. Open Telegram and start a conversation with **@BotFather**.
2. Send `/newbot` and follow the prompts to choose a name and username.
3. BotFather returns a **bot token** (format: `123456:ABC-DEF...`).

### Step 2: Configure the Bot Token

Save the token in the instance configuration:

```
PATCH /api/instances/:slug/config
Content-Type: application/json

{
  "telegram": {
    "token": "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
  }
}
```

Alternatively, paste the token in the dashboard under **Settings > Channels >
Telegram**.

### Step 3: Start the Instance

Start or restart the instance. The Telegram bot begins listening for messages
once the instance is running.

## User Pairing

Pairing links a Telegram user to the ClawPilot instance. This prevents
unauthorized users from interacting with your agents.

### Pairing Flow

1. The dashboard displays a **pairing code** in the Telegram channel settings.
2. The Telegram user sends the pairing code as a message to the bot.
3. The pairing request appears in the dashboard for approval.
4. The instance operator approves or rejects the pairing via dashboard or API.

### Pairing API

| Action | Method | Endpoint |
|---------|--------|-----------------------------------------------|
| List | GET | `/api/instances/:slug/telegram/pairings` |
| Approve | POST | `/api/instances/:slug/telegram/pairings/:id/approve` |
| Reject | POST | `/api/instances/:slug/telegram/pairings/:id/reject` |
| Revoke | DELETE | `/api/instances/:slug/telegram/pairings/:id` |

## Connection Modes

| Mode | Description | Configuration |
|-----------|----------------------------------------------|-------------------------------|
| `polling` | Bot polls Telegram servers for updates | Default; no infrastructure needed |
| `webhook` | Telegram pushes updates to a configured URL | Requires HTTPS public endpoint |

Polling is suitable for development and small deployments. Webhook mode
reduces latency and is recommended for production environments with a
publicly accessible HTTPS endpoint.

## Message Formatting

Agent responses sent to Telegram are formatted using **MarkdownV2** syntax,
which is Telegram's supported rich text format. Special characters are
automatically escaped to comply with Telegram's parsing rules.

| Markdown feature | Rendered as |
|------------------|------------------------------|
| `*bold*` | **bold** |
| `_italic_` | _italic_ |
| `` `code` `` | `inline code` |
| ` ```block``` ` | Code block |

## Session Behavior

Primary agents use a **permanent session** that is shared across all channels.
A conversation started in Telegram continues seamlessly in web chat and vice
versa. The agent sees the full message history regardless of which channel
delivered each message.

Subagent sessions remain ephemeral and channel-independent.

## Multi-User Support

Multiple Telegram users can pair with the same instance. Each paired user
can send messages to the bot, and all messages are routed to the same
primary agent session. This is useful for team scenarios where several
operators interact with a shared agent.

## Security Considerations

- Bot tokens are stored encrypted in the instance configuration.
- Only paired and approved users can interact with the bot.
- Pairing codes expire after a configurable timeout.
- Revoking a pairing immediately blocks the Telegram user from sending
  further messages.

## Troubleshooting

| Symptom | Likely cause | Resolution |
|-------------------------------|-------------------------------|-------------------------------|
| Bot does not respond | Token not configured or invalid | Verify token in settings |
| Pairing code not accepted | Code expired or already used | Generate a new pairing code |
| Messages delayed | Polling interval too long | Switch to webhook mode |
| Formatting broken in Telegram | Unescaped special characters | Check MarkdownV2 escaping |

*ClawPilot v0.74.1*
