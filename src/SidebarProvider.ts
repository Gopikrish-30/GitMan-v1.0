import * as vscode from "vscode";
import { GitService } from "./gitService";
import { AIService } from "./aiService";
import { AuthService } from "./authService";

export class SidebarProvider implements vscode.WebviewViewProvider {
  _view?: vscode.WebviewView;
  _doc?: vscode.TextDocument;
  private authService: AuthService;
  private currentUser: any = null;

  constructor(private readonly _extensionUri: vscode.Uri, private readonly _context: vscode.ExtensionContext) {
      this.authService = new AuthService(_context);
  }

  public resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case "onInfo": {
          if (!data.value) {
            return;
          }
          vscode.window.showInformationMessage(data.value);
          break;
        }
        case "onError": {
          if (!data.value) {
            return;
          }
          vscode.window.showErrorMessage(data.value);
          break;
        }
        case "git-action": {
          await this.handleGitAction(data.action, data.payload);
          break;
        }
        case "chat-query": {
          await this.handleChatQuery(data.value);
          break;
        }
        case "refresh-stats": {
            await this.refreshStats();
            break;
        }
        case "save-settings": {
            await this.saveSettings(data.value);
            break;
        }
        case "get-settings": {
            await this.sendSettings();
            break;
        }
        case "login-github": {
            await this.handleGitHubLogin();
            break;
        }
        case "open-external": {
            if (data.value) {
                vscode.env.openExternal(vscode.Uri.parse(data.value));
            }
            break;
        }
        case "login-device-flow": {
            await this.handleDeviceFlowLogin();
            break;
        }
        case "logout-github": {
            await this._context.secrets.delete("gitHelper.githubPat");
            this.currentUser = null;
            vscode.window.showInformationMessage("Logged out from GitHub.");
            this.checkAuth();
            break;
        }
      }
    });
    
    // Check auth status on load
    this.checkAuth();
  }

  private async handleDeviceFlowLogin() {
      try {
          const { device_code, user_code, verification_uri, interval } = await this.authService.initiateDeviceFlow();
          
          // Show the code to the user
          this._view?.webview.postMessage({ 
              type: 'show-device-code', 
              value: { user_code, verification_uri } 
          });

          // Poll for token
          const token = await this.authService.pollForToken(device_code, interval);
          
          if (token) {
              await this._context.secrets.store("gitHelper.githubPat", token);
              vscode.window.showInformationMessage("Successfully logged in with GitHub!");
              
              // Update Git Remote URL
              const gitService = new GitService();
              await gitService.updateRemoteUrlWithToken(token);

              // Fetch user profile
              try {
                  const profile = await this.authService.getUserProfile(token);
                  this.currentUser = {
                      name: profile.name || profile.login,
                      email: profile.email || "No public email",
                      avatar: profile.avatarUrl,
                      followers: profile.followers?.totalCount || 0,
                      following: profile.following?.totalCount || 0,
                      repos: profile.repositories?.totalCount || 0,
                      contributions: profile.contributionsCollection?.contributionCalendar?.totalContributions || 0
                  };
              } catch (e) {
                  console.error("Failed to fetch profile", e);
              }

              this.checkAuth();
          }
      } catch (e: any) {
          vscode.window.showErrorMessage(`Device Flow Login failed: ${e.message}`);
          this._view?.webview.postMessage({ type: 'show-setup' }); // Go back to setup on error
      }
  }

  private async handleGitHubLogin() {
      try {
          const session = await vscode.authentication.getSession('github', ['repo', 'user:email'], { createIfNone: true });
          if (session) {
              await this._context.secrets.store("gitHelper.githubPat", session.accessToken);
              vscode.window.showInformationMessage(`Logged in as ${session.account.label}`);
              this._view?.webview.postMessage({ type: 'github-connected', user: session.account.label });
              this.checkAuth();
          }
      } catch (e: any) {
          vscode.window.showErrorMessage(`GitHub Login failed: ${e.message}`);
      }
  }

  private async checkAuth() {
      const apiKey = await this._context.secrets.get("gitHelper.apiKey");
      const pat = await this._context.secrets.get("gitHelper.githubPat");
      
      if (!apiKey || !pat) {
          this._view?.webview.postMessage({ type: 'show-setup' });
      } else {
          this._view?.webview.postMessage({ type: 'show-dashboard' });
          this.refreshStats();
      }
  }

  private async saveSettings(settings: any) {
      if (settings.apiKey) {
          await this._context.secrets.store("gitHelper.apiKey", settings.apiKey);
      }
      if (settings.pat) {
          await this._context.secrets.store("gitHelper.githubPat", settings.pat);
      }
      
      const config = vscode.workspace.getConfiguration("gitHelper");
      if (settings.provider) {
          await config.update("apiProvider", settings.provider, vscode.ConfigurationTarget.Global);
      }
      if (settings.baseUrl) {
          await config.update("apiBaseUrl", settings.baseUrl, vscode.ConfigurationTarget.Global);
      }
      if (settings.modelName) {
          await config.update("modelName", settings.modelName, vscode.ConfigurationTarget.Global);
      }

      vscode.window.showInformationMessage("Settings saved successfully!");
      this.checkAuth();
  }

  private async sendSettings() {
      const config = vscode.workspace.getConfiguration("gitHelper");
      const provider = config.get<string>("apiProvider");
      const baseUrl = config.get<string>("apiBaseUrl");
      const modelName = config.get<string>("modelName");
      // Don't send secrets back to UI for security, or send masked
      
      this._view?.webview.postMessage({
          type: 'populate-settings',
          value: {
              provider,
              baseUrl,
              modelName
          }
      });
  }

  private async handleGitAction(action: string, payload?: any) {
    const gitService = new GitService();
    try {
      let result = "";
      switch (action) {
        case "status":
          result = await gitService.getStatus();
          break;
        case "push":
          result = await gitService.push();
          break;
        case "pull":
          result = await gitService.pull();
          break;
        case "fetch":
          result = await gitService.fetch();
          break;
        case "commit":
            if(payload && payload.message) {
                result = await gitService.commit(payload.message);
            } else {
                throw new Error("Commit message required");
            }
            break;
        case "fast-push":
            await gitService.addAll();
            await gitService.commit("Fast Push: Auto-commit");
            result = await gitService.push();
            break;
        case "stash":
            result = await gitService.stash();
            break;
        case "set-remote":
             if(payload && payload.url) {
                 result = await gitService.setRemote(payload.url);
             } else {
                 throw new Error("Remote URL required");
             }
             break;
        case "create-branch":
            if(payload && payload.name) {
                result = await gitService.createBranch(payload.name);
            } else {
                throw new Error("Branch name required");
            }
            break;
        case "delete-branch":
            if(payload && payload.name) {
                result = await gitService.deleteBranch(payload.name);
            } else {
                throw new Error("Branch name required");
            }
            break;
        case "switch-branch":
            if(payload && payload.name) {
                result = await gitService.switchBranch(payload.name);
            } else {
                throw new Error("Branch name required");
            }
            break;
        case "merge-branch":
            if(payload && payload.name) {
                result = await gitService.mergeBranch(payload.name);
            } else {
                throw new Error("Branch name required");
            }
            break;
      }
      vscode.window.showInformationMessage(`Git ${action} success: ${result}`);
      this.refreshStats();
    } catch (error: any) {
      vscode.window.showErrorMessage(`Git ${action} failed: ${error.message}`);
    }
  }

  private async handleChatQuery(query: string) {
    if (!query) {
      return;
    }
    
    // Send user message to UI immediately
    this._view?.webview.postMessage({
        type: "add-chat-message",
        value: { role: "user", content: query }
    });

    const aiService = new AIService();
    try {
        const response = await aiService.getCompletion(query);
        this._view?.webview.postMessage({
            type: "add-chat-message",
            value: { role: "assistant", content: response }
        });
    } catch (error: any) {
        this._view?.webview.postMessage({
            type: "add-chat-message",
            value: { role: "system", content: `Error: ${error.message}` }
        });
    }
  }

  private async refreshStats() {
      const gitService = new GitService();
      try {
          const branch = await gitService.getCurrentBranch();
          const remote = await gitService.getRemote();
          const status = await gitService.getStatus();
          const repoName = await gitService.getRepoName();
          const repoPath = await gitService.getRepoPath();
          
          // Get user info from session if available
          let user: any = { name: "Guest", email: "Not logged in", avatar: "" };
          
          if (this.currentUser) {
              user = this.currentUser;
          } else {
              // Try to fetch using stored PAT first
              const pat = await this._context.secrets.get("gitHelper.githubPat");
              if (pat) {
                  try {
                      const profile = await this.authService.getUserProfile(pat);
                      this.currentUser = {
                          name: profile.name || profile.login,
                          email: profile.email || "No public email",
                          avatar: profile.avatarUrl,
                          followers: profile.followers?.totalCount || 0,
                          following: profile.following?.totalCount || 0,
                          repos: profile.repositories?.totalCount || 0,
                          contributions: profile.contributionsCollection?.contributionCalendar?.totalContributions || 0
                      };
                      user = this.currentUser;
                  } catch (e) {
                      console.error("Failed to fetch profile with stored PAT", e);
                  }
              }

              // Fallback to session if still no user
              if (!this.currentUser) {
                  try {
                      const session = await vscode.authentication.getSession('github', ['repo', 'user:email'], { createIfNone: false });
                      if (session) {
                          user.name = session.account.label;
                          user.email = "Logged in via GitHub"; 
                      }
                  } catch (e) {}
              }
          }

          this._view?.webview.postMessage({
              type: "update-stats",
              value: {
                  branch,
                  remote,
                  status,
                  repoName,
                  repoPath,
                  user
              }
          });
      } catch (e) {
          console.error("Failed to refresh stats", e);
      }
  }

  public revive(panel: vscode.WebviewView) {
    this._view = panel;
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    const styleResetUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "reset.css")
    );
    const styleVSCodeUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "vscode.css")
    );

    return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<style>
                    :root {
                        --bg-color: var(--vscode-sideBar-background);
                        --card-bg: var(--vscode-editor-background);
                        --border-color: var(--vscode-widget-border);
                        --text-primary: var(--vscode-foreground);
                        --text-secondary: var(--vscode-descriptionForeground);
                        --accent: var(--vscode-button-background);
                        --accent-hover: var(--vscode-button-hoverBackground);
                        --hover-bg: var(--vscode-list-hoverBackground);
                        --input-bg: var(--vscode-input-background);
                        --input-border: var(--vscode-input-border);
                        --button-blue: #007acc;
                        --button-blue-hover: #0062a3;
                    }

                    body {
                        font-family: var(--vscode-font-family);
                        padding: 0;
                        margin: 0;
                        background-color: var(--bg-color);
                        color: var(--text-primary);
                        font-size: 13px;
                    }

                    /* Tabs */
                    .tab-nav {
                        display: flex;
                        background-color: var(--vscode-sideBarSectionHeader-background);
                        border-bottom: 1px solid var(--border-color);
                        position: sticky; top: 0; z-index: 10;
                    }
                    .tab-link {
                        flex: 1;
                        padding: 12px 0;
                        text-align: center;
                        cursor: pointer;
                        background: transparent;
                        border: none;
                        color: var(--text-secondary);
                        font-weight: 500;
                        border-bottom: 2px solid transparent;
                        transition: all 0.2s ease;
                        font-size: 12px;
                        text-transform: uppercase;
                        letter-spacing: 0.5px;
                    }
                    .tab-link:hover { color: var(--text-primary); background-color: rgba(255,255,255,0.02); }
                    .tab-link.active {
                        color: var(--text-primary);
                        border-bottom-color: var(--accent);
                        font-weight: 600;
                    }

                    /* Content */
                    .tab-content { display: none; padding: 20px 15px; animation: fadeIn 0.3s ease; }
                    .tab-content.active { display: block; }
                    @keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }

                    /* Profile Header */
                    .profile-header {
                        display: flex; align-items: center;
                        padding: 16px;
                        background: var(--card-bg);
                        border: 1px solid var(--border-color);
                        border-radius: 8px;
                        margin-bottom: 12px;
                        box-shadow: 0 2px 8px rgba(0,0,0,0.05);
                        position: relative;
                    }
                    .avatar {
                        width: 48px; height: 48px;
                        border-radius: 50%;
                        background: linear-gradient(135deg, #007acc 0%, #005fa3 100%);
                        color: white;
                        display: flex; align-items: center; justify-content: center;
                        font-weight: bold; font-size: 1.4em;
                        margin-right: 15px;
                        box-shadow: 0 2px 5px rgba(0,0,0,0.2);
                    }
                    .user-info { flex: 1; overflow: hidden; }
                    .user-name { font-weight: 600; font-size: 1.1em; margin-bottom: 2px; display: block; }
                    .user-email { font-size: 0.85em; color: var(--text-secondary); display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                    .settings-icon {
                        padding: 6px; border-radius: 4px; cursor: pointer; color: var(--text-secondary); transition: all 0.2s;
                        position: absolute; top: 10px; right: 10px;
                    }
                    .settings-icon:hover { background-color: var(--hover-bg); color: var(--text-primary); }

                    /* GitHub Stats Row */
                    .gh-stats-row {
                        display: flex; gap: 12px; margin-bottom: 24px;
                    }
                    .gh-stat-box {
                        flex: 1;
                        background: var(--card-bg);
                        border: 1px solid var(--border-color);
                        border-radius: 8px;
                        padding: 12px;
                        display: flex; flex-direction: column;
                        justify-content: center;
                    }
                    .gh-stat-box .label {
                        font-size: 0.8em; color: var(--text-secondary); margin-bottom: 4px;
                    }
                    .gh-stat-box .value {
                        font-size: 1.4em; font-weight: 700; color: var(--button-blue);
                    }

                    /* Repo Info Card */
                    .repo-info-card {
                        background: var(--card-bg);
                        border: 1px solid var(--border-color);
                        border-radius: 8px;
                        padding: 16px;
                        margin-bottom: 24px;
                    }
                    .repo-field { margin-bottom: 12px; }
                    .repo-field:last-child { margin-bottom: 0; }
                    .repo-field .label {
                        display: block; font-size: 0.8em; color: var(--text-secondary); margin-bottom: 6px;
                    }
                    .repo-value-row {
                        display: flex; align-items: center; justify-content: space-between;
                    }
                    .repo-value-main {
                        font-size: 1.1em; font-weight: 700; color: var(--text-primary);
                    }
                    .repo-value-path {
                        font-family: monospace; font-size: 0.9em; color: var(--text-primary);
                        word-break: break-all;
                    }
                    .copy-icon {
                        cursor: pointer; opacity: 0.6; transition: opacity 0.2s;
                    }
                    .copy-icon:hover { opacity: 1; }
                    .divider {
                        height: 1px; background: var(--border-color); margin: 12px 0; opacity: 0.5;
                    }

                    /* Stats */
                    .stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 24px; }
                    .stat-card {
                        background: var(--card-bg);
                        border: 1px solid var(--border-color);
                        padding: 15px; border-radius: 8px;
                        text-align: center;
                        transition: transform 0.2s, border-color 0.2s;
                        box-shadow: 0 2px 4px rgba(0,0,0,0.05);
                    }
                    .stat-card:hover { transform: translateY(-2px); border-color: var(--accent); }
                    .stat-label { font-size: 0.75em; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; display: block; }
                    .stat-value { font-size: 1.2em; font-weight: 700; color: var(--accent); }

                    /* Section Headers */
                    .section-title {
                        font-size: 0.75em; font-weight: 700; color: var(--text-secondary);
                        text-transform: uppercase; letter-spacing: 1px;
                        margin: 24px 0 12px 0;
                        display: flex; align-items: center;
                    }
                    .section-title::after {
                        content: ''; flex: 1; height: 1px; background: var(--border-color); margin-left: 12px; opacity: 0.6;
                    }

                    /* Repo Card */
                    .repo-card {
                        background: var(--card-bg);
                        border: 1px solid var(--border-color);
                        border-radius: 8px;
                        padding: 16px;
                        display: flex; justify-content: space-between; align-items: center;
                        box-shadow: 0 2px 4px rgba(0,0,0,0.05);
                    }
                    .repo-info-text { display: flex; flex-direction: column; overflow: hidden; }
                    .repo-name { font-weight: 600; font-size: 1.1em; margin-bottom: 4px; }
                    .repo-path { font-size: 0.85em; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px; }

                    /* SYNC Section Layout */
                    .sync-section { margin-top: 24px; }
                    .sync-header {
                        font-size: 11px; font-weight: 700; color: var(--text-secondary);
                        text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px;
                    }
                    
                    /* Fast Push Button */
                    .btn-primary-large {
                        width: 100%;
                        background-color: var(--button-blue);
                        color: white;
                        border: none;
                        border-radius: 6px;
                        padding: 14px;
                        font-size: 15px;
                        font-weight: 600;
                        cursor: pointer;
                        display: flex; align-items: center; justify-content: center; gap: 10px;
                        transition: background-color 0.2s, transform 0.1s;
                        box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                    }
                    .btn-primary-large:hover { background-color: var(--button-blue-hover); transform: translateY(-1px); }
                    .btn-primary-large:active { transform: translateY(1px); }
                    
                    .fast-push-subtext {
                        text-align: center; font-size: 11px; color: var(--text-secondary);
                        margin-top: 8px; margin-bottom: 16px; opacity: 0.8;
                    }

                    /* Grid Layout */
                    .grid-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
                    .grid-btn {
                        background-color: var(--card-bg);
                        border: 1px solid var(--border-color);
                        border-radius: 6px;
                        padding: 16px 10px;
                        display: flex; flex-direction: column; align-items: center; justify-content: center;
                        cursor: pointer; transition: all 0.2s;
                        color: var(--text-primary);
                    }
                    .grid-btn:hover {
                        background-color: var(--hover-bg);
                        border-color: var(--accent);
                        transform: translateY(-2px);
                    }
                    .grid-btn-icon { font-size: 20px; margin-bottom: 8px; color: var(--text-secondary); }
                    .grid-btn:hover .grid-btn-icon { color: var(--text-primary); }
                    .grid-btn-label { font-size: 12px; font-weight: 500; }

                    /* Action Buttons (Legacy/List) */
                    .action-list { display: flex; flex-direction: column; gap: 8px; }
                    .action-btn {
                        width: 100%; text-align: left; cursor: pointer;
                        display: flex; align-items: center;
                        color: var(--text-primary);
                        border: 1px solid var(--border-color);
                        background: var(--card-bg);
                        padding: 12px;
                        border-radius: 8px;
                        transition: all 0.2s;
                    }
                    .action-btn:hover {
                        background: var(--hover-bg);
                        border-color: var(--accent);
                        transform: translateX(2px);
                    }
                    .action-icon {
                        width: 28px; height: 28px;
                        display: flex; align-items: center; justify-content: center;
                        background: rgba(255,255,255,0.05);
                        border-radius: 6px;
                        margin-right: 12px;
                        color: var(--accent);
                        font-size: 1.1em;
                    }

                    /* Inputs & Forms */
                    .input {
                        background: var(--input-bg);
                        color: var(--text-primary);
                        border: 1px solid var(--input-border);
                        padding: 10px;
                        width: 100%;
                        border-radius: 4px;
                        margin-bottom: 12px;
                        box-sizing: border-box;
                        outline: none;
                        font-family: inherit;
                    }
                    .input:focus { border-color: var(--accent); }
                    
                    .btn {
                        background: var(--accent); color: white;
                        border: none; padding: 10px 16px; cursor: pointer; width: 100%;
                        border-radius: 4px; font-weight: 500;
                        transition: background 0.2s;
                    }
                    .btn:hover { background: var(--accent-hover); }

                    /* Chat */
                    #chat-history {
                        height: 400px; overflow-y: auto; padding: 15px;
                        background: var(--card-bg); border: 1px solid var(--border-color);
                        border-radius: 8px; margin-bottom: 15px;
                    }
                    .chat-msg {
                        padding: 12px 16px; border-radius: 12px; margin-bottom: 12px; max-width: 85%;
                        line-height: 1.5; font-size: 0.95em;
                        box-shadow: 0 1px 2px rgba(0,0,0,0.1);
                    }
                    .chat-msg.user {
                        background: var(--accent); color: white;
                        margin-left: auto; border-bottom-right-radius: 2px;
                    }
                    .chat-msg.assistant {
                        background: var(--hover-bg);
                        border: 1px solid var(--border-color);
                        margin-right: auto; border-bottom-left-radius: 2px;
                    }

                    /* Scrollbar */
                    ::-webkit-scrollbar { width: 8px; }
                    ::-webkit-scrollbar-track { background: transparent; }
                    ::-webkit-scrollbar-thumb { background: var(--vscode-scrollbarSlider-background); border-radius: 4px; }
                    ::-webkit-scrollbar-thumb:hover { background: var(--vscode-scrollbarSlider-hoverBackground); }
				</style>
			</head>
			<body>
                <!-- Setup View -->
                <div id="setup-view" style="display: none; padding: 30px 20px;">
                    <h2 style="text-align: center; margin-bottom: 10px;">Git Helper Setup</h2>
                    <p style="text-align: center; color: var(--text-secondary); margin-bottom: 30px;">Connect GitHub & AI to get started.</p>
                    
                    <button class="btn" style="background-color: #238636; margin-bottom: 20px; padding: 12px;" onclick="connectGitHub()">
                        Login with GitHub
                    </button>
                    
                    <details style="margin-bottom: 20px;">
                        <summary style="cursor: pointer; color: var(--accent);">Or use Personal Access Token</summary>
                        <input type="password" id="setup-pat" class="input" placeholder="ghp_..." style="margin-top: 10px;" />
                    </details>
                    
                    <div class="section-title">AI Configuration</div>
                    <select id="setup-provider" class="input">
                        <option value="OpenAI">OpenAI</option>
                        <option value="GLM">GLM</option>
                        <option value="Grok">Grok</option>
                    </select>
                    <input type="password" id="setup-apikey" class="input" placeholder="API Key (sk-...)" />
                    <input type="text" id="setup-baseurl" class="input" placeholder="Base URL (Optional)" />
                    <input type="text" id="setup-model" class="input" placeholder="Model Name (e.g. gpt-4)" />
                    
                    <button class="btn" onclick="saveSettings('setup')" style="margin-top: 10px;">Save & Continue</button>
                </div>

                <!-- Device Code View -->
                <div id="device-code-view" style="display: none; padding: 30px 20px; text-align: center;">
                    <h2 style="margin-bottom: 15px;">GitHub Sign In</h2>
                    <p style="color: var(--text-secondary); margin-bottom: 20px;">To sign in, visit the URL below and enter the code:</p>
                    
                    <div style="background: var(--input-bg); padding: 15px; border-radius: 8px; margin: 20px 0; font-size: 1.5em; font-weight: bold; letter-spacing: 2px; border: 1px solid var(--accent); color: var(--accent);">
                        <span id="device-user-code">...</span>
                    </div>
                    
                    <p style="margin-bottom: 20px;">
                        <a id="device-verification-uri" href="#" style="color: var(--button-blue); text-decoration: none; word-break: break-all;">...</a>
                    </p>
                    
                    <button class="btn" onclick="copyCodeAndOpen()">Copy Code & Open</button>
                    
                    <div style="margin-top: 30px; font-size: 0.9em; color: var(--text-secondary);">
                        <span>↻</span> Waiting for authentication...
                    </div>
                    
                    <button class="btn" style="background-color: transparent; border: 1px solid var(--border-color); margin-top: 20px; color: var(--text-primary);" onclick="cancelLogin()">Cancel</button>
                </div>

                <!-- Main View -->
                <div id="main-view" style="display: none;">
                    <div class="tab-nav">
                        <button class="tab-link active" onclick="openTab('dashboard')">Dashboard</button>
                        <button class="tab-link" onclick="openTab('chat')">Chat</button>
                    </div>

                    <!-- Dashboard Tab -->
                    <div id="dashboard" class="tab-content active">
                        <!-- Profile Header -->
                        <div class="profile-header">
                            <div class="avatar" id="user-avatar">G</div>
                            <div class="user-info">
                                <span class="user-name" id="user-name">Guest User</span>
                                <span class="user-email" id="user-email">Not logged in</span>
                            </div>
                            <div class="settings-icon" onclick="openTab('profile')" title="Settings">⚙️</div>
                        </div>

                        <!-- GitHub Stats Row -->
                        <div class="gh-stats-row" id="gh-stats-row" style="display: none;">
                            <div class="gh-stat-box">
                                <span class="label">Repos</span>
                                <span class="value" id="gh-repos-count">-</span>
                            </div>
                            <div class="gh-stat-box">
                                <span class="label">Contributions</span>
                                <span class="value" id="gh-contribs-count">-</span>
                            </div>
                        </div>

                        <!-- Repo Info -->
                        <div class="section-title">REPO INFO</div>
                        <div class="repo-info-card">
                            <div class="repo-field">
                                <span class="label">Repository</span>
                                <div class="repo-value-row">
                                    <span class="repo-value-main" id="repo-name">Loading...</span>
                                    <span class="copy-icon" title="Copy Name">❐</span>
                                </div>
                            </div>
                            <div class="divider"></div>
                            <div class="repo-field">
                                <span class="label">Path</span>
                                <span class="repo-value-path" id="repo-path">...</span>
                            </div>
                            <div class="divider"></div>
                            <div class="repo-field">
                                <span class="label">Remote URL</span>
                                <div class="repo-value-row">
                                    <span class="repo-value-path" id="repo-remote">...</span>
                                    <span class="copy-icon" title="Edit Remote" onclick="promptRemote()">✎</span>
                                </div>
                            </div>
                        </div>

                        <!-- Branch Info (Moved below) -->
                        <div class="stats-grid">
                            <div class="stat-card">
                                <span class="stat-label">Current Branch</span>
                                <span class="stat-value" id="stat-branch">-</span>
                            </div>
                            <div class="stat-card">
                                <span class="stat-label">Repo Status</span>
                                <span class="stat-value" id="stat-status">-</span>
                            </div>
                        </div>

                        <!-- SYNC Section (New Layout) -->
                        <div class="sync-section">
                            <div class="sync-header">SYNC</div>
                            
                            <button class="btn-primary-large" onclick="gitAction('fast-push')">
                                <span>⚡</span> Fast Push
                            </button>
                            <div class="fast-push-subtext">Stage All • Commit • Push</div>

                            <div class="grid-actions">
                                <div class="grid-btn" onclick="gitAction('pull')">
                                    <span class="grid-btn-icon">↓</span>
                                    <span class="grid-btn-label">Pull</span>
                                </div>
                                <div class="grid-btn" onclick="gitAction('push')">
                                    <span class="grid-btn-icon">↑</span>
                                    <span class="grid-btn-label">Push</span>
                                </div>
                                <div class="grid-btn" onclick="promptCommit()">
                                    <span class="grid-btn-icon">●</span>
                                    <span class="grid-btn-label">Commit</span>
                                </div>
                                <div class="grid-btn" onclick="gitAction('stash')">
                                    <span class="grid-btn-icon">≡</span>
                                    <span class="grid-btn-label">Stash</span>
                                </div>
                            </div>
                        </div>

                        <!-- Branch Operations -->
                        <div class="section-title">BRANCH OPS</div>
                        <div class="grid-actions">
                            <div class="grid-btn" onclick="promptCreateBranch()">
                                <span class="grid-btn-icon">+</span>
                                <span class="grid-btn-label">New</span>
                            </div>
                            <div class="grid-btn" onclick="promptSwitchBranch()">
                                <span class="grid-btn-icon">⇄</span>
                                <span class="grid-btn-label">Switch</span>
                            </div>
                            <div class="grid-btn" onclick="promptMergeBranch()">
                                <span class="grid-btn-icon">⑃</span>
                                <span class="grid-btn-label">Merge</span>
                            </div>
                            <div class="grid-btn" onclick="promptDeleteBranch()">
                                <span class="grid-btn-icon">🗑</span>
                                <span class="grid-btn-label">Delete</span>
                            </div>
                        </div>
                    </div>

                    <!-- Chat Tab -->
                    <div id="chat" class="tab-content">
                        <div style="padding: 10px; margin-bottom: 10px; background: var(--hover-bg); border-radius: 6px; text-align: center; font-size: 0.9em; color: var(--text-secondary); border: 1px dashed var(--border-color);">
                            🚀 <b>Coming Soon:</b> We will add a full Assistant in v2!
                        </div>
                        <div id="chat-history"></div>
                        <div style="position: relative;">
                            <textarea id="chat-input" class="input" rows="3" placeholder="Ask about git commands, errors, or best practices..." style="resize: vertical; min-height: 60px;"></textarea>
                            <button class="btn" onclick="sendChat()">Send Message</button>
                        </div>
                    </div>

                    <!-- Profile Tab -->
                    <div id="profile" class="tab-content">
                        <div style="display: flex; align-items: center; margin-bottom: 20px;">
                            <button class="btn" style="width: auto; padding: 8px 12px; margin-right: 15px; background: var(--card-bg); border: 1px solid var(--border-color); color: var(--text-primary);" onclick="openTab('dashboard')">← Back</button>
                            <h3 style="margin: 0; font-size: 1.1em;">User Profile</h3>
                        </div>

                        <div class="profile-header" style="background: var(--hover-bg); border: none;">
                            <div class="avatar" id="profile-avatar">G</div>
                            <div class="user-info">
                                <span class="user-name" id="profile-name">Guest User</span>
                                <span class="user-email" id="profile-email">Not logged in</span>
                            </div>
                        </div>

                        <div class="section-title">Actions</div>
                        <button class="btn" style="background-color: #d73a49; margin-bottom: 15px;" onclick="logoutGitHub()">Logout</button>
                    </div>
                </div>

				<script>
                    const vscode = acquireVsCodeApi();

                    function openTab(tabName) {
                        document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
                        document.querySelectorAll('.tab-link').forEach(el => el.classList.remove('active'));
                        document.getElementById(tabName).classList.add('active');
                        
                        // Find button
                        const btns = document.querySelectorAll('.tab-link');
                        btns.forEach(btn => {
                            if(btn.innerText.toLowerCase() === tabName) {
                                btn.classList.add('active');
                            }
                        });

                        if (tabName === 'profile') {
                            vscode.postMessage({ type: 'get-settings' });
                        }
                    }

                    function refreshStats() {
                        vscode.postMessage({ type: 'refresh-stats' });
                    }

                    function connectGitHub() {
                        vscode.postMessage({ type: 'login-device-flow' });
                    }

                    function logoutGitHub() {
                        vscode.postMessage({ type: 'logout-github' });
                    }

                    function copyCodeAndOpen() {
                        const code = document.getElementById('device-user-code').innerText;
                        const url = document.getElementById('device-verification-uri').getAttribute('href');
                        
                        // Copy to clipboard
                        const el = document.createElement('textarea');
                        el.value = code;
                        document.body.appendChild(el);
                        el.select();
                        document.execCommand('copy');
                        document.body.removeChild(el);
                        
                        vscode.postMessage({ type: 'onInfo', value: 'Code copied to clipboard!' });
                        vscode.postMessage({ type: 'open-external', value: url });
                    }

                    function cancelLogin() {
                        document.getElementById('device-code-view').style.display = 'none';
                        document.getElementById('setup-view').style.display = 'block';
                    }

                    function saveSettings(source) {
                        const prefix = source === 'setup' ? 'setup-' : 'profile-';
                        // Profile view no longer has these inputs, so only process if they exist (setup mode)
                        const patEl = document.getElementById(prefix + 'pat');
                        if (!patEl) return; // Exit if elements don't exist

                        const pat = patEl.value;
                        const apiKey = document.getElementById(prefix + 'apikey').value;
                        const provider = document.getElementById(prefix + 'provider').value;
                        const baseUrl = document.getElementById(prefix + 'baseurl').value;
                        const modelName = document.getElementById(prefix + 'model').value;

                        vscode.postMessage({
                            type: 'save-settings',
                            value: { pat, apiKey, provider, baseUrl, modelName }
                        });
                    }

                    function promptCommit() {
                        // Simple prompt for now, could be a modal
                        const msg = prompt("Enter commit message:");
                        if(msg) gitAction('commit', { message: msg });
                    }

                    function promptRemote() {
                        const current = document.getElementById('repo-remote').innerText;
                        const url = prompt("Enter new remote URL:", current !== 'No origin' ? current : '');
                        if(url) gitAction('set-remote', { url });
                    }

                    function promptCreateBranch() {
                        const name = prompt("Enter new branch name:");
                        if(name) gitAction('create-branch', { name });
                    }

                    function promptSwitchBranch() {
                        const name = prompt("Enter branch name to switch to:");
                        if(name) gitAction('switch-branch', { name });
                    }

                    function promptDeleteBranch() {
                        const name = prompt("Enter branch name to delete:");
                        if(name) gitAction('delete-branch', { name });
                    }

                    function promptMergeBranch() {
                        const name = prompt("Enter branch name to merge into current:");
                        if(name) gitAction('merge-branch', { name });
                    }

                    function gitAction(action, payload = {}) {
                        vscode.postMessage({ type: 'git-action', action, payload });
                    }

                    function sendChat() {
                        const input = document.getElementById('chat-input');
                        const value = input.value;
                        if(!value) return;
                        vscode.postMessage({ type: 'chat-query', value });
                        input.value = '';
                    }

                    window.addEventListener('message', event => {
                        const message = event.data;
                        switch (message.type) {
                            case 'show-setup':
                                document.getElementById('setup-view').style.display = 'block';
                                document.getElementById('main-view').style.display = 'none';
                                document.getElementById('device-code-view').style.display = 'none';
                                break;
                            case 'show-device-code':
                                document.getElementById('setup-view').style.display = 'none';
                                document.getElementById('main-view').style.display = 'none';
                                document.getElementById('device-code-view').style.display = 'block';
                                
                                document.getElementById('device-user-code').innerText = message.value.user_code;
                                document.getElementById('device-verification-uri').innerText = message.value.verification_uri;
                                document.getElementById('device-verification-uri').setAttribute('href', message.value.verification_uri);
                                break;
                            case 'show-dashboard':
                                document.getElementById('setup-view').style.display = 'none';
                                document.getElementById('device-code-view').style.display = 'none';
                                document.getElementById('main-view').style.display = 'block';
                                break;
                            case 'update-stats':
                                document.getElementById('stat-branch').innerText = message.value.branch;
                                document.getElementById('stat-status').innerText = message.value.status;
                                document.getElementById('repo-name').innerText = message.value.repoName;
                                document.getElementById('repo-path').innerText = message.value.repoPath;
                                document.getElementById('repo-remote').innerText = message.value.remote;
                                
                                if(message.value.user) {
                                    document.getElementById('user-name').innerText = message.value.user.name;
                                    document.getElementById('user-email').innerText = message.value.user.email;
                                    
                                    // Update Profile View details as well
                                    const pName = document.getElementById('profile-name');
                                    const pEmail = document.getElementById('profile-email');
                                    const pAvatar = document.getElementById('profile-avatar');
                                    
                                    if(pName) pName.innerText = message.value.user.name;
                                    if(pEmail) pEmail.innerText = message.value.user.email;

                                    const avatarEl = document.getElementById('user-avatar');
                                    if (message.value.user.avatar) {
                                        avatarEl.innerText = '';
                                        avatarEl.style.backgroundImage = \`url('\${message.value.user.avatar}')\`;
                                        avatarEl.style.backgroundSize = 'cover';
                                        avatarEl.style.backgroundPosition = 'center';
                                        
                                        if(pAvatar) {
                                            pAvatar.innerText = '';
                                            pAvatar.style.backgroundImage = \`url('\${message.value.user.avatar}')\`;
                                            pAvatar.style.backgroundSize = 'cover';
                                            pAvatar.style.backgroundPosition = 'center';
                                        }
                                    } else {
                                        const initial = message.value.user.name.charAt(0).toUpperCase();
                                        avatarEl.innerText = initial;
                                        if(pAvatar) pAvatar.innerText = initial;
                                    }
                                    
                                    if (message.value.user.followers !== undefined) {
                                        document.getElementById('gh-stats-row').style.display = 'flex';
                                        document.getElementById('gh-repos-count').innerText = message.value.user.repos;
                                        document.getElementById('gh-contribs-count').innerText = message.value.user.contributions;
                                    }
                                }
                                break;
                            case 'add-chat-message':
                                const history = document.getElementById('chat-history');
                                const div = document.createElement('div');
                                div.className = 'chat-msg ' + message.value.role;
                                div.innerText = message.value.content;
                                history.appendChild(div);
                                history.scrollTop = history.scrollHeight;
                                break;
                            case 'populate-settings':
                                const pProvider = document.getElementById('profile-provider');
                                if (pProvider) {
                                    pProvider.value = message.value.provider || 'OpenAI';
                                    document.getElementById('profile-baseurl').value = message.value.baseUrl || '';
                                    document.getElementById('profile-model').value = message.value.modelName || '';
                                }
                                break;
                        }
                    });
				</script>
			</body>
			</html>`;
  }
}
