import { Router } from 'express';
import { buscarDocumentoToken, inserirSpaPerfil, vincularDocumentoToken, getDb, quartoValido, isGranClass, telefoneValido } from '../db.js';
import { inserirRespostaPesquisa, buscarPesquisaPublicada } from '../qualidade.js';

const router = Router();

const LOCALES_VALIDOS = ['pt-BR', 'pt-PT', 'en', 'fr', 'es', 'it', 'de'];

function san(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim().slice(0, 1000);
}
// Sanitizador especifico para data URLs de imagem (assinatura).
// NAO aplica o limite de 1000 chars de san() — uma assinatura PNG em base64
// tem facilmente 10-100 KB. Valida que o valor comeca com data:image e
// aceita ate 500 KB (bem acima de qualquer assinatura real).
function sanDataUrl(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s.startsWith('data:image')) return null;
  const b64 = s.split(',')[1] || '';
  if (b64.length % 4 !== 0) {
    console.warn('[spa/perfil] assinatura_data_url base64 com padding invalido (len=' + b64.length + ')');
  }
  if (b64.length < 200) {
    console.warn('[spa/perfil] assinatura_data_url suspeita: base64 muito curta (' + b64.length + ' chars) — possivel canvas em branco');
  }
  return s.slice(0, 500_000);
}

// GET /api/spa/documento?t=TOKEN
router.get('/documento', (req, res) => {
  const token = req.query.t;
  if (!token) return res.status(400).json({ ok: false, error: 'Token ausente' });
  const row = buscarDocumentoToken(token);
  if (!row) return res.status(404).json({ ok: false, error: 'Token inválido ou expirado' });
  res.json({
    hospede_nome:     row.hospede_nome     || '',
    hospede_email:    row.hospede_email    || '',
    hospede_telefone: row.hospede_telefone || '',
    hospede_cpf:      row.hospede_cpf      || '',
    hospede_quarto:   row.hospede_quarto   || '',
    hospede_data_nascimento: row.hospede_data_nascimento || '',
    servico:          row.servico          || '',
    locale:           LOCALES_VALIDOS.includes(row.locale) ? row.locale : 'pt-BR',
  });
});

// GET /api/spa/historico?t=TOKEN  (busca pelo email da reserva)
// GET /api/spa/historico?documento=XXX&tipo_documento=cpf  (busca direta pelo doc)
// GET /api/spa/historico?email=XXX  (busca pelo email)
// Busca o ULTIMO perfil ja preenchido. Retorna campos seguros pra
// pre-preencher o form — exceto assinatura (sempre nova) e info_medica
// (deve ser reconfirmada a cada visita).
router.get('/historico', (req, res) => {
  const db = getDb();
  let ult = null;

  const token = req.query.t;
  const docNum = (req.query.documento || '').toString().trim();
  const docTipo = (req.query.tipo_documento || '').toString().trim() || null;
  const emailQry = (req.query.email || '').toString().trim().toLowerCase();

  // 1) Busca por documento (caminho principal: quando cliente digita CPF/passaporte)
  if (docNum) {
    // Normaliza CPF: remove pontuacao pra fazer match insensitive de mascara
    const docLimpo = docNum.replace(/\D/g, '');
    if (docTipo === 'cpf' && docLimpo.length === 11) {
      ult = db.prepare(`
        SELECT * FROM spa_perfis
        WHERE REPLACE(REPLACE(REPLACE(documento, '.', ''), '-', ''), ' ', '') = ?
          AND tipo_documento = 'cpf'
        ORDER BY criado_em DESC LIMIT 1
      `).get(docLimpo);
    } else {
      // Passaporte/RG: comparacao trim case-insensitive
      ult = db.prepare(`
        SELECT * FROM spa_perfis
        WHERE LOWER(TRIM(documento)) = LOWER(?) AND tipo_documento = COALESCE(?, tipo_documento)
        ORDER BY criado_em DESC LIMIT 1
      `).get(docNum, docTipo);
    }
  }

  // 2) Busca por email (parametro direto ou via token)
  if (!ult) {
    let email = emailQry;
    if (!email && token) {
      const row = buscarDocumentoToken(token);
      if (row) email = (row.hospede_email || '').trim().toLowerCase();
    }
    if (email) {
      ult = db.prepare(`
        SELECT * FROM spa_perfis
        WHERE LOWER(TRIM(email)) = ?
        ORDER BY criado_em DESC LIMIT 1
      `).get(email);
    }
  }

  if (!ult) return res.json({ ok: false });

  // Helper pra parsear arrays JSON gravados como TEXT.
  const parseArr = v => {
    if (!v) return [];
    try { const j = JSON.parse(v); return Array.isArray(j) ? j : []; } catch { return []; }
  };

  res.json({
    ok: true,
    perfil: {
      nome:                ult.nome || '',
      sobrenome:           ult.sobrenome || '',
      tipo_documento:      ult.tipo_documento || 'cpf',
      documento:           ult.documento || '',
      email:               ult.email || '',
      telefone:            ult.telefone || '',
      data_nascimento:     ult.data_nascimento || '',
      rotina_facial:       parseArr(ult.rotina_facial),
      rotina_corporal:     parseArr(ult.rotina_corporal),
      produto_especifico:  ult.produto_especifico || '',
      pressao_massagem:    ult.pressao_massagem || '',
      // info_medica NAO retornada por seguranca: cliente precisa
      // reconfirmar a cada visita (pode ter mudado).
      consentimento_marketing: !!ult.consentimento_marketing,
      canais_marketing:    parseArr(ult.canais_marketing),
      idioma:              ult.idioma || 'pt-BR',
      quarto:              ult.quarto || '',
      criado_em:           ult.criado_em,
    },
  });
});

