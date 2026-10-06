/**
 * TrackMe Popup Controller
 */

import { Storage } from '../lib/storage.js';

document.addEventListener('DOMContentLoaded', async () => {
  const userNameEl = document.getElementById('user-name');
  const userHeadlineEl = document.getElementById('user-headline');
  const avatarInitialsEl = document.getElementById('avatar-initials');
  const badgeVerifiedEl = document.getElementById('badge-verified');
  const resumeStatusEl = document.getElementById('resume-status');
  const currentProviderNameEl = document.getElementById('current-provider-name');
  const providerSelect = document.getElementById('select-active-provider');
  const btnAutofill = document.getElementById('btn-autofill-page');
  const btnAttachResume = document.getElementById('btn-attach-resume');
  const btnAuditFit = document.getElementById('btn-audit-fit');
  const btnOpenSettings = document.getElementById('btn-open-settings');
  const linkDashboard = document.getElementById('link-dashboard');
  const toastEl = document.getElementById('status-toast');

  // Quick Keys Elements
  const btnToggleKeys = document.getElementById('btn-toggle-keys');
  const quickKeysPanel = document.getElementById('quick-keys-panel');
  const keysToggleArrow = document.getElementById('keys-toggle-arrow');
  const keyGemini = document.getElementById('popup-key-gemini');
  const keyGroq = document.getElementById('popup-key-groq');
  const keyCerebras = document.getElementById('popup-key-cerebras');
  const keyOpenRouter = document.getElementById('popup-key-openrouter');
  const btnSavePopupKeys = document.getElementById('btn-save-popup-keys');

  // Load Status and Keys
  const { keys, activeProvider } = await Storage.getApiKeys();
  providerSelect.value = activeProvider || 'gemini';
  currentProviderNameEl.innerText = providerSelect.options[providerSelect.selectedIndex]?.text.split(' ')[0] || 'Gemini';

  keyGemini.value = keys.gemini || '';
  keyGroq.value = keys.groq || '';
  keyCerebras.value = keys.cerebras || '';
  keyOpenRouter.value = keys.openrouter || '';

  // Load Profile details
  const { profile, verified, resumeMeta } = await Storage.getProfile();
  if (resumeMeta) {
    const sizeKb = Math.round((resumeMeta.size || 0) / 1024);
    resumeStatusEl.innerText = `${resumeMeta.fileName} (${sizeKb} KB)`;
  } else {
    resumeStatusEl.innerText = 'None';
  }

  if (profile && profile.basic) {
    userNameEl.innerText = profile.basic.fullName || `${profile.basic.firstName} ${profile.basic.lastName}`;
    userHeadlineEl.innerText = profile.basic.headline || profile.basic.location?.city || 'Profile Active';

    const names = userNameEl.innerText.split(' ');
    avatarInitialsEl.innerText = ((names[0]?.[0] || '') + (names[1]?.[0] || '')).toUpperCase() || 'TM';

    if (verified) {
      badgeVerifiedEl.innerText = 'Verified';
      badgeVerifiedEl.style.color = '#10b981';
    } else {
      badgeVerifiedEl.innerText = 'Unconfirmed';
      badgeVerifiedEl.style.color = '#f59e0b';
    }
  } else {
    userNameEl.innerText = 'Setup Required';
    userHeadlineEl.innerText = 'Upload resume in dashboard';
    badgeVerifiedEl.innerText = 'New';
  }

  // Toggle Quick Keys
  btnToggleKeys.addEventListener('click', () => {
    quickKeysPanel.classList.toggle('hidden');
    keysToggleArrow.innerText = quickKeysPanel.classList.contains('hidden') ? '▼' : '▲';
  });

  // Save Quick Keys
  btnSavePopupKeys.addEventListener('click', async () => {
    const currentData = await Storage.getApiKeys();
    const updatedKeys = {
      ...currentData.keys,
      gemini: keyGemini.value.trim(),
      groq: keyGroq.value.trim(),
      cerebras: keyCerebras.value.trim(),
      openrouter: keyOpenRouter.value.trim()
    };
    await Storage.saveApiKeys(updatedKeys, providerSelect.value, currentData.fallbackProviders);
    showToast('API keys saved successfully!');
    quickKeysPanel.classList.add('hidden');
    keysToggleArrow.innerText = '▼';
  });

  // Switch Active Inference Provider
  providerSelect.addEventListener('change', async () => {
    const newProvider = providerSelect.value;
    const currentData = await Storage.getApiKeys();
    await Storage.saveApiKeys(currentData.keys, newProvider, currentData.fallbackProviders);
    currentProviderNameEl.innerText = providerSelect.options[providerSelect.selectedIndex]?.text.split(' ')[0] || newProvider;
    showToast(`Active model switched to ${newProvider.toUpperCase()}`);
  });

  // Action: Autofill Current Tab
  btnAutofill.addEventListener('click', async () => {
    showToast('Triggering autofill...');
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const btn = document.getElementById('trackme-btn-autofill');
        if (btn) btn.click();
        else alert('TrackMe is active. On this page, click the TrackMe button or double-click any field.');
      }
    });
  });

  // Action: Attach Resume
  btnAttachResume.addEventListener('click', async () => {
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

  // Action: Audit Role Fit
  btnAuditFit.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const btn = document.getElementById('trackme-btn-audit-cl');
        if (btn) btn.click();
      }
    });
    window.close();
  });

  // Open Settings
  const openOptions = () => chrome.runtime.openOptionsPage();
  btnOpenSettings.addEventListener('click', openOptions);
  linkDashboard.addEventListener('click', (e) => {
    e.preventDefault();
    openOptions();
  });

  function showToast(msg, isError = false) {
    toastEl.innerText = msg;
    toastEl.className = `status-toast ${isError ? 'error' : ''}`;
    setTimeout(() => {
      toastEl.className = 'status-toast hidden';
    }, 3500);
  }
});
