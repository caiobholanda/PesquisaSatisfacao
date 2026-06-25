import { Router } from 'express';
import { createHmac, createHash } from 'crypto';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Keyring HMAC para assinatura da prova de consentimento. Suporta
// rotacao de segredo: cada linha gravada carrega o key_id da chave
// usada; revalidacao busca o segredo correto pelo key_id.
//
// Em producao:
//   fly secrets set CONSENT_HMAC_SECRET=<32+ bytes random>
//   fly secrets set CONSENT_KEY_ID=k2-2026-12-01   (ao rotacionar)
//   fly secrets set CONSENT_HMAC_SECRETS_LEGACY='{"k1-2026-06-23":"<segredo antigo>"}'
// O segredo ativo (ATUAL) e usado para novas gravacoes. Chaves legadas
// continuam validas para revalidacao.
const _CONSENT_KEY_ID = process.env.CONSENT_KEY_ID || 'k1';
const _CONSENT_HMAC_SECRET_ATUAL = process.env.CONSENT_HMAC_SECRET || 'dev-fallback-NO-ROTATION-NO-AUDIT-VALUE';
const _ehProducao = process.env.NODE_ENV === 'production';
// Forca minima do segredo: 32 bytes de entropia. Aceita 32 bytes raw,
// 64 chars hex (= 32 bytes), 44 chars base64 (= 32 bytes). Heuristica:
// >= 32 chars cobre os 3 formatos com margem.
const _MIN_SECRET_LEN = 32;
function _segredoForte(s) {
  if (typeof s !== 'string' || s.length < _MIN_SECRET_LEN) return false;
  if (s.startsWith('dev-fallback')) return false;
  return true;
}
function _abortarBoot(motivo) {
  console.error('═══════════════════════════════════════════════════════════════');
  console.error('[consentimento] FATAL em producao: ' + motivo);
  console.error('  A prova de consentimento LGPD nao pode ser gravada sem');
  console.error('  segredo forte. Configure via:');
  console.error('    fly secrets set CONSENT_HMAC_SECRET=$(node -e "console.log(require(\\"crypto\\").randomBytes(32).toString(\\"hex\\"))")');
  console.error('    fly secrets set CONSENT_KEY_ID=k1-2026-06-23');
  console.error('═══════════════════════════════════════════════════════════════');
  process.exit(1);
}
// Fail-closed forte: em prod, secret ausente/curto/fallback aborta.
if (_ehProducao && !_segredoForte(_CONSENT_HMAC_SECRET_ATUAL)) {
  _abortarBoot('CONSENT_HMAC_SECRET ausente, fraco (<32 chars) ou fallback');
}
if (!_segredoForte(_CONSENT_HMAC_SECRET_ATUAL)) {
  console.warn('[consentimento] CONSENT_HMAC_SECRET fraco/ausente — usando para dev (NODE_ENV=' + (process.env.NODE_ENV || 'undefined') + ')');
}
const _CONSENT_KEYRING = new Map();
_CONSENT_KEYRING.set(_CONSENT_KEY_ID, _CONSENT_HMAC_SECRET_ATUAL);
if (process.env.CONSENT_HMAC_SECRETS_LEGACY) {
  let legacy;
  try { legacy = JSON.parse(process.env.CONSENT_HMAC_SECRETS_LEGACY); }
  catch (e) {
    // Em prod, JSON malformado deve abortar — nao queremos degradar
    // silenciosamente para "sem chaves legadas".
    if (_ehProducao) _abortarBoot('CONSENT_HMAC_SECRETS_LEGACY JSON invalido: ' + e.message);
    console.warn('[consentimento] CONSENT_HMAC_SECRETS_LEGACY JSON invalido — ignorado:', e.message);
  }
  if (legacy && typeof legacy === 'object') {
    for (const [kid, secret] of Object.entries(legacy)) {
      if (_ehProducao && !_segredoForte(secret)) {
        _abortarBoot('chave legada "' + kid + '" tem segredo fraco/ausente');
      }
      if (!_CONSENT_KEYRING.has(kid) && typeof secret === 'string' && secret.length > 0) {
        _CONSENT_KEYRING.set(kid, secret);
      }
    }
    console.info('[consentimento] keyring carregado com ' + _CONSENT_KEYRING.size + ' chaves (atual=' + _CONSENT_KEY_ID + ')');
  }
}
function _hmacProvaComKey(texto, keyId) {
  const secret = _CONSENT_KEYRING.get(keyId);
  if (!secret) return null;
  return createHmac('sha256', secret).update(texto, 'utf8').digest('hex');
}
function _hmacProva(texto) {
  return _hmacProvaComKey(texto, _CONSENT_KEY_ID);
}
// Revalidacao usa o key_id ESPECIFICO da linha. Sem isso, rotacao de
// segredo invalidaria provas antigas (marcando-as como 'adulterado'
// falsamente). Retorna null se key_id desconhecido (chave nao esta no
// keyring atual — provavelmente foi retirado sem migrar para LEGACY).
export function recalcularHmacConsentimento(texto, keyId) {
  return _hmacProvaComKey(String(texto || ''), keyId || _CONSENT_KEY_ID);
}
export function consentKeyIdAtual() { return _CONSENT_KEY_ID; }

