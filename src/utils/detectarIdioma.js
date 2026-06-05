import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

export async function detectarIdioma(textos) {
  const texto = textos.filter(Boolean).join(' ').trim();
  if (!texto || texto.length < 4) return null;

  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8,
      messages: [{
        role: 'user',
        content: `Detect the language. Reply with ONLY the ISO 639-1 code (pt, en, fr, es, it, de, etc). Text: "${texto.slice(0, 400)}"`,
      }],
    });
    const code = msg.content[0]?.text?.trim().toLowerCase().replace(/[^a-z-]/g, '').slice(0, 5);
    return code || null;
  } catch {
    return null;
  }
}
