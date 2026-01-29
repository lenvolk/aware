/**
 * Webview provider for the Aware sidebar
 * Shows today's meetings
 */

import * as vscode from 'vscode';
import { Meeting } from './types';
import { MeetingService } from './meetingService';

export class MeetingsWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'aware.meetingsWebview';
    
    private _view?: vscode.WebviewView;
    private _extensionUri: vscode.Uri;
    private _autoRefreshInterval: NodeJS.Timeout | null = null;
    private _refreshAttempts = 0;
    private _didAutoRefresh = false;

    constructor(
        extensionUri: vscode.Uri,
        private meetingService: MeetingService
    ) {
        this._extensionUri = extensionUri;
        
        // Update webview when data changes
        this.meetingService.onMeetingsUpdated(() => this._updateWebview());
        this.meetingService.onLoadingStarted(() => this._updateWebview(true));
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'joinMeeting':
                    if (message.url) {
                        vscode.env.openExternal(vscode.Uri.parse(message.url));
                    }
                    break;
                case 'startServer':
                    await vscode.commands.executeCommand('workbench.mcp.listServers');
                    break;
            }
        });

        // Send initial data once webview is ready
        setTimeout(() => this._updateWebview(), 100);

        // If meetings weren't loaded yet (common if Work IQ wasn't available during activation),
        // auto-refresh once when Work IQ becomes available.
        this._ensureAutoRefresh();
    }

    public refresh(): void {
        this._updateWebview();
    }

    private _updateWebview(isLoading = false): void {
        if (this._view) {
            const meetings = this.meetingService.getCachedMeetings();
            const lastRefresh = this.meetingService.getLastRefresh();
            const isAvailable = this.meetingService.isWorkIQAvailable();

            this._view.webview.postMessage({
                type: 'update',
                meetings: meetings.map(m => ({
                    id: m.id,
                    title: m.title,
                    startTime: m.startTime.toISOString(),
                    endTime: m.endTime.toISOString(),
                    duration: m.duration,
                    isOnline: m.isOnline,
                    joinUrl: m.joinUrl,
                    status: m.status
                })),
                isLoading,
                isAvailable,
                lastRefresh: lastRefresh?.toISOString()
            });
        }

        this._ensureAutoRefresh();
    }

    private _ensureAutoRefresh(): void {
        // Keep trying until we have a successful refresh (lastRefresh is set)
        if (this._didAutoRefresh) {
            return;
        }

        const hasAnyMeetings = this.meetingService.getCachedMeetings().length > 0;
        const lastRefresh = this.meetingService.getLastRefresh();
        if (hasAnyMeetings || lastRefresh) {
            this._didAutoRefresh = true;
            this._clearAutoRefreshInterval();
            return;
        }

        // Poll lightly until Work IQ is available, then refresh. If the refresh fails,
        // keep polling and retry a couple times.
        if (!this._autoRefreshInterval) {
            this._autoRefreshInterval = setInterval(() => {
                const available = this.meetingService.isWorkIQAvailable();
                const refreshed = this.meetingService.getLastRefresh();
                if (refreshed || this.meetingService.getCachedMeetings().length > 0) {
                    this._didAutoRefresh = true;
                    this._clearAutoRefreshInterval();
                    return;
                }

                if (available && this._refreshAttempts < 3) {
                    this._refreshAttempts++;
                    void vscode.commands.executeCommand('aware.refreshMeetings');
                }
            }, 2000);
        }
    }

    private _clearAutoRefreshInterval(): void {
        if (this._autoRefreshInterval) {
            clearInterval(this._autoRefreshInterval);
            this._autoRefreshInterval = null;
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        // Get URI for codicon font
        const codiconsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css'));
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="${codiconsUri}" rel="stylesheet" />
    <title>Meetings</title>
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        
        body {
            font-family: var(--vscode-font-family);
            font-size: 13px;
            color: var(--vscode-foreground);
            background: transparent;
            line-height: 1.4;
        }
        
        .container {
            padding: 8px;
        }
        
        /* Section headers */
        .section-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 4px;
            margin-bottom: 8px;
        }
        
        .section-title {
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            opacity: 0.7;
        }
        
        /* Live meeting banner */
        .live-meeting {
            background: linear-gradient(135deg, 
                rgba(220, 50, 50, 0.15),
                rgba(220, 50, 50, 0.05)
            );
            border-left: 3px solid var(--vscode-charts-red, #f14c4c);
            border-radius: 6px;
            padding: 12px;
            margin-bottom: 12px;
        }
        
        .live-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: var(--vscode-charts-red, #f14c4c);
            color: white;
            font-size: 10px;
            font-weight: 600;
            padding: 2px 8px;
            border-radius: 10px;
            text-transform: uppercase;
            margin-bottom: 8px;
        }
        
        .live-dot {
            width: 6px;
            height: 6px;
            background: white;
            border-radius: 50%;
            animation: pulse 1.5s ease-in-out infinite;
        }
        
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.4; }
        }
        
        .live-meeting h3 {
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 4px;
        }
        
        .live-meeting .time {
            font-size: 12px;
            opacity: 0.8;
        }
        
        .join-btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 6px 12px;
            border-radius: 4px;
            font-size: 12px;
            cursor: pointer;
            margin-top: 8px;
        }
        
        .join-btn:hover {
            background: var(--vscode-button-hoverBackground);
        }
        
        /* Meeting card */
        .meeting-card {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-widget-border);
            border-radius: 6px;
            padding: 10px 12px;
            margin-bottom: 8px;
            transition: border-color 0.15s;
        }
        
        .meeting-card:hover {
            border-color: var(--vscode-focusBorder);
        }
        
        .meeting-card.soon {
            border-left: 3px solid var(--vscode-charts-yellow, #cca700);
        }
        
        .meeting-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 8px;
        }
        
        .meeting-title {
            font-weight: 500;
            flex: 1;
            word-break: break-word;
        }
        
        .meeting-time {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            white-space: nowrap;
        }
        
        .meeting-meta {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-top: 6px;
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }
        
        .meeting-duration {
            display: flex;
            align-items: center;
            gap: 4px;
        }
        
        .starts-in {
            color: var(--vscode-charts-yellow, #cca700);
            font-weight: 500;
        }
        
        .meeting-actions {
            margin-top: 8px;
        }
        
        .join-link {
            font-size: 12px;
            color: var(--vscode-textLink-foreground);
            cursor: pointer;
            text-decoration: none;
        }
        
        .join-link:hover {
            text-decoration: underline;
        }
        
        /* Empty state */
        .empty-state {
            text-align: center;
            padding: 24px 16px;
            color: var(--vscode-descriptionForeground);
        }
        
        .empty-state svg {
            width: 48px;
            height: 48px;
            margin-bottom: 12px;
            opacity: 0.4;
        }
        
        .empty-state h3 {
            font-size: 14px;
            font-weight: 500;
            margin-bottom: 4px;
            color: var(--vscode-foreground);
        }
        
        .empty-state p {
            font-size: 12px;
        }
        
        /* Not available state */
        .not-available {
            background: var(--vscode-inputValidation-warningBackground);
            border: 1px solid var(--vscode-inputValidation-warningBorder);
            border-radius: 6px;
            padding: 16px;
            margin-bottom: 12px;
        }
        
        .not-available h3 {
            font-size: 13px;
            margin-bottom: 8px;
        }
        
        .not-available p {
            font-size: 12px;
            margin-bottom: 12px;
            opacity: 0.9;
        }
        
        .start-server-btn {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 6px 12px;
            border-radius: 4px;
            font-size: 12px;
            cursor: pointer;
        }
        
        .start-server-btn:hover {
            background: var(--vscode-button-hoverBackground);
        }
        
        /* Loading */
        .loading {
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
        }
        
        .loading-spinner {
            width: 16px;
            height: 16px;
            border: 2px solid var(--vscode-widget-border);
            border-top-color: var(--vscode-button-background);
            border-radius: 50%;
            margin-right: 8px;
            animation: spin 1s linear infinite;
        }
    </style>
</head>
<body>
    <div class="container" id="app">
        <div class="loading">
            <div class="loading-spinner"></div>
            Loading...
        </div>
    </div>
    
    <script>
        const vscode = acquireVsCodeApi();
        
        function formatTime(isoString) {
            const date = new Date(isoString);
            return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        }
        
        function getMinutesUntil(isoString) {
            const now = new Date();
            const target = new Date(isoString);
            return Math.round((target - now) / 60000);
        }
        
        function formatMinutesUntil(mins) {
            if (mins < 1) return 'now';
            if (mins < 60) return mins + 'm';
            const hours = Math.floor(mins / 60);
            const remainingMins = mins % 60;
            return remainingMins > 0 ? hours + 'h ' + remainingMins + 'm' : hours + 'h';
        }
        
        function render(data) {
            const app = document.getElementById('app');
            
            if (data.isLoading) {
                app.innerHTML = '<div class="loading"><div class="loading-spinner"></div>Loading...</div>';
                return;
            }
            
            let html = '';
            
            // Not available state
            if (!data.isAvailable) {
                html += \`
                    <div class="not-available">
                        <h3>⚠️ Work IQ Not Running</h3>
                        <p>Start the Work IQ MCP server to see your meetings.</p>
                        <button class="start-server-btn" onclick="startServer()">Open MCP Servers</button>
                    </div>
                \`;
            }
            
            // Meetings section header
            html += \`
                <div class="section-header">
                    <span class="section-title">Today's Meetings</span>
                </div>
            \`;
            
            const meetings = data.meetings || [];
            const inProgress = meetings.filter(m => m.status === 'inProgress');
            const upcoming = meetings.filter(m => m.status === 'upcoming');
            
            // Live meeting banner
            if (inProgress.length > 0) {
                const m = inProgress[0];
                html += \`
                    <div class="live-meeting">
                        <div class="live-badge"><span class="live-dot"></span> LIVE</div>
                        <h3>\${escapeHtml(m.title)}</h3>
                        <div class="time">\${formatTime(m.startTime)} - \${formatTime(m.endTime)}</div>
                        \${m.joinUrl ? '<button class="join-btn" onclick="joinMeeting(\\'' + m.joinUrl + '\\')">Join Meeting</button>' : ''}
                    </div>
                \`;
            }
            
            // Upcoming meetings
            if (upcoming.length > 0) {
                for (const m of upcoming) {
                    const minsUntil = getMinutesUntil(m.startTime);
                    const isSoon = minsUntil <= 15;
                    
                    html += \`
                        <div class="meeting-card \${isSoon ? 'soon' : ''}">
                            <div class="meeting-header">
                                <span class="meeting-title">\${escapeHtml(m.title)}</span>
                                <span class="meeting-time">\${formatTime(m.startTime)}</span>
                            </div>
                            <div class="meeting-meta">
                                <span class="meeting-duration">🕐 \${m.duration}m</span>
                                \${isSoon ? '<span class="starts-in">in ' + formatMinutesUntil(minsUntil) + '</span>' : ''}
                            </div>
                            \${m.joinUrl ? '<div class="meeting-actions"><a class="join-link" onclick="joinMeeting(\\'' + m.joinUrl + '\\')">Join →</a></div>' : ''}
                        </div>
                    \`;
                }
            } else if (inProgress.length === 0 && data.isAvailable) {
                if (!data.lastRefresh) {
                    html += '<div class="loading"><div class="loading-spinner"></div>Loading your meetings...</div>';
                } else {
                    html += \`
                        <div class="empty-state">
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zm0-12H5V6h14v2z"/>
                            </svg>
                            <h3>No meetings today</h3>
                            <p>Enjoy your meeting-free day!</p>
                        </div>
                    \`;
                }
            }
            
            app.innerHTML = html;
        }
        
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
        
        function joinMeeting(url) {
            vscode.postMessage({ command: 'joinMeeting', url });
        }
        
        function startServer() {
            vscode.postMessage({ command: 'startServer' });
        }
        
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'update') {
                render(message);
            }
        });
    </script>
</body>
</html>`;
    }
}
