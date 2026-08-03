import * as admin from "firebase-admin";
import {createHash} from "node:crypto";
import {defineSecret} from "firebase-functions/params";
import {onRequest} from "firebase-functions/v2/https";

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();
const clientId = defineSecret("MERCADO_PAGO_MARKETPLACE_CLIENT_ID");
const clientSecret = defineSecret("MERCADO_PAGO_MARKETPLACE_CLIENT_SECRET");
const sellerTestUserId = defineSecret("MERCADO_PAGO_SELLER_TEST_USER_ID");

const REGIAO = "us-central1";
const BARCO_TESTE = "AGUIA_DOURADA";
const EMAILS_ADMIN = new Set([
  "jandessonmoraes@gmail.com",
  "escdecastrousinagen@gmail.com",
]);

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

function numero(valor: unknown) {
  const convertido = Number(valor);
  return Number.isFinite(convertido) ? convertido : 0;
}

function hash(valor: string) {
  return createHash("sha256").update(valor).digest("hex");
}

async function autenticarAdmin(req: {headers: {authorization?: string}}) {
  const cabecalho = texto(req.headers.authorization);
  if (!cabecalho.startsWith("Bearer ")) throw new Error("UNAUTHENTICATED");

  const decoded = await admin.auth().verifyIdToken(cabecalho.slice(7).trim());
  const email = texto(decoded.email).toLowerCase();
  if (decoded.admin !== true && !EMAILS_ADMIN.has(email)) throw new Error("FORBIDDEN");
  return decoded;
}

type ConexaoMercadoPago = {
  accessToken?: string;
  refreshToken?: string;
  sellerUserId?: string;
  expiresAt?: admin.firestore.Timestamp;
};

