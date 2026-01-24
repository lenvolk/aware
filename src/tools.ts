/**
 * Language model tools for Focus Time extension
 * These tools can be used by Copilot to help users manage their meetings
 */

import * as vscode from 'vscode';
import { MeetingService } from './meetingService';
import { GetMeetingsInput, TimeRange } from './types';

export function registerTools(
    context: vscode.ExtensionContext,
    meetingService: MeetingService
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
