# dsh-period-report

> **English** | [**中文**](README.zh.md)

Free-interval session reports for [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness): generate **AI-narrated work reports** (daily / weekly / monthly / any custom date range) from your session corpus, and schedule **periodic reminders** ("every N days at HH:MM, starting from an anchor date") that generate the report and pop a **system notification**.

## Features

- **Web UI (v0.2.0)** — a **Session Report** settings page (report generator + reminder configuration) and bottom-right reminder toasts with a large full-report reading window.

- **Any date range** — pick a start and end date; the report covers exactly that window (a single day, 2 days, 7 days, a whole month, whatever you need).
- **AI narrative digest** — the deployment's default model writes a natural-language summary (`Today at a glance` / `Highlights` / `Review` / `Suggestions`) that reads like a human-written daily report. Falls back to a template highlight list when AI is disabled or unavailable.
- **Full statistics** — active/new sessions, user & assistant messages, tool calls, turns, steps, token usage (input/output/cache read/write/reasoning), turn results, top tools.
- **Per-session details** — title, id, working directory, active window, message/tool/turn counts, first request.
- **Periodic reminders** — free period length: `intervalDays: 1` = daily, `7` = weekly, `2` = every other day… anchored at `anchorDate`, fired at `hour:minute`, once per period. `range: previous` reports the completed previous period (e.g. 09:00 digest of yesterday); `range: current` reports the period in progress.
- **System notifications** — macOS Notification Center banner via `osascript`, Linux via `notify-send`. Full reports are also saved to `~/.dsh/dsh-period-report/reports/` so nothing is lost when the GUI is closed.
- **Bilingual** — reports in Chinese (`zh`) or English (`en`).
- **Persistent config** — `~/.dsh/dsh-period-report.json` (mode 0600).

## Install

```bash
dsh plugin --profile web add github:zhengjy01/dsh-period-report
```

Local development:

```bash
dsh plugin --profile web add link:/path/to/dsh-period-report
```

## Tools

### `report_generate`

Generate a report for an arbitrary date range.

| Parameter | Type | Description |
| --- | --- | --- |
| `startDate` | string (required) | Start date, `YYYY-MM-DD` (inclusive) |
| `endDate` | string (required) | End date, `YYYY-MM-DD` (inclusive) |
| `includeSubagents` | boolean | Include subagent sessions (default `false`) |
| `withUsage` | boolean | Include token usage stats (default `true`; disable for speed) |
| `language` | string | `zh` or `en` (default `zh`) |
| `narrate` | boolean | AI narrative digest (default `true`; disable for a fast template digest) |

Returns the full Markdown report.

### `report_config`

View or update the reminder configuration (persisted in `~/.dsh/dsh-period-report.json`).

| Parameter | Type | Description |
| --- | --- | --- |
| `enabled` | boolean | Enable/disable the scheduled reminder |
| `anchorDate` | string | Anchor date `YYYY-MM-DD`; periods count from this day |
| `intervalDays` | number | Remind every N days (1–90; 7 = weekly) |
| `hour` / `minute` | number | Reminder time of day |
| `range` | string | `previous` (report the last period, default) or `current` |
| `language` | string | Report language `zh` / `en` |
| `narrate` | boolean | AI narrative toggle |

Calling it with no arguments returns the current configuration.

## Example

> “Set a reminder every 2 days at 09:00 starting from 2026-06-01, in Chinese.”
>
> → `report_config` with `{ "enabled": true, "anchorDate": "2026-06-01", "intervalDays": 2, "hour": 9, "minute": 0, "range": "previous" }`
>
> Reminders fire on 06-01, 06-03, 06-05 … at 09:00, each reporting the previous 2-day period; a system notification shows the summary and the report file path.

## License

MIT
