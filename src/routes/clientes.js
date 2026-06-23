import { Router } from 'express';
import { requireAuth, requireSpa, requireWrite } from '../middleware/auth.js';
import {
  listarClientes, buscarClientePorId, buscarClientePorCpf, buscarClientePorPassaporte,
  inserirCliente, atualizarCliente, buscarCliente360,
  inserirProdutoCliente, atualizarProdutoCliente, removerProdutoCliente,
  validarCpfMod11, getDb, logAuditoria,
} from '../db.js';
import { recalcularHmacConsentimento, recalcularSeloComposto } from './spa.js';

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
//  - valor_texto_rotulo:   se valor_texto for slug scalar de uma opcao (registros
//                          antigos sem escala_opcao_chave), rotulo correspondente
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
  // valor_texto scalar pode ser tanto texto livre quanto slug de opcao
  // (registros antigos antes do escala_opcao_chave: valor_texto). Resolve
  // se houver match em pergunta_opcao para essa pergunta.
  if (it.valor_texto && typeof it.valor_texto === 'string') {
    const s = it.valor_texto.trim();
    if (s.startsWith('[')) {
      try {
        const arr = JSON.parse(s);
        if (Array.isArray(arr) && arr.length && arr.every(x => typeof x === 'string')) {
          it.valor_texto_rotulos = arr.map(slug => _resolverRotuloOpcao(db, it.pergunta_chave, slug, idioma) || slug);
        }
      } catch {}
    } else if (s.length <= 64 && !/\s/.test(s) && /^[a-z0-9_-]+$/i.test(s)) {
      // String curta tipo slug: pode ser opcao antiga gravada sem escala_opcao_chave
      const r = _resolverRotuloOpcao(db, it.pergunta_chave, s, idioma);
      if (r && r !== s) it.valor_texto_rotulo = r;
    }
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
      // Identifica pessoa via coluna 'pessoa' do spa_perfis (preenchida pelo
      // backfill + UPSERT por (reserva_id, pessoa) introduzido no Passo 2).
      const ehPessoa2 = perfil.pessoa === 2;
      const appOrigemFiltro = ehPessoa2 ? 'spa-anamnese-p2' : 'spa-anamnese';
      // Detecta casal com 2 perfis distintos: ambos slots da reserva ocupados
      // e apontando para registros diferentes. Nesse cenario, fallback sem
      // app_origem nao pode ser usado — risco de mostrar extras do parceiro
      // (cross-leak de dado de saude, violacao LGPD).
      const reserva = db.prepare(
        'SELECT documento_perfil_id, documento_perfil_id2 FROM reservas WHERE id=?'
      ).get(perfil.reserva_id);
      const ehCasalCom2Perfis = !!(reserva
        && reserva.documento_perfil_id
        && reserva.documento_perfil_id2
        && reserva.documento_perfil_id !== reserva.documento_perfil_id2);
      // Em casal com 2 perfis: se NAO existe nenhuma rp diferenciada por
      // app_origem='spa-anamnese-p2', as rp legadas (todas com 'spa-anamnese')
      // sao ambiguas — ORDER BY rp.id DESC pode retornar dado do parceiro.
      // Defesa contra cross-leak: nao exibir extras nesse cenario.
      const temRpDiferenciada = ehCasalCom2Perfis ? db.prepare(`
        SELECT 1 FROM resposta_pesquisa rp
        JOIN pesquisa p ON p.id = rp.pesquisa_id
        WHERE rp.reserva_id=? AND p.slug LIKE 'spa-anamnese%' AND rp.app_origem='spa-anamnese-p2'
        LIMIT 1
      `).get(perfil.reserva_id) : true;
      const rp = (!ehCasalCom2Perfis || temRpDiferenciada) ? (db.prepare(`
        SELECT rp.id FROM resposta_pesquisa rp
        JOIN pesquisa p ON p.id = rp.pesquisa_id
        WHERE rp.reserva_id=? AND p.slug LIKE 'spa-anamnese%' AND rp.app_origem=?
        ORDER BY rp.id DESC LIMIT 1
      `).get(perfil.reserva_id, appOrigemFiltro)
      // Fallback: dados antigos antes da diferenciacao por app_origem podem
      // ter app_origem='spa-anamnese' para ambos. So usar quando NAO ha
      // confusao possivel de identidade (reserva individual ou slot unico).
      || (ehCasalCom2Perfis ? null : db.prepare(`
        SELECT rp.id FROM resposta_pesquisa rp
        JOIN pesquisa p ON p.id = rp.pesquisa_id
        WHERE rp.reserva_id=? AND p.slug LIKE 'spa-anamnese%'
        ORDER BY rp.id DESC LIMIT 1
      `).get(perfil.reserva_id))) : null;
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

  // Whitelist (allowlist) de campos visiveis no modal admin. Blacklist
  // (omitir _texto/_hash) era fragil: novas colunas LGPD seriam vazadas
  // por padrao ao serem adicionadas. Com allowlist, prova bruta SO
  // chega via endpoint dedicado /prova-consentimento.
  const anamnese = {
    id: perfil.id,
    nome: perfil.nome,
    sobrenome: perfil.sobrenome,
    tipo_documento: perfil.tipo_documento,
    documento: perfil.documento,
    email: perfil.email,
    telefone: perfil.telefone,
    data_nascimento: perfil.data_nascimento,
    produto_especifico: perfil.produto_especifico,
    pressao_massagem: perfil.pressao_massagem,
    info_medica: perfil.info_medica,
    assinatura_data_url: perfil.assinatura_data_url,
    idioma: perfil.idioma,
    reserva_id: perfil.reserva_id,
    cliente_id: perfil.cliente_id,
    pessoa: perfil.pessoa,
    quarto: perfil.quarto,
    criado_em: perfil.criado_em,
    reserva_cliente: perfil.reserva_cliente,
    reserva_cliente2: perfil.reserva_cliente2,
    reserva_data: perfil.reserva_data,
    reserva_hora_inicio: perfil.reserva_hora_inicio,
    reserva_tratamento: perfil.reserva_tratamento,
    reserva_tratamento2: perfil.reserva_tratamento2,
    rotina_facial: parseArr(perfil.rotina_facial),
    rotina_corporal: parseArr(perfil.rotina_corporal),
    canais_marketing: parseArr(perfil.canais_marketing),
    consentimento_saude: !!perfil.consentimento_saude,
    consentimento_marketing: !!perfil.consentimento_marketing,
    // Apenas metadata de auditoria (sem texto bruto, sem hashes).
    // Hash/texto/canonico ficam no endpoint dedicado /prova-consentimento (master + audit log).
    consentimento_saude_versao: perfil.consentimento_saude_versao || null,
    consentimento_saude_em: perfil.consentimento_saude_em || null,
  };
  res.json({ ok: true, anamnese, extras });
});

