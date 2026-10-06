/**
 * TrackMe Options & Dashboard Controller
 */

import { Storage } from '../lib/storage.js';

let activeCandidateProfile = null;
let stagedResumeFile = null;

document.addEventListener('DOMContentLoaded', async () => {
  setupNavigation();
  await loadApiKeys();
  await loadProfile();
  await loadMemoryBank();
  await loadCoverLetter();
  setupEventListeners();
});

// --- NAVIGATION TABS ---
function setupNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  const panes = document.querySelectorAll('.tab-pane');

  navItems.forEach((btn) => {
    btn.addEventListener('click', () => {
      navItems.forEach(b => b.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const targetId = btn.getAttribute('data-tab');
      const targetPane = document.getElementById(targetId);
      if (targetPane) targetPane.classList.add('active');
    });
  });
}

// --- API KEYS MANAGEMENT ---
async function loadApiKeys() {
  const { keys, activeProvider } = await Storage.getApiKeys();

  document.getElementById('primary-provider-select').value = activeProvider || 'gemini';
  document.getElementById('key-gemini').value = keys.gemini || '';
  document.getElementById('key-cerebras').value = keys.cerebras || '';
  document.getElementById('key-groq').value = keys.groq || '';
  document.getElementById('key-openrouter').value = keys.openrouter || '';
  document.getElementById('key-sambanova').value = keys.sambanova || '';
  document.getElementById('key-together').value = keys.together || '';
  document.getElementById('key-cloudflare').value = keys.cloudflare || '';
  document.getElementById('extra-cf-account').value = keys.cloudflare_account || '';
}

async function saveApiKeys() {
  const primaryProvider = document.getElementById('primary-provider-select').value;
  const keys = {
    gemini: document.getElementById('key-gemini').value.trim(),
    cerebras: document.getElementById('key-cerebras').value.trim(),
    groq: document.getElementById('key-groq').value.trim(),
    openrouter: document.getElementById('key-openrouter').value.trim(),
    sambanova: document.getElementById('key-sambanova').value.trim(),
    together: document.getElementById('key-together').value.trim(),
    cloudflare: document.getElementById('key-cloudflare').value.trim(),
    cloudflare_account: document.getElementById('extra-cf-account').value.trim()
  };

  const fallbackOrder = ['groq', 'cerebras', 'openrouter', 'sambanova', 'together', 'cloudflare']
    .filter(p => p !== primaryProvider);

  await Storage.saveApiKeys(keys, primaryProvider, fallbackOrder);
  showToast('API Key settings and routing priority saved!');
}

async function testSingleKey(providerId) {
  const inputEl = document.getElementById(`key-${providerId}`);
  const resultEl = document.getElementById(`test-${providerId}`);
  const apiKey = inputEl.value.trim();

  if (!apiKey) {
    resultEl.className = 'test-result error';
    resultEl.innerText = 'Please enter an API key first.';
    return;
  }

  resultEl.className = 'test-result';
  resultEl.innerText = 'Testing...';

  const extraConfig = {};
  if (providerId === 'cloudflare') {
    extraConfig.accountId = document.getElementById('extra-cf-account').value.trim();
  }

  chrome.runtime.sendMessage({
    type: 'TEST_API_KEY',
    payload: { providerId, apiKey, extraConfig }
  }, (res) => {
    if (res?.data?.success) {
      resultEl.className = 'test-result success';
      resultEl.innerText = '✅ Active & Verified';
    } else {
      resultEl.className = 'test-result error';
      resultEl.innerText = `❌ Error: ${res?.data?.message || 'Check key'}`;
    }
  });
}

// --- RESUME INTAKE & "FINAL RUN" VERIFICATION ---
async function loadProfile() {
  const { profile, verified, resumeMeta } = await Storage.getProfile();
  activeCandidateProfile = profile;

  if (resumeMeta) {
    const banner = document.getElementById('selected-file-info');
    const nameEl = document.getElementById('file-name-display');
    const sizeEl = document.getElementById('file-size-display');
    banner.classList.remove('hidden');
    nameEl.innerText = resumeMeta.fileName;
    sizeEl.innerText = `(${Math.round(resumeMeta.size / 1024)} KB) - Saved`;
  }

  if (profile) {
    populateVerificationForm(profile);
    populateDemographicsForm(profile.demographics);
    if (verified) {
      document.getElementById('final-run-container').classList.remove('hidden');
    }
  }
}

