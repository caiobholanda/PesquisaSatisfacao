'use strict';

// Modulo "Gestao da Qualidade / Pesquisas" — fonte de verdade para
// questionarios configuraveis no SPA e em outros apps do ecossistema.
// Tudo additive-only: nao toca em feedback/reservas/etc.

import { getDb } from './db.js';

// ── Seed idempotente: re-rodar e' seguro ───────────────────────────────────
export function seedQualidadeSpa() {
  const db = getDb();
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
      q.opcoes = q.escala_id ? montarOpcoesEscala(q.escala_id, idioma) : null;
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
