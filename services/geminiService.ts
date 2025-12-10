import { GoogleGenAI, Type } from "@google/genai";
import { GradingResult, GradeOptions } from "../types";

// ==================================================================================
// SYSTEM PROMPTS & PERSONAS
// ==================================================================================

// Helper to generate a random grading persona to ensure score variance (Normal Distribution simulation)
const getRandomPersona = () => {
    const r = Math.random();
    // 20% Strict (Pulls scores down)
    // 60% Standard/Balanced (Average)
    // 20% Detailed/Nuanced (Adds variance)
    
    if (r < 0.20) {
        return "MODE: STRICT GRADER. You are a very critical professor. Scrutinize every error. Do not give high scores easily. Scores >90 should be extremely rare and reserved for perfection.";
    } else if (r > 0.80) {
        return "MODE: NUANCED GRADER. Focus heavily on originality and depth. If the work is generic, grade it strictly average. Do not inflate scores.";
    } else {
        return "MODE: STANDARD GRADER. Evaluate fairly but realistically. Assume a normal distribution of student abilities. Most scores should fall in the middle range, not at the top.";
    }
};

const getSystemPrompt = (min: number, max: number, personaInstruction: string) => `
  You are an expert academic teacher and professional editor. 
  Your goal is to grade assignments and provide structured JSON output.
  
  GRADING INSTRUCTIONS:
  ${personaInstruction}
  CRITICAL: Do not output multiple scores that are identical if possible. Use the full precision of the range ${min} to ${max}.
  
  Output JSON Schema:
  {
    "score": "integer, strictly between ${min} and ${max}",
    "letter_grade": "string, e.g. A, B, C",
    "summary": "string, 2-3 sentence executive summary in Simplified Chinese (简体中文)",
    "teacher_comment": "string, a professional paragraph (~50 words) addressing the student directly in Simplified Chinese (简体中文). This is strictly required as it will be printed on the student's paper.",
    "feedback": [
      {
        "original_text": "string, exact quote from document",
        "comment": "string, critique or praise in Simplified Chinese (简体中文)",
        "sentiment": "string, 'positive', 'negative', or 'neutral'",
        "score_impact": "integer, e.g. -2, +5, 0",
        "suggestion": "string, optional improvement suggestion in Simplified Chinese (简体中文)"
      }
    ]
  }
`;

const getUserPrompt = (text: string, min: number, max: number) => `
  Analyze the following document content.
  Assign a Score strictly between ${min} and ${max}.
  
  Document Content:
  "${text}"
  
  Return ONLY valid JSON.
`;

// Helper for generic JSON parsing
const extractJson = (text: string) => {
    try {
        return JSON.parse(text);
    } catch (e) {
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start !== -1 && end !== -1) {
            try {
                return JSON.parse(text.substring(start, end + 1));
            } catch (e2) { return null; }
        }
        return null;
    }
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ==================================================================================
// DISPATCHER
// ==================================================================================

export const gradeDocument = async (textContext: string, options: GradeOptions): Promise<GradingResult> => {
  const { provider } = options.aiConfig;

  // Truncate text to avoid token limits (approx 30k chars)
  const truncatedText = textContext.slice(0, 30000);

  // Generate a unique persona for this specific document grading session
  const persona = getRandomPersona();

  if (provider === 'gemini') {
      return gradeWithGemini(truncatedText, options, persona);
  } else {
      // All other providers (Doubao, DeepSeek, Kimi, OpenAI) use the universal adapter
      return gradeWithUniversalAPI(truncatedText, options, persona);
  }
};

// ==================================================================================
// GEMINI ENGINE (Google SDK)
// ==================================================================================