// GET /api/clientes/anamnese/:perfilId/prova-consentimento
// Endpoint dedicado de auditoria juridica: devolve o texto exibido ao
// hospede, o HMAC-SHA256 (assinado com segredo server-side), key_id,
// versao, timestamp e cross-check vs canonico. Revalida HMAC(texto)===
// hash para garantir integridade. Gated por role master + logAuditoria
// em TODOS os paths (200/400/403/404) para rastreabilidade plena.
function _logProva(req, status, sucesso, detalhes, recursoId) {
  try {
    logAuditoria({
      ator_username: req.user?.username || null,
      ator_role: req.user?.role || null,
      ator_ip: req.ip || null,
      metodo: 'GET', rota: req.originalUrl,
      acao: 'prova-consentimento', recurso: 'spa_perfis',
      recurso_id: recursoId, status, sucesso, detalhes,
    });
  } catch {}
}
// Valida perfilId em 3 niveis: regex, faixa, MAX_SAFE_INTEGER.
// Retorna {ok:true, id} ou {ok:false, motivo}.
function _validarPerfilId(raw) {
  if (typeof raw !== 'string' || !raw) return { ok: false, motivo: 'vazio' };
  if (!/^\d+$/.test(raw)) return { ok: false, motivo: 'formato invalido' };
  // Limite de 15 digitos: cabe folgadamente em Number.MAX_SAFE_INTEGER
  // (2^53-1 = 9007199254740991 = 16 digitos), mas 15 garante precisao.
  if (raw.length > 15) return { ok: false, motivo: 'id muito grande' };
  const n = parseInt(raw, 10);
  if (!Number.isSafeInteger(n) || n < 1) return { ok: false, motivo: 'fora de faixa' };
  return { ok: true, id: n };
}
function _exigirMasterComLog(req, res, next) {
  if (req.user?.role !== 'master') {
    const v = _validarPerfilId(req.params.perfilId);
    const recursoId = v.ok ? v.id : null;
    _logProva(req, 403, 0, 'role=' + (req.user?.role || 'nenhum'), recursoId);
    return res.status(403).json({ ok: false, error: 'Acesso restrito a administradores master' });
  }
  next();
}
router.get('/anamnese/:perfilId/prova-consentimento', _exigirMasterComLog, (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  const v = _validarPerfilId(req.params.perfilId);
  if (!v.ok) {
    _logProva(req, 400, 0, 'id ' + v.motivo + ': ' + String(req.params.perfilId).slice(0, 32), null);
    return res.status(400).json({ ok: false, error: 'id invalido' });
  }
  const id = v.id;
  const db = getDb();
  const row = db.prepare(`
    SELECT id, reserva_id, idioma, criado_em,
           documento, consentimento_saude, consentimento_saude_texto, consentimento_saude_hash,
           consentimento_saude_versao, consentimento_saude_em,
           consentimento_saude_canonico_divergente, consentimento_saude_canonico_comparado,
           consentimento_saude_hash_canonico, consentimento_saude_key_id,
           consentimento_saude_alg, consentimento_saude_assinatura_hash
    FROM spa_perfis WHERE id=?
  `).get(id);
  if (!row) {
    _logProva(req, 404, 0, 'perfil nao encontrado', id);
    return res.status(404).json({ ok: false, error: 'Anamnese nao encontrada' });
  }
  // Revalida integridade: HMAC(texto, segredo) deve bater com hash gravado.
  //  - integro: texto+hash batem
  //  - adulterado: texto+hash divergem (DB mexido fora do app)
  //  - legado-sem-prova: consentiu mas sem hash (backfill ou versoes
  //    antigas do Passo 6 sem texto-cliente)
  //  - sem-consentimento: nao consentiu
  //  - chave-divergente: hash existe mas foi gerado com key_id diferente
  //    da atual — sem o segredo antigo nao da pra revalidar (rotacao
  //    futura). Por ora apenas avisa.
  // Revalida com o algoritmo GRAVADO na linha (rollback nao quebra prova).
  //   'hmac-sha256-composto-v1' → revalida selo composto (texto + documento +
  //                                reserva_id + assinatura_hash + consentido_em)
  //   'hmac-sha256-v1' / null  → revalida HMAC do texto puro (compat retroativa)
  // Se o servidor nao suporta o alg gravado, marcamos 'algoritmo-desconhecido'
  // em vez de 'adulterado' — falha operacional, nao fraude.
  let integridade;
  const alg = row.consentimento_saude_alg || 'hmac-sha256-v1';
  if (row.consentimento_saude_texto && row.consentimento_saude_hash) {
    let recalc = null;
    if (alg === 'hmac-sha256-composto-v1') {
      recalc = recalcularSeloComposto({
        texto: row.consentimento_saude_texto,
        documento: row.documento || '',
        reserva_id: row.reserva_id || null,
        assinatura_hash: row.consentimento_saude_assinatura_hash || '',
        consentido_em: row.consentimento_saude_em || '',
      }, row.consentimento_saude_key_id);
    } else if (alg === 'hmac-sha256-v1') {
      recalc = recalcularHmacConsentimento(row.consentimento_saude_texto, row.consentimento_saude_key_id);
    } else {
      integridade = 'algoritmo-desconhecido';
    }
    if (integridade === undefined) {
      if (recalc === null) integridade = 'chave-desconhecida';
      else integridade = (recalc === row.consentimento_saude_hash) ? 'integro' : 'adulterado';
    }
  } else if (row.consentimento_saude) {
    integridade = 'legado-sem-prova';
  } else {
    integridade = 'sem-consentimento';
  }
  // Cross-check com 3 estados:
  //   'sem-canonico'       → nao havia canonico no servidor no momento da gravacao
  //   'bate'               → canonico existia e e identico ao texto exibido
  //   'diverge'            → canonico existia e difere do texto exibido (cache/edit mid-sessao)
  let canonico;
  if (row.consentimento_saude_canonico_comparado === 1) {
    canonico = row.consentimento_saude_canonico_divergente ? 'diverge' : 'bate';
  } else {
    canonico = 'sem-canonico';
  }
  _logProva(req, 200, 1, 'integridade=' + integridade + ',canonico=' + canonico + ',alg=' + alg, id);
  res.json({
    ok: true,
    prova: {
      perfil_id: row.id,
      reserva_id: row.reserva_id,
      idioma: row.idioma,
      consentimento_saude: !!row.consentimento_saude,
      documento: row.documento || null,
      texto: row.consentimento_saude_texto || null,
      hash_hmac_sha256: row.consentimento_saude_hash || null,
      hash_canonico_hmac_sha256: row.consentimento_saude_hash_canonico || null,
      assinatura_hash_sha256: row.consentimento_saude_assinatura_hash || null,
      key_id: row.consentimento_saude_key_id || null,
      alg,
      versao: row.consentimento_saude_versao || null,
      consentido_em: row.consentimento_saude_em || null,
      canonico,
      criado_em: row.criado_em,
      integridade,
    },
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
