import { GoogleGenAI } from "@google/genai";

const timeoutMs = 20_000;

export async function generateText({ system, user, maxTokens = 700 }) {
  if (!process.env.AI_API_KEY) return null;
  const client = new GoogleGenAI({ apiKey: process.env.AI_API_KEY });
  const generation = client.models.generateContent({
    model: process.env.AI_MODEL || "gemini-2.5-flash",
    contents: user,
    config: {
      systemInstruction: system,
      maxOutputTokens: maxTokens
    }
  });
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error("AI request timed out.")), timeoutMs);
  });
  const response = await Promise.race([generation, timeout]);
  return response.text || "";
}
