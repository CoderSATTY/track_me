/**
 * TrackMe Content Script
 * Injected silently into web pages.
 * NO floating pills, tabs, or widgets are injected into web pages.
 * Eradicates any legacy floating widgets if previously present.
 * Provides high-precision field scraping and filling for Google Forms & ATS platforms.
 */

(function () {
  // Proactively eradicate any legacy floating widget if present from previous injections
  function removeLegacyWidgets() {
    const legacy = document.querySelectorAll('#trackme-widget-root, #trackme-pill, #trackme-panel, .trackme-widget-container, #trackme-modal-audit');
    legacy.forEach(el => el.remove());
  }

  removeLegacyWidgets();

  if (window.__trackMeInjected) return;
  window.__trackMeInjected = true;

  // Listen for extension commands from the side panel / popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'FILL_ACTIVE_PAGE': {
        handleAutofill()
          .then((res) => sendResponse({ success: true, data: res }))
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

        resolve({
          filledCount,
          totalFields: pageData.fields.length
        });
      });
    });
  }

  // --- COMPREHENSIVE FORM SCRAPER (GOOGLE FORMS & ATS PLATFORMS) ---
  function analyzePage() {
    const fields = [];
    let counter = 0;

    // Detect if we are on Google Forms
    const isGoogleForms = window.location.hostname.includes('docs.google.com') && window.location.pathname.includes('/forms/');

    if (isGoogleForms) {
      // Scrape Google Forms Question Containers
      const questionBlocks = document.querySelectorAll('[role="listitem"], .geS5n, .Qr7Oae, .k3920b');

      questionBlocks.forEach((block) => {
        // Extract Question Title
        const titleEl = block.querySelector('.M7eMe, [role="heading"], .HoXoMd, .F9Nuk, span.snByac');
        const questionText = titleEl ? titleEl.innerText.trim() : '';
        if (!questionText) return;

        // Find input elements inside this question container
        const inputEl = block.querySelector('input:not([type="hidden"]), textarea, div[role="checkbox"], div[role="radio"], div[role="listbox"]');
        if (!inputEl) return;

        const type = (inputEl.type || inputEl.getAttribute('role') || 'text').toLowerCase();
        let trackmeId = inputEl.getAttribute('data-trackme-id');
        if (!trackmeId) {
          trackmeId = `tm_gform_${++counter}`;
          inputEl.setAttribute('data-trackme-id', trackmeId);
        }

        // Collect choices if radio/checkbox/dropdown
        const options = [];
        block.querySelectorAll('[role="radio"], [role="checkbox"], [data-value]').forEach(opt => {
          const optText = opt.getAttribute('data-value') || opt.innerText.trim();
          if (optText) options.push(optText);
        });

        fields.push({
          trackmeId,
          label: questionText,
          surroundingQuestion: questionText,
          type,
          options,
          required: !!block.querySelector('.vVVJfd, [aria-required="true"], .M7eMe *')
        });
      });
    }

    // Generic Scanner (covers Greenhouse, Lever, Workday, Ashby, Taleo, etc.)
    const standardInputs = document.querySelectorAll('input:not([type="hidden"]):not([type="password"]):not([type="submit"]):not([type="button"]):not([type="file"]), textarea, select, [role="checkbox"], [role="radio"]');

    standardInputs.forEach((el) => {
      if (el.getAttribute('data-trackme-id')) return; // Already processed
      if (el.style.display === 'none' || el.style.visibility === 'hidden') return;

      const name = (el.name || '').toLowerCase();
      const id = (el.id || '').toLowerCase();
      if (name.includes('search') || id.includes('search') || name.includes('captcha') || id.includes('captcha')) return;

      const label = getLabelForElement(el);
      const surroundingQuestion = getSurroundingQuestion(el);
      const type = (el.type || el.getAttribute('role') || 'text').toLowerCase();

      let options = [];
      if (el.tagName.toLowerCase() === 'select') {
        options = Array.from(el.options).map(o => o.text.trim()).filter(Boolean);
      }

      const trackmeId = `tm_${++counter}_${el.name || el.id || 'field'}`;
      el.setAttribute('data-trackme-id', trackmeId);

      fields.push({
        trackmeId,
        label: label || surroundingQuestion || 'Form Field',
        surroundingQuestion: surroundingQuestion || label || '',
        type,
        options,
        required: el.required || el.getAttribute('aria-required') === 'true'
      });
    });

    return {
      fields,
      jobMetadata: extractJobMetadata()
    };
  }

  function getLabelForElement(el) {
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) return l.innerText.trim();
    }

    const ariaLabelledBy = el.getAttribute('aria-labelledby');
    if (ariaLabelledBy) {
      const parts = ariaLabelledBy.split(/\s+/).map(id => document.getElementById(id)?.innerText?.trim()).filter(Boolean);
      if (parts.length > 0) return parts.join(' ');
    }

    if (el.getAttribute('aria-label')) {
      return el.getAttribute('aria-label').trim();
    }

    const parentLabel = el.closest('label');
    if (parentLabel) return parentLabel.innerText.trim();

    return el.placeholder || el.name || '';
  }

  function getSurroundingQuestion(el) {
    const container = el.closest('[role="listitem"], .geS5n, .form-group, .field, .input-container, .question, tr, div');
    if (container && container !== document.body) {
      const heading = container.querySelector('.M7eMe, [role="heading"], h1, h2, h3, h4, h5, strong, legend');
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

    return { title, company };
  }

  // --- ELEMENT FILLER WITH REACT & CLOSURE SUPPORT ---
  function fillElement(el, value) {
    if (value === undefined || value === null) return false;
    const tagName = el.tagName.toLowerCase();
    const type = (el.type || '').toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();

    // Google Forms role="checkbox"
    if (role === 'checkbox') {
      const isChecked = el.getAttribute('aria-checked') === 'true';
      const shouldCheck = ['true', 'yes', '1', true].includes(value);
      if (isChecked !== shouldCheck) {
        el.click();
        el.dispatchEvent(new Event('click', { bubbles: true }));
      }
      markFilled(el);
      return true;
    }

    // Google Forms role="radio"
    if (role === 'radio') {
      el.click();
      el.dispatchEvent(new Event('click', { bubbles: true }));
      markFilled(el);
      return true;
    }

    // HTML Select dropdown
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
    }

    // HTML Checkbox
    if (type === 'checkbox') {
      el.checked = ['true', 'yes', '1', true].includes(value);
      el.dispatchEvent(new Event('change', { bubbles: true }));
      markFilled(el);
      return true;
    }

    // Text inputs & Textareas (Google Forms .whsOnd / .KHxj8b & React synthetic inputs)
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

    // Dispatch full input event sequence
    el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: ' ' }));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: ' ' }));
    el.dispatchEvent(new Event('blur', { bubbles: true, cancelable: true }));

    markFilled(el);
    return true;
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

      const label = getLabelForElement(target) || getSurroundingQuestion(target) || 'Question';
      const currentAnswer = target.value || '';
      const jobMetadata = extractJobMetadata();

      target.classList.add('trackme-field-refactoring');
      showInlineFeedback(target, `Refactoring answer (Variation ${iteration})...`);

      chrome.runtime.sendMessage({
        type: 'REGENERATE_FIELD_ANSWER',
        payload: {
          fieldLabel: label,
          questionContext: label,
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

  setupDoubleClickRefactoring();
})();
