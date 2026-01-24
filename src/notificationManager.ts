/**
 * Notification manager for meeting reminders and focus time alerts
 */

import * as vscode from 'vscode';
import { Meeting, MeetingNotification } from './types';
import { getConfig } from './config';
import { MeetingService } from './meetingService';
import { FocusSessionManager } from './focusSessionManager';

export class NotificationManager {
    private outputChannel: vscode.OutputChannel;
    private meetingService: MeetingService;
    private focusSessionManager: FocusSessionManager;
    private sentNotifications: Map<string, MeetingNotification> = new Map();
    private checkInterval: NodeJS.Timeout | null = null;
    private lastMeetingInProgress: Meeting | null = null;

    constructor(
        outputChannel: vscode.OutputChannel,
        meetingService: MeetingService,
        focusSessionManager: FocusSessionManager
    ) {
        this.outputChannel = outputChannel;
        this.meetingService = meetingService;
        this.focusSessionManager = focusSessionManager;
        
        // Also check for notifications when meetings are updated
        this.meetingService.onMeetingsUpdated(() => {
            this.checkForNotifications();
        });
    }

    start(): void {
        this.log('Starting notification manager');
        
        // Check for upcoming meetings every minute
        this.checkInterval = setInterval(() => {
            this.checkForNotifications();
        }, 60 * 1000);

        // Do an immediate check
        this.checkForNotifications();
    }

    stop(): void {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
    }

    private async checkForNotifications(): Promise<void> {
        const config = getConfig();
        
        if (!config.enableNotifications) {
            this.log('Notifications disabled in settings');
            return;
        }

        const meetings = this.meetingService.getCachedMeetings();
        const now = new Date();
        
        this.log(`Checking ${meetings.length} meetings for notifications...`);

        for (const meeting of meetings) {
            // Check for meeting that just ended
            if (meeting.status === 'ended' && this.lastMeetingInProgress?.id === meeting.id) {
                this.lastMeetingInProgress = null;
                await this.handleMeetingEnded(meeting);
                continue;
            }

            // Track meeting in progress
            if (meeting.status === 'inProgress') {
                this.lastMeetingInProgress = meeting;
                continue;
            }

            if (meeting.status !== 'upcoming') {
                continue;
            }

            const minutesUntil = Math.round(
                (meeting.startTime.getTime() - now.getTime()) / (1000 * 60)
            );
            
            this.log(`  "${meeting.title}" in ${minutesUntil}m (reminder at ${config.meetingReminderMinutes}m)`);

            // Check for reminder notification
            if (minutesUntil <= config.meetingReminderMinutes && minutesUntil > 0) {
                const notificationKey = `reminder-${meeting.id}`;
                if (!this.sentNotifications.has(notificationKey)) {
                    await this.sendMeetingReminder(meeting, minutesUntil);
                    this.sentNotifications.set(notificationKey, {
                        meetingId: meeting.id,
                        type: 'reminder',
                        sentAt: new Date()
                    });
                }
            }

            // Check for starting notification (within 1 minute)
            if (minutesUntil <= 1 && minutesUntil >= 0) {
                const notificationKey = `starting-${meeting.id}`;
                if (!this.sentNotifications.has(notificationKey)) {
                    await this.sendMeetingStarting(meeting);
                    this.sentNotifications.set(notificationKey, {
                        meetingId: meeting.id,
                        type: 'starting',
                        sentAt: new Date()
                    });
                }
            }
        }

        // Clean up old notifications (older than 1 hour)
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
        for (const [key, notification] of this.sentNotifications) {
            if (notification.sentAt < oneHourAgo) {
                this.sentNotifications.delete(key);
            }
        }
    }

    private async sendMeetingReminder(meeting: Meeting, minutesUntil: number): Promise<void> {
        this.log(`Sending reminder for: ${meeting.title} (${minutesUntil} min)`);

        const actions: string[] = ['Dismiss'];
        
        if (meeting.joinUrl) {
            actions.unshift('Join Meeting');
        }

        // If there's an active focus session, offer to stop it
        if (this.focusSessionManager.getCurrentSession()?.isActive) {
            actions.push('End Focus Session');
        }

        const result = await vscode.window.showInformationMessage(
            `📅 "${meeting.title}" starts in ${minutesUntil} minute${minutesUntil > 1 ? 's' : ''}`,
            ...actions
        );

        if (result === 'Join Meeting' && meeting.joinUrl) {
            vscode.env.openExternal(vscode.Uri.parse(meeting.joinUrl));
        } else if (result === 'End Focus Session') {
            await this.focusSessionManager.stopSession();
        }
    }

    private async sendMeetingStarting(meeting: Meeting): Promise<void> {
        this.log(`Meeting starting now: ${meeting.title}`);

        const actions: string[] = ['Dismiss'];
        
        if (meeting.joinUrl) {
            actions.unshift('Join Now');
        }

        const result = await vscode.window.showWarningMessage(
            `🔔 "${meeting.title}" is starting now!`,
            ...actions
        );

        if (result === 'Join Now' && meeting.joinUrl) {
            vscode.env.openExternal(vscode.Uri.parse(meeting.joinUrl));
        }
    }

    private async handleMeetingEnded(meeting: Meeting): Promise<void> {
        this.log(`Meeting ended: ${meeting.title}`);

        const config = getConfig();
        
        if (config.autoEnableDoNotDisturb) {
            // Automatically start focus session after meeting
            await this.focusSessionManager.startFocusAfterMeeting(meeting);
        } else {
            // Ask user if they want to start focus time
            const result = await vscode.window.showInformationMessage(
                `Meeting "${meeting.title}" has ended. Would you like to start a focus session?`,
                'Start Focus Time',
                'No Thanks'
            );

            if (result === 'Start Focus Time') {
                await this.focusSessionManager.startSession();
            }
        }
    }

    private log(message: string): void {
        const timestamp = new Date().toISOString();
        this.outputChannel.appendLine(`[${timestamp}] [NotificationManager] ${message}`);
    }

    dispose(): void {
        this.stop();
    }
}
