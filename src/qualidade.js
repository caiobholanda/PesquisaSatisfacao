'use strict';

// Modulo "Gestao da Qualidade / Pesquisas" — fonte de verdade para
// questionarios configuraveis no SPA e em outros apps do ecossistema.
// Tudo additive-only: nao toca em feedback/reservas/etc.

import { getDb } from './db.js';

// ── Seed idempotente: re-rodar e' seguro ───────────────────────────────────
// Flag system_meta 'pesquisas_seeded' impede re-seed após reset manual.
function _seedJaConcluido(db) {
  try {
    const f = db.prepare("SELECT valor FROM system_meta WHERE chave='pesquisas_seeded'").get();
    return !!f;
  } catch { return false; }
}
function _marcarSeedConcluido(db) {
  try {
    db.prepare("INSERT OR REPLACE INTO system_meta (chave, valor) VALUES ('pesquisas_seeded','1')").run();
  } catch {}
}

export function seedQualidadeSpa() {
  const db = getDb();
  if (_seedJaConcluido(db)) return false;
  const existe = db.prepare("SELECT 1 FROM pesquisa WHERE slug='spa-locc-v1'").get();
  if (existe) return false;

  // 1) Escala qualitativa 4 niveis
  db.prepare("INSERT OR IGNORE INTO escala (chave, tipo) VALUES (?, ?)").run('4pt_qualitativa', '4pt_qualitativa');
  const escalaId = db.prepare("SELECT id FROM escala WHERE chave='4pt_qualitativa'").get().id;

  const opcoes4pt = [
    { chave: 'otimo',   valor: 9, pol: 'good', ordem: 1, ptBR: 'Otimo',   en: 'Excellent' },
    { chave: 'bom',     valor: 6, pol: 'good', ordem: 2, ptBR: 'Bom',     en: 'Good' },
    { chave: 'regular', valor: 3, pol: 'poor', ordem: 3, ptBR: 'Regular', en: 'Fair' },
    { chave: 'ruim',    valor: 0, pol: 'poor', ordem: 4, ptBR: 'Ruim',    en: 'Poor' },
  ];
  const insOp = db.prepare("INSERT OR IGNORE INTO escala_opcao (escala_id, chave, valor_numerico, polaridade, ordem) VALUES (?,?,?,?,?)");
  const insOpTr = db.prepare("INSERT OR IGNORE INTO escala_opcao_traducao (escala_opcao_id, idioma, rotulo) VALUES (?,?,?)");
  for (const o of opcoes4pt) {
    insOp.run(escalaId, o.chave, o.valor, o.pol, o.ordem);
    const opId = db.prepare("SELECT id FROM escala_opcao WHERE escala_id=? AND chave=?").get(escalaId, o.chave).id;
    insOpTr.run(opId, 'pt-BR', o.ptBR);
    insOpTr.run(opId, 'en', o.en);
  }

  // 2) Escala sim/nao
  db.prepare("INSERT OR IGNORE INTO escala (chave, tipo) VALUES (?, ?)").run('sim_nao', 'sim_nao');
  const escalaSN = db.prepare("SELECT id FROM escala WHERE chave='sim_nao'").get().id;
  const opcoesSN = [
    { chave: 'sim', valor: 1, pol: 'good', ordem: 1, ptBR: 'Sim', en: 'Yes' },
    { chave: 'nao', valor: 0, pol: 'poor', ordem: 2, ptBR: 'Nao', en: 'No' },
  ];
  for (const o of opcoesSN) {
    insOp.run(escalaSN, o.chave, o.valor, o.pol, o.ordem);
    const opId = db.prepare("SELECT id FROM escala_opcao WHERE escala_id=? AND chave=?").get(escalaSN, o.chave).id;
    insOpTr.run(opId, 'pt-BR', o.ptBR);
    insOpTr.run(opId, 'en', o.en);
  }

  // 3) Biblioteca: 7 perguntas qualitativas + 1 recomenda + textos
  const perguntas = [
    { chave: 'servicos_expectativa', tipo: 'escala', escala: escalaId, legado: 'servicos_expectativa', ptBR: 'A expectativa do tratamento', en: 'Your expectations.' },
    { chave: 'servicos_explicacao',  tipo: 'escala', escala: escalaId, legado: 'servicos_explicacao',  ptBR: 'A explicacao da massoterapeuta sobre beneficios e procedimentos', en: 'The massage therapist explanation about benefits and procedures.' },
    { chave: 'servicos_atitude',     tipo: 'escala', escala: escalaId, legado: 'servicos_atitude',     ptBR: 'A atitude e a qualidade dos servicos da massoterapeuta', en: 'The attitude and the quality of services from the massage therapist.' },
    { chave: 'servicos_tecnica',     tipo: 'escala', escala: escalaId, legado: 'servicos_tecnica',     ptBR: 'A tecnica e a habilidade da massoterapeuta', en: 'The technique and skill of the massage therapist.' },
    { chave: 'instalacoes_conforto',     tipo: 'escala', escala: escalaId, legado: 'instalacoes_conforto',     ptBR: 'Conforto e conservacao da estrutura', en: 'Comfort and upkeep of the facilities.' },
    { chave: 'instalacoes_organizacao',  tipo: 'escala', escala: escalaId, legado: 'instalacoes_organizacao',  ptBR: 'Organizacao da sala, equipamentos e atmosfera', en: 'Organization of the room, equipment and atmosphere.' },
    { chave: 'instalacoes_conveniencia', tipo: 'escala', escala: escalaId, legado: 'instalacoes_conveniencia', ptBR: 'Itens de conveniencia (roupoes, toalhas, etc.)', en: 'Convenience items (robes, towels, etc.).' },
    { chave: 'recomenda',          tipo: 'escala',      escala: escalaSN, legado: 'recomenda',         ptBR: 'Voce recomendaria nossos servicos?', en: 'Would you recommend our services?' },
    { chave: 'recomenda_qual',     tipo: 'texto_livre', escala: null,    legado: 'recomenda_qual',     ptBR: 'A quem voce recomendaria?', en: 'Whom would you recommend it to?' },
    { chave: 'recomenda_porque',   tipo: 'texto_livre', escala: null,    legado: 'recomenda_porque',   ptBR: 'Por que recomendaria?', en: 'Why would you recommend it?' },
    { chave: 'servicos_comentario',    tipo: 'texto_livre', escala: null, legado: 'servicos_comentario',    ptBR: 'Comentario sobre os servicos', en: 'Comment about the services' },
    { chave: 'instalacoes_comentario', tipo: 'texto_livre', escala: null, legado: 'instalacoes_comentario', ptBR: 'Comentario sobre as instalacoes', en: 'Comment about the facilities' },
  ];
  const insP = db.prepare("INSERT OR IGNORE INTO pergunta_satisfacao (chave, tipo, escala_id, mapeia_campo_legado, ativo) VALUES (?,?,?,?,1)");
  const insPTr = db.prepare("INSERT OR IGNORE INTO pergunta_traducao (pergunta_id, idioma, rotulo) VALUES (?,?,?)");
  for (const p of perguntas) {
    insP.run(p.chave, p.tipo, p.escala, p.legado);
    const pId = db.prepare("SELECT id FROM pergunta_satisfacao WHERE chave=?").get(p.chave).id;
    insPTr.run(pId, 'pt-BR', p.ptBR);
    insPTr.run(pId, 'en', p.en);
  }

  // 4) Pesquisa principal (versao 1, publicada)
  db.prepare("INSERT INTO pesquisa (slug, titulo, descricao, ativo, versao, app_escopo, publicada_em) VALUES (?,?,?,1,1,'spa',datetime('now'))")
    .run('spa-locc-v1', 'Pesquisa de Satisfacao Gran SPA', 'Avaliacao dos servicos e instalacoes do Gran SPA');
  const pesquisaId = db.prepare("SELECT id FROM pesquisa WHERE slug='spa-locc-v1' AND versao=1").get().id;
  db.prepare("INSERT OR IGNORE INTO pesquisa_traducao (pesquisa_id, idioma, titulo, descricao) VALUES (?,?,?,?)")
    .run(pesquisaId, 'pt-BR', 'Pesquisa de Satisfacao Gran SPA', 'Avaliacao dos servicos e instalacoes');
  db.prepare("INSERT OR IGNORE INTO pesquisa_traducao (pesquisa_id, idioma, titulo, descricao) VALUES (?,?,?,?)")
    .run(pesquisaId, 'en', 'Satisfaction Survey Gran SPA', 'Rate our services and facilities');

  // 5) Secoes
  const secoes = [
    { chave: 'servicos',    ordem: 1, ptBR: 'Servicos',    en: 'Services' },
    { chave: 'instalacoes', ordem: 2, ptBR: 'Instalacoes', en: 'Facilities' },
    { chave: 'recomenda',   ordem: 3, ptBR: 'Recomendacao', en: 'Recommendation' },
  ];
  const insS = db.prepare("INSERT OR IGNORE INTO pesquisa_secao (pesquisa_id, chave, ordem, ativo) VALUES (?,?,?,1)");
  const insSTr = db.prepare("INSERT OR IGNORE INTO pesquisa_secao_traducao (pesquisa_secao_id, idioma, titulo) VALUES (?,?,?)");
  const secaoIds = {};
  for (const s of secoes) {
    insS.run(pesquisaId, s.chave, s.ordem);
    const sid = db.prepare("SELECT id FROM pesquisa_secao WHERE pesquisa_id=? AND chave=?").get(pesquisaId, s.chave).id;
    secaoIds[s.chave] = sid;
    insSTr.run(sid, 'pt-BR', s.ptBR);
    insSTr.run(sid, 'en', s.en);
  }

  // 6) Associacoes
  const associacoes = [
    { chave: 'servicos_expectativa',     secao: 'servicos',    ordem: 1, obrigatoria: 1 },
    { chave: 'servicos_explicacao',      secao: 'servicos',    ordem: 2, obrigatoria: 1 },
    { chave: 'servicos_atitude',         secao: 'servicos',    ordem: 3, obrigatoria: 1 },
    { chave: 'servicos_tecnica',         secao: 'servicos',    ordem: 4, obrigatoria: 1 },
    { chave: 'servicos_comentario',      secao: 'servicos',    ordem: 5, obrigatoria: 0 },
    { chave: 'instalacoes_conforto',     secao: 'instalacoes', ordem: 1, obrigatoria: 1 },
    { chave: 'instalacoes_organizacao',  secao: 'instalacoes', ordem: 2, obrigatoria: 1 },
    { chave: 'instalacoes_conveniencia', secao: 'instalacoes', ordem: 3, obrigatoria: 1 },
    { chave: 'instalacoes_comentario',   secao: 'instalacoes', ordem: 4, obrigatoria: 0 },
    { chave: 'recomenda',                secao: 'recomenda',   ordem: 1, obrigatoria: 1 },
    { chave: 'recomenda_qual',           secao: 'recomenda',   ordem: 2, obrigatoria: 0 },
    { chave: 'recomenda_porque',         secao: 'recomenda',   ordem: 3, obrigatoria: 0 },
  ];
  const insPP = db.prepare("INSERT OR IGNORE INTO pesquisa_pergunta (pesquisa_id, pergunta_id, secao_id, ordem, ativo, obrigatoria) VALUES (?,?,?,?,1,?)");
  for (const a of associacoes) {
    const pid = db.prepare("SELECT id FROM pergunta_satisfacao WHERE chave=?").get(a.chave)?.id;
    if (!pid) continue;
    insPP.run(pesquisaId, pid, secaoIds[a.secao], a.ordem, a.obrigatoria);
  }

  // 7) Metas exemplo
  const perguntasComMeta = ['servicos_expectativa', 'servicos_explicacao', 'servicos_atitude', 'servicos_tecnica',
                             'instalacoes_conforto', 'instalacoes_organizacao', 'instalacoes_conveniencia'];
  const insMP = db.prepare("INSERT INTO meta_pergunta (pesquisa_id, pergunta_id, tipo_meta, valor_alvo) VALUES (?,?,?,?)");
  for (const ch of perguntasComMeta) {
    const pid = db.prepare("SELECT id FROM pergunta_satisfacao WHERE chave=?").get(ch).id;
    insMP.run(pesquisaId, pid, 'media', 8.0);
  }
  db.prepare("INSERT INTO meta_questionario (pesquisa_id, tipo_meta, valor_alvo) VALUES (?, 'pct_recomenda', 90)").run(pesquisaId);

  _marcarSeedConcluido(db);
  return true;
}

