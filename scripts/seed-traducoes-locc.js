#!/usr/bin/env node
/**
 * Insere/atualiza traduções estáticas (pt-PT, en, es, fr, it, de) para
 * todas as perguntas, seções e opções de escala da pesquisa de
 * satisfação spa-locc-v1. Idempotente (UPSERT).
 *
 * Usado em produção onde a ANTHROPIC_API_KEY não está configurada e
 * queremos garantia de tradução profissional revisada.
 *
 * Uso:
 *   node scripts/seed-traducoes-locc.js              # dry-run
 *   node scripts/seed-traducoes-locc.js --apply
 */

import 'dotenv/config';
import { getDb, initDb } from '../src/db.js';

const APPLY = process.argv.includes('--apply');

// ── Traduções ────────────────────────────────────────────────────────────
const PERGUNTAS = {
  servicos_expectativa: {
    'pt-PT': 'A expectativa do tratamento',
    'en':    'Your expectations of the treatment',
    'es':    'La expectativa del tratamiento',
    'fr':    'Vos attentes par rapport au soin',
    'it':    'Le aspettative del trattamento',
    'de':    'Ihre Erwartungen an die Behandlung',
  },
  servicos_explicacao: {
    'pt-PT': 'A explicação da massoterapeuta sobre benefícios e procedimentos',
    'en':    "The therapist's explanation of benefits and procedures",
    'es':    'La explicación de la masoterapeuta sobre los beneficios y procedimientos',
    'fr':    'Les explications de la masseuse sur les bienfaits et les procédures',
    'it':    "La spiegazione della massaggiatrice su benefici e procedure",
    'de':    'Die Erklärung der Massage­therapeutin zu Nutzen und Ablauf',
  },
  servicos_atitude: {
    'pt-PT': 'A atitude e a qualidade dos serviços da massoterapeuta',
    'en':    "The therapist's attitude and service quality",
    'es':    'La actitud y la calidad de los servicios de la masoterapeuta',
    'fr':    "L'attitude et la qualité du service de la masseuse",
    'it':    "L'atteggiamento e la qualità dei servizi della massaggiatrice",
    'de':    'Die Haltung und die Servicequalität der Therapeutin',
  },
  servicos_tecnica: {
    'pt-PT': 'A técnica e a habilidade da massoterapeuta',
    'en':    "The therapist's technique and skill",
    'es':    'La técnica y la habilidad de la masoterapeuta',
    'fr':    'La technique et le savoir-faire de la masseuse',
    'it':    'La tecnica e l’abilità della massaggiatrice',
    'de':    'Technik und Können der Therapeutin',
  },
  instalacoes_conforto: {
    'pt-PT': 'Conforto e conservação da estrutura',
    'en':    'Comfort and upkeep of the facilities',
    'es':    'Confort y conservación de las instalaciones',
    'fr':    'Confort et entretien des installations',
    'it':    'Comfort e cura delle strutture',
    'de':    'Komfort und Pflege der Räumlichkeiten',
  },
  instalacoes_organizacao: {
    'pt-PT': 'Organização da sala, equipamentos e atmosfera',
    'en':    'Room organization, equipment and atmosphere',
    'es':    'Organización de la sala, equipos y ambiente',
    'fr':    'Organisation de la salle, équipement et atmosphère',
    'it':    'Organizzazione della sala, attrezzature e atmosfera',
    'de':    'Organisation des Raums, Ausstattung und Atmosphäre',
  },
  instalacoes_conveniencia: {
    'pt-PT': 'Itens de conveniência (roupões, toalhas, etc.)',
    'en':    'Convenience items (robes, towels, etc.)',
    'es':    'Artículos de conveniencia (albornoces, toallas, etc.)',
    'fr':    "Articles de confort (peignoirs, serviettes, etc.)",
    'it':    'Articoli di cortesia (accappatoi, asciugamani, ecc.)',
    'de':    'Annehmlichkeiten (Bademantel, Handtücher, etc.)',
  },
  recomenda: {
    'pt-PT': 'Você recomendaria os nossos serviços?',
    'en':    'Would you recommend our services?',
    'es':    '¿Recomendaría nuestros servicios?',
    'fr':    'Recommanderiez-vous nos services ?',
    'it':    'Consiglierebbe i nostri servizi?',
    'de':    'Würden Sie unsere Dienstleistungen weiterempfehlen?',
  },
  recomenda_qual: {
    'pt-PT': 'A quem você recomendaria?',
    'en':    'Whom would you recommend it to?',
    'es':    '¿A quién lo recomendaría?',
    'fr':    'À qui le recommanderiez-vous ?',
    'it':    'A chi lo consiglierebbe?',
    'de':    'Wem würden Sie es empfehlen?',
  },
  recomenda_porque: {
    'pt-PT': 'Por que recomendaria?',
    'en':    'Why would you recommend it?',
    'es':    '¿Por qué lo recomendaría?',
    'fr':    'Pourquoi le recommanderiez-vous ?',
    'it':    'Perché lo consiglierebbe?',
    'de':    'Warum würden Sie es empfehlen?',
  },
  servicos_comentario: {
    'pt-PT': 'Comentário sobre os serviços',
    'en':    'Comments about the services',
    'es':    'Comentario sobre los servicios',
    'fr':    'Commentaire sur les services',
    'it':    'Commento sui servizi',
    'de':    'Anmerkung zu den Dienstleistungen',
  },
  instalacoes_comentario: {
    'pt-PT': 'Comentário sobre as instalações',
    'en':    'Comments about the facilities',
    'es':    'Comentario sobre las instalaciones',
    'fr':    'Commentaire sur les installations',
    'it':    'Commento sulle strutture',
    'de':    'Anmerkung zu den Räumlichkeiten',
  },
};

