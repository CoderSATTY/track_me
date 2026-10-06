/**
 * TrackMe Background Service Worker (Manifest V3)
 * Orchestrates cross-origin LLM API calls, storage persistence, and form inference.
 */

import { Storage } from '../lib/storage.js';
import { LLMRouter } from '../lib/llm-router.js';
import { ResumeParser } from '../lib/resume-parser.js';

// Open onboarding/options tab on first install
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.runtime.openOptionsPage();
  }
});

// Central Message Dispatcher
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((response) => sendResponse({ success: true, data: response }))
    .catch((err) => {
      console.error('[TrackMe Service Worker] Error handling message:', err);
      sendResponse({ success: false, error: err.message || 'Internal error' });
    });

  // Return true to indicate asynchronous response
  return true;
});

async function handleMessage(message, sender) {
  const { type, payload } = message;

  switch (type) {
    case 'TEST_API_KEY': {
      const { providerId, apiKey, extraConfig } = payload;
      return await LLMRouter.testConnection(providerId, apiKey, extraConfig);
    }

    case 'GET_STATUS': {
      const keysData = await Storage.getApiKeys();
      const profileData = await Storage.getProfile();
      const memoryCount = (await Storage.getMemoryBank()).length;
      return {
        hasAnyApiKey: Object.values(keysData.keys).some(k => k && k.trim().length > 0),
        activeProvider: keysData.activeProvider,
        configuredProviders: Object.keys(keysData.keys).filter(k => keysData.keys[k]?.trim().length > 0),
        profileVerified: profileData.verified,
        hasProfile: !!profileData.profile,
        hasResumeFile: !!profileData.resumeMeta,
        resumeMeta: profileData.resumeMeta,
        memoryItemsCount: memoryCount
      };
    }

    case 'PARSE_RESUME': {
      const { resumeText, pdfBase64, fileName, mimeType, rawArrayBuffer } = payload;
      const { keys, activeProvider, fallbackProviders } = await Storage.getApiKeys();

      // Store binary file in IndexedDB if provided
      if (rawArrayBuffer) {
        const blob = new Blob([new Uint8Array(rawArrayBuffer)], { type: mimeType || 'application/pdf' });
        await Storage.saveResumeBinary(blob, fileName, mimeType);
      }

      // Execute LLM extraction
      const parseResult = await ResumeParser.parse(resumeText, keys, activeProvider, fallbackProviders, pdfBase64);

      // Save initial profile as unverified until the user does the "Final Run" review
      await Storage.saveProfile(parseResult.profile, false);

      return parseResult;
    }

    case 'CONFIRM_VERIFIED_PROFILE': {
      const { profile } = payload;
      await Storage.saveProfile(profile, true);
      return { verified: true };
    }

    case 'GET_PROFILE': {
      return await Storage.getProfile();
    }

    case 'GET_RESUME_BINARY': {
      const fileRecord = await Storage.getResumeBinary();
      if (!fileRecord) return null;
      // Convert Blob to ArrayBuffer for message port transmission
      const arrayBuffer = await fileRecord.blob.arrayBuffer();
      return {
        fileName: fileRecord.fileName,
        mimeType: fileRecord.mimeType,
        arrayBuffer: Array.from(new Uint8Array(arrayBuffer))
      };
    }

    case 'ANALYZE_AND_FILL_PAGE': {
      const { fields, jobMetadata } = payload;
      return await processFormAutoFill(fields, jobMetadata);
    }

    case 'ANALYZE_COVER_LETTER': {
      const { jobMetadata, coverLetterText } = payload;
      return await auditCoverLetterFit(jobMetadata, coverLetterText);
    }

    case 'REGENERATE_FIELD_ANSWER': {
      const { fieldLabel, questionContext, currentAnswer, jobMetadata, iteration = 1 } = payload;
      return await regenerateSingleFieldAnswer(fieldLabel, questionContext, currentAnswer, jobMetadata, iteration);
    }

    case 'UPDATE_MEMORY_BANK': {
      const { question, answer, category } = payload;
      return await Storage.addMemoryBankEntry(question, answer, category);
    }

    case 'GET_MEMORY_BANK': {
      return await Storage.getMemoryBank();
    }

    default:
      throw new Error(`Unknown message type: ${type}`);
  }
}

/**
 * Intelligent form auto-fill processor
 * Combines local deterministic regex with LLM reasoning for demographic & complex fields
 */
