/**
 * Manages focus sessions and Do Not Disturb state
 */

import * as vscode from 'vscode';
import { FocusSession, FocusStatusResult, Meeting } from './types';
import { getConfig } from './config';
import { MeetingService } from './meetingService';
import * as cp from 'child_process';

export class FocusSessionManager {
    private currentSession: FocusSession | null = null;
    private sessionTimer: NodeJS.Timeout | null = null;
    private updateInterval: NodeJS.Timeout | null = null;
    private outputChannel: vscode.OutputChannel;
    private meetingService: MeetingService;
    
    private _onSessionStarted = new vscode.EventEmitter<FocusSession>();
    private _onSessionEnded = new vscode.EventEmitter<FocusSession>();
    private _onSessionUpdated = new vscode.EventEmitter<FocusSession>();
    
    readonly onSessionStarted = this._onSessionStarted.event;
    readonly onSessionEnded = this._onSessionEnded.event;
    readonly onSessionUpdated = this._onSessionUpdated.event;

    constructor(outputChannel: vscode.OutputChannel, meetingService: MeetingService) {
        this.outputChannel = outputChannel;
        this.meetingService = meetingService;
    }

    async startSession(durationMinutes?: number): Promise<FocusSession> {
        // Stop any existing session
        if (this.currentSession?.isActive) {
            await this.stopSession();
        }

        const config = getConfig();
        const duration = durationMinutes || this.calculateOptimalDuration();
        
        const session: FocusSession = {
            id: `focus-${Date.now()}`,
            startTime: new Date(),
            duration,
            remainingMinutes: duration,
            isActive: true,
            reason: 'Manual focus session'
        };

        this.currentSession = session;
        this.log(`Starting focus session: ${duration} minutes`);

        // Start timer to update remaining time
        this.updateInterval = setInterval(() => {
            if (this.currentSession) {
                this.currentSession.remainingMinutes = Math.max(0, 
                    this.currentSession.duration - 
                    Math.floor((Date.now() - this.currentSession.startTime.getTime()) / (1000 * 60))
                );
                this._onSessionUpdated.fire(this.currentSession);
            }
        }, 60 * 1000); // Update every minute

        // Set timer to end session
        this.sessionTimer = setTimeout(() => {
            this.stopSession();
        }, duration * 60 * 1000);

        // Enable Do Not Disturb if configured
        if (config.autoEnableDoNotDisturb) {
            await this.enableDoNotDisturb();
        }

        this._onSessionStarted.fire(session);
        
        vscode.window.showInformationMessage(
            `Focus session started! ${duration} minutes until your next break.`,
            'Stop Early'
        ).then(selection => {
            if (selection === 'Stop Early') {
                this.stopSession();
            }
        });

        return session;
    }

    async stopSession(): Promise<void> {
        if (!this.currentSession) {
            return;
        }

        this.log('Stopping focus session');
        
        if (this.sessionTimer) {
            clearTimeout(this.sessionTimer);
            this.sessionTimer = null;
        }
        
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }

        this.currentSession.isActive = false;
        this.currentSession.endTime = new Date();
        
        this._onSessionEnded.fire(this.currentSession);
        
        this.currentSession = null;

