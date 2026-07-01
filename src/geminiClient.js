const { GoogleGenerativeAI } = require('@google/generative-ai');

const DEFAULT_GEMINI_TIMEOUT_MS = 5000;
const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite-preview';

function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('gemini_timeout')), timeoutMs);
    }),
  ]);
}

async function generateGeminiText({ apiKey, prompt, timeoutMs = DEFAULT_GEMINI_TIMEOUT_MS }) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: DEFAULT_GEMINI_MODEL });
  const result = await withTimeout(model.generateContent(prompt), timeoutMs);
  return result.response.text();
}

module.exports = {
  DEFAULT_GEMINI_TIMEOUT_MS,
  generateGeminiText,
};
