import jwt from 'jsonwebtoken';

function _readCookie(req, name) {
  const c = req.headers && req.headers.cookie;
  if (!c) return null;
  const m = c.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[1] : null;
}

export function requireAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  let token = header.startsWith('Bearer ') ? header.slice(7) : null;
  // Fallback para o cookie spa_admin_sess (setado pelo /sso quando o
  // usuario logou via Hub). Sem isso, o front que perdeu o sessionStorage
  // (ex: aba reaberta apos restart do browser) recebia 401 mesmo tendo
  // sessao valida no cookie.
  if (!token) token = _readCookie(req, 'spa_admin_sess') || _readCookie(req, 'spa_user_sess');
  if (!token) return res.status(401).json({ ok: false, error: 'Não autenticado' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ ok: false, error: 'Token inválido ou expirado' });
  }
}

export function requireMaster(req, res, next) {
  if (req.user?.role !== 'master') return res.status(403).json({ ok: false, error: 'Acesso restrito a administradores master' });
  next();
}

// Pode escrever? master = sim. spa/satisfacao = sim dentro do seu escopo.
// admin = nao (read-only). user = nao.
// Use este para POST/PUT/DELETE que pertencem ao escopo do Spa OU Satisfacao,
// junto com requireSpa/requireSatisfacao quando aplicavel.
export function requireWrite(req, res, next) {
  if (req.user?.role === 'admin') return res.status(403).json({ ok: false, error: 'Seu perfil é somente leitura' });
  if (!['master', 'spa', 'satisfacao'].includes(req.user?.role)) return res.status(403).json({ ok: false, error: 'Acesso restrito' });
  next();
}

// Acesso ao escopo Spa: master e spa.
export function requireSpa(req, res, next) {
  if (!['master', 'spa', 'admin'].includes(req.user?.role)) return res.status(403).json({ ok: false, error: 'Acesso restrito ao Spa' });
  next();
}

// Acesso ao escopo Satisfacao (Relatorios/Historico): master e satisfacao.
// 'admin' tambem pode VER (read-only).
export function requireSatisfacao(req, res, next) {
  if (!['master', 'satisfacao', 'admin'].includes(req.user?.role)) return res.status(403).json({ ok: false, error: 'Acesso restrito a relatórios' });
  next();
}

// Middleware EXCLUSIVO da rota /api/terapeuta/* — cookie isolado
// (spa_terapeuta_sess). NAO compartilha com spa_admin_sess. NAO concede
// acesso a nenhum endpoint admin. Popula req.user com massagista_id e
// role:'terapeuta'.
export function requireTerapeuta(req, res, next) {
  const token = _readCookie(req, 'spa_terapeuta_sess');
  if (!token) return res.status(401).json({ ok: false, error: 'Não autenticado' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload?.role !== 'terapeuta' || !payload?.massagista_id) {
      return res.status(401).json({ ok: false, error: 'Token invalido' });
    }
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ ok: false, error: 'Sessao expirada' });
  }
}