// Seed idempotente da Anamnese pre-tratamento do SPA. Cadastra as 16
// perguntas hardcoded de POST /api/spa/perfil como pesquisa configuravel
// com app_escopo='spa-anamnese'. Permite ao admin gerenciar perguntas/
// ordem/ativacao via UI sem mexer no formulario que o cliente abre.
export function seedAnamneseSpa() {
  const db = getDb();
  if (_seedJaConcluido(db)) return false;
  const existe = db.prepare("SELECT 1 FROM pesquisa WHERE slug='spa-anamnese-v1'").get();
  if (existe) return false;

  // Reaproveita escala sim_nao do seed principal
  let escalaSN = db.prepare("SELECT id FROM escala WHERE chave='sim_nao'").get();
  if (!escalaSN) {
    db.prepare("INSERT OR IGNORE INTO escala (chave, tipo) VALUES (?, ?)").run('sim_nao', 'sim_nao');
    escalaSN = db.prepare("SELECT id FROM escala WHERE chave='sim_nao'").get();
  }

  // 16 perguntas mapeando 1:1 cada campo do POST /api/spa/perfil
  const perguntas = [
    { chave: 'anamnese_nome',                   tipo: 'texto_livre', legado: 'nome',                   ptBR: 'Nome', en: 'First name' },
    { chave: 'anamnese_sobrenome',              tipo: 'texto_livre', legado: 'sobrenome',              ptBR: 'Sobrenome', en: 'Last name' },
    { chave: 'anamnese_tipo_documento',         tipo: 'unica',       legado: 'tipo_documento',         ptBR: 'Tipo de documento', en: 'Document type' },
    { chave: 'anamnese_documento',              tipo: 'texto_livre', legado: 'documento',              ptBR: 'Numero do documento', en: 'Document number' },
    { chave: 'anamnese_email',                  tipo: 'texto_livre', legado: 'email',                  ptBR: 'E-mail', en: 'E-mail' },
    { chave: 'anamnese_telefone',               tipo: 'texto_livre', legado: 'telefone',               ptBR: 'Telefone', en: 'Phone' },
    { chave: 'anamnese_data_nascimento',        tipo: 'texto_livre', legado: 'data_nascimento',        ptBR: 'Data de nascimento', en: 'Date of birth' },
    { chave: 'anamnese_rotina_facial',          tipo: 'multipla',    legado: 'rotina_facial',          ptBR: 'Rotina facial', en: 'Facial routine' },
    { chave: 'anamnese_rotina_corporal',        tipo: 'multipla',    legado: 'rotina_corporal',        ptBR: 'Rotina corporal', en: 'Body routine' },
    { chave: 'anamnese_produto_especifico',     tipo: 'texto_livre', legado: 'produto_especifico',     ptBR: 'Produto especifico que utiliza', en: 'Specific product used' },
    { chave: 'anamnese_pressao_massagem',       tipo: 'unica',       legado: 'pressao_massagem',       ptBR: 'Pressao preferida na massagem', en: 'Preferred massage pressure' },
    { chave: 'anamnese_info_medica',            tipo: 'texto_livre', legado: 'info_medica',            ptBR: 'Informacoes medicas relevantes', en: 'Relevant medical information' },
    { chave: 'anamnese_consentimento_saude',    tipo: 'escala', escala: escalaSN.id, legado: 'consentimento_saude',    ptBR: 'Declaro estar apto a realizar o tratamento', en: 'I declare I am fit for treatment' },
    { chave: 'anamnese_consentimento_marketing',tipo: 'escala', escala: escalaSN.id, legado: 'consentimento_marketing',ptBR: 'Autorizo receber comunicacoes de marketing', en: 'I authorize marketing communications' },
    { chave: 'anamnese_canais_marketing',       tipo: 'multipla',    legado: 'canais_marketing',       ptBR: 'Canais preferidos para contato', en: 'Preferred contact channels' },
    { chave: 'anamnese_assinatura',             tipo: 'texto_livre', legado: 'assinatura_data_url',    ptBR: 'Assinatura digital', en: 'Digital signature' },
  ];
  const insP = db.prepare("INSERT OR IGNORE INTO pergunta_satisfacao (chave, tipo, escala_id, mapeia_campo_legado, ativo) VALUES (?,?,?,?,1)");
  const insPTr = db.prepare("INSERT OR IGNORE INTO pergunta_traducao (pergunta_id, idioma, rotulo) VALUES (?,?,?)");
  for (const p of perguntas) {
    insP.run(p.chave, p.tipo, p.escala || null, p.legado);
    const pId = db.prepare("SELECT id FROM pergunta_satisfacao WHERE chave=?").get(p.chave).id;
    insPTr.run(pId, 'pt-BR', p.ptBR);
    insPTr.run(pId, 'en', p.en);
  }

  // Pesquisa anamnese (versao 1, publicada, escopo 'spa-anamnese')
  db.prepare("INSERT INTO pesquisa (slug, titulo, descricao, ativo, versao, app_escopo, publicada_em) VALUES (?,?,?,1,1,'spa-anamnese',datetime('now'))")
    .run('spa-anamnese-v1', 'Anamnese Pre-Tratamento Gran SPA', 'Formulario preenchido pelo hospede antes da sessao do SPA');
  const pId = db.prepare("SELECT id FROM pesquisa WHERE slug='spa-anamnese-v1' AND versao=1").get().id;
  db.prepare("INSERT OR IGNORE INTO pesquisa_traducao (pesquisa_id, idioma, titulo, descricao) VALUES (?,?,?,?)")
    .run(pId, 'pt-BR', 'Anamnese Pre-Tratamento Gran SPA', 'Formulario preenchido pelo hospede antes da sessao');
  db.prepare("INSERT OR IGNORE INTO pesquisa_traducao (pesquisa_id, idioma, titulo, descricao) VALUES (?,?,?,?)")
    .run(pId, 'en', 'Gran SPA Pre-Treatment Form', 'Form filled by the guest before the session');

  // Secoes
  const secoes = [
    { chave: 'dados_pessoais',  ordem: 1, ptBR: 'Dados Pessoais', en: 'Personal Information' },
    { chave: 'saude_rotinas',   ordem: 2, ptBR: 'Saude e Rotinas',  en: 'Health and Routines' },
    { chave: 'consentimentos',  ordem: 3, ptBR: 'Consentimentos',  en: 'Consents' },
  ];
  const insS = db.prepare("INSERT OR IGNORE INTO pesquisa_secao (pesquisa_id, chave, ordem, ativo) VALUES (?,?,?,1)");
  const insSTr = db.prepare("INSERT OR IGNORE INTO pesquisa_secao_traducao (pesquisa_secao_id, idioma, titulo) VALUES (?,?,?)");
  const secaoIds = {};
  for (const s of secoes) {
    insS.run(pId, s.chave, s.ordem);
    const sid = db.prepare("SELECT id FROM pesquisa_secao WHERE pesquisa_id=? AND chave=?").get(pId, s.chave).id;
    secaoIds[s.chave] = sid;
    insSTr.run(sid, 'pt-BR', s.ptBR);
    insSTr.run(sid, 'en', s.en);
  }

  const associacoes = [
    { chave: 'anamnese_nome',                    secao: 'dados_pessoais', ordem: 1,  obrigatoria: 1 },
    { chave: 'anamnese_sobrenome',               secao: 'dados_pessoais', ordem: 2,  obrigatoria: 1 },
    { chave: 'anamnese_tipo_documento',          secao: 'dados_pessoais', ordem: 3,  obrigatoria: 0 },
    { chave: 'anamnese_documento',               secao: 'dados_pessoais', ordem: 4,  obrigatoria: 0 },
    { chave: 'anamnese_email',                   secao: 'dados_pessoais', ordem: 5,  obrigatoria: 0 },
    { chave: 'anamnese_telefone',                secao: 'dados_pessoais', ordem: 6,  obrigatoria: 0 },
    { chave: 'anamnese_data_nascimento',         secao: 'dados_pessoais', ordem: 7,  obrigatoria: 0 },
    { chave: 'anamnese_rotina_facial',           secao: 'saude_rotinas',  ordem: 1,  obrigatoria: 0 },
    { chave: 'anamnese_rotina_corporal',         secao: 'saude_rotinas',  ordem: 2,  obrigatoria: 0 },
    { chave: 'anamnese_produto_especifico',      secao: 'saude_rotinas',  ordem: 3,  obrigatoria: 0 },
    { chave: 'anamnese_pressao_massagem',        secao: 'saude_rotinas',  ordem: 4,  obrigatoria: 0 },
    { chave: 'anamnese_info_medica',             secao: 'saude_rotinas',  ordem: 5,  obrigatoria: 0 },
    { chave: 'anamnese_consentimento_saude',     secao: 'consentimentos', ordem: 1,  obrigatoria: 1 },
    { chave: 'anamnese_consentimento_marketing', secao: 'consentimentos', ordem: 2,  obrigatoria: 0 },
    { chave: 'anamnese_canais_marketing',        secao: 'consentimentos', ordem: 3,  obrigatoria: 0 },
    { chave: 'anamnese_assinatura',              secao: 'consentimentos', ordem: 4,  obrigatoria: 1 },
  ];
  const insPP = db.prepare("INSERT OR IGNORE INTO pesquisa_pergunta (pesquisa_id, pergunta_id, secao_id, ordem, ativo, obrigatoria) VALUES (?,?,?,?,1,?)");
  for (const a of associacoes) {
    const pidQ = db.prepare("SELECT id FROM pergunta_satisfacao WHERE chave=?").get(a.chave)?.id;
    if (!pidQ) continue;
    insPP.run(pId, pidQ, secaoIds[a.secao], a.ordem, a.obrigatoria);
  }

  _marcarSeedConcluido(db);
  return true;
}

