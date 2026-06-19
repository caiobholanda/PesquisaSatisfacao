'use strict';

// Tradução automática pt-BR → demais idiomas suportados na anamnese.
// Usa MyMemory Translation API (gratuito, sem chave). Limite: 1000
// palavras/dia/IP anonimo; 50000/dia se passar email valido no parametro 'de'.
// Falha silenciosa: se a tradução não vier, devolve o texto original como
// fallback (nunca quebra o fluxo de salvar).
//
// Por que MyMemory:
// - Sem cadastro, sem chave, sem cartao de credito.
// - Suporta os 7 idiomas que precisamos (pt-PT, en, es, fr, it, de).
// - Latencia baixa (~200-400ms por idioma) e qualidade boa pra rotulos
//   curtos (tipo "Nome", "Você tem alergia?").
// - Trocavel facil por LibreTranslate/DeepL/Argos no futuro sem mexer
//   na assinatura externa (traduzirParaTodos).

const IDIOMAS = {
  'pt-PT': 'pt-PT',
  'en':    'en-GB',
  'es':    'es-ES',
  'fr':    'fr-FR',
  'it':    'it-IT',
  'de':    'de-DE',
};
const FONTE = 'pt-BR';
// Email para subir o limite de 1000 -> 50000 palavras/dia.
const DE_EMAIL = process.env.MYMEMORY_EMAIL || 'caiobholanda2007@gmail.com';

async function _traduzirUmTentativa(texto, alvo, timeoutMs) {
  const langpair = `${FONTE}|${IDIOMAS[alvo]}`;
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(texto)}&langpair=${encodeURIComponent(langpair)}&de=${encodeURIComponent(DE_EMAIL)}`;
  const r = await fetch(url, {
    headers: { 'User-Agent': 'PesquisaSatisfacaoSPA-GranMarquise/1.0' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error('http ' + r.status);
  const j = await r.json();
  if (j?.quotaFinished) throw new Error('quota mymemory esgotada');
  const traduzido = j?.responseData?.translatedText;
  if (typeof traduzido !== 'string' || !traduzido.trim()) throw new Error('resposta vazia');
  if (/^(MYMEMORY|PLEASE SELECT|INVALID)/i.test(traduzido.trim())) {
    throw new Error('mymemory: ' + traduzido.slice(0, 80));
  }
  return traduzido.trim();
}

// Retry com backoff: 12s → 18s. Necessario porque MyMemory ocasionalmente
// e' lento ou retorna 429 quando chamado em rajada (6 idiomas em paralelo).
async function _traduzirUm(texto, alvo) {
  const timeouts = [12000, 18000];
  for (let i = 0; i < timeouts.length; i++) {
    try {
      return await _traduzirUmTentativa(texto, alvo, timeouts[i]);
    } catch (e) {
      console.warn('[traduzir]', alvo, 'tentativa', i + 1, e.message);
      if (i < timeouts.length - 1) await new Promise(r => setTimeout(r, 400));
    }
  }
  return null;
}

/**
 * Traduz um texto em pt-BR para os idiomas pedidos via MyMemory.
 * Requests paralelas (Promise.all), uma por idioma.
 * @param {string} ptBR - texto fonte
 * @param {string[]} [idiomas] - subconjunto de Object.keys(IDIOMAS); default: todos
 * @returns {Promise<Record<string,string>>} mapa { 'pt-PT': '...', 'en': '...', ... }
 */
export async function traduzirParaTodos(ptBR, idiomas) {
  const fonte = String(ptBR || '').trim();
  const alvos = (idiomas && idiomas.length) ? idiomas.filter(i => i in IDIOMAS) : Object.keys(IDIOMAS);
  if (!fonte) return Object.fromEntries(alvos.map(i => [i, '']));

  // Fallback inicial: se algum idioma falhar, fica com pt-BR.
  const out = Object.fromEntries(alvos.map(i => [i, fonte]));

  // SEQUENCIAL (nao paralelo): MyMemory rate-limita rajadas do mesmo IP
  // (especialmente do IP compartilhado do Fly.io GRU). 6 requests
  // sequenciais (~1s cada) acabam sendo mais robustas que 6 paralelas
  // que falham juntas.
  for (const alvo of alvos) {
    const texto = await _traduzirUm(fonte, alvo);
    if (texto) out[alvo] = texto;
  }
  return out;
}
