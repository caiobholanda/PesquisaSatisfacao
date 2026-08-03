/*
 * Deteccao de idioma 100% local — sem chamada de API, sem chave, sem custo.
 *
 * Substitui a versao que chamava a API da Anthropic. Para textos curtos de
 * pesquisa de satisfacao (poucas frases), contagem de palavras funcionais +
 * sinais de acentuacao e mais confiavel do que modelos genericos de N idiomas,
 * porque o conjunto de idiomas esperado e pequeno e conhecido.
 *
 * Contrato preservado: recebe array de textos, devolve codigo ISO 639-1 em
 * minusculas ou null quando nao ha sinal suficiente.
 */

// Palavras funcionais DISCRIMINATIVAS (ja normalizadas, sem acento).
// Evitam-se palavras compartilhadas entre idiomas proximos: "hotel", "personal",
// "service" e "todo" aparecem em varios e nao ajudam a decidir.
const PALAVRAS = {
  pt: ['nao', 'voce', 'muito', 'obrigado', 'obrigada', 'tambem', 'otimo', 'ate',
       'entao', 'quarto', 'atendimento', 'limpeza', 'funcionarios', 'estadia',
       'sao', 'estao', 'foram', 'ficou', 'melhorar', 'excelente'],
  es: ['muy', 'gracias', 'pero', 'usted', 'habitacion', 'desayuno', 'bueno',
       'buena', 'estuvo', 'tambien', 'fue', 'son', 'nosotros', 'ellos',
       'limpieza', 'atencion', 'personal_es', 'todos_es'],
  en: ['the', 'and', 'was', 'very', 'with', 'staff', 'room', 'breakfast',
       'were', 'our', 'they', 'thank', 'good', 'great', 'have', 'stay',
       'clean', 'would', 'this', 'that'],
  fr: ['les', 'est', 'tres', 'pour', 'avec', 'nous', 'vous', 'merci',
       'chambre', 'petit', 'etait', 'personnel', 'sejour', 'tout', 'bonne',
       'accueil', 'dejeuner'],
  it: ['che', 'molto', 'sono', 'grazie', 'camera', 'colazione', 'personale',
       'anche', 'della', 'dello', 'degli', 'questo', 'buono', 'buona',
       'soggiorno', 'ottimo'],
  de: ['und', 'der', 'die', 'das', 'ist', 'sehr', 'nicht', 'mit', 'war',
       'danke', 'zimmer', 'fruhstuck', 'wir', 'gut', 'alles', 'wurde',
       'freundlich', 'sauber'],
};

// Sinais de escrita no texto ORIGINAL (com acentos). Peso maior que palavra
// solta porque sao praticamente exclusivos de cada idioma.
const SINAIS = [
  { lang: 'pt', re: /[ãõ]/g, peso: 6 },
  { lang: 'pt', re: /(nh|lh)/gi, peso: 3 },
  { lang: 'es', re: /[ñ¿¡]/g, peso: 8 },
  { lang: 'de', re: /[äöüß]/g, peso: 7 },
  { lang: 'fr', re: /(œ|[êèùâîï]|qu')/g, peso: 4 },
  { lang: 'it', re: /\b(gli|gn)\w/gi, peso: 3 },
];

function normalizar(texto) {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z\s]/g, ' ');
}

/**
 * @param {string[]} textos Trechos de texto livre respondidos pelo hospede.
 * @returns {Promise<string|null>} Codigo ISO 639-1 ou null.
 */
export async function detectarIdioma(textos) {
  const texto = (textos || []).filter(Boolean).join(' ').trim();
  if (!texto || texto.length < 4) return null;

  const amostra = texto.slice(0, 400);
  const palavras = normalizar(amostra).split(/\s+/).filter(Boolean);
  if (!palavras.length) return null;

  const conta = new Map();
  for (const p of palavras) conta.set(p, (conta.get(p) || 0) + 1);

  const pontos = { pt: 0, es: 0, en: 0, fr: 0, it: 0, de: 0 };

  for (const [lang, lista] of Object.entries(PALAVRAS)) {
    for (const palavra of lista) {
      const ocorrencias = conta.get(palavra);
      if (ocorrencias) pontos[lang] += 3 * ocorrencias;
    }
  }

  for (const { lang, re, peso } of SINAIS) {
    const achados = amostra.match(re);
    if (achados) pontos[lang] += peso * achados.length;
  }

  const ranking = Object.entries(pontos).sort((a, b) => b[1] - a[1]);
  const [melhorLang, melhorPonto] = ranking[0];

  // Sem nenhum sinal reconhecido: nao inventa um palpite (mesma decisao da
  // versao anterior, que devolvia null quando a API falhava).
  if (melhorPonto === 0) return null;

  return melhorLang;
}
