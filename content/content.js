/**
 * TrackMe Content Script
 * Injected silently on web pages.
 * Only acts when triggered explicitly via the extension popup/sidepanel,
 * or when the user double-clicks a form field to refactor it in-place.
 * NO floating pills or intrusive UI elements are injected into pages.
 */

(function () {
  if (window.__trackMeInjected) return;
  window.__trackMeInjected = true;

  // Listen for extension commands
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'FILL_ACTIVE_PAGE': {
        handleAutofill()
          .then((res) => sendResponse({ success: true, data: res }))
          .catch((err) => sendResponse({ success: false, error: err.message }));
        return true;
      }

      case 'ATTACH_ACTIVE_RESUME': {
        handleResumeAttachment(false)
          .then((attached) => sendResponse({ success: true, attached }))
          .catch((err) => sendResponse({ success: false, error: err.message }));
        return true;
      }

      case 'GET_PAGE_INFO': {
        try {
          const pageData = analyzePage();
          sendResponse({
            success: true,
            data: {
              fieldCount: pageData.fields.length,
              fileFieldsCount: pageData.fields.filter(f => f.isFileInput).length,
              jobMetadata: pageData.jobMetadata
            }
          });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
        return false;
      }

      default:
        return false;
    }
  });

  // --- CORE AUTOFILL LOGIC ---
  async function handleAutofill() {
    const pageData = analyzePage();

    if (pageData.fields.length === 0) {
      throw new Error('No fillable application fields found on this page.');
    }

    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        type: 'ANALYZE_AND_FILL_PAGE',
        payload: {
          fields: pageData.fields,
          jobMetadata: pageData.jobMetadata
        }
      }, async (res) => {
        if (!res || !res.success) {
          reject(new Error(res?.error || 'Auto-fill service failed.'));
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

        // Auto attach resume if an empty file input exists
        let fileAttached = false;
        const resumeInput = document.querySelector('input[type="file"]');
        if (resumeInput && (!resumeInput.files || resumeInput.files.length === 0)) {
          fileAttached = await handleResumeAttachment(true);
        }

        resolve({
          filledCount,
          totalFields: pageData.fields.length,
          fileAttached
        });
      });
    });
  }

  // --- RESUME ATTACHMENT VIA DATATRANSFER ---
  async function handleResumeAttachment(silent = false) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'GET_RESUME_BINARY' }, (res) => {
        if (!res || !res.success || !res.data) {
          resolve(false);
          return;
        }

        const { fileName, mimeType, arrayBuffer } = res.data;
        const blob = new Blob([new Uint8Array(arrayBuffer)], { type: mimeType });

        const fileInputs = Array.from(document.querySelectorAll('input[type="file"]'));
        if (fileInputs.length === 0) {
          resolve(false);
          return;
        }

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

          markFilled(targetInput);
          resolve(true);
        } catch {
          resolve(false);
        }
      });
    });
  }

  // --- PAGE FORM ANALYSIS ---
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
    // Google Forms support: [role="listitem"], .geS5n, .Qr7Oae, .M7eMe
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
    if (!title) title = document.title.split(/[-|–]/)[0]?.trim() || 'Application';

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
      // Focus & Prototype setter for React + Google Forms
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
    el.classList.add('trackme-filled-highlight');
    setTimeout(() => {
      el.classList.remove('trackme-filled-highlight');
    }, 2000);
  }

  // --- DOUBLE-CLICK IN-PLACE REFACTORING ---
  function setupDoubleClickRefactoring() {
    document.addEventListener('dblclick', async (e) => {
      const target = e.target;
      if (!target) return;

      const tagName = target.tagName.toLowerCase();
      const type = (target.type || '').toLowerCase();

      const isEditableText = tagName === 'textarea' ||
        (tagName === 'input' && ['text', 'url', 'email', 'tel', 'number', 'search', ''].includes(type));

      if (!isEditableText) return;
      if (target.readOnly || target.disabled) return;
      if (['password', 'hidden', 'file', 'checkbox', 'radio', 'submit', 'button', 'reset'].includes(type)) return;

      target.__trackmeRegenCount = (target.__trackmeRegenCount || 0) + 1;
      const iteration = target.__trackmeRegenCount;

      const label = getLabelForElement(target) || target.name || target.placeholder || 'Question';
      const questionContext = getSurroundingQuestion(target);
      const currentAnswer = target.value || '';
      const jobMetadata = extractJobMetadata();

      target.classList.add('trackme-field-refactoring');
      showInlineFeedback(target, `Refactoring answer (Variation ${iteration})...`);

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
            `Refactored (${res.data.providerUsed?.toUpperCase()}). Double-click to cycle.`
          );
        } else {
          showInlineFeedback(target, `Error: ${res?.error || 'Refactor failed'}`, true);
        }
      });
    });
  }

  function showInlineFeedback(el, text, isError = false) {
    let tooltip = document.getElementById('trackme-inline-tooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.id = 'trackme-inline-tooltip';
      document.body.appendChild(tooltip);
    }

    const rect = el.getBoundingClientRect();
    const top = Math.max(8, rect.top + window.scrollY - 32);
    const left = Math.max(8, rect.left + window.scrollX);

    tooltip.innerText = text;
    tooltip.className = `trackme-inline-tooltip ${isError ? 'error' : ''}`;
    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
    tooltip.style.display = 'block';

    clearTimeout(tooltip.__fadeTimer);
    tooltip.__fadeTimer = setTimeout(() => {
      tooltip.style.display = 'none';
    }, 3000);
  }

  // Initialize only silent double-click listener
  setupDoubleClickRefactoring();
})();
