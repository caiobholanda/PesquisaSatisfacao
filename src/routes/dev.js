import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getDb, listarMassagistas, listarTiposMassagem } from '../db.js';

const router = Router();
router.use(requireAuth);

// Helpers
const NOMES = ['Maria Silva','Pedro Santos','Ana Costa','João Oliveira','Carla Souza','Bruno Lima','Patrícia Mendes','Roberto Almeida','Juliana Pereira','Carlos Ferreira','Beatriz Rodrigues','Marcos Carvalho','Fernanda Lopes','André Cardoso','Camila Ribeiro'];
const APTOS = ['1203','805','1402','617','1015','2208','310','1718','909','504','2105','1601','407','1820','1306'];
const RATINGS = ['otimo','bom','regular','ruim'];
const TIPOS_CLIENTE = ['lazer','negocios','evento'];
const ORIGENS = ['hospede']; // apenas hóspedes geram pesquisas nos dados de demo

const COMENTARIOS_POS = [
  'Atendimento impecável, profissional super atenciosa e técnica excelente!',
  'Saí renovada, ambiente extremamente acolhedor. Voltarei com certeza.',
  'A massoterapeuta entendeu exatamente o que eu precisava. Recomendo!',
  'Experiência sensorial maravilhosa. Já marquei o próximo.',
  'Detalhes refinados em tudo — roupão, chá, aroma. Premium.',
];
const COMENTARIOS_NEG = [
  'Sala um pouco fria no início, demorou pra esquentar.',
  'Tive dificuldade com agendamento, recepção poderia ser mais ágil.',
  'O ambiente é bom mas senti que faltou comunicação durante o atendimento.',
  'Esperava mais do tratamento, achei que duraria um pouco mais.',
];
const COMENTARIOS_INST_POS = [
  'Instalações impecáveis, tudo muito limpo e perfumado.',
  'Decoração belíssima, dá vontade de ficar o dia inteiro.',
  'Roupão e toalhas de alta qualidade. Detalhes que fazem diferença.',
];
const COMENTARIOS_INST_NEG = [
  'O som vazava da sala ao lado, atrapalhou o relaxamento.',
  'Banheiro poderia ter mais amenidades.',
];
const RECOMENDA_QUAL = ['Amigas e família', 'Colegas de trabalho', 'Hóspedes do hotel', 'Casais', 'Quem busca relaxamento'];
const RECOMENDA_PORQUE = [
  'Profissionalismo e ambiente único na cidade',
  'Vale cada centavo, experiência completa',
  'A técnica é diferente do que se vê por aí',
  'Sentido único de luxo discreto',
  'Voltei renovado, energia diferente',
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function maybe(p) { return Math.random() < p; }
function dataPassada(diasAtras) {
  const d = new Date();
  d.setDate(d.getDate() - diasAtras);
  return d.toISOString().slice(0, 10);
}
function dataHoje() {
  return new Date().toISOString().slice(0, 10);
}
function nomeToEmail(nome) {
  return nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '.').replace(/\.+/g, '.').replace(/^\.|\.$/g, '') + '@example.com';
}

