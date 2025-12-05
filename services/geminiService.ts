import { GoogleGenAI, Schema, Type } from "@google/genai";
import { GradingResult, GradeOptions } from "../types";

// ==================================================================================
// SYSTEM PROMPTS
// ==================================================================================

const getSystemPrompt = (min: number, max: number) => `
  You are an expert academic teacher and professional editor. 
  Your goal is to grade assignments and provide structured JSON output.
  
  Output JSON Schema:
  {
    "score": "integer, strictly between ${min} and ${max}",
    "letter_grade": "string, e.g. A, B, C",
    "summary": "string, 2-3 sentence executive summary",
    "teacher_comment": "string, a professional paragraph (~50 words) addressing the student directly, suitable for the 'Teacher Comments' box.",
    "feedback": [
      {
        "original_text": "string, exact quote from document",
        "comment": "string, critique or praise",
        "sentiment": "string, 'positive', 'negative', or 'neutral'",
        "score_impact": "integer, e.g. -2, +5, 0",
        "suggestion": "string, optional improvement suggestion"
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

  if (provider === 'gemini') {
      return gradeWithGemini(truncatedText, options);
  } else {
      return gradeWithDoubao(truncatedText, options);
  }
};

// ==================================================================================
// GEMINI ENGINE
// ==================================================================================

const gradeWithGemini = async (text: string, options: GradeOptions): Promise<GradingResult> => {
  if (!process.env.API_KEY) throw new Error("API Key missing");

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const { minScore, maxScore } = options;

  const MAX_RETRIES = 3;
  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: getUserPrompt(text, minScore, maxScore),
            config: {
                systemInstruction: getSystemPrompt(minScore, maxScore),
                responseMimeType: "application/json",
                // Defining schema helps Gemini return strictly structured data
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
        // Handle 429
        if (error.message && error.message.includes('429')) {
             const delayTime = Math.pow(2, attempt) * 2000;
             console.warn(`Gemini 429. Retrying in ${delayTime}ms...`);
             await sleep(delayTime);
             if (attempt === MAX_RETRIES) throw error;
             continue;
        }
        throw error;
    }
  }
  throw new Error("Gemini failed after retries");
};

// ==================================================================================
// DOUBAO (VOLCENGINE) ENGINE
// ==================================================================================

const gradeWithDoubao = async (text: string, options: GradeOptions): Promise<GradingResult> => {
  const { doubaoEndpointId, proxyUrl } = options.aiConfig;
  const { minScore, maxScore } = options;

  if (!doubaoEndpointId) throw new Error("Doubao Endpoint ID is missing.");
  
  // Use Gemini Key as fallback or assume user has set DOUBAO_API_KEY in env
  // Since we can't ask for UI input for key, we assume process.env.API_KEY is usable
  // or checks for a specific Doubao key.
  const apiKey = process.env.DOUBAO_API_KEY || process.env.API_KEY;
  if (!apiKey) throw new Error("API Key is missing.");

  const targetUrl = "https://ark.cn-beijing.volces.com/api/v3/chat/completions";
  // If proxy is set, prepend it. 
  // E.g. proxy = "https://cors-anywhere.herokuapp.com/"
  const finalUrl = proxyUrl ? `${proxyUrl.replace(/\/$/, '')}/${targetUrl}` : targetUrl;

  const MAX_RETRIES = 5;
  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    try {
      const response = await fetch(finalUrl, {
          method: 'POST',
          headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`,
              // Add generic headers that might help with some proxies
              'X-Requested-With': 'XMLHttpRequest'
          },
          body: JSON.stringify({
              model: doubaoEndpointId,
              messages: [
                  { role: "system", content: getSystemPrompt(minScore, maxScore) },
                  { role: "user", content: getUserPrompt(text, minScore, maxScore) }
              ],
              temperature: 0.2,
              stream: false
          })
      });

      if (!response.ok) {
          const txt = await response.text();
          throw { status: response.status, message: txt || response.statusText };
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error("No content from Doubao");

      const parsed = extractJson(content);
      if (!parsed) throw new Error("Failed to parse Doubao JSON");

      return parsed as GradingResult;

    } catch (error: any) {
      attempt++;
      const status = error.status || 0;
      
      // Retry on Rate Limit (429) or Server Error (5xx) or Network Error (fetch fail)
      if (attempt < MAX_RETRIES) {
          const delayTime = Math.pow(2, attempt) * 3000;
          console.warn(`Doubao Attempt ${attempt} failed (${status}). Retrying...`);
          await sleep(delayTime);
          continue;
      }
      
      if (error.name === 'TypeError' && error.message === 'Failed to fetch') {
         throw new Error("Network Error (CORS). Please try adding a Proxy URL in settings.");
      }
      
      throw error;
    }
  }

  throw new Error("Doubao failed after retries");
};