/**
 * Tree view for displaying meetings in the sidebar
 */

import * as vscode from 'vscode';
import { Meeting, RelatedDocument, WorkIQConnectionStatus } from './types';
import { MeetingService } from './meetingService';
import { DocumentService } from './documentService';

type MeetingTreeElement = MeetingCategoryItem | MeetingTreeItem | JoinMeetingItem | ConnectionStatusItem;

export class MeetingsTreeDataProvider implements vscode.TreeDataProvider<MeetingTreeElement> {
    private _onDidChangeTreeData = new vscode.EventEmitter<MeetingTreeElement | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private isLoading = false;
    private connectionStatus: WorkIQConnectionStatus | null = null;

    constructor(
        private meetingService: MeetingService
    ) {
        // Refresh when meetings are updated
        this.meetingService.onMeetingsUpdated(() => {
            this.isLoading = false;
            this._onDidChangeTreeData.fire();
        });

        // Listen for loading start
        this.meetingService.onLoadingStarted(() => {
            this.isLoading = true;
            this._onDidChangeTreeData.fire();
        });
        
        // Listen for connection state changes
        this.meetingService.onConnectionStateChanged((status) => {
            this.connectionStatus = status;
            this.isLoading = false;
            this._onDidChangeTreeData.fire();
        });
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    setLoading(loading: boolean): void {
        this.isLoading = loading;
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: MeetingTreeElement): vscode.TreeItem {
        return element;
    }

    getChildren(element?: MeetingTreeElement): Thenable<MeetingTreeElement[]> {
        // If element is a meeting, return empty array (we don't want join link as child anymore)
        if (element instanceof MeetingTreeItem) {
            return Promise.resolve([]);
        }

        // If element is a category, return its meetings
        if (element instanceof MeetingCategoryItem) {
            return Promise.resolve(
                element.meetings.map(m => new MeetingTreeItem(m, element.categoryType))
            );
        }

        // If we're at the root level
        if (!element) {
            const items: MeetingTreeElement[] = [];

            if (this.isLoading) {
                items.push(new MeetingTreeItem(null, 'loading'));
                return Promise.resolve(items);
            }
            
            // Show connection status if not connected
            const status = this.connectionStatus || this.meetingService.getConnectionStatus();
            if (status.state !== 'connected') {
                items.push(new ConnectionStatusItem(status));
                return Promise.resolve(items);
            }

            const meetings = this.meetingService.getCachedMeetings();
            const now = Date.now();
            const fifteenMinutes = 15 * 60 * 1000;

            // Categorize meetings
            const happeningNow = meetings.filter(m => m.status === 'inProgress');
            const startingSoon = meetings.filter(m => {
                if (m.status !== 'upcoming') {return false;}
                const timeUntil = m.startTime.getTime() - now;
                return timeUntil <= fifteenMinutes && timeUntil > 0;
            });
            const upcoming = meetings.filter(m => {
                if (m.status !== 'upcoming') {return false;}
                const timeUntil = m.startTime.getTime() - now;
                return timeUntil > fifteenMinutes;
            });

            if (happeningNow.length > 0) {
                items.push(new MeetingCategoryItem('now', happeningNow, 'Happening Now'));
            }
            if (startingSoon.length > 0) {
                items.push(new MeetingCategoryItem('soon', startingSoon, 'Starting Soon'));
            }
            if (upcoming.length > 0) {
                items.push(new MeetingCategoryItem('upcoming', upcoming, 'Later Today'));
            }

            if (items.length === 0) { // No meetings
                items.push(new MeetingTreeItem(null, 'empty'));
            }

            return Promise.resolve(items);
        }

        return Promise.resolve([]);
    }
}

export class JoinMeetingItem extends vscode.TreeItem {
    constructor(public readonly meeting: Meeting) {
        super('Join Meeting', vscode.TreeItemCollapsibleState.None);
        
        this.iconPath = new vscode.ThemeIcon('link-external', new vscode.ThemeColor('charts.blue'));
        this.contextValue = 'joinMeetingAction';
        
        this.command = {
            command: 'aware.joinMeeting',
            title: 'Join Meeting',
            arguments: [meeting]
        };
        
        this.tooltip = new vscode.MarkdownString(`[Click to join **${meeting.title}**](${meeting.joinUrl})`);
        this.tooltip.isTrusted = true;
    }
}

/**
 * Tree item that shows Work IQ connection status with actionable fix
 */
export class ConnectionStatusItem extends vscode.TreeItem {
    constructor(status: WorkIQConnectionStatus) {
        super(ConnectionStatusItem.getLabelForState(status.state), vscode.TreeItemCollapsibleState.None);
        
        this.description = status.actionLabel || 'Click for help';
        this.iconPath = ConnectionStatusItem.getIconForState(status.state);
        this.contextValue = 'connectionStatus';
        
        // Set command to fix the issue
        if (status.actionCommand) {
            this.command = {
                command: status.actionCommand,
                title: status.actionLabel || 'Fix',
                arguments: status.actionArgs || []
            };
        }
        
        // Build helpful tooltip
        this.tooltip = new vscode.MarkdownString(
            `**${ConnectionStatusItem.getLabelForState(status.state)}**\n\n` +
            `${status.message}\n\n` +
            ConnectionStatusItem.getHelpTextForState(status.state)
        );
        this.tooltip.isTrusted = true;
    }
    