// ── Leitura ────────────────────────────────────────────────────────────────
export function buscarPesquisaPublicada(slug, idioma = 'pt-BR') {
  const db = getDb();
  const pesquisa = db.prepare(
    "SELECT id FROM pesquisa WHERE slug=? AND ativo=1 AND publicada_em IS NOT NULL ORDER BY versao DESC LIMIT 1"
  ).get(slug);
  if (!pesquisa) return null;
  return montarConfigPesquisa(pesquisa.id, idioma);
}

export function buscarPesquisaPublicadaPorApp(app, idioma = 'pt-BR') {
  const db = getDb();
  const pesquisa = db.prepare(
    "SELECT id FROM pesquisa WHERE ativo=1 AND publicada_em IS NOT NULL AND (app_escopo=? OR app_escopo='all') ORDER BY publicada_em DESC, versao DESC LIMIT 1"
  ).get(app);
  if (!pesquisa) return null;
  return montarConfigPesquisa(pesquisa.id, idioma);
}

export function listarPesquisasPublicadasPorApp(app) {
  const db = getDb();
  const rows = db.prepare(
    "SELECT slug, versao, app_escopo, titulo, descricao, publicada_em FROM pesquisa WHERE ativo=1 AND publicada_em IS NOT NULL AND (app_escopo=? OR app_escopo='all') ORDER BY publicada_em DESC"
  ).all(app);
  const porSlug = {};
  for (const r of rows) {
    if (!porSlug[r.slug] || porSlug[r.slug].versao < r.versao) porSlug[r.slug] = r;
  }
  return Object.values(porSlug);
}

