# Claudlytics

A lightweight web dashboard that tracks your Claude Code token usage and costs in real time.

<img width="1327" height="634" alt="image" src="https://github.com/user-attachments/assets/f02818d5-a953-4e61-823d-0faaf97d9964" />


![Node.js](https://img.shields.io/badge/Node.js-18%2B-green) ![License](https://img.shields.io/badge/license-MIT-blue)

## Features

- **Current session** — token counts and cost for the active conversation file
- **5-hour window** — rolling session usage with reset countdown (matches Claude Pro/Max session limits)
- **Today / Last 7 days / Billing cycle** — aggregated token and cost breakdown
- **Plan usage** — session and weekly message/token counts with reset times
- Reads directly from `~/.claude/projects/**/*.jsonl` — no API key required for basic usage
- Auto-refreshes every 30 seconds

## Requirements

- Node.js 18+
- Claude Code installed and logged in (generates the JSONL session files)

## Setup

### 1. Clone the repo

```bash
git clone https://github.com/iansugerman/Claudlytics.git
cd Claudlytics
```

### 2. Run the server

```bash
node server.js
```

The server starts on port `3031` by default. Set the `PORT` environment variable to change it.

### 3. Open the dashboard

```
http://localhost:3031
```

## Run as a background service (Linux)

Create a systemd service so Claudlytics starts automatically:

```bash
sudo nano /etc/systemd/system/claudlytics.service
```

Paste the following (update `WorkingDirectory` to match where you cloned the repo):

```ini
[Unit]
Description=Claudlytics - Claude Usage Tracker
After=network.target

[Service]
Type=simple
WorkingDirectory=/path/to/Claudlytics
ExecStart=/usr/bin/node server.js
Restart=on-failure
Environment=PORT=3031

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable claudlytics
sudo systemctl start claudlytics
```

## Secure access via SSH tunnel (recommended)

By default the server binds to `127.0.0.1` only — it is not publicly accessible. To access it remotely, use an SSH tunnel from your local machine:

```bash
ssh -L 3031:localhost:3031 user@your-server-ip
```

Then open `http://localhost:3031` in your browser. The dashboard is available as long as the SSH session is open.

### SSH config shortcut

Add this to `~/.ssh/config` (Linux/Mac) or `C:\Users\you\.ssh\config` (Windows):

```
Host claudlytics
    HostName your-server-ip
    User your-username
    LocalForward 3031 localhost:3031
```

Then connect with just:

```bash
ssh claudlytics
```

## Optional: Anthropic API usage

Set `ANTHROPIC_API_KEY` in your environment to also pull billing data from the Anthropic API:

```bash
echo "ANTHROPIC_API_KEY=sk-ant-api03-..." >> /path/to/Claudlytics/.env
```

The `.env` file is read automatically by the systemd service if present.

## Token pricing

Costs are calculated using Claude Sonnet 4.6 rates:

| Token type | Price per 1M tokens |
|---|---|
| Input | $3.00 |
| Output | $15.00 |
| Cache write (5 min) | $3.00 |
| Cache write (1 hr) | $3.75 |
| Cache read | $0.30 |

Update the `PRICING` object in `server.js` if you use a different model.