async function processFormAutoFill(fields, jobMetadata) {
  const { profile, verified } = await Storage.getProfile();
  if (!profile) {
    throw new Error('Please set up your profile and upload your resume in the TrackMe Dashboard first.');
  }

  const memoryBank = await Storage.getMemoryBank();
  const fieldValues = {};
  const unresolvedFields = [];

  // 1. FAST DETERMINISTIC PASS
  for (const field of fields) {
    if (field.isFileInput) continue; // Handled separately

    const label = `${field.label} ${field.name} ${field.id} ${field.placeholder} ${field.ariaLabel}`.toLowerCase();
    let val = null;

    if (matchesPattern(label, ['first name', 'firstname', 'given name'])) {
      val = profile.basic?.firstName;
    } else if (matchesPattern(label, ['last name', 'lastname', 'surname', 'family name'])) {
      val = profile.basic?.lastName;
    } else if (matchesPattern(label, ['full name', 'fullname', 'your name', 'applicant name'])) {
      val = profile.basic?.fullName;
    } else if (matchesPattern(label, ['email', 'e-mail'])) {
      val = profile.basic?.email;
    } else if (matchesPattern(label, ['phone', 'mobile', 'cell', 'telephone'])) {
      val = profile.basic?.phone;
    } else if (matchesPattern(label, ['linkedin'])) {
      val = profile.basic?.linkedin;
    } else if (matchesPattern(label, ['github'])) {
      val = profile.basic?.github;
    } else if (matchesPattern(label, ['portfolio', 'website', 'personal site'])) {
      val = profile.basic?.portfolio || profile.basic?.website;
    } else if (matchesPattern(label, ['roll no', 'roll number', 'student id', 'enrollment no'])) {
      val = profile.basic?.rollNo;
    } else if (matchesPattern(label, ['city'])) {
      val = profile.basic?.location?.city;
    } else if (matchesPattern(label, ['state', 'province', 'region'])) {
      val = profile.basic?.location?.state;
    } else if (matchesPattern(label, ['postal', 'zip', 'zipcode', 'pin code'])) {
      val = profile.basic?.location?.postalCode;
    } else if (matchesPattern(label, ['country'])) {
      val = profile.basic?.location?.country;
    }

    if (val) {
      fieldValues[field.trackmeId] = val;
    } else {
      unresolvedFields.push(field);
    }
  }

  // 2. LLM SMART PASS (for demographics, work authorization, dropdowns, essay questions, memory bank items)
  if (unresolvedFields.length > 0) {
    const { keys, activeProvider, fallbackProviders } = await Storage.getApiKeys();

    if (Object.values(keys).some(k => k && k.trim().length > 0)) {
      const llmFillMap = await queryLLMForFields(unresolvedFields, profile, memoryBank, jobMetadata, keys, activeProvider, fallbackProviders);
      Object.assign(fieldValues, llmFillMap);
    }
  }

  return {
    fillMap: fieldValues,
    jobMetadata,
    totalFilled: Object.keys(fieldValues).length
  };
}

function matchesPattern(text, keywords) {
  return keywords.some(k => text.includes(k));
}

/**
 * Ask LLM to answer complex/demographic questions and match select options
 */
async function queryLLMForFields(unresolvedFields, profile, memoryBank, jobMetadata, keys, activeProvider, fallbackOrder) {
  // Compress fields to minimize token usage
  const fieldsPayload = unresolvedFields.map(f => ({
    id: f.trackmeId,
    label: f.label || f.name || f.id,
    questionContext: f.surroundingQuestion,
    type: f.type,
    options: f.options.map(o => o.text),
    required: f.required
  }));

  const systemPrompt = `You are TrackMe, an automated job application filling assistant.
Given candidate data and a list of form fields (with optional dropdown choices), generate the exact best value or chosen option for each field.
Rules:
1. For dropdown options, pick the text that EXACTLY matches one of the provided options.
2. For work authorization / visa sponsorship: adhere strictly to the candidate's demographic settings.
3. For demographic self-identification (disability, veteran, race, gender): use the candidate's declared preferences.
4. Output STRICT JSON: an object mapping field "id" to the chosen value/text string.`;

  const userPrompt = `Candidate Profile:
${JSON.stringify({ basic: profile.basic, demographics: profile.demographics, education: profile.education, skills: profile.skills, memoryBank })}

Target Job: ${jobMetadata.title} at ${jobMetadata.company}

Form Fields to fill:
${JSON.stringify(fieldsPayload, null, 2)}

Return strictly JSON format:
{
  "field_id_1": "Chosen value or matching option",
  "field_id_2": "Chosen value"
}`;

  try {
    const result = await LLMRouter.executeWithFallback({
      systemPrompt,
      userPrompt,
      jsonMode: true,
      maxTokens: 3000
    }, keys, activeProvider, fallbackOrder);

    const parsed = LLMRouter.extractJson(result.text);
    return parsed || {};
  } catch (err) {
    console.warn('[TrackMe] LLM form inference failed:', err.message);
    return {};
  }
}

/**
 * Cover letter role-fit audit against current job opening
 */
