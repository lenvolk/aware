import * as assert from 'assert';
import * as vscode from 'vscode';
import { getConfig, isWithinWorkingHours } from '../config';
import { Meeting } from '../types';

suite('Aware Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start Aware tests.');

	test('Extension should be present', () => {
		assert.ok(vscode.extensions.getExtension('aware.aware'));
	});

	test('getConfig returns valid configuration', () => {
		const config = getConfig();
		assert.ok(typeof config.meetingReminderMinutes === 'number');
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

	test('Commands should be registered', async () => {
		const commands = await vscode.commands.getCommands(true);
		
		const expectedCommands = [
			'aware.showMeetings',
			'aware.refreshMeetings',
			'aware.openSettings'
		];
		
		for (const cmd of expectedCommands) {
			assert.ok(commands.includes(cmd), `Command ${cmd} should be registered`);
		}
	});
});