    private static getLabelForState(state: WorkIQConnectionStatus['state']): string {
        switch (state) {
            case 'not_configured':
                return 'Work IQ not configured';
            case 'not_started':
                return 'Work IQ server not running';
            case 'license_required':
                return 'M365 Copilot license required';
            case 'admin_consent':
                return 'Admin consent required';
            case 'auth_required':
                return 'Sign in required';
            case 'unknown_error':
                return 'Connection error';
            default:
                return 'Checking connection...';
        }
    }
    
    private static getIconForState(state: WorkIQConnectionStatus['state']): vscode.ThemeIcon {
        switch (state) {
            case 'not_configured':
                return new vscode.ThemeIcon('plug', new vscode.ThemeColor('charts.yellow'));
            case 'not_started':
                return new vscode.ThemeIcon('debug-disconnect', new vscode.ThemeColor('charts.orange'));
            case 'license_required':
                return new vscode.ThemeIcon('key', new vscode.ThemeColor('charts.red'));
            case 'admin_consent':
                return new vscode.ThemeIcon('shield', new vscode.ThemeColor('charts.red'));
            case 'auth_required':
                return new vscode.ThemeIcon('account', new vscode.ThemeColor('charts.yellow'));
            case 'unknown_error':
                return new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.red'));
            default:
                return new vscode.ThemeIcon('loading~spin');
        }
    }
    
