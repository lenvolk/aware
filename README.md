# Focus Time

AI-powered focus time manager for VS Code that integrates with Microsoft 365 to track your meetings and help you stay focused.

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

- **Work IQ MCP Server**: You must have the Work IQ MCP server configured and connected to your Microsoft 365 account
- **GitHub Copilot**: Required for the chat participant and language model tools features

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
- **Windows**: Opens Focus Assist settings (requires manual toggle)
- **macOS**: Uses Shortcuts app to toggle Do Not Disturb
- **Linux (GNOME)**: Uses gsettings to disable notification banners

## Known Issues

- Direct Work IQ MCP tool invocation requires an active Copilot Chat context; the extension falls back to model-based queries when used outside chat
- Some meeting properties may not be available depending on your Microsoft 365 configuration

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
