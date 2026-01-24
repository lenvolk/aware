/**
 * Chat participant for Focus Time extension
 * Allows users to interact with the assistant via @focus in chat
 */

import * as vscode from 'vscode';
import { MeetingService } from './meetingService';
import { FocusSessionManager } from './focusSessionManager';
import { Meeting } from './types';

// Model selector for GPT-5-mini
const MODEL_SELECTOR: vscode.LanguageModelChatSelector = {
    vendor: 'copilot',
    family: 'gpt-5-mini'
};

export class FocusTimeChatParticipant {
    private participant: vscode.ChatParticipant;
    private meetingService: MeetingService;
    private focusSessionManager: FocusSessionManager;
    private model: vscode.LanguageModelChat | undefined;

    constructor(
        context: vscode.ExtensionContext,
        meetingService: MeetingService,
        focusSessionManager: FocusSessionManager
    ) {
        this.meetingService = meetingService;
        this.focusSessionManager = focusSessionManager;

        this.participant = vscode.chat.createChatParticipant(
            'focusTime.assistant',
            this.handleRequest.bind(this)
        );

        this.participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'icon.png');
        
        this.participant.followupProvider = {
            provideFollowups: this.provideFollowups.bind(this)
        };

        context.subscriptions.push(this.participant);

        // Initialize model selection
        this.selectModel();
        
