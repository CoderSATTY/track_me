/**
 * TrackMe Unified Popup Controller
 * Manages Actions, API Keys (Gemini, Groq, Cerebras), Resume Intake, Demographics, Memory Bank, and Cover Letter
 */

import { Storage } from '../lib/storage.js';

let activeCandidateProfile = null;
let stagedResumeFile = null;

document.addEventListener('DOMContentLoaded', async () => {
  setupTabs();
  await loadStatusAndKeys();
  await loadProfile();
  await loadDemographics();
  await loadMemoryBank();
  await loadCoverLetter();
  setupEventListeners();
});

// --- NAVIGATION TABS ---
function setupTabs() {
  const tabs = document.querySelectorAll('.nav-tab');
  const contents = document.querySelectorAll('.tab-content');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      contents.forEach(c => c.classList.remove('active'));

      tab.classList.add('active');
      const targetId = tab.getAttribute('data-tab');
      const targetContent = document.getElementById(targetId);
      if (targetContent) targetContent.classList.add('active');
    });
  });
}

// --- TAB 1 & 2: KEYS & INFERENCE ENGINE ---
async function loadStatusAndKeys() {
  const { keys, activeProvider } = await Storage.getApiKeys();

  const providerSelect = document.getElementById('select-active-provider');
  const primarySelect = document.getElementById('primary-provider-select');
  const keyGemini = document.getElementById('key-gemini');
  const keyGroq = document.getElementById('key-groq');
  const keyCerebras = document.getElementById('key-cerebras');

  providerSelect.value = activeProvider || 'gemini';
  primarySelect.value = activeProvider || 'gemini';

  keyGemini.value = keys.gemini || '';
  keyGroq.value = keys.groq || '';
  keyCerebras.value = keys.cerebras || '';
}

async function saveKeySettings() {
  const primaryProvider = document.getElementById('primary-provider-select').value;
  const keys = {
    gemini: document.getElementById('key-gemini').value.trim(),
    groq: document.getElementById('key-groq').value.trim(),
    cerebras: document.getElementById('key-cerebras').value.trim()
  };

  const fallbackOrder = ['groq', 'cerebras'].filter(p => p !== primaryProvider);

  await Storage.saveApiKeys(keys, primaryProvider, fallbackOrder);
  document.getElementById('select-active-provider').value = primaryProvider;
  showToast('API key settings saved successfully.');
}

