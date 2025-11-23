import * as vscode from "vscode";

export class AIService {
  private static _context: vscode.ExtensionContext;

  public static initialize(context: vscode.ExtensionContext) {
    this._context = context;
  }

  private async getApiKey(): Promise<string | undefined> {
    if (!AIService._context) {
      throw new Error("AIService not initialized");
    }
    return await AIService._context.secrets.get("gitHelper.apiKey");
  }

  public async getCompletion(prompt: string): Promise<string> {
    const config = vscode.workspace.getConfiguration("gitHelper");
    const provider = config.get<string>("apiProvider");
    const baseUrl = config.get<string>("apiBaseUrl");
    const model = config.get<string>("modelName");
    const apiKey = await this.getApiKey();

    if (!apiKey) {
      throw new Error("API Key not set. Please run 'Git Helper: Set API Key' command.");
    }

    if (!baseUrl) {
        throw new Error("Base URL not configured.");
    }

    // Construct the endpoint. Assume OpenAI compatible for now as it's the standard for "drop-in" replacements like Grok/GLM via adapters or their own compatible endpoints.
    // If baseUrl ends with slash, remove it.
    const cleanBaseUrl = baseUrl.replace(/\/$/, "");
    const url = `${cleanBaseUrl}/chat/completions`;

    const messages = [
        { role: "system", content: "You are a helpful Git expert assistant." },
        { role: "user", content: prompt }
    ];

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: model,
                messages: messages,
                temperature: 0.7
            })
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`API Request Failed: ${response.status} ${response.statusText} - ${text}`);
        }

        const data = await response.json() as any;
        
        if (data.choices && data.choices.length > 0 && data.choices[0].message) {
            return data.choices[0].message.content;
        } else {
            return "No response from AI.";
        }

    } catch (error: any) {
        throw new Error(`AI Error: ${error.message}`);
    }
  }
}
