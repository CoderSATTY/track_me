/**
 * TrackMe Controller
 * Manages the 3-step progressive state machine:
 * Stage 1: API Keys Setup -> Stage 2: Resume Memorization -> Stage 3: Main Dashboard
 */

import { Storage } from '../lib/storage.js';
import { PdfExtractor } from '../lib/pdf-extractor.js';

let activeCandidateProfile = null;
let stagedResumeFile = null;

document.addEventListener('DOMContentLoaded', async () => {
  await initApp();
  setupEventListeners();
});

// --- STATE MACHINE INITIALIZATION ---
async function initApp() {
  const { keys, activeProvider } = await Storage.getApiKeys();
  const { profile } = await Storage.getProfile();
  activeCandidateProfile = profile;

  const hasAnyKey = Object.values(keys).some(k => k && k.trim().length > 0);
  const hasProfile = !!(profile && (profile.basic?.fullName || profile.resumeRawText));

  // Determine starting view based on user progression
  if (!hasAnyKey) {
    showView('view-keys');
    document.getElementById('btn-back-to-dash-keys')?.classList.add('hidden');
    setBadge('Setup');
  } else if (!hasProfile) {
    showView('view-resume');
    document.getElementById('btn-back-to-dash-resume')?.classList.add('hidden');
    setBadge('Resume');
  } else {
    showView('view-dashboard');
    document.getElementById('btn-back-to-dash-keys')?.classList.remove('hidden');
    document.getElementById('btn-back-to-dash-resume')?.classList.remove('hidden');
    setBadge('Ready');
    populateDashboard(profile, activeProvider);
  }

  // Load field values
  loadKeyInputs(keys, activeProvider);
  if (profile?.resumeRawText) {
    const rawEl = document.getElementById('resume-raw-text');
    if (rawEl && !rawEl.value) rawEl.value = profile.resumeRawText;
  }

  // Eradicate any legacy floating widget on the active form tab immediately
  try {
    const targetTab = await getTargetTab();
    if (targetTab?.id && !targetTab.url?.startsWith('chrome://') && !targetTab.url?.startsWith('chrome-extension://')) {
      chrome.scripting.executeScript({
        target: { tabId: targetTab.id },
        func: () => {
          document.querySelectorAll('#trackme-widget-root, #trackme-pill, #trackme-panel, .trackme-widget, [id^="trackme-"]').forEach(el => {
            if (el.id !== 'trackme-inline-tooltip') el.remove();
          });
        }
      }).catch(() => {});
    }
  } catch {}

  await inspectActivePage();
}

function showView(viewId) {
  document.querySelectorAll('.view-stage').forEach(el => el.classList.add('hidden'));
  const target = document.getElementById(viewId);
  if (target) target.classList.remove('hidden');
}

function setBadge(text, isReady = false) {
  const badge = document.getElementById('badge-status');
  if (!badge) return;
  badge.innerText = text;
  badge.className = `badge ${isReady || text === 'Ready' ? 'ready' : ''}`;
}

// --- STAGE 1: API KEYS ---
function loadKeyInputs(keys, activeProvider) {
  const selectPrimary = document.getElementById('primary-provider-select');
  const keyGemini = document.getElementById('key-gemini');
  const keyGroq = document.getElementById('key-groq');
  const keyCerebras = document.getElementById('key-cerebras');

  if (selectPrimary) selectPrimary.value = activeProvider || 'gemini';
  if (keyGemini) keyGemini.value = keys.gemini || '';
  if (keyGroq) keyGroq.value = keys.groq || '';
  if (keyCerebras) keyCerebras.value = keys.cerebras || '';
}

async function handleSaveKeysStage() {
  const primaryProvider = document.getElementById('primary-provider-select').value;
  const keys = {
    gemini: document.getElementById('key-gemini').value.trim(),
    groq: document.getElementById('key-groq').value.trim(),
    cerebras: document.getElementById('key-cerebras').value.trim()
  };

  const hasAnyKey = Object.values(keys).some(k => k.length > 0);
  if (!hasAnyKey) {
    showToast('Please provide at least one API key to proceed', true);
    return;
  }

  const fallbackOrder = ['gemini', 'groq', 'cerebras'].filter(p => p !== primaryProvider);
  await Storage.saveApiKeys(keys, primaryProvider, fallbackOrder);

  showToast('API keys saved');

  // Advance to Stage 2 (Resume) if no profile, otherwise to Stage 3 (Dashboard)
  const { profile } = await Storage.getProfile();
  if (!profile || (!profile.basic?.fullName && !profile.resumeRawText)) {
    showView('view-resume');
    setBadge('Resume');
  } else {
    showView('view-dashboard');
    setBadge('Ready');
    populateDashboard(profile, primaryProvider);
  }
}

