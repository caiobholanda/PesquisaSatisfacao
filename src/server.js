import 'dotenv/config';
import jwt from 'jsonwebtoken';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { initDb, listarMassagistas, listarTiposMassagem, buscarSurveyToken, buscarSurveyTokenAtivo } from './db.js';
import feedbackRouter from './routes/feedback.js';
import authRouter from './routes/auth.js';
import cadastrosRouter from './routes/cadastros.js';
import reservasRouter from './routes/reservas.js';
import devRouter from './routes/dev.js';
import spaRouter from './routes/spa.js';
import relatoriosRouter from './routes/relatorios.js';
import qualidadeRouter from './routes/qualidade.js';
import { seedQualidadeSpa, seedAnamneseSpa } from './qualidade.js';

const SPA_ADMIN_EMAILS = [
  'richard@granmarquise.com.br',
  'suporte.ti@granmarquise.com.br',
  'estagio.ti@granmarquise.com.br',
];

function getCookie(req, name) {
  const h = req.headers.cookie || '';
  const m = h.split(';').find(c => c.trim().startsWith(name + '='));
  return m ? decodeURIComponent(m.trim().slice(name.length + 1)) : null;
}

function setAdminCookie(res, token, maxAgeSeconds) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.appendHeader('Set-Cookie', `spa_admin_sess=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}; Path=/${secure}`);
}

function setUserCookie(res, token, maxAgeSeconds) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.appendHeader('Set-Cookie', `spa_user_sess=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}; Path=/${secure}`);
}

function clearAdminCookie(res) {
  res.appendHeader('Set-Cookie', 'spa_admin_sess=; Max-Age=0; Path=/; HttpOnly');
}

function temSessaoSpa(req) {
  const adminCookie = getCookie(req, 'spa_admin_sess');
  if (adminCookie) {
    try { jwt.verify(adminCookie, process.env.JWT_SECRET); return true; } catch {}
  }
  const userCookie = getCookie(req, 'spa_user_sess');
  if (userCookie) {
    try { jwt.verify(userCookie, process.env.JWT_SECRET); return true; } catch {}
  }
  return false;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));

app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'", "'unsafe-inline'"],
      styleSrc:    ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc:     ["'self'", 'https://fonts.gstatic.com'],
      imgSrc:      ["'self'", 'data:', 'https://letsimage.s3.amazonaws.com'],
      connectSrc:  ["'self'"],
      frameSrc:    ["'none'"],
      objectSrc:   ["'none'"],
    },
  },
}));
app.use(cors());
app.use(express.json({ limit: '100kb' }));

// Gate de acesso ao Spa: paginas HTML (incluindo /) so para quem ja passou pelo
// Hub e recebeu cookie spa_admin_sess (admin) ou spa_user_sess (padrao).
// Excecoes liberadas: APIs, /sso, /health, assets do bundle, favicon, acesso-hub.html.
function isPublicPath(p) {
  if (p.startsWith('/api/')) return true;
  if (p.startsWith('/assets/')) return true;
  if (p === '/sso' || p === '/health') return true;
  if (p === '/acesso-hub.html') return true;
  if (p === '/favicon.svg' || p === '/favicon.ico') return true;
  return false;
}
app.use((req, res, next) => {
  if (isPublicPath(req.path)) return next();
  if (temSessaoSpa(req)) return next();
  if (req.method !== 'GET') return res.status(401).json({ ok: false, error: 'Sessao expirada' });
  return res.redirect('/acesso-hub.html');
});

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/massagistas-ativas', (_req, res) => {
  const ativas = listarMassagistas().filter(m => m.ativo);
  res.json({
    nomes: ativas.map(m => m.nome),
    items: ativas.map(m => ({
      id: m.id,
      nome: m.nome,
      matricula: m.matricula,
      funcao: m.funcao,
      vinculo: m.vinculo,
      bilingue: !!m.bilingue,
      especialidade_original: m.especialidade_original,
      disponibilidade: m.disponibilidade ? (() => { try { return JSON.parse(m.disponibilidade); } catch { return null; } })() : null,
    })),
  });
});

app.get('/api/tipos-massagem-ativos', (_req, res) => {
  const ativos = listarTiposMassagem().filter(t => t.ativo);
  // Mapa de id → nome para resolver componentes
  const nomePorId = Object.fromEntries(ativos.map(t => [t.id, t.nome]));
  const items = ativos.map(t => {
    const componentes = t.componentes ? JSON.parse(t.componentes) : null;
    const linhas = t.linhas ? JSON.parse(t.linhas) : null;
    return {
      id: t.id,
      nome: t.nome,
      duracao_min: t.duracao_min,
      preco: t.preco,
      descricao: t.descricao,
      tipo: t.tipo || 'individual',
      categoria: t.categoria,
      componentes,
      componentes_nomes: componentes ? componentes.map(cid => nomePorId[cid]).filter(Boolean) : null,
      linhas,
    };
  });
  res.json({ nomes: ativos.map(t => t.nome), items });
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime(), version: pkg.version });
});

