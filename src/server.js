import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { initDb, listarMassagistas, listarTiposMassagem } from './db.js';
import feedbackRouter from './routes/feedback.js';
import authRouter from './routes/auth.js';
import cadastrosRouter from './routes/cadastros.js';
import reservasRouter from './routes/reservas.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '100kb' }));

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

app.use('/api/feedback', feedbackRouter);
app.use('/api/auth', authRouter);
app.use('/api/reservas', reservasRouter);
app.use('/api', cadastrosRouter);

// Fallback SPA: admin.html para /admin
app.get('/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({
    ok: false,
    error: process.env.NODE_ENV === 'production' ? 'Erro interno' : err.message,
  });
});

initDb();
app.listen(PORT, () => console.log(`[Gran SPA] Servidor rodando na porta ${PORT}`));