function testSingleKey(providerId) {
  const inputEl = document.getElementById(`key-${providerId}`);
  const statusEl = document.getElementById(`test-${providerId}`);
  const apiKey = inputEl.value.trim();

  if (!apiKey) {
    statusEl.className = 'key-status error';
    statusEl.innerText = 'Key required';
    return;
  }

  statusEl.className = 'key-status';
  statusEl.innerText = 'Testing...';

  chrome.runtime.sendMessage({
    type: 'TEST_API_KEY',
    payload: { providerId, apiKey }
  }, (res) => {
    if (res?.data?.success) {
      statusEl.className = 'key-status success';
      statusEl.innerText = res.data.message || 'Active';
    } else {
      statusEl.className = 'key-status error';
      statusEl.innerText = res?.data?.message || 'Failed';
    }
  });
}

function setupKeyUpload() {
  const btn = document.getElementById('btn-upload-keys');
  const fileInput = document.getElementById('upload-keys-file');

  btn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      let imported = {};

      if (file.name.endsWith('.json')) {
        const json = JSON.parse(text);
        imported = {
          gemini: json.gemini || json.GEMINI_API_KEY || json.google_api_key || '',
          groq: json.groq || json.GROQ_API_KEY || '',
          cerebras: json.cerebras || json.CEREBRAS_API_KEY || ''
        };
      } else {
        const lines = text.split('\n');
        for (const line of lines) {
          const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*["']?(.*?)["']?\s*$/);
          if (match) {
            const k = match[1].toUpperCase();
            const v = match[2].trim();
            if (k.includes('GEMINI')) imported.gemini = v;
            else if (k.includes('GROQ')) imported.groq = v;
            else if (k.includes('CEREBRAS')) imported.cerebras = v;
          }
        }
      }

      if (imported.gemini) document.getElementById('key-gemini').value = imported.gemini;
      if (imported.groq) document.getElementById('key-groq').value = imported.groq;
      if (imported.cerebras) document.getElementById('key-cerebras').value = imported.cerebras;

      showToast('Imported keys from ' + file.name);
    } catch (err) {
      showToast('Failed to parse file: ' + err.message, true);
    }
  });
}

// --- STAGE 2: RESUME UPLOAD & MEMORIZATION ---
function setupResumeDropzone() {
  const dropzone = document.getElementById('resume-dropzone');
  const fileInput = document.getElementById('resume-file-input');

  dropzone.addEventListener('click', () => fileInput.click());

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.style.borderColor = '#09090b';
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.style.borderColor = '';
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.style.borderColor = '';
    if (e.dataTransfer.files?.[0]) {
      handleSelectedResume(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files?.[0]) {
      handleSelectedResume(fileInput.files[0]);
    }
  });
}

async function handleSelectedResume(file) {
  try {
    stagedResumeFile = file;
    document.getElementById('resume-file-name').innerText = file.name;
    document.getElementById('resume-selected-bar').classList.remove('hidden');

    // Save binary into storage
    await Storage.saveResumeBinary(file, file.name, file.type);

    // Client-side text extraction
    const rawTextArea = document.getElementById('resume-raw-text');
    rawTextArea.placeholder = 'Extracting resume text...';

    let extracted = '';
    if (file.name.endsWith('.txt') || file.name.endsWith('.md')) {
      extracted = await file.text();
    } else {
      const buffer = await file.arrayBuffer();
      extracted = await PdfExtractor.extractText(buffer);
    }

    if (extracted && extracted.trim().length > 0) {
      rawTextArea.value = extracted;
      showToast('Extracted text. Click Parse & Memorize Resume.');
    } else {
      rawTextArea.placeholder = 'You can paste your resume text here.';
      showToast('Loaded ' + file.name + '. Click Parse & Memorize Resume.');
    }
  } catch (err) {
    console.error('File extraction error:', err);
    showToast('File load error: ' + err.message, true);
  }
}

