/**
 * Status bar manager for Focus Time extension
 */

import * as vscode from 'vscode';
import { Meeting, FocusSession } from './types';
import { getConfig } from './config';
import { MeetingService } from './meetingService';
import { FocusSessionManager } from './focusSessionManager';

export class StatusBarManager {
    private statusBarItem: vscode.StatusBarItem;
    private meetingService: MeetingService;
    private focusSessionManager: FocusSessionManager;
    private updateInterval: NodeJS.Timeout | null = null;

    constructor(meetingService: MeetingService, focusSessionManager: FocusSessionManager) {
        this.meetingService = meetingService;
        this.focusSessionManager = focusSessionManager;
        
        this.statusBarItem = vscode.window.createStatusBarItem(
            'focusTime.status',
            vscode.StatusBarAlignment.Right,
            100
        );
        
        this.statusBarItem.command = 'focusTime.showMeetings';
        this.statusBarItem.name = 'Focus Time';
        
        // Subscribe to events
        this.meetingService.onMeetingsUpdated(() => this.update());
        this.focusSessionManager.onSessionStarted(() => this.update());
        this.focusSessionManager.onSessionEnded(() => this.update());
        this.focusSessionManager.onSessionUpdated(() => this.update());
    }

    start(): void {
        const config = getConfig();
        
        if (!config.showStatusBar) {
            this.statusBarItem.hide();
            return;
        }
        
        this.update();
        this.statusBarItem.show();
        
        // Update every minute
        this.updateInterval = setInterval(() => {
            this.update();
        }, 60 * 1000);
    }

    stop(): void {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
        this.statusBarItem.hide();
    }

    update(): void {
        const session = this.focusSessionManager.getCurrentSession();
        const nextMeeting = this.meetingService.getNextMeeting();
        const currentMeeting = this.meetingService.getCurrentMeeting();
        
        if (session?.isActive) {
            this.showFocusMode(session);
        } else if (currentMeeting) {
            this.showInMeeting(currentMeeting);
        } else if (nextMeeting) {
            this.showNextMeeting(nextMeeting);
        } else {
            this.showDefault();
        }
    }

    private showFocusMode(session: FocusSession): void {
        const remaining = session.remainingMinutes;
        
        this.statusBarItem.text = `$(eye-closed) Focus: ${remaining}m`;
        this.statusBarItem.tooltip = new vscode.MarkdownString(
            `**Focus Mode Active**\n\n` +
            `Time remaining: ${remaining} minutes\n\n` +
            `Click to view meetings or manage focus session`
        );
        this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        this.statusBarItem.command = 'focusTime.stopFocusSession';
    }

    private showInMeeting(meeting: Meeting): void {
        const endTime = this.formatTime(meeting.endTime);
        
        this.statusBarItem.text = `$(call-outgoing) In meeting until ${endTime}`;
        this.statusBarItem.tooltip = new vscode.MarkdownString(
            `**Currently in: ${meeting.title}**\n\n` +
            `Ends at: ${endTime}\n\n` +
            `Click to view all meetings`
        );
        this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        this.statusBarItem.command = 'focusTime.showMeetings';
    }

    private showNextMeeting(meeting: Meeting): void {
        const minutesUntil = this.meetingService.getMinutesUntilNextMeeting();
        const startTime = this.formatTime(meeting.startTime);
        
        let timeText: string;
        if (minutesUntil !== null && minutesUntil < 60) {
            timeText = `in ${minutesUntil}m`;
        } else if (minutesUntil !== null && minutesUntil < 120) {
            timeText = `in 1h ${minutesUntil - 60}m`;
        } else {
            timeText = `at ${startTime}`;
        }
        
        this.statusBarItem.text = `$(clock) Next: ${timeText}`;
        this.statusBarItem.tooltip = new vscode.MarkdownString(
            `**Next Meeting: ${meeting.title}**\n\n` +
            `Starts: ${startTime}\n` +
            `Duration: ${meeting.duration} minutes\n\n` +
            `Click to view all meetings`
        );
        
        // Change color if meeting is within 10 minutes
        if (minutesUntil !== null && minutesUntil <= 10) {
            this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        } else {
            this.statusBarItem.backgroundColor = undefined;
        }
        
        this.statusBarItem.command = 'focusTime.showMeetings';
    }

    private showDefault(): void {
        this.statusBarItem.text = '$(clock) Focus Time';
        this.statusBarItem.tooltip = new vscode.MarkdownString(
            `**No upcoming meetings**\n\n` +
            `Click to start a focus session or view meetings`
        );
        this.statusBarItem.backgroundColor = undefined;
        this.statusBarItem.command = 'focusTime.startFocusSession';
    }

    private formatTime(date: Date): string {
        return date.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
    }

    dispose(): void {
        this.stop();
        this.statusBarItem.dispose();
    }
}