function montarConfigPesquisa(pesquisaId, idioma) {
  const db = getDb();
  const pesquisa = db.prepare("SELECT id, slug, titulo, descricao, versao, app_escopo FROM pesquisa WHERE id=?").get(pesquisaId);
  if (!pesquisa) return null;
  const tr = db.prepare("SELECT titulo, descricao FROM pesquisa_traducao WHERE pesquisa_id=? AND idioma=?").get(pesquisaId, idioma);
  if (tr) { pesquisa.titulo = tr.titulo; pesquisa.descricao = tr.descricao; }

  const secoes = db.prepare("SELECT id, chave, ordem FROM pesquisa_secao WHERE pesquisa_id=? AND ativo=1 ORDER BY ordem").all(pesquisaId);
  for (const s of secoes) {
    const trS = db.prepare("SELECT titulo FROM pesquisa_secao_traducao WHERE pesquisa_secao_id=? AND idioma=?").get(s.id, idioma);
    s.titulo = trS?.titulo || s.chave;
    s.perguntas = db.prepare(`
      SELECT pp.ordem, pp.obrigatoria, p.id AS pergunta_id, p.chave, p.tipo, p.escala_id, p.mapeia_campo_legado
      FROM pesquisa_pergunta pp
      JOIN pergunta_satisfacao p ON p.id = pp.pergunta_id
      WHERE pp.pesquisa_id=? AND pp.secao_id=? AND pp.ativo=1 AND p.ativo=1
      ORDER BY pp.ordem
    `).all(pesquisaId, s.id);
    for (const q of s.perguntas) {
      const trQ = db.prepare("SELECT rotulo, ajuda FROM pergunta_traducao WHERE pergunta_id=? AND idioma=?").get(q.pergunta_id, idioma);
      q.rotulo = trQ?.rotulo || q.chave;
      q.ajuda = trQ?.ajuda || null;
      if (q.escala_id) {
        q.opcoes = montarOpcoesEscala(q.escala_id, idioma);
      } else if (q.tipo === 'unica' || q.tipo === 'multipla') {
        q.opcoes = montarOpcoesPergunta(q.pergunta_id, idioma);
        if (!q.opcoes.length) q.opcoes = null;
      } else {
        q.opcoes = null;
      }
      delete q.pergunta_id;
    }
  }
  return { slug: pesquisa.slug, versao: pesquisa.versao, app_escopo: pesquisa.app_escopo, titulo: pesquisa.titulo, descricao: pesquisa.descricao, secoes };
}

function montarOpcoesEscala(escalaId, idioma) {
  const db = getDb();
  return db.prepare(`
    SELECT eo.chave, eo.valor_numerico, eo.polaridade, eo.ordem,
      COALESCE((SELECT rotulo FROM escala_opcao_traducao WHERE escala_opcao_id=eo.id AND idioma=?), eo.chave) AS rotulo
    FROM escala_opcao eo WHERE eo.escala_id=? ORDER BY eo.ordem
  `).all(idioma, escalaId);
}

function montarOpcoesPergunta(perguntaId, idioma) {
  const db = getDb();
  return db.prepare(`
    SELECT po.chave, po.valor_numerico, po.ordem,
      COALESCE((SELECT rotulo FROM pergunta_opcao_traducao WHERE pergunta_opcao_id=po.id AND idioma=?), po.chave) AS rotulo
    FROM pergunta_opcao po WHERE po.pergunta_id=? AND po.ativo=1 ORDER BY po.ordem
  `).all(idioma, perguntaId);
}

// ── Submissao ─────────────────────────────────────────────────────────────
export function inserirRespostaPesquisa({ pesquisa_slug, pesquisa_versao, app_origem, cliente_id, reserva_id, feedback_id, itens }) {
  const db = getDb();
  let p;
  if (pesquisa_versao) {
    p = db.prepare("SELECT id, versao FROM pesquisa WHERE slug=? AND versao=?").get(pesquisa_slug, pesquisa_versao);
  } else {
    p = db.prepare("SELECT id, versao FROM pesquisa WHERE slug=? AND ativo=1 ORDER BY versao DESC LIMIT 1").get(pesquisa_slug);
  }
  if (!p) return null;
  const r = db.prepare(
    "INSERT INTO resposta_pesquisa (pesquisa_id, pesquisa_versao, app_origem, cliente_id, reserva_id, feedback_id) VALUES (?,?,?,?,?,?)"
  ).run(p.id, p.versao, app_origem || 'spa', cliente_id || null, reserva_id || null, feedback_id || null);
  const respId = r.lastInsertRowid;
  if (Array.isArray(itens)) {
    const stmt = db.prepare("INSERT INTO resposta_item (resposta_pesquisa_id, pergunta_chave, valor_texto, valor_numerico, escala_opcao_chave) VALUES (?,?,?,?,?)");
    for (const it of itens) {
      if (!it || !it.chave) continue;
      stmt.run(respId, it.chave, it.valor_texto || null, it.valor_numerico ?? null, it.escala_opcao_chave || null);
    }
  }
  return respId;
}

// ── Metas / Visao de Qualidade ────────────────────────────────────────────
export function listarMetasPorPesquisa(pesquisaId) {
  const db = getDb();
  return {
    por_pergunta: db.prepare(`
      SELECT m.id, m.pergunta_id, p.chave, p.mapeia_campo_legado, m.tipo_meta, m.valor_alvo, m.valido_de, m.valido_ate
      FROM meta_pergunta m JOIN pergunta_satisfacao p ON p.id = m.pergunta_id
      WHERE m.pesquisa_id=? ORDER BY p.chave
    `).all(pesquisaId),
    por_questionario: db.prepare("SELECT id, tipo_meta, valor_alvo, valido_de, valido_ate FROM meta_questionario WHERE pesquisa_id=?").all(pesquisaId),
  };
}

