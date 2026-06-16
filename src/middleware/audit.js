import { logAuditoria } from '../db.js';

// Rotas que NÃO precisam ser auditadas (ruído: health, polling, leituras).
const ROTAS_IGNORAR = [
  /^\/api\/health$/,
  /^\/api\/auditoria/,           // listar histórico não polui o próprio histórico
  /^\/api\/feedback\/stats/,
  /^\/api\/survey\/live$/,        // polling do quiosque
  /^\/api\/massagistas-ativas/,
  /^\/api\/tipos-massagem-ativos/,
];

const ROTULOS_RECURSOS = {
  reservas: 'Reservas',
  feedback: 'Pesquisas respondidas',
  auth: 'Autenticação',
  clientes: 'Clientes',
  qualidade: 'Gestão da qualidade',
  survey: 'Gestão da qualidade',
  spa: 'Anamnese',
  massagistas: 'Massoterapeutas',
  'tipos-massagem': 'Tipos de tratamento',
  relatorios: 'Relatórios',
  dev: 'Ferramenta dev',
};

function _descobrirRecurso(p) {
  const m = p.match(/^\/api\/([a-z-]+)/);
  return m ? m[1] : 'outro';
}

function _descobrirAcao(method, path) {
  const r = _descobrirRecurso(path);
  // Casos especiais por path
  if (/\/liberar-pesquisa/.test(path))   return 'liberar_pesquisa';
  if (/\/gerar-ficha/.test(path))        return 'gerar_ficha_anamnese';
  if (/\/publicar/.test(path))           return 'publicar_pesquisa';
  if (/\/despublicar/.test(path))        return 'despublicar_pesquisa';
  if (/\/clonar/.test(path))             return 'clonar_pesquisa';
  if (/\/perfil$/.test(path) && r === 'spa') return 'salvar_anamnese';
  if (/\/login$/.test(path))             return 'login';
  if (/\/seed-demo/.test(path))          return 'reset_demo';
  if (method === 'POST')   return 'criar_' + r;
  if (method === 'PUT')    return 'atualizar_' + r;
  if (method === 'DELETE') return 'remover_' + r;
  return 'acao_' + r;
}

function _safeBody(body) {
  if (!body || typeof body !== 'object') return null;
  // Remove campos sensíveis / volumosos antes de persistir
  const clone = { ...body };
  delete clone.password;
  delete clone.senha;
  delete clone.password_hash;
  delete clone.assinatura_data_url;
  delete clone.sso_token;
  delete clone.token;
  try {
    return JSON.stringify(clone).slice(0, 2000);
  } catch { return null; }
}

function _extrairRecursoId(path, capturedBody) {
  const m = path.match(/\/(\d+)(?:\/|$)/);
  if (m) return m[1];
  if (capturedBody && (capturedBody.id != null)) return String(capturedBody.id);
  return null;
}

export function auditMiddleware(req, res, next) {
  // Apenas operações que modificam estado. GET/HEAD/OPTIONS são ignorados.
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();

  // IMPORTANTE: snapshot do path agora. Dentro dos sub-routers, req.path
  // é reescrito (perde o prefixo /api/...). originalUrl preserva.
  const path = (req.originalUrl || req.url || '').split('?')[0];
  const method = req.method;
  const bodySnapshot = req.body ? { ...req.body } : null;
  const ip = (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim() || null;

  if (ROTAS_IGNORAR.some(re => re.test(path))) return next();

  // Captura body retornado por res.json para extrair id (criação)
  const origJson = res.json.bind(res);
  let capturedBody = null;
  res.json = function (body) {
    try { capturedBody = body; } catch {}
    return origJson(body);
  };

  res.on('finish', () => {
    try {
      const status = res.statusCode;
      const sucesso = status >= 200 && status < 400;
      const ator = req.user || null;
      const recurso = _descobrirRecurso(path);
      const acao = _descobrirAcao(method, path);
      const recurso_id = _extrairRecursoId(path, capturedBody);
      const detalhes = _safeBody(bodySnapshot);
      logAuditoria({
        ator_username: ator?.username || null,
        ator_role:     ator?.role     || null,
        ator_ip:       ip,
        metodo:        method,
        rota:          path,
        acao,
        recurso,
        recurso_id,
        status,
        detalhes,
        sucesso,
      });
    } catch (e) {
      console.error('[audit middleware] erro:', e.message);
    }
  });

  next();
}

export const ROTULOS = ROTULOS_RECURSOS;
