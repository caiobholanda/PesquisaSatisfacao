// Backfill curado das traduções da Pesquisa de Satisfação (spa-locc-v1).
// Auditoria de 2026-07-16: apenas o inglês estava gravado (100%); pt-PT, es,
// fr, it e de estavam 0% — o hóspede estrangeiro caía em pt-BR.
// Traduções revisadas manualmente (espanhol em registro formal, usted).
// IDEMPOTENTE e NÃO-DESTRUTIVO: insere somente onde não existe tradução
// não-vazia; nunca sobrescreve pt-BR, en, nem textos revisados pelo admin.
import { getDb } from './db.js';

const IDIOMAS_ALVO = ['pt-PT', 'es', 'fr', 'it', 'de'];

// [pt-PT, es, fr, it, de]
const PESQUISA = {
  titulo: {
    'pt-PT': 'Inquérito de Satisfação Gran SPA',
    es: 'Encuesta de Satisfacción Gran SPA',
    fr: 'Enquête de Satisfaction Gran SPA',
    it: 'Sondaggio di Soddisfazione Gran SPA',
    de: 'Zufriedenheitsumfrage Gran SPA',
  },
  descricao: {
    'pt-PT': 'Avaliação dos serviços e instalações do Gran SPA',
    es: 'Evaluación de los servicios e instalaciones del Gran SPA',
    fr: 'Évaluation des services et des installations du Gran SPA',
    it: 'Valutazione dei servizi e delle strutture del Gran SPA',
    de: 'Bewertung der Dienstleistungen und Einrichtungen des Gran SPA',
  },
};

const SECOES = {
  servicos:    { 'pt-PT': 'Serviços',    es: 'Servicios',      fr: 'Services',       it: 'Servizi',         de: 'Dienstleistungen' },
  instalacoes: { 'pt-PT': 'Instalações', es: 'Instalaciones',  fr: 'Installations',  it: 'Strutture',       de: 'Einrichtungen' },
  recomenda:   { 'pt-PT': 'Recomendação', es: 'Recomendación', fr: 'Recommandation', it: 'Raccomandazione', de: 'Empfehlung' },
};

const PERGUNTAS = {
  servicos_expectativa: {
    'pt-PT': 'A expectativa do tratamento',
    es: 'La expectativa del tratamiento',
    fr: 'Vos attentes concernant le soin',
    it: 'Le aspettative sul trattamento',
    de: 'Ihre Erwartungen an die Behandlung',
  },
  servicos_explicacao: {
    'pt-PT': 'A explicação da massoterapeuta sobre benefícios e procedimentos',
    es: 'La explicación de la terapeuta sobre los beneficios y los procedimientos',
    fr: 'Les explications de la massothérapeute sur les bienfaits et les procédures',
    it: 'La spiegazione della massoterapista su benefici e procedure',
    de: 'Die Erklärung der Massagetherapeutin zu Nutzen und Ablauf',
  },
  servicos_atitude: {
    'pt-PT': 'A atitude e a qualidade dos serviços da massoterapeuta',
    es: 'La actitud y la calidad de los servicios de la terapeuta',
    fr: "L'attitude et la qualité des services de la massothérapeute",
    it: "L'atteggiamento e la qualità dei servizi della massoterapista",
    de: 'Die Einstellung und die Qualität der Leistungen der Massagetherapeutin',
  },
  servicos_tecnica: {
    'pt-PT': 'A técnica e a habilidade da massoterapeuta',
    es: 'La técnica y la habilidad de la terapeuta',
    fr: 'La technique et le savoir-faire de la massothérapeute',
    it: "La tecnica e l'abilità della massoterapista",
    de: 'Die Technik und das Können der Massagetherapeutin',
  },
  servicos_comentario: {
    'pt-PT': 'Comentário sobre os serviços',
    es: 'Comentario sobre los servicios',
    fr: 'Commentaire sur les services',
    it: 'Commento sui servizi',
    de: 'Kommentar zu den Dienstleistungen',
  },
  instalacoes_conforto: {
    'pt-PT': 'Conforto e conservação das instalações',
    es: 'Comodidad y conservación de las instalaciones',
    fr: 'Confort et entretien des installations',
    it: 'Comfort e manutenzione delle strutture',
    de: 'Komfort und Zustand der Einrichtungen',
  },
  instalacoes_organizacao: {
    'pt-PT': 'Organização da sala, equipamentos e ambiente',
    es: 'Organización de la sala, los equipos y el ambiente',
    fr: "Organisation de la salle, des équipements et de l'atmosphère",
    it: "Organizzazione della sala, delle attrezzature e dell'atmosfera",
    de: 'Organisation des Raums, der Ausstattung und der Atmosphäre',
  },
  instalacoes_conveniencia: {
    'pt-PT': 'Itens de conveniência (roupões, toalhas, etc.)',
    es: 'Artículos de conveniencia (batas, toallas, etc.)',
    fr: 'Articles de confort (peignoirs, serviettes, etc.)',
    it: 'Articoli di cortesia (accappatoi, asciugamani, ecc.)',
    de: 'Annehmlichkeiten (Bademäntel, Handtücher usw.)',
  },
  instalacoes_comentario: {
    'pt-PT': 'Comentário sobre as instalações',
    es: 'Comentario sobre las instalaciones',
    fr: 'Commentaire sur les installations',
    it: 'Commento sulle strutture',
    de: 'Kommentar zu den Einrichtungen',
  },
  recomenda: {
    'pt-PT': 'Recomendaria os nossos serviços?',
    es: '¿Recomendaría usted nuestros servicios?',
    fr: 'Recommanderiez-vous nos services ?',
    it: 'Consiglierebbe i nostri servizi?',
    de: 'Würden Sie unsere Dienstleistungen weiterempfehlen?',
  },
  recomenda_qual: {
    'pt-PT': 'A quem recomendaria?',
    es: '¿A quién los recomendaría?',
    fr: 'À qui les recommanderiez-vous ?',
    it: 'A chi li consiglierebbe?',
    de: 'Wem würden Sie sie empfehlen?',
  },
  recomenda_porque: {
    'pt-PT': 'Por que razão recomendaria?',
    es: '¿Por qué los recomendaría?',
    fr: 'Pourquoi les recommanderiez-vous ?',
    it: 'Perché li consiglierebbe?',
    de: 'Warum würden Sie sie empfehlen?',
  },
};

