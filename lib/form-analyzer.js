/**
 * TrackMe Form & Page Analyzer
 * Intelligent DOM scanner for job application portals (Workday, Greenhouse, Lever, Ashby, Taleo, etc.)
 */

export class FormAnalyzer {
  /**
   * Scrape and structure all relevant job application form fields
   */
  static analyzePage() {
    const fields = [];
    const elements = document.querySelectorAll('input, select, textarea, [role="combobox"], [role="radiogroup"]');
    let fieldCounter = 0;

    elements.forEach((el) => {
      // Security & Noise filters: Skip passwords, hidden fields, search inputs, captcha
      const type = (el.type || '').toLowerCase();
      if (['password', 'hidden', 'submit', 'reset', 'button', 'image'].includes(type)) return;
      if (el.getAttribute('aria-hidden') === 'true' || el.style.display === 'none' || el.style.visibility === 'hidden') return;

      const name = (el.name || '').toLowerCase();
      const id = (el.id || '').toLowerCase();
      if (name.includes('search') || id.includes('search') || name.includes('captcha') || id.includes('captcha')) return;

      // Extract rich label text
      const labelText = this.getLabelForElement(el);
      const placeholder = el.placeholder || '';
      const ariaLabel = el.getAttribute('aria-label') || '';
      const surroundingQuestion = this.getSurroundingQuestionText(el);

      // Determine options if select, radio, or checkbox
      let options = [];
      if (el.tagName.toLowerCase() === 'select') {
        options = Array.from(el.options).map(o => ({ value: o.value, text: o.text.trim() })).filter(o => o.text.length > 0);
      }

      // Check if it's a file upload
      const isFileInput = type === 'file';
      let filePurpose = null;
      if (isFileInput) {
        const fullContext = `${labelText} ${placeholder} ${ariaLabel} ${name} ${id} ${surroundingQuestion}`.toLowerCase();
        if (fullContext.includes('resume') || fullContext.includes('cv') || fullContext.includes('curriculum')) {
          filePurpose = 'resume';
        } else if (fullContext.includes('cover') || fullContext.includes('letter')) {
          filePurpose = 'cover_letter';
        } else {
          filePurpose = 'other';
        }
      }

      // Generate stable selector / path
      const uniqueId = el.id || el.name || `trackme_field_${++fieldCounter}`;
      if (!el.getAttribute('data-trackme-id')) {
        el.setAttribute('data-trackme-id', uniqueId);
      }

      fields.push({
        trackmeId: uniqueId,
        tagName: el.tagName.toLowerCase(),
        type,
        name: el.name || '',
        id: el.id || '',
        label: labelText,
        placeholder,
        ariaLabel,
        surroundingQuestion,
        currentValue: el.value || '',
        required: el.required || el.getAttribute('aria-required') === 'true',
        options,
        isFileInput,
        filePurpose
      });
    });

    // Detect Job Post Metadata
    const jobMetadata = this.extractJobMetadata();

    return {
      fields,
      jobMetadata,
      totalFields: fields.length,
      fileFieldsCount: fields.filter(f => f.isFileInput).length
    };
  }

  /**
   * Find label text via <label for>, wrapping label, aria-labelledby, or nearby header.
   * Fully supports Google Forms (.geS5n, [role="listitem"], .M7eMe).
   */
  static getLabelForElement(el) {
    // 1. Google Forms Question Heading
    const gContainer = el.closest('[role="listitem"], .geS5n, .Qr7Oae, .k3920b');
    if (gContainer) {
      const gTitle = gContainer.querySelector('.M7eMe, [role="heading"], .HoXoMd, .F9Nuk');
      if (gTitle && gTitle.innerText.trim()) {
        return gTitle.innerText.trim();
      }
    }

    // 2. Explicit label for
    if (el.id) {
      const explicitLabel = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (explicitLabel) return explicitLabel.innerText.trim();
    }

    // 3. Parent wrapping label
    const parentLabel = el.closest('label');
    if (parentLabel) {
      const clone = parentLabel.cloneNode(true);
      const inputs = clone.querySelectorAll('input, select, textarea');
      inputs.forEach(i => i.remove());
      return clone.innerText.trim();
    }

    // 4. ARIA labelled by
    const ariaLabelledBy = el.getAttribute('aria-labelledby');
    if (ariaLabelledBy) {
      const labelledByEl = document.getElementById(ariaLabelledBy);
      if (labelledByEl) return labelledByEl.innerText.trim();
    }

    // 5. ARIA label or placeholder
    if (el.getAttribute('aria-label')) {
      return el.getAttribute('aria-label').trim();
    }

    return '';
  }

  /**
   * Traverse up the DOM to capture the full question prompt (e.g. Workday/Greenhouse question blocks)
   */
  static getSurroundingQuestionText(el) {
    const container = el.closest('.form-group, .field, .input-container, .question, [data-automation-id], tr, div');
    if (container && container !== document.body) {
      const heading = container.querySelector('h1, h2, h3, h4, h5, h6, legend, .label, strong');
      if (heading) return heading.innerText.trim();
      const text = container.innerText.trim();
      if (text.length > 0 && text.length < 300) return text;
    }
    return '';
  }

  /**
   * Extract Job Title, Company Name, and Job Description from standard application pages
   */
  static extractJobMetadata() {
    let title = '';
    let company = '';
    let description = '';

    // Title heuristics
    const titleCandidates = document.querySelectorAll('h1, .job-title, [data-automation-id="jobTitle"], .posting-headline h2');
    for (const h of titleCandidates) {
      const t = h.innerText.trim();
      if (t.length > 3 && t.length < 120) {
        title = t;
        break;
      }
    }
    if (!title) {
      title = document.title.split(/[-|–]/)[0]?.trim() || '';
    }

    // Company heuristics
    const companyCandidates = document.querySelectorAll('.company-name, [data-automation-id="companyName"], .header-company');
    for (const c of companyCandidates) {
      const comp = c.innerText.trim();
      if (comp.length > 1 && comp.length < 80) {
        company = comp;
        break;
      }
    }
    if (!company) {
      // Derive from hostname
      const hostParts = window.location.hostname.split('.');
      if (hostParts.length >= 2) {
        company = hostParts[hostParts.length - 2].toUpperCase();
      }
    }

    // Description text heuristics
    const descContainers = document.querySelectorAll('#job-description, .job-description, .posting-description, [data-automation-id="jobPostingDescription"], article, main');
    for (const container of descContainers) {
      const text = container.innerText.trim();
      if (text.length > 200) {
        description = text.substring(0, 4000); // cap to preserve token budget
        break;
      }
    }

    return {
      title: title || 'Target Role',
      company: company || 'Target Company',
      url: window.location.href,
      descriptionSnippet: description
    };
  }
}
