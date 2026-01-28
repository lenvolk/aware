# Change Log

All notable changes to the "aware" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.0.1] - 2026-01-26

### Added
- Meeting tracking and reminders with configurable notification times
- @aware chat participant with `/meetings` and `/next` commands
- Language model tools for Copilot (`getMeetings`, `getNextMeeting`)
- Sidebar views for upcoming meetings and related documents
- Status bar integration showing next meeting countdown
- One-click meeting join via Teams links
- Automatic Work IQ MCP server configuration
- Model selection for premium vs included models
- Graceful degradation when Work IQ is unavailable
- Clear error messaging for M365 Copilot license and admin consent issues

### Requirements
- GitHub Copilot subscription
- Microsoft 365 Copilot license
- Work IQ MCP server configured and running
- Organization admin consent for Work IQ