        vscode.window.showInformationMessage(
            'Focus session ended. Great work!',
            'Start New Session'
        ).then(selection => {
            if (selection === 'Start New Session') {
                this.startSession();
            }
        });
    }

    async startFocusAfterMeeting(meeting: Meeting): Promise<void> {
        const duration = this.calculateOptimalDuration();
        
        const session: FocusSession = {
            id: `focus-${Date.now()}`,
            startTime: new Date(),
            duration,
            remainingMinutes: duration,
            isActive: true,
            reason: `Focus time after "${meeting.title}"`
        };

        this.currentSession = session;
        this.log(`Auto-starting focus session after meeting: ${meeting.title}`);

        // Start timers
        this.updateInterval = setInterval(() => {
            if (this.currentSession) {
                this.currentSession.remainingMinutes = Math.max(0, 
                    this.currentSession.duration - 
                    Math.floor((Date.now() - this.currentSession.startTime.getTime()) / (1000 * 60))
                );
                this._onSessionUpdated.fire(this.currentSession);
            }
        }, 60 * 1000);

        this.sessionTimer = setTimeout(() => {
            this.stopSession();
        }, duration * 60 * 1000);

        // Enable Do Not Disturb
        const config = getConfig();
        if (config.autoEnableDoNotDisturb) {
            await this.enableDoNotDisturb();
        }

        this._onSessionStarted.fire(session);
        
        vscode.window.showInformationMessage(
            `Meeting "${meeting.title}" ended. Focus mode enabled for ${duration} minutes. Do Not Disturb is ON.`,
            'Disable Focus Mode',
            'Extend Time'
        ).then(selection => {
            if (selection === 'Disable Focus Mode') {
                this.stopSession();
            } else if (selection === 'Extend Time') {
                this.extendSession(15);
            }
        });
    }

    async extendSession(additionalMinutes: number): Promise<void> {
        if (!this.currentSession) {
            vscode.window.showWarningMessage('No active focus session to extend.');
            return;
        }

        this.currentSession.duration += additionalMinutes;
        this.currentSession.remainingMinutes += additionalMinutes;
        
        // Reset the timer
        if (this.sessionTimer) {
            clearTimeout(this.sessionTimer);
        }
        
        this.sessionTimer = setTimeout(() => {
            this.stopSession();
        }, this.currentSession.remainingMinutes * 60 * 1000);

        this._onSessionUpdated.fire(this.currentSession);
        
        vscode.window.showInformationMessage(
            `Focus session extended by ${additionalMinutes} minutes. ${this.currentSession.remainingMinutes} minutes remaining.`
        );
    }

    getCurrentSession(): FocusSession | null {
        return this.currentSession;
    }

    getFocusStatus(): FocusStatusResult {
        const nextMeeting = this.meetingService.getNextMeeting();
        const minutesUntilNext = this.meetingService.getMinutesUntilNextMeeting();
        
        return {
            isActive: this.currentSession?.isActive || false,
            remainingMinutes: this.currentSession?.remainingMinutes,
            endTime: this.currentSession ? 
                new Date(this.currentSession.startTime.getTime() + this.currentSession.duration * 60 * 1000) : 
                undefined,
            nextMeeting: nextMeeting || undefined,
            minutesUntilNextMeeting: minutesUntilNext || undefined
        };
    }

    private calculateOptimalDuration(): number {
        const nextMeeting = this.meetingService.getNextMeeting();
        const config = getConfig();
        
        if (nextMeeting) {
            const minutesUntil = Math.floor(
                (nextMeeting.startTime.getTime() - Date.now()) / (1000 * 60)
            );
            // Leave time for the meeting reminder
            return Math.max(5, minutesUntil - config.meetingReminderMinutes);
        }
        
        // Default to 30 minutes if no upcoming meetings
        return 30;
    }

    async enableDoNotDisturb(): Promise<boolean> {
        this.log('Enabling Do Not Disturb');
        
        if (process.platform === 'win32') {
            return this.enableWindowsDoNotDisturb();
        } else if (process.platform === 'darwin') {
            return this.enableMacDoNotDisturb();
        } else if (process.platform === 'linux') {
            return this.enableLinuxDoNotDisturb();
        } else {
            this.log('Do Not Disturb not supported on this platform');
            return false;
        }
    }

    async disableDoNotDisturb(): Promise<boolean> {
        this.log('Disabling Do Not Disturb');
        
        if (process.platform === 'win32') {
            return this.disableWindowsDoNotDisturb();
        } else if (process.platform === 'darwin') {
            return this.disableMacDoNotDisturb();
        } else if (process.platform === 'linux') {
            return this.disableLinuxDoNotDisturb();
        } else {
            return false;
        }
    }

    private async enableWindowsDoNotDisturb(): Promise<boolean> {
        try {
            // Windows 11 has no public API for DND/Focus Assist toggle.
            // Best approach: Use keyboard shortcut Win+N to open notification center,
            // or open Quick Settings where user can toggle DND with one click.
            // 
            // Alternative: Use PowerShell UI automation to toggle DND via Action Center
            
            const automationScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

# Open Action Center with Win+N (Windows 11) or Win+A (Windows 10)
[System.Windows.Forms.SendKeys]::SendWait('#n')
Start-Sleep -Milliseconds 800

# Try to find and click the Do Not Disturb / Focus Assist button
$root = [System.Windows.Automation.AutomationElement]::RootElement
$condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, 'Do not disturb')
$dndButton = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)

if ($dndButton) {
    $invokePattern = $dndButton.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    $invokePattern.Invoke()
    Start-Sleep -Milliseconds 300
    # Close notification center
    [System.Windows.Forms.SendKeys]::SendWait('{ESCAPE}')
    Write-Output 'SUCCESS'
} else {
    # Try Windows 10 name "Focus assist"
    $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, 'Focus assist')
    $dndButton = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
    if ($dndButton) {
        $invokePattern = $dndButton.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
        $invokePattern.Invoke()
        Start-Sleep -Milliseconds 300
        [System.Windows.Forms.SendKeys]::SendWait('{ESCAPE}')
        Write-Output 'SUCCESS'
    } else {
        [System.Windows.Forms.SendKeys]::SendWait('{ESCAPE}')
        Write-Output 'NOT_FOUND'
    }
}
`;
            
            return new Promise((resolve) => {
                cp.exec(
                    `powershell -ExecutionPolicy Bypass -Command "${automationScript.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`,
                    { timeout: 10000 },
                    (error, stdout) => {
                        if (error || !stdout.includes('SUCCESS')) {
                            this.log(`UI Automation failed, opening Quick Settings for manual toggle`);
                            // Fallback: Open Quick Settings so user can toggle with one click
                            cp.exec('powershell -Command "[System.Windows.Forms.SendKeys]::SendWait(\\"#a\\")"', () => {
                                vscode.window.showInformationMessage(
                                    '� Quick Settings opened. Click "Do not disturb" to enable.',
                                    'Open Settings Instead'
                                ).then(selection => {
                                    if (selection === 'Open Settings Instead') {
                                        cp.exec('start ms-settings:notifications');
                                    }
                                });
                            });
                            resolve(true);
                        } else {
                            this.log('Windows DND enabled via UI Automation');
                            vscode.window.showInformationMessage('🔕 Do Not Disturb enabled.');
                            resolve(true);
                        }
                    }
                );
            });
        } catch (error) {
            this.log(`Failed to enable Windows DND: ${error}`);
            // Ultimate fallback
            cp.exec('start ms-settings:notifications');
            vscode.window.showInformationMessage('Please enable Do Not Disturb in Settings.');
            return false;
        }
    }

    private async disableWindowsDoNotDisturb(): Promise<boolean> {
        try {
            // Same approach: use UI Automation to toggle DND off
            const automationScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

[System.Windows.Forms.SendKeys]::SendWait('#n')
Start-Sleep -Milliseconds 800

$root = [System.Windows.Automation.AutomationElement]::RootElement
$condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, 'Do not disturb')
$dndButton = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)

