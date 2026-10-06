/**
 * TrackMe Controller
 * Handles application autofill, client-side resume extraction & parsing,
 * persistent tab state, compliance preferences, and API keys.
 */

import { Storage } from '../lib/storage.js';
import { PdfExtractor } from '../lib/pdf-extractor.js';

let activeCandidateProfile = null;
let stagedResumeFile = null;

document.addEventListener('DOMContentLoaded', async () => {
  setupTabs();
  await restoreActiveTab();
  await loadStatusAndKeys();
  await loadProfile();
  await loadDemographics();
  await loadMemoryBank();
  await inspectActivePage();
  setupEventListeners();
});

// --- NAVIGATION TABS WITH PERSISTENCE ---
function setupTabs() {
  const tabs = document.querySelectorAll('.nav-btn');
  const panes = document.querySelectorAll('.tab-pane');

  tabs.forEach(tab => {
    tab.addEventListener('click', async () => {
      tabs.forEach(t => t.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      const targetId = tab.getAttribute('data-tab');
      const targetPane = document.getElementById(targetId);
      if (targetPane) targetPane.classList.add('active');

      // Persist active tab across browser tab switching
      await Storage.set({ lastActiveTab: targetId });
    });
  });
}

async function restoreActiveTab() {
  const data = await Storage.get(['lastActiveTab']);
  const savedTab = data.lastActiveTab || 'tab-fill';

  const tabBtn = document.querySelector(`.nav-btn[data-tab="${savedTab}"]`);
  const tabPane = document.getElementById(savedTab);

  if (tabBtn && tabPane) {
    document.querySelectorAll('.nav-btn').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    tabBtn.classList.add('active');
    tabPane.classList.add('active');
  }
}

// --- ACTIVE PAGE INSPECTION ---
async function inspectActivePage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id || tab.url?.startsWith('chrome://')) return;

  chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_INFO' }, (res) => {
    if (chrome.runtime.lastError || !res?.success) {
      document.getElementById('page-target-role').innerText = 'Standard Page';
      document.getElementById('page-target-company').innerText = tab.title?.substring(0, 25) || 'Web';
      document.getElementById('page-field-count').innerText = '-';
      return;
    }

    const { jobMetadata, fieldCount } = res.data;
    document.getElementById('page-target-role').innerText = jobMetadata.title || 'Role';
    document.getElementById('page-target-company').innerText = jobMetadata.company || 'Company';
    document.getElementById('page-field-count').innerText = fieldCount;
  });
}

// --- TAB 1 & 4: STATUS & KEYS ---
async function loadStatusAndKeys() {
  const { keys, activeProvider } = await Storage.getApiKeys();

  const selectActive = document.getElementById('select-active-provider');
  const selectPrimary = document.getElementById('primary-provider-select');
  const keyGemini = document.getElementById('key-gemini');
  const keyGroq = document.getElementById('key-groq');
  const keyCerebras = document.getElementById('key-cerebras');

  if (selectActive) selectActive.value = activeProvider || 'gemini';
  if (selectPrimary) selectPrimary.value = activeProvider || 'gemini';

  if (keyGemini) keyGemini.value = keys.gemini || '';
  if (keyGroq) keyGroq.value = keys.groq || '';
  if (keyCerebras) keyCerebras.value = keys.cerebras || '';
}

async function saveKeySettings() {
  const primaryProvider = document.getElementById('primary-provider-select').value;
  const keys = {
    gemini: document.getElementById('key-gemini').value.trim(),
    groq: document.getElementById('key-groq').value.trim(),
    cerebras: document.getElementById('key-cerebras').value.trim()
  };

  const fallbackOrder = ['gemini', 'groq', 'cerebras'].filter(p => p !== primaryProvider);

  await Storage.saveApiKeys(keys, primaryProvider, fallbackOrder);
  document.getElementById('select-active-provider').value = primaryProvider;
  showToast('API key settings saved');
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

      await saveKeySettings();
      showToast('Imported keys from ' + file.name);
    } catch (err) {
      showToast('Failed to parse file: ' + err.message, true);
    }
  });
}