// D19: selo composto serializa componentes em formato canonico explicito
// (NAO JSON.stringify — esse depende de impl preservar insertion order,
// fragil a refactoring futuro). Formato fixo com chaves em ordem ASCII,
// delimitador unico (\x1F = Unit Separator), valores escapados. Mudanca
// em qualquer componente quebra o selo. Versao 'v1' sela:
// alg, assinatura_hash, consentido_em, documento, reserva_id, texto.
export const CONSENT_ALG_ATUAL = 'hmac-sha256-composto-v1';
export function sha256Hex(s) {
  return createHash('sha256').update(String(s ?? ''), 'utf8').digest('hex');
}
// Lista FIXA E IMUTAVEL de campos do selo v1, em ordem ASCII. Adicionar
// campo = nova versao do alg (composto-v2). Reordenar quebra todas as
// provas existentes — proibido sem migracao.
const _SELO_COMPOSTO_V1_CAMPOS = Object.freeze([
  'alg',
  'assinatura_hash',
  'consentido_em',
  'documento',
  'reserva_id',
  'texto',
]);
function _escapeSelo(v) {
  // Escape minimal para preservar a fronteira do separador. Substitui
  // 0x1F (Unit Separator) e 0x1E (Record Separator) por sequencias
  // literais legiveis. Backslash duplicado para reversibilidade.
  return String(v ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\x1E/g, '\\x1E')
    .replace(/\x1F/g, '\\x1F');
}
// Normaliza reserva_id para representacao canonica: null/undefined/''/
// NaN/0/negativo todos sinalizam "anamnese solta" → string vazia. Apenas
// inteiros positivos viram a representacao numerica. Sem isso null !=
// '' geravam selos diferentes para semantica identica.
function _normReservaId(r) {
  if (r == null || r === '') return '';
  const n = Number(r);
  if (!Number.isFinite(n) || n < 1) return '';
  return String(Math.trunc(n));
}
function _serializarSeloComposto(c) {
  const valoresCanonicos = {
    alg: 'hmac-sha256-composto-v1',
    assinatura_hash: String(c.assinatura_hash ?? ''),
    consentido_em: String(c.consentido_em ?? ''),
    documento: String(c.documento ?? ''),
    reserva_id: _normReservaId(c.reserva_id),
    texto: String(c.texto ?? ''),
  };
  // Concatena chave=valor com \x1F entre pares, \x1E entre componentes.
  // Ordem garantida pela iteracao na lista frozen (nao depende de order
  // de chaves do objeto).
  return _SELO_COMPOSTO_V1_CAMPOS
    .map(k => k + '\x1F' + _escapeSelo(valoresCanonicos[k]))
    .join('\x1E');
}
export function selarComposto(componentes, keyId) {
  const seloRaw = _serializarSeloComposto(componentes);
  const hmac = _hmacProvaComKey(seloRaw, keyId || _CONSENT_KEY_ID);
  return hmac;
}
export function recalcularSeloComposto(componentes, keyId) {
  const seloRaw = _serializarSeloComposto(componentes);
  return _hmacProvaComKey(seloRaw, keyId || _CONSENT_KEY_ID);
}
import { buscarDocumentoToken, inserirSpaPerfilComLock, vincularDocumentoToken, getDb, quartoValido, isGranClass, telefoneValido } from '../db.js';
import { inserirRespostaPesquisa, buscarPesquisaPublicada } from '../qualidade.js';

