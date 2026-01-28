/**
 * Meeting service that integrates with Work IQ MCP server
 * Handles fetching, parsing, and managing meeting data
 */

import * as vscode from 'vscode';
import { Meeting, TimeRange, WorkIQResponse, WorkIQConnectionState, WorkIQConnectionStatus } from './types';

export class MeetingService {
    private meetings: Meeting[] = [];
    private lastRefresh: Date | null = null;
    private outputChannel: vscode.OutputChannel;
    private _onMeetingsUpdated = new vscode.EventEmitter<Meeting[]>();
    readonly onMeetingsUpdated = this._onMeetingsUpdated.event;
    private _onLoadingStarted = new vscode.EventEmitter<void>();
    readonly onLoadingStarted = this._onLoadingStarted.event;
    private _onConnectionStateChanged = new vscode.EventEmitter<WorkIQConnectionStatus>();
    readonly onConnectionStateChanged = this._onConnectionStateChanged.event;
    private connectionStatus: WorkIQConnectionStatus = {
        state: 'not_configured',
        message: 'Checking Work IQ connection...'
    };

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }

    async fetchMeetings(timeRange: TimeRange = 'today'): Promise<Meeting[]> {
        this.log(`Fetching meetings for: ${timeRange}`);
        this._onLoadingStarted.fire();
        
        try {
            const query = this.buildMeetingQuery(timeRange);
            const response = await this.queryWorkIQ(query);
            
            if (response.error) {
                this.log(`Error from Work IQ: ${response.error}`);
                this._onMeetingsUpdated.fire(this.meetings); // Fire event to clear loading state
                return this.meetings;
            }
            
            if (response.meetings) {
                this.meetings = response.meetings;
                this.lastRefresh = new Date();
                this._onMeetingsUpdated.fire(this.meetings);
                this.log(`Fetched ${this.meetings.length} meetings`);
            } else if (response.rawResponse) {
                // Parse the raw response from Work IQ
                const parsed = this.parseWorkIQTextResponse(response.rawResponse);
                this.log(`Parsed ${parsed.length} meetings from text response`);
                for (const m of parsed) {
                    this.log(`  - "${m.title}" starts: ${m.startTime.toISOString()}, status: ${m.status}`);
                }
                // Always update meetings (even if empty) and fire event to clear loading state
                this.meetings = parsed;
                this.lastRefresh = new Date();
                this._onMeetingsUpdated.fire(this.meetings);
            } else {
                // No response data - still fire event to clear loading state
                this._onMeetingsUpdated.fire(this.meetings);
            }
            
            return this.meetings;
        } catch (error) {
            this.log(`Failed to fetch meetings: ${error}`);
            this._onMeetingsUpdated.fire(this.meetings); // Fire event to clear loading state on error
            throw error;
        }
    }

    private buildMeetingQuery(timeRange: TimeRange): string {
        // Request ALL meetings with optional Teams URLs (real URLs come in footnotes)
        const format = `Return as JSON array with fields: title, startTime (ISO 8601), endTime (ISO 8601), onlineJoinUrl (the complete Teams URL if it's an online meeting, or null if not). Include all meetings regardless of whether they have an online join link.`;
        
        switch (timeRange) {
            case 'today':
                return `What are ALL my meetings today? ${format}`;
            case 'tomorrow':
                return `What are ALL my meetings tomorrow? ${format}`;
            case 'week':
                return `What are ALL my meetings this week? ${format}`;
        }
    }

    async queryWorkIQ(question: string): Promise<WorkIQResponse> {
        this.log(`Querying Work IQ: ${question}`);
        
        try {
            // Log all available tools for debugging
            this.log(`Available LM tools (${vscode.lm.tools.length}): ${vscode.lm.tools.map(t => t.name).join(', ')}`);
            
            // Check if MCP is configured in settings
            const mcpConfig = vscode.workspace.getConfiguration('mcp');
            const servers = mcpConfig.get<Record<string, unknown>>('servers', {});
            const isConfigured = !!servers['workiq'];
            
            // Find the Work IQ MCP tool - check for various naming patterns
            const workIQTool = vscode.lm.tools.find(tool => {
                const name = tool.name.toLowerCase();
                return name.includes('workiq') || 
                       name.includes('work_iq') ||
                       name.includes('ask_work_iq') ||
                       name.includes('mcp_workiq');
            });
            
            if (!workIQTool) {
                this.log('Work IQ tool not found among available tools');
                
                if (!isConfigured) {
                    // Not configured at all
                    this.updateConnectionState({
                        state: 'not_configured',
                        message: 'Work IQ MCP server not configured',
                        actionLabel: 'Add Work IQ',
                        actionCommand: 'aware.configureWorkIQ'
                    });
                    return { 
                        error: 'Work IQ MCP server not configured. Click "Add Work IQ" to set it up.' 
                    };
                } else {
                    // Configured but not running
                    this.updateConnectionState({
                        state: 'not_started',
                        message: 'Work IQ server not running',
                        actionLabel: 'Start Server',
                        actionCommand: 'aware.startWorkIQ'
                    });
                    return { 
                        error: 'Work IQ MCP server not running. Open the MCP Servers panel and start the "workiq" server.' 
                    };
                }
            }
            
            this.log(`Found Work IQ tool: ${workIQTool.name}`);
            this.log(`Tool input schema: ${JSON.stringify(workIQTool.inputSchema)}`);
            
            // Directly invoke the Work IQ MCP tool
            const cancellationTokenSource = new vscode.CancellationTokenSource();
            const result = await vscode.lm.invokeTool(
                workIQTool.name,
                {
                    input: { question },
                    toolInvocationToken: undefined
                },
                cancellationTokenSource.token
            );
            
            // Extract text from the tool result
            let fullResponse = '';
            for (const part of result.content) {
                if (part instanceof vscode.LanguageModelTextPart) {
                    fullResponse += part.value;
                } else {
                    this.log(`Unknown part type: ${typeof part}`);
                }
            }
            
            this.log(`Work IQ response received (${fullResponse.length} chars):`);
            this.log(fullResponse.substring(0, 500) + (fullResponse.length > 500 ? '...' : ''));
            
            // Check for common error patterns in response
            const errorState = this.detectErrorInResponse(fullResponse);
            if (errorState) {
                this.updateConnectionState(errorState);
                return { error: errorState.message, rawResponse: fullResponse };
            }
            
            // Success!
            this.updateConnectionState({
                state: 'connected',
                message: 'Connected to Work IQ'
            });
            
            return { rawResponse: fullResponse };
        } catch (error) {
            this.log(`Work IQ query error: ${error}`);
            if (error instanceof Error) {
                this.log(`Error stack: ${error.stack}`);
            }
            
            // Classify the error
            const errorState = this.classifyError(error);
            this.updateConnectionState(errorState);
            
            return { error: errorState.message, rawResponse: '' };
        }
    }
    
    /**
     * Detect common error patterns in Work IQ responses
     */
    private detectErrorInResponse(response: string): WorkIQConnectionStatus | null {
        const responseLower = response.toLowerCase();
        
        // License issues
        if (responseLower.includes('license') || responseLower.includes('not licensed') || 
            responseLower.includes('copilot license')) {
            return {
                state: 'license_required',
                message: 'Microsoft 365 Copilot license required. Contact your IT administrator.',
                actionLabel: 'Learn More',
                actionCommand: 'aware.openSettings'
            };
        }
        
        // Admin consent issues
        if (responseLower.includes('admin consent') || responseLower.includes('administrator') ||
            responseLower.includes('organization') && responseLower.includes('consent')) {
            return {
                state: 'admin_consent',
                message: 'Organization admin consent required for Work IQ. See documentation for setup.',
                actionLabel: 'View Setup Guide',
                actionCommand: 'aware.openSettings'
            };
        }
        
        // Authentication issues
        if (responseLower.includes('sign in') || responseLower.includes('authenticate') ||
            responseLower.includes('not authenticated') || responseLower.includes('login')) {
            return {
                state: 'auth_required',
                message: 'Please sign in to Microsoft 365 to access your calendar.',
                actionLabel: 'Retry',
                actionCommand: 'aware.refreshMeetings'
            };
        }
        
        return null;
    }
    
    /**
     * Classify errors into actionable categories
     */
    private classifyError(error: unknown): WorkIQConnectionStatus {
        const errorStr = String(error).toLowerCase();
        
        if (errorStr.includes('license')) {
            return {
                state: 'license_required',
                message: 'Microsoft 365 Copilot license required',
                actionLabel: 'Learn More',
                actionCommand: 'aware.openSettings'
            };
        }
        
        if (errorStr.includes('consent') || errorStr.includes('permission')) {
            return {
                state: 'admin_consent',
                message: 'Admin consent required for Work IQ',
                actionLabel: 'View Setup Guide',
                actionCommand: 'aware.openSettings'
            };
        }
        
        if (errorStr.includes('auth') || errorStr.includes('sign in') || errorStr.includes('token')) {
            return {
                state: 'auth_required',
                message: 'Authentication required',
                actionLabel: 'Retry',
                actionCommand: 'aware.refreshMeetings'
            };
        }
        
        return {
            state: 'unknown_error',
            message: `Error: ${String(error).substring(0, 100)}`,
            actionLabel: 'Retry',
            actionCommand: 'aware.refreshMeetings'
        };
    }
    
    /**
     * Update connection state and notify listeners
     */
    private updateConnectionState(status: WorkIQConnectionStatus): void {
        this.connectionStatus = status;
        this._onConnectionStateChanged.fire(status);
        this.log(`Connection state: ${status.state} - ${status.message}`);
    }
    
    /**
     * Get current connection status
     */
    getConnectionStatus(): WorkIQConnectionStatus {
        return this.connectionStatus;
    }

    private parseWorkIQTextResponse(response: string): Meeting[] {
        const meetings: Meeting[] = [];
        
        this.log(`Parsing response (${response.length} chars)`);
        
        // Extract REAL Teams URLs from markdown footnotes at the end: [1](https://teams...)
        // These are the actual join URLs, not the placeholder URLs in the JSON
        const teamsUrls: string[] = [];
        const footnoteMatches = response.matchAll(/\[(\d+)\]\((https:\/\/teams\.microsoft\.com[^)]+)\)/g);
        for (const match of footnoteMatches) {
            const index = parseInt(match[1], 10) - 1; // Convert 1-based to 0-based
            teamsUrls[index] = match[2];
            this.log(`Found Teams URL at footnote [${match[1]}]: ${match[2].substring(0, 50)}...`);
        }
        this.log(`Total Teams URLs extracted: ${teamsUrls.length}`);
        
        // Try to parse as JSON - response format: optional text + JSON in code fence + footnotes
        try {
            // Remove markdown code fences if present: ```json ... ```
            let jsonContent = response;
            const codeFenceMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (codeFenceMatch) {
                jsonContent = codeFenceMatch[1].trim();
                this.log(`Extracted JSON from code fence`);
            }
            
            // Extract JSON array
            const jsonMatch = jsonContent.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]) as Array<{
                    title: string;
                    startTime: string;
                    endTime: string;
                    onlineJoinUrl?: string | null;
                    joinUrl?: string | null;
                    teamsUrl?: string | null;
                }>;
                
                this.log(`Parsed ${parsed.length} meetings from JSON`);
                
                for (let i = 0; i < parsed.length; i++) {
                    const item = parsed[i];
                    const startTime = new Date(item.startTime);
                    const endTime = new Date(item.endTime);
                    
                    // Validate dates
                    if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
                        this.log(`Skipping meeting "${item.title}" - invalid dates`);
                        continue;
                    }
                    
                    // Use REAL URL from footnotes (priority), falling back to JSON field
                    // Footnotes contain the actual Teams URLs, JSON has placeholders
                    const joinUrl = teamsUrls[i] || item.onlineJoinUrl || item.joinUrl || item.teamsUrl || undefined;
                    
                    const meeting: Meeting = {
                        id: `meeting-${meetings.length}-${Date.now()}`,
                        title: item.title,
                        startTime,
                        endTime,
                        duration: Math.round((endTime.getTime() - startTime.getTime()) / (1000 * 60)),
                        isOnline: !!joinUrl,
                        joinUrl,
                        status: this.getMeetingStatus(startTime, endTime)
                    };
                    
                    meetings.push(meeting);
                    this.log(`  [${i + 1}] "${item.title}" | ${startTime.toLocaleTimeString()} - ${endTime.toLocaleTimeString()} | joinUrl: ${joinUrl ? 'YES' : 'no'} | status: ${meeting.status}`);
                }
                
                if (meetings.length > 0) {
                    meetings.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
                    return meetings;
                }
            }
        } catch (e) {
            this.log(`JSON parsing failed: ${e}`);
        }
        
        // Fallback: text parsing for numbered lists (legacy format)
        this.log(`Falling back to numbered list parsing`);
        const meetingBlocks = response.split(/(?=\d+\.\s+\*\*)/);
        
        for (const block of meetingBlocks) {
            const titleMatch = block.match(/\d+\.\s+\*\*([^*]+)\*\*/);
            // Match ISO 8601 format: 2026-01-19T13:00:00-06:00
            const startMatchISO = block.match(/\*\*Start(?:\s+Time)?:\*\*\s*(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2})/i);
            const endMatchISO = block.match(/\*\*End(?:\s+Time)?:\*\*\s*(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2})/i);
            // Fallback to AM/PM format
            const startMatchAMPM = block.match(/\*\*Start(?:\s+Time)?:\*\*\s*(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i);
            const endMatchAMPM = block.match(/\*\*End(?:\s+Time)?:\*\*\s*(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i);
            // Match Teams URL - handle both [n](url) footnote style and (url) direct style
            const urlMatch = block.match(/\]\((https:\/\/teams\.microsoft\.com[^)]+)\)/) || 
                             block.match(/\((https:\/\/teams\.microsoft\.com[^)]+)\)/);
            
            const startMatch = startMatchISO || startMatchAMPM;
            const endMatch = endMatchISO || endMatchAMPM;
            
            if (titleMatch && startMatch) {
                const title = titleMatch[1].trim();
                let startTime: Date;
                let endTime: Date;
                
                if (startMatchISO) {
                    startTime = new Date(startMatchISO[1]);
                    endTime = endMatchISO ? new Date(endMatchISO[1]) : new Date(startTime.getTime() + 30 * 60 * 1000);
                } else {
                    const now = new Date();
                    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                    startTime = this.parseTime(startMatch[1], today);
                    endTime = endMatch ? this.parseTime(endMatch[1], today) : new Date(startTime.getTime() + 30 * 60 * 1000);
                }
                
                const joinUrl = urlMatch ? urlMatch[1] : undefined;
                
                const meeting: Meeting = {
                    id: `meeting-${meetings.length}-${Date.now()}`,
                    title,
                    startTime,
                    endTime,
                    duration: Math.round((endTime.getTime() - startTime.getTime()) / (1000 * 60)),
                    isOnline: !!joinUrl,
                    joinUrl,
                    status: this.getMeetingStatus(startTime, endTime)
                };
                
                meetings.push(meeting);
                this.log(`Parsed: ${title} | ${startTime.toLocaleTimeString()} | joinUrl: ${joinUrl ? 'yes' : 'no'} | status: ${meeting.status}`);
            }
        }
        
        meetings.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
        return meetings;
    }

    private parseTime(timeStr: string, baseDate: Date): Date {
        const result = new Date(baseDate);
        
        // Parse time like "1:00 PM" or "13:00"
        const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
        if (match) {
            let hours = parseInt(match[1], 10);
            const minutes = parseInt(match[2], 10);
            const period = match[3]?.toUpperCase();
            
            if (period === 'PM' && hours < 12) {
                hours += 12;
            } else if (period === 'AM' && hours === 12) {
                hours = 0;
            }
            
            result.setHours(hours, minutes, 0, 0);
        }
        
        return result;
    }

    private getMeetingStatus(start: Date, end: Date): 'upcoming' | 'inProgress' | 'ended' {
        const now = new Date();
        if (now < start) {
            return 'upcoming';
        }
        if (now >= start && now <= end) {
            return 'inProgress';
        }
        return 'ended';
    }

    getCachedMeetings(): Meeting[] {
        this.updateMeetingStatuses();
        return this.meetings;
    }

    getNextMeeting(): Meeting | null {
        this.updateMeetingStatuses();
        const upcoming = this.meetings
            .filter(m => m.status === 'upcoming')
            .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
        return upcoming[0] || null;
    }

    getCurrentMeeting(): Meeting | null {
        this.updateMeetingStatuses();
        return this.meetings.find(m => m.status === 'inProgress') || null;
    }

    getMinutesUntilNextMeeting(): number | null {
        const next = this.getNextMeeting();
        if (!next) {
            return null;
        }
        return Math.round((next.startTime.getTime() - Date.now()) / (1000 * 60));
    }

    private updateMeetingStatuses(): void {
        for (const meeting of this.meetings) {
            meeting.status = this.getMeetingStatus(meeting.startTime, meeting.endTime);
        }
    }

    getLastRefresh(): Date | null {
        return this.lastRefresh;
    }

    private log(message: string): void {
        const timestamp = new Date().toISOString();
        this.outputChannel.appendLine(`[${timestamp}] [MeetingService] ${message}`);
    }

    dispose(): void {
        this._onMeetingsUpdated.dispose();
        this._onLoadingStarted.dispose();
        this._onConnectionStateChanged.dispose();
    }
}
