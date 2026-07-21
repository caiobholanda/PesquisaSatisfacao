// Feriados sincronizados com o Hub Gran Marquise (fonte da verdade: tela
// Feriados do Hub, hub_data.json). Busca server-to-server com Bearer SSO_SECRET,
// cache em memória de 60s e fallback para a lista que antes era hardcoded em
// public/escala-spa.html — se o Hub estiver fora do ar a escala continua igual.

const HUB_URL = process.env.HUB_URL || 'https://hub-granmarquise.fly.dev';
const TTL_MS = 60 * 1000;
const FETCH_TIMEOUT_MS = 4000;

// Copia exata do antigo FERIADOS do frontend (2025-2028).
const FALLBACK = (() => {
  const F = {};
  const fixos = [
    ['01-01', 'Ano Novo'], ['03-19', 'São José'], ['03-25', 'Data Magna CE'],
    ['04-13', 'Aniversário de Fortaleza'], ['04-21', 'Tiradentes'], ['05-01', 'Dia do Trabalho'],
    ['06-24', 'São João'], ['08-15', 'N.Sra. Assunção'], ['09-07', 'Independência'],
    ['10-12', 'N.Sra. Aparecida'], ['11-02', 'Finados'], ['11-15', 'Proclamação da República'],
    ['11-20', 'Consciência Negra'], ['12-25', 'Natal'],
  ];
  for (const ano of [2025, 2026, 2027, 2028]) {
    for (const [md, nome] of fixos) F[`${ano}-${md}`] = nome;
  }
  const moveis = {
    '2025-03-03': 'Carnaval', '2025-03-04': 'Carnaval',
    '2025-04-18': 'Sexta-feira Santa', '2025-06-19': 'Corpus Christi',
    '2026-02-16': 'Carnaval', '2026-02-17': 'Carnaval',
    '2026-04-03': 'Sexta-feira Santa', '2026-06-04': 'Corpus Christi',
    '2027-02-08': 'Carnaval', '2027-02-09': 'Carnaval',
    '2027-03-26': 'Sexta-feira Santa', '2027-05-27': 'Corpus Christi',
    '2028-02-28': 'Carnaval', '2028-02-29': 'Carnaval',
    '2028-04-14': 'Sexta-feira Santa', '2028-06-15': 'Corpus Christi',
  };
  return { ...F, ...moveis };
})();

let cache = { at: 0, feriados: null, fonte: null };

// Retorna { feriados: { 'YYYY-MM-DD': 'Nome' }, fonte: 'hub'|'hub-cache'|'fallback' }.
// Confia no Hub sempre que ele responder ok — inclusive lista vazia (feriado
// inativado no Hub deve SUMIR da escala). Fallback só em erro de rede/HTTP.
export async function getFeriados() {
  const agora = Date.now();
  if (cache.feriados && agora - cache.at < TTL_MS) {
    return { feriados: cache.feriados, fonte: cache.fonte };
  }
  const sso = process.env.SSO_SECRET || '';
  if (sso) {
    try {
      const r = await fetch(`${HUB_URL}/api/hub/feriados`, {
        headers: { Authorization: `Bearer ${sso}` },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      const d = await r.json().catch(() => null);
      if (r.ok && d && d.ok && Array.isArray(d.feriados)) {
        const map = {};
        for (const f of d.feriados) {
          if (f && typeof f.data === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f.data) && f.nome) {
            map[f.data] = String(f.nome);
          }
        }
        cache = { at: agora, feriados: map, fonte: 'hub' };
        return { feriados: map, fonte: 'hub' };
      }
    } catch {
      // rede/timeout — cai no fallback abaixo
    }
  }
  // Hub indisponível: mantém último dado real do Hub se houver; senão lista embutida
  if (cache.feriados && (cache.fonte === 'hub' || cache.fonte === 'hub-cache')) {
    cache = { at: agora, feriados: cache.feriados, fonte: 'hub-cache' };
    return { feriados: cache.feriados, fonte: 'hub-cache' };
  }
  cache = { at: agora, feriados: FALLBACK, fonte: 'fallback' };
  return { feriados: FALLBACK, fonte: 'fallback' };
}

export function _resetCacheFeriados() { cache = { at: 0, feriados: null, fonte: null }; }
export { FALLBACK as FERIADOS_FALLBACK };
