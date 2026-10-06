/**
 * TrackMe Content Script
 * Injected on web pages to scan forms, provide a floating action widget,
 * inject autofill values, attach resume files, and run role-fit cover letter audits.
 */

(function () {
  // Prevent duplicate injection
  if (window.__trackMeInjected) return;
  window.__trackMeInjected = true;

  // --- FLOATING WIDGET CREATION ---
  function initFloatingWidget() {
    if (document.getElementById('trackme-widget-root')) return;

    const root = document.createElement('div');
    root.id = 'trackme-widget-root';
    root.innerHTML = `
      <div id="trackme-pill" title="TrackMe Application Assistant">
        <div class="trackme-logo-badge">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
          </svg>
        </div>
        <span class="trackme-pill-text">TrackMe</span>
        <button id="trackme-pill-toggle" aria-label="Toggle Panel">▲</button>
      </div>

      <div id="trackme-panel" class="trackme-hidden">
        <div class="trackme-panel-header">
          <div class="trackme-panel-title">
            <strong>TrackMe</strong> <span class="trackme-version">AI Assistant</span>
          </div>
          <button id="trackme-panel-close">✕</button>
        </div>

        <div class="trackme-panel-body">
          <div id="trackme-job-badge" class="trackme-info-banner">
            <span class="trackme-job-title">Detecting page...</span>
          </div>

          <div class="trackme-actions-grid">
            <button id="trackme-btn-autofill" class="trackme-btn trackme-btn-primary">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
              Auto-Fill Application
            </button>

            <button id="trackme-btn-attach-resume" class="trackme-btn trackme-btn-secondary">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
              Attach Resume File
            </button>

            <button id="trackme-btn-audit-cl" class="trackme-btn trackme-btn-secondary">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
              Audit Cover Letter Fit
            </button>

            <button id="trackme-btn-learn" class="trackme-btn trackme-btn-outline">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
              Save Manual Answers
            </button>
          </div>

          <div id="trackme-status-log" class="trackme-status-log">Ready</div>
        </div>

        <div class="trackme-panel-footer">
          <a id="trackme-link-options" href="#">⚙️ Open Dashboard</a>
        </div>
      </div>

      <!-- Audit Modal -->
      <div id="trackme-modal-audit" class="trackme-modal trackme-hidden">
        <div class="trackme-modal-card">
          <div class="trackme-modal-header">
            <h3>Cover Letter & Role-Fit Audit</h3>
            <button id="trackme-modal-close">✕</button>
          </div>
          <div id="trackme-audit-content" class="trackme-modal-body">
            <div class="trackme-spinner"></div> Analyzing role alignment...
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(root);
    setupWidgetEvents();
    updateDetectedJob();
  }

  function setupWidgetEvents() {
    const pill = document.getElementById('trackme-pill');
    const panel = document.getElementById('trackme-panel');
    const toggleBtn = document.getElementById('trackme-pill-toggle');
    const closeBtn = document.getElementById('trackme-panel-close');
    const fillBtn = document.getElementById('trackme-btn-autofill');
    const attachBtn = document.getElementById('trackme-btn-attach-resume');
    const auditBtn = document.getElementById('trackme-btn-audit-cl');
    const learnBtn = document.getElementById('trackme-btn-learn');
    const optionsLink = document.getElementById('trackme-link-options');
    const modal = document.getElementById('trackme-modal-audit');
    const modalClose = document.getElementById('trackme-modal-close');

    pill.addEventListener('click', () => {
      panel.classList.toggle('trackme-hidden');
      toggleBtn.innerText = panel.classList.contains('trackme-hidden') ? '▲' : '▼';
    });

    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.classList.add('trackme-hidden');
      toggleBtn.innerText = '▲';
    });

    fillBtn.addEventListener('click', () => handleAutofill());
    attachBtn.addEventListener('click', () => handleResumeAttachment());
    auditBtn.addEventListener('click', () => handleAuditCoverLetter());
    learnBtn.addEventListener('click', () => handleLearnAnswers());

    optionsLink.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.runtime.sendMessage({ type: 'GET_STATUS' }, () => {
        // Will open via extension link
      });
      window.open(chrome.runtime.getURL('options/options.html'));
    });

    modalClose.addEventListener('click', () => {
      modal.classList.add('trackme-hidden');
    });
  }

  function updateStatus(text, isError = false) {
    const log = document.getElementById('trackme-status-log');
    if (!log) return;
    log.innerText = text;
    log.style.color = isError ? '#ef4444' : '#10b981';
  }

  function updateDetectedJob() {
    const jobBadge = document.querySelector('.trackme-job-title');
    if (!jobBadge) return;
    const meta = extractJobMetadata();
    jobBadge.innerText = `${meta.company}: ${meta.title}`;
  }

  // --- CORE AUTOFILL LOGIC ---
  async function handleAutofill() {
    updateStatus('Scanning page fields...');
    const pageData = analyzePage();

    if (pageData.fields.length === 0) {
      updateStatus('No fillable application fields found.', true);
      return;
    }

    updateStatus(`Found ${pageData.fields.length} fields. Consulting AI model...`);

    chrome.runtime.sendMessage({
      type: 'ANALYZE_AND_FILL_PAGE',
      payload: {
        fields: pageData.fields,
        jobMetadata: pageData.jobMetadata
      }
    }, async (res) => {
      if (!res || !res.success) {
        updateStatus(`Fill failed: ${res?.error || 'Unknown error'}`, true);
        return;
      }

      const { fillMap } = res.data;
      let filledCount = 0;

      for (const [trackmeId, value] of Object.entries(fillMap)) {
        const el = document.querySelector(`[data-trackme-id="${CSS.escape(trackmeId)}"]`);
        if (el) {
          const success = fillElement(el, value);
          if (success) filledCount++;
        }
      }

      // Check if there is an empty resume upload button
      let fileAttached = false;
      const resumeInput = document.querySelector('input[type="file"]');
      if (resumeInput && (!resumeInput.files || resumeInput.files.length === 0)) {
        fileAttached = await handleResumeAttachment(true);
      }

      updateStatus(`Successfully filled ${filledCount} fields${fileAttached ? ' + attached resume' : ''}!`);
    });
  }

  // --- RESUME FILE ATTACHMENT VIA DATATRANSFER ---
  async function handleResumeAttachment(silent = false) {
    if (!silent) updateStatus('Retrieving stored resume file...');

    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'GET_RESUME_BINARY' }, (res) => {
        if (!res || !res.success || !res.data) {
          if (!silent) updateStatus('No resume uploaded yet. Visit Dashboard to upload.', true);
          resolve(false);
          return;
        }

        const { fileName, mimeType, arrayBuffer } = res.data;
        const blob = new Blob([new Uint8Array(arrayBuffer)], { type: mimeType });

        // Find file inputs
        const fileInputs = Array.from(document.querySelectorAll('input[type="file"]'));
        if (fileInputs.length === 0) {
          if (!silent) updateStatus('No file upload input found on this page.', true);
          resolve(false);
          return;
        }

        // Target resume input or first file input
        let targetInput = fileInputs.find(i => {
          const ctx = `${i.name} ${i.id} ${getLabelForElement(i)}`.toLowerCase();
          return ctx.includes('resume') || ctx.includes('cv');
        }) || fileInputs[0];

        try {
          const file = new File([blob], fileName, { type: mimeType, lastModified: Date.now() });
          const dt = new DataTransfer();
          dt.items.add(file);
          targetInput.files = dt.files;

          targetInput.dispatchEvent(new Event('input', { bubbles: true }));
          targetInput.dispatchEvent(new Event('change', { bubbles: true }));

          targetInput.style.border = '2px solid #10b981';
          targetInput.style.boxShadow = '0 0 10px #10b98160';

          if (!silent) updateStatus(`Attached resume "${fileName}" successfully!`);
          resolve(true);
        } catch (err) {
          if (!silent) updateStatus(`File attach error: ${err.message}`, true);
          resolve(false);
        }
      });
    });
  }

  // --- COVER LETTER ROLE FIT AUDIT ---
  async function handleAuditCoverLetter() {
    const modal = document.getElementById('trackme-modal-audit');
    const content = document.getElementById('trackme-audit-content');
    modal.classList.remove('trackme-hidden');
    content.innerHTML = `<div class="trackme-spinner"></div> Analyzing role alignment and ATS fit...`;

    // Extract page metadata
    const jobMetadata = extractJobMetadata();

    // Check if user has cover letter or prompt for one
    chrome.runtime.sendMessage({ type: 'GET_PROFILE' }, (profRes) => {
      const coverLetterText = profRes?.data?.profile?.coverLetterText ||
        'I am excited to apply for this role. With my background in software development, I have built performant systems...';

      chrome.runtime.sendMessage({
        type: 'ANALYZE_COVER_LETTER',
        payload: {
          jobMetadata,
          coverLetterText
        }
      }, (res) => {
        if (!res || !res.success) {
          content.innerHTML = `<div class="trackme-error-box">Audit failed: ${res?.error || 'Unknown'}</div>`;
          return;
        }

        const audit = res.data;
        content.innerHTML = `
          <div class="trackme-audit-card">
            <div class="trackme-score-circle">
              <span class="trackme-score-num">${audit.matchScore}%</span>
              <span class="trackme-score-label">Role Fit Score</span>
            </div>
            <div class="trackme-audit-details">
              <h4>${audit.fitVerdict}</h4>
              <p>Target: <strong>${jobMetadata.title}</strong> at <strong>${jobMetadata.company}</strong></p>
            </div>
          </div>

          <div class="trackme-audit-section">
            <h5>Matching Strengths</h5>
            <ul>${(audit.matchingStrengths || []).map(s => `<li>✅ ${s}</li>`).join('')}</ul>
          </div>

          <div class="trackme-audit-section">
            <h5>Missing / Recommended Keywords</h5>
            <div class="trackme-chips">${(audit.missingKeywords || []).map(k => `<span class="trackme-chip">${k}</span>`).join('')}</div>
          </div>

          <div class="trackme-audit-section">
            <h5>Recommendations</h5>
            <ul>${(audit.recommendations || []).map(r => `<li>💡 ${r}</li>`).join('')}</ul>
          </div>

          ${audit.tailoredHookSnippet ? `
            <div class="trackme-audit-section">
              <h5>Tailored Opening Hook (Personalized for ${jobMetadata.company})</h5>
              <blockquote class="trackme-snippet">${audit.tailoredHookSnippet}</blockquote>
            </div>
          ` : ''}
        `;
      });
    });
  }

  // --- LEARN MANUAL ANSWERS INTO MEMORY BANK ---
  function handleLearnAnswers() {
    const inputs = document.querySelectorAll('input:not([type="hidden"]):not([type="password"]), textarea, select');
    let learnedCount = 0;

    inputs.forEach(el => {
      const val = el.value?.trim();
      const label = getLabelForElement(el);
      if (val && label && val.length > 2 && label.length > 3) {
        chrome.runtime.sendMessage({
          type: 'UPDATE_MEMORY_BANK',
          payload: {
            question: label,
            answer: val,
            category: 'Learned'
          }
        });
        learnedCount++;
      }
    });

    updateStatus(`Captured ${learnedCount} answers into Memory Bank!`);
  }

  // --- DOM ANALYSIS HELPERS ---
  function analyzePage() {
    const fields = [];
    const elements = document.querySelectorAll('input, select, textarea');
    let counter = 0;

    elements.forEach(el => {
      const type = (el.type || '').toLowerCase();
      if (['password', 'hidden', 'submit', 'reset', 'button', 'image'].includes(type)) return;
      if (el.style.display === 'none' || el.style.visibility === 'hidden') return;

      const label = getLabelForElement(el);
      const isFileInput = type === 'file';

      let options = [];
      if (el.tagName.toLowerCase() === 'select') {
        options = Array.from(el.options).map(o => ({ value: o.value, text: o.text.trim() }));
      }

      let trackmeId = el.getAttribute('data-trackme-id');
      if (!trackmeId) {
        trackmeId = `tm_${++counter}_${el.name || el.id || 'field'}`;
        el.setAttribute('data-trackme-id', trackmeId);
      }

      fields.push({
        trackmeId,
        tagName: el.tagName.toLowerCase(),
        type,
        name: el.name || '',
        id: el.id || '',
        label,
        placeholder: el.placeholder || '',
        ariaLabel: el.getAttribute('aria-label') || '',
        surroundingQuestion: getSurroundingQuestion(el),
        options,
        isFileInput,
        required: el.required
      });
    });

    return {
      fields,
      jobMetadata: extractJobMetadata()
    };
  }

  function getLabelForElement(el) {
    // 1. Google Forms support: .geS5n, [role="listitem"], .Qr7Oae, .M7eMe
    const gContainer = el.closest('[role="listitem"], .geS5n, .Qr7Oae, .k3920b');
    if (gContainer) {
      const gTitle = gContainer.querySelector('.M7eMe, [role="heading"], .HoXoMd, .F9Nuk');
      if (gTitle && gTitle.innerText.trim()) {
        return gTitle.innerText.trim();
      }
    }

    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) return l.innerText.trim();
    }
    const parentLabel = el.closest('label');
    if (parentLabel) return parentLabel.innerText.trim();
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label').trim();
    return el.placeholder || el.name || '';
  }

  function getSurroundingQuestion(el) {
    const container = el.closest('[role="listitem"], .geS5n, .form-group, .field, .input-container, tr, div');
    if (container) {
      const heading = container.querySelector('.M7eMe, [role="heading"], h2, h3, h4, strong, legend');
      if (heading) return heading.innerText.trim();
    }
    return '';
  }

  function extractJobMetadata() {
    let title = document.querySelector('h1, .job-title, [data-automation-id="jobTitle"], .freebirdFormviewHeaderTitle, .F9vfv')?.innerText?.trim() || '';
    if (!title) title = document.title.split(/[-|–]/)[0]?.trim() || 'Application Form';

    let company = document.querySelector('.company-name, [data-automation-id="companyName"]')?.innerText?.trim() || '';
    if (!company) {
      const parts = window.location.hostname.split('.');
      company = parts.length >= 2 ? parts[parts.length - 2].toUpperCase() : 'Company';
    }

    const desc = document.querySelector('.job-description, #job-description, .freebirdFormviewHeaderDescription, article')?.innerText?.trim() || '';

    return { title, company, descriptionSnippet: desc.substring(0, 3000) };
  }

  function fillElement(el, value) {
    if (value === undefined || value === null) return false;
    const tagName = el.tagName.toLowerCase();
    const type = (el.type || '').toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();

    // Google Forms role="radio" and role="checkbox"
    if (role === 'radio') {
      el.click();
      el.dispatchEvent(new Event('click', { bubbles: true }));
      markFilled(el);
      return true;
    } else if (role === 'checkbox') {
      const isChecked = el.getAttribute('aria-checked') === 'true';
      const shouldCheck = ['true', 'yes', '1', true].includes(value);
      if (isChecked !== shouldCheck) {
        el.click();
        el.dispatchEvent(new Event('click', { bubbles: true }));
      }
      markFilled(el);
      return true;
    }

    if (tagName === 'select') {
      const options = Array.from(el.options);
      const target = String(value).toLowerCase().trim();
      let match = options.find(o => o.value.toLowerCase().trim() === target || o.text.toLowerCase().trim() === target);
      if (!match) {
        match = options.find(o => o.text.toLowerCase().includes(target) || target.includes(o.text.toLowerCase()));
      }
      if (match) {
        el.selectedIndex = match.index;
        el.value = match.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        markFilled(el);
        return true;
      }
      return false;
    } else if (type === 'checkbox') {
      el.checked = ['true', 'yes', '1', true].includes(value);
      el.dispatchEvent(new Event('change', { bubbles: true }));
      markFilled(el);
      return true;
    } else {
      // Focus & Prototype hijack for React + Google Forms
      el.focus();
      const proto = Object.getPrototypeOf(el);
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) {
        setter.call(el, String(value));
      } else {
        el.value = String(value);
      }
      if (el._valueTracker) {
        el._valueTracker.setValue(String(value));
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ' ' }));
      el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ' ' }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
      markFilled(el);
      return true;
    }
  }

  function markFilled(el) {
    el.style.outline = '1px solid #2563eb';
    setTimeout(() => {
      el.style.outline = '';
    }, 2500);
  }

  // --- INTERACTIVE IN-PLACE DOUBLE-CLICK REFACTORING ---
  function setupDoubleClickRefactoring() {
    document.addEventListener('dblclick', async (e) => {
      const target = e.target;
      if (!target) return;

      const tagName = target.tagName.toLowerCase();
      const type = (target.type || '').toLowerCase();

      // Only target editable text fields & textareas
      const isEditableText = tagName === 'textarea' ||
        (tagName === 'input' && ['text', 'url', 'email', 'tel', 'number', 'search', ''].includes(type));

      if (!isEditableText) return;
      if (target.readOnly || target.disabled) return;
      if (['password', 'hidden', 'file', 'checkbox', 'radio', 'submit', 'button', 'reset'].includes(type)) return;

      // Ignore double clicks inside TrackMe's own UI
      if (target.closest('#trackme-widget-root') || target.closest('.trackme-modal')) return;

      // Track iteration / variation count for this field
      target.__trackmeRegenCount = (target.__trackmeRegenCount || 0) + 1;
      const iteration = target.__trackmeRegenCount;

      const label = getLabelForElement(target) || target.name || target.placeholder || 'Job application question';
      const questionContext = getSurroundingQuestion(target);
      const currentAnswer = target.value || '';
      const jobMetadata = extractJobMetadata();

      // Visual feedback: shimmer border + inline badge
      target.classList.add('trackme-field-refactoring');
      showInlineFeedback(target, `✨ Refactoring answer with AI (Variation #${iteration})...`);

      chrome.runtime.sendMessage({
        type: 'REGENERATE_FIELD_ANSWER',
        payload: {
          fieldLabel: label,
          questionContext,
          currentAnswer,
          jobMetadata,
          iteration
        }
      }, (res) => {
        target.classList.remove('trackme-field-refactoring');

        if (res && res.success && res.data?.newAnswer) {
          fillElement(target, res.data.newAnswer);
          showInlineFeedback(
            target,
            `✨ Refactored via ${res.data.providerUsed?.toUpperCase()}! (Double-click again to cycle)`
          );
        } else {
          showInlineFeedback(target, `❌ ${res?.error || 'Refactor failed'}`, true);
        }
      });
    });
  }

  // Floating mini tooltip above the target element
  function showInlineFeedback(el, text, isError = false) {
    let tooltip = document.getElementById('trackme-inline-tooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.id = 'trackme-inline-tooltip';
      document.body.appendChild(tooltip);
    }

    const rect = el.getBoundingClientRect();
    const top = Math.max(10, rect.top + window.scrollY - 36);
    const left = Math.max(10, rect.left + window.scrollX);

    tooltip.innerText = text;
    tooltip.className = `trackme-inline-tooltip ${isError ? 'error' : ''}`;
    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
    tooltip.style.display = 'block';

    clearTimeout(tooltip.__fadeTimer);
    tooltip.__fadeTimer = setTimeout(() => {
      tooltip.style.display = 'none';
    }, 3200);
  }

  // Initialize on load
  function init() {
    initFloatingWidget();
    setupDoubleClickRefactoring();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
