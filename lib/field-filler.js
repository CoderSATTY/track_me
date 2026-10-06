/**
 * TrackMe Field Filler & Event Simulator
 * Handles robust DOM injection compatible with React, Vue, Angular, and native HTML forms.
 * Supports programmatic File attachment via DataTransfer API.
 */

export class FieldFiller {
  /**
   * Apply filled value to a single DOM element
   */
  static fillElement(element, value) {
    if (!element) return false;
    const tagName = element.tagName.toLowerCase();
    const type = (element.type || '').toLowerCase();
    const role = (element.getAttribute('role') || '').toLowerCase();

    try {
      // Support Google Forms role="radio" and role="checkbox"
      if (role === 'radio') {
        element.click();
        element.dispatchEvent(new Event('click', { bubbles: true }));
        this.markFieldFilled(element);
        return true;
      } else if (role === 'checkbox') {
        const isChecked = element.getAttribute('aria-checked') === 'true';
        const shouldCheck = ['true', 'yes', '1', true].includes(value);
        if (isChecked !== shouldCheck) {
          element.click();
          element.dispatchEvent(new Event('click', { bubbles: true }));
        }
        this.markFieldFilled(element);
        return true;
      }

      if (tagName === 'select') {
        return this.fillSelect(element, value);
      } else if (type === 'checkbox') {
        return this.fillCheckbox(element, value);
      } else if (type === 'radio') {
        return this.fillRadio(element, value);
      } else {
        return this.fillTextInput(element, value);
      }
    } catch (err) {
      console.error('[TrackMe FieldFiller] Error filling element:', err);
      return false;
    }
  }

  /**
   * React and Google Forms compatible text input & textarea filler
   */
  static fillTextInput(element, value) {
    if (value === undefined || value === null) return false;
    const stringValue = String(value);

    // Focus element
    element.focus();

    // Hijack prototype setter to notify React's virtual DOM tracker & Google Forms
    const prototype = Object.getPrototypeOf(element);
    const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    const ownValueSetter = Object.getOwnPropertyDescriptor(element, 'value')?.set;

    if (prototypeValueSetter && ownValueSetter !== prototypeValueSetter) {
      prototypeValueSetter.call(element, stringValue);
    } else if (ownValueSetter) {
      ownValueSetter.call(element, stringValue);
    } else {
      element.value = stringValue;
    }

    // Support React 16+ _valueTracker
    if (element._valueTracker) {
      element._valueTracker.setValue(stringValue);
    }

    // Dispatch full suite of events (covers Google Forms Closure & modern frameworks)
    element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: ' ' }));
    element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: ' ' }));
    element.dispatchEvent(new Event('blur', { bubbles: true, cancelable: true }));

    this.markFieldFilled(element);
    return true;
  }

  /**
   * Intelligent select dropdown matcher
   */
  static fillSelect(selectElement, targetValue) {
    if (!targetValue) return false;
    const target = String(targetValue).toLowerCase().trim();
    const options = Array.from(selectElement.options);

    // 1. Exact match on value
    let bestOption = options.find(o => o.value.toLowerCase().trim() === target);

    // 2. Exact match on inner text
    if (!bestOption) {
      bestOption = options.find(o => o.text.toLowerCase().trim() === target);
    }

    // 3. Substring match
    if (!bestOption) {
      bestOption = options.find(o => o.text.toLowerCase().includes(target) || target.includes(o.text.toLowerCase()));
    }

    // 4. Boolean match (Yes/No vs 1/0 or true/false)
    if (!bestOption) {
      if (['yes', 'true', '1'].includes(target)) {
        bestOption = options.find(o => ['yes', 'true', '1'].includes(o.value.toLowerCase()) || o.text.toLowerCase().startsWith('yes'));
      } else if (['no', 'false', '0'].includes(target)) {
        bestOption = options.find(o => ['no', 'false', '0'].includes(o.value.toLowerCase()) || o.text.toLowerCase().startsWith('no'));
      }
    }

    if (bestOption) {
      selectElement.selectedIndex = bestOption.index;
      selectElement.value = bestOption.value;

      selectElement.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
      selectElement.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      this.markFieldFilled(selectElement);
      return true;
    }

    return false;
  }

  /**
   * Checkbox handler
   */
  static fillCheckbox(element, value) {
    const shouldCheck = ['true', 'yes', '1', true, 1].includes(value) ||
      (typeof value === 'string' && value.toLowerCase().includes('agree'));

    if (element.checked !== shouldCheck) {
      element.checked = shouldCheck;
      element.dispatchEvent(new Event('click', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }
    this.markFieldFilled(element);
    return true;
  }

  /**
   * Radio button handler
   */
  static fillRadio(element, targetValue) {
    const elVal = element.value.toLowerCase().trim();
    const target = String(targetValue).toLowerCase().trim();

    if (elVal === target || target.includes(elVal)) {
      element.checked = true;
      element.dispatchEvent(new Event('click', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      this.markFieldFilled(element);
      return true;
    }
    return false;
  }

  /**
   * Programmatic file attachment using DataTransfer API
   */
  static attachFile(fileInput, fileBlob, fileName, mimeType = 'application/pdf') {
    if (!fileInput || !fileBlob) return false;

    try {
      const file = new File([fileBlob], fileName, {
        type: mimeType,
        lastModified: Date.now()
      });

      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      fileInput.files = dataTransfer.files;

      fileInput.dispatchEvent(new Event('input', { bubbles: true }));
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));

      this.markFieldFilled(fileInput, '#10b981'); // Emerald green for file success
      return true;
    } catch (err) {
      console.error('[TrackMe FieldFiller] File attachment failed:', err);
      return false;
    }
  }

  /**
   * Visual feedback highlight on the web page
   */
  static markFieldFilled(element, borderColor = '#2563eb') {
    const prevTransition = element.style.transition;
    const prevOutline = element.style.outline;

    element.style.transition = 'outline 0.2s ease';
    element.style.outline = `1px solid ${borderColor}`;

    setTimeout(() => {
      element.style.transition = prevTransition;
      element.style.outline = prevOutline;
    }, 2500);
  }
}
