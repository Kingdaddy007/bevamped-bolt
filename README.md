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

Wispr requires its own account authorization from the desk. Optional AI drafting uses an existing signed-in Windows Codex installation and sends the selected transcript to OpenAI. Credentials are kept locally using Windows DPAPI. The app does not place calls.

## Google Calendar and reminders

Today’s agenda lists overdue callbacks, due reviews and meetings in the next seven days, using Africa/Lagos time. After saving a booked call, BOLT opens a meeting brief and calendar review. Review the account, time, planning duration and reminders, then explicitly confirm to add or update a private Google Calendar event. The default reminders are an email one day before and a calendar notification fifteen minutes before; either can be disabled. No attendee invitation or message is sent. Only the studio name and scheduling details are included; transcripts and research are not copied into events.

Open **Calendar & reminders** for one-time setup:

1. In your Google Cloud project, enable the Google Calendar API and configure Google Auth Platform consent. If the app is in Testing, add your intended calendar account as a test user.
2. Create an OAuth client of type **Desktop app** and download its JSON. Choose the file inside BOLT and save the setup. Do not commit it or paste it into chat.
3. Connect Google Calendar in your normal browser, approve both requested permissions, return to BOLT, and refresh the connection. Check the displayed primary calendar account before scheduling.

BOLT requests access to events on calendars you own and read-only access to your calendar list. It uses your owned primary calendar. It does not request Gmail, Drive or Sheets access. The chat’s Google connector cannot provide this app’s authorization. Google Testing-mode authorizations may expire and require reconnecting.

Scheduling checks for overlaps on the connected primary calendar. A clash requires an additional explicit confirmation; it does not silently move the agreed meeting. Retries reuse a stable event ID, including after a lost response or lead-bank update. Existing events with attendees must be adjusted in Google Calendar. Changes made directly in Google are reconciled when you check/save again; this version does not continuously sync external edits or monitor all your other calendars.

Credentials are encrypted in `lead-workspace/saved/google-calendar.dpapi`. Scheduling confirmations are stored separately in `lead-workspace/saved/calendar-jobs.json`. Keep a private copy of that ledger alongside your workspace backups: the **Full workspace** export does not include the calendar connection or ledger. Restoring call history does not delete Google events or rewind this ledger. BOLT flags mismatched records for review; disconnecting also leaves existing Google events intact. Deleted Google events are not silently recreated.

Once an event has been saved to Google, Google handles reminders according to your account/device notification settings. BOLT need not remain open for Google’s reminders. Live authorization, provider behavior and delivery require testing with your configured account; synthetic tests do not prove phone notification delivery. The local desk itself is not an always-on notification service.

Provider references: [Google Desktop OAuth](https://developers.google.com/identity/protocols/oauth2/native-app), [create events](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert), [reminders](https://developers.google.com/workspace/calendar/api/concepts/reminders).

The server binds to loopback for use on the local computer. This repository is not a cloud deployment or a multi-user service.

## Tasks, meeting notes and weekly review

In a lead’s **Calls & notes**, choose **Extract commitments** after its transcript is saved. BOLT proposes actions with exact supporting quotes. Review the owner, wording and date, then accept or dismiss each proposal. Acceptance creates a task; it never books a meeting or sends anything. Unknown dates stay blank. Manual tasks are available from **Tasks** or the lead history; prospect-owned actions start as Waiting.

**Today** shows due or undated open tasks and meeting follow-ups. **Meetings** stores preparation, held/no-show/cancelled outcomes, notes, next actions and follow-up dates. These records do not add call attempts or bookings. Relationship stages, including proposal and won/lost, are recorded separately by you. Changing a local meeting outcome does not cancel its Google event.

**Weekly review** shows Monday–Sunday counts using each call’s Lagos date, distinct appointments and booking rate per call attempt. Select **Analyse this week** to request an AI review through the signed-in Codex account. All saved calls count toward the metrics; analysis uses at most 30 calls, 10,000 characters per call and 160,000 characters total. Transcripts take precedence over seller notes. Observations link to exact source quotes; text-only analysis cannot assess voice delivery. Changed call evidence marks an earlier review stale. This review is on demand, with no background schedule.

The lead header’s **Open WhatsApp** link opens a conversation for a usable phone number. Nigerian mobile prefixes are normalized; WhatsApp chooses whether to open its website or desktop app. BOLT does not automatically dial, confirm that a number uses WhatsApp, or record audio.

Tasks, commitment proposals, meeting notes, relationship stages and saved weekly reviews are stored in the local workspace JSON and included in its full backup/export and restore. Every saved change uses the existing revision checks, atomic save and pre-change backup. Google Sheets intake and automatic batch replenishment are not part of this version.

## Verify

```sh
cd lead-workspace
node --test tests/*.test.mjs
```

Tests use synthetic fixtures and temporary storage. No private lead data or live account connection is needed.
