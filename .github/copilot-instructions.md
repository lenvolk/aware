# Aware Extension - Copilot Instructions

## Project Overview

Aware is a VS Code extension that integrates with Microsoft 365 via the Work IQ MCP server to help users track their meetings and stay aware of their schedule.

## Architecture

### Core Components

1. **MeetingService** (`src/meetingService.ts`)
   - Queries Work IQ MCP server for calendar data
   - Parses natural language responses into structured Meeting objects
   - Caches meetings and refreshes at configured intervals

2. **NotificationManager** (`src/notificationManager.ts`)
   - Schedules and displays meeting reminders
   - Tracks which notifications have been sent

3. **StatusBarManager** (`src/statusBar.ts`)
   - Shows next meeting in status bar
   - Shows red "Meeting Now" indicator when a meeting is in progress

4. **Tree Views** (`src/treeViews.ts`)
   - MeetingsTreeDataProvider: Shows upcoming meetings in categories (Now, Soon, Later)
   - DocumentsTreeDataProvider: Shows related documents for current repo

5. **Document Service** (`src/documentService.ts`)
   - Queries Work IQ for documents related to current repo
   - Parses document responses with real URLs from footnotes

6. **Chat Participant** (`src/chatParticipant.ts`)
   - Implements @aware chat participant
   - Handles /meetings, /next commands
   - Uses configurable language model via ModelSelector

7. **ModelSelector** (`src/modelSelector.ts`)
   - Queries available Copilot language models
   - Identifies premium vs standard models
   - Provides model picker UI with premium warnings

8. **Language Model Tools** (`src/tools.ts`)
   - Provides tools for Copilot: getMeetings, getNextMeeting

9. **Config** (`src/config.ts`)
   - Centralized configuration access for all settings

## Key Types

Located in `src/types.ts`:
- `Meeting`: id, title, startTime, endTime, duration, isOnline, status, joinUrl
- `RelatedDocument`: title, url, type, lastModified
- `TimeRange`: 'today' | 'tomorrow' | 'week'
- `WorkIQResponse`: response wrapper for Work IQ queries
- `AwareConfig`: Configuration options

## Configuration

Settings in `package.json` under `contributes.configuration`:
- `aware.meetingReminderMinutes`: Minutes before meeting reminder (default: 10)
- `aware.refreshIntervalMinutes`: Calendar refresh interval (default: 5). Note: Lower values may increase premium model usage.
- `aware.showStatusBar`: Show status bar item (default: true)
- `aware.enableNotifications`: Enable notifications (default: true)
- `aware.workingHoursStart/End`: Working hours range
- `aware.preferredModel`: Exact model ID to use (leave empty for auto-selection). Use `Aware: Select Model` command to pick from available models.

### Model Selection

The extension allows users to configure which language model to use:

1. **ModelSelector** (`src/modelSelector.ts`)
   - Queries available Copilot models via `vscode.lm.selectChatModels()`
   - Identifies premium vs included models
   - Provides QuickPick UI for model selection
   - Warns users about premium model usage with auto-refresh

2. **Premium Model Detection**: 
   - **Included models** (unlimited on paid plans): GPT-5 mini, GPT-4.1, GPT-4o
   - **Premium models** (count against quota): All other models (Claude, Gemini, o1, o3, GPT-4.5, GPT-5, etc.)
   - Note: The VS Code API does not expose billing tier. Detection uses a hardcoded list of included model families.

3. **Command**: `aware.selectModel` - Opens a picker showing all available models with premium indicators.

## Work IQ Integration

The extension integrates with Microsoft Work IQ MCP server for M365 data access.

### MCP Server Setup

The extension detects if Work IQ is available and prompts users to install it if not. When the user accepts, it adds the following to their VS Code user settings (`mcp.servers`):

```json
{
  "workiq": {
    "command": "npx",
    "args": ["-y", "@microsoft/workiq", "mcp"],
    "env": {
      "npm_config_registry": "https://registry.npmjs.org"
    }
  }
}
```

- **Source**: https://github.com/microsoft/work-iq-mcp
- **Command**: `aware.configureWorkIQ` - Manually add Work IQ to settings
- **Prompt dismissal**: The installation prompt includes a "Don't ask again" option that persists to `globalState` under key `aware.workiqPromptDismissed`

After installation, users need to start the MCP server. The tool `mcp_workiq_ask_work_iq` will then appear in `vscode.lm.tools`.

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

All commands prefixed with `aware.`:
- showMeetings, refreshMeetings, joinMeeting, openSettings, selectModel

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
- Chat participant requires GitHub Copilot extension
- Language model tools require `name`, `displayName`, `description`, `modelDescription`, and `toolReferenceName` when `canBeReferencedInPrompt` is true
- **No `console.log` in production code** - Debug statements should be removed before publishing