    private static getHelpTextForState(state: WorkIQConnectionStatus['state']): string {
        switch (state) {
            case 'not_configured':
                return '**Click to add** the Work IQ MCP server to your VS Code settings.\n\n' +
                       'Work IQ connects to your Microsoft 365 calendar.';
            case 'not_started':
                return '**Click to open** the MCP Servers panel and start the "workiq" server.\n\n' +
                       'After starting, you may need to authenticate with Microsoft.';
            case 'license_required':
                return 'Aware requires a **Microsoft 365 Copilot license** to access your calendar.\n\n' +
                       'Contact your IT administrator to request access.';
            case 'admin_consent':
                return 'Your organization\'s admin must grant consent for Work IQ.\n\n' +
                       'See the [Admin Guide](https://github.com/microsoft/work-iq-mcp/blob/main/ADMIN-INSTRUCTIONS.md) for setup instructions.';
            case 'auth_required':
                return 'Please sign in to Microsoft 365 when prompted.\n\n' +
                       'Click **Retry** to try connecting again.';
            case 'unknown_error':
                return 'An unexpected error occurred.\n\n' +
                       'Try refreshing or check the Aware output channel for details.';
            default:
                return '';
        }
    }
}

export class MeetingCategoryItem extends vscode.TreeItem {
    constructor(
        public readonly categoryType: 'now' | 'soon' | 'upcoming',
        public readonly meetings: Meeting[],
        label: string
    ) {
        super(label, vscode.TreeItemCollapsibleState.Expanded);
        
        this.contextValue = 'meetingCategory';
        this.description = `${meetings.length} meeting${meetings.length !== 1 ? 's' : ''}`;
        
        if (categoryType === 'now') {
            this.iconPath = new vscode.ThemeIcon('pulse', new vscode.ThemeColor('charts.red'));
        } else if (categoryType === 'soon') {
            this.iconPath = new vscode.ThemeIcon('clock', new vscode.ThemeColor('charts.orange'));
        } else {
            this.iconPath = new vscode.ThemeIcon('calendar');
        }
    }
}

export class MeetingTreeItem extends vscode.TreeItem {
    constructor(
        public readonly meeting: Meeting | null,
        public readonly type: 'now' | 'soon' | 'upcoming' | 'empty' | 'loading'
    ) {
        // Always collapsed since we removed the child item
        super(
            meeting ? meeting.title : (type === 'loading' ? 'Loading meetings...' : 'No upcoming meetings'),
            vscode.TreeItemCollapsibleState.None
        );

        if (type === 'loading') {
            this.iconPath = new vscode.ThemeIcon('loading~spin');
            this.description = 'Fetching from calendar...';
            return;
        }

        if (!meeting) {
            this.iconPath = new vscode.ThemeIcon('check');
            this.description = 'Enjoy your focus time!';
            return;
        }

        const startTime = this.formatTime(meeting.startTime);
        const endTime = this.formatTime(meeting.endTime);

        if (type === 'now') {
            this.iconPath = new vscode.ThemeIcon('call-outgoing', new vscode.ThemeColor('charts.red'));
            this.description = `Now - ${endTime}`;
            this.tooltip = new vscode.MarkdownString(
                `**${meeting.title}**\n\n` +
                `In Progress\n\n` +
                `Ends at: ${endTime}\n` +
                `Duration: ${meeting.duration} minutes`
            );
        } else {
            const minutesUntil = Math.round(
                (meeting.startTime.getTime() - Date.now()) / (1000 * 60)
            );

            if (type === 'soon') {
                this.iconPath = meeting.joinUrl 
                    ? new vscode.ThemeIcon('link-external', new vscode.ThemeColor('charts.blue'))
                    : new vscode.ThemeIcon('clock', new vscode.ThemeColor('charts.orange'));
                this.description = `in ${minutesUntil}m`;
            } else {
                this.iconPath = meeting.joinUrl
                    ? new vscode.ThemeIcon('link-external', new vscode.ThemeColor('charts.blue'))
                    : new vscode.ThemeIcon('clock');
                this.description = `${startTime}`;
            }

            this.tooltip = new vscode.MarkdownString(
                `**${meeting.title}**\n\n` +
                `Starts: ${startTime}\n` +
                `Ends: ${endTime}\n` +
                `Duration: ${meeting.duration} minutes\n\n` +
                `Time until: ${this.formatDuration(minutesUntil)}`
            );
        }

        if (meeting.joinUrl) {
            this.tooltip = new vscode.MarkdownString(
                (this.tooltip as vscode.MarkdownString).value + '\n\n**Click to join meeting**'
            );
            
            this.command = {
                command: 'aware.joinMeeting',
                title: 'Join Meeting',
                arguments: [meeting]
            };
        }

        this.contextValue = meeting.joinUrl ? 'meetingWithLink' : 'meeting';
    }

    private formatTime(date: Date): string {
        return date.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
    }

    private formatDuration(minutes: number): string {
        if (minutes < 60) {
            return `${minutes} minutes`;
        }
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return mins > 0 ? `${hours}h ${mins}m` : `${hours} hour${hours > 1 ? 's' : ''}`;
    }
}

// Related Documents Tree View
type DocumentTreeElement = DocumentTreeItem | NoRepoItem;

export class DocumentsTreeDataProvider implements vscode.TreeDataProvider<DocumentTreeElement> {
    private _onDidChangeTreeData = new vscode.EventEmitter<DocumentTreeElement | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private isLoading = false;