// --- TAB 2: RESUME & CANDIDATE PROFILE ---
async function loadProfile() {
  const { profile, verified, resumeMeta } = await Storage.getProfile();
  activeCandidateProfile = profile;

  const candidateStat = document.getElementById('stat-candidate-name');
  const resumeStat = document.getElementById('stat-resume-file');
  const badge = document.getElementById('badge-verified');

  if (profile?.basic?.fullName) {
    candidateStat.innerText = profile.basic.fullName;
    populateProfileInputs(profile);
  }

  if (resumeMeta) {
    const sizeKb = Math.round(resumeMeta.size / 1024);
    resumeStat.innerText = `${resumeMeta.fileName} (${sizeKb} KB)`;
    document.getElementById('resume-file-name').innerText = resumeMeta.fileName;
    document.getElementById('resume-selected-bar').classList.remove('hidden');
  }

  if (verified) {
    badge.innerText = 'Verified';
    badge.className = 'badge verified';
  } else {
    badge.innerText = 'Unverified';
    badge.className = 'badge';
  }
}

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
  stagedResumeFile = file;
  document.getElementById('resume-file-name').innerText = file.name;
  document.getElementById('resume-selected-bar').classList.remove('hidden');

  // Immediately store binary file in IndexedDB
  await Storage.saveResumeBinary(file, file.name, file.type);
  document.getElementById('stat-resume-file').innerText = `${file.name} (${Math.round(file.size / 1024)} KB)`;

  // Client-side text extraction
  const rawTextArea = document.getElementById('resume-raw-text');
  rawTextArea.placeholder = 'Extracting resume text...';

  try {
    let extracted = '';
    if (file.name.endsWith('.txt') || file.name.endsWith('.md')) {
      extracted = await file.text();
    } else {
      const buffer = await file.arrayBuffer();
      extracted = await PdfExtractor.extractText(buffer);
    }

    if (extracted && extracted.trim().length > 0) {
      rawTextArea.value = extracted;
      showToast('Extracted text from ' + file.name + '. Click Parse Profile.');
    } else {
      rawTextArea.placeholder = 'Text extraction empty. You can paste your resume text here.';
      showToast('Loaded ' + file.name + '. Click Parse Profile.');
    }
  } catch (err) {
    console.warn('Text extraction warning:', err);
    showToast('Loaded ' + file.name + '. Click Parse Profile.');
  }
}

async function triggerResumeParse() {
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
    }, (res) => {
      loader.classList.add('hidden');
      if (!res?.success) {
        showToast('Parse error: ' + (res?.error || 'Failed'), true);
        return;
      }

      const { profile, providerUsed } = res.data;
      activeCandidateProfile = profile;
      populateProfileInputs(profile);
      showToast(`Parsed via ${providerUsed.toUpperCase()}. Click Save Profile.`);
    });
  } catch (err) {
    loader.classList.add('hidden');
    showToast('File error: ' + err.message, true);
  }
}

function populateProfileInputs(profile) {
  const b = profile.basic || {};
  document.getElementById('prof-fullName').value = b.fullName || '';
  document.getElementById('prof-rollNo').value = b.rollNo || '';
  document.getElementById('prof-email').value = b.email || '';
  document.getElementById('prof-phone').value = b.phone || '';
  document.getElementById('prof-city').value = b.location?.city || '';
  document.getElementById('prof-country').value = b.location?.country || '';
  document.getElementById('prof-linkedin').value = b.linkedin || '';
  document.getElementById('prof-github').value = b.github || '';
  document.getElementById('prof-skills').value = Array.isArray(profile.skills) ? profile.skills.join(', ') : (profile.skills || '');
}

