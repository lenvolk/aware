/**
 * Core type definitions for Aware extension
 */

export interface Meeting {
    id: string;
    title: string;
    startTime: Date;
    endTime: Date;
    duration: number; // in minutes
    organizer?: string;
    location?: string;
    isOnline: boolean;
    joinUrl?: string;
    attendees?: string[];
    status: 'upcoming' | 'inProgress' | 'ended';
}

export interface AwareConfig {
    meetingReminderMinutes: number;
    refreshIntervalMinutes: number;
    showStatusBar: boolean;
    enableNotifications: boolean;
    workingHoursStart: string;
    workingHoursEnd: string;
    preferredModel: string;
}

export interface MeetingNotification {
    meetingId: string;
    type: 'reminder' | 'starting' | 'ended';
    sentAt: Date;
}

export interface WorkIQResponse {
    meetings?: Meeting[];
    error?: string;
    rawResponse?: string;
}

export interface RelatedDocument {
    id: string;
    title: string;
    url: string;
    lastModified?: Date;
    type: string; // Word, Excel, PowerPoint, PDF, OneNote, Web Page, etc.
}

export type TimeRange = 'today' | 'tomorrow' | 'week';

export interface GetMeetingsInput {
    timeRange?: TimeRange;
}