        // Re-select model when available models change
        context.subscriptions.push(
            vscode.lm.onDidChangeChatModels(() => this.selectModel())
        );
    }

    private async selectModel(): Promise<void> {
        try {
            const models = await vscode.lm.selectChatModels(MODEL_SELECTOR);
            if (models.length > 0) {
                this.model = models[0];
                console.log(`[Focus Time] Selected model: ${this.model.id}`);
            } else {
                console.log('[Focus Time] GPT-5-mini not available, will use request.model as fallback');
            }
        } catch (error) {
            console.error('[Focus Time] Error selecting model:', error);
        }
    }

    private getModel(request: vscode.ChatRequest): vscode.LanguageModelChat {
        // Use explicitly selected model, or fall back to request's model
        return this.model ?? request.model;
    }

    private async handleRequest(
        request: vscode.ChatRequest,
        context: vscode.ChatContext,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<vscode.ChatResult> {
        const command = request.command;

        try {
            switch (command) {
                case 'meetings':
                    return await this.handleMeetingsCommand(request, stream, token);
                case 'focus':
                    return await this.handleFocusCommand(request, stream, token);
                case 'status':
                    return await this.handleStatusCommand(stream);
                case 'next':
                    return await this.handleNextCommand(stream);
                default:
                    return await this.handleGeneralQuery(request, context, stream, token);
            }
        } catch (error) {
            stream.markdown(`⚠️ An error occurred: ${error}`);
            return { errorDetails: { message: String(error) } };
        }
    }

    private async handleMeetingsCommand(
        request: vscode.ChatRequest,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<vscode.ChatResult> {
        stream.progress('Fetching your meetings...');

        // Determine time range from prompt
        let timeRange: 'today' | 'tomorrow' | 'week' = 'today';
        const prompt = request.prompt.toLowerCase();
        if (prompt.includes('tomorrow')) {
            timeRange = 'tomorrow';
        } else if (prompt.includes('week')) {
            timeRange = 'week';
        }

        await this.meetingService.fetchMeetings(timeRange);
        const meetings = this.meetingService.getCachedMeetings();

        if (meetings.length === 0) {
            stream.markdown(`📅 You have no meetings ${timeRange}. Perfect time for deep focus work!`);
            stream.button({
                command: 'focusTime.startFocusSession',
                title: 'Start Focus Session'
            });
        } else {
            stream.markdown(`## Your Meetings for ${timeRange.charAt(0).toUpperCase() + timeRange.slice(1)}\n\n`);
            
            for (const meeting of meetings) {
                const startTime = this.formatTime(meeting.startTime);
                const endTime = this.formatTime(meeting.endTime);
                const statusIcon = meeting.status === 'inProgress' ? '🔴' : 
                                   meeting.status === 'upcoming' ? '📅' : '✅';
                
                stream.markdown(`${statusIcon} **${meeting.title}**\n`);
                stream.markdown(`   ${startTime} - ${endTime} (${meeting.duration} min)\n\n`);
            }

            const nextMeeting = this.meetingService.getNextMeeting();
            if (nextMeeting) {
                const minutesUntil = this.meetingService.getMinutesUntilNextMeeting();
                stream.markdown(`\n⏰ Next meeting "${nextMeeting.title}" in ${minutesUntil} minutes.\n`);
            }
        }

        return { metadata: { command: 'meetings' } };
    }

    private async handleFocusCommand(
        request: vscode.ChatRequest,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<vscode.ChatResult> {
        const currentSession = this.focusSessionManager.getCurrentSession();

        if (currentSession?.isActive) {
            stream.markdown(`⏸️ You already have an active focus session with ${currentSession.remainingMinutes} minutes remaining.\n\n`);
            stream.button({
                command: 'focusTime.stopFocusSession',
                title: 'Stop Current Session'
            });
            return { metadata: { command: 'focus' } };
        }

        // Parse duration from prompt
        let duration: number | undefined;
        const durationMatch = request.prompt.match(/(\d+)\s*(?:min|minute|m)/i);
        if (durationMatch) {
            duration = parseInt(durationMatch[1], 10);
        }

        stream.progress('Starting focus session...');
        
        const session = await this.focusSessionManager.startSession(duration);

        stream.markdown(`## Focus Session Started! 🧘\n\n`);
        stream.markdown(`Duration: **${session.duration} minutes**\n\n`);
        
        const nextMeeting = this.meetingService.getNextMeeting();
        if (nextMeeting) {
            const minutesUntil = this.meetingService.getMinutesUntilNextMeeting();
            stream.markdown(`Your next meeting "${nextMeeting.title}" is in ${minutesUntil} minutes. ` +
                          `I'll remind you before it starts.\n\n`);
        } else {
            stream.markdown(`No upcoming meetings detected. Enjoy your uninterrupted focus time!\n\n`);
        }

        stream.markdown(`Do Not Disturb has been enabled.\n`);
        
        stream.button({
            command: 'focusTime.stopFocusSession',
            title: 'Stop Focus Session'
        });

        return { metadata: { command: 'focus' } };
    }

    private async handleStatusCommand(
        stream: vscode.ChatResponseStream
    ): Promise<vscode.ChatResult> {
        const status = this.focusSessionManager.getFocusStatus();
        const session = this.focusSessionManager.getCurrentSession();

        stream.markdown(`## Focus Time Status\n\n`);

        if (session?.isActive) {
            stream.markdown(`🧘 **Focus Mode: Active**\n\n`);
            stream.markdown(`- Remaining: ${status.remainingMinutes} minutes\n`);
            stream.markdown(`- Ends at: ${this.formatTime(status.endTime!)}\n\n`);
            
            stream.button({
                command: 'focusTime.stopFocusSession',
                title: 'Stop Session'
            });
        } else {
            stream.markdown(`😊 **Focus Mode: Inactive**\n\n`);
            stream.button({
                command: 'focusTime.startFocusSession',
                title: 'Start Focus Session'
            });
        }

        if (status.nextMeeting) {
            stream.markdown(`\n### Next Meeting\n\n`);
            stream.markdown(`**${status.nextMeeting.title}**\n`);
            stream.markdown(`In ${status.minutesUntilNextMeeting} minutes (${this.formatTime(status.nextMeeting.startTime)})\n`);
        } else {
            stream.markdown(`\n✨ No upcoming meetings!\n`);
        }

        return { metadata: { command: 'status' } };
    }

    private async handleNextCommand(
        stream: vscode.ChatResponseStream
    ): Promise<vscode.ChatResult> {
        const nextMeeting = this.meetingService.getNextMeeting();

        if (!nextMeeting) {
            stream.markdown(`✨ You have no upcoming meetings. Enjoy your free time!\n`);
            stream.button({
                command: 'focusTime.startFocusSession',
                title: 'Start Focus Session'
            });
        } else {
            const minutesUntil = this.meetingService.getMinutesUntilNextMeeting()!;
            const startTime = this.formatTime(nextMeeting.startTime);
            const endTime = this.formatTime(nextMeeting.endTime);

            stream.markdown(`## Your Next Meeting\n\n`);
            stream.markdown(`**${nextMeeting.title}**\n\n`);
            stream.markdown(`- Starts: ${startTime} (in ${this.formatDuration(minutesUntil)})\n`);
            stream.markdown(`- Ends: ${endTime}\n`);
            stream.markdown(`- Duration: ${nextMeeting.duration} minutes\n`);
            
            if (nextMeeting.organizer) {
                stream.markdown(`- Organizer: ${nextMeeting.organizer}\n`);
            }

            if (nextMeeting.joinUrl) {
                stream.markdown(`\n`);
                stream.button({
                    command: 'focusTime.joinMeeting',
                    arguments: [nextMeeting],
                    title: 'Join Meeting'
                });
            }

            if (minutesUntil > 15) {
                stream.markdown(`\n\nYou have ${minutesUntil} minutes before this meeting. Consider starting a focus session!\n`);
                stream.button({
                    command: 'focusTime.startFocusSession',
                    title: 'Start Focus Session'
                });
            }
        }

        return { metadata: { command: 'next' } };
    }

    private async handleGeneralQuery(
        request: vscode.ChatRequest,
        context: vscode.ChatContext,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<vscode.ChatResult> {
        const model = this.getModel(request);
        const prompt = request.prompt.toLowerCase();

        // Use the LLM to classify the user's intent
        const classificationPrompt = `You are a focus time assistant. Classify the user's intent into one of these categories:
- "meetings" - user wants to see their meetings or calendar
- "focus" - user wants to start a focus session or concentrate
- "status" - user wants to check their current focus status
- "next" - user wants to know about their next meeting
- "help" - user needs help or the intent is unclear

User message: "${request.prompt}"

Respond with ONLY the category name, nothing else.`;

        try {
            const messages = [vscode.LanguageModelChatMessage.User(classificationPrompt)];
            const response = await model.sendRequest(messages, {}, token);
            
            let intent = '';
            for await (const chunk of response.text) {
                intent += chunk;
            }
            intent = intent.trim().toLowerCase();

            // Route based on LLM classification
            if (intent === 'meetings') {
                return this.handleMeetingsCommand(request, stream, token);
            } else if (intent === 'focus') {
                return this.handleFocusCommand(request, stream, token);
            } else if (intent === 'status') {
                return this.handleStatusCommand(stream);
            } else if (intent === 'next') {
                return this.handleNextCommand(stream);
            }
        } catch (error) {
            console.log('[Focus Time] LLM classification failed, falling back to keyword matching:', error);
            
            // Fallback to simple keyword matching
            if (prompt.includes('meeting') || prompt.includes('calendar')) {
                return this.handleMeetingsCommand(request, stream, token);
            } else if (prompt.includes('focus') || prompt.includes('start') || prompt.includes('concentrate')) {
                return this.handleFocusCommand(request, stream, token);
            } else if (prompt.includes('status') || prompt.includes('current') || prompt.includes('active')) {
                return this.handleStatusCommand(stream);
            } else if (prompt.includes('next') || prompt.includes('upcoming')) {
                return this.handleNextCommand(stream);
            }
        }

        // Default response with available commands
        stream.markdown(`## Focus Time Assistant\n\n`);
        stream.markdown(`I can help you manage your focus time and meetings. Here's what I can do:\n\n`);
        stream.markdown(`- **/meetings** - Show your upcoming meetings\n`);
        stream.markdown(`- **/focus** - Start a focus session\n`);
        stream.markdown(`- **/status** - Check your current focus status\n`);
        stream.markdown(`- **/next** - See when your next meeting is\n\n`);
        stream.markdown(`You can also ask me questions like:\n`);
        stream.markdown(`- "What meetings do I have today?"\n`);
        stream.markdown(`- "Start a 30 minute focus session"\n`);
        stream.markdown(`- "When is my next meeting?"\n`);

        return { metadata: { command: 'help' } };
    }

    private provideFollowups(
        result: vscode.ChatResult,
        context: vscode.ChatContext,
        token: vscode.CancellationToken
    ): vscode.ChatFollowup[] {
        const command = (result.metadata as { command?: string })?.command;

        switch (command) {
            case 'meetings':
                return [
                    { prompt: 'Start a focus session', label: '🧘 Start Focus' },
                    { prompt: 'When is my next meeting?', label: '⏰ Next Meeting' }
                ];
            case 'focus':
                return [
                    { prompt: 'What is my focus status?', label: '📊 Check Status' },
                    { prompt: 'Show my meetings', label: '📅 View Meetings' }
                ];
            case 'status':
                return [
                    { prompt: 'Show my meetings', label: '📅 View Meetings' },
                    { prompt: 'When is my next meeting?', label: '⏰ Next Meeting' }
                ];
            case 'next':
                return [
                    { prompt: 'Start a focus session', label: '🧘 Start Focus' },
                    { prompt: 'Show all my meetings', label: '📅 All Meetings' }
                ];
            default:
                return [
                    { prompt: 'Show my meetings for today', label: '📅 Today\'s Meetings' },
                    { prompt: 'Start a focus session', label: '🧘 Focus Mode' }
                ];
        }
    }

    private formatTime(date: Date): string {
        return date.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
    }

    private formatDuration(minutes: number): string {
        if (minutes < 60) {
            return `${minutes} minutes`;
        }
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return mins > 0 ? `${hours}h ${mins}m` : `${hours} hour${hours > 1 ? 's' : ''}`;
    }

    dispose(): void {
        this.participant.dispose();
    }
}
