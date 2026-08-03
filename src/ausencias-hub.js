// Tipos de ausência sincronizados com o Hub Gran Marquise (fonte da verdade:
// aba Ausências do Hub, hub_data.json). Mesmo desenho de feriados-hub.js:
// busca server-to-server com Bearer SSO_SECRET, cache em memória de 60s e
// fallback para a lista que sempre foi hardcoded em public/escala-spa.html —
// se o Hub estiver fora do ar a escala continua exatamente como era.
//
// O Hub devolve TODOS os tipos com a flag `ativo`: os inativos ainda são
// necessários para nomear células históricas da grade; só os ativos entram no
// seletor e são aceitos em novas gravações.

import { registrarMotivosAusencia } from './db.js';

const HUB_URL = process.env.HUB_URL || 'https://hub-granmarquise.fly.dev';
const TTL_MS = 60 * 1000;
const FETCH_TIMEOUT_MS = 4000;

// Cópia exata do conjunto que a escala usava hardcoded (VALID_STATUS +
// SIG_TIP de escala-spa.html).
const FALLBACK = [
  { sigla: 'X',  nome: 'Folga',              ativo: true },
  { sigla: 'FE', nome: 'Férias',             ativo: true },
  { sigla: 'AT', nome: 'Atestado Médico',    ativo: true },
  { sigla: 'AA', nome: 'Abono Aniversário',  ativo: true },
  { sigla: 'CF', nome: 'Comp. Feriado',      ativo: true },
  { sigla: 'CH', nome: 'Compensação Hora',   ativo: true },
  { sigla: 'LS', nome: 'Licença Sindical',   ativo: true },
  { sigla: 'LC', nome: 'Licença Casamento',  ativo: true },
  { sigla: 'F',  nome: 'Falta',              ativo: true },
];

let cache = { at: 0, ausencias: null, fonte: null };

// Retorna { ausencias: [{sigla, nome, ativo}], fonte: 'hub'|'hub-cache'|'fallback' }.
// Confia no Hub sempre que ele responder ok — tipo desativado lá deve sumir do
// seletor daqui. Fallback só em erro de rede/HTTP.
export async function getAusencias() {
  const agora = Date.now();
  if (cache.ausencias && agora - cache.at < TTL_MS) {
    return { ausencias: cache.ausencias, fonte: cache.fonte };
  }
  const sso = process.env.SSO_SECRET || '';
  if (sso) {
    try {
      const r = await fetch(`${HUB_URL}/api/hub/ausencias`, {
        headers: { Authorization: `Bearer ${sso}` },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      const d = await r.json().catch(() => null);
      if (r.ok && d && d.ok && Array.isArray(d.ausencias)) {
        const lista = d.ausencias
          .filter(a => a && typeof a.sigla === 'string' && /^[A-ZÀ-ÿ0-9]{1,4}$/.test(a.sigla) && a.nome)
          .map(a => ({ sigla: a.sigla, nome: String(a.nome), ativo: a.ativo !== false }));
        if (lista.length > 0) {
          // Disponibilidade: qualquer sigla conhecida veta reserva no dia.
          // Merge apenas ADICIONA — siglas legadas mantêm o motivo original e
          // tipos desativados continuam vetando células históricas.
          try { registrarMotivosAusencia(lista); } catch {}
          cache = { at: agora, ausencias: lista, fonte: 'hub' };
          return { ausencias: lista, fonte: 'hub' };
        }
      }
    } catch {
      // rede/timeout — cai no fallback abaixo
    }
  }
  if (cache.ausencias && (cache.fonte === 'hub' || cache.fonte === 'hub-cache')) {
    cache = { at: agora, ausencias: cache.ausencias, fonte: 'hub-cache' };
    return { ausencias: cache.ausencias, fonte: 'hub-cache' };
  }
  cache = { at: agora, ausencias: FALLBACK, fonte: 'fallback' };
  return { ausencias: FALLBACK, fonte: 'fallback' };
}

// Siglas aceitas em NOVAS gravações de turno. "X" é sempre válida: o fluxo de
// padrões semanais converte FOLGA→X no servidor sem passar pelo seletor, e
// desativar "Folga" no Hub não pode quebrar a aplicação de padrão.
export async function getSiglasAtivas() {
  const { ausencias } = await getAusencias();
  const set = new Set(ausencias.filter(a => a.ativo).map(a => a.sigla));
  set.add('X');
  return set;
}

export function _resetCacheAusencias() { cache = { at: 0, ausencias: null, fonte: null }; }
export { FALLBACK as AUSENCIAS_FALLBACK };
