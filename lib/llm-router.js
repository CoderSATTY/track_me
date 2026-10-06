/**
 * TrackMe Multi-Provider LLM Router
 * Provides unified interface with automatic fallback across free-tier AI inference providers:
 * Gemini, Groq, Cerebras, OpenRouter, SambaNova, Together AI, and Cloudflare Workers AI.
 */

export const PROVIDERS = {
  gemini: {
    id: 'gemini',
    name: 'Google AI Studio / Gemini',
    defaultModel: 'gemini-2.5-flash',
    altModel: 'gemini-1.5-flash',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
    description: 'Very high daily quota on eligible Flash models. Multimodal PDF support.',
    tierBadge: 'Best overall free tier'
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    defaultModel: 'llama-3.3-70b-versatile',
    altModel: 'mixtral-8x7b-32768',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    description: '~1,000 req/day on major free models. Ultra-low latency.',
    tierBadge: 'Best latency (<300ms)'
  },
  cerebras: {
    id: 'cerebras',
    name: 'Cerebras',
    defaultModel: 'llama-3.3-70b',
    altModel: 'llama3.1-8b',
    endpoint: 'https://api.cerebras.ai/v1/chat/completions',
    description: '~1M tokens/day reported for open models. High throughput.',
    tierBadge: 'Best token throughput'
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
    altModel: 'google/gemini-2.0-flash-exp:free',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    description: '50 req/day on free models aggregator.',
    tierBadge: 'Universal fallback'
  },
  sambanova: {
    id: 'sambanova',
    name: 'SambaNova',
    defaultModel: 'Meta-Llama-3.1-70B-Instruct',
    altModel: 'Meta-Llama-3.1-8B-Instruct',
    endpoint: 'https://api.sambanova.ai/v1/chat/completions',
    description: 'Free developer tier with full precision open models.',
    tierBadge: 'Large open models'
  },
  together: {
    id: 'together',
    name: 'Together AI',
    defaultModel: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
    altModel: 'mistralai/Mixtral-8x7B-Instruct-v0.1',
    endpoint: 'https://api.together.xyz/v1/chat/completions',
    description: 'High-speed open model inference.',
    tierBadge: 'Fast experimentation'
  },
  cloudflare: {
    id: 'cloudflare',
    name: 'Cloudflare Workers AI',
    defaultModel: '@cf/meta/llama-3.1-8b-instruct',
    endpoint: 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/@cf/meta/llama-3.1-8b-instruct',
    description: 'Serverless edge AI with free daily allocation.',
    tierBadge: 'Edge fallback'
  }
};

export class LLMRouter {
  /**
   * Test API key connectivity for a specific provider
   */
  static async testConnection(providerId, apiKey, extraConfig = {}) {
    try {
      const response = await this.callProvider(providerId, apiKey, {
        systemPrompt: 'You are an API health checker.',
        userPrompt: 'Respond strictly with the single word: READY',
        jsonMode: false,
        maxTokens: 20,
        extraConfig
      });
      return {
        success: true,
        message: 'Connection verified successfully! Response: ' + response.text.trim().substring(0, 30),
        provider: providerId
      };
    } catch (err) {
      return {
        success: false,
        message: err.message || 'Connection failed',
        provider: providerId
      };
    }
  }

  /**
   * Execute prompt with intelligent fallback across available providers
   */
  static async executeWithFallback(promptOptions, apiKeys, activeProviderId = 'gemini', fallbackOrder = []) {
    // Compile ordered list of providers to try
    const candidates = [activeProviderId, ...fallbackOrder.filter(p => p !== activeProviderId)];
    const availableProviders = candidates.filter(id => apiKeys[id] && apiKeys[id].trim().length > 0);

    if (availableProviders.length === 0) {
      throw new Error('No API keys configured! Please add at least one API key in the TrackMe Settings (Options) page.');
    }

    const errors = [];
    for (const providerId of availableProviders) {
      try {
        const apiKey = apiKeys[providerId];
        const extraConfig = apiKeys[`${providerId}_extra`] || {};
        const result = await this.callProvider(providerId, apiKey, { ...promptOptions, extraConfig });
        return {
          ...result,
          usedProvider: providerId,
          fallbackOccurred: providerId !== activeProviderId,
          attempts: errors.length + 1
        };
      } catch (err) {
        console.warn(`[TrackMe Router] Provider ${providerId} failed:`, err.message);
        errors.push(`${providerId}: ${err.message}`);
        // Continue to next available provider in fallback sequence
      }
    }

    throw new Error(`All configured AI providers failed:\n${errors.join('\n')}`);
  }

