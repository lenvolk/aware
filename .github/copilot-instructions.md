# Focus Time Extension - Copilot Instructions

## Project Overview

Focus Time is a VS Code extension that integrates with Microsoft 365 via the Work IQ MCP server to help users manage their focus time around meetings.

## Architecture

### Core Components

1. **MeetingService** (`src/meetingService.ts`)
   - Queries Work IQ MCP server for calendar data
   - Parses natural language responses into structured Meeting objects
   - Caches meetings and refreshes at configured intervals

2. **FocusSessionManager** (`src/focusSessionManager.ts`)
   - Manages focus session state (start, stop, duration tracking)
   - Auto-starts focus after meetings end
   - Controls Do Not Disturb on Windows/Mac/Linux

3. **NotificationManager** (`src/notificationManager.ts`)
   - Schedules and displays meeting reminders
   - Tracks which notifications have been sent

4. **StatusBarManager** (`src/statusBar.ts`)
   - Shows next meeting or focus status in status bar

5. **Tree Views** (`src/treeViews.ts`)
   - MeetingsTreeDataProvider: Shows upcoming meetings in categories (Now, Soon, Later)
   - DocumentsTreeDataProvider: Shows related documents for current repo
   - ActionItemsTreeDataProvider: Shows action items from meetings/emails
   - EmailsTreeDataProvider: Shows important unread emails
   - CollaboratorsTreeDataProvider: Shows key collaborators
   - MeetingPrepTreeDataProvider: Shows prep info for next meeting
   - FocusStatusTreeDataProvider: Shows focus session status

6. **Document Service** (`src/documentService.ts`)
   - Queries Work IQ for documents related to current repo
   - Parses document responses with real URLs from footnotes

7. **Action Items Service** (`src/actionItemsService.ts`)
   - Queries Work IQ for action items from recent meetings/emails
   - Tracks status (not-started, in-progress, pending, completed)

8. **Email Service** (`src/emailService.ts`)
   - Queries Work IQ for important unread emails
   - Shows sender, importance, attachments, needs-response flag

9. **Collaborators Service** (`src/collaboratorsService.ts`)
   - Queries Work IQ for frequently interacted collaborators
   - Shows role, department, last interaction type

10. **Meeting Prep Service** (`src/meetingPrepService.ts`)
    - Queries Work IQ for context on upcoming meeting
    - Shows topics, previous decisions, related documents

11. **Chat Participant** (`src/chatParticipant.ts`)
   - Implements @focus chat participant
   - Handles /meetings, /focus, /status, /next commands

8. **Language Model Tools** (`src/tools.ts`)
   - Provides tools for Copilot: getMeetings, getNextMeeting, startFocus, stopFocus, getFocusStatus

## Key Types

Located in `src/types.ts`:
- `Meeting`: id, title, startTime, endTime, duration, isOnline, status, joinUrl
- `FocusSession`: id, startTime, duration, remainingMinutes, isActive
- `ActionItem`: task, source, sourceType, status, dueDate
- `ImportantEmail`: subject, from, importance, needsResponse, preview
- `Collaborator`: name, email, role, department, recentInteractionType
- `MeetingPrep`: topics, previousDecisions, relatedDocuments
- `FocusTimeConfig`: Configuration options

## Configuration

Settings in `package.json` under `contributes.configuration`:
- `focusTime.meetingReminderMinutes`: Minutes before meeting reminder (default: 10)
- `focusTime.autoEnableDoNotDisturb`: Auto-enable DND after meetings (default: true)
- `focusTime.refreshIntervalMinutes`: Calendar refresh interval (default: 5)
- `focusTime.showStatusBar`: Show status bar item (default: true)
- `focusTime.enableNotifications`: Enable notifications (default: true)
- `focusTime.workingHoursStart/End`: Working hours range

## Windows Do Not Disturb Control

**Important**: Windows 11 has NO public API for toggling Do Not Disturb / Focus Assist programmatically. 

### Available Methods (reliability order)

1. **UI Automation (current implementation)**: Uses PowerShell + System.Windows.Automation to:
   - Open Notification Center (Win+N)
   - Find the "Do not disturb" button via automation
   - Click it programmatically
   - Close the panel
   - Falls back to opening Quick Settings if automation fails

2. **Settings URI fallback**: `ms-settings:notifications` opens notification settings for manual toggle

3. **Registry approach**: Does NOT work reliably - the CloudStore binary format is undocumented and changes don't apply immediately

### Platform-specific DND implementations
- **Windows**: UI Automation via PowerShell (see above)
- **macOS**: Shortcuts app "Turn On/Off Do Not Disturb" (requires Monterey+)
- **Linux**: `gsettings set org.gnome.desktop.notifications show-banners false`

## Work IQ Integration

The extension queries Work IQ MCP server using natural language queries.

### Tested Query Format (IMPORTANT)
The following prompt format has been tested and produces predictable, parseable responses:

```
What are ALL my meetings today? Return as JSON array with fields: title, startTime (ISO 8601), endTime (ISO 8601), onlineJoinUrl (the complete Teams URL if it's an online meeting, or null if not). Include all meetings regardless of whether they have an online join link.
```

### Expected Response Format
WorkIQ returns responses in this structure:
```
Here are all your meetings today:

```json
[
  {
    "title": "Meeting Name",
    "startTime": "2026-01-19T13:00:00-06:00",
    "endTime": "2026-01-19T14:00:00-06:00",
    "onlineJoinUrl": null
  }
]
```

[1](https://teams.microsoft.com/l/meeting/details?eventId=...actual-url...)
```

**Key parsing notes:**
- JSON is wrapped in markdown code fences (```json ... ```)
- The `onlineJoinUrl` field in JSON is often `null` or a placeholder
- The REAL Teams URLs are in markdown footnotes at the END: `[1](https://teams...)`
- Footnotes are numbered `[1]`, `[2]`, etc. corresponding to meeting order
- Parse JSON first, then extract real URLs from footnotes and map by index
- Footnote regex: `/\[(\d+)\]\((https:\/\/teams\.microsoft\.com[^)]+)\)/g`
- Use `vscode.lm.invokeTool()` to directly invoke MCP tools
- The MCP tool name is `mcp_workiq_ask_work_iq`

## Tree View Structure

Meetings are categorized:
- **Happening Now** - Meetings with status 'inProgress' (using pulse/broadcast icon)
- **Starting Soon** - Upcoming meetings within 15 minutes (using clock icon)
- **Later Today** - All other upcoming meetings (using calendar icon)

Meetings with join URLs are expandable and show a "Join Meeting" child item.

## Commands

All commands prefixed with `focusTime.`:
- showMeetings, refreshMeetings, toggleDoNotDisturb
- startFocusSession, stopFocusSession, joinMeeting, openSettings

## Building and Testing

```bash
npm run compile    # Compile TypeScript
npm run watch      # Watch mode
npm run test       # Run tests
npm run lint       # Lint code
```

## Important Notes

- Work IQ MCP server must be configured and connected
- The MCP tool name is `mcp_workiq_ask_work_iq` - use `vscode.lm.invokeTool()` to invoke it
- DND on Windows uses PowerShell to modify notification registry settings
- Chat participant requires GitHub Copilot extension
- Language model tools require `name`, `displayName`, `description`, `modelDescription`, and `toolReferenceName` when `canBeReferencedInPrompt` is true