const gradeWithGemini = async (text: string, options: GradeOptions, persona: string): Promise<GradingResult> => {
  if (!process.env.API_KEY) throw new Error("Internal API Key missing for Gemini");

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const { minScore, maxScore } = options;

  const MAX_RETRIES = 10; 
  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: getUserPrompt(text, minScore, maxScore),
            config: {
                systemInstruction: getSystemPrompt(minScore, maxScore, persona),
                temperature: 0.8, // Increased for variance
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        score: { type: Type.INTEGER },
                        letter_grade: { type: Type.STRING },
                        summary: { type: Type.STRING },
                        teacher_comment: { type: Type.STRING },
                        feedback: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    original_text: { type: Type.STRING },
                                    comment: { type: Type.STRING },
                                    sentiment: { type: Type.STRING },
                                    score_impact: { type: Type.INTEGER },
                                    suggestion: { type: Type.STRING }
                                }
                            }
                        }
                    }
                }
            }
        });

        const resultJson = response.text ? JSON.parse(response.text) : null;
        if (!resultJson) throw new Error("Empty response from Gemini");
        
        return resultJson as GradingResult;

    } catch (error: any) {
        attempt++;
        if (error.message && error.message.includes('429')) {
             const backoff = Math.pow(2, attempt) * 5000;
             const delayTime = Math.min(backoff, 60000);
             console.warn(`Gemini 429 (Attempt ${attempt}/${MAX_RETRIES}). Waiting ${delayTime/1000}s...`);
             await sleep(delayTime);
             if (attempt === MAX_RETRIES) throw new Error(`Gemini overload: ${error.message}`);
             continue;
        }
        if (error.message && (error.message.includes('500') || error.message.includes('503'))) {
             await sleep(3000);
             continue;
        }
        throw new Error(error.message || "Unknown Gemini Error");
    }
  }
  throw new Error("Gemini failed after retries");
};

// ==================================================================================
// UNIVERSAL API ENGINE (OpenAI Compatible)
// ==================================================================================

const gradeWithUniversalAPI = async (text: string, options: GradeOptions, persona: string): Promise<GradingResult> => {
  const { baseUrl, apiKey, modelName, proxyUrl, provider } = options.aiConfig;
  const { minScore, maxScore } = options;

  if (!baseUrl) throw new Error(`${provider} Base URL is missing.`);
  if (!apiKey) throw new Error(`${provider} API Key is missing.`);
  if (!modelName) throw new Error(`${provider} Model Name is missing.`);

  let targetUrl = baseUrl.endsWith('/') ? `${baseUrl}chat/completions` : `${baseUrl}/chat/completions`;
  let finalUrl = targetUrl;
  if (proxyUrl) {
      const cleanProxy = proxyUrl.trim();
      if (cleanProxy.endsWith('?')) {
          finalUrl = `${cleanProxy}${targetUrl}`;
      } else {
          finalUrl = `${cleanProxy.replace(/\/$/, '')}/${targetUrl}`;
      }
  }

  const MAX_RETRIES = 5;
  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    try {
      const response = await fetch(finalUrl, {
          method: 'POST',
          headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
              model: modelName,
              messages: [
                  { role: "system", content: getSystemPrompt(minScore, maxScore, persona) },
                  { role: "user", content: getUserPrompt(text, minScore, maxScore) }
              ],
              temperature: 0.8, // Increased for variance
              stream: false,
              response_format: { type: "json_object" } 
          })
      });

      if (!response.ok) {
          const txt = await response.text();
          let errorMessage = `${provider} API Error ${response.status}: ${response.statusText}`;
          try {
              const jsonErr = JSON.parse(txt);
              if (jsonErr.error && jsonErr.error.message) {
                  errorMessage = `${provider} Error: ${jsonErr.error.message}`;
              }
          } catch(e) {}
          throw new Error(errorMessage);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error(`No content received from ${provider}`);

      const parsed = extractJson(content);
      if (!parsed) throw new Error(`Failed to parse valid JSON from ${provider} response`);

      return parsed as GradingResult;

    } catch (error: any) {
      attempt++;
      const msg = error.message || '';
      
      if (msg.includes('429')) {
          const delayTime = Math.pow(2, attempt) * 5000;
          await sleep(delayTime);
          continue;
      }
      if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
          throw new Error("Network Error (CORS). Use Proxy option.");
      }
      
      if (attempt < MAX_RETRIES) {
          await sleep(2000);
          continue;
      }
      throw new Error(msg || `${provider} failed unknown error`);
    }
  }

  throw new Error(`${provider} failed after retries`);
};