async function auditCoverLetterFit(jobMetadata, coverLetterText) {
  const { profile } = await Storage.getProfile();
  const { keys, activeProvider, fallbackProviders } = await Storage.getApiKeys();

  if (!coverLetterText || coverLetterText.trim().length === 0) {
    throw new Error('Please provide or upload a cover letter first.');
  }

  const systemPrompt = `You are a Senior Technical Recruiter and ATS Optimization Expert.
Analyze whether the candidate's cover letter aligns with the role and company they are applying to.
Provide an objective match score (0-100), key strengths, missing keywords, and actionable recommendations.
Output STRICT JSON.`;

  const userPrompt = `Target Company: ${jobMetadata.company}
Target Role: ${jobMetadata.title}
Job Context / Requirements:
"""
${jobMetadata.descriptionSnippet || 'General software engineering / professional role at ' + jobMetadata.company}
"""

Candidate's Cover Letter:
"""
${coverLetterText}
"""

Candidate Profile Highlights:
Skills: ${(profile?.skills || []).join(', ')}

Output JSON schema:
{
  "matchScore": 85,
  "fitVerdict": "Strong Alignment / Moderate Alignment / Needs Tailoring",
  "matchingStrengths": ["Direct mention of required cloud stack", "Aligned experience in system design"],
  "missingKeywords": ["Kubernetes", "GraphQL", "Specific company mission mention"],
  "recommendations": ["In paragraph 2, emphasize your distributed systems project", "Address why you want to work at ${jobMetadata.company}"],
  "tailoredHookSnippet": "A suggested revised 2-3 sentence opening paragraph personalized for ${jobMetadata.company}"
}`;

  const result = await LLMRouter.executeWithFallback({
    systemPrompt,
    userPrompt,
    jsonMode: true,
    maxTokens: 2500
  }, keys, activeProvider, fallbackOrder);

  const parsed = LLMRouter.extractJson(result.text);
  if (!parsed) {
    throw new Error('Failed to parse cover letter audit results.');
  }

  return {
    ...parsed,
    providerUsed: result.usedProvider,
    analyzedAt: Date.now()
  };
}

/**
 * Regenerate / refactor a single form answer on double-click
 */
async function regenerateSingleFieldAnswer(fieldLabel, questionContext, currentAnswer, jobMetadata, iteration) {
  const { profile } = await Storage.getProfile();
  const { keys, activeProvider, fallbackProviders } = await Storage.getApiKeys();
  const memoryBank = await Storage.getMemoryBank();

  const angles = [
    'Focus on hands-on technical achievements, specific tools, and measurable impact.',
    'Focus on alignment with company culture, values, mission, and collaborative teamwork.',
    'Make it concise, punchy, high-energy, and direct to the point.',
    'Highlight problem-solving approach, architecture decisions, and business value delivered.'
  ];
  const chosenAngle = angles[(iteration - 1) % angles.length];

  const systemPrompt = `You are TrackMe, an elite job application co-pilot.
A candidate has double-clicked on a specific form question to refactor/regenerate their answer.
Your task is to produce a fresh, authentic, highly tailored response to the question.
Rules:
1. Do not repeat the previous answer verbatim. Offer a fresh variation.
2. Tone: Professional, confident, concise, and compelling.
3. Tailor specifically to ${jobMetadata?.company || 'the target company'} and ${jobMetadata?.title || 'the target role'}.
4. Root the response strictly in the candidate's actual skills, experience, and background.
5. Focus style: ${chosenAngle}
6. Return ONLY the answer text to be placed directly into the form field. Do not include quotes, markdown formatting, or conversational filler like 'Here is your answer:'.`;

  const userPrompt = `Candidate Profile:
Name: ${profile?.basic?.fullName || ''}
Headline: ${profile?.basic?.headline || ''}
Skills: ${(profile?.skills || []).join(', ')}
Relevant Experiences: ${JSON.stringify(profile?.experience || [])}
Projects: ${JSON.stringify(profile?.projects || [])}
Known Demographics & Logistics: ${JSON.stringify(profile?.demographics || {})}
Memory Bank Snippets: ${JSON.stringify(memoryBank || [])}

Target Company: ${jobMetadata?.company || 'Company'}
Target Role: ${jobMetadata?.title || 'Role'}
Job Context / Requirements: ${jobMetadata?.descriptionSnippet || ''}

Question / Field Label: "${fieldLabel}"
Surrounding Question Context: "${questionContext || ''}"

Previous / Current Answer in the field:
"""
${currentAnswer || '(Empty)'}
"""

Generate the new, refined, and alternative answer text now:`;

  const result = await LLMRouter.executeWithFallback({
    systemPrompt,
    userPrompt,
    jsonMode: false,
    maxTokens: 1000
  }, keys, activeProvider, fallbackOrder);

  let newAnswer = result.text.trim();
  // Strip enclosing quotes if model added them
  if ((newAnswer.startsWith('"') && newAnswer.endsWith('"')) || (newAnswer.startsWith("'") && newAnswer.endsWith("'"))) {
    newAnswer = newAnswer.slice(1, -1).trim();
  }

  return {
    newAnswer,
    iteration,
    providerUsed: result.usedProvider
  };
}

