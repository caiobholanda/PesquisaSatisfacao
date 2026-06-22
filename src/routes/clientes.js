import { Router } from 'express';
import { requireAuth, requireSpa, requireWrite } from '../middleware/auth.js';
import {
  listarClientes, buscarClientePorId, buscarClientePorCpf, buscarClientePorPassaporte,
  inserirCliente, atualizarCliente, buscarCliente360,
  inserirProdutoCliente, atualizarProdutoCliente, removerProdutoCliente,
  validarCpfMod11, getDb,
} from '../db.js';

const router = Router();

// Tudo aqui exige sessão admin (master/spa/admin lê; admin não escreve).
router.use(requireAuth, requireSpa);

// GET /api/clientes?q=...
router.get('/', (req, res) => {
  const q = (req.query.q || '').toString().trim();
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const offset = parseInt(req.query.offset) || 0;
  res.json({ ok: true, ...listarClientes({ q, limit, offset }) });
});

// GET /api/clientes/buscar?cpf=... ou ?passaporte=... (autofill na reserva)
router.get('/buscar', (req, res) => {
  const cpf = (req.query.cpf || '').toString().replace(/\D/g, '');
  const passaporte = (req.query.passaporte || '').toString().trim().toUpperCase();
  if (cpf) {
    if (!validarCpfMod11(cpf)) return res.status(400).json({ ok: false, error: 'CPF invalido' });
    const cli = buscarClientePorCpf(cpf);
    return res.json({ ok: true, cliente: cli || null });
  }
  if (passaporte) {
    if (passaporte.length < 5) return res.status(400).json({ ok: false, error: 'Passaporte invalido' });
    const cli = buscarClientePorPassaporte(passaporte);
    return res.json({ ok: true, cliente: cli || null });
  }
  return res.status(400).json({ ok: false, error: 'cpf ou passaporte obrigatorio' });
});

// GET /api/clientes/:id (cliente 360)
router.get('/:id', (req, res) => {
  const data = buscarCliente360(parseInt(req.params.id));
  if (!data) return res.status(404).json({ ok: false, error: 'Cliente nao encontrado' });
  res.json({ ok: true, ...data });
});

// GET /api/clientes/anamnese/:perfilId
// Retorna o registro completo da anamnese (spa_perfis) — TODOS os campos
// preenchidos para visualizacao admin (info_medica, rotinas, consentimentos,
// assinatura). Usado no modal "Ver anamnese preenchida" no Cliente 360.
router.get('/anamnese/:perfilId', (req, res) => {
  const id = parseInt(req.params.perfilId);
  if (!id) return res.status(400).json({ ok: false, error: 'id invalido' });
  const db = getDb();
  const perfil = db.prepare(`
    SELECT sp.*, r.cliente AS reserva_cliente, r.cliente2 AS reserva_cliente2,
           r.data AS reserva_data, r.hora_inicio AS reserva_hora_inicio,
           r.tratamento AS reserva_tratamento, r.tratamento2 AS reserva_tratamento2
    FROM spa_perfis sp
    LEFT JOIN reservas r ON r.id = sp.reserva_id
    WHERE sp.id = ?
  `).get(id);
  if (!perfil) return res.status(404).json({ ok: false, error: 'Anamnese nao encontrada' });

  // Parseia arrays JSON gravados como TEXT
  const parseArr = v => { if (!v) return []; try { const j = JSON.parse(v); return Array.isArray(j) ? j : []; } catch { return []; } };

  // Busca perguntas extras adicionadas pelo admin (nao sao colunas de spa_perfis)
  const LEGACY_ANAM = new Set([
    'nome','sobrenome','tipo_documento','documento','email','telefone',
    'data_nascimento','quarto','rotina_facial','rotina_corporal',
    'produto_especifico','pressao_massagem','info_medica',
    'consentimento_saude','consentimento_marketing','canais_marketing',
    'assinatura_digital','assinatura',
    // versoes prefixadas gravadas por spa.js via inserirRespostaPesquisa
    'anamnese_nome','anamnese_sobrenome','anamnese_tipo_documento','anamnese_documento',
    'anamnese_email','anamnese_telefone','anamnese_data_nascimento','anamnese_quarto',
    'anamnese_rotina_facial','anamnese_rotina_corporal','anamnese_produto_especifico',
    'anamnese_pressao_massagem','anamnese_info_medica','anamnese_consentimento_saude',
    'anamnese_consentimento_marketing','anamnese_canais_marketing','anamnese_assinatura',
  ]);
  let extras = [];
  if (perfil.reserva_id) {
    try {
      const rp = db.prepare(`
        SELECT rp.id FROM resposta_pesquisa rp
        JOIN pesquisa p ON p.id = rp.pesquisa_id
        WHERE rp.reserva_id=? AND p.slug LIKE 'spa-anamnese%'
        LIMIT 1
      `).get(perfil.reserva_id);
      if (rp?.id) {
        const itens = db.prepare(
          'SELECT pergunta_chave, valor_texto, valor_numerico, escala_opcao_chave FROM resposta_item WHERE resposta_pesquisa_id=?'
        ).all(rp.id);
        for (const it of itens) {
          if (LEGACY_ANAM.has(it.pergunta_chave)) continue;
          const trad = db.prepare(`
            SELECT rotulo FROM pergunta_traducao pt
            JOIN pergunta_satisfacao p ON p.id = pt.pergunta_id
            WHERE p.chave=? AND pt.idioma='pt-BR'
          `).get(it.pergunta_chave);
          it.rotulo = trad?.rotulo || it.pergunta_chave;
          if (it.escala_opcao_chave) {
            const opt = db.prepare(`
              SELECT eot.rotulo FROM escala_opcao eo
              JOIN escala_opcao_traducao eot ON eot.escala_opcao_id = eo.id AND eot.idioma='pt-BR'
              WHERE eo.chave=? ORDER BY eo.escala_id LIMIT 1
            `).get(it.escala_opcao_chave);
            it.escala_opcao_rotulo = opt?.rotulo || it.escala_opcao_chave;
          }
          extras.push(it);
        }
      }
    } catch (e) { console.warn('[anamnese extras]', e?.message); }
  }

  res.json({
    ok: true,
    anamnese: {
      ...perfil,
      rotina_facial: parseArr(perfil.rotina_facial),
      rotina_corporal: parseArr(perfil.rotina_corporal),
      canais_marketing: parseArr(perfil.canais_marketing),
      consentimento_saude: !!perfil.consentimento_saude,
      consentimento_marketing: !!perfil.consentimento_marketing,
    },
    extras,
  });
});

