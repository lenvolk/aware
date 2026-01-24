/**
 * Focus Time Extension
 * 
 * An AI-powered focus time manager that integrates with Microsoft 365
 * via the Work IQ MCP server. It tracks your meetings, sends reminders,
 * and automatically enables Do Not Disturb mode after meetings end.
 */

import * as vscode from 'vscode';
import { MeetingService } from './meetingService';
import { FocusSessionManager } from './focusSessionManager';
import { NotificationManager } from './notificationManager';
import { StatusBarManager } from './statusBar';
import { 
    MeetingsTreeDataProvider, 
    DocumentsTreeDataProvider
} from './treeViews';
import { DocumentService } from './documentService';
import { FocusTimeChatParticipant } from './chatParticipant';
import { registerTools } from './tools';
import { getConfig, onConfigChange } from './config';
import { Meeting } from './types';

let outputChannel: vscode.OutputChannel;
let meetingService: MeetingService;
let documentService: DocumentService;
let focusSessionManager: FocusSessionManager;
let notificationManager: NotificationManager;
let statusBarManager: StatusBarManager;
let refreshInterval: NodeJS.Timeout | null = null;

export function activate(context: vscode.ExtensionContext) {
    // Create output channel for logging
    outputChannel = vscode.window.createOutputChannel('Focus Time');
    context.subscriptions.push(outputChannel);
    log('Focus Time extension activating...');

    // Initialize services
    meetingService = new MeetingService(outputChannel);
    documentService = new DocumentService(outputChannel);
    focusSessionManager = new FocusSessionManager(outputChannel, meetingService);
    notificationManager = new NotificationManager(outputChannel, meetingService, focusSessionManager);
    statusBarManager = new StatusBarManager(meetingService, focusSessionManager);

    // Register tree views
    const meetingsTreeProvider = new MeetingsTreeDataProvider(meetingService, focusSessionManager);
    const documentsTreeProvider = new DocumentsTreeDataProvider(documentService);

    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('focusTime.meetings', meetingsTreeProvider),
        vscode.window.registerTreeDataProvider('focusTime.relatedDocuments', documentsTreeProvider)
    );

    // Register chat participant
    new FocusTimeChatParticipant(context, meetingService, focusSessionManager);

    // Register language model tools
    registerTools(context, meetingService, focusSessionManager);

    // Register commands
    registerCommands(
        context, 
        meetingsTreeProvider, 
        documentsTreeProvider
    );

    // Start services
    statusBarManager.start();
    notificationManager.start();

    // Initial fetch of all data
    refreshMeetings();
    refreshDocuments();

    // Set up periodic refresh
    setupRefreshInterval();

    // Listen for configuration changes
    context.subscriptions.push(
        onConfigChange(() => {
            log('Configuration changed, updating services...');
            statusBarManager.stop();
            statusBarManager.start();
            setupRefreshInterval();
        })
    );

    // Add disposables
    context.subscriptions.push(
        meetingService,
        documentService,
        focusSessionManager,
        notificationManager,
        statusBarManager,
        new vscode.Disposable(() => {
            if (refreshInterval) {
                clearInterval(refreshInterval);
            }
        })
    );

    log('Focus Time extension activated successfully');
    vscode.window.showInformationMessage(
        'Focus Time is active! Use @focus in chat or click the status bar to get started.'
    );
}