// Aplica metas em cima de stats existentes (feedback/stats). Retorna mapa
// { campo_legado: { meta, atingido } } para o front renderizar semaforo.
export function aplicarMetasEmStats(pesquisaSlug, stats) {
  const db = getDb();
  const p = db.prepare("SELECT id FROM pesquisa WHERE slug=? AND ativo=1 ORDER BY versao DESC LIMIT 1").get(pesquisaSlug);
  if (!p) return { por_pergunta: {}, por_questionario: {} };
  const metas = listarMetasPorPesquisa(p.id);
  const out = { por_pergunta: {}, por_questionario: {} };
  for (const m of metas.por_pergunta) {
    const campo = m.mapeia_campo_legado;
    if (!campo) continue;
    const media = stats.medias?.[campo];
    let atingido = null;
    if (m.tipo_meta === 'media' && media != null) atingido = media >= m.valor_alvo;
    out.por_pergunta[campo] = { tipo_meta: m.tipo_meta, alvo: m.valor_alvo, valor_atual: media, atingido };
  }
  for (const m of metas.por_questionario) {
    if (m.tipo_meta === 'pct_recomenda') {
      out.por_questionario.pct_recomenda = { alvo: m.valor_alvo, valor_atual: stats.pctRecomenda, atingido: stats.pctRecomenda != null && stats.pctRecomenda >= m.valor_alvo };
    }
  }
  return out;
}

// ── Admin: listagens ──────────────────────────────────────────────────────
export function listarPesquisas() {
  return getDb().prepare("SELECT id, slug, titulo, ativo, versao, app_escopo, publicada_em, criada_em FROM pesquisa ORDER BY criada_em DESC").all();
}
export function buscarPesquisaPorId(id) {
  return getDb().prepare("SELECT * FROM pesquisa WHERE id=?").get(id) || null;
}

// Estrutura completa para o EDITOR admin: ignora publicada_em e traz
// associacao_id em cada pergunta (necessário pra DELETE de pesquisa_pergunta
// sem desativar a pergunta global da biblioteca).
export function montarEstruturaPesquisaAdmin(slug, idioma = 'pt-BR') {
  const db = getDb();
  const pesquisa = db.prepare(
    "SELECT id, slug, titulo, descricao, versao, app_escopo, publicada_em, ativo FROM pesquisa WHERE slug=? ORDER BY versao DESC LIMIT 1"
  ).get(slug);
  if (!pesquisa) return null;
  const tr = db.prepare("SELECT titulo, descricao FROM pesquisa_traducao WHERE pesquisa_id=? AND idioma=?").get(pesquisa.id, idioma);
  if (tr) { pesquisa.titulo = tr.titulo; pesquisa.descricao = tr.descricao; }

  const secoes = db.prepare(
    "SELECT id, chave, ordem, ativo FROM pesquisa_secao WHERE pesquisa_id=? ORDER BY ordem, id"
  ).all(pesquisa.id);
  for (const s of secoes) {
    const trS = db.prepare("SELECT titulo FROM pesquisa_secao_traducao WHERE pesquisa_secao_id=? AND idioma=?").get(s.id, idioma);
    s.titulo = trS?.titulo || s.chave;
    s.perguntas = db.prepare(`
      SELECT pp.id AS associacao_id, pp.ordem, pp.obrigatoria, pp.ativo AS associacao_ativo,
             p.id AS pergunta_id, p.chave, p.tipo, p.escala_id, p.ativo
      FROM pesquisa_pergunta pp
      JOIN pergunta_satisfacao p ON p.id = pp.pergunta_id
      WHERE pp.pesquisa_id=? AND pp.secao_id=? AND pp.ativo=1
      ORDER BY pp.ordem, pp.id
    `).all(pesquisa.id, s.id);
    for (const q of s.perguntas) {
      const trQ = db.prepare("SELECT rotulo, ajuda FROM pergunta_traducao WHERE pergunta_id=? AND idioma=?").get(q.pergunta_id, idioma);
      q.rotulo = trQ?.rotulo || q.chave;
      q.ajuda = trQ?.ajuda || null;
      if (q.escala_id) {
        q.opcoes = montarOpcoesEscala(q.escala_id, idioma);
      } else if (q.tipo === 'unica' || q.tipo === 'multipla') {
        q.opcoes = montarOpcoesPergunta(q.pergunta_id, idioma);
        if (!q.opcoes.length) q.opcoes = null;
      } else {
        q.opcoes = null;
      }
    }
  }
  return {
    id: pesquisa.id, slug: pesquisa.slug, titulo: pesquisa.titulo,
    descricao: pesquisa.descricao, versao: pesquisa.versao,
    app_escopo: pesquisa.app_escopo, publicada: !!pesquisa.publicada_em,
    secoes,
  };
}
export function listarPerguntasBiblioteca() {
  return getDb().prepare(`
    SELECT p.id, p.chave, p.tipo, p.escala_id, e.chave AS escala_chave, p.mapeia_campo_legado, p.ativo,
      (SELECT rotulo FROM pergunta_traducao WHERE pergunta_id=p.id AND idioma='pt-BR') AS rotulo
    FROM pergunta_satisfacao p
    LEFT JOIN escala e ON e.id = p.escala_id
    ORDER BY p.chave
  `).all();
}
export function listarEscalas() {
  const db = getDb();
  const escalas = db.prepare("SELECT id, chave, tipo FROM escala ORDER BY chave").all();
  for (const e of escalas) {
    e.opcoes = db.prepare(`
      SELECT eo.id, eo.chave, eo.valor_numerico, eo.polaridade, eo.ordem,
        (SELECT rotulo FROM escala_opcao_traducao WHERE escala_opcao_id=eo.id AND idioma='pt-BR') AS rotulo
      FROM escala_opcao eo WHERE eo.escala_id=? ORDER BY eo.ordem
    `).all(e.id);
  }
  return escalas;
}

// ── Admin: ESCRITAS (Módulo 4 - Central de Qualidade) ──────────────────────
// Todas as funções abaixo são CRUD para a UI admin. Nada delas é chamada
// pelo fluxo público — só pelas rotas /api/qualidade/admin/* protegidas.

function _gravarTraducoesPesquisa(db, pesquisaId, traducoes) {
  if (!traducoes || typeof traducoes !== 'object') return;
  const upsert = db.prepare(`
    INSERT INTO pesquisa_traducao (pesquisa_id, idioma, titulo, descricao) VALUES (?,?,?,?)
    ON CONFLICT(pesquisa_id, idioma) DO UPDATE SET titulo=excluded.titulo, descricao=excluded.descricao
  `);
  for (const [idioma, t] of Object.entries(traducoes)) {
    if (!idioma || !t) continue;
    upsert.run(pesquisaId, idioma, t.titulo || '', t.descricao || null);
  }
}

function _gravarTraducoesSecao(db, secaoId, traducoes) {
  if (!traducoes) return;
  const upsert = db.prepare(`
    INSERT INTO pesquisa_secao_traducao (pesquisa_secao_id, idioma, titulo) VALUES (?,?,?)
    ON CONFLICT(pesquisa_secao_id, idioma) DO UPDATE SET titulo=excluded.titulo
  `);
  for (const [idioma, t] of Object.entries(traducoes)) {
    if (!idioma || !t) continue;
    upsert.run(secaoId, idioma, typeof t === 'string' ? t : (t.titulo || ''));
  }
}

function _gravarTraducoesPergunta(db, perguntaId, traducoes) {
  if (!traducoes) return;
  const upsert = db.prepare(`
    INSERT INTO pergunta_traducao (pergunta_id, idioma, rotulo, ajuda) VALUES (?,?,?,?)
    ON CONFLICT(pergunta_id, idioma) DO UPDATE SET rotulo=excluded.rotulo, ajuda=excluded.ajuda
  `);
  for (const [idioma, t] of Object.entries(traducoes)) {
    if (!idioma || !t) continue;
    if (typeof t === 'string') upsert.run(perguntaId, idioma, t, null);
    else upsert.run(perguntaId, idioma, t.rotulo || '', t.ajuda || null);
  }
}

