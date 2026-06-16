#!/usr/bin/env node
/**
 * Migração Módulo 1: popula `clientes` a partir de `spa_perfis` existentes
 * e tenta vincular reservas/feedbacks por CPF, telefone e email.
 *
 * Modo padrão = DRY-RUN: imprime o relatório e NÃO escreve nada.
 * Modo --apply: aplica a migração numa única transação.
 *
 * Uso:
 *   node scripts/migrar-clientes.js              # dry-run
 *   node scripts/migrar-clientes.js --apply      # aplica
 */

import 'dotenv/config';
import { getDb, initDb, validarCpfMod11, inserirCliente } from '../src/db.js';

const APPLY = process.argv.includes('--apply');

function norm(v) { return (v || '').toString().trim(); }
function cpfDigits(v) { return norm(v).replace(/\D/g, ''); }
function lower(v) { return norm(v).toLowerCase(); }

async function main() {
  initDb();
  const db = getDb();

  console.log('\n═══════════════════════════════════════════════════════');
  console.log(' MIGRAÇÃO DE CLIENTES — ' + (APPLY ? 'APLICANDO' : 'DRY-RUN (não escreve)'));
  console.log('═══════════════════════════════════════════════════════\n');

  const perfis = db.prepare(`
    SELECT id, nome, sobrenome, tipo_documento, documento, email, telefone,
           data_nascimento, idioma, reserva_id
    FROM spa_perfis ORDER BY id ASC
  `).all();
  console.log('spa_perfis encontrados: ' + perfis.length);

  // Stats
  const novos = [];
  const reutilizados = [];
  const invalidos = [];

  // Agrupa por CPF para dedupe
  const porCpf = new Map();
  for (const p of perfis) {
    const cpf = p.tipo_documento === 'cpf' ? cpfDigits(p.documento) : null;
    if (cpf && cpf.length === 11 && validarCpfMod11(cpf)) {
      if (!porCpf.has(cpf)) porCpf.set(cpf, p);
    } else if (!cpf) {
      // Sem CPF (passaporte/sem doc): cria por nome+telefone se houver
      novos.push({ ...p, _semCpf: true });
    } else {
      invalidos.push(p);
    }
  }

  // Para cada CPF único, verifica se já existe cliente
  for (const [cpf, p] of porCpf) {
    const existing = db.prepare('SELECT id FROM clientes WHERE cpf=?').get(cpf);
    if (existing) reutilizados.push({ ...p, _cpf: cpf, _existing: existing.id });
    else novos.push({ ...p, _cpf: cpf });
  }

  console.log(`  - com CPF válido (únicos)..: ${porCpf.size}`);
  console.log(`  - novos a criar............: ${novos.length}`);
  console.log(`  - já existentes em clientes: ${reutilizados.length}`);
  console.log(`  - documento inválido.......: ${invalidos.length}\n`);

  // Reservas e feedback potencialmente vinculáveis (sem cliente_id ainda)
  const reservasOrfas = db.prepare(`
    SELECT id, cliente, email, telefone FROM reservas
    WHERE cliente_id IS NULL
  `).all();
  const feedbackOrfaos = db.prepare(`
    SELECT id, nome, telefone, email FROM feedback
    WHERE cliente_id IS NULL
  `).all();
  console.log('Reservas sem cliente_id...: ' + reservasOrfas.length);
  console.log('Feedbacks sem cliente_id..: ' + feedbackOrfaos.length + '\n');

  // Aplica ou só simula
  if (!APPLY) {
    console.log('▶ Para aplicar de verdade: node scripts/migrar-clientes.js --apply\n');
    process.exit(0);
  }

  // ── APLICAÇÃO ────────────────────────────────────────────────────────────
  const tx = db.transaction(() => {
    let criados = 0, vinculadosPerfil = 0;
    const mapaPerfilCli = new Map(); // perfilId -> clienteId

    // 1) Cria clientes novos (a partir dos novos[])
    for (const n of novos) {
      const cpf = n._cpf || null;
      const nome = ((norm(n.nome) + ' ' + norm(n.sobrenome)).trim()) || 'Cliente sem nome';
      const cliId = inserirCliente({
        cpf, nome,
        email: norm(n.email) || null,
        telefone: norm(n.telefone) || null,
        data_nascimento: n.data_nascimento || null,
        locale_pref: n.idioma || 'pt-BR',
      });
      mapaPerfilCli.set(n.id, cliId);
      criados++;
    }
    // 2) Reutiliza clientes existentes
    for (const r of reutilizados) {
      mapaPerfilCli.set(r.id, r._existing);
    }
    // 3) Vincula spa_perfis -> clientes.cliente_id
    const upPerfil = db.prepare('UPDATE spa_perfis SET cliente_id=? WHERE id=?');
    for (const [perfilId, cliId] of mapaPerfilCli) {
      upPerfil.run(cliId, perfilId);
      vinculadosPerfil++;
    }
    // 4) Vincula reservas órfãs por CPF (futuro: telefone+email)
    let vinculadasReservas = 0;
    for (const r of reservasOrfas) {
      // Tenta match por (email||telefone) com algum cliente
      const eMail = lower(r.email);
      const tel   = norm(r.telefone).replace(/\D/g, '').slice(-9);
      if (!eMail && !tel) continue;
      const candidate = db.prepare(`
        SELECT id FROM clientes
        WHERE (? <> '' AND LOWER(email)=?)
           OR (? <> '' AND REPLACE(REPLACE(REPLACE(REPLACE(telefone,'(',''),')',''),' ',''),'-','') LIKE ?)
        LIMIT 1
      `).get(eMail, eMail, tel, '%' + tel);
      if (candidate) {
        db.prepare('UPDATE reservas SET cliente_id=? WHERE id=?').run(candidate.id, r.id);
        vinculadasReservas++;
      }
    }
    // 5) Feedback órfãos: idem (só se houver nome+email)
    let vinculadosFeedback = 0;
    for (const f of feedbackOrfaos) {
      const eMail = lower(f.email);
      const tel   = norm(f.telefone).replace(/\D/g, '').slice(-9);
      if (!eMail && !tel) continue;
      const candidate = db.prepare(`
        SELECT id FROM clientes
        WHERE (? <> '' AND LOWER(email)=?)
           OR (? <> '' AND REPLACE(REPLACE(REPLACE(REPLACE(telefone,'(',''),')',''),' ',''),'-','') LIKE ?)
        LIMIT 1
      `).get(eMail, eMail, tel, '%' + tel);
      if (candidate) {
        db.prepare('UPDATE feedback SET cliente_id=? WHERE id=?').run(candidate.id, f.id);
        vinculadosFeedback++;
      }
    }
    return { criados, vinculadosPerfil, vinculadasReservas, vinculadosFeedback };
  });

  const r = tx();
  console.log('═══════════════════════════════════════════════════════');
  console.log(' MIGRAÇÃO CONCLUÍDA');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  clientes criados.........: ' + r.criados);
  console.log('  spa_perfis vinculados....: ' + r.vinculadosPerfil);
  console.log('  reservas vinculadas......: ' + r.vinculadasReservas);
  console.log('  feedbacks vinculados.....: ' + r.vinculadosFeedback);
  console.log('═══════════════════════════════════════════════════════\n');
}

main().catch(e => { console.error('Erro:', e); process.exit(1); });
