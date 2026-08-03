import * as admin from "firebase-admin";
import {createHash, createHmac, timingSafeEqual} from "node:crypto";
import {defineSecret} from "firebase-functions/params";
import {onRequest} from "firebase-functions/v2/https";

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();
const webhookSecret = defineSecret("MERCADO_PAGO_WEBHOOK_SECRET");
const clientId = defineSecret("MERCADO_PAGO_MARKETPLACE_CLIENT_ID");
const clientSecret = defineSecret("MERCADO_PAGO_MARKETPLACE_CLIENT_SECRET");
const sellerTestUserId = defineSecret("MERCADO_PAGO_SELLER_TEST_USER_ID");

const REGIAO = "us-central1";
const BARCO_TESTE = "AGUIA_DOURADA";
const TOLERANCIA_ASSINATURA_MS = 10 * 60 * 1000;

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

function valorCabecalho(valor: string | string[] | undefined) {
  return Array.isArray(valor) ? texto(valor[0]) : texto(valor);
}

function validarAssinatura(req: {
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, unknown>;
}) {
  const assinatura = valorCabecalho(req.headers["x-signature"]);
  const requestId = valorCabecalho(req.headers["x-request-id"]);
  const dataId = texto(req.query["data.id"]).toLowerCase();
  const segredo = texto(webhookSecret.value());

  if (!assinatura || !requestId || !dataId || !segredo) return false;

  const partes: Record<string, string> = {};
  assinatura.split(",").forEach((parte) => {
    const [chave, ...restante] = parte.trim().split("=");
    partes[chave] = restante.join("=");
  });
  const timestamp = texto(partes.ts);
  const assinaturaRecebida = texto(partes.v1).toLowerCase();

  if (!/^\d{10,13}$/.test(timestamp) || !/^[a-f0-9]{64}$/.test(assinaturaRecebida)) {
    return false;
  }

  const timestampNumero = Number(timestamp);
  const timestampMs = timestampNumero < 1_000_000_000_000 ? timestampNumero * 1000 : timestampNumero;
  if (Math.abs(Date.now() - timestampMs) > TOLERANCIA_ASSINATURA_MS) return false;

  const manifesto = `id:${dataId};request-id:${requestId};ts:${timestamp};`;
  const calculada = createHmac("sha256", segredo).update(manifesto).digest("hex");
  const recebidoBuffer = Buffer.from(assinaturaRecebida, "hex");
  const calculadoBuffer = Buffer.from(calculada, "hex");

  return recebidoBuffer.length === calculadoBuffer.length &&
    timingSafeEqual(recebidoBuffer, calculadoBuffer);
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

  const accessTokenAtual = texto(conexao.accessToken);
  const expiraEm = conexao.expiresAt?.toMillis() || 0;
  if (accessTokenAtual.startsWith("TEST-") && expiraEm > Date.now() + 5 * 60 * 1000) {
    return {accessToken: accessTokenAtual, sellerUserId: sellerEsperado};
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
    console.error("Falha ao renovar OAuth sandbox", resposta.status, texto(token.error));
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

type TaxaPagamento = {
  type?: string;
  amount?: number;
};

type PagamentoMercadoPago = {
  id?: string | number;
  status?: string;
  status_detail?: string;
  live_mode?: boolean;
  collector_id?: string | number;
  external_reference?: string;
  transaction_amount?: number;
  fee_details?: TaxaPagamento[];
  transaction_details?: {net_received_amount?: number};
  date_created?: string;
  date_approved?: string;
};

export const webhookMercadoPagoMarketplace = onRequest(
  {
    region: REGIAO,
    cors: false,
    secrets: [webhookSecret, clientId, clientSecret, sellerTestUserId],
    timeoutSeconds: 60,
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("METHOD_NOT_ALLOWED");
      return;
    }

    if (!validarAssinatura(req as never)) {
      console.warn("Webhook Marketplace recusado: assinatura inválida");
      res.status(401).send("INVALID_SIGNATURE");
      return;
    }

    try {
      const barcoId = texto(req.query.barcoId).toUpperCase();
      const pagamentoId = texto(req.query["data.id"]);
      const tipo = texto(req.query.type || (req.body as Record<string, unknown>)?.type);

      if (barcoId !== BARCO_TESTE) {
        res.status(403).send("BARCO_NAO_AUTORIZADO_NO_SANDBOX");
        return;
      }
      if (tipo && tipo !== "payment") {
        res.status(200).send("EVENTO_IGNORADO");
        return;
      }

      const barcoSnap = await db.collection("embarcacoes").doc(barcoId).get();
      const financeiro = barcoSnap.data()?.financeiroMercadoPago || {};
      if (
        !barcoSnap.exists ||
        financeiro.contaConectada !== true ||
        financeiro.status !== "pendente" ||
        financeiro.vendaPassagemHabilitada === true
      ) {
        res.status(409).send("EMBARCACAO_FORA_DO_MODO_SEGURO_DE_TESTE");
        return;
      }

      const {accessToken, sellerUserId} = await obterTokenSandboxValido(barcoId);
      const resposta = await fetch(
        `https://api.mercadopago.com/v1/payments/${encodeURIComponent(pagamentoId)}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
          },
        },
      );
      const pagamento = (await resposta.json()) as PagamentoMercadoPago & Record<string, unknown>;

      if (!resposta.ok) {
        console.error("Pagamento sandbox não consultado", resposta.status, texto(pagamento.message));
        res.status(502).send("PAGAMENTO_NAO_CONSULTADO");
        return;
      }

      const testeId = texto(pagamento.external_reference);
      if (!/^((PRO)|(SPLIT))-[a-f0-9]{28}$/.test(testeId)) {
        res.status(200).send("REFERENCIA_FORA_DOS_TESTES_CONTROLADOS");
        return;
      }
      if (pagamento.live_mode !== false || texto(pagamento.collector_id) !== sellerUserId) {
        res.status(403).send("PAGAMENTO_NAO_PERTENCE_AO_SELLER_SANDBOX");
        return;
      }

      const testeRef = db.collection("testes_split_mercado_pago").doc(testeId);
      const testeSnap = await testeRef.get();
      if (!testeSnap.exists || texto(testeSnap.data()?.barcoId) !== barcoId) {
        res.status(404).send("TESTE_NAO_LOCALIZADO");
        return;
      }

      const taxas = Array.isArray(pagamento.fee_details) ? pagamento.fee_details : [];
      const taxaMarketplace = taxas
        .filter((taxa) => ["application_fee", "marketplace_fee"].includes(texto(taxa.type)))
        .reduce((total, taxa) => total + numero(taxa.amount), 0);
      const taxasMercadoPago = taxas
        .filter((taxa) => !["application_fee", "marketplace_fee"].includes(texto(taxa.type)))
        .reduce((total, taxa) => total + numero(taxa.amount), 0);
      const eventoId = hash(`${pagamentoId}|${texto(pagamento.status)}|${texto(req.headers["x-request-id"])}`);

      const resultadoSeguro = {
        pagamentoId,
        status: texto(pagamento.status) || "desconhecido",
        statusDetalhe: texto(pagamento.status_detail),
        valorTotal: numero(pagamento.transaction_amount),
        taxaMarketplace: Number(taxaMarketplace.toFixed(2)),
        taxasMercadoPago: Number(taxasMercadoPago.toFixed(2)),
        valorLiquidoVendedor: Number(
          numero(pagamento.transaction_details?.net_received_amount).toFixed(2),
        ),
        criadoEm: texto(pagamento.date_created),
        aprovadoEm: texto(pagamento.date_approved),
        ambiente: "sandbox",
        assinaturaValidada: true,
      };

      const batch = db.batch();
      batch.set(testeRef, {
        status: `pagamento_${resultadoSeguro.status}`,
        pagamentoId,
        resultadoWebhook: resultadoSeguro,
        webhookRecebidoEm: admin.firestore.FieldValue.serverTimestamp(),
        atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});
      batch.set(db.collection("mercado_pago_webhook_eventos").doc(eventoId), {
        eventoId,
        barcoId,
        testeId,
        pagamentoId,
        status: resultadoSeguro.status,
        ambiente: "sandbox",
        processado: true,
        assinaturaValidada: true,
        criadoEm: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});
      await batch.commit();

      res.status(200).send("OK");
    } catch (erro) {
      const codigo = erro instanceof Error ? erro.message : "ERRO_INTERNO";
      console.error("Erro no webhook Mercado Pago Marketplace", codigo);
      res.status(500).send("ERRO_INTERNO");
    }
  },
);