async function handleParseResumeStage() {
  const rawText = document.getElementById('resume-raw-text').value.trim();

  if (!rawText && !stagedResumeFile) {
    showToast('Upload a resume file or paste text first', true);
    return;
  }

  const loader = document.getElementById('parse-loading');
  loader.classList.remove('hidden');

  try {
    let pdfBase64 = null;
    let fileName = stagedResumeFile ? stagedResumeFile.name : 'resume.txt';
    let mimeType = stagedResumeFile ? stagedResumeFile.type : 'text/plain';

    if (stagedResumeFile && stagedResumeFile.name.endsWith('.pdf')) {
      pdfBase64 = await fileToBase64(stagedResumeFile);
    }

    chrome.runtime.sendMessage({
      type: 'PARSE_RESUME',
      payload: {
        resumeText: rawText,
        pdfBase64,
        fileName,
        mimeType
      }
    }, async (res) => {
      loader.classList.add('hidden');
      if (!res?.success) {
        showToast('Parse error: ' + (res?.error || 'Failed to parse resume'), true);
        return;
      }

      const { profile, providerUsed } = res.data;
      activeCandidateProfile = profile;

      showToast(`Resume memorized via ${providerUsed.toUpperCase()}`);

      // Enable back buttons and transition to Stage 3 Dashboard
      document.getElementById('btn-back-to-dash-keys')?.classList.remove('hidden');
      document.getElementById('btn-back-to-dash-resume')?.classList.remove('hidden');

      const { activeProvider } = await Storage.getApiKeys();
      populateDashboard(profile, activeProvider);
      showView('view-dashboard');
      setBadge('Ready');
    });
  } catch (err) {
    loader.classList.add('hidden');
    showToast('Error: ' + err.message, true);
  }
}

// --- STAGE 3: MAIN DASHBOARD ---
function populateDashboard(profile, activeProvider) {
  if (!profile) return;

  const nameEl = document.getElementById('dash-candidate-name');
  const emailEl = document.getElementById('dash-candidate-email');
  const rollEl = document.getElementById('dash-candidate-roll');
  const selectProvider = document.getElementById('select-active-provider');

  if (nameEl) nameEl.innerText = profile.basic?.fullName || 'Candidate';
  if (emailEl) emailEl.innerText = profile.basic?.email || '-';
  if (rollEl) rollEl.innerText = profile.basic?.rollNo || profile.basic?.phone || '-';
  if (selectProvider) selectProvider.value = activeProvider || 'gemini';

  const jsonDisplay = document.getElementById('state-json-display');
  if (jsonDisplay) jsonDisplay.innerText = JSON.stringify(profile, null, 2);
}

async function getTargetTab() {
  try {
    const lastFocused = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (lastFocused.length > 0 && lastFocused[0]?.url && !lastFocused[0].url.startsWith('chrome://') && !lastFocused[0].url.startsWith('chrome-extension://')) {
      return lastFocused[0];
    }

    const allActive = await chrome.tabs.query({ active: true });
    const normalActive = allActive.filter(t => t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('chrome-extension://'));
    if (normalActive.length > 0) return normalActive[0];

    const allTabs = await chrome.tabs.query({});
    const formTab = allTabs.find(t => t.url && t.url.includes('docs.google.com/forms'));
    if (formTab) return formTab;

    const webTab = allTabs.find(t => t.url && t.url.startsWith('http'));
    if (webTab) return webTab;
  } catch (err) {
    console.warn('[TrackMe] getTargetTab error:', err);
  }
  return null;
}

async function inspectActivePage() {
  const tab = await getTargetTab();
  if (!tab || !tab.id || tab.url?.startsWith('chrome://')) return;

  chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_INFO' }, (res) => {
    if (chrome.runtime.lastError || !res?.success) {
      const isGForm = tab.url?.includes('docs.google.com/forms');
      document.getElementById('dash-target-title').innerText = isGForm ? 'Google Form' : (tab.title?.substring(0, 30) || 'Web Form');
      document.getElementById('dash-target-count').innerText = '-';
      return;
    }

    const { jobMetadata, fieldCount } = res.data;
    document.getElementById('dash-target-title').innerText = jobMetadata?.title || 'Application Form';
    document.getElementById('dash-target-count').innerText = fieldCount;
  });
}

