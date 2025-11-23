import * as vscode from "vscode";
import * as cp from "child_process";

export class GitService {
  private workspaceRoot: string | undefined;

  constructor() {
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
      this.workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
    }
  }

  private async exec(command: string): Promise<string> {
    if (!this.workspaceRoot) {
      throw new Error("No workspace folder open");
    }

    return new Promise((resolve, reject) => {
      cp.exec(command, { cwd: this.workspaceRoot }, (err, stdout, stderr) => {
        if (err) {
          reject(new Error(stderr || err.message));
          return;
        }
        resolve(stdout.trim());
      });
    });
  }

  public async getRepoName(): Promise<string> {
    if (!this.workspaceRoot) {
      return "No Repo";
    }
    // Try to get from remote origin first
    try {
        const remoteUrl = await this.exec("git remote get-url origin");
        // Extract name from URL (e.g., https://github.com/user/repo.git -> repo)
        const match = remoteUrl.match(/\/([^\/]+?)(\.git)?$/);
        if (match) {
          return match[1];
        }
    } catch (e) {}
    
    // Fallback to folder name
    return this.workspaceRoot.split(/[\\/]/).pop() || "Unknown";
  }

  public async getRepoPath(): Promise<string> {
      return this.workspaceRoot || "No workspace open";
  }

  public async getStatus(): Promise<string> {
    if (!this.workspaceRoot) {
      return "No Repo";
    }
    try {
        const status = await this.exec("git status --short");
        return status ? status : "Clean";
    } catch (e) {
        return "Error getting status";
    }
  }

  public async getCurrentBranch(): Promise<string> {
    if (!this.workspaceRoot) {
      return "No Repo";
    }
    try {
        return await this.exec("git rev-parse --abbrev-ref HEAD");
    } catch (e) {
        return "Unknown";
    }
  }

  public async getRemote(): Promise<string> {
    if (!this.workspaceRoot) {
      return "No Repo";
    }
    try {
        const remotes = await this.exec("git remote -v");
        // Parse first origin fetch
        const match = remotes.match(/origin\s+(.*?)\s+\(fetch\)/);
        return match ? match[1] : "No origin";
    } catch (e) {
        return "Unknown";
    }
  }

  public async commit(message: string): Promise<string> {
    // Escape quotes in message
    const escapedMessage = message.replace(/"/g, '\\"');
    return await this.exec(`git commit -m "${escapedMessage}"`);
  }

  public async push(): Promise<string> {
    return await this.exec("git push");
  }

  public async pull(): Promise<string> {
    return await this.exec("git pull");
  }

  public async fetch(): Promise<string> {
    return await this.exec("git fetch");
  }

  public async stash(): Promise<string> {
    return await this.exec("git stash");
  }

  public async addAll(): Promise<string> {
    return await this.exec("git add .");
  }

  public async updateRemoteUrlWithToken(token: string): Promise<string> {
      try {
          const remoteUrl = await this.exec("git remote get-url origin");
          // Check if it's an HTTPS URL
          if (remoteUrl.startsWith("https://")) {
              // Remove existing auth if any
              const cleanUrl = remoteUrl.replace(/https:\/\/.*?@/, "https://");
              const newUrl = cleanUrl.replace("https://", `https://${token}@`);
              await this.exec(`git remote set-url origin ${newUrl}`);
              return "Remote URL updated with token";
          }
          return "Remote URL is not HTTPS, skipping token update";
      } catch (e) {
          return "Failed to update remote URL";
      }
  }

  public async setRemote(url: string): Promise<string> {
    try {
        // Check if origin exists
        try {
            await this.exec("git remote get-url origin");
            // If it exists, set-url
            await this.exec(`git remote set-url origin ${url}`);
        } catch (e) {
            // If it doesn't exist, add it
            await this.exec(`git remote add origin ${url}`);
        }
        return "Remote URL updated";
    } catch (e: any) {
        throw new Error(`Failed to set remote: ${e.message}`);
    }
  }

  public async getBranches(): Promise<string[]> {
    try {
      const output = await this.exec("git branch --format='%(refname:short)'");
      return output.split('\n').map(b => b.trim()).filter(b => b.length > 0);
    } catch (e) {
      return [];
    }
  }

  public async createBranch(branchName: string): Promise<string> {
    return await this.exec(`git checkout -b ${branchName}`);
  }

  public async deleteBranch(branchName: string): Promise<string> {
    return await this.exec(`git branch -D ${branchName}`);
  }

  public async switchBranch(branchName: string): Promise<string> {
    return await this.exec(`git checkout ${branchName}`);
  }

  public async mergeBranch(branchName: string): Promise<string> {
    return await this.exec(`git merge ${branchName}`);
  }
}
