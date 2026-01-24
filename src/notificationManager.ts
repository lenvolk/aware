/**
 * Notification manager for meeting reminders
 */

import * as vscode from 'vscode';
import { Meeting, MeetingNotification } from './types';
import { getConfig } from './config';
import { MeetingService } from './meetingService';

export class NotificationManager {
    private outputChannel: vscode.OutputChannel;
    private meetingService: MeetingService;
    private sentNotifications: Map<string, MeetingNotification> = new Map();
    private checkInterval: NodeJS.Timeout | null = null;

    constructor(
        outputChannel: vscode.OutputChannel,
        meetingService: MeetingService
    ) {
        this.outputChannel = outputChannel;
        this.meetingService = meetingService;
        
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

        const result = await vscode.window.showInformationMessage(
            `📅 "${meeting.title}" starts in ${minutesUntil} minute${minutesUntil > 1 ? 's' : ''}`,
            ...actions
        );

        if (result === 'Join Meeting' && meeting.joinUrl) {
            vscode.env.openExternal(vscode.Uri.parse(meeting.joinUrl));
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

    private log(message: string): void {
        const timestamp = new Date().toISOString();
        this.outputChannel.appendLine(`[${timestamp}] [NotificationManager] ${message}`);
    }

    dispose(): void {
        this.stop();
    }
}
