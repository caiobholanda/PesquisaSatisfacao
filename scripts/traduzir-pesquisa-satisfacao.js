#!/usr/bin/env node
/**
 * Traduz todas as perguntas, seções e opções de escala da pesquisa de
 * satisfação (spa-locc-v1) e da anamnese (spa-anamnese-v1) para os 6
 * idiomas faltantes (pt-PT, en, es, fr, it, de), usando Claude Haiku
 * via src/utils/traduzir.js. Idempotente: faz UPSERT.
 *
 * Uso:
 *   node scripts/traduzir-pesquisa-satisfacao.js              # dry-run
 *   node scripts/traduzir-pesquisa-satisfacao.js --apply
 */

import 'dotenv/config';
import { getDb, initDb } from '../src/db.js';
import { traduzirParaTodos } from '../src/utils/traduzir.js';

const APPLY = process.argv.includes('--apply');
const IDIOMAS = ['pt-PT', 'en', 'es', 'fr', 'it', 'de'];
const SLUGS = ['spa-locc-v1', 'spa-anamnese-v1'];

async function main() {
  initDb();
  const db = getDb();

  console.log('\n═══════════════════════════════════════════════════════');
  console.log(' TRADUZIR PESQUISAS — ' + (APPLY ? 'APLICANDO' : 'DRY-RUN'));
  console.log('═══════════════════════════════════════════════════════\n');

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('⚠ ANTHROPIC_API_KEY não configurada. Defina a variável e tente de novo.');
    process.exit(1);
  }

  for (const slug of SLUGS) {
    const p = db.prepare("SELECT id FROM pesquisa WHERE slug=? ORDER BY versao DESC LIMIT 1").get(slug);
    if (!p) { console.log(` (pesquisa "${slug}" não existe, pulando)`); continue; }
    console.log('▼ Pesquisa: ' + slug + ' (id=' + p.id + ')');

    // 1) Traduções da pesquisa
    const pTr = db.prepare("SELECT titulo, descricao FROM pesquisa_traducao WHERE pesquisa_id=? AND idioma='pt-BR'").get(p.id);
    if (pTr) {
      for (const campo of ['titulo', 'descricao']) {
        const fonte = pTr[campo];
        if (!fonte) continue;
        const trad = await traduzirParaTodos(fonte, IDIOMAS);
        for (const [idioma, texto] of Object.entries(trad)) {
          const existe = db.prepare("SELECT titulo, descricao FROM pesquisa_traducao WHERE pesquisa_id=? AND idioma=?").get(p.id, idioma);
          if (APPLY) {
            if (existe) {
              const novo = { ...existe, [campo]: texto };
              db.prepare("UPDATE pesquisa_traducao SET titulo=?, descricao=? WHERE pesquisa_id=? AND idioma=?")
                .run(novo.titulo || '', novo.descricao || null, p.id, idioma);
            } else {
              db.prepare("INSERT INTO pesquisa_traducao (pesquisa_id, idioma, titulo, descricao) VALUES (?,?,?,?)")
                .run(p.id, idioma, campo === 'titulo' ? texto : '', campo === 'descricao' ? texto : null);
            }
          }
        }
        console.log(`   ${campo}: traduzido em ${Object.keys(trad).length} idiomas`);
      }
    }

    // 2) Seções
    const secoes = db.prepare("SELECT id, chave FROM pesquisa_secao WHERE pesquisa_id=?").all(p.id);
    for (const s of secoes) {
      const ptBR = db.prepare("SELECT titulo FROM pesquisa_secao_traducao WHERE pesquisa_secao_id=? AND idioma='pt-BR'").get(s.id)?.titulo;
      if (!ptBR) continue;
      const trad = await traduzirParaTodos(ptBR, IDIOMAS);
      for (const [idioma, texto] of Object.entries(trad)) {
        if (APPLY) {
          db.prepare(`
            INSERT INTO pesquisa_secao_traducao (pesquisa_secao_id, idioma, titulo) VALUES (?,?,?)
            ON CONFLICT(pesquisa_secao_id, idioma) DO UPDATE SET titulo=excluded.titulo
          `).run(s.id, idioma, texto);
        }
      }
      console.log('   seção "' + s.chave + '": ' + ptBR + ' → traduzido');
    }

    // 3) Perguntas (apenas as associadas a essa pesquisa)
    const perguntas = db.prepare(`
      SELECT DISTINCT q.id, q.chave
      FROM pergunta_satisfacao q
      JOIN pesquisa_pergunta pp ON pp.pergunta_id = q.id
      WHERE pp.pesquisa_id = ?
    `).all(p.id);
    for (const q of perguntas) {
      const ptTr = db.prepare("SELECT rotulo, ajuda FROM pergunta_traducao WHERE pergunta_id=? AND idioma='pt-BR'").get(q.id);
      if (!ptTr?.rotulo) continue;
      const trad = await traduzirParaTodos(ptTr.rotulo, IDIOMAS);
      for (const [idioma, texto] of Object.entries(trad)) {
        if (APPLY) {
          db.prepare(`
            INSERT INTO pergunta_traducao (pergunta_id, idioma, rotulo, ajuda) VALUES (?,?,?,?)
            ON CONFLICT(pergunta_id, idioma) DO UPDATE SET rotulo=excluded.rotulo
          `).run(q.id, idioma, texto, ptTr.ajuda || null);
        }
      }
      console.log('   pergunta "' + q.chave + '": traduzido em ' + Object.keys(trad).length);
    }

    // 4) Opções de escala usadas pela pesquisa
    const escalas = db.prepare(`
      SELECT DISTINCT e.id
      FROM escala e
      JOIN pergunta_satisfacao q ON q.escala_id = e.id
      JOIN pesquisa_pergunta pp ON pp.pergunta_id = q.id
      WHERE pp.pesquisa_id = ?
    `).all(p.id);
    for (const e of escalas) {
      const opcoes = db.prepare("SELECT id, chave FROM escala_opcao WHERE escala_id=?").all(e.id);
      for (const o of opcoes) {
        const ptBR = db.prepare("SELECT rotulo FROM escala_opcao_traducao WHERE escala_opcao_id=? AND idioma='pt-BR'").get(o.id)?.rotulo;
        if (!ptBR) continue;
        const trad = await traduzirParaTodos(ptBR, IDIOMAS);
        for (const [idioma, texto] of Object.entries(trad)) {
          if (APPLY) {
            db.prepare(`
              INSERT INTO escala_opcao_traducao (escala_opcao_id, idioma, rotulo) VALUES (?,?,?)
              ON CONFLICT(escala_opcao_id, idioma) DO UPDATE SET rotulo=excluded.rotulo
            `).run(o.id, idioma, texto);
          }
        }
        console.log('   opção escala "' + o.chave + '" (' + ptBR + '): traduzida');
      }
    }

    // 5) Opções de pergunta (pergunta_opcao) das perguntas tipo unica/multipla
    const opcoesPerguntas = db.prepare(`
      SELECT DISTINCT po.id, po.chave
      FROM pergunta_opcao po
      JOIN pergunta_satisfacao q ON q.id = po.pergunta_id
      JOIN pesquisa_pergunta pp ON pp.pergunta_id = q.id
      WHERE pp.pesquisa_id = ?
    `).all(p.id);
    for (const op of opcoesPerguntas) {
      const ptBR = db.prepare("SELECT rotulo FROM pergunta_opcao_traducao WHERE pergunta_opcao_id=? AND idioma='pt-BR'").get(op.id)?.rotulo;
      if (!ptBR) continue;
      const trad = await traduzirParaTodos(ptBR, IDIOMAS);
      for (const [idioma, texto] of Object.entries(trad)) {
        if (APPLY) {
          db.prepare(`
            INSERT INTO pergunta_opcao_traducao (pergunta_opcao_id, idioma, rotulo) VALUES (?,?,?)
            ON CONFLICT(pergunta_opcao_id, idioma) DO UPDATE SET rotulo=excluded.rotulo
          `).run(op.id, idioma, texto);
        }
      }
      console.log('   opção pergunta "' + op.chave + '": traduzida');
    }
  }

  if (!APPLY) console.log('\n▶ Para aplicar: node scripts/traduzir-pesquisa-satisfacao.js --apply');
  else console.log('\n═══ CONCLUÍDO ═══\n');
}

main().catch(e => { console.error('Erro:', e); process.exit(1); });