    constructor(private documentService: DocumentService) {
        this.documentService.onDocumentsUpdated(() => {
            this.isLoading = false;
            this._onDidChangeTreeData.fire();
        });

        this.documentService.onLoadingStarted(() => {
            this.isLoading = true;
            this._onDidChangeTreeData.fire();
        });
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: DocumentTreeElement): vscode.TreeItem {
        return element;
    }

    getChildren(): Thenable<DocumentTreeElement[]> {
        if (this.isLoading) {
            return Promise.resolve([new DocumentTreeItem(null, 'loading')]);
        }

        const repoName = this.documentService.getCurrentRepoNameCached();
        if (!repoName) {
            return Promise.resolve([new NoRepoItem()]);
        }

        const documents = this.documentService.getCachedDocuments();
        if (documents.length === 0) {
            return Promise.resolve([new DocumentTreeItem(null, 'empty')]);
        }

        return Promise.resolve(
            documents.map(doc => new DocumentTreeItem(doc, 'document'))
        );
    }
}

export class NoRepoItem extends vscode.TreeItem {
    constructor() {
        super('No repository detected', vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon('folder');
        this.description = 'Open a workspace folder';
    }
}

export class DocumentTreeItem extends vscode.TreeItem {
    constructor(
        public readonly document: RelatedDocument | null,
        public readonly type: 'document' | 'empty' | 'loading'
    ) {
        super(
            document ? document.title : (type === 'loading' ? 'Loading documents...' : 'No related documents'),
            vscode.TreeItemCollapsibleState.None
        );

        if (type === 'loading') {
            this.iconPath = new vscode.ThemeIcon('loading~spin');
            this.description = 'Searching...';
            return;
        }

        if (!document) {
            this.iconPath = new vscode.ThemeIcon('file');
            this.description = 'No documents found for this repo';
            return;
        }

        // Set icon based on document type
        this.iconPath = this.getIconForType(document.type);
        
        // Show last modified date if available
        if (document.lastModified) {
            this.description = this.formatDate(document.lastModified);
        } else {
            this.description = document.type;
        }

        // Make clicking open the document
        this.command = {
            command: 'vscode.open',
            title: 'Open Document',
            arguments: [vscode.Uri.parse(document.url)]
        };

        this.tooltip = new vscode.MarkdownString(
            `**${document.title}**\n\n` +
            `Type: ${document.type}\n` +
            (document.lastModified ? `Last Modified: ${document.lastModified.toLocaleDateString()}\n` : '') +
            `\n[Click to open](${document.url})`
        );
        this.tooltip.isTrusted = true;

        this.contextValue = 'relatedDocument';
    }

    private getIconForType(type: string): vscode.ThemeIcon {
        const typeLower = type.toLowerCase();
        if (typeLower.includes('word') || typeLower.includes('doc')) {
            return new vscode.ThemeIcon('file-text', new vscode.ThemeColor('charts.blue'));
        }
        if (typeLower.includes('excel') || typeLower.includes('xls')) {
            return new vscode.ThemeIcon('table', new vscode.ThemeColor('charts.green'));
        }
        if (typeLower.includes('powerpoint') || typeLower.includes('ppt')) {
            return new vscode.ThemeIcon('preview', new vscode.ThemeColor('charts.orange'));
        }
        if (typeLower.includes('pdf')) {
            return new vscode.ThemeIcon('file-pdf', new vscode.ThemeColor('charts.red'));
        }
        if (typeLower.includes('onenote')) {
            return new vscode.ThemeIcon('notebook', new vscode.ThemeColor('charts.purple'));
        }
        if (typeLower.includes('web') || typeLower.includes('page')) {
            return new vscode.ThemeIcon('globe');
        }
        return new vscode.ThemeIcon('file');
    }

    private formatDate(date: Date): string {
        const now = new Date();
        const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
        
        if (diffDays === 0) {return 'Today';}
        if (diffDays === 1) {return 'Yesterday';}
        if (diffDays < 7) {return `${diffDays} days ago`;}
        if (diffDays < 30) {return `${Math.floor(diffDays / 7)} weeks ago`;}
        return date.toLocaleDateString();
    }
}
