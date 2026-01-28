/**
 * Model selection functionality for Aware extension
 * Queries available language models and lets users choose
 */

import * as vscode from 'vscode';
import { getConfig, updateConfig } from './config';

interface ModelInfo {
    id: string;
    family: string;
    vendor: string;
    name: string;
    isPremium: boolean;
}

// Included models that do NOT consume premium requests on paid Copilot plans
// Source: https://docs.github.com/en/copilot/managing-copilot/monitoring-usage-and-entitlements/about-premium-requests
// All other models ARE premium and consume premium requests
const INCLUDED_MODEL_FAMILIES = ['gpt-4.1', 'gpt-4o', 'gpt-5-mini', 'gpt-5 mini'];

export class ModelSelector {
    private outputChannel: vscode.OutputChannel;
    private cachedModels: vscode.LanguageModelChat[] = [];

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }

    /**
     * Query all available Copilot models
     */
    async getAvailableModels(): Promise<vscode.LanguageModelChat[]> {
        try {
            const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
            this.cachedModels = models;
            this.log(`Found ${models.length} available models`);
            return models;
        } catch (error) {
            this.log(`Error fetching models: ${error}`);
            return [];
        }
    }

    /**
     * Check if a model is premium (consumes premium requests on paid plans)
     * Included models: GPT-5 mini, GPT-4.1, GPT-4o (these do NOT consume premium requests)
     * All other models ARE premium
     */
    isPremiumModel(family: string): boolean {
        const lowerFamily = family.toLowerCase();
        // A model is premium if it's NOT in the included list
        const isIncluded = INCLUDED_MODEL_FAMILIES.some(included => 
            lowerFamily.includes(included.toLowerCase())
        );
        return !isIncluded;
    }

    /**
     * Get the configured model, or select the first available one
     */
    async getConfiguredModel(): Promise<vscode.LanguageModelChat | undefined> {
        const config = getConfig();
        const models = await this.getAvailableModels();

        if (models.length === 0) {
            this.log('No models available');
            return undefined;
        }

        // Try to match by exact model ID from preferredModel setting
        if (config.preferredModel) {
            const exactMatch = models.find(m => m.id === config.preferredModel);
            if (exactMatch) {
                this.log(`Using preferred model: ${exactMatch.id}`);
                return exactMatch;
            }
            this.log(`Preferred model "${config.preferredModel}" not found, using default`);
        }

        // Default to GPT-4.1 if available, otherwise first available model
        const gpt41 = models.find(m => m.family.toLowerCase().includes('gpt-4.1') && !m.family.toLowerCase().includes('mini'));
        if (gpt41) {
            this.log(`Using default model (GPT-4.1): ${gpt41.id}`);
            return gpt41;
        }

        // Fallback to first available model
        this.log(`GPT-4.1 not found, using first available: ${models[0].id}`);
        return models[0];
    }

    /**
     * Show a QuickPick for model selection
     */
    async showModelPicker(): Promise<void> {
        const models = await this.getAvailableModels();

        if (models.length === 0) {
            vscode.window.showWarningMessage('No language models available. Make sure GitHub Copilot is installed and signed in.');
            return;
        }

        const config = getConfig();
        const currentModel = await this.getConfiguredModel();
        const currentModelId = currentModel?.id || config.preferredModel;

        interface ModelQuickPickItem extends vscode.QuickPickItem {
            modelId?: string;
            modelFamily?: string;
            isSeparator?: boolean;
        }

        // Separate included and premium models
        const includedModels = models.filter(m => !this.isPremiumModel(m.family));
        const premiumModels = models.filter(m => this.isPremiumModel(m.family));

        const createItem = (model: vscode.LanguageModelChat): ModelQuickPickItem => {
            const isCurrent = model.id === currentModelId;
            return {
                label: isCurrent ? `$(check) ${model.name || model.family}` : model.name || model.family,
                description: isCurrent ? 'Currently selected' : undefined,
                modelId: model.id,
                modelFamily: model.family
            };
        };

        const items: ModelQuickPickItem[] = [];

        // Included models section
        if (includedModels.length > 0) {
            items.push({ label: 'Included Models', kind: vscode.QuickPickItemKind.Separator } as ModelQuickPickItem);
            items.push(...includedModels.map(createItem));
        }

        // Premium models section
        if (premiumModels.length > 0) {
            items.push({ label: 'Premium Models (count against quota)', kind: vscode.QuickPickItemKind.Separator } as ModelQuickPickItem);
            items.push(...premiumModels.map(createItem));
        }

        const pick = await vscode.window.showQuickPick(items, {
            title: 'Select Language Model',
            placeHolder: currentModel ? `Current: ${currentModel.name || currentModel.family}` : 'Select a model',
            matchOnDescription: true
        });

        if (pick && pick.modelId) {
            await updateConfig('preferredModel', pick.modelId);
            
            const isPremium = this.isPremiumModel(pick.modelFamily || '');
            const modelName = pick.label.replace(/^\$\([^)]+\)\s*/, '');
            
            // Only warn about premium models since that affects quota
            if (isPremium) {
                vscode.window.showWarningMessage(
                    `${modelName} is a premium model and will count against your Copilot quota.`
                );
            }
        }
    }

    private log(message: string): void {
        const timestamp = new Date().toISOString();
        this.outputChannel.appendLine(`[${timestamp}] [ModelSelector] ${message}`);
    }
}
