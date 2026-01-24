/**
 * Configuration management for Focus Time extension
 */

import * as vscode from 'vscode';
import { FocusTimeConfig } from './types';

const CONFIG_SECTION = 'focusTime';

export function getConfig(): FocusTimeConfig {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    
    return {
        meetingReminderMinutes: config.get<number>('meetingReminderMinutes', 10),
        refreshIntervalMinutes: config.get<number>('refreshIntervalMinutes', 5),
        showStatusBar: config.get<boolean>('showStatusBar', true),
        enableNotifications: config.get<boolean>('enableNotifications', true),
        workingHoursStart: config.get<string>('workingHoursStart', '09:00'),
        workingHoursEnd: config.get<string>('workingHoursEnd', '17:00'),
        preferredModel: config.get<string>('preferredModel', ''),
    };
}

export async function updateConfig<K extends keyof FocusTimeConfig>(
    key: K,
    value: FocusTimeConfig[K],
    target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global
): Promise<void> {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    await config.update(key, value, target);
}

export function onConfigChange(
    callback: (e: vscode.ConfigurationChangeEvent) => void
): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(CONFIG_SECTION)) {
            callback(e);
        }
    });
}

export function isWithinWorkingHours(): boolean {
    const config = getConfig();
    const now = new Date();
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    
    return currentTime >= config.workingHoursStart && currentTime <= config.workingHoursEnd;
}
