/**
 * TrackMe Storage Layer
 * Coordinates chrome.storage.local for JSON structures and IndexedDB for binary Blobs (Resume, Cover Letters).
 */

const DB_NAME = 'TrackMeDB';
const DB_VERSION = 1;
const STORE_FILES = 'files';

// Open / initialize IndexedDB
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_FILES)) {
        db.createObjectStore(STORE_FILES, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const Storage = {
  // --- CHROME STORAGE (API Keys, Profile, Memory Bank, Settings) ---

  async get(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, (res) => resolve(res || {}));
    });
  },

  async set(data) {
    return new Promise((resolve) => {
      chrome.storage.local.set(data, () => resolve(true));
    });
  },

  async getApiKeys() {
    const data = await this.get(['apiKeys', 'activeProvider', 'fallbackProviders']);
    return {
      keys: data.apiKeys || {},
      activeProvider: data.activeProvider || 'gemini',
      fallbackProviders: data.fallbackProviders || ['groq', 'cerebras', 'openrouter', 'sambanova', 'together', 'cloudflare']
    };
  },

  async saveApiKeys(apiKeys, activeProvider, fallbackProviders) {
    return this.set({
      apiKeys: apiKeys || {},
      activeProvider: activeProvider || 'gemini',
      fallbackProviders: fallbackProviders || []
    });
  },

  async getProfile() {
    const data = await this.get(['userProfile', 'profileVerified', 'resumeMeta']);
    return {
      profile: data.userProfile || null,
      verified: !!data.profileVerified,
      resumeMeta: data.resumeMeta || null
    };
  },

  async saveProfile(profile, verified = true) {
    return this.set({
      userProfile: profile,
      profileVerified: verified,
      profileUpdatedAt: Date.now()
    });
  },

  async getMemoryBank() {
    const data = await this.get(['memoryBank']);
    return data.memoryBank || [];
  },

  async saveMemoryBank(entries) {
    return this.set({ memoryBank: entries || [] });
  },

  async addMemoryBankEntry(question, answer, category = 'General') {
    const current = await this.getMemoryBank();
    const existingIndex = current.findIndex(e => e.question.toLowerCase().trim() === question.toLowerCase().trim());
    if (existingIndex >= 0) {
      current[existingIndex].answer = answer;
      current[existingIndex].category = category;
      current[existingIndex].updatedAt = Date.now();
    } else {
      current.push({
        id: 'mem_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        question: question.trim(),
        answer: answer.trim(),
        category,
        updatedAt: Date.now()
      });
    }
    await this.saveMemoryBank(current);
    return current;
  },

  async getCoverLetters() {
    const data = await this.get(['coverLetters']);
    return data.coverLetters || [];
  },

  async saveCoverLetterMeta(coverLetters) {
    return this.set({ coverLetters: coverLetters || [] });
  },

  // --- INDEXEDDB (Binary File Storage for Resume & Attachments) ---

  async saveResumeBinary(blob, fileName, mimeType) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_FILES, 'readwrite');
      const store = tx.objectStore(STORE_FILES);
      const record = {
        id: 'active_resume',
        fileName,
        mimeType: mimeType || 'application/pdf',
        size: blob.size,
        blob,
        updatedAt: Date.now()
      };
      const req = store.put(record);
      req.onsuccess = async () => {
        // Also update light metadata in chrome.storage
        await this.set({
          resumeMeta: {
            fileName,
            mimeType: record.mimeType,
            size: record.size,
            updatedAt: record.updatedAt
          }
        });
        resolve(record);
      };
      req.onerror = () => reject(req.error);
    });
  },

  async getResumeBinary() {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_FILES, 'readonly');
      const store = tx.objectStore(STORE_FILES);
      const req = store.get('active_resume');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },

  async saveCoverLetterBinary(id, blob, fileName, textContent) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_FILES, 'readwrite');
      const store = tx.objectStore(STORE_FILES);
      const record = {
        id,
        fileName,
        textContent,
        blob,
        size: blob.size,
        updatedAt: Date.now()
      };
      const req = store.put(record);
      req.onsuccess = () => resolve(record);
      req.onerror = () => reject(req.error);
    });
  },

  async getCoverLetterBinary(id) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_FILES, 'readonly');
      const store = tx.objectStore(STORE_FILES);
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }
};