async function confirmAndSaveProfile() {
  if (!activeCandidateProfile) activeCandidateProfile = { basic: {}, demographics: {} };

  const fullName = document.getElementById('prof-fullName').value.trim();
  const rollNo = document.getElementById('prof-rollNo').value.trim();
  const email = document.getElementById('prof-email').value.trim();
  const phone = document.getElementById('prof-phone').value.trim();
  const city = document.getElementById('prof-city').value.trim();
  const country = document.getElementById('prof-country').value.trim();
  const linkedin = document.getElementById('prof-linkedin').value.trim();
  const github = document.getElementById('prof-github').value.trim();
  const skillsStr = document.getElementById('prof-skills').value.trim();

  activeCandidateProfile.basic = {
    ...activeCandidateProfile.basic,
    fullName,
    firstName: fullName.split(' ')[0] || '',
    lastName: fullName.split(' ').slice(1).join(' ') || '',
    rollNo,
    email,
    phone,
    location: { city, country },
    linkedin,
    github
  };
  activeCandidateProfile.skills = skillsStr.split(',').map(s => s.trim()).filter(Boolean);

  await Storage.saveProfile(activeCandidateProfile, true);

  document.getElementById('stat-candidate-name').innerText = fullName || 'Saved';
  const badge = document.getElementById('badge-verified');
  badge.innerText = 'Verified';
  badge.className = 'badge verified';
  showToast('Profile saved successfully');
}

// --- TAB 3: DEMOGRAPHICS & CUSTOM Q&A ---
async function loadDemographics() {
  const { profile } = await Storage.getProfile();
  const demo = profile?.demographics || {};

  document.getElementById('demo-legallyAuthorized').value = demo.legallyAuthorized || 'Yes';
  document.getElementById('demo-requireSponsorship').value = demo.requireSponsorship || 'No';
  document.getElementById('demo-sponsorshipDetails').value = demo.sponsorshipDetails || '';
  document.getElementById('demo-disabilityStatus').value = demo.disabilityStatus || 'No, I do not have a disability';
  document.getElementById('demo-veteranStatus').value = demo.veteranStatus || 'I am not a protected veteran';
  document.getElementById('demo-gender').value = demo.gender || 'Prefer not to disclose';
  document.getElementById('demo-pronouns').value = demo.pronouns || 'Prefer not to say';
  document.getElementById('demo-salaryExpectation').value = demo.salaryExpectation || '';
  document.getElementById('demo-noticePeriod').value = demo.noticePeriod || '';
}

async function saveDemographics() {
  if (!activeCandidateProfile) activeCandidateProfile = { basic: {}, demographics: {} };

  activeCandidateProfile.demographics = {
    legallyAuthorized: document.getElementById('demo-legallyAuthorized').value,
    requireSponsorship: document.getElementById('demo-requireSponsorship').value,
    sponsorshipDetails: document.getElementById('demo-sponsorshipDetails').value.trim(),
    disabilityStatus: document.getElementById('demo-disabilityStatus').value,
    veteranStatus: document.getElementById('demo-veteranStatus').value,
    gender: document.getElementById('demo-gender').value,
    pronouns: document.getElementById('demo-pronouns').value,
    salaryExpectation: document.getElementById('demo-salaryExpectation').value.trim(),
    noticePeriod: document.getElementById('demo-noticePeriod').value.trim()
  };

  await Storage.saveProfile(activeCandidateProfile, true);
  showToast('Compliance preferences saved');
}

async function loadMemoryBank() {
  const items = await Storage.getMemoryBank();
  renderMemoryItems(items);
}

function renderMemoryItems(items) {
  const container = document.getElementById('memory-items-list');
  if (items.length === 0) {
    container.innerHTML = `<div style="color: #71717a; padding: 10px; font-size: 11px; text-align: center;">No custom answers saved yet.</div>`;
    return;
  }

  container.innerHTML = items.map(item => `
    <div class="memory-row">
      <div>
        <div class="memory-q">${escapeHtml(item.question)}</div>
        <div class="memory-a">${escapeHtml(item.answer)}</div>
      </div>
      <button class="btn-del" data-id="${item.id}">Delete</button>
    </div>
  `).join('');

  container.querySelectorAll('.btn-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      const all = await Storage.getMemoryBank();
      const updated = all.filter(m => m.id !== id);
      await Storage.saveMemoryBank(updated);
      await loadMemoryBank();
      showToast('Answer removed');
    });
  });
}

