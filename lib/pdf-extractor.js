/**
 * TrackMe Client-side PDF Text Extractor
 * Extracts text content from PDF binary buffers in pure JavaScript
 * Uses native DecompressionStream for FlateDecode streams with fallback heuristics.
 */

export class PdfExtractor {
  /**
   * Extract readable text from an ArrayBuffer of a PDF file
   * @param {ArrayBuffer} arrayBuffer
   * @returns {Promise<string>} Extracted plain text
   */
  static async extractText(arrayBuffer) {
    if (!arrayBuffer || arrayBuffer.byteLength === 0) return '';

    try {
      const bytes = new Uint8Array(arrayBuffer);
      const latin1Str = this.uint8ToString(bytes);

      // Strategy 1: Find and decompress PDF content streams
      const streamMatches = [];
      const streamRegex = /<<([^>]*)>>\s*stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
      let match;

      while ((match = streamRegex.exec(latin1Str)) !== null) {
        streamMatches.push({
          dict: match[1],
          startIndex: match.index + match[0].indexOf('stream') + 6,
          rawStream: match[2]
        });
      }

      const extractedBlocks = [];

      for (const sm of streamMatches) {
        let streamContent = '';

        if (sm.dict.includes('FlateDecode')) {
          try {
            const rawBytes = this.stringToUint8(sm.rawStream);
            streamContent = await this.decompressFlate(rawBytes);
          } catch {
            // Some streams may use custom filters or deflate-raw
            streamContent = '';
          }
        } else {
          streamContent = sm.rawStream;
        }

        if (streamContent && (streamContent.includes('BT') || streamContent.includes('Tj') || streamContent.includes('TJ'))) {
          const parsedText = this.parseTextOperators(streamContent);
          if (parsedText.trim().length > 0) {
            extractedBlocks.push(parsedText.trim());
          }
        }
      }

      if (extractedBlocks.length > 0) {
        return this.cleanExtractedText(extractedBlocks.join('\n\n'));
      }

      // Strategy 2: Fallback scan for printable string literals across the entire file
      const rawText = this.scanPrintableStrings(latin1Str);
      if (rawText.length > 50) {
        return this.cleanExtractedText(rawText);
      }

      return '';
    } catch (err) {
      console.warn('[TrackMe PdfExtractor] Stream extraction warning:', err);
      return '';
    }
  }

  /**
   * Decompress Deflate bytes using browser native DecompressionStream
   */
  static async decompressFlate(bytes) {
    if (typeof DecompressionStream === 'undefined') return '';

    // First try standard 'deflate'
    try {
      const ds = new DecompressionStream('deflate');
      const writer = ds.writable.getWriter();
      writer.write(bytes);
      writer.close();
      const response = new Response(ds.readable);
      return await response.text();
    } catch {
      // Fallback try 'deflate-raw'
      try {
        const dsRaw = new DecompressionStream('deflate-raw');
        const writer = dsRaw.writable.getWriter();
        writer.write(bytes);
        writer.close();
        const response = new Response(dsRaw.readable);
        return await response.text();
      } catch {
        return '';
      }
    }
  }

  /**
   * Parse PDF text operators: (string) Tj, [(str1) -10 (str2)] TJ, 'string', "string"
   */
  static parseTextOperators(streamContent) {
    const lines = [];
    let currentLine = [];

    // Match (string) Tj or [(arr)] TJ or (string)' or (string)"
    const operatorRegex = /\(([^)]*)\)\s*(?:Tj|'|")|\[([^\]]*)\]\s*TJ/g;
    let match;

    while ((match = operatorRegex.exec(streamContent)) !== null) {
      if (match[1] !== undefined) {
        const decoded = this.unescapePdfString(match[1]);
        if (decoded) currentLine.push(decoded);
      } else if (match[2] !== undefined) {
        // Inside TJ array: [(text1) 20 (text2)]
        const innerRegex = /\(([^)]*)\)/g;
        let inner;
        const segment = [];
        while ((inner = innerRegex.exec(match[2])) !== null) {
          const decoded = this.unescapePdfString(inner[1]);
          if (decoded) segment.push(decoded);
        }
        if (segment.length > 0) {
          currentLine.push(segment.join(' '));
        }
      }

      // Check if text matrix or newline operator followed
      if (match[0].includes('\'') || match[0].includes('"') || streamContent.substr(match.index + match[0].length, 20).includes('T*')) {
        lines.push(currentLine.join(' '));
        currentLine = [];
      }
    }

    if (currentLine.length > 0) {
      lines.push(currentLine.join(' '));
    }

    return lines.join('\n');
  }

  /**
   * Clean escape sequences in PDF strings
   */
  static unescapePdfString(str) {
    if (!str) return '';
    return str
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\b/g, '\b')
      .replace(/\\f/g, '\f')
      .replace(/\\\(/g, '(')
      .replace(/\\\)/g, ')')
      .replace(/\\\\/g, '\\')
      .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
  }

  /**
   * Scan for printable string sequences (fallback)
   */
  static scanPrintableStrings(str) {
    const matches = str.match(/[\x20-\x7E\t\n\r]{6,}/g) || [];
    return matches
      .filter(s => !s.startsWith('/') && !s.includes('xref') && !s.includes('obj') && !s.includes('endobj'))
      .join('\n');
  }

  /**
   * Clean and normalize multi-line text
   */
  static cleanExtractedText(text) {
    return text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\t/g, ' ')
      .replace(/[ ]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  static uint8ToString(u8) {
    let str = '';
    const chunk = 8192;
    for (let i = 0; i < u8.length; i += chunk) {
      str += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
    }
    return str;
  }

  static stringToUint8(str) {
    const u8 = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) {
      u8[i] = str.charCodeAt(i) & 0xff;
    }
    return u8;
  }
}