router.post('/seed-demo', (req, res) => {
  const db = getDb();
  const massagistas = listarMassagistas().filter(m => m.ativo);
  const tipos = listarTiposMassagem().filter(t => t.ativo);
  if (!massagistas.length || !tipos.length) {
    return res.status(400).json({ ok: false, error: 'Cadastre massoterapeutas e tipos antes de gerar dados de demo' });
  }

  let feedbacksInseridos = 0;

  db.transaction(() => {
    // 1. Limpa feedbacks anteriores
    db.prepare('DELETE FROM feedback').run();

    // 2. Insere 15 feedbacks com mix de notas
    // Distribuição planejada: 4 superpositivos, 4 positivos, 3 medianos, 2 negativos, 2 mistos
    const perfis = [
      // 4 superpositivos (todos Ótimo, recomenda)
      { svc: 'otimo', inst: 'otimo', rec: 'sim', comPos: true },
      { svc: 'otimo', inst: 'otimo', rec: 'sim', comPos: true },
      { svc: 'otimo', inst: 'otimo', rec: 'sim', comPos: true },
      { svc: 'otimo', inst: 'otimo', rec: 'sim', comPos: false },
      // 4 positivos (mix Ótimo/Bom)
      { svc: 'bom', inst: 'otimo', rec: 'sim', comPos: false },
      { svc: 'otimo', inst: 'bom', rec: 'sim', comPos: true },
      { svc: 'bom', inst: 'bom', rec: 'sim', comPos: false },
      { svc: 'otimo', inst: 'bom', rec: 'sim', comPos: false },
      // 3 medianos (Regular dominante, recomenda meio-meio)
      { svc: 'regular', inst: 'bom', rec: 'sim', comPos: false },
      { svc: 'bom', inst: 'regular', rec: null, comPos: false, comNeg: true },
      { svc: 'regular', inst: 'regular', rec: null, comPos: false, comNeg: true },
      // 2 negativos (Regular/Ruim, não recomenda)
      { svc: 'regular', inst: 'ruim', rec: 'nao', comPos: false, comNeg: true },
      { svc: 'ruim', inst: 'regular', rec: 'nao', comPos: false, comNeg: true },
      // 2 mistos (varios)
      { svc: 'otimo', inst: 'regular', rec: 'sim', comPos: false, comNeg: true },
      { svc: 'bom', inst: 'ruim', rec: null, comPos: false, comNeg: true },
    ];

    const stmt = db.prepare(`
      INSERT INTO feedback (
        nome, apto, email, telefone, data_tratamento, tratamento_realizado,
        nome_massoterapeuta, servicos_expectativa, servicos_explicacao,
        servicos_atitude, servicos_tecnica, servicos_comentario,
        instalacoes_conforto, instalacoes_organizacao, instalacoes_conveniencia,
        instalacoes_comentario, recomenda, recomenda_qual, recomenda_porque,
        tipo_cliente, origem, ip_address, user_agent, submitted_at
      ) VALUES (
        @nome, @apto, @email, @telefone, @data_tratamento, @tratamento_realizado,
        @nome_massoterapeuta, @servicos_expectativa, @servicos_explicacao,
        @servicos_atitude, @servicos_tecnica, @servicos_comentario,
        @instalacoes_conforto, @instalacoes_organizacao, @instalacoes_conveniencia,
        @instalacoes_comentario, @recomenda, @recomenda_qual, @recomenda_porque,
        @tipo_cliente, @origem, @ip_address, @user_agent, @submitted_at
      )
    `);

    perfis.forEach((perfil, i) => {
      const nome = NOMES[i];
      const apto = APTOS[i];
      const massagista = pick(massagistas);
      const tipo = pick(tipos);
      const diasAtras = Math.floor(Math.random() * 28) + 1;

      // Pequena variação dentro do perfil (não fica tudo idêntico)
      function variar(base) {
        // 70% mantém o base, 30% varia para vizinho
        if (maybe(0.7)) return base;
        const idx = RATINGS.indexOf(base);
        const viz = [Math.max(0, idx - 1), Math.min(3, idx + 1)].filter(j => j !== idx);
        return RATINGS[pick(viz)];
      }

      const data = {
        nome,
        apto,
        email: nomeToEmail(nome),
        telefone: '(85) 9' + Math.floor(1000 + Math.random() * 9000) + '-' + Math.floor(1000 + Math.random() * 9000),
        data_tratamento: dataPassada(diasAtras),
        tratamento_realizado: tipo.nome,
        nome_massoterapeuta: massagista.nome,
        servicos_expectativa: variar(perfil.svc),
        servicos_explicacao: variar(perfil.svc),
        servicos_atitude: variar(perfil.svc),
        servicos_tecnica: variar(perfil.svc),
        servicos_comentario: perfil.comPos ? pick(COMENTARIOS_POS) : (perfil.comNeg ? pick(COMENTARIOS_NEG) : null),
        instalacoes_conforto: variar(perfil.inst),
        instalacoes_organizacao: variar(perfil.inst),
        instalacoes_conveniencia: variar(perfil.inst),
        instalacoes_comentario: perfil.comPos ? pick(COMENTARIOS_INST_POS) : (perfil.comNeg ? pick(COMENTARIOS_INST_NEG) : null),
        recomenda: perfil.rec,
        recomenda_qual: perfil.rec === 'sim' ? pick(RECOMENDA_QUAL) : null,
        recomenda_porque: perfil.rec === 'sim' ? pick(RECOMENDA_PORQUE) : null,
        tipo_cliente: pick(TIPOS_CLIENTE),
        origem: pick(ORIGENS),
        ip_address: '127.0.0.1',
        user_agent: 'demo-seed',
        submitted_at: data => {
          const d = new Date();
          d.setDate(d.getDate() - diasAtras);
          d.setHours(Math.floor(Math.random() * 12) + 9, Math.floor(Math.random() * 60), 0, 0);
          return d.toISOString().slice(0, 19).replace('T', ' ');
        },
      };
      // Resolve submitted_at
      const d = new Date();
      d.setDate(d.getDate() - diasAtras);
      d.setHours(Math.floor(Math.random() * 12) + 9, Math.floor(Math.random() * 60), 0, 0);
      data.submitted_at = d.toISOString().slice(0, 19).replace('T', ' ');

      stmt.run(data);
      feedbacksInseridos++;
    });

  })();

  res.json({ ok: true, feedbacks: feedbacksInseridos });
});

export default router;
