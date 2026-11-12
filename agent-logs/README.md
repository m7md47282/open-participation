# Agent logs

Raw session logs from the AI coding agent used to build this project, as requested in the brief.

| File | What it is |
|---|---|
| `claude-code-session-1.jsonl` | A short side session: questions about the system architecture, which produced `SYSTEM_ARCHITECTURE.md` |
| `claude-code-session-2.jsonl` | The main session: discussing the brief, the plan, building, testing (API, browser, accessibility), deployment to Docker and Google Cloud Run, and the documentation |

## Setup

- **Agent:** Claude Code (Anthropic), in the VS Code extension on macOS.
- **How it was used:** the brief and design were discussed first and written into `PLAN.md` before any code. The agent then built the backend, frontend and tests, ran them, drove the app in a real browser with Playwright, and fixed what the tests found. Decisions (stack, guest identity, deployment target, public repo) were made by me.
- **Format:** each line is one JSON event from the session (messages, tool calls and tool results), exactly as Claude Code records them.

## Redactions

Personal details were replaced before publishing: email addresses, billing account IDs, and the names of unrelated Google Cloud projects that appeared in command output. Nothing else was changed. No secrets appear in the logs: signing keys were generated straight into `.env` and Secret Manager and were never printed.
