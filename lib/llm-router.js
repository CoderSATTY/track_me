/**
 * TrackMe Multi-Provider LLM Router
 * Strictly supports Google Gemini, Groq, and Cerebras.
 * Automatically cascades through available model tiers if any model returns an error.
 */

export const PROVIDERS = {
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    models: [
      'gemini-3.8-flash',
      'gemini-2.5-flash',
      'gemini-2.0-flash',
      'gemini-2.0-flash-exp',
      'gemini-1.5-flash',
      'gemini-1.5-flash-8b',
      'gemini-1.5-pro'
    ],
    defaultModel: 'gemini-3.8-flash',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
    description: 'Multimodal Flash model with high free-tier rate limits.'
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    models: [
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'mixtral-8x7b-32768',
      'gemma2-9b-it',
      'llama-3.2-3b-preview',
      'llama-3.2-1b-preview'
    ],
    defaultModel: 'llama-3.3-70b-versatile',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    description: 'Ultra-low latency inference on Llama 3.3.'
  },
  cerebras: {
    id: 'cerebras',
    name: 'Cerebras',
    models: [
      'llama-3.3-70b',
      'llama3.1-8b',
      'llama3.1-70b'
    ],
    defaultModel: 'llama-3.3-70b',
    endpoint: 'https://api.cerebras.ai/v1/chat/completions',
    description: 'High throughput token processing.'
  }
};

export class LLMRouter {
  /**
   * Test API key connectivity by trying the model cascade
   */
  static async testConnection(providerId, apiKey) {
    if (!apiKey || !apiKey.trim()) {
      return { success: false, message: 'Key required', provider: providerId };
    }

    try {
      const response = await this.callProvider(providerId, apiKey.trim(), {
        systemPrompt: 'You are an API validator.',
        userPrompt: 'Respond strictly with: OK',
        jsonMode: false,
        maxTokens: 10
      });

      return {
        success: true,
        message: `Active (${response.modelUsed || 'OK'})`,
        provider: providerId,
        model: response.modelUsed
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
   * Execute prompt with intelligent fallback across configured providers
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
        const apiKey = apiKeys[providerId].trim();
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
   * Dispatch request to specific provider with internal model cascading
   */
  static async callProvider(providerId, apiKey, options) {
    const { systemPrompt = '', userPrompt, jsonMode = false, pdfBase64 = null, maxTokens = 4096 } = options;

    switch (providerId) {
      case 'gemini':
        return this._callGemini(apiKey, systemPrompt, userPrompt, jsonMode, pdfBase64, maxTokens);
      case 'groq':
        return this._callGroq(apiKey, systemPrompt, userPrompt, jsonMode, maxTokens);
      case 'cerebras':
        return this._callCerebras(apiKey, systemPrompt, userPrompt, jsonMode, maxTokens);
      default:
        throw new Error(`Unsupported provider: ${providerId}`);
    }
  }

  /**
   * Google Gemini with cascade across supported models
   */
  static async _callGemini(apiKey, systemPrompt, userPrompt, jsonMode, pdfBase64, maxTokens) {
    const modelsToTry = PROVIDERS.gemini.models;
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
          if (response.status === 400 && (errText.includes('API_KEY_INVALID') || errText.includes('API key not valid'))) {
            throw new Error('Invalid Gemini API Key');
          }
          if (response.status === 403 && errText.includes('API_KEY_INVALID')) {
            throw new Error('Invalid Gemini API Key');
          }
          // If 404 (model not found), 400 (unsupported), or 429 (rate limit), try next model
          console.warn(`[TrackMe Router] Gemini ${model} returned ${response.status}: ${errText}. Trying next model...`);
          throw new Error(`Gemini (${model}) ${response.status}`);
        }

        const data = await response.json();
        const candidate = data.candidates?.[0];
        const text = candidate?.content?.parts?.[0]?.text || '';
        return { text, raw: data, modelUsed: model };
      } catch (err) {
        lastError = err;
        if (err.message.includes('Invalid Gemini API Key')) {
          throw err;
        }
        // Continue trying remaining Gemini models
      }
    }

    throw lastError || new Error('All Gemini models failed.');
  }

  /**
   * Groq with cascade across available Groq models
   */
  static async _callGroq(apiKey, systemPrompt, userPrompt, jsonMode, maxTokens) {
    const modelsToTry = PROVIDERS.groq.models;
    let lastError = null;

    for (const model of modelsToTry) {
      try {
        const res = await this._callOpenAICompatibleSingle(apiKey, PROVIDERS.groq.endpoint, model, systemPrompt, userPrompt, jsonMode, maxTokens);
        return { ...res, modelUsed: model };
      } catch (err) {
        lastError = err;
        if (err.message.includes('401') || err.message.toLowerCase().includes('invalid api key')) {
          throw new Error('Invalid Groq API Key');
        }
        console.warn(`[TrackMe Router] Groq ${model} failed: ${err.message}. Trying next model...`);
      }
    }

    throw lastError || new Error('All Groq models failed.');
  }

  /**
   * Cerebras with cascade across available Cerebras models
   */
  static async _callCerebras(apiKey, systemPrompt, userPrompt, jsonMode, maxTokens) {
    const modelsToTry = PROVIDERS.cerebras.models;
    let lastError = null;

    for (const model of modelsToTry) {
      try {
        const res = await this._callOpenAICompatibleSingle(apiKey, PROVIDERS.cerebras.endpoint, model, systemPrompt, userPrompt, jsonMode, maxTokens);
        return { ...res, modelUsed: model };
      } catch (err) {
        lastError = err;
        if (err.message.includes('401') || err.message.toLowerCase().includes('invalid api key')) {
          throw new Error('Invalid Cerebras API Key');
        }
        console.warn(`[TrackMe Router] Cerebras ${model} failed: ${err.message}. Trying next model...`);
      }
    }

    throw lastError || new Error('All Cerebras models failed.');
  }

  /**
   * OpenAI-compatible chat completion single call
   */
  static async _callOpenAICompatibleSingle(apiKey, endpoint, model, systemPrompt, userPrompt, jsonMode, maxTokens) {
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
   * Clean and parse JSON returned from LLMs
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