app.get('/api/survey/live', (_req, res) => {
  const row = buscarSurveyTokenAtivo();
  if (!row) return res.json({ ok: false });
  res.json({
    ok: true,
    dados: {
      nome: row.cliente, apto: row.apto, email: row.email, telefone: row.telefone,
      data: row.data, tratamento: row.tratamento, tipo_cliente: row.tipo_cliente,
      massoterapeuta: row.massagista_nome || '',
      liberada_em: row.liberada_em,
    },
  });
});

app.get('/api/survey/:token', (req, res, next) => {
  // Guard: paths reservados do modulo Qualidade nao podem cair aqui (sao
  // tratados pelo qualidadeRouter montado em /api/survey logo abaixo).
  const PATHS_RESERVADOS = new Set(['config', 'published', 'admin']);
  if (PATHS_RESERVADOS.has(req.params.token)) return next();
  const row = buscarSurveyToken(req.params.token);
  if (!row) return res.status(404).json({ ok: false, error: 'Token inválido' });
  res.json({
    ok: true,
    dados: {
      nome: row.cliente,
      apto: row.apto,
      email: row.email,
      telefone: row.telefone,
      data: row.data,
      tratamento: row.tratamento,
      tipo_cliente: row.tipo_cliente,
      massoterapeuta: row.massagista_nome || '',
      liberada_em: row.liberada_em,
    },
  });
});

app.use('/api/spa', spaRouter);
app.use('/api/relatorios', relatoriosRouter);
// Modulo Gestao da Qualidade / Pesquisas configuraveis. Publicas em
// /api/survey/config|published (consumidas pelo front e por outros apps);
// admin em /api/qualidade/admin/* (requireAuth).
app.use('/api/survey', qualidadeRouter);
app.use('/api/qualidade', qualidadeRouter);
app.use('/api/feedback', feedbackRouter);
app.use('/api/auth', authRouter);
app.use('/api/reservas', reservasRouter);
app.use('/api/dev', devRouter);
app.use('/api', cadastrosRouter);

app.get('/sso', (req, res) => {
  const { sso_token, next, theme } = req.query;
  if (!sso_token) return res.redirect('/acesso-hub.html');
  // Repassa ?theme=dark|light do Hub para o destino final, para que o admin.html
  // aplique a mesma preferencia visual (script inline le ?theme= antes do CSS).
  const themeOK = (theme === 'dark' || theme === 'light') ? theme : null;
  try {
    const payload = jwt.verify(sso_token, process.env.SSO_SECRET);
    const email = (payload.email || '').trim().toLowerCase();
    // Fonte de verdade: site_roles['pesquisa-satisfacao'] no JWT do Hub.
    // Valores possiveis: master, admin (read-only), spa, satisfacao.
    // Fallback em cadeia:
    //   1) site_roles  → role granular do Hub
    //   2) sites_admin → 'admin' (cookie de admin sem distincao de papel)
    //   3) allowlist local SPA_ADMIN_EMAILS → 'master' (compat com TI)
    let role;
    const siteRole = payload.site_roles && payload.site_roles['pesquisa-satisfacao'];
    if (siteRole && ['master', 'admin', 'spa', 'satisfacao'].includes(siteRole)) {
      role = siteRole;
    } else if (Array.isArray(payload.sites_admin) && payload.sites_admin.includes('pesquisa-satisfacao')) {
      role = 'admin';
    } else if (SPA_ADMIN_EMAILS.includes(email)) {
      role = 'master';
    } else {
      role = 'user';
    }
    const isAdmin = role !== 'user';
    const token = jwt.sign(
      { sub: 0, username: email, role },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );
    if (isAdmin) setAdminCookie(res, token, 28800);
    else setUserCookie(res, token, 28800);
    const defaultDest = isAdmin ? '/admin' : '/';
    let dest = next && /^\/[a-zA-Z0-9\-_/.~]*$/.test(next) ? next : defaultDest;
    if (themeOK) {
      const sep = dest.includes('?') ? '&' : '?';
      dest = `${dest}${sep}theme=${themeOK}`;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><script>${isAdmin ? `sessionStorage.setItem('granspa_token',${JSON.stringify(token)});` : ''}window.location.replace(${JSON.stringify(dest)});<\/script></head></html>`);
  } catch {
    res.redirect('/acesso-hub.html');
  }
});

app.get('/admin', (req, res) => {
  const cookie = getCookie(req, 'spa_admin_sess');
  if (!cookie) return res.redirect('/acesso-hub.html?next=%2Fadmin');
  try {
    jwt.verify(cookie, process.env.JWT_SECRET);
    res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
  } catch {
    clearAdminCookie(res);
    res.redirect('/acesso-hub.html?next=%2Fadmin');
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({
    ok: false,
    error: process.env.NODE_ENV === 'production' ? 'Erro interno' : err.message,
  });
});

initDb();
// Seed idempotente do questionario SPA (Gestao da Qualidade).
// Re-rodar e' seguro: detecta se 'spa-locc-v1' ja existe e ignora.
try { seedQualidadeSpa(); } catch (err) { console.error('[Qualidade] seed falhou:', err.message); }
try { seedAnamneseSpa(); } catch (err) { console.error('[Anamnese] seed falhou:', err.message); }
app.listen(PORT, () => console.log(`[Gran SPA] Servidor rodando na porta ${PORT}`));