function setupDropzone() {
  const dropzone = document.getElementById('resume-dropzone');
  const fileInput = document.getElementById('resume-file-input');
  const browseBtn = document.getElementById('btn-browse-resume');

  browseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
  });

  dropzone.addEventListener('click', () => fileInput.click());

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.style.borderColor = '#6366f1';
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.style.borderColor = '';
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.style.borderColor = '';
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleSelectedFile(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files[0]) {
      handleSelectedFile(fileInput.files[0]);
    }
  });
}

function handleSelectedFile(file) {
  stagedResumeFile = file;
  const banner = document.getElementById('selected-file-info');
  const nameEl = document.getElementById('file-name-display');
  const sizeEl = document.getElementById('file-size-display');

  banner.classList.remove('hidden');
  nameEl.innerText = file.name;
  sizeEl.innerText = `(${Math.round(file.size / 1024)} KB)`;
  showToast(`Loaded ${file.name}. Click "Run AI Extraction" to begin.`);
}

async function triggerResumeParse() {
  if (!stagedResumeFile) {
    // Check if we have an existing profile
    if (activeCandidateProfile) {
      showToast('Displaying existing verified profile.');
      document.getElementById('final-run-container').classList.remove('hidden');
      return;
    }
    showToast('Please select a resume file first.', true);
    return;
  }

  const loader = document.getElementById('parse-loading');
  const finalRun = document.getElementById('final-run-container');
  loader.classList.remove('hidden');
  finalRun.classList.add('hidden');

  try {
    const arrayBuffer = await stagedResumeFile.arrayBuffer();
    const mimeType = stagedResumeFile.type || 'application/pdf';

    let resumeText = '';
    let pdfBase64 = null;

    if (stagedResumeFile.name.endsWith('.txt') || stagedResumeFile.name.endsWith('.md')) {
      resumeText = await stagedResumeFile.text();
    } else {
      // PDF or binary: convert to base64 for multimodal LLM parsing
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
      if (!res || !res.success) {
        showToast(`Parsing failed: ${res?.error || 'Unknown error'}`, true);
        return;
      }

      const { profile, providerUsed } = res.data;
      activeCandidateProfile = profile;
      populateVerificationForm(profile);
      populateDemographicsForm(profile.demographics);

      finalRun.classList.remove('hidden');
      finalRun.scrollIntoView({ behavior: 'smooth' });
      showToast(`Resume parsed successfully via ${providerUsed.toUpperCase()}! Inspect fields for Final Run.`);
    });
  } catch (err) {
    loader.classList.add('hidden');
    showToast(`File error: ${err.message}`, true);
  }
}

function populateVerificationForm(profile) {
  const b = profile.basic || {};
  document.getElementById('prof-fullName').value = b.fullName || '';
  document.getElementById('prof-firstName').value = b.firstName || '';
  document.getElementById('prof-lastName').value = b.lastName || '';
  document.getElementById('prof-email').value = b.email || '';
  document.getElementById('prof-phone').value = b.phone || '';
  document.getElementById('prof-rollNo').value = b.rollNo || '';
  document.getElementById('prof-city').value = b.location?.city ? `${b.location.city}, ${b.location.state || ''}` : '';
  document.getElementById('prof-country').value = b.location?.country ? `${b.location.country} ${b.location.postalCode || ''}` : '';
  document.getElementById('prof-linkedin').value = b.linkedin || '';
  document.getElementById('prof-github').value = b.github || '';
  document.getElementById('prof-portfolio').value = b.portfolio || '';
  document.getElementById('prof-headline').value = b.headline || '';
  document.getElementById('prof-skills').value = Array.isArray(profile.skills) ? profile.skills.join(', ') : (profile.skills || '');
}

