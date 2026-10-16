# BOLT — by BEVAMPED

**BEVAMPED Outreach & Lead Tracker** is a local lead research and call desk. Review prospects, approve them for calls, record outcomes and follow-ups, and track a daily booking goal. The interface includes the Meeting Point identity, light and dark modes, and an editable opening prayer.

## Run locally

Requires Node.js 22 or later. No npm dependencies are required.

```sh
cd lead-workspace
node server.mjs
```

Open http://127.0.0.1:4318/. On the original Windows workspace, `START-BEVAMPED.cmd` also starts the desk.

**This is a source-only repository.** Before starting a fresh checkout, privately restore your existing `lead-workspace/data/central-leads.json`. The server requires the version 1 reconciled lead bank; it does not download or reconstruct it. To continue an existing workspace, also restore its matching `lead-workspace/saved/` directory privately. Starting without saved state creates a new, empty activity history. The original working folder already has these files.

The private lead bank, source research, account connections, transcripts, saved decisions, backups and screenshots are excluded from Git. Keep separate private backups; cloning this repository does not restore that information. Browser preferences and custom prayer wording remain in the browser's local storage.

## Workflow

- Review leads and record your own verification before approving them for calls.
- Start a call session, then place and record the WhatsApp call separately using Wispr Notetaker.
- Finish and sync, select the recording, and request an AI draft. Review the outcome, notes and dates before confirming the call.
- The default goal is three bookings, with an advisory limit of twenty calls. Targets are adjustable.

Wispr requires its own account authorization from the desk. Optional AI drafting uses an existing signed-in Windows Codex installation and sends the selected transcript to OpenAI. Credentials are kept locally using Windows DPAPI. The app does not place calls or automatically create calendar events.

The server binds to loopback for use on the local computer. This repository is not a cloud deployment or a multi-user service.

## Verify

```sh
cd lead-workspace
node --test tests/*.test.mjs
```

Tests use synthetic fixtures and temporary storage. No private lead data or live account connection is needed.
