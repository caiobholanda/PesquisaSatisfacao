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

// Resolve o rotulo humanizado de uma opcao (slug -> "Sim"/"Ombros"/etc).
// Tenta escala_opcao primeiro (escalas globais como sim_nao, 4pt_qualitativa),
// cai para pergunta_opcao (opcoes locais criadas pelo admin no editor).
// Retorna null se nada for encontrado — caller decide o fallback.
function _resolverRotuloOpcao(db, perguntaChave, opcaoChave, idioma = 'pt-BR') {
  if (!opcaoChave) return null;
  // 1) Escala global
  const esc = db.prepare(`
    SELECT eot.rotulo FROM escala_opcao eo
    JOIN escala_opcao_traducao eot ON eot.escala_opcao_id = eo.id AND eot.idioma=?
    WHERE eo.chave=? ORDER BY eo.escala_id LIMIT 1
  `).get(idioma, opcaoChave);
  if (esc?.rotulo) return esc.rotulo;
  // 2) Opcao local da pergunta (criada via editor)
  if (perguntaChave) {
    const loc = db.prepare(`
      SELECT pot.rotulo FROM pergunta_opcao po
      JOIN pergunta_satisfacao p ON p.id = po.pergunta_id
      LEFT JOIN pergunta_opcao_traducao pot ON pot.pergunta_opcao_id = po.id AND pot.idioma=?
      WHERE p.chave=? AND po.chave=? LIMIT 1
    `).get(idioma, perguntaChave, opcaoChave);
    if (loc?.rotulo) return loc.rotulo;
    // Fallback pt-BR se idioma alvo nao tem traducao
    if (idioma !== 'pt-BR') {
      const locPt = db.prepare(`
        SELECT pot.rotulo FROM pergunta_opcao po
        JOIN pergunta_satisfacao p ON p.id = po.pergunta_id
        LEFT JOIN pergunta_opcao_traducao pot ON pot.pergunta_opcao_id = po.id AND pot.idioma='pt-BR'
        WHERE p.chave=? AND po.chave=? LIMIT 1
      `).get(perguntaChave, opcaoChave);
      if (locPt?.rotulo) return locPt.rotulo;
    }
  }
  return null;
}

// Enriquece um item de resposta_item com:
//  - rotulo:               rotulo da pergunta (pt-BR)
//  - escala_opcao_rotulo:  rotulo da opcao escolhida (Sim/Não/Ombros/...)
//  - valor_texto_rotulos:  se valor_texto for JSON array de slugs (multipla),
//                          array de rotulos correspondentes
function _enriquecerItemResposta(db, it, idioma = 'pt-BR') {
  // rotulo da pergunta
  const trad = db.prepare(`
    SELECT rotulo FROM pergunta_traducao pt
    JOIN pergunta_satisfacao p ON p.id = pt.pergunta_id
    WHERE p.chave=? AND pt.idioma=?
  `).get(it.pergunta_chave, idioma);
  it.rotulo = trad?.rotulo || it.pergunta_chave;
  // single-choice: rotulo da opcao
  if (it.escala_opcao_chave) {
    const r = _resolverRotuloOpcao(db, it.pergunta_chave, it.escala_opcao_chave, idioma);
    it.escala_opcao_rotulo = r || it.escala_opcao_chave;
  }
  // multipla: valor_texto eh JSON array de slugs -> array de rotulos
  if (it.valor_texto && typeof it.valor_texto === 'string' && it.valor_texto.startsWith('[')) {
    try {
      const arr = JSON.parse(it.valor_texto);
      if (Array.isArray(arr) && arr.length && arr.every(x => typeof x === 'string')) {
        it.valor_texto_rotulos = arr.map(slug => _resolverRotuloOpcao(db, it.pergunta_chave, slug, idioma) || slug);
      }
    } catch {}
  }
  return it;
}

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
  // CACHE FIX: anamneses, reservas e pesquisas mudam frequentemente.
  // Sem isso, browsers cacheam e admin precisa F5 pra ver dados novos.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const data = buscarCliente360(parseInt(req.params.id));
  if (!data) return res.status(404).json({ ok: false, error: 'Cliente nao encontrado' });
  res.json({ ok: true, ...data });
});

// GET /api/clientes/anamnese/:perfilId
// Retorna o registro completo da anamnese (spa_perfis) — TODOS os campos
// preenchidos para visualizacao admin (info_medica, rotinas, consentimentos,
// assinatura). Usado no modal "Ver anamnese preenchida" no Cliente 360.
router.get('/anamnese/:perfilId', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
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
        ORDER BY rp.id DESC LIMIT 1
      `).get(perfil.reserva_id);
      if (rp?.id) {
        const itens = db.prepare(
          'SELECT pergunta_chave, valor_texto, valor_numerico, escala_opcao_chave FROM resposta_item WHERE resposta_pesquisa_id=?'
        ).all(rp.id);
        for (const it of itens) {
          if (LEGACY_ANAM.has(it.pergunta_chave)) continue;
          _enriquecerItemResposta(db, it, 'pt-BR');
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
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
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
  // Enriquece com rotulo pt-BR da pergunta + rotulos das opcoes (incluindo
  // arrays de multipla escolha em valor_texto).
  for (const it of itens) _enriquecerItemResposta(db, it, 'pt-BR');
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