function setupMemorySearch() {
  const input = document.getElementById('memory-search-input');
  input.addEventListener('input', async () => {
    const q = input.value.toLowerCase().trim();
    const all = await Storage.getMemoryBank();
    const filtered = all.filter(m => m.question.toLowerCase().includes(q) || m.answer.toLowerCase().includes(q));
    renderMemoryItems(filtered);
  });
}

// --- EVENT LISTENERS ---
function setupEventListeners() {
  // Engine Selector
  document.getElementById('select-active-provider').addEventListener('change', async (e) => {
    const val = e.target.value;
    const current = await Storage.getApiKeys();
    await Storage.saveApiKeys(current.keys, val, current.fallbackProviders);
    document.getElementById('primary-provider-select').value = val;
    showToast('Active engine set to ' + val.toUpperCase());
  });

  // Keys Tab
  document.getElementById('btn-save-keys').addEventListener('click', saveKeySettings);
  setupKeyUpload();
  document.querySelectorAll('.btn-test-key').forEach(btn => {
    btn.addEventListener('click', () => {
      const provider = btn.getAttribute('data-provider');
      testSingleKey(provider);
    });
  });

  // Resume Tab
  setupResumeDropzone();
  document.getElementById('btn-parse-resume').addEventListener('click', triggerResumeParse);
  document.getElementById('btn-save-profile').addEventListener('click', confirmAndSaveProfile);

  // Demographics Tab
  document.getElementById('btn-save-demographics').addEventListener('click', saveDemographics);

  // Memory Tab
  setupMemorySearch();
  document.getElementById('btn-save-new-memory').addEventListener('click', async () => {
    const q = document.getElementById('new-mem-question').value.trim();
    const a = document.getElementById('new-mem-answer').value.trim();
    if (!q || !a) {
      showToast('Question and answer required', true);
      return;
    }
    await Storage.addMemoryBankEntry(q, a, 'General');
    document.getElementById('new-mem-question').value = '';
    document.getElementById('new-mem-answer').value = '';
    await loadMemoryBank();
    showToast('Custom answer added');
  });

  // Action Buttons (Direct Content Script Messaging)
  document.getElementById('btn-autofill-page').addEventListener('click', async () => {
    showToast('Scanning and filling application...');
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      showToast('No active tab detected', true);
      return;
    }

    chrome.tabs.sendMessage(tab.id, { type: 'FILL_ACTIVE_PAGE' }, (res) => {
      if (chrome.runtime.lastError || !res?.success) {
        showToast('Fill error: ' + (res?.error || chrome.runtime.lastError?.message || 'Page not ready'), true);
        return;
      }
      const { filledCount, totalFields, fileAttached } = res.data;
      showToast(`Filled ${filledCount} of ${totalFields} fields${fileAttached ? ' + attached resume' : ''}`);
    });
  });

  document.getElementById('btn-attach-resume').addEventListener('click', async () => {
    showToast('Attaching resume to application...');
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      showToast('No active tab detected', true);
      return;
    }

    chrome.tabs.sendMessage(tab.id, { type: 'ATTACH_ACTIVE_RESUME' }, (res) => {
      if (chrome.runtime.lastError || !res?.success) {
        showToast('Attach error: ' + (res?.error || chrome.runtime.lastError?.message || 'No file input found'), true);
        return;
      }
      if (res.attached) {
        showToast('Resume file attached successfully');
      } else {
        showToast('No resume file input found on this page', true);
      }
    });
  });
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
  toast.innerText = msg;
  toast.className = `toast ${isError ? 'error' : ''}`;
  setTimeout(() => {
    toast.className = 'toast hidden';
  }, 3200);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[m]));
}