export function criarPesquisa({ slug, titulo, descricao, app_escopo, versao, traducoes }) {
  const db = getDb();
  if (!slug || !titulo) throw new Error('slug e titulo obrigatorios');
  const v = versao || 1;
  const exists = db.prepare("SELECT 1 FROM pesquisa WHERE slug=? AND versao=?").get(slug, v);
  if (exists) throw new Error('Pesquisa com este slug e versao ja existe');
  const r = db.prepare(
    "INSERT INTO pesquisa (slug, titulo, descricao, ativo, versao, app_escopo, publicada_em) VALUES (?,?,?,1,?,?,NULL)"
  ).run(slug, titulo, descricao || null, v, app_escopo || 'spa');
  const id = r.lastInsertRowid;
  _gravarTraducoesPesquisa(db, id, traducoes || { 'pt-BR': { titulo, descricao } });
  return id;
}

export function editarPesquisa(id, { titulo, descricao, app_escopo, ativo, traducoes }) {
  const db = getDb();
  const sets = [], args = [];
  if (titulo !== undefined)     { sets.push('titulo=?');     args.push(titulo); }
  if (descricao !== undefined)  { sets.push('descricao=?');  args.push(descricao); }
  if (app_escopo !== undefined) { sets.push('app_escopo=?'); args.push(app_escopo); }
  if (ativo !== undefined)      { sets.push('ativo=?');      args.push(ativo ? 1 : 0); }
  if (sets.length) {
    args.push(id);
    db.prepare(`UPDATE pesquisa SET ${sets.join(', ')} WHERE id=?`).run(...args);
  }
  if (traducoes) _gravarTraducoesPesquisa(db, id, traducoes);
  return true;
}

export function publicarPesquisa(id) {
  getDb().prepare("UPDATE pesquisa SET publicada_em=datetime('now') WHERE id=?").run(id);
  return true;
}

export function despublicarPesquisa(id) {
  getDb().prepare("UPDATE pesquisa SET publicada_em=NULL WHERE id=?").run(id);
  return true;
}

// Clona uma pesquisa para outro app_escopo (ou nova versão do mesmo app).
// Replica seções, associações pesquisa_pergunta, metas. Traduções da pesquisa
// e das seções também são copiadas. A biblioteca de perguntas é compartilhada
// (não duplicamos pergunta_satisfacao).
export function clonarPesquisa(idOrigem, { novoSlug, novoAppEscopo, novaVersao }) {
  const db = getDb();
  const origem = db.prepare("SELECT * FROM pesquisa WHERE id=?").get(idOrigem);
  if (!origem) throw new Error('Pesquisa de origem nao encontrada');
  const slug = novoSlug || origem.slug;
  const app = novoAppEscopo || origem.app_escopo;
  // Próxima versão livre p/ esse slug
  const maxV = db.prepare("SELECT MAX(versao) AS v FROM pesquisa WHERE slug=?").get(slug)?.v || 0;
  const versao = novaVersao || (maxV + 1);
  const tx = db.transaction(() => {
    const r = db.prepare(
      "INSERT INTO pesquisa (slug, titulo, descricao, ativo, versao, app_escopo, publicada_em) VALUES (?,?,?,1,?,?,NULL)"
    ).run(slug, origem.titulo, origem.descricao, versao, app);
    const novoId = r.lastInsertRowid;
    // Traduções da pesquisa
    const trs = db.prepare("SELECT idioma, titulo, descricao FROM pesquisa_traducao WHERE pesquisa_id=?").all(idOrigem);
    const insT = db.prepare("INSERT OR IGNORE INTO pesquisa_traducao (pesquisa_id, idioma, titulo, descricao) VALUES (?,?,?,?)");
    for (const t of trs) insT.run(novoId, t.idioma, t.titulo, t.descricao);
    // Seções (mapeia secaoOrigem.id → secaoNova.id)
    const secoes = db.prepare("SELECT id, chave, ordem, ativo FROM pesquisa_secao WHERE pesquisa_id=?").all(idOrigem);
    const insS = db.prepare("INSERT INTO pesquisa_secao (pesquisa_id, chave, ordem, ativo) VALUES (?,?,?,?)");
    const mapSecao = {};
    for (const s of secoes) {
      const rs = insS.run(novoId, s.chave, s.ordem, s.ativo);
      mapSecao[s.id] = rs.lastInsertRowid;
      const tsec = db.prepare("SELECT idioma, titulo FROM pesquisa_secao_traducao WHERE pesquisa_secao_id=?").all(s.id);
      const insTS = db.prepare("INSERT OR IGNORE INTO pesquisa_secao_traducao (pesquisa_secao_id, idioma, titulo) VALUES (?,?,?)");
      for (const t of tsec) insTS.run(mapSecao[s.id], t.idioma, t.titulo);
    }
    // Associações pesquisa_pergunta
    const ass = db.prepare("SELECT pergunta_id, secao_id, ordem, ativo, obrigatoria FROM pesquisa_pergunta WHERE pesquisa_id=?").all(idOrigem);
    const insPP = db.prepare("INSERT INTO pesquisa_pergunta (pesquisa_id, pergunta_id, secao_id, ordem, ativo, obrigatoria) VALUES (?,?,?,?,?,?)");
    for (const a of ass) {
      insPP.run(novoId, a.pergunta_id, mapSecao[a.secao_id] || null, a.ordem, a.ativo, a.obrigatoria);
    }
    // Metas
    const mps = db.prepare("SELECT pergunta_id, tipo_meta, valor_alvo, valido_de, valido_ate FROM meta_pergunta WHERE pesquisa_id=?").all(idOrigem);
    const insMP = db.prepare("INSERT INTO meta_pergunta (pesquisa_id, pergunta_id, tipo_meta, valor_alvo, valido_de, valido_ate) VALUES (?,?,?,?,?,?)");
    for (const m of mps) insMP.run(novoId, m.pergunta_id, m.tipo_meta, m.valor_alvo, m.valido_de, m.valido_ate);
    const mqs = db.prepare("SELECT tipo_meta, valor_alvo, valido_de, valido_ate FROM meta_questionario WHERE pesquisa_id=?").all(idOrigem);
    const insMQ = db.prepare("INSERT INTO meta_questionario (pesquisa_id, tipo_meta, valor_alvo, valido_de, valido_ate) VALUES (?,?,?,?,?)");
    for (const m of mqs) insMQ.run(novoId, m.tipo_meta, m.valor_alvo, m.valido_de, m.valido_ate);
    return novoId;
  });
  return tx();
}

export function criarSecao(pesquisaId, { chave, ordem, ativo, traducoes }) {
  const db = getDb();
  if (!chave) throw new Error('chave obrigatoria');
  const r = db.prepare("INSERT INTO pesquisa_secao (pesquisa_id, chave, ordem, ativo) VALUES (?,?,?,?)")
    .run(pesquisaId, chave, ordem ?? 0, ativo === 0 ? 0 : 1);
  const id = r.lastInsertRowid;
  _gravarTraducoesSecao(db, id, traducoes || { 'pt-BR': { titulo: chave } });
  return id;
}

export function editarSecao(id, { chave, ordem, ativo, traducoes }) {
  const db = getDb();
  const sets = [], args = [];
  if (chave !== undefined) { sets.push('chave=?'); args.push(chave); }
  if (ordem !== undefined) { sets.push('ordem=?'); args.push(ordem); }
  if (ativo !== undefined) { sets.push('ativo=?'); args.push(ativo ? 1 : 0); }
  if (sets.length) {
    args.push(id);
    db.prepare(`UPDATE pesquisa_secao SET ${sets.join(', ')} WHERE id=?`).run(...args);
  }
  if (traducoes) _gravarTraducoesSecao(db, id, traducoes);
  return true;
}