const SECOES = {
  servicos:    { 'pt-PT': 'Serviços',      'en': 'Services',       'es': 'Servicios',  'fr': 'Services',         'it': 'Servizi',        'de': 'Dienstleistungen' },
  instalacoes: { 'pt-PT': 'Instalações',   'en': 'Facilities',     'es': 'Instalaciones', 'fr': 'Installations', 'it': 'Strutture',      'de': 'Räumlichkeiten' },
  recomenda:   { 'pt-PT': 'Recomendação',  'en': 'Recommendation', 'es': 'Recomendación', 'fr': 'Recommandation','it': 'Raccomandazione','de': 'Empfehlung' },
};

const ESCALA_4PT = {
  otimo:   { 'pt-PT': 'Ótimo',   'en': 'Excellent', 'es': 'Excelente', 'fr': 'Excellent', 'it': 'Ottimo',  'de': 'Ausgezeichnet' },
  bom:     { 'pt-PT': 'Bom',     'en': 'Good',      'es': 'Bueno',     'fr': 'Bon',       'it': 'Buono',   'de': 'Gut' },
  regular: { 'pt-PT': 'Regular', 'en': 'Fair',      'es': 'Regular',   'fr': 'Moyen',     'it': 'Discreto','de': 'Mittel' },
  ruim:    { 'pt-PT': 'Mau',     'en': 'Poor',      'es': 'Malo',      'fr': 'Mauvais',   'it': 'Scarso',  'de': 'Schlecht' },
};

const ESCALA_SIM_NAO = {
  sim: { 'pt-PT': 'Sim', 'en': 'Yes', 'es': 'Sí',  'fr': 'Oui', 'it': 'Sì', 'de': 'Ja' },
  nao: { 'pt-PT': 'Não', 'en': 'No',  'es': 'No',  'fr': 'Non', 'it': 'No', 'de': 'Nein' },
};