// GET /api/clientes/pesquisa/:respostaId
// Retorna respostas estruturadas de uma resposta_pesquisa (todos os itens
// com pergunta_chave, valor_texto, valor_numerico, escala_opcao_chave).
// Usado no modal "Ver respostas da pesquisa" no Cliente 360.
router.get('/pesquisa/:respostaId', (req, res) => {
  const id = parseInt(req.params.respostaId);
  if (!id) return res.status(400).json({ ok: false, error: 'id invalido' });
  const db = getDb();
  const resposta = db.prepare(`
    SELECT rp.id, rp.pesquisa_id, rp.pesquisa_versao, rp.app_origem,
           rp.reserva_id, rp.feedback_id, rp.submitted_at,
           p.slug AS pesquisa_slug, p.titulo AS pesquisa_titulo
    FROM resposta_pesquisa rp
    LEFT JOIN pesquisa p ON p.id = rp.pesquisa_id
    WHERE rp.id = ?
  `).get(id);
  if (!resposta) return res.status(404).json({ ok: false, error: 'Resposta nao encontrada' });
  const itens = db.prepare(`
    SELECT pergunta_chave, valor_texto, valor_numerico, escala_opcao_chave
    FROM resposta_item WHERE resposta_pesquisa_id = ?
  `).all(id);
  // Enriquece com rotulo pt-BR da pergunta
  for (const it of itens) {
    const trad = db.prepare(`
      SELECT rotulo FROM pergunta_traducao pt
      JOIN pergunta_satisfacao p ON p.id = pt.pergunta_id
      WHERE p.chave = ? AND pt.idioma = 'pt-BR'
    `).get(it.pergunta_chave);
    it.rotulo = trad?.rotulo || it.pergunta_chave;
    if (it.escala_opcao_chave) {
      const opt = db.prepare(`
        SELECT eot.rotulo FROM escala_opcao eo
        JOIN escala_opcao_traducao eot ON eot.escala_opcao_id = eo.id AND eot.idioma = 'pt-BR'
        WHERE eo.chave = ?
        ORDER BY eo.escala_id LIMIT 1
      `).get(it.escala_opcao_chave);
      it.escala_opcao_rotulo = opt?.rotulo || it.escala_opcao_chave;
    }
  }
  res.json({ ok: true, resposta, itens });
});

// POST /api/clientes
router.post('/', requireWrite, (req, res) => {
  try {
    const id = inserirCliente(req.body || {});
    res.json({ ok: true, id });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// PUT /api/clientes/:id
router.put('/:id', requireWrite, (req, res) => {
  try {
    atualizarCliente(parseInt(req.params.id), req.body || {});
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// Produtos
router.post('/:id/produtos', requireWrite, (req, res) => {
  try {
    const pid = inserirProdutoCliente(parseInt(req.params.id), req.body || {});
    res.json({ ok: true, id: pid });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
router.put('/produtos/:pid', requireWrite, (req, res) => {
  try {
    atualizarProdutoCliente(parseInt(req.params.pid), req.body || {});
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
router.delete('/produtos/:pid', requireWrite, (req, res) => {
  removerProdutoCliente(parseInt(req.params.pid));
  res.json({ ok: true });
});

export default router;
