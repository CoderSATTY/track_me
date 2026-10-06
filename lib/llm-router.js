/**
 * TrackMe Multi-Provider LLM Router
 * Supports Google Gemini (gemini-3.8-flash), Groq, and Cerebras with automatic fallback.
 */

export const PROVIDERS = {
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    defaultModel: 'gemini-3.8-flash',
    altModel: 'gemini-1.5-flash',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
    description: 'Multimodal Flash model with high free-tier rate limits.',
    tierBadge: 'Primary'
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    defaultModel: 'llama-3.3-70b-versatile',
    altModel: 'mixtral-8x7b-32768',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    description: 'Ultra-low latency inference on Llama 3.3 70B.',
    tierBadge: 'Fast'
  },
  cerebras: {
    id: 'cerebras',
    name: 'Cerebras',
    defaultModel: 'llama-3.3-70b',
    altModel: 'llama3.1-8b',
    endpoint: 'https://api.cerebras.ai/v1/chat/completions',
    description: 'High throughput token processing.',
    tierBadge: 'Throughput'
  }
};

export class LLMRouter {
  /**
   * Test API key connectivity for a specific provider
   */
  static async testConnection(providerId, apiKey) {
    try {
      const response = await this.callProvider(providerId, apiKey, {
        systemPrompt: 'You are an API health checker.',
        userPrompt: 'Respond strictly with the single word: READY',
        jsonMode: false,
        maxTokens: 20
      });
      return {
        success: true,
        message: 'Active: ' + response.text.trim().substring(0, 30),
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
   * Execute prompt with intelligent fallback across Gemini, Groq, and Cerebras
   */
  static async executeWithFallback(promptOptions, apiKeys, activeProviderId = 'gemini', fallbackOrder = []) {
    const candidates = [activeProviderId, ...fallbackOrder.filter(p => p !== activeProviderId)];
    const availableProviders = candidates.filter(id => PROVIDERS[id] && apiKeys[id] && apiKeys[id].trim().length > 0);

    if (availableProviders.length === 0) {
      throw new Error('No API keys configured. Please add an API key for Gemini, Groq, or Cerebras in the extension.');
    }

    const errors = [];
    for (const providerId of availableProviders) {
      try {
        const apiKey = apiKeys[providerId];
        const result = await this.callProvider(providerId, apiKey, promptOptions);
        return {
          ...result,
          usedProvider: providerId,
          fallbackOccurred: providerId !== activeProviderId,
          attempts: errors.length + 1
        };
      } catch (err) {
        console.warn(`[TrackMe Router] Provider ${providerId} failed:`, err.message);
        errors.push(`${providerId}: ${err.message}`);
      }
    }

    throw new Error(`All configured AI providers failed:\n${errors.join('\n')}`);
  }

  /**
   * Dispatch request to specific provider
   */
  static async callProvider(providerId, apiKey, options) {
    const { systemPrompt = '', userPrompt, jsonMode = false, pdfBase64 = null, maxTokens = 4096 } = options;

    switch (providerId) {
      case 'gemini':
        return this._callGemini(apiKey, systemPrompt, userPrompt, jsonMode, pdfBase64, maxTokens);
      case 'groq':
        return this._callOpenAICompatible(apiKey, PROVIDERS.groq.endpoint, PROVIDERS.groq.defaultModel, systemPrompt, userPrompt, jsonMode, maxTokens);
      case 'cerebras':
        return this._callOpenAICompatible(apiKey, PROVIDERS.cerebras.endpoint, PROVIDERS.cerebras.defaultModel, systemPrompt, userPrompt, jsonMode, maxTokens);
      default:
        throw new Error(`Unsupported provider: ${providerId}`);
    }
  }

  /**
   * Google Gemini REST API (gemini-3.8-flash with fallback to gemini-1.5-flash)
   */
  static async _callGemini(apiKey, systemPrompt, userPrompt, jsonMode, pdfBase64, maxTokens) {
    const modelsToTry = [PROVIDERS.gemini.defaultModel, PROVIDERS.gemini.altModel];
    let lastError = null;

    for (const model of modelsToTry) {
      try {
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
          throw new Error(`Gemini (${model}) error (${response.status}): ${errText}`);
        }

        const data = await response.json();
        const candidate = data.candidates?.[0];
        const text = candidate?.content?.parts?.[0]?.text || '';
        return { text, raw: data };
      } catch (err) {
        lastError = err;
        // If 404 or model not found, try the alternate model
        if (!err.message.includes('404')) {
          throw err;
        }
      }
    }

    throw lastError;
  }

  /**
   * OpenAI-compatible chat completions (Groq and Cerebras)
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
   * Helper to clean and parse JSON returned from LLMs
   */
  static extractJson(responseText) {
    if (!responseText || typeof responseText !== 'string') return null;
    let cleaned = responseText.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    }
    try {
      return JSON.parse(cleaned);
    } catch {
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