// Escalas são globais (compartilhadas com outras pesquisas) — indexadas por
// chave da escala + chave da opção. Só insere onde falta.
const ESCALAS = {
  '4pt_qualitativa': {
    otimo:   { 'pt-PT': 'Ótimo',    es: 'Excelente', fr: 'Excellent', it: 'Ottimo',   de: 'Ausgezeichnet' },
    bom:     { 'pt-PT': 'Bom',      es: 'Bueno',     fr: 'Bon',       it: 'Buono',    de: 'Gut' },
    regular: { 'pt-PT': 'Razoável', es: 'Regular',   fr: 'Moyen',     it: 'Discreto', de: 'Mittelmäßig' },
    ruim:    { 'pt-PT': 'Mau',      es: 'Malo',      fr: 'Mauvais',   it: 'Scarso',   de: 'Schlecht' },
  },
  sim_nao: {
    sim: { 'pt-PT': 'Sim', es: 'Sí',  fr: 'Oui', it: 'Sì',  de: 'Ja' },
    nao: { 'pt-PT': 'Não', es: 'No',  fr: 'Non', it: 'No',  de: 'Nein' },
  },
};

export function backfillTraducoesLocc() {
  const db = getDb();
  const p = db.prepare(
    "SELECT id FROM pesquisa WHERE slug='spa-locc-v1' AND ativo=1 AND publicada_em IS NOT NULL ORDER BY versao DESC LIMIT 1"
  ).get();
  if (!p) return;

  let inseridas = 0;

  const temTexto = (row, campo = 'rotulo') => !!(row && row[campo] && String(row[campo]).trim());

  // Título/descrição da pesquisa
  for (const lang of IDIOMAS_ALVO) {
    const atual = db.prepare('SELECT titulo, descricao FROM pesquisa_traducao WHERE pesquisa_id=? AND idioma=?').get(p.id, lang);
    if (!temTexto(atual, 'titulo')) {
      db.prepare('INSERT OR REPLACE INTO pesquisa_traducao (pesquisa_id, idioma, titulo, descricao) VALUES (?,?,?,?)')
        .run(p.id, lang, PESQUISA.titulo[lang], PESQUISA.descricao[lang]);
      inseridas++;
    }
  }

  // Seções
  for (const [chave, tr] of Object.entries(SECOES)) {
    const sec = db.prepare('SELECT id FROM pesquisa_secao WHERE pesquisa_id=? AND chave=?').get(p.id, chave);
    if (!sec) continue;
    for (const lang of IDIOMAS_ALVO) {
      const atual = db.prepare('SELECT titulo FROM pesquisa_secao_traducao WHERE pesquisa_secao_id=? AND idioma=?').get(sec.id, lang);
      if (!temTexto(atual, 'titulo')) {
        db.prepare('INSERT OR REPLACE INTO pesquisa_secao_traducao (pesquisa_secao_id, idioma, titulo) VALUES (?,?,?)')
          .run(sec.id, lang, tr[lang]);
        inseridas++;
      }
    }
  }

  // Perguntas
  for (const [chave, tr] of Object.entries(PERGUNTAS)) {
    const q = db.prepare('SELECT id FROM pergunta_satisfacao WHERE chave=? AND ativo=1').get(chave);
    if (!q) continue;
    for (const lang of IDIOMAS_ALVO) {
      const atual = db.prepare('SELECT rotulo FROM pergunta_traducao WHERE pergunta_id=? AND idioma=?').get(q.id, lang);
      if (!temTexto(atual)) {
        db.prepare('INSERT OR REPLACE INTO pergunta_traducao (pergunta_id, idioma, rotulo, ajuda) VALUES (?,?,?,NULL)')
          .run(q.id, lang, tr[lang]);
        inseridas++;
      }
    }
  }

  // Opções de escala (globais)
  for (const [escalaChave, opcoes] of Object.entries(ESCALAS)) {
    const esc = db.prepare('SELECT id FROM escala WHERE chave=?').get(escalaChave);
    if (!esc) continue;
    for (const [opChave, tr] of Object.entries(opcoes)) {
      const op = db.prepare('SELECT id FROM escala_opcao WHERE escala_id=? AND chave=?').get(esc.id, opChave);
      if (!op) continue;
      for (const lang of IDIOMAS_ALVO) {
        const atual = db.prepare('SELECT rotulo FROM escala_opcao_traducao WHERE escala_opcao_id=? AND idioma=?').get(op.id, lang);
        if (!temTexto(atual)) {
          db.prepare('INSERT OR REPLACE INTO escala_opcao_traducao (escala_opcao_id, idioma, rotulo) VALUES (?,?,?)')
            .run(op.id, lang, tr[lang]);
          inseridas++;
        }
      }
    }
  }

  if (inseridas > 0) console.log(`[Traducoes-Locc] backfill: ${inseridas} tradução(ões) inserida(s) (pt-PT/es/fr/it/de)`);
}
