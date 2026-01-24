/**
 * Aware Extension
 * 
 * An AI-powered awareness manager that integrates with Microsoft 365
 * via the Work IQ MCP server. It tracks your meetings and sends reminders.
 */

import * as vscode from 'vscode';
import { MeetingService } from './meetingService';
import { NotificationManager } from './notificationManager';
import { StatusBarManager } from './statusBar';
import { 
    MeetingsTreeDataProvider, 
    DocumentsTreeDataProvider
} from './treeViews';
import { DocumentService } from './documentService';
import { AwareChatParticipant } from './chatParticipant';
import { ModelSelector } from './modelSelector';
import { registerTools } from './tools';
import { getConfig, onConfigChange } from './config';
import { Meeting } from './types';

let outputChannel: vscode.OutputChannel;
let meetingService: MeetingService;
let documentService: DocumentService;
let notificationManager: NotificationManager;
let statusBarManager: StatusBarManager;
let modelSelector: ModelSelector;
let meetingsTreeView: vscode.TreeView<unknown>;
let refreshInterval: NodeJS.Timeout | null = null;

export function activate(context: vscode.ExtensionContext) {
    // Create output channel for logging
    outputChannel = vscode.window.createOutputChannel('Aware');
    context.subscriptions.push(outputChannel);
    log('Aware extension activating...');

    // Initialize services
    meetingService = new MeetingService(outputChannel);
    documentService = new DocumentService(outputChannel);
    notificationManager = new NotificationManager(outputChannel, meetingService);
    statusBarManager = new StatusBarManager(meetingService);
    modelSelector = new ModelSelector(outputChannel);

    // Register tree views
    const meetingsTreeProvider = new MeetingsTreeDataProvider(meetingService);
    const documentsTreeProvider = new DocumentsTreeDataProvider(documentService);

    // Use createTreeView for meetings so we can update description
    meetingsTreeView = vscode.window.createTreeView('aware.meetings', {
        treeDataProvider: meetingsTreeProvider
    });
    context.subscriptions.push(meetingsTreeView);

    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('aware.relatedDocuments', documentsTreeProvider)
    );

    // Update tree view description with current model
    updateModelDescription();

    // Register chat participant
    new AwareChatParticipant(context, meetingService, modelSelector);

    // Register language model tools
    registerTools(context, meetingService);

    // Check if Work IQ MCP server is available and offer to install if not
    checkAndOfferWorkIQInstall();

    // Register commands
    registerCommands(
        context, 
        meetingsTreeProvider, 
        documentsTreeProvider,
        modelSelector
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
        notificationManager,
        statusBarManager,
        new vscode.Disposable(() => {
            if (refreshInterval) {
                clearInterval(refreshInterval);
            }
        })
    );

    log('Aware extension activated successfully');
    vscode.window.showInformationMessage('Aware is active! Use @aware in chat or check the sidebar.');
}