const router = Router();

// Normaliza texto legal antes do hash: NFC + remove BOM + normaliza
// CRLF→LF + colapsa apenas espacos/tabs intra-linha (preserva \n entre
// paragrafos) + trim por linha + remove zero-width chars. Preserva
// estrutura juridica do texto enquanto neutraliza diferencas cosmeticas:
// NFD vs NFC (macOS), BOM em JSON, ZWSP/ZWNJ/ZWJ invisiveis.
function _normalizarTextoLegal(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .normalize('NFC')
    .replace(/^﻿/, '')
    .replace(/[​-‍﻿]/g, '')
    .replace(/[  ]/g, ' ')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(linha => linha.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Cache em memoria do texto canonico server-side por idioma. Carregado
// uma vez por idioma na primeira requisicao. Evita ler arquivo a cada
// POST. Invalidado se o servidor reiniciar (deploy publica novo JSON).
const _localesDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'locales');
const _textoCanonicoCache = new Map();
function _carregarTextoLegalCanonico(idioma) {
  const lang = (typeof idioma === 'string' && idioma.length <= 8) ? idioma : 'pt-BR';
  if (_textoCanonicoCache.has(lang)) return _textoCanonicoCache.get(lang);
  let texto = '';
  try {
    const buf = readFileSync(resolve(_localesDir, lang + '.json'), 'utf8');
    const j = JSON.parse(buf);
    texto = (j?.legal?.text && typeof j.legal.text === 'string') ? j.legal.text : '';
  } catch (e) {
    console.warn('[consentimento] falha ao carregar locale canonico', lang, e.message);
    if (lang !== 'pt-BR') {
      const fallback = _carregarTextoLegalCanonico('pt-BR');
      _textoCanonicoCache.set(lang, fallback);
      return fallback;
    }
  }
  _textoCanonicoCache.set(lang, texto);
  return texto;
}

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
  const localeSeguro = LOCALES_VALIDOS.includes(row.locale) ? row.locale : 'pt-BR';
  // Link de uso unico: se ja foi respondido por essa pessoa, retorna flag
  // e o locale para o frontend mostrar mensagem amigavel no idioma certo.
  // NAO retorna dados do hospede (nao e' modo leitura).
  if (row.ja_respondida) {
    return res.json({
      ok: false,
      ja_respondida: true,
      locale: localeSeguro,
    });
  }
  res.json({
    hospede_nome:     row.hospede_nome     || '',
    hospede_email:    row.hospede_email    || '',
    hospede_telefone: row.hospede_telefone || '',
    hospede_cpf:      row.hospede_cpf      || '',
    hospede_quarto:   row.hospede_quarto   || '',
    hospede_data_nascimento: row.hospede_data_nascimento || '',
    servico:          row.servico          || '',
    locale:           localeSeguro,
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
  // Link de uso unico: token e' OBRIGATORIO. Sem token, nao temos slot
  // pra travar a corrida — recusa antes de gravar qualquer coisa.
  if (!b.documento_token) {
    return res.status(400).json({ ok: false, error: 'token_obrigatorio' });
  }
  const _tokenRow = buscarDocumentoToken(b.documento_token);
  if (!_tokenRow) {
    return res.status(404).json({ ok: false, error: 'token_invalido' });
  }
  // Curto-circuito amigavel: se ja respondida, retorna 409 ANTES de
  // processar payload pesado (assinatura base64, HMAC, etc).
  if (_tokenRow.ja_respondida) {
    return res.status(409).json({ ok: false, error: 'ja_respondida' });
  }
  const reserva_id = _tokenRow.reserva_id;
  const _pessoaReserva = _tokenRow.pessoa === 2 ? 2 : 1;
  if (locale) vincularDocumentoToken(reserva_id, locale);

  try {
    const id = inserirSpaPerfilComLock({
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
      pessoa:                 _pessoaReserva,
      // D19: Selo composto HMAC-SHA256 sobre {texto, documento,
      // reserva_id, assinatura_hash, consentido_em}. Prova CONTEUDO +
      // AUTORIA num selo so — sem amarrar ao documento/assinatura, a
      // prova vale o texto mas nao prova quem consentiu.
      ...(() => {
        if (!b.consentimento_saude) return {};
        const agora = new Date().toISOString();
        const textoExibido = _normalizarTextoLegal(b.consentimento_saude_texto);
        if (!textoExibido) {
          return {
            consentimento_saude_versao: 'sem-texto-cliente',
            consentimento_saude_em: agora,
            consentimento_saude_key_id: _CONSENT_KEY_ID,
            consentimento_saude_alg: CONSENT_ALG_ATUAL,
          };
        }
        const truncadoExibido = textoExibido.length > 50_000 ? textoExibido.slice(0, 50_000) : textoExibido;
        const assinaturaHash = b.assinatura_data_url ? sha256Hex(b.assinatura_data_url) : '';
        const documentoNormalizado = String(b.documento || '').trim();
        // Selo composto: amarra texto+documento+reserva+assinatura+timestamp.
        const componentes = {
          texto: truncadoExibido,
          documento: documentoNormalizado,
          reserva_id: reserva_id || null,
          assinatura_hash: assinaturaHash,
          consentido_em: agora,
        };
        const hashComposto = selarComposto(componentes, _CONSENT_KEY_ID);

        // Cross-check canonico (mesmo idioma, sem fallback).
        let canonicoDivergente = 0;
        let canonicoComparado = null;
        let hashCanonico = null;
        try {
          const textoCanonRaw = _carregarTextoLegalCanonico(locale);
          if (textoCanonRaw && textoCanonRaw.length > 0) {
            const textoCanon = _normalizarTextoLegal(textoCanonRaw);
            const truncadoCanon = textoCanon.length > 50_000 ? textoCanon.slice(0, 50_000) : textoCanon;
            if (truncadoCanon) {
              canonicoComparado = 1;
              hashCanonico = _hmacProva(truncadoCanon);
              if (truncadoCanon !== truncadoExibido) {
                canonicoDivergente = 1;
                console.warn('[consentimento] cross-check divergente vs canonico (lang=' + locale + ')');
              }
            }
          }
        } catch (e) { console.warn('[consentimento] cross-check falhou', e?.message); }
        return {
          consentimento_saude_texto: truncadoExibido,
          consentimento_saude_hash: hashComposto,
          consentimento_saude_versao: hashComposto.slice(0, 16),
          consentimento_saude_em: agora,
          consentimento_saude_canonico_divergente: canonicoDivergente,
          consentimento_saude_canonico_comparado: canonicoComparado,
          consentimento_saude_hash_canonico: hashCanonico,
          consentimento_saude_key_id: _CONSENT_KEY_ID,
          consentimento_saude_alg: CONSENT_ALG_ATUAL,
          consentimento_saude_assinatura_hash: assinaturaHash || null,
        };
      })(),
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
      // Diferencia cliente1 vs cliente2 em reservas casal via app_origem.
      // Sem isso, o upsert por (pesquisa_id, reserva_id, app_origem) sobrescreve
      // a anamnese estruturada do parceiro quando o segundo submete.
      const _appOrigem = _pessoaReserva === 2 ? 'spa-anamnese-p2' : 'spa-anamnese';
      inserirRespostaPesquisa({
        pesquisa_slug: 'spa-anamnese-v1',
        app_origem: _appOrigem,
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
    // NOTA: amarracao spa_perfil <-> reserva (documento_perfil_id / _id2) ja
    // foi feita DENTRO da transacao em inserirSpaPerfilComLock — e' o proprio
    // UPDATE condicional que faz o gate de uso unico. Nao reaplicar aqui.
    res.json({
      ok: true, id,
      quarto: quartoLimpo || null,
      gran_class: quartoLimpo ? isGranClass(quartoLimpo) : false,
    });
  } catch (err) {
    // Trava de uso unico: corrida perdida (outro envio venceu) ou pre-check.
    if (err && err.message === 'ANAMNESE_JA_RESPONDIDA') {
      return res.status(409).json({ ok: false, error: 'ja_respondida' });
    }
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