async function confirmAndLockProfile() {
  if (!activeCandidateProfile) activeCandidateProfile = { basic: {}, demographics: {} };

  // Harvest edited values from the Final Run verification screen
  const fullName = document.getElementById('prof-fullName').value.trim();
  const firstName = document.getElementById('prof-firstName').value.trim();
  const lastName = document.getElementById('prof-lastName').value.trim();
  const email = document.getElementById('prof-email').value.trim();
  const phone = document.getElementById('prof-phone').value.trim();
  const rollNo = document.getElementById('prof-rollNo').value.trim();
  const cityState = document.getElementById('prof-city').value.trim();
  const countryZip = document.getElementById('prof-country').value.trim();
  const linkedin = document.getElementById('prof-linkedin').value.trim();
  const github = document.getElementById('prof-github').value.trim();
  const portfolio = document.getElementById('prof-portfolio').value.trim();
  const headline = document.getElementById('prof-headline').value.trim();
  const skillsStr = document.getElementById('prof-skills').value.trim();

  activeCandidateProfile.basic = {
    ...activeCandidateProfile.basic,
    fullName,
    firstName: firstName || fullName.split(' ')[0] || '',
    lastName: lastName || fullName.split(' ').slice(1).join(' ') || '',
    email,
    phone,
    rollNo,
    location: {
      city: cityState.split(',')[0]?.trim() || cityState,
      state: cityState.split(',')[1]?.trim() || '',
      country: countryZip.split(' ')[0]?.trim() || countryZip,
      postalCode: countryZip.split(' ')[1]?.trim() || ''
    },
    linkedin,
    github,
    portfolio,
    headline
  };

  activeCandidateProfile.skills = skillsStr.split(',').map(s => s.trim()).filter(Boolean);

  chrome.runtime.sendMessage({
    type: 'CONFIRM_VERIFIED_PROFILE',
    payload: { profile: activeCandidateProfile }
  }, (res) => {
    if (res?.data?.verified) {
      showToast('🎉 Profile verified and locked! Ready for auto-filling.');
    }
  });
}

// --- DEMOGRAPHICS & PERSONAL ANSWERS ---
function populateDemographicsForm(demo = {}) {
  if (!demo) return;
  document.getElementById('demo-legallyAuthorized').value = demo.legallyAuthorized || 'Yes';
  document.getElementById('demo-requireSponsorship').value = demo.requireSponsorship || 'No';
  document.getElementById('demo-sponsorshipDetails').value = demo.sponsorshipDetails || '';
  document.getElementById('demo-disabilityStatus').value = demo.disabilityStatus || 'No, I do not have a disability';
  document.getElementById('demo-veteranStatus').value = demo.veteranStatus || 'I am not a protected veteran';
  document.getElementById('demo-gender').value = demo.gender || 'Prefer not to disclose';
  document.getElementById('demo-pronouns').value = demo.pronouns || 'Prefer not to say';
  document.getElementById('demo-raceEthnicity').value = demo.raceEthnicity || 'Prefer not to disclose';
  document.getElementById('demo-salaryExpectation').value = demo.salaryExpectation || '';
  document.getElementById('demo-noticePeriod').value = demo.noticePeriod || '';
  document.getElementById('demo-willingToRelocate').value = demo.willingToRelocate || 'Yes';
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
    raceEthnicity: document.getElementById('demo-raceEthnicity').value,
    salaryExpectation: document.getElementById('demo-salaryExpectation').value.trim(),
    noticePeriod: document.getElementById('demo-noticePeriod').value.trim(),
    willingToRelocate: document.getElementById('demo-willingToRelocate').value
  };

  await Storage.saveProfile(activeCandidateProfile, true);
  showToast('Demographic and personal compliance preferences updated!');
}

// --- MEMORY BANK ---
async function loadMemoryBank() {
  const items = await Storage.getMemoryBank();
  renderMemoryItems(items);
}

