import * as assert from 'assert';
import * as vscode from 'vscode';
import { getConfig, isWithinWorkingHours } from '../config';
import { Meeting, FocusSession } from '../types';

suite('Focus Time Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start Focus Time tests.');

	test('Extension should be present', () => {
		assert.ok(vscode.extensions.getExtension('focus-time.focus-time'));
	});

	test('getConfig returns valid configuration', () => {
		const config = getConfig();
		assert.ok(typeof config.meetingReminderMinutes === 'number');
		assert.ok(typeof config.autoEnableDoNotDisturb === 'boolean');
		assert.ok(typeof config.refreshIntervalMinutes === 'number');
		assert.ok(typeof config.showStatusBar === 'boolean');
		assert.ok(typeof config.enableNotifications === 'boolean');
	});

	test('isWithinWorkingHours returns boolean', () => {
		const result = isWithinWorkingHours();
		assert.ok(typeof result === 'boolean');
	});

	test('Meeting type should have required properties', () => {
		const meeting: Meeting = {
			id: 'test-id',
			title: 'Test Meeting',
			startTime: new Date(),
			endTime: new Date(),
			duration: 30,
			isOnline: true,
			status: 'upcoming'
		};
		
		assert.strictEqual(meeting.id, 'test-id');
		assert.strictEqual(meeting.title, 'Test Meeting');
		assert.ok(meeting.startTime instanceof Date);
		assert.ok(meeting.endTime instanceof Date);
	});

	test('FocusSession type should have required properties', () => {
		const session: FocusSession = {
			id: 'session-1',
			startTime: new Date(),
			duration: 25,
			remainingMinutes: 25,
			isActive: true
		};
		
		assert.ok(session.startTime instanceof Date);
		assert.strictEqual(session.isActive, true);
		assert.strictEqual(session.duration, 25);
	});

	test('Commands should be registered', async () => {
		const commands = await vscode.commands.getCommands(true);
		
		const expectedCommands = [
			'focusTime.showMeetings',
			'focusTime.refreshMeetings',
			'focusTime.toggleDoNotDisturb',
			'focusTime.startFocusSession',
			'focusTime.stopFocusSession',
			'focusTime.openSettings'
		];
		
		for (const cmd of expectedCommands) {
			assert.ok(commands.includes(cmd), `Command ${cmd} should be registered`);
		}
	});
});