export function removerSecao(id) {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM pesquisa_pergunta WHERE secao_id=?").run(id);
    db.prepare("DELETE FROM pesquisa_secao_traducao WHERE pesquisa_secao_id=?").run(id);
    db.prepare("DELETE FROM pesquisa_secao WHERE id=?").run(id);
  });
  tx();
  return true;
}

export function associarPergunta(pesquisaId, { pergunta_id, secao_id, ordem, obrigatoria, ativo }) {
  const db = getDb();
  if (!pergunta_id) throw new Error('pergunta_id obrigatoria');
  const r = db.prepare(
    "INSERT INTO pesquisa_pergunta (pesquisa_id, pergunta_id, secao_id, ordem, ativo, obrigatoria) VALUES (?,?,?,?,?,?)"
  ).run(pesquisaId, pergunta_id, secao_id || null, ordem ?? 0, ativo === 0 ? 0 : 1, obrigatoria ? 1 : 0);
  return r.lastInsertRowid;
}

export function editarAssociacaoPergunta(id, { secao_id, ordem, obrigatoria, ativo }) {
  const db = getDb();
  const sets = [], args = [];
  if (secao_id !== undefined)    { sets.push('secao_id=?');    args.push(secao_id); }
  if (ordem !== undefined)       { sets.push('ordem=?');       args.push(ordem); }
  if (obrigatoria !== undefined) { sets.push('obrigatoria=?'); args.push(obrigatoria ? 1 : 0); }
  if (ativo !== undefined)       { sets.push('ativo=?');       args.push(ativo ? 1 : 0); }
  if (!sets.length) return false;
  args.push(id);
  db.prepare(`UPDATE pesquisa_pergunta SET ${sets.join(', ')} WHERE id=?`).run(...args);
  return true;
}

export function desassociarPergunta(id) {
  getDb().prepare("DELETE FROM pesquisa_pergunta WHERE id=?").run(id);
  return true;
}

export function criarPergunta({ chave, tipo, escala_id, mapeia_campo_legado, traducoes, ativo }) {
  const db = getDb();
  if (!chave || !tipo) throw new Error('chave e tipo obrigatorios');
  const r = db.prepare(
    "INSERT INTO pergunta_satisfacao (chave, tipo, escala_id, mapeia_campo_legado, ativo) VALUES (?,?,?,?,?)"
  ).run(chave, tipo, escala_id || null, mapeia_campo_legado || null, ativo === 0 ? 0 : 1);
  const id = r.lastInsertRowid;
  _gravarTraducoesPergunta(db, id, traducoes || { 'pt-BR': { rotulo: chave } });
  return id;
}

export function editarPergunta(id, { tipo, escala_id, mapeia_campo_legado, ativo, traducoes }) {
  const db = getDb();
  const sets = [], args = [];
  if (tipo !== undefined)                { sets.push('tipo=?');                args.push(tipo); }
  if (escala_id !== undefined)           { sets.push('escala_id=?');           args.push(escala_id); }
  if (mapeia_campo_legado !== undefined) { sets.push('mapeia_campo_legado=?'); args.push(mapeia_campo_legado); }
  if (ativo !== undefined)               { sets.push('ativo=?');               args.push(ativo ? 1 : 0); }
  if (sets.length) {
    args.push(id);
    db.prepare(`UPDATE pergunta_satisfacao SET ${sets.join(', ')} WHERE id=?`).run(...args);
  }
  if (traducoes) _gravarTraducoesPergunta(db, id, traducoes);
  return true;
}

export function criarEscala({ chave, tipo, opcoes }) {
  const db = getDb();
  if (!chave) throw new Error('chave obrigatoria');
  const tx = db.transaction(() => {
    db.prepare("INSERT INTO escala (chave, tipo) VALUES (?,?)").run(chave, tipo || chave);
    const escalaId = db.prepare("SELECT id FROM escala WHERE chave=?").get(chave).id;
    if (Array.isArray(opcoes)) {
      const insOp = db.prepare("INSERT INTO escala_opcao (escala_id, chave, valor_numerico, polaridade, ordem) VALUES (?,?,?,?,?)");
      const insTr = db.prepare("INSERT INTO escala_opcao_traducao (escala_opcao_id, idioma, rotulo) VALUES (?,?,?)");
      let i = 1;
      for (const o of opcoes) {
        if (!o.chave) continue;
        insOp.run(escalaId, o.chave, o.valor_numerico ?? null, o.polaridade || 'neutral', o.ordem ?? i++);
        const opId = db.prepare("SELECT id FROM escala_opcao WHERE escala_id=? AND chave=?").get(escalaId, o.chave).id;
        if (o.traducoes) {
          for (const [idioma, rotulo] of Object.entries(o.traducoes)) insTr.run(opId, idioma, rotulo);
        } else {
          insTr.run(opId, 'pt-BR', o.rotulo || o.chave);
        }
      }
    }
    return escalaId;
  });
  return tx();
}

export function salvarMetaPergunta({ pesquisa_id, pergunta_id, tipo_meta, valor_alvo, valido_de, valido_ate }) {
  const db = getDb();
  // upsert: 1 meta por (pesquisa, pergunta, tipo_meta)
  const existing = db.prepare(
    "SELECT id FROM meta_pergunta WHERE pesquisa_id=? AND pergunta_id=? AND tipo_meta=?"
  ).get(pesquisa_id, pergunta_id, tipo_meta);
  if (existing) {
    db.prepare("UPDATE meta_pergunta SET valor_alvo=?, valido_de=?, valido_ate=? WHERE id=?")
      .run(valor_alvo, valido_de || null, valido_ate || null, existing.id);
    return existing.id;
  }
  const r = db.prepare(
    "INSERT INTO meta_pergunta (pesquisa_id, pergunta_id, tipo_meta, valor_alvo, valido_de, valido_ate) VALUES (?,?,?,?,?,?)"
  ).run(pesquisa_id, pergunta_id, tipo_meta, valor_alvo, valido_de || null, valido_ate || null);
  return r.lastInsertRowid;
}

export function salvarMetaQuestionario({ pesquisa_id, tipo_meta, valor_alvo, valido_de, valido_ate }) {
  const db = getDb();
  const existing = db.prepare(
    "SELECT id FROM meta_questionario WHERE pesquisa_id=? AND tipo_meta=?"
  ).get(pesquisa_id, tipo_meta);
  if (existing) {
    db.prepare("UPDATE meta_questionario SET valor_alvo=?, valido_de=?, valido_ate=? WHERE id=?")
      .run(valor_alvo, valido_de || null, valido_ate || null, existing.id);
    return existing.id;
  }
  const r = db.prepare(
    "INSERT INTO meta_questionario (pesquisa_id, tipo_meta, valor_alvo, valido_de, valido_ate) VALUES (?,?,?,?,?)"
  ).run(pesquisa_id, tipo_meta, valor_alvo, valido_de || null, valido_ate || null);
  return r.lastInsertRowid;
}

export function removerMeta(tipo, id) {
  const tabela = tipo === 'questionario' ? 'meta_questionario' : 'meta_pergunta';
  getDb().prepare(`DELETE FROM ${tabela} WHERE id=?`).run(id);
  return true;
}

// ── Opções de pergunta (Módulo 2 - anamnese dinâmica) ──────────────────────
export function listarOpcoesPergunta(perguntaId) {
  const db = getDb();
  const opcoes = db.prepare(
    "SELECT id, chave, valor_numerico, ordem, ativo FROM pergunta_opcao WHERE pergunta_id=? ORDER BY ordem"
  ).all(perguntaId);
  for (const o of opcoes) {
    o.traducoes = db.prepare(
      "SELECT idioma, rotulo FROM pergunta_opcao_traducao WHERE pergunta_opcao_id=?"
    ).all(o.id).reduce((acc, t) => { acc[t.idioma] = t.rotulo; return acc; }, {});
  }
  return opcoes;
}