function testSingleKey(providerId) {
  const inputEl = document.getElementById(`key-${providerId}`);
  const resultEl = document.getElementById(`test-${providerId}`);
  const apiKey = inputEl.value.trim();

  if (!apiKey) {
    resultEl.className = 'test-indicator error';
    resultEl.innerText = 'Key required';
    return;
  }

  resultEl.className = 'test-indicator';
  resultEl.innerText = 'Testing...';

  chrome.runtime.sendMessage({
    type: 'TEST_API_KEY',
    payload: { providerId, apiKey }
  }, (res) => {
    if (res?.data?.success) {
      resultEl.className = 'test-indicator success';
      resultEl.innerText = 'Active';
    } else {
      resultEl.className = 'test-indicator error';
      resultEl.innerText = 'Error: ' + (res?.data?.message || 'Check key');
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

// --- TAB 3: RESUME INTAKE & VERIFICATION ---
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
    document.getElementById('resume-file-status').classList.remove('hidden');
  }

  if (verified) {
    badge.innerText = 'Verified';
    badge.className = 'status-tag status-verified';
  } else {
    badge.innerText = 'Unverified';
    badge.className = 'status-tag status-unverified';
  }
}

function setupResumeDropzone() {
  const dropzone = document.getElementById('resume-dropzone');
  const fileInput = document.getElementById('resume-file-input');

  dropzone.addEventListener('click', () => fileInput.click());

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.style.borderColor = '#2563eb';
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

function handleSelectedResume(file) {
  stagedResumeFile = file;
  document.getElementById('resume-file-name').innerText = file.name;
  document.getElementById('resume-file-status').classList.remove('hidden');
  showToast('Loaded ' + file.name + '. Click Parse Profile.');
}

async function triggerResumeParse() {
  if (!stagedResumeFile) {
    showToast('Please select a resume file first.', true);
    return;
  }

  const loader = document.getElementById('parse-loading');
  loader.classList.remove('hidden');

  try {
    const arrayBuffer = await stagedResumeFile.arrayBuffer();
    const mimeType = stagedResumeFile.type || 'application/pdf';
    let resumeText = '';
    let pdfBase64 = null;

    if (stagedResumeFile.name.endsWith('.txt') || stagedResumeFile.name.endsWith('.md')) {
      resumeText = await stagedResumeFile.text();
    } else {
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      pdfBase64 = btoa(binary);
    }

    chrome.runtime.sendMessage({
      type: 'PARSE_RESUME',
      payload: {
        resumeText,
        pdfBase64,
        fileName: stagedResumeFile.name,
        mimeType,
        rawArrayBuffer: Array.from(new Uint8Array(arrayBuffer))
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
      showToast('Parsed via ' + providerUsed.toUpperCase() + '. Review fields below.');
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

async function confirmAndLockProfile() {
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
  document.getElementById('stat-candidate-name').innerText = fullName;
  const badge = document.getElementById('badge-verified');
  badge.innerText = 'Verified';
  badge.className = 'status-tag status-verified';
  showToast('Profile verified and saved.');
}

// --- TAB 4: DEMOGRAPHICS ---
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
  showToast('Demographic preferences saved.');
}

// --- TAB 5: MEMORY BANK ---
async function loadMemoryBank() {
  const items = await Storage.getMemoryBank();
  document.getElementById('stat-memory-count').innerText = items.length;
  renderMemoryItems(items);
}

function renderMemoryItems(items) {
  const container = document.getElementById('memory-items-list');
  if (items.length === 0) {
    container.innerHTML = `<div style="color: #94a3b8; padding: 10px; font-size: 11px; text-align: center;">No memory items saved yet.</div>`;
    return;
  }

  container.innerHTML = items.map(item => `
    <div class="memory-item">
      <div>
        <div class="mem-q">${escapeHtml(item.question)}</div>
        <div class="mem-a">${escapeHtml(item.answer)}</div>
      </div>
      <button class="btn-del-mem" data-id="${item.id}">Delete</button>
    </div>
  `).join('');

  container.querySelectorAll('.btn-del-mem').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      const all = await Storage.getMemoryBank();
      const updated = all.filter(m => m.id !== id);
      await Storage.saveMemoryBank(updated);
      await loadMemoryBank();
      showToast('Memory item removed.');
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

// --- TAB 6: COVER LETTER & FIT AUDIT ---
async function loadCoverLetter() {
  const { profile } = await Storage.getProfile();
  if (profile?.coverLetterText) {
    document.getElementById('cl-active-text').value = profile.coverLetterText;
  }
}

async function saveCoverLetter() {
  const text = document.getElementById('cl-active-text').value.trim();
  if (!activeCandidateProfile) activeCandidateProfile = { basic: {}, demographics: {} };
  activeCandidateProfile.coverLetterText = text;
  await Storage.saveProfile(activeCandidateProfile, true);
  showToast('Cover letter saved.');
}

async function runRoleFitAudit() {
  const coverLetterText = document.getElementById('cl-active-text').value.trim();
  if (!coverLetterText) {
    showToast('Please enter your cover letter first.', true);
    return;
  }

  showToast('Auditing cover letter fit on active tab...');
  const resultsCard = document.getElementById('cl-audit-results');
  resultsCard.classList.remove('hidden');
  document.getElementById('cl-score-num').innerText = '...';

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let jobMetadata = { title: 'Target Role', company: 'Target Company', descriptionSnippet: '' };

  if (tab?.id) {
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          let title = document.querySelector('h1, .job-title, .freebirdFormviewHeaderTitle')?.innerText?.trim() || document.title;
          let company = document.querySelector('.company-name')?.innerText?.trim() || window.location.hostname;
          let desc = document.querySelector('.job-description, article')?.innerText?.trim() || '';
          return { title, company, descriptionSnippet: desc.substring(0, 3000) };
        }
      });
      if (result) jobMetadata = result;
    } catch {
      // Use fallback metadata
    }
  }

  chrome.runtime.sendMessage({
    type: 'ANALYZE_COVER_LETTER',
    payload: { jobMetadata, coverLetterText }
  }, (res) => {
    if (!res?.success) {
      showToast('Audit failed: ' + (res?.error || 'Unknown'), true);
      return;
    }
    const audit = res.data;
    document.getElementById('cl-score-num').innerText = `${audit.matchScore}%`;
    document.getElementById('cl-verdict-text').innerText = `${audit.fitVerdict} (${jobMetadata.company})`;
    document.getElementById('cl-recommendations').innerText = (audit.recommendations || []).join(' | ');
    showToast('Audit complete (' + audit.matchScore + '% fit).');
  });
}

// --- EVENT LISTENERS ---
function setupEventListeners() {
  // Provider Selection
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
  document.getElementById('btn-confirm-profile').addEventListener('click', confirmAndLockProfile);

  // Demographics Tab
  document.getElementById('btn-save-demographics').addEventListener('click', saveDemographics);

  // Memory Tab
  setupMemorySearch();
  document.getElementById('btn-save-new-memory').addEventListener('click', async () => {
    const q = document.getElementById('new-mem-question').value.trim();
    const a = document.getElementById('new-mem-answer').value.trim();
    if (!q || !a) {
      showToast('Question and answer required.', true);
      return;
    }
    await Storage.addMemoryBankEntry(q, a, 'General');
    document.getElementById('new-mem-question').value = '';
    document.getElementById('new-mem-answer').value = '';
    await loadMemoryBank();
    showToast('Memory item added.');
  });

  // Cover Letter Tab
  document.getElementById('btn-save-cl').addEventListener('click', saveCoverLetter);
  document.getElementById('btn-run-fit-audit').addEventListener('click', runRoleFitAudit);

  // Page Action Triggers
  document.getElementById('btn-autofill-page').addEventListener('click', async () => {
    showToast('Running auto-fill...');
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const btn = document.getElementById('trackme-btn-autofill');
        if (btn) btn.click();
        else alert('TrackMe is active on this page. Double-click any field to refactor.');
      }
    });
  });

  document.getElementById('btn-attach-resume').addEventListener('click', async () => {
    showToast('Attaching resume...');
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const btn = document.getElementById('trackme-btn-attach-resume');
        if (btn) btn.click();
      }
    });
  });

  document.getElementById('btn-audit-fit').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const btn = document.getElementById('trackme-btn-audit-cl');
        if (btn) btn.click();
      }
    });
  });
}

function showToast(msg, isError = false) {
  const toast = document.getElementById('status-toast');
  toast.innerText = msg;
  toast.className = `status-toast ${isError ? 'error' : ''}`;
  setTimeout(() => {
    toast.className = 'status-toast hidden';
  }, 3500);
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