  /**
   * Dispatch request to specific provider
   */
  static async callProvider(providerId, apiKey, options) {
    const { systemPrompt = '', userPrompt, jsonMode = false, pdfBase64 = null, maxTokens = 4096, extraConfig = {} } = options;

    switch (providerId) {
      case 'gemini':
        return this._callGemini(apiKey, systemPrompt, userPrompt, jsonMode, pdfBase64, maxTokens);
      case 'groq':
        return this._callOpenAICompatible(apiKey, PROVIDERS.groq.endpoint, PROVIDERS.groq.defaultModel, systemPrompt, userPrompt, jsonMode, maxTokens);
      case 'cerebras':
        return this._callOpenAICompatible(apiKey, PROVIDERS.cerebras.endpoint, PROVIDERS.cerebras.defaultModel, systemPrompt, userPrompt, jsonMode, maxTokens);
      case 'openrouter':
        return this._callOpenRouter(apiKey, PROVIDERS.openrouter.defaultModel, systemPrompt, userPrompt, jsonMode, maxTokens);
      case 'sambanova':
        return this._callOpenAICompatible(apiKey, PROVIDERS.sambanova.endpoint, PROVIDERS.sambanova.defaultModel, systemPrompt, userPrompt, jsonMode, maxTokens);
      case 'together':
        return this._callOpenAICompatible(apiKey, PROVIDERS.together.endpoint, PROVIDERS.together.defaultModel, systemPrompt, userPrompt, jsonMode, maxTokens);
      case 'cloudflare':
        return this._callCloudflare(apiKey, extraConfig.accountId, systemPrompt, userPrompt, maxTokens);
      default:
        throw new Error(`Unsupported provider: ${providerId}`);
    }
  }

  /**
   * Google Gemini REST API
   */
  static async _callGemini(apiKey, systemPrompt, userPrompt, jsonMode, pdfBase64, maxTokens) {
    const model = PROVIDERS.gemini.defaultModel;
    const url = `${PROVIDERS.gemini.endpoint}/${model}:generateContent?key=${apiKey}`;

    const parts = [];
    if (pdfBase64) {
      parts.push({
        inlineData: {
          mimeType: 'application/pdf',
          data: pdfBase64
        }
      });
    }
    parts.push({ text: userPrompt });

    const body = {
      contents: [{ role: 'user', parts }]
    };

    if (systemPrompt) {
      body.systemInstruction = {
        parts: [{ text: systemPrompt }]
      };
    }

    body.generationConfig = {
      maxOutputTokens: maxTokens,
      temperature: 0.1
    };

    if (jsonMode) {
      body.generationConfig.responseMimeType = 'application/json';
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.[0]?.text || '';
    return { text, raw: data };
  }

  /**
   * Generic OpenAI-compatible chat completions (Groq, Cerebras, SambaNova, Together)
   */
  static async _callOpenAICompatible(apiKey, endpoint, model, systemPrompt, userPrompt, jsonMode, maxTokens) {
    const messages = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: userPrompt });

    const body = {
      model,
      messages,
      max_tokens: maxTokens,
      temperature: 0.1
    };

    if (jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`API error (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';
    return { text, raw: data };
  }

  /**
   * OpenRouter API with specific routing headers
   */
  static async _callOpenRouter(apiKey, model, systemPrompt, userPrompt, jsonMode, maxTokens) {
    const messages = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: userPrompt });

    const body = {
      model,
      messages,
      max_tokens: maxTokens,
      temperature: 0.1
    };

    if (jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    const response = await fetch(PROVIDERS.openrouter.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://trackme.chrome-extension',
        'X-Title': 'TrackMe Chrome Extension'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenRouter API error (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';
    return { text, raw: data };
  }

  /**
   * Cloudflare Workers AI
   */
  static async _callCloudflare(apiToken, accountId, systemPrompt, userPrompt, maxTokens) {
    if (!accountId) {
      throw new Error('Cloudflare Workers AI requires Account ID in extra configuration.');
    }
    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/meta/llama-3.1-8b-instruct`;

    const messages = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: userPrompt });

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ messages, max_tokens: maxTokens })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Cloudflare Workers AI error (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const text = data.result?.response || '';
    return { text, raw: data };
  }

  /**
   * Helper to clean and parse JSON returned from LLMs
   */
  static extractJson(responseText) {
    if (!responseText || typeof responseText !== 'string') return null;
    let cleaned = responseText.trim();
    // Remove markdown code fences ```json ... ```
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    }
    try {
      return JSON.parse(cleaned);
    } catch {
      // Find outermost { ... } or [ ... ]
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        try {
          return JSON.parse(cleaned.substring(firstBrace, lastBrace + 1));
        } catch {
          return null;
        }
      }
      return null;
    }
  }
}
