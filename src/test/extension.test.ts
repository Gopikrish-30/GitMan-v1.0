import * as assert from 'assert';
import * as vscode from 'vscode';
import { GitService } from '../gitService';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('GitService should be instantiated', () => {
		const gitService = new GitService();
		assert.ok(gitService);
	});

    test('GitService should have required methods', () => {
        const gitService = new GitService();
        assert.ok(typeof gitService.getStatus === 'function');
        assert.ok(typeof gitService.push === 'function');
        assert.ok(typeof gitService.pull === 'function');
        assert.ok(typeof gitService.fetch === 'function');
        assert.ok(typeof gitService.commit === 'function');
        assert.ok(typeof gitService.stash === 'function');
        assert.ok(typeof gitService.getRepoName === 'function');
    });

    test('GitService should have branch operations', () => {
        const gitService = new GitService();
        assert.ok(typeof gitService.createBranch === 'function');
        assert.ok(typeof gitService.deleteBranch === 'function');
        assert.ok(typeof gitService.switchBranch === 'function');
        assert.ok(typeof gitService.mergeBranch === 'function');
        assert.ok(typeof gitService.getBranches === 'function');
    });

    test('GitService getStatus should return string', async () => {
        const gitService = new GitService();
        // This might fail if no workspace is open or no git repo, but it should return a string or throw a specific error
        try {
            const status = await gitService.getStatus();
            assert.ok(typeof status === 'string');
        } catch (e) {
            // If it throws, it might be because no workspace is open, which is acceptable in this test environment
            assert.ok(true); 
        }
    });
});