function registerCommands(
    context: vscode.ExtensionContext,
    meetingsTreeProvider: MeetingsTreeDataProvider,
    documentsTreeProvider: DocumentsTreeDataProvider
): void {
    // Show meetings command
    context.subscriptions.push(
        vscode.commands.registerCommand('focusTime.showMeetings', async () => {
            const meetings = meetingService.getCachedMeetings();
            
            if (meetings.length === 0) {
                vscode.window.showInformationMessage('No upcoming meetings. Enjoy your focus time!');
                return;
            }

            const items: vscode.QuickPickItem[] = meetings.map(m => ({
                label: m.title,
                description: `${formatTime(m.startTime)} - ${formatTime(m.endTime)}`,
                detail: m.status === 'inProgress' ? '🔴 In Progress' : 
                        m.status === 'upcoming' ? `⏰ In ${getMinutesUntil(m.startTime)} min` : '✅ Ended'
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Your upcoming meetings',
                title: 'Focus Time - Meetings'
            });

            if (selected) {
                const meeting = meetings.find(m => m.title === selected.label);
                if (meeting?.joinUrl) {
                    const action = await vscode.window.showInformationMessage(
                        `${meeting.title}`,
                        'Join Meeting',
                        'Dismiss'
                    );
                    if (action === 'Join Meeting') {
                        vscode.env.openExternal(vscode.Uri.parse(meeting.joinUrl));
                    }
                }
            }
        })
    );

    // Refresh meetings command
    context.subscriptions.push(
        vscode.commands.registerCommand('focusTime.refreshMeetings', async () => {
            await refreshMeetings();
            meetingsTreeProvider.refresh();
            vscode.window.showInformationMessage('Meetings refreshed!');
        })
    );

    // Refresh documents command
    context.subscriptions.push(
        vscode.commands.registerCommand('focusTime.refreshDocuments', async () => {
            await refreshDocuments();
            documentsTreeProvider.refresh();
            vscode.window.showInformationMessage('Related documents refreshed!');
        })
    );

    // Toggle Do Not Disturb command
    context.subscriptions.push(
        vscode.commands.registerCommand('focusTime.toggleDoNotDisturb', async () => {
            const session = focusSessionManager.getCurrentSession();
            if (session?.isActive) {
                await focusSessionManager.disableDoNotDisturb();
            } else {
                await focusSessionManager.enableDoNotDisturb();
            }
        })
    );

    // Start focus session command
    context.subscriptions.push(
        vscode.commands.registerCommand('focusTime.startFocusSession', async () => {
            const currentSession = focusSessionManager.getCurrentSession();
            if (currentSession?.isActive) {
                const action = await vscode.window.showWarningMessage(
                    `Focus session already active (${currentSession.remainingMinutes}m remaining)`,
                    'Extend 15m',
                    'Stop Session'
                );
                if (action === 'Extend 15m') {
                    await focusSessionManager.extendSession(15);
                } else if (action === 'Stop Session') {
                    await focusSessionManager.stopSession();
                }
                return;
            }

            const durations: vscode.QuickPickItem[] = [
                { label: '15 minutes', description: 'Quick focus session' },
                { label: '30 minutes', description: 'Short focus session' },
                { label: '45 minutes', description: 'Standard focus session' },
                { label: '60 minutes', description: 'Deep work session' },
                { label: 'Until next meeting', description: 'Automatically calculated' },
                { label: 'Custom...', description: 'Enter a custom duration' }
            ];

            const selected = await vscode.window.showQuickPick(durations, {
                placeHolder: 'Select focus session duration',
                title: 'Start Focus Session'
            });

            if (!selected) {
                return;
            }

            let duration: number | undefined;

            if (selected.label === 'Custom...') {
                const input = await vscode.window.showInputBox({
                    prompt: 'Enter focus duration in minutes',
                    placeHolder: '45',
                    validateInput: (value) => {
                        const num = parseInt(value, 10);
                        if (isNaN(num) || num < 1 || num > 480) {
                            return 'Please enter a number between 1 and 480';
                        }
                        return null;
                    }
                });
                if (input) {
                    duration = parseInt(input, 10);
                } else {
                    return;
                }
            } else if (selected.label !== 'Until next meeting') {
                duration = parseInt(selected.label, 10);
            }

            await focusSessionManager.startSession(duration);
        })
    );

    // Stop focus session command
    context.subscriptions.push(
        vscode.commands.registerCommand('focusTime.stopFocusSession', async () => {
            await focusSessionManager.stopSession();
        })
    );

    // Join meeting command
    context.subscriptions.push(
        vscode.commands.registerCommand('focusTime.joinMeeting', async (arg?: Meeting | { meeting?: Meeting }) => {
            // Handle both Meeting objects and MeetingTreeItem objects
            let meeting: Meeting | undefined;
            if (arg && 'meeting' in arg && arg.meeting) {
                meeting = arg.meeting;
            } else if (arg && 'joinUrl' in arg) {
                meeting = arg as Meeting;
            }
            
            if (!meeting) {
                const next = meetingService.getNextMeeting();
                if (next?.joinUrl) {
                    meeting = next;
                }
            }

            if (meeting?.joinUrl) {
                vscode.env.openExternal(vscode.Uri.parse(meeting.joinUrl));
            } else {
                vscode.window.showWarningMessage('No meeting link available');
            }
        })
    );

    // Open settings command
    context.subscriptions.push(
        vscode.commands.registerCommand('focusTime.openSettings', () => {
            vscode.commands.executeCommand('workbench.action.openSettings', 'focusTime');
        })
    );
}

async function refreshMeetings(): Promise<void> {
    log('Refreshing meetings...');
    try {
        await meetingService.fetchMeetings('today');
        log(`Loaded ${meetingService.getCachedMeetings().length} meetings`);
    } catch (error) {
        log(`Failed to refresh meetings: ${error}`);
    }
}

async function refreshDocuments(): Promise<void> {
    log('Refreshing related documents...');
    try {
        await documentService.fetchRelatedDocuments();
        log(`Loaded ${documentService.getCachedDocuments().length} documents`);
    } catch (error) {
        log(`Failed to refresh documents: ${error}`);
    }
}

function setupRefreshInterval(): void {
    if (refreshInterval) {
        clearInterval(refreshInterval);
    }

    const config = getConfig();
    const intervalMs = config.refreshIntervalMinutes * 60 * 1000;

    refreshInterval = setInterval(() => {
        refreshMeetings();
    }, intervalMs);

    log(`Meeting refresh interval set to ${config.refreshIntervalMinutes} minutes`);
}

function formatTime(date: Date): string {
    return date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });
}

function getMinutesUntil(date: Date): number {
    return Math.round((date.getTime() - Date.now()) / (1000 * 60));
}

function log(message: string): void {
    const timestamp = new Date().toISOString();
    outputChannel.appendLine(`[${timestamp}] ${message}`);
}

export function deactivate() {
    log('Focus Time extension deactivating...');
}