// POST /api/spa/perfil
router.post('/perfil', (req, res) => {
  const b = req.body || {};
  const nome = san(b.nome);
  const sobrenome = san(b.sobrenome);
  if (!nome || !sobrenome) return res.status(400).json({ ok: false, error: 'Nome obrigatório' });

  const locale = LOCALES_VALIDOS.includes(b.idioma) ? b.idioma : 'pt-BR';

  // Telefone: aceita BR e internacional; só rejeita lixo claro.
  if (b.telefone && !telefoneValido(b.telefone)) {
    return res.status(400).json({ ok: false, error: 'Telefone inválido' });
  }

  // Quarto: opcional, mas se vier precisa existir na lista oficial.
  const quartoLimpo = b.quarto ? String(b.quarto).trim().replace(/\D/g, '').padStart(4,'0').slice(-4) : '';
  if (quartoLimpo && !quartoValido(quartoLimpo)) {
    return res.status(400).json({ ok: false, error: 'Quarto inexistente' });
  }

  // Resolve reserva_id via documento_token. Token identifica unica e
  // exclusivamente uma (reserva, pessoa) — pessoa 1 (cliente principal)
  // ou pessoa 2 (cliente2 em reservas casal). Cada hospede preenche
  // sua propria anamnese sem sobrescrever a do outro.
  let reserva_id = null;
  let _pessoaReserva = 1;
  if (b.documento_token) {
    const row = buscarDocumentoToken(b.documento_token);
    if (row) {
      reserva_id = row.reserva_id;
      _pessoaReserva = row.pessoa === 2 ? 2 : 1;
      if (locale) vincularDocumentoToken(reserva_id, locale);
    }
  }

  try {
    const id = inserirSpaPerfil({
      nome, sobrenome,
      tipo_documento:         san(b.tipo_documento) || 'cpf',
      documento:              san(b.documento),
      email:                  san(b.email),
      telefone:               san(b.telefone),
      data_nascimento:        san(b.data_nascimento) || null,
      rotina_facial:          b.rotina_facial ? JSON.stringify(b.rotina_facial) : null,
      rotina_corporal:        b.rotina_corporal ? JSON.stringify(b.rotina_corporal) : null,
      produto_especifico:     san(b.produto_especifico) || null,
      pressao_massagem:       san(b.pressao_massagem) || null,
      info_medica:            san(b.info_medica),
      consentimento_saude:    !!b.consentimento_saude,
      consentimento_marketing:!!b.consentimento_marketing,
      canais_marketing:       b.canais_marketing ? JSON.stringify(b.canais_marketing) : null,
      assinatura_data_url:    sanDataUrl(b.assinatura_data_url),
      idioma:                 locale,
      reserva_id,
    });
    // Gravacao paralela ESTRUTURADA (Anamnese configuravel). Falha aqui NAO
    // derruba a submissao publica — spa_perfis ja foi gravado e o cliente
    // nunca pode ficar com o formulario quebrado.
    try {
      const itens = [
        { chave: 'anamnese_nome',                   valor_texto: nome },
        { chave: 'anamnese_sobrenome',              valor_texto: sobrenome },
        { chave: 'anamnese_tipo_documento',         valor_texto: san(b.tipo_documento) || 'cpf', escala_opcao_chave: san(b.tipo_documento) || 'cpf' },
        { chave: 'anamnese_documento',              valor_texto: san(b.documento) },
        { chave: 'anamnese_email',                  valor_texto: san(b.email) },
        { chave: 'anamnese_telefone',               valor_texto: san(b.telefone) },
        { chave: 'anamnese_data_nascimento',        valor_texto: san(b.data_nascimento) },
        { chave: 'anamnese_rotina_facial',          valor_texto: b.rotina_facial   ? JSON.stringify(b.rotina_facial)   : null },
        { chave: 'anamnese_rotina_corporal',        valor_texto: b.rotina_corporal ? JSON.stringify(b.rotina_corporal) : null },
        { chave: 'anamnese_produto_especifico',     valor_texto: san(b.produto_especifico) },
        { chave: 'anamnese_pressao_massagem',       valor_texto: san(b.pressao_massagem), escala_opcao_chave: san(b.pressao_massagem) },
        { chave: 'anamnese_info_medica',            valor_texto: san(b.info_medica) },
        { chave: 'anamnese_consentimento_saude',    escala_opcao_chave: b.consentimento_saude    ? 'sim' : 'nao', valor_numerico: b.consentimento_saude    ? 1 : 0 },
        { chave: 'anamnese_consentimento_marketing',escala_opcao_chave: b.consentimento_marketing ? 'sim' : 'nao', valor_numerico: b.consentimento_marketing ? 1 : 0 },
        { chave: 'anamnese_canais_marketing',       valor_texto: b.canais_marketing ? JSON.stringify(b.canais_marketing) : null },
        { chave: 'anamnese_assinatura',             valor_texto: b.assinatura_data_url ? '[assinatura presente]' : null },
      ];
      // Perguntas customizadas criadas pelo admin no editor (sem
      // mapeia_campo_legado) chegam como { chave: valor }.
      if (b.respostas_extras && typeof b.respostas_extras === 'object') {
        for (const [chave, valor] of Object.entries(b.respostas_extras)) {
          if (Array.isArray(valor)) {
            itens.push({ chave, valor_texto: JSON.stringify(valor) });
          } else if (typeof valor === 'object' && valor !== null) {
            itens.push({ chave, valor_texto: JSON.stringify(valor) });
          } else {
            const s = String(valor);
            itens.push({ chave, valor_texto: s, escala_opcao_chave: s });
          }
        }
      }
      inserirRespostaPesquisa({
        pesquisa_slug: 'spa-anamnese-v1',
        app_origem: 'spa-anamnese',
        reserva_id,
        itens,
        ignorar_ativo: true,
      });
    } catch (errA) {
      console.error('[Anamnese] gravacao estruturada falhou (legado OK):', errA.message);
    }
    // Grava o quarto em spa_perfis (campo additive, falha silenciosa se a
    // coluna não existir em DBs muito antigos).
    if (quartoLimpo) {
      try { getDb().prepare('UPDATE spa_perfis SET quarto=? WHERE id=?').run(quartoLimpo, id); } catch {}
    }
    // Amarra o spa_perfil ao slot certo da reserva (hospede 1 ou 2).
    if (reserva_id) {
      const col = _pessoaReserva === 2 ? 'documento_perfil_id2' : 'documento_perfil_id';
      try { getDb().prepare(`UPDATE reservas SET ${col}=? WHERE id=?`).run(id, reserva_id); } catch {}
    }
    res.json({
      ok: true, id,
      quarto: quartoLimpo || null,
      gran_class: quartoLimpo ? isGranClass(quartoLimpo) : false,
    });
  } catch (err) {
    console.error('spa/perfil error:', err);
    res.status(500).json({ ok: false, error: 'Erro ao salvar' });
  }
});

// GET /api/spa/anamnese/config — questionario configuravel (para uso futuro
// do frontend Vite renderizar dinamico). Mantem fallback se nao publicado.
router.get('/anamnese/config', (req, res) => {
  // CACHE FIX: edicoes do admin (reordenar, adicionar pergunta, criar secao)
  // precisam refletir imediatamente para o hospede que abrir o link.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  delete req.headers['if-none-match'];
  delete req.headers['if-modified-since'];
  res.removeHeader('ETag');
  const idioma = (req.query.idioma || 'pt-BR').toString();
  const pesquisa = buscarPesquisaPublicada('spa-anamnese-v1', idioma);
  if (!pesquisa) return res.json({ ok: false });
  res.json({ ok: true, pesquisa });
});

export default router;