if ($dndButton) {
    $invokePattern = $dndButton.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    $invokePattern.Invoke()
    Start-Sleep -Milliseconds 300
    [System.Windows.Forms.SendKeys]::SendWait('{ESCAPE}')
    Write-Output 'SUCCESS'
} else {
    $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, 'Focus assist')
    $dndButton = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
    if ($dndButton) {
        $invokePattern = $dndButton.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
        $invokePattern.Invoke()
        Start-Sleep -Milliseconds 300
        [System.Windows.Forms.SendKeys]::SendWait('{ESCAPE}')
        Write-Output 'SUCCESS'
    } else {
        [System.Windows.Forms.SendKeys]::SendWait('{ESCAPE}')
        Write-Output 'NOT_FOUND'
    }
}
`;
            
            return new Promise((resolve) => {
                cp.exec(
                    `powershell -ExecutionPolicy Bypass -Command "${automationScript.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`,
                    { timeout: 10000 },
                    (error, stdout) => {
                        if (error || !stdout.includes('SUCCESS')) {
                            this.log(`UI Automation failed for disable, opening Quick Settings`);
                            cp.exec('powershell -Command "[System.Windows.Forms.SendKeys]::SendWait(\\"#a\\")"', () => {
                                vscode.window.showInformationMessage(
                                    '🔔 Quick Settings opened. Click "Do not disturb" to disable.',
                                    'Open Settings Instead'
                                ).then(selection => {
                                    if (selection === 'Open Settings Instead') {
                                        cp.exec('start ms-settings:notifications');
                                    }
                                });
                            });
                            resolve(true);
                        } else {
                            this.log('Windows DND disabled via UI Automation');
                            vscode.window.showInformationMessage('🔔 Do Not Disturb disabled.');
                            resolve(true);
                        }
                    }
                );
            });
        } catch (error) {
            this.log(`Failed to disable Windows DND: ${error}`);
            cp.exec('start ms-settings:notifications');
            vscode.window.showInformationMessage('Please disable Do Not Disturb in Settings.');
            return false;
        }
    }

    private async enableMacDoNotDisturb(): Promise<boolean> {
        try {
            // macOS Monterey and later use Focus mode
            cp.exec('shortcuts run "Turn On Do Not Disturb"', (error) => {
                if (error) {
                    // Fallback: try opening System Preferences
                    cp.exec('open "x-apple.systempreferences:com.apple.preference.notifications"');
                }
            });
            return true;
        } catch (error) {
            this.log(`Failed to enable Mac DND: ${error}`);
            return false;
        }
    }

    private async disableMacDoNotDisturb(): Promise<boolean> {
        try {
            cp.exec('shortcuts run "Turn Off Do Not Disturb"', (error) => {
                if (error) {
                    cp.exec('open "x-apple.systempreferences:com.apple.preference.notifications"');
                }
            });
            return true;
        } catch (error) {
            this.log(`Failed to disable Mac DND: ${error}`);
            return false;
        }
    }

    private async enableLinuxDoNotDisturb(): Promise<boolean> {
        try {
            // Try GNOME's Do Not Disturb
            cp.exec('gsettings set org.gnome.desktop.notifications show-banners false', (error) => {
                if (error) {
                    this.log('GNOME notifications not available');
                }
            });
            return true;
        } catch (error) {
            this.log(`Failed to enable Linux DND: ${error}`);
            return false;
        }
    }

    private async disableLinuxDoNotDisturb(): Promise<boolean> {
        try {
            cp.exec('gsettings set org.gnome.desktop.notifications show-banners true', (error) => {
                if (error) {
                    this.log('GNOME notifications not available');
                }
            });
            return true;
        } catch (error) {
            this.log(`Failed to disable Linux DND: ${error}`);
            return false;
        }
    }

    private log(message: string): void {
        const timestamp = new Date().toISOString();
        this.outputChannel.appendLine(`[${timestamp}] [FocusSessionManager] ${message}`);
    }

    dispose(): void {
        if (this.sessionTimer) {
            clearTimeout(this.sessionTimer);
        }
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }
        this._onSessionStarted.dispose();
        this._onSessionEnded.dispose();
        this._onSessionUpdated.dispose();
    }
}
