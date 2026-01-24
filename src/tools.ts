/**
 * Language model tools for Focus Time extension
 * These tools can be used by Copilot to help users manage their focus time
 */

import * as vscode from 'vscode';
import { MeetingService } from './meetingService';
import { FocusSessionManager } from './focusSessionManager';
import { GetMeetingsInput, StartFocusInput, TimeRange } from './types';

export function registerTools(
    context: vscode.ExtensionContext,
    meetingService: MeetingService,
    focusSessionManager: FocusSessionManager
): void {
    // Register getMeetings tool
    context.subscriptions.push(
        vscode.lm.registerTool(
            'focusTime_getMeetings',
            new GetMeetingsTool(meetingService)
        )
    );

    // Register getNextMeeting tool
    context.subscriptions.push(
        vscode.lm.registerTool(
            'focusTime_getNextMeeting',
            new GetNextMeetingTool(meetingService)
        )
    );

    // Register startFocus tool
    context.subscriptions.push(
        vscode.lm.registerTool(
            'focusTime_startFocus',
            new StartFocusTool(focusSessionManager)
        )
    );

    // Register stopFocus tool
    context.subscriptions.push(
        vscode.lm.registerTool(
            'focusTime_stopFocus',
            new StopFocusTool(focusSessionManager)
        )
    );

    // Register getFocusStatus tool
    context.subscriptions.push(
        vscode.lm.registerTool(
            'focusTime_getFocusStatus',
            new GetFocusStatusTool(focusSessionManager)
        )
    );
}

class GetMeetingsTool implements vscode.LanguageModelTool<GetMeetingsInput> {
    constructor(private meetingService: MeetingService) {}

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<GetMeetingsInput>,
        token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const timeRange: TimeRange = options.input.timeRange || 'today';
        
        await this.meetingService.fetchMeetings(timeRange);
        const meetings = this.meetingService.getCachedMeetings();

        const meetingsList = meetings.map(m => ({
            title: m.title,
            startTime: m.startTime.toISOString(),
            endTime: m.endTime.toISOString(),
            duration: m.duration,
            status: m.status,
            isOnline: m.isOnline,
            hasJoinUrl: !!m.joinUrl
        }));

        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(JSON.stringify({
                timeRange,
                count: meetings.length,
                meetings: meetingsList
            }, null, 2))
        ]);
    }

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<GetMeetingsInput>,
        token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        return {
            invocationMessage: `Fetching meetings for ${options.input.timeRange || 'today'}...`
        };
    }
}

class GetNextMeetingTool implements vscode.LanguageModelTool<Record<string, never>> {
    constructor(private meetingService: MeetingService) {}

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<Record<string, never>>,
        token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const nextMeeting = this.meetingService.getNextMeeting();
        const minutesUntil = this.meetingService.getMinutesUntilNextMeeting();

        if (!nextMeeting) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(JSON.stringify({
                    hasNextMeeting: false,
                    message: 'No upcoming meetings'
                }))
            ]);
        }

        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(JSON.stringify({
                hasNextMeeting: true,
                meeting: {
                    title: nextMeeting.title,
                    startTime: nextMeeting.startTime.toISOString(),
                    endTime: nextMeeting.endTime.toISOString(),
                    duration: nextMeeting.duration,
                    isOnline: nextMeeting.isOnline,
                    hasJoinUrl: !!nextMeeting.joinUrl
                },
                minutesUntil
            }, null, 2))
        ]);
    }

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<Record<string, never>>,
        token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        return {
            invocationMessage: 'Finding your next meeting...'
        };
    }
}

class StartFocusTool implements vscode.LanguageModelTool<StartFocusInput> {
    constructor(private focusSessionManager: FocusSessionManager) {}

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<StartFocusInput>,
        token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const duration = options.input.duration;
        
        const session = await this.focusSessionManager.startSession(duration);

        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(JSON.stringify({
                success: true,
                session: {
                    id: session.id,
                    duration: session.duration,
                    remainingMinutes: session.remainingMinutes,
                    startTime: session.startTime.toISOString()
                },
                message: `Focus session started for ${session.duration} minutes`
            }, null, 2))
        ]);
    }

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<StartFocusInput>,
        token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const duration = options.input.duration;
        return {
            invocationMessage: duration 
                ? `Starting a ${duration} minute focus session...`
                : 'Starting a focus session...',
            confirmationMessages: {
                title: 'Start Focus Session',
                message: `This will start a focus session${duration ? ` for ${duration} minutes` : ''} and may enable Do Not Disturb.`
            }
        };
    }
}

class StopFocusTool implements vscode.LanguageModelTool<Record<string, never>> {
    constructor(private focusSessionManager: FocusSessionManager) {}

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<Record<string, never>>,
        token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const session = this.focusSessionManager.getCurrentSession();
        
        if (!session?.isActive) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(JSON.stringify({
                    success: false,
                    message: 'No active focus session to stop'
                }))
            ]);
        }

        await this.focusSessionManager.stopSession();

        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(JSON.stringify({
                success: true,
                message: 'Focus session stopped'
            }))
        ]);
    }

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<Record<string, never>>,
        token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        return {
            invocationMessage: 'Stopping focus session...'
        };
    }
}

class GetFocusStatusTool implements vscode.LanguageModelTool<Record<string, never>> {
    constructor(private focusSessionManager: FocusSessionManager) {}

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<Record<string, never>>,
        token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const status = this.focusSessionManager.getFocusStatus();

        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(JSON.stringify({
                isActive: status.isActive,
                remainingMinutes: status.remainingMinutes,
                endTime: status.endTime?.toISOString(),
                nextMeeting: status.nextMeeting ? {
                    title: status.nextMeeting.title,
                    startTime: status.nextMeeting.startTime.toISOString()
                } : null,
                minutesUntilNextMeeting: status.minutesUntilNextMeeting
            }, null, 2))
        ]);
    }

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<Record<string, never>>,
        token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        return {
            invocationMessage: 'Checking focus status...'
        };
    }
}