export function salvarOpcaoPergunta(perguntaId, { id, chave, valor_numerico, ordem, ativo, traducoes }) {
  const db = getDb();
  if (!chave) throw new Error('chave obrigatoria');
  let opId = id;
  if (opId) {
    const sets = [], args = [];
    if (chave !== undefined)          { sets.push('chave=?');          args.push(chave); }
    if (valor_numerico !== undefined) { sets.push('valor_numerico=?'); args.push(valor_numerico); }
    if (ordem !== undefined)          { sets.push('ordem=?');          args.push(ordem); }
    if (ativo !== undefined)          { sets.push('ativo=?');          args.push(ativo ? 1 : 0); }
    if (sets.length) { args.push(opId); db.prepare(`UPDATE pergunta_opcao SET ${sets.join(', ')} WHERE id=?`).run(...args); }
  } else {
    const r = db.prepare(
      "INSERT INTO pergunta_opcao (pergunta_id, chave, valor_numerico, ordem, ativo) VALUES (?,?,?,?,?)"
    ).run(perguntaId, chave, valor_numerico ?? null, ordem ?? 0, ativo === 0 ? 0 : 1);
    opId = r.lastInsertRowid;
  }
  if (traducoes) {
    const upsert = db.prepare(`
      INSERT INTO pergunta_opcao_traducao (pergunta_opcao_id, idioma, rotulo) VALUES (?,?,?)
      ON CONFLICT(pergunta_opcao_id, idioma) DO UPDATE SET rotulo=excluded.rotulo
    `);
    for (const [idioma, rotulo] of Object.entries(traducoes)) {
      if (idioma && rotulo) upsert.run(opId, idioma, rotulo);
    }
  }
  return opId;
}

export function removerOpcaoPergunta(id) {
  getDb().prepare("DELETE FROM pergunta_opcao WHERE id=?").run(id);
  return true;
}

// Seed idempotente das opções das perguntas 'unica'/'multipla' da anamnese
// que hoje estão hardcoded nos locales JSON. Só popula se ainda não houver
// opções cadastradas para a pergunta — assim re-rodar é seguro.
export function seedAnamneseOpcoes() {
  const db = getDb();
  const peg = (chave) => db.prepare("SELECT id FROM pergunta_satisfacao WHERE chave=?").get(chave)?.id;
  const semOpcoes = (perguntaId) => !db.prepare("SELECT 1 FROM pergunta_opcao WHERE pergunta_id=? LIMIT 1").get(perguntaId);

  const insOp = db.prepare("INSERT INTO pergunta_opcao (pergunta_id, chave, ordem, ativo) VALUES (?,?,?,1)");
  const insTr = db.prepare("INSERT OR IGNORE INTO pergunta_opcao_traducao (pergunta_opcao_id, idioma, rotulo) VALUES (?,?,?)");

  function popular(chavePergunta, opcoes) {
    const pid = peg(chavePergunta);
    if (!pid || !semOpcoes(pid)) return;
    let i = 1;
    for (const o of opcoes) {
      const r = insOp.run(pid, o.chave, i++);
      const opId = r.lastInsertRowid;
      for (const [idioma, rotulo] of Object.entries(o.t || {})) insTr.run(opId, idioma, rotulo);
    }
  }

  // tipo_documento (já hardcoded no spa-profile)
  popular('anamnese_tipo_documento', [
    { chave: 'cpf',       t: { 'pt-BR': 'CPF',           'pt-PT': 'CPF',           en: 'CPF',           es: 'CPF',           fr: 'CPF',           it: 'CPF',           de: 'CPF' } },
    { chave: 'passaporte',t: { 'pt-BR': 'Passaporte',    'pt-PT': 'Passaporte',    en: 'Passport',      es: 'Pasaporte',     fr: 'Passeport',     it: 'Passaporto',    de: 'Reisepass' } },
    { chave: 'rg',        t: { 'pt-BR': 'RG / Documento de identidade', 'pt-PT': 'Documento de identidade', en: 'ID document', es: 'Documento de identidad', fr: 'Pièce d’identité', it: 'Documento d’identità', de: 'Personalausweis' } },
  ]);

  // pressao_massagem
  popular('anamnese_pressao_massagem', [
    { chave: 'leve',     t: { 'pt-BR': 'Leve',     'pt-PT': 'Leve',     en: 'Light',     es: 'Suave',    fr: 'Légère',  it: 'Leggera', de: 'Leicht' } },
    { chave: 'media',    t: { 'pt-BR': 'Média',    'pt-PT': 'Média',    en: 'Medium',    es: 'Media',    fr: 'Moyenne', it: 'Media',   de: 'Mittel' } },
    { chave: 'forte',    t: { 'pt-BR': 'Forte',    'pt-PT': 'Forte',    en: 'Firm',      es: 'Fuerte',   fr: 'Forte',   it: 'Forte',   de: 'Stark' } },
  ]);

  // rotina_facial — 11 itens L’Occitane (chaves curtas; rótulo pt-BR define o display)
  popular('anamnese_rotina_facial', [
    { chave: 'limpeza',        t: { 'pt-BR': 'Limpeza' } },
    { chave: 'tonico',         t: { 'pt-BR': 'Tônico' } },
    { chave: 'esfoliante',     t: { 'pt-BR': 'Esfoliante' } },
    { chave: 'mascara',        t: { 'pt-BR': 'Máscara facial' } },
    { chave: 'serum',          t: { 'pt-BR': 'Sérum' } },
    { chave: 'hidratante',     t: { 'pt-BR': 'Hidratante' } },
    { chave: 'olheiras',       t: { 'pt-BR': 'Tratamento para olheiras' } },
    { chave: 'protetor_solar', t: { 'pt-BR': 'Protetor solar' } },
    { chave: 'antienvelhec',   t: { 'pt-BR': 'Antienvelhecimento' } },
    { chave: 'oleo_facial',    t: { 'pt-BR': 'Óleo facial' } },
    { chave: 'demaquilante',   t: { 'pt-BR': 'Demaquilante' } },
  ]);

  // rotina_corporal — 5 itens
  popular('anamnese_rotina_corporal', [
    { chave: 'hidratante_corporal', t: { 'pt-BR': 'Hidratante corporal' } },
    { chave: 'esfoliante_corporal', t: { 'pt-BR': 'Esfoliante corporal' } },
    { chave: 'oleo_corporal',       t: { 'pt-BR': 'Óleo corporal' } },
    { chave: 'sabonete',            t: { 'pt-BR': 'Sabonete específico' } },
    { chave: 'pos_banho',           t: { 'pt-BR': 'Loção pós-banho' } },
  ]);

  // canais_marketing
  popular('anamnese_canais_marketing', [
    { chave: 'email',    t: { 'pt-BR': 'E-mail',    'pt-PT': 'E-mail',    en: 'E-mail',    es: 'Correo',  fr: 'E-mail', it: 'E-mail', de: 'E-Mail' } },
    { chave: 'whatsapp', t: { 'pt-BR': 'WhatsApp',  'pt-PT': 'WhatsApp',  en: 'WhatsApp',  es: 'WhatsApp',fr: 'WhatsApp',it:'WhatsApp', de: 'WhatsApp' } },
    { chave: 'sms',      t: { 'pt-BR': 'SMS',       'pt-PT': 'SMS',       en: 'SMS',       es: 'SMS',     fr: 'SMS',    it: 'SMS',    de: 'SMS' } },
  ]);

  return true;
}
