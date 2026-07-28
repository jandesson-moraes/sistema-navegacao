import * as admin from "firebase-admin";
import {onRequest} from "firebase-functions/v2/https";
import {rotasValidas} from "./cadastroPublicoEmbarcacoes";

const REGIAO = "us-central1";

function texto(valor: unknown, limite = 1500) {
  return String(valor ?? "").trim().slice(0, limite);
}

function digitos(valor: unknown) {
  return texto(valor, 30).replace(/\D/g, "");
}

function caixaAlta(valor: unknown, limite = 160) {
  return texto(valor, limite).toLocaleUpperCase("pt-BR");
}

function cors(res: any) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
}

function plano(valor: unknown) {
  const normalizado = texto(valor, 30).toLowerCase();
  if (normalizado === "tempo_real") return "tempo_real";
  if (normalizado === "vitrine") return "vitrine";
  return "basico";
}

function contatosValidos(valor: unknown) {
  if (!Array.isArray(valor)) return [];
  return valor.slice(0, 3).map((item, indice) => {
    const contato = (item || {}) as Record<string, unknown>;
    return {
      id: `contato_${indice + 1}`,
      nome: caixaAlta(contato.nome, 120),
      numero: digitos(contato.numero),
      mensagem: texto(contato.mensagem, 600),
      ativo: contato.ativo !== false,
    };
  }).filter((item) => item.numero.length >= 10);
}

async function validarLink(token: string, telefone: string) {
  if (token.length < 32 || telefone.length < 10) return null;
  const banco = admin.firestore();
  const linkRef = banco.collection("links_edicao_embarcacoes").doc(token);
  const link = await linkRef.get();
  if (!link.exists || link.data()?.ativo !== true) return null;
  const telefoneEsperado = digitos(link.data()?.telefone);
  if (
    !telefoneEsperado ||
    telefoneEsperado.slice(-8) !== telefone.slice(-8)
  ) return null;
  const expiraEm = link.data()?.expiraEm?.toMillis?.() || 0;
  if (expiraEm && expiraEm < Date.now()) return null;
  return {linkRef, barcoId: texto(link.data()?.barcoId, 70)};
}

export const consultarEdicaoPublicaEmbarcacao = onRequest(
  {region: REGIAO, cors: false, maxInstances: 20},
  async (req, res) => {
    cors(res);
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({erro: "Método não permitido."});
      return;
    }
    const token = texto(req.body?.token, 180);
    const telefone = digitos(req.body?.telefone);
    const validacao = await validarLink(token, telefone);
    if (!validacao) {
      res.status(403).json({erro: "Link ou WhatsApp inválido."});
      return;
    }
    const barco = await admin.firestore()
      .collection("embarcacoes").doc(validacao.barcoId).get();
    if (!barco.exists) {
      res.status(404).json({erro: "Embarcação não encontrada."});
      return;
    }
    const dados = barco.data() || {};
    res.json({
      sucesso: true,
      embarcacao: {
        id: barco.id,
        nome: dados.nome || "",
        tipoBarco: dados.tipoBarco || dados.tipo || "",
        planoId: plano(dados.planoId),
        descricao: dados.descricao || "",
        fotos: Array.isArray(dados.fotos) ? dados.fotos : [],
        contatosWhatsApp: Array.isArray(dados.contatosWhatsApp) ?
          dados.contatosWhatsApp : [],
        instagramBarco: dados.instagramBarco || "",
        facebookBarco: dados.facebookBarco || "",
        siteBarco: dados.siteBarco || "",
        rotas: Array.isArray(dados.rotasCadastro) ? dados.rotasCadastro : [],
        statusInstalacaoGps: dados.statusInstalacaoGps || "",
        observacoesInstalacaoGps: dados.observacoesInstalacaoGps || "",
      },
    });
  },
);

export const solicitarAlteracaoPublicaEmbarcacao = onRequest(
  {region: REGIAO, cors: false, maxInstances: 20},
  async (req, res) => {
    cors(res);
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({erro: "Método não permitido."});
      return;
    }
    const token = texto(req.body?.token, 180);
    const telefone = digitos(req.body?.telefone);
    const validacao = await validarLink(token, telefone);
    if (!validacao) {
      res.status(403).json({erro: "Link ou WhatsApp inválido."});
      return;
    }
    const dados = (req.body?.dados || {}) as Record<string, unknown>;
    const banco = admin.firestore();
    const barco = await banco.collection("embarcacoes")
      .doc(validacao.barcoId).get();
    if (!barco.exists) {
      res.status(404).json({erro: "Embarcação não encontrada."});
      return;
    }
    const planoAtual = plano(barco.data()?.planoId);
    const fotos = Array.isArray(dados.fotos) ?
      dados.fotos.map((item) => texto(item, 1000)).filter(Boolean).slice(0, 5) :
      [];
    const alteracoes: Record<string, unknown> = {
      nome: caixaAlta(dados.nome, 120),
      tipoBarco: caixaAlta(dados.tipoBarco, 80),
      descricao: texto(dados.descricao, 1500),
      fotos,
      rotasCadastro: rotasValidas(dados.rotas),
    };
    if (planoAtual !== "basico") {
      alteracoes.contatosWhatsApp = contatosValidos(dados.contatosWhatsApp)
        .slice(0, planoAtual === "tempo_real" ? 3 : 1);
      alteracoes.instagramBarco = texto(dados.instagramBarco, 300);
      alteracoes.facebookBarco = texto(dados.facebookBarco, 300);
      alteracoes.siteBarco = texto(dados.siteBarco, 300);
    }
    if (planoAtual === "tempo_real") {
      alteracoes.observacoesInstalacaoGps =
        texto(dados.observacoesInstalacaoGps, 1200);
    }
    const solicitacao = banco.collection(
      "solicitacoes_alteracao_embarcacoes",
    ).doc();
    await solicitacao.set({
      barcoId: barco.id,
      planoId: planoAtual,
      telefoneConfirmado: telefone,
      dadosAnteriores: barco.data(),
      alteracoesSolicitadas: alteracoes,
      status: "aguardando_analise",
      criadoEm: admin.firestore.FieldValue.serverTimestamp(),
      atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
    });
    await validacao.linkRef.set({
      ultimoUsoEm: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});
    res.status(201).json({
      sucesso: true,
      solicitacaoId: solicitacao.id,
      mensagem: "Alterações enviadas para análise.",
    });
  },
);
