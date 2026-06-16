import { Router } from 'express';
import { buscarDocumentoToken, inserirSpaPerfil, vincularDocumentoToken, getDb, quartoValido, isGranClass, telefoneValido } from '../db.js';
import { inserirRespostaPesquisa, buscarPesquisaPublicada } from '../qualidade.js';

const router = Router();

const LOCALES_VALIDOS = ['pt-BR', 'pt-PT', 'en', 'fr', 'es', 'it', 'de'];

function san(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim().slice(0, 1000);
}

// GET /api/spa/documento?t=TOKEN
router.get('/documento', (req, res) => {
  const token = req.query.t;
  if (!token) return res.status(400).json({ ok: false, error: 'Token ausente' });
  const row = buscarDocumentoToken(token);
  if (!row) return res.status(404).json({ ok: false, error: 'Token inválido ou expirado' });
  res.json({
    hospede_nome:  row.hospede_nome  || '',
    hospede_email: row.hospede_email || '',
    servico:       row.servico       || '',
    locale:        LOCALES_VALIDOS.includes(row.locale) ? row.locale : 'pt-BR',
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

  // Resolve reserva_id via documento_token
  let reserva_id = null;
  if (b.documento_token) {
    const row = buscarDocumentoToken(b.documento_token);
    if (row) {
      reserva_id = row.reserva_id;
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
      assinatura_data_url:    san(b.assinatura_data_url).slice(0, 200000) || null,
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
      inserirRespostaPesquisa({
        pesquisa_slug: 'spa-anamnese-v1',
        app_origem: 'spa-anamnese',
        reserva_id,
        itens,
      });
    } catch (errA) {
      console.error('[Anamnese] gravacao estruturada falhou (legado OK):', errA.message);
    }
    // Grava o quarto em spa_perfis (campo additive, falha silenciosa se a
    // coluna não existir em DBs muito antigos).
    if (quartoLimpo) {
      try { getDb().prepare('UPDATE spa_perfis SET quarto=? WHERE id=?').run(quartoLimpo, id); } catch {}
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
  const idioma = (req.query.idioma || 'pt-BR').toString();
  const pesquisa = buscarPesquisaPublicada('spa-anamnese-v1', idioma);
  if (!pesquisa) return res.json({ ok: false });
  res.json({ ok: true, pesquisa });
});

export default router;
