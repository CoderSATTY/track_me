/**
 * TrackMe Resume Parser
 * Extracts and structures comprehensive candidate data from resume text or multimodal PDF.
 */

import { LLMRouter } from './llm-router.js';

export class ResumeParser {
  /**
   * System instruction to guide the LLM into generating exhaustive structured candidate profiles
   */
  static getSystemPrompt() {
    return `You are an expert HR Data Scientist and Resume Intelligence Engine.
Your task is to parse a candidate's resume and extract every single attribute into a strictly valid JSON schema.
Ensure no detail is lost: include contact information, roll number / student ID if present, college details, experience, skills, projects, and demographic defaults.

Output ONLY valid JSON adhering exactly to the specified structure. Do not include markdown codeblocks or conversational text.`;
  }

  /**
   * Prompt detailing the schema
   */
  static getUserPrompt(rawResumeText) {
    return `Parse the following candidate resume into a clean, comprehensive JSON profile.

Resume Content:
"""
${rawResumeText || 'No text provided. Please extract all available details directly from the attached document.'}
"""

Required JSON Schema:
{
  "basic": {
    "fullName": "Full legal name",
    "firstName": "First name",
    "lastName": "Last name",
    "email": "Email address",
    "phone": "Phone number with country code",
    "rollNo": "Roll number or Student ID if indicated, or empty string",
    "location": {
      "city": "City",
      "state": "State / Province",
      "country": "Country",
      "postalCode": "Zip or Postal Code",
      "fullAddress": "City, State, Country"
    },
    "linkedin": "LinkedIn profile URL or username",
    "github": "GitHub profile URL or username",
    "portfolio": "Personal website or portfolio URL",
    "headline": "Brief professional title or summary"
  },
  "education": [
    {
      "institution": "University / College name",
      "degree": "Degree name",
      "fieldOfStudy": "Major / Field",
      "startDate": "Start year",
      "endDate": "Graduation year",
      "gpa": "GPA / Percentage if mentioned",
      "location": "Location"
    }
  ],
  "experience": [
    {
      "company": "Company name",
      "title": "Role title",
      "location": "Location",
      "startDate": "Start date",
      "endDate": "End date / Present",
      "current": true,
      "highlights": ["Bullet point 1", "Bullet point 2"]
    }
  ],
  "skills": ["Skill 1", "Skill 2", "Skill 3"],
  "projects": [
    {
      "name": "Project name",
      "link": "Project link",
      "technologies": ["Tech 1", "Tech 2"],
      "description": "Description"
    }
  ],
  "demographics": {
    "legallyAuthorized": "Yes",
    "requireSponsorship": "No",
    "sponsorshipDetails": "Will not require visa sponsorship now or in the future",
    "disabilityStatus": "No, I do not have a disability",
    "veteranStatus": "I am not a protected veteran",
    "gender": "Prefer not to disclose",
    "raceEthnicity": "Prefer not to disclose",
    "pronouns": "They/Them",
    "salaryExpectation": "Open to negotiation",
    "noticePeriod": "Immediate",
    "willingToRelocate": "Yes"
  }
}`;
  }

  /**
   * Parse resume using multi-provider fallback
   */
  static async parse(resumeText, apiKeys, activeProvider = 'gemini', fallbackOrder = [], pdfBase64 = null) {
    const textContent = (resumeText || '').trim();
    const promptOptions = {
      systemPrompt: this.getSystemPrompt(),
      userPrompt: this.getUserPrompt(textContent),
      jsonMode: true,
      pdfBase64: pdfBase64 || null,
      maxTokens: 5000
    };

    const result = await LLMRouter.executeWithFallback(promptOptions, apiKeys, activeProvider, fallbackOrder);
    const parsedData = LLMRouter.extractJson(result.text);

    if (!parsedData || !parsedData.basic) {
      throw new Error('Failed to parse a valid structured candidate profile from the model response.');
    }

    return {
      profile: parsedData,
      providerUsed: result.usedProvider,
      modelUsed: result.modelUsed,
      fallbackOccurred: result.fallbackOccurred
    };
  }
}