function renderMemoryItems(items) {
  const container = document.getElementById('memory-items-list');
  if (items.length === 0) {
    container.innerHTML = `<div class="card full-width text-center" style="grid-column: 1 / -1; color: #94a3b8; padding: 30px;">
      No memory items saved yet. When you answer unique questions on application pages, TrackMe can memorize them here!
    </div>`;
    return;
  }

  container.innerHTML = items.map(item => `
    <div class="memory-card" data-id="${item.id}">
      <div class="memory-card-header">
        <span class="memory-card-question">${escapeHtml(item.question)}</span>
        <span class="badge badge-purple">${escapeHtml(item.category || 'General')}</span>
      </div>
      <div class="memory-card-answer">${escapeHtml(item.answer)}</div>
      <div class="memory-card-footer">
        <span class="text-muted">${new Date(item.updatedAt || Date.now()).toLocaleDateString()}</span>
        <button class="btn btn-sm btn-outline btn-del-mem" data-id="${item.id}">Delete</button>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.btn-del-mem').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      const all = await Storage.getMemoryBank();
      const updated = all.filter(m => m.id !== id);
      await Storage.saveMemoryBank(updated);
      renderMemoryItems(updated);
      showToast('Memory item removed.');
    });
  });
}

function setupMemorySearch() {
  const searchInput = document.getElementById('memory-search-input');
  searchInput.addEventListener('input', async () => {
    const q = searchInput.value.toLowerCase().trim();
    const all = await Storage.getMemoryBank();
    const filtered = all.filter(m => m.question.toLowerCase().includes(q) || m.answer.toLowerCase().includes(q));
    renderMemoryItems(filtered);
  });
}

// --- COVER LETTER & ROLE MATCH SIMULATOR ---
async function loadCoverLetter() {
  const { profile } = await Storage.getProfile();
  const textarea = document.getElementById('cl-active-text');
  if (profile?.coverLetterText) {
    textarea.value = profile.coverLetterText;
  }
}

async function saveCoverLetter() {
  const text = document.getElementById('cl-active-text').value.trim();
  if (!activeCandidateProfile) activeCandidateProfile = { basic: {}, demographics: {} };
  activeCandidateProfile.coverLetterText = text;
  await Storage.saveProfile(activeCandidateProfile, true);
  document.getElementById('cl-save-status').innerText = 'Saved!';
  setTimeout(() => document.getElementById('cl-save-status').innerText = '', 3000);
  showToast('Cover letter saved to library.');
}

async function runRoleFitAudit() {
  const coverLetterText = document.getElementById('cl-active-text').value.trim();
  const company = document.getElementById('sim-company').value.trim() || 'Target Company';
  const title = document.getElementById('sim-role').value.trim() || 'Target Role';
  const descriptionSnippet = document.getElementById('sim-jd').value.trim();

  if (!coverLetterText) {
    showToast('Please enter your cover letter content first.', true);
    return;
  }

  showToast('Auditing cover letter fit against role requirements...');
  const resultsCard = document.getElementById('cl-audit-results');
  resultsCard.classList.remove('hidden');
  document.getElementById('sim-score-val').innerText = '...';

  chrome.runtime.sendMessage({
    type: 'ANALYZE_COVER_LETTER',
    payload: {
      jobMetadata: { company, title, descriptionSnippet },
      coverLetterText
    }
  }, (res) => {
    if (!res || !res.success) {
      showToast(`Audit failed: ${res?.error || 'Unknown error'}`, true);
      return;
    }

    const audit = res.data;
    document.getElementById('sim-score-val').innerText = `${audit.matchScore}%`;
    document.getElementById('sim-fit-verdict').innerText = audit.fitVerdict;
    document.getElementById('sim-fit-subtext').innerText = `${title} at ${company}`;

    const strengthsList = document.getElementById('sim-strengths-list');
    strengthsList.innerHTML = (audit.matchingStrengths || []).map(s => `<li>${escapeHtml(s)}</li>`).join('');

    const keywordsBox = document.getElementById('sim-keywords-box');
    keywordsBox.innerHTML = (audit.missingKeywords || []).map(k => `<span class="badge badge-amber">${escapeHtml(k)}</span>`).join('');

    const recsList = document.getElementById('sim-recommendations-list');
    recsList.innerHTML = (audit.recommendations || []).map(r => `<li>${escapeHtml(r)}</li>`).join('');

    if (audit.tailoredHookSnippet) {
      document.getElementById('sim-tailored-box').classList.remove('hidden');
      document.getElementById('sim-tailored-text').innerText = audit.tailoredHookSnippet;
    } else {
      document.getElementById('sim-tailored-box').classList.add('hidden');
    }

    resultsCard.scrollIntoView({ behavior: 'smooth' });
    showToast(`Role fit audit complete (${audit.matchScore}% match)!`);
  });
}

// --- EVENT LISTENERS ---
function setupEventListeners() {
  // Key actions
  document.getElementById('btn-save-keys').addEventListener('click', saveApiKeys);
  setupKeyUpload();
  document.querySelectorAll('.btn-test-key').forEach(btn => {
    btn.addEventListener('click', () => {
      const provider = btn.getAttribute('data-provider');
      testSingleKey(provider);
    });
  });

  // Resume Dropzone & Verification
  setupDropzone();
  document.getElementById('btn-parse-resume').addEventListener('click', triggerResumeParse);
  document.getElementById('btn-confirm-profile').addEventListener('click', confirmAndLockProfile);

  // Demographics
  document.getElementById('btn-save-demographics').addEventListener('click', saveDemographics);

  // Memory Modal
  setupMemorySearch();
  const modalMemory = document.getElementById('modal-memory-form');
  document.getElementById('btn-add-memory').addEventListener('click', () => modalMemory.classList.remove('hidden'));
  document.getElementById('btn-close-modal-memory').addEventListener('click', () => modalMemory.classList.add('hidden'));

  document.getElementById('btn-save-new-memory').addEventListener('click', async () => {
    const q = document.getElementById('new-mem-question').value.trim();
    const cat = document.getElementById('new-mem-category').value;
    const a = document.getElementById('new-mem-answer').value.trim();

    if (!q || !a) {
      showToast('Please provide both question and answer.', true);
      return;
    }

    await Storage.addMemoryBankEntry(q, a, cat);
    modalMemory.classList.add('hidden');
    document.getElementById('new-mem-question').value = '';
    document.getElementById('new-mem-answer').value = '';
    await loadMemoryBank();
    showToast('Memory item added!');
  });

  // Cover Letter
  document.getElementById('btn-save-cl').addEventListener('click', saveCoverLetter);
  document.getElementById('btn-run-fit-audit').addEventListener('click', runRoleFitAudit);
}

function setupKeyUpload() {
  const btn = document.getElementById('btn-upload-keys');
  const fileInput = document.getElementById('upload-keys-file');
  if (!btn || !fileInput) return;

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
          cerebras: json.cerebras || json.CEREBRAS_API_KEY || '',
          openrouter: json.openrouter || json.OPENROUTER_API_KEY || '',
          sambanova: json.sambanova || json.SAMBANOVA_API_KEY || '',
          together: json.together || json.TOGETHER_API_KEY || '',
          cloudflare: json.cloudflare || json.CLOUDFLARE_API_KEY || json.CLOUDFLARE_API_TOKEN || '',
          cloudflare_account: json.cloudflare_account || json.CLOUDFLARE_ACCOUNT_ID || ''
        };
      } else {
        // Parse .env KEY=VALUE
        const lines = text.split('\n');
        for (const line of lines) {
          const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*["']?(.*?)["']?\s*$/);
          if (match) {
            const k = match[1].toUpperCase();
            const v = match[2].trim();
            if (k.includes('GEMINI')) imported.gemini = v;
            else if (k.includes('GROQ')) imported.groq = v;
            else if (k.includes('CEREBRAS')) imported.cerebras = v;
            else if (k.includes('OPENROUTER')) imported.openrouter = v;
            else if (k.includes('SAMBANOVA')) imported.sambanova = v;
            else if (k.includes('TOGETHER')) imported.together = v;
            else if (k.includes('CLOUDFLARE_ACCOUNT')) imported.cloudflare_account = v;
            else if (k.includes('CLOUDFLARE')) imported.cloudflare = v;
          }
        }
      }

      if (imported.gemini) document.getElementById('key-gemini').value = imported.gemini;
      if (imported.groq) document.getElementById('key-groq').value = imported.groq;
      if (imported.cerebras) document.getElementById('key-cerebras').value = imported.cerebras;
      if (imported.openrouter) document.getElementById('key-openrouter').value = imported.openrouter;
      if (imported.sambanova) document.getElementById('key-sambanova').value = imported.sambanova;
      if (imported.together) document.getElementById('key-together').value = imported.together;
      if (imported.cloudflare) document.getElementById('key-cloudflare').value = imported.cloudflare;
      if (imported.cloudflare_account) document.getElementById('extra-cf-account').value = imported.cloudflare_account;

      await saveApiKeys();
      showToast(`Imported API keys from ${file.name} successfully!`);
    } catch (err) {
      showToast(`Key import failed: ${err.message}`, true);
    }
  });
}

function showToast(msg, isError = false) {
  const toast = document.getElementById('global-toast');
  toast.innerText = msg;
  toast.style.borderColor = isError ? '#ef4444' : '#6366f1';
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 4000);
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