async function main() {
  initDb();
  const db = getDb();

  console.log('\n═══════════════════════════════════════════════════════');
  console.log(' SEED TRADUÇÕES spa-locc-v1 — ' + (APPLY ? 'APLICANDO' : 'DRY-RUN'));
  console.log('═══════════════════════════════════════════════════════\n');

  const p = db.prepare("SELECT id FROM pesquisa WHERE slug='spa-locc-v1' ORDER BY versao DESC LIMIT 1").get();
  if (!p) { console.error('Pesquisa spa-locc-v1 não existe. Rode repopular-anamnese.js primeiro.'); process.exit(1); }

  let acoes = 0;

  // 1) Perguntas
  for (const [chave, trads] of Object.entries(PERGUNTAS)) {
    const pq = db.prepare("SELECT id FROM pergunta_satisfacao WHERE chave=?").get(chave);
    if (!pq) { console.log('  (pergunta', chave, 'não encontrada — pulando)'); continue; }
    for (const [idioma, rotulo] of Object.entries(trads)) {
      if (APPLY) {
        db.prepare(`
          INSERT INTO pergunta_traducao (pergunta_id, idioma, rotulo, ajuda) VALUES (?,?,?,NULL)
          ON CONFLICT(pergunta_id, idioma) DO UPDATE SET rotulo=excluded.rotulo
        `).run(pq.id, idioma, rotulo);
      }
      acoes++;
    }
  }
  console.log('Perguntas traduzidas: 12 × 6 idiomas =', 12 * 6);

  // 2) Seções
  for (const [chave, trads] of Object.entries(SECOES)) {
    const sec = db.prepare("SELECT id FROM pesquisa_secao WHERE pesquisa_id=? AND chave=?").get(p.id, chave);
    if (!sec) { console.log('  (seção', chave, 'não encontrada)'); continue; }
    for (const [idioma, titulo] of Object.entries(trads)) {
      if (APPLY) {
        db.prepare(`
          INSERT INTO pesquisa_secao_traducao (pesquisa_secao_id, idioma, titulo) VALUES (?,?,?)
          ON CONFLICT(pesquisa_secao_id, idioma) DO UPDATE SET titulo=excluded.titulo
        `).run(sec.id, idioma, titulo);
      }
      acoes++;
    }
  }
  console.log('Seções traduzidas: 3 × 6 idiomas =', 3 * 6);

  // 3) Escala 4pt_qualitativa
  const e4 = db.prepare("SELECT id FROM escala WHERE chave='4pt_qualitativa'").get();
  if (e4) {
    for (const [chave, trads] of Object.entries(ESCALA_4PT)) {
      const op = db.prepare("SELECT id FROM escala_opcao WHERE escala_id=? AND chave=?").get(e4.id, chave);
      if (!op) continue;
      for (const [idioma, rotulo] of Object.entries(trads)) {
        if (APPLY) {
          db.prepare(`
            INSERT INTO escala_opcao_traducao (escala_opcao_id, idioma, rotulo) VALUES (?,?,?)
            ON CONFLICT(escala_opcao_id, idioma) DO UPDATE SET rotulo=excluded.rotulo
          `).run(op.id, idioma, rotulo);
        }
        acoes++;
      }
    }
    console.log('Escala 4pt traduzida: 4 × 6 idiomas =', 4 * 6);
  }

  // 4) Escala sim_nao
  const eSN = db.prepare("SELECT id FROM escala WHERE chave='sim_nao'").get();
  if (eSN) {
    for (const [chave, trads] of Object.entries(ESCALA_SIM_NAO)) {
      const op = db.prepare("SELECT id FROM escala_opcao WHERE escala_id=? AND chave=?").get(eSN.id, chave);
      if (!op) continue;
      for (const [idioma, rotulo] of Object.entries(trads)) {
        if (APPLY) {
          db.prepare(`
            INSERT INTO escala_opcao_traducao (escala_opcao_id, idioma, rotulo) VALUES (?,?,?)
            ON CONFLICT(escala_opcao_id, idioma) DO UPDATE SET rotulo=excluded.rotulo
          `).run(op.id, idioma, rotulo);
        }
        acoes++;
      }
    }
    console.log('Escala sim/não traduzida: 2 × 6 idiomas =', 2 * 6);
  }

  console.log('\nTOTAL de upserts: ' + acoes);
  if (!APPLY) console.log('\n▶ Para aplicar: node scripts/seed-traducoes-locc.js --apply\n');
  else console.log('\n═══ CONCLUÍDO ═══\n');
}

main().catch(e => { console.error('Erro:', e); process.exit(1); });
