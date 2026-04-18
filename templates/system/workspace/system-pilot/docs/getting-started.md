# Getting Started with ClawPilot

Step-by-step guide to initialize ClawPilot, log into the dashboard, add an API key, and create your first AI agent instance.

## Step 1: Initialize ClawPilot

Run the init command to set up the platform:

```bash
claw-pilot init
```

This creates:
- `~/.claw-pilot/` directory structure
- `registry.db` SQLite database
- Dashboard authentication token
- Default admin user credentials
- System instance `cp-system` (auto-provisioned)

The init output displays your admin credentials. Save them — you need them to log in.

## Step 2: Open the Dashboard

Start the dashboard if it is not already running:

```bash
claw-pilot dashboard
```

Open your browser at **http://localhost:19000** and log in with the admin credentials from Step 1.

The home screen features a wizard chatbot (homebot) that can guide you through setup interactively.

## Step 3: Add an API Key

Before creating instances, you need at least one AI provider API key.

**Via Dashboard:**
1. Go to **Settings > Named Keys**
2. Click **Add Key**
3. Select provider (OpenAI, Anthropic, Mistral, Google, etc.)
4. Paste your API key — it is encrypted at rest in the database
5. Give it a name (e.g. `my-anthropic-key`)

**Via system-pilot:**
Ask the system-pilot agent in the cp-system instance to add a key for you.

Named keys are global — any instance can reference them by name.

## Step 4: System Instance Auto-Provisions

The `cp-system` instance starts automatically. It contains:

| Agent | Role |
|---|---|
| **system-pilot** | Primary agent, handles platform management requests |
| 5 subagents | Specialized agents for admin, monitoring, and maintenance tasks |

You can chat with system-pilot from the Pilot view to manage the platform conversationally.

## Step 5: Create Your First Instance

**Via Dashboard Wizard:**
1. Click **New Instance** on the instances page
2. The wizard walks you through: slug, display name, port, provider, API key
3. Optionally select a blueprint to pre-configure agents
4. Click **Create** — instance state is `stopped`
5. Click **Start** to launch the runtime daemon

**Via CLI:**
```bash
claw-pilot create --slug my-assistant --name "My Assistant" --provider anthropic --key my-anthropic-key
claw-pilot start my-assistant
```

## Step 6: Start Chatting

Open the **Pilot** view for your new instance. Type a message — the default agent responds via SSE streaming in real time.

## Troubleshooting

Run the doctor command to diagnose common issues:

```bash
claw-pilot doctor
```

This checks:
- Node.js version compatibility
- Database integrity
- Port availability
- PID file consistency
- API key validity
- Dashboard connectivity

## Quick Reference

| Command | Description |
|---|---|
| `claw-pilot init` | Initialize platform (first time) |
| `claw-pilot dashboard` | Start the dashboard server |
| `claw-pilot create` | Create a new instance |
| `claw-pilot start <slug>` | Start an instance |
| `claw-pilot stop <slug>` | Stop an instance |
| `claw-pilot list` | List all instances |
| `claw-pilot status <slug>` | Show instance status |
| `claw-pilot doctor` | Run diagnostics |

*ClawPilot v0.74.1*
