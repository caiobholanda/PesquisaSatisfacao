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
