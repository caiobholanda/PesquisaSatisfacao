// Sync de profissionais Hub → SPA.
// Quem está na aba Liberação do Hub (app Gestão de SPA) com papel 'spa'
// (Recepcionista) ou 'massoterapeuta' vira/reativa registro em massagistas;
// quem sai de lá é desativado. Padrão igual a ausencias-hub.js: pull lazy com
// TTL + timeout curto, tolerante a falha — Hub fora do ar mantém dados locais
// e NUNCA desativa ninguém sem resposta ok do Hub.
import { sincronizarProfissionaisDoHub } from './db.js';

const HUB_URL = process.env.HUB_URL || 'https://hub-granmarquise.fly.dev';
const TTL_MS = 60_000;
const ERRO_TTL_MS = 30_000; // Hub fora do ar: não paga 4s de timeout a cada request
const FETCH_TIMEOUT_MS = 4000;

let _lastOkTs = 0;
let _lastErroTs = 0;
let _inFlight = null;

export async function syncProfissionaisHub({ force = false } = {}) {
  if (!force && Date.now() - _lastOkTs < TTL_MS) return { fonte: 'cache' };
  if (!force && Date.now() - _lastErroTs < ERRO_TTL_MS) return { fonte: 'erro-cache' };
  if (_inFlight) return _inFlight;
  _inFlight = (async () => {
    try {
      const sso = process.env.SSO_SECRET;
      if (!sso) return { fonte: 'skip' };
      const r = await fetch(`${HUB_URL}/api/hub/site-admins?sistema_id=pesquisa-satisfacao`, {
        headers: { Authorization: `Bearer ${sso}` },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      if (!data || data.ok !== true || !Array.isArray(data.items)) throw new Error('resposta invalida');
      const resumo = sincronizarProfissionaisDoHub(data.items);
      _lastOkTs = Date.now();
      return { fonte: 'hub', ...resumo };
    } catch (e) {
      return { fonte: 'erro', erro: e?.message || String(e) };
    } finally {
      _inFlight = null;
    }
  })();
  return _inFlight;
}