function registerCommands(
    context: vscode.ExtensionContext,
    meetingsTreeProvider: MeetingsTreeDataProvider,
    documentsTreeProvider: DocumentsTreeDataProvider,
    modelSelector: ModelSelector
): void {
    // Show meetings command
    context.subscriptions.push(
        vscode.commands.registerCommand('aware.showMeetings', async () => {
            const meetings = meetingService.getCachedMeetings();
            
            if (meetings.length === 0) {
                vscode.window.showInformationMessage('No upcoming meetings.');
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
                title: 'Aware - Meetings'
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
        vscode.commands.registerCommand('aware.refreshMeetings', async () => {
            await refreshMeetings();
            meetingsTreeProvider.refresh();
            vscode.window.showInformationMessage('Meetings refreshed!');
        })
    );

    // Refresh documents command
    context.subscriptions.push(
        vscode.commands.registerCommand('aware.refreshDocuments', async () => {
            await refreshDocuments();
            documentsTreeProvider.refresh();
            vscode.window.showInformationMessage('Related documents refreshed!');
        })
    );

    // Join meeting command
    context.subscriptions.push(
        vscode.commands.registerCommand('aware.joinMeeting', async (arg?: Meeting | { meeting?: Meeting }) => {
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
        vscode.commands.registerCommand('aware.openSettings', () => {
            vscode.commands.executeCommand('workbench.action.openSettings', 'aware');
        })
    );

    // Select model command - also update description after selection
    context.subscriptions.push(
        vscode.commands.registerCommand('aware.selectModel', async () => {
            await modelSelector.showModelPicker();
            updateModelDescription();
        })
    );

    // Configure Work IQ command
    context.subscriptions.push(
        vscode.commands.registerCommand('aware.configureWorkIQ', () => {
            addWorkIQToSettings();
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
    // Skip if no workspace folder is open
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
        log('No workspace folder open, skipping document refresh');
        return;
    }
    
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

/**
 * Updates the meetings tree view description with the current model name
 */
async function updateModelDescription(): Promise<void> {
    try {
        const model = await modelSelector.getConfiguredModel();
        const modelName = model?.name || model?.family || 'No model';
        meetingsTreeView.description = `Using ${modelName}`;
    } catch (error) {
        log(`Failed to update model description: ${error}`);
    }
}

/**
 * Checks if Work IQ MCP server is available and offers to install it if not.
 * Adds the server configuration to user settings when user accepts.
 */
async function checkAndOfferWorkIQInstall(): Promise<void> {
    // Check if Work IQ tool is already available
    const workIQAvailable = vscode.lm.tools.some(tool => {
        const name = tool.name.toLowerCase();
        return name.includes('workiq') || name.includes('work_iq');
    });
    
    if (workIQAvailable) {
        log('Work IQ MCP server is available');
        return;
    }
    
    log('Work IQ MCP server not found, checking user settings...');
    
    // Check if already configured in user settings
    const config = vscode.workspace.getConfiguration('mcp');
    const servers = config.get<Record<string, unknown>>('servers', {});
    
    if (servers['workiq']) {
        log('Work IQ already configured in user settings (may need to be started)');
        return;
    }
    
    // Prompt user to install
    const choice = await vscode.window.showInformationMessage(
        'Aware requires the Work IQ MCP server to access your Microsoft 365 calendar. Would you like to add it to your settings?',
        'Yes, add Work IQ',
        'No thanks'
    );
    
    if (choice === 'Yes, add Work IQ') {
        await addWorkIQToSettings();
    }
}

/**
 * Adds the Work IQ MCP server configuration to user settings.
 */
async function addWorkIQToSettings(): Promise<void> {
    try {
        const config = vscode.workspace.getConfiguration('mcp');
        const servers = config.get<Record<string, unknown>>('servers', {});
        
        // Add Work IQ server configuration
        const updatedServers = {
            ...servers,
            'workiq': {
                'command': 'npx',
                'args': ['-y', '@microsoft/workiq', 'mcp'],
                'env': {
                    'npm_config_registry': 'https://registry.npmjs.org'
                }
            }
        };
        
        await config.update('servers', updatedServers, vscode.ConfigurationTarget.Global);
        
        log('Work IQ MCP server added to user settings');
        
        vscode.window.showInformationMessage(
            'Work IQ MCP server added! You may need to reload VS Code and start the server.',
            'Reload Window'
        ).then(selection => {
            if (selection === 'Reload Window') {
                vscode.commands.executeCommand('workbench.action.reloadWindow');
            }
        });
    } catch (error) {
        log(`Failed to add Work IQ to settings: ${error}`);
        vscode.window.showErrorMessage(`Failed to configure Work IQ: ${error}`);
    }
}

function log(message: string): void {
    const timestamp = new Date().toISOString();
    outputChannel.appendLine(`[${timestamp}] ${message}`);
}

export function deactivate() {
    log('Aware extension deactivating...');
}
