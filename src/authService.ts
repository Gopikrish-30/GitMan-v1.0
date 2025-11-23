import * as vscode from 'vscode';
import * as https from 'https';

const GITHUB_CLIENT_ID = 'YOUR CLIENT ID'; // TODO: Replace with your OAuth App Client ID
const SCOPES = 'repo read:org user:email workflow';

export class AuthService {
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    public async initiateDeviceFlow(): Promise<{ device_code: string; user_code: string; verification_uri: string; expires_in: number; interval: number }> {
        const params = new URLSearchParams();
        params.append('client_id', GITHUB_CLIENT_ID);
        params.append('scope', SCOPES);

        const response = await this.postRequest('https://github.com/login/device/code', params, { 'Accept': 'application/json' });
        return response as any;
    }

    public async pollForToken(device_code: string, interval: number): Promise<string> {
        const params = new URLSearchParams();
        params.append('client_id', GITHUB_CLIENT_ID);
        params.append('device_code', device_code);
        params.append('grant_type', 'urn:ietf:params:oauth:grant-type:device_code');

        return new Promise((resolve, reject) => {
            const poll = async () => {
                try {
                    const response: any = await this.postRequest('https://github.com/login/oauth/access_token', params, { 'Accept': 'application/json' });

                    if (response.access_token) {
                        resolve(response.access_token);
                    } else if (response.error === 'authorization_pending') {
                        setTimeout(poll, (interval + 1) * 1000); // Add 1s buffer
                    } else if (response.error === 'slow_down') {
                        setTimeout(poll, (response.interval + 1) * 1000);
                    } else if (response.error === 'expired_token') {
                        reject(new Error('Token expired'));
                    } else if (response.error === 'access_denied') {
                        reject(new Error('Access denied'));
                    } else {
                        reject(new Error(response.error_description || 'Unknown error'));
                    }
                } catch (error) {
                    reject(error);
                }
            };
            poll();
        });
    }

    public async getUserProfile(token: string): Promise<any> {
        // Using GraphQL as requested
        const query = `
        query {
            viewer {
                login
                name
                email
                avatarUrl
                createdAt
                followers { totalCount }
                following { totalCount }
                repositories(ownerAffiliations: OWNER) { totalCount }
                organizations(first: 10) { nodes { login avatarUrl } }
                contributionsCollection { contributionCalendar { totalContributions } }
            }
        }`;

        const response: any = await this.postRequest('https://api.github.com/graphql', JSON.stringify({ query }), {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'User-Agent': 'VSCode-GitHelper'
        });

        if (response.errors) {
            throw new Error(response.errors[0].message);
        }

        const viewer = response.data.viewer;
        if (!viewer.email) {
            try {
                const emails: any = await this.makeRequest('https://api.github.com/user/emails', 'GET', null, {
                    'Authorization': `Bearer ${token}`,
                    'User-Agent': 'VSCode-GitHelper'
                });
                if (Array.isArray(emails)) {
                    const primary = emails.find((e: any) => e.primary);
                    if (primary) {
                        viewer.email = primary.email;
                    }
                }
            } catch (e) {
                console.error("Failed to fetch emails via REST", e);
            }
        }

        return viewer;
    }

    private postRequest(url: string, body: any, headers: any = {}): Promise<any> {
        return this.makeRequest(url, 'POST', body, headers);
    }

    private makeRequest(url: string, method: string, body: any, headers: any = {}): Promise<any> {
        return new Promise((resolve, reject) => {
            const urlObj = new URL(url);
            const options = {
                hostname: urlObj.hostname,
                path: urlObj.pathname + urlObj.search,
                method: method,
                headers: headers
            };

            const req = https.request(options, (res: any) => {
                let data = '';
                res.on('data', (chunk: any) => {
                    data += chunk;
                });
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(e);
                    }
                });
            });

            req.on('error', (e: any) => {
                reject(e);
            });

            if (body) {
                req.write(body.toString());
            }
            req.end();
        });
    }
}
