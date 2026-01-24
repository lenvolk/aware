/**
 * Document service that fetches related documents from Work IQ MCP server
 */

import * as vscode from 'vscode';
import { RelatedDocument } from './types';

export class DocumentService {
    private documents: RelatedDocument[] = [];
    private lastRefresh: Date | null = null;
    private currentRepoName: string | null = null;
    private outputChannel: vscode.OutputChannel;
    private _onDocumentsUpdated = new vscode.EventEmitter<RelatedDocument[]>();
    readonly onDocumentsUpdated = this._onDocumentsUpdated.event;
    private _onLoadingStarted = new vscode.EventEmitter<void>();
    readonly onLoadingStarted = this._onLoadingStarted.event;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }

    async fetchRelatedDocuments(): Promise<RelatedDocument[]> {
        const repoName = this.getCurrentRepoName();
        this.currentRepoName = repoName;
        
        if (!repoName) {
            this.log('No repository detected in workspace');
            this.documents = [];
            this._onDocumentsUpdated.fire(this.documents);
            return this.documents;
        }

        this.log(`Fetching related documents for: ${repoName}`);
        this._onLoadingStarted.fire();

        try {
            const query = this.buildDocumentQuery(repoName);
            const response = await this.queryWorkIQ(query);

            if (response.error) {
                this.log(`Error from Work IQ: ${response.error}`);
                return this.documents;
            }

            if (response.rawResponse) {
                const parsed = this.parseDocumentResponse(response.rawResponse);
                this.log(`Parsed ${parsed.length} documents from response`);
                this.documents = parsed;
                this.lastRefresh = new Date();
                this._onDocumentsUpdated.fire(this.documents);
            }

            return this.documents;
        } catch (error) {
            this.log(`Failed to fetch documents: ${error}`);
            throw error;
        }
    }

    private getCurrentRepoName(): string | null {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return null;
        }

        // Use the first workspace folder name as the repo name
        return workspaceFolders[0].name;
    }

    private buildDocumentQuery(repoName: string): string {
        return `What documents or files are related to the repository "${repoName}"? Return as JSON array with fields: title, url, lastModified (ISO 8601 if available), type (e.g., "Word", "Excel", "PowerPoint", "PDF", "OneNote", "Web Page"). Limit to the 10 most relevant documents.`;
    }

    private async queryWorkIQ(question: string): Promise<{ error?: string; rawResponse?: string }> {
        this.log(`Querying Work IQ: ${question}`);

        try {
            const workIQTool = vscode.lm.tools.find(tool => {
                const name = tool.name.toLowerCase();
                return name.includes('workiq') ||
                    name.includes('work_iq') ||
                    name.includes('ask_work_iq') ||
                    name.includes('mcp_workiq');
            });

            if (!workIQTool) {
                this.log('Work IQ tool not found');
                return { error: 'Work IQ MCP server not available.' };
            }

            const cancellationTokenSource = new vscode.CancellationTokenSource();
            const result = await vscode.lm.invokeTool(
                workIQTool.name,
                {
                    input: { question },
                    toolInvocationToken: undefined
                },
                cancellationTokenSource.token
            );

            let fullResponse = '';
            for (const part of result.content) {
                if (part instanceof vscode.LanguageModelTextPart) {
                    fullResponse += part.value;
                }
            }

            this.log(`Work IQ response received (${fullResponse.length} chars)`);
            return { rawResponse: fullResponse };
        } catch (error) {
            this.log(`Work IQ query error: ${error}`);
            return { error: String(error) };
        }
    }

    private parseDocumentResponse(response: string): RelatedDocument[] {
        const documents: RelatedDocument[] = [];

        this.log(`Parsing document response (${response.length} chars)`);

        // Extract real URLs from markdown footnotes: [1](https://...)
        const realUrls: string[] = [];
        const footnoteMatches = response.matchAll(/\[(\d+)\]\((https?:\/\/[^)]+)\)/g);
        for (const match of footnoteMatches) {
            const index = parseInt(match[1], 10) - 1;
            realUrls[index] = match[2];
        }
        this.log(`Found ${realUrls.length} real URLs in footnotes`);

        // Try to parse as JSON
        try {
            // Remove markdown code fences if present
            let jsonContent = response;
            const codeFenceMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (codeFenceMatch) {
                jsonContent = codeFenceMatch[1].trim();
            }

            const jsonMatch = jsonContent.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]) as Array<{
                    title: string;
                    url: string;
                    lastModified?: string;
                    type: string;
                }>;

                for (let i = 0; i < parsed.length; i++) {
                    const item = parsed[i];
                    
                    // Use real URL from footnotes, falling back to JSON field
                    const url = realUrls[i] || item.url;

                    const doc: RelatedDocument = {
                        id: `doc-${i}-${Date.now()}`,
                        title: item.title,
                        url,
                        lastModified: item.lastModified ? new Date(item.lastModified) : undefined,
                        type: item.type || 'Document'
                    };

                    documents.push(doc);
                    this.log(`  [${i + 1}] "${item.title}" | ${item.type} | ${url.substring(0, 50)}...`);
                }
            }
        } catch (e) {
            this.log(`JSON parsing failed: ${e}`);
        }

        return documents;
    }

    getCachedDocuments(): RelatedDocument[] {
        return this.documents;
    }

    getCurrentRepoNameCached(): string | null {
        return this.currentRepoName;
    }

    getLastRefresh(): Date | null {
        return this.lastRefresh;
    }

    private log(message: string): void {
        const timestamp = new Date().toISOString();
        this.outputChannel.appendLine(`[${timestamp}] [DocumentService] ${message}`);
    }

    dispose(): void {
        this._onDocumentsUpdated.dispose();
        this._onLoadingStarted.dispose();
    }
}