async function obterTokenSandboxValido(barcoId: string) {
  const ref = db.collection("mercado_pago_conexoes").doc(barcoId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("CONTA_NAO_CONECTADA");

  const conexao = snap.data() as ConexaoMercadoPago;
  const sellerEsperado = texto(sellerTestUserId.value());
  if (!/^\d{6,20}$/.test(sellerEsperado)) {
    throw new Error("SELLER_TEST_USER_ID_NAO_CONFIGURADO");
  }
  if (texto(conexao.sellerUserId) !== sellerEsperado) {
    throw new Error("CONTA_OAUTH_NAO_E_SELLER_TEST_USER_AUTORIZADO");
  }

  const tokenAtual = texto(conexao.accessToken);
  const expiraEm = conexao.expiresAt?.toMillis() || 0;
  if (tokenAtual.startsWith("TEST-") && expiraEm > Date.now() + 5 * 60 * 1000) {
    return {accessToken: tokenAtual, sellerUserId: sellerEsperado};
  }

  const refreshToken = texto(conexao.refreshToken);
  if (!refreshToken) throw new Error("REFRESH_TOKEN_AUSENTE");

  const resposta = await fetch("https://api.mercadopago.com/oauth/token", {
    method: "POST",
    headers: {"Content-Type": "application/x-www-form-urlencoded"},
    body: new URLSearchParams({
      client_id: clientId.value(),
      client_secret: clientSecret.value(),
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  const token = (await resposta.json()) as Record<string, unknown>;
  if (!resposta.ok || !texto(token.access_token).startsWith("TEST-")) {
    throw new Error("TOKEN_OAUTH_SANDBOX_NAO_RENOVADO");
  }

  const sellerRenovado = texto(token.user_id) || sellerEsperado;
  if (sellerRenovado !== sellerEsperado) {
    throw new Error("TOKEN_RENOVADO_PERTENCE_A_OUTRO_VENDEDOR");
  }

  const expiresIn = Math.max(60, numero(token.expires_in) || 15552000);
  await ref.set({
    accessToken: texto(token.access_token),
    refreshToken: texto(token.refresh_token) || refreshToken,
    sellerUserId: sellerRenovado,
    scope: texto(token.scope),
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + expiresIn * 1000),
    renovadoEm: admin.firestore.FieldValue.serverTimestamp(),
    atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});

  return {accessToken: texto(token.access_token), sellerUserId: sellerRenovado};
}

type PagamentoMercadoPago = {
  id?: string | number;
  status?: string;
  status_detail?: string;
  live_mode?: boolean;
  collector_id?: string | number;
  external_reference?: string;
  transaction_amount?: number;
  message?: string;
};

async function consultarPagamento(pagamentoId: string, accessToken: string) {
  const resposta = await fetch(
    `https://api.mercadopago.com/v1/payments/${encodeURIComponent(pagamentoId)}`,
    {headers: {Authorization: `Bearer ${accessToken}`, Accept: "application/json"}},
  );
  const pagamento = (await resposta.json()) as PagamentoMercadoPago;
  if (!resposta.ok) {
    console.error("Pagamento sandbox não consultado", resposta.status, texto(pagamento.message));
    throw new Error("PAGAMENTO_SANDBOX_NAO_CONSULTADO");
  }
  return pagamento;
}

export const gerenciarPagamentoMarketplaceSandbox = onRequest(
  {
    region: REGIAO,
    cors: true,
    secrets: [clientId, clientSecret, sellerTestUserId],
    timeoutSeconds: 60,
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({erro: "METHOD_NOT_ALLOWED"});
      return;
    }

    try {
      const usuario = await autenticarAdmin(req);
      const barcoId = texto(req.body?.embarcacaoId).toUpperCase();
      const testeId = texto(req.body?.testeId);
      const pagamentoId = texto(req.body?.pagamentoId);
      const acao = texto(req.body?.acao).toLowerCase();
      const confirmacao = texto(req.body?.confirmacao).toUpperCase();
      const chaveCliente = texto(req.body?.chaveIdempotencia);

      if (barcoId !== BARCO_TESTE) {
        res.status(403).json({erro: "OPERACAO_RESTRITA_A_AGUIA_DOURADA"});
        return;
      }
      if (!/^((PRO)|(SPLIT))-[a-f0-9]{28}$/.test(testeId)) {
        res.status(400).json({erro: "TESTE_ID_INVALIDO"});
        return;
      }
      if (!/^\d{5,30}$/.test(pagamentoId)) {
        res.status(400).json({erro: "PAGAMENTO_ID_INVALIDO"});
        return;
      }
      if (!/^[a-zA-Z0-9_-]{20,150}$/.test(chaveCliente)) {
        res.status(400).json({erro: "CHAVE_IDEMPOTENCIA_INVALIDA"});
        return;
      }
      if (!['cancelar', 'reembolsar'].includes(acao)) {
        res.status(400).json({erro: "ACAO_INVALIDA"});
        return;
      }

      const confirmacaoEsperada = acao === "cancelar" ? "CANCELAR TESTE" : "REEMBOLSAR TESTE";
      if (confirmacao !== confirmacaoEsperada) {
        res.status(400).json({erro: "CONFIRMACAO_INVALIDA"});
        return;
      }

      const [barcoSnap, testeSnap] = await Promise.all([
        db.collection("embarcacoes").doc(barcoId).get(),
        db.collection("testes_split_mercado_pago").doc(testeId).get(),
      ]);
      const financeiro = barcoSnap.data()?.financeiroMercadoPago || {};
      if (
        !barcoSnap.exists ||
        financeiro.contaConectada !== true ||
        financeiro.status !== "pendente" ||
        financeiro.vendaPassagemHabilitada === true
      ) {
        res.status(409).json({erro: "EMBARCACAO_FORA_DO_MODO_SEGURO_DE_TESTE"});
        return;
      }
      if (!testeSnap.exists || texto(testeSnap.data()?.barcoId) !== barcoId) {
        res.status(404).json({erro: "TESTE_NAO_LOCALIZADO"});
        return;
      }

      const {accessToken, sellerUserId} = await obterTokenSandboxValido(barcoId);
      const pagamento = await consultarPagamento(pagamentoId, accessToken);
      if (
        pagamento.live_mode !== false ||
        texto(pagamento.collector_id) !== sellerUserId ||
        texto(pagamento.external_reference) !== testeId
      ) {
        res.status(403).json({erro: "PAGAMENTO_NAO_PERTENCE_AO_TESTE_SANDBOX"});
        return;
      }

      const statusAntes = texto(pagamento.status).toLowerCase();
      if (acao === "cancelar" && !["pending", "in_process", "authorized"].includes(statusAntes)) {
        res.status(409).json({erro: "STATUS_NAO_PERMITE_CANCELAMENTO", statusAtual: statusAntes});
        return;
      }
      if (acao === "reembolsar" && statusAntes !== "approved") {
        res.status(409).json({erro: "STATUS_NAO_PERMITE_REEMBOLSO", statusAtual: statusAntes});
        return;
      }

      const operacaoId = `OP-${hash(`${usuario.uid}|${acao}|${pagamentoId}|${chaveCliente}`).slice(0, 40)}`;
      const operacaoRef = db.collection("mercado_pago_operacoes_financeiras").doc(operacaoId);
      const operacaoExistente = await operacaoRef.get();
      if (operacaoExistente.exists && operacaoExistente.data()?.respostaPublica) {
        res.status(200).json(operacaoExistente.data()?.respostaPublica);
        return;
      }

      const url = acao === "cancelar" ?
        `https://api.mercadopago.com/v1/payments/${encodeURIComponent(pagamentoId)}` :
        `https://api.mercadopago.com/v1/payments/${encodeURIComponent(pagamentoId)}/refunds`;
      const resposta = await fetch(url, {
        method: acao === "cancelar" ? "PUT" : "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Idempotency-Key": operacaoId,
        },
        body: acao === "cancelar" ? JSON.stringify({status: "cancelled"}) : JSON.stringify({}),
      });
      const resultado = (await resposta.json()) as Record<string, unknown>;

      if (!resposta.ok) {
        await operacaoRef.set({
          operacaoId,
          barcoId,
          testeId,
          pagamentoId,
          acao,
          ambiente: "sandbox",
          status: "rejeitada_pela_api",
          httpStatus: resposta.status,
          erroCodigo: texto(resultado.error || resultado.code),
          criadoPorUid: usuario.uid,
          criadoPorEmail: texto(usuario.email).toLowerCase(),
          criadoEm: admin.firestore.FieldValue.serverTimestamp(),
        }, {merge: true});
        res.status(422).json({
          erro: "MERCADO_PAGO_REJEITOU_OPERACAO_SANDBOX",
          httpStatus: resposta.status,
          codigo: texto(resultado.error || resultado.code),
        });
        return;
      }

      const respostaPublica = {
        operacaoId,
        testeId,
        pagamentoId,
        acao,
        concluida: true,
        statusAntes,
        statusDepois: acao === "cancelar" ? texto(resultado.status) : "refunded",
        reembolsoId: acao === "reembolsar" ? texto(resultado.id) : "",
        valorReembolsado: acao === "reembolsar" ? numero(resultado.amount) : 0,
        ambiente: "sandbox",
      };

      const batch = db.batch();
      batch.set(operacaoRef, {
        ...respostaPublica,
        respostaPublica,
        status: "concluida",
        criadoPorUid: usuario.uid,
        criadoPorEmail: texto(usuario.email).toLowerCase(),
        criadoEm: admin.firestore.FieldValue.serverTimestamp(),
        atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});
      batch.set(testeSnap.ref, {
        status: acao === "cancelar" ? "pagamento_cancelled" : "pagamento_refunded",
        ultimaOperacaoFinanceira: respostaPublica,
        atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});
      await batch.commit();

      res.status(200).json(respostaPublica);
    } catch (erro) {
      const codigo = erro instanceof Error ? erro.message : "ERRO_INTERNO";
      console.error("Erro em gerenciarPagamentoMarketplaceSandbox", codigo);
      const httpStatus = codigo === "UNAUTHENTICATED" ? 401 : codigo === "FORBIDDEN" ? 403 : 500;
      res.status(httpStatus).json({erro: codigo});
    }
  },
);
