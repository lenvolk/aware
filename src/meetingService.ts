/**
 * Meeting service that integrates with Work IQ via vscode.lm.invokeTool
 */

import * as vscode from 'vscode';
import { Meeting, TimeRange } from './types';

const WORKIQ_TOOL_NAME = 'mcp_workiq_ask_work_iq';

export class MeetingService {
    private meetings: Meeting[] = [];
    private tomorrowMeetings: Meeting[] = [];
    private weekMeetings: Meeting[] = [];
    private lastRefresh: Date | null = null;
    private lastError: string | null = null;
    private outputChannel: vscode.OutputChannel;
    
    private _onMeetingsUpdated = new vscode.EventEmitter<Meeting[]>();
    readonly onMeetingsUpdated = this._onMeetingsUpdated.event;
    
    private _onLoadingStarted = new vscode.EventEmitter<void>();
    readonly onLoadingStarted = this._onLoadingStarted.event;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }

    async fetchMeetings(timeRange: TimeRange = 'today'): Promise<Meeting[]> {
        this.log(`Fetching meetings for: ${timeRange}`);
        this._onLoadingStarted.fire();
        
        try {
            const response = await this.queryWorkIQ(timeRange);
            const parsedMeetings = this.parseMeetings(response);
            
            // Store based on time range
            if (timeRange === 'tomorrow') {
                this.tomorrowMeetings = parsedMeetings;
            } else if (timeRange === 'week') {
                this.weekMeetings = parsedMeetings;
            } else {
                this.meetings = parsedMeetings;
                this.lastRefresh = new Date();
                this.lastError = null; // Clear error on success
            }
            
            this._onMeetingsUpdated.fire(this.meetings);
            this.log(`Fetched ${parsedMeetings.length} meetings for ${timeRange}`);
            
            return parsedMeetings;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.log(`Failed to fetch meetings: ${errorMessage}`);
            
            // Set error state for today's meetings
            if (timeRange === 'today') {
                this.lastError = this.formatErrorMessage(errorMessage);
            }
            
            this._onMeetingsUpdated.fire(this.meetings);
            return this.meetings;
        }
    }

    private formatErrorMessage(error: string): string {
        if (error.includes('not available') || error.includes('not found')) {
            return 'Work IQ MCP server is not running. Start it from the MCP Servers panel.';
        }
        if (error.includes('timeout') || error.includes('ETIMEDOUT')) {
            return 'Connection timed out. Check your network or VPN connection.';
        }
        if (error.includes('network') || error.includes('ENOTFOUND') || error.includes('ECONNREFUSED')) {
            return 'Network error. Check your internet or VPN connection.';
        }
        if (error.includes('unauthorized') || error.includes('401') || error.includes('403')) {
            return 'Authentication failed. You may need to sign in again.';
        }
        return 'Failed to connect to Work IQ. Check your network connection.';
    }

    private async queryWorkIQ(timeRange: TimeRange): Promise<string> {
        // Check if Work IQ tool is available
        const tools = vscode.lm.tools;
        const workiqTool = tools.find(t => t.name === WORKIQ_TOOL_NAME);
        
        if (!workiqTool) {
            throw new Error('Work IQ MCP server not available. Please start the workiq server from MCP Servers panel.');
        }

        // Build date strings
        const now = new Date();
        const todayDate = now.toISOString().split('T')[0];
        
        const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        const tomorrowDate = tomorrow.toISOString().split('T')[0];
        
        const endOfWeek = new Date(now);
        endOfWeek.setDate(endOfWeek.getDate() + 7);
        const endOfWeekDate = endOfWeek.toISOString().split('T')[0];

        // Build the question based on time range
        let question: string;
        switch (timeRange) {
            case 'today':
                question = `What are ALL my meetings for today (${todayDate})? Return as JSON array with fields: title, startTime (ISO 8601 with timezone), endTime (ISO 8601 with timezone), onlineJoinUrl (Teams URL or null).`;
                break;
            case 'tomorrow':
                question = `What are ALL my meetings for tomorrow (${tomorrowDate})? Return as JSON array with fields: title, startTime (ISO 8601 with timezone), endTime (ISO 8601 with timezone), onlineJoinUrl (Teams URL or null).`;
                break;
            case 'week':
                question = `What are ALL my meetings from ${todayDate} to ${endOfWeekDate}? Return as JSON array with fields: title, startTime (ISO 8601 with timezone), endTime (ISO 8601 with timezone), onlineJoinUrl (Teams URL or null).`;
                break;
        }
        
        this.log(`Invoking Work IQ tool with question: ${question}`);
        
        // Invoke the tool directly
        const result = await vscode.lm.invokeTool(
            WORKIQ_TOOL_NAME,
            { 
                input: { question },
                toolInvocationToken: undefined
            },
            new vscode.CancellationTokenSource().token
        );
        
        // Extract text from result - LanguageModelToolResult has content array
        let fullResponse = '';
        if (result && result.content) {
            for (const part of result.content) {
                if (part instanceof vscode.LanguageModelTextPart) {
                    fullResponse += part.value;
                }
            }
        }
        
        this.log(`Response (${fullResponse.length} chars): ${fullResponse.substring(0, 500)}...`);
        return fullResponse;
    }

    private parseMeetings(response: string): Meeting[] {
        const meetings: Meeting[] = [];
        
        // Extract Teams URLs from footnotes
        const teamsUrls: string[] = [];
        const footnoteMatches = response.matchAll(/\[(\d+)\]\((https:\/\/teams\.microsoft\.com[^)]+)\)/g);
        for (const match of footnoteMatches) {
            teamsUrls[parseInt(match[1], 10) - 1] = match[2];
        }
        
        // Parse JSON from response
        try {
            const codeFenceMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
            const jsonContent = codeFenceMatch ? codeFenceMatch[1].trim() : response;
            const jsonMatch = jsonContent.match(/\[[\s\S]*?\]/);
            
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]) as Array<{
                    title: string;
                    startTime: string;
                    endTime: string;
                    onlineJoinUrl?: string | null;
                }>;
                
                for (let i = 0; i < parsed.length; i++) {
                    const item = parsed[i];
                    const startTime = new Date(item.startTime);
                    const endTime = new Date(item.endTime);
                    
                    if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) continue;
                    
                    const joinUrl = teamsUrls[i] || item.onlineJoinUrl || undefined;
                    
                    meetings.push({
                        id: `meeting-${i}-${Date.now()}`,
                        title: item.title,
                        startTime,
                        endTime,
                        duration: Math.round((endTime.getTime() - startTime.getTime()) / 60000),
                        isOnline: !!joinUrl,
                        joinUrl,
                        status: this.getMeetingStatus(startTime, endTime)
                    });
                }
            }
        } catch (e) {
            this.log(`Parse error: ${e}`);
        }
        
        return meetings.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
    }

    private getMeetingStatus(start: Date, end: Date): 'upcoming' | 'inProgress' | 'ended' {
        const now = new Date();
        if (now < start) return 'upcoming';
        if (now <= end) return 'inProgress';
        return 'ended';
    }

    getCachedMeetings(): Meeting[] {
        this.updateMeetingStatuses();
        return this.meetings;
    }

    getCachedTomorrowMeetings(): Meeting[] {
        return this.tomorrowMeetings;
    }

    getCachedWeekMeetings(): Meeting[] {
        return this.weekMeetings;
    }

    getNextMeeting(): Meeting | null {
        this.updateMeetingStatuses();
        return this.meetings.find(m => m.status === 'upcoming') || null;
    }

    getCurrentMeeting(): Meeting | null {
        this.updateMeetingStatuses();
        return this.meetings.find(m => m.status === 'inProgress') || null;
    }

    getMinutesUntilNextMeeting(): number | null {
        const next = this.getNextMeeting();
        return next ? Math.round((next.startTime.getTime() - Date.now()) / 60000) : null;
    }

    isWorkIQAvailable(): boolean {
        return vscode.lm.tools.some(t => t.name === WORKIQ_TOOL_NAME);
    }

    private updateMeetingStatuses(): void {
        for (const m of this.meetings) {
            m.status = this.getMeetingStatus(m.startTime, m.endTime);
        }
    }

    getLastRefresh(): Date | null {
        return this.lastRefresh;
    }

    getLastError(): string | null {
        return this.lastError;
    }

    private log(message: string): void {
        this.outputChannel.appendLine(`[${new Date().toISOString()}] [MeetingService] ${message}`);
    }

    dispose(): void {
        this._onMeetingsUpdated.dispose();
        this._onLoadingStarted.dispose();
    }
}