// --- EVENT LISTENERS ---
function setupEventListeners() {
  const isWindowMode = window.location.search.includes('mode=window');
  const floatBtn = document.getElementById('btn-float-window');

  if (isWindowMode && floatBtn) {
    document.body.classList.add('window-mode');
    floatBtn.innerText = 'Persistent';
    floatBtn.title = 'TrackMe is running in persistent floating window mode';
  }

  // Float persistent window
  floatBtn?.addEventListener('click', async () => {
    if (isWindowMode) return;
    await chrome.windows.create({
      url: chrome.runtime.getURL('popup/popup.html?mode=window'),
      type: 'popup',
      width: 385,
      height: 600,
      top: 60,
      left: Math.max(0, (window.screen.availWidth || 1280) - 400),
      focused: true
    });
    window.close();
  });

  // Stage 1: Keys
  document.getElementById('btn-save-keys-stage')?.addEventListener('click', handleSaveKeysStage);
  setupKeyUpload();
  document.querySelectorAll('.btn-test-key').forEach(btn => {
    btn.addEventListener('click', () => {
      const provider = btn.getAttribute('data-provider');
      testSingleKey(provider);
    });
  });

  // Stage 2: Resume
  setupResumeDropzone();
  document.getElementById('btn-parse-resume')?.addEventListener('click', handleParseResumeStage);

  // Stage 3: Dashboard Actions
  document.getElementById('select-active-provider')?.addEventListener('change', async (e) => {
    const val = e.target.value;
    const current = await Storage.getApiKeys();
    await Storage.saveApiKeys(current.keys, val, current.fallbackProviders);
    document.getElementById('primary-provider-select').value = val;
    showToast('Active engine set to ' + val.toUpperCase());
  });

  // Fill Application Button
  document.getElementById('btn-autofill-page')?.addEventListener('click', async () => {
    const statusMsg = document.getElementById('dash-fill-status');
    if (statusMsg) statusMsg.innerText = 'Scraping form questions and consulting AI model...';
    showToast('Filling application with AI...');

    const tab = await getTargetTab();
    if (!tab?.id) {
      showToast('No active tab detected', true);
      if (statusMsg) statusMsg.innerText = 'Error: No active tab found.';
      return;
    }

    chrome.tabs.sendMessage(tab.id, { type: 'FILL_ACTIVE_PAGE' }, (res) => {
      if (chrome.runtime.lastError || !res?.success) {
        const errText = res?.error || chrome.runtime.lastError?.message || 'Form not detected';
        showToast('Fill error: ' + errText, true);
        if (statusMsg) statusMsg.innerText = 'Fill error: ' + errText;
        return;
      }

      const { filledCount, totalFields } = res.data;
      const msg = `Successfully filled ${filledCount} of ${totalFields} fields!`;
      if (statusMsg) statusMsg.innerText = msg;
      showToast(msg);
    });
  });

  // Quick Links
  document.getElementById('link-update-resume')?.addEventListener('click', () => {
    showView('view-resume');
  });

  document.getElementById('link-update-keys')?.addEventListener('click', () => {
    showView('view-keys');
  });

  document.getElementById('link-view-state')?.addEventListener('click', () => {
    const inspector = document.getElementById('state-inspector-card');
    inspector?.classList.toggle('hidden');
  });

  document.getElementById('btn-close-state')?.addEventListener('click', () => {
    document.getElementById('state-inspector-card')?.classList.add('hidden');
  });

  // Back to Dashboard Links
  document.querySelectorAll('.back-link-container button').forEach(btn => {
    btn.addEventListener('click', async () => {
      const { profile } = await Storage.getProfile();
      const { activeProvider } = await Storage.getApiKeys();
      populateDashboard(profile, activeProvider);
      showView('view-dashboard');
    });
  });

  // Dynamic tab inspection on switch
  if (chrome.tabs && chrome.tabs.onActivated) {
    chrome.tabs.onActivated.addListener(async () => {
      await inspectActivePage();
    });
  }

  if (chrome.tabs && chrome.tabs.onUpdated) {
    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
      if (changeInfo.status === 'complete') {
        const [current] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (current && current.id === tabId) {
          await inspectActivePage();
        }
      }
    });
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = reader.result;
      const base64 = typeof res === 'string' ? res.split(',')[1] : '';
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function showToast(msg, isError = false) {
  const toast = document.getElementById('status-toast');
  if (!toast) return;
  toast.innerText = msg;
  toast.className = `toast ${isError ? 'error' : ''}`;
  setTimeout(() => {
    toast.className = 'toast hidden';
  }, 3200);
}
