'use strict';

// Tradução automática pt-BR → demais idiomas suportados na anamnese.
// Usa Anthropic Claude (haiku) — leve, barato e bom o suficiente para
// rótulos curtos. Falha silenciosa: se a tradução não vier, devolve
// o texto original como fallback (nunca quebra o fluxo de salvar).

import Anthropic from '@anthropic-ai/sdk';

const IDIOMAS = {
  'pt-PT': 'Português europeu',
  'en':    'English',
  'es':    'Español',
  'fr':    'Français',
  'it':    'Italiano',
  'de':    'Deutsch',
};

let _client = null;
function _getClient() {
  if (_client) return _client;
  if (!process.env.ANTHROPIC_API_KEY) return null;
  _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

/**
 * Traduz um texto em português brasileiro para os idiomas pedidos.
 * @param {string} ptBR - texto fonte
 * @param {string[]} idiomas - subconjunto de Object.keys(IDIOMAS); default: todos
 * @returns {Promise<Record<string,string>>} mapa { 'pt-PT': '...', 'en': '...', ... }
 */
export async function traduzirParaTodos(ptBR, idiomas) {
  const fonte = String(ptBR || '').trim();
  const alvos = (idiomas && idiomas.length) ? idiomas.filter(i => i in IDIOMAS) : Object.keys(IDIOMAS);
  if (!fonte) {
    return Object.fromEntries(alvos.map(i => [i, '']));
  }
  // Fallback inicial: sempre devolve o texto original em todos os idiomas
  // caso a chamada falhe.
  const out = Object.fromEntries(alvos.map(i => [i, fonte]));

  const client = _getClient();
  if (!client) {
    console.warn('[traduzir] ANTHROPIC_API_KEY ausente — devolvendo texto original');
    return out;
  }

  const lista = alvos.map(c => `- ${c} (${IDIOMAS[c]})`).join('\n');
  const prompt = `Você é tradutor profissional para um SPA de luxo. Traduza o texto abaixo do português brasileiro para os idiomas listados, preservando o tom formal/cordial e mantendo a mesma intenção. NÃO adicione comentários, NÃO mude pontuação além do necessário.

Texto fonte:
"${fonte}"

Idiomas-alvo:
${lista}

Responda APENAS um JSON com as chaves dos idiomas e os valores traduzidos, exemplo:
{"pt-PT":"...","en":"...","es":"...","fr":"...","it":"...","de":"..."}`;

  try {
    const resp = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    });
    const txt = (resp?.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim();
    // Remove cercas de bloco de código se Claude as adicionar.
    const limpo = txt.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    const obj = JSON.parse(limpo);
    for (const k of alvos) {
      if (typeof obj[k] === 'string' && obj[k].trim()) out[k] = obj[k].trim();
    }
  } catch (e) {
    console.warn('[traduzir] falha — devolvendo fallback:', e.message);
  }
  return out;
}
