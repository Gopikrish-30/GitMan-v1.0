// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { SidebarProvider } from './SidebarProvider';
import { AIService } from './aiService';

export function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "chatgpt-git-helper" is now active!');

    // Initialize AI Service with context for secrets access
    AIService.initialize(context);

    // Register Sidebar Provider
    const sidebarProvider = new SidebarProvider(context.extensionUri, context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            "gitHelperSidebar",
            sidebarProvider
        )
    );

	const helloWorld = vscode.commands.registerCommand('chatgpt-git-helper.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World from ChatGPT + Git Helper!');
	});

    const setApiKey = vscode.commands.registerCommand('chatgpt-git-helper.setApiKey', async () => {
        const key = await vscode.window.showInputBox({
            placeHolder: "Enter your API Key (OpenAI/GLM/Grok)",
            password: true,
            ignoreFocusOut: true
        });
        if (key) {
            await context.secrets.store("gitHelper.apiKey", key);
            vscode.window.showInformationMessage("API Key stored securely.");
        }
    });

    const setPat = vscode.commands.registerCommand('chatgpt-git-helper.setPat', async () => {
        const pat = await vscode.window.showInputBox({
            placeHolder: "Enter your GitHub Personal Access Token",
            password: true,
            ignoreFocusOut: true
        });
        if (pat) {
            await context.secrets.store("gitHelper.githubPat", pat);
            vscode.window.showInformationMessage("GitHub PAT stored securely.");
        }
    });

	context.subscriptions.push(helloWorld, setApiKey, setPat);
}

export function deactivate() {}
