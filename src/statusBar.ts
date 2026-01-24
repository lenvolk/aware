/**
 * Status bar manager for Aware extension
 */

import * as vscode from 'vscode';
import { Meeting } from './types';
import { getConfig } from './config';
import { MeetingService } from './meetingService';

export class StatusBarManager {
    private statusBarItem: vscode.StatusBarItem;
    private meetingService: MeetingService;
    private updateInterval: NodeJS.Timeout | null = null;

    constructor(meetingService: MeetingService) {
        this.meetingService = meetingService;
        
        this.statusBarItem = vscode.window.createStatusBarItem(
            'aware.status',
            vscode.StatusBarAlignment.Right,
            100
        );
        
        this.statusBarItem.command = 'aware.showMeetings';
        this.statusBarItem.name = 'Aware';
        
        // Subscribe to events
        this.meetingService.onMeetingsUpdated(() => this.update());
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
        const nextMeeting = this.meetingService.getNextMeeting();
        const currentMeeting = this.meetingService.getCurrentMeeting();
        
        if (currentMeeting) {
            this.showInMeeting(currentMeeting);
        } else if (nextMeeting) {
            this.showNextMeeting(nextMeeting);
        } else {
            this.showDefault();
        }
    }

    private showInMeeting(meeting: Meeting): void {
        const endTime = this.formatTime(meeting.endTime);
        
        this.statusBarItem.text = `$(pulse) Meeting Now`;
        this.statusBarItem.tooltip = new vscode.MarkdownString(
            `**Currently in: ${meeting.title}**\n\n` +
            `Ends at: ${endTime}\n\n` +
            `Click to view all meetings`
        );
        this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        this.statusBarItem.command = 'aware.showMeetings';
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
        
        this.statusBarItem.command = 'aware.showMeetings';
    }

    private showDefault(): void {
        this.statusBarItem.text = '$(calendar) No meetings';
        this.statusBarItem.tooltip = new vscode.MarkdownString(
            `**No upcoming meetings**\n\n` +
            `Click to view meetings`
        );
        this.statusBarItem.backgroundColor = undefined;
        this.statusBarItem.command = 'aware.showMeetings';
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
