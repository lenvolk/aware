# Focus Time

AI-powered focus time manager for VS Code that integrates with Microsoft 365 to track your meetings and help you stay focused.

## Prerequisites

This extension requires:

1. **GitHub Copilot** - Active subscription with the GitHub Copilot extension installed
2. **Microsoft 365 Copilot License** - Required for each user accessing Work IQ
3. **Work IQ MCP Server** - Must be configured in VS Code (see setup below)
4. **Admin Consent** - Your organization's admin must grant consent for Work IQ ([Admin Guide](https://github.com/microsoft/work-iq-mcp/blob/main/ADMIN-INSTRUCTIONS.md))

### Work IQ MCP Server Setup

The extension uses [Microsoft Work IQ](https://github.com/microsoft/work-iq-mcp) to access your Microsoft 365 calendar data.

**Quick Install (recommended):**

[Install Work IQ in VS Code](https://vscode.dev/redirect/mcp/install?name=workiq&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40microsoft%2Fworkiq%22%2C%22mcp%22%5D%7D)

**Manual Configuration:**

Add to your VS Code MCP settings:

```json
{
  "workiq": {
    "command": "npx",
    "args": ["-y", "@microsoft/workiq", "mcp"]
  }
}
```

**First-time setup:**

```bash
# Accept the EULA (required on first use)
npx @microsoft/workiq accept-eula
```

> **Note:** Work IQ is in Public Preview. Features and APIs may change.

## Features

### Meeting Awareness
- **Automatic Calendar Sync**: Uses the Work IQ MCP server to fetch your upcoming meetings from Microsoft 365
- **Meeting Reminders**: Get notified before meetings start (configurable reminder time)
- **Status Bar Integration**: See your next meeting at a glance in the VS Code status bar

### Focus Mode
- **Auto Do Not Disturb**: Automatically enables Do Not Disturb when a meeting ends, giving you uninterrupted focus time
- **Focus Sessions**: Start timed focus sessions with a single command
- **Cross-Platform DND**: Supports Windows Focus Assist, macOS Do Not Disturb, and GNOME notifications

### Copilot Integration
- **@focus Chat Participant**: Chat with `@focus` to manage your meetings and focus time
  - `/meetings` - Show your upcoming meetings
  - `/focus` - Start a focus session
  - `/status` - Check your current focus status
  - `/next` - See when your next meeting is

- **Language Model Tools**: Copilot can use these tools to help you:
  - `focusTime_getMeetings` - Get upcoming meetings
  - `focusTime_getNextMeeting` - Get next meeting details
  - `focusTime_startFocus` - Start a focus session
  - `focusTime_stopFocus` - Stop focus session
  - `focusTime_getFocusStatus` - Check focus status

### Sidebar Views
- **Upcoming Meetings**: See all your meetings in a dedicated sidebar view
- **Focus Status**: Monitor your current focus session

## Requirements

| Requirement | Details |
|-------------|--------|
| VS Code | 1.108.1 or later |
| GitHub Copilot | Required for chat participant and language model tools |
| Microsoft 365 Copilot | License required for Work IQ access |
| Work IQ MCP Server | See [Prerequisites](#prerequisites) for setup |
| Node.js | Required for npx to run Work IQ |

## Extension Settings

This extension contributes the following settings:

| Setting | Default | Description |
|---------|---------|-------------|
| `focusTime.meetingReminderMinutes` | `10` | Minutes before a meeting to show a reminder notification |
| `focusTime.autoEnableDoNotDisturb` | `true` | Automatically enable Do Not Disturb when a meeting ends |
| `focusTime.refreshIntervalMinutes` | `5` | How often to refresh the meeting list from your calendar |
| `focusTime.showStatusBar` | `true` | Show Focus Time status in the status bar |
| `focusTime.enableNotifications` | `true` | Enable meeting reminder notifications |
| `focusTime.workingHoursStart` | `09:00` | Start of working hours (HH:MM format) |
| `focusTime.workingHoursEnd` | `17:00` | End of working hours (HH:MM format) |

## Commands

| Command | Description |
|---------|-------------|
| `Focus Time: Show Upcoming Meetings` | Display your upcoming meetings |
| `Focus Time: Refresh Meetings` | Refresh the meeting list from your calendar |
| `Focus Time: Toggle Do Not Disturb` | Toggle Do Not Disturb mode |
| `Focus Time: Start Focus Session` | Start a new focus session |
| `Focus Time: Stop Focus Session` | Stop the current focus session |
| `Focus Time: Join Meeting` | Join the current or next online meeting |
| `Focus Time: Open Settings` | Open Focus Time settings |

## How It Works

1. **Calendar Integration**: The extension uses the Work IQ MCP server to query your Microsoft 365 calendar for upcoming meetings.

2. **Meeting Tracking**: Meetings are cached locally and refreshed at configurable intervals. The extension tracks meeting status (upcoming, in progress, ended).

3. **Notifications**: When a meeting is approaching (based on `meetingReminderMinutes`), you'll receive a notification with options to join or dismiss.

4. **Focus Mode Activation**: When a meeting ends, the extension automatically enables Do Not Disturb on your system, allowing you to focus without interruptions.

5. **Copilot Integration**: Use `@focus` in Copilot Chat to interact with your calendar and focus sessions using natural language.

## Platform Support

### Do Not Disturb Implementation
- **Windows 11**: Uses PowerShell UI Automation to toggle Focus Assist automatically. Falls back to opening Quick Settings if automation fails.
- **macOS (Monterey+)**: Uses Shortcuts app to toggle Do Not Disturb
- **Linux (GNOME)**: Uses gsettings to disable notification banners

## Known Issues

- Work IQ requires a Microsoft 365 Copilot license; the extension will show an error if the MCP server is not configured
- Some meeting properties may not be available depending on your Microsoft 365 configuration
- Windows 11 DND automation may require running VS Code with appropriate permissions

## Troubleshooting

**"Work IQ MCP server not available" error:**
1. Ensure Work IQ is installed: `npx @microsoft/workiq version`
2. Accept the EULA: `npx @microsoft/workiq accept-eula`
3. Verify MCP configuration in VS Code settings
4. Check that your organization has granted admin consent

**Meetings not loading:**
1. Verify your Microsoft 365 Copilot license is active
2. Try running `npx @microsoft/workiq ask -q "What are my meetings today?"` in terminal to test

## Release Notes

### 0.0.1

- Initial release
- Meeting tracking and reminders
- Focus session management
- @focus chat participant
- Language model tools for Copilot
- Cross-platform Do Not Disturb support

---

**Enjoy your focused coding time!**
