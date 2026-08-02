import * as admin from "firebase-admin";
import {createHash} from "node:crypto";
import {defineSecret} from "firebase-functions/params";
import {onRequest} from "firebase-functions/v2/https";

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();
const clientId = defineSecret("MERCADO_PAGO_MARKETPLACE_CLIENT_ID");
const clientSecret = defineSecret("MERCADO_PAGO_MARKETPLACE_CLIENT_SECRET");

const REGIAO = "us-central1";
const BARCO_TESTE = "AGUIA_DOURADA";
const VALOR_TESTE = 1;
const TAXA_TESTE = 0.08;
const EMAILS_ADMIN = new Set([
  "jandessonmoraes@gmail.com",
  "escdecastrousinagen@gmail.com",
]);

function texto(valor: unknown) {
  return String(valor ?? "").trim();
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
  expiresAt?: admin.firestore.Timestamp;
  liveMode?: boolean;
  sellerUserId?: string;
};

async function obterTokenValido(barcoId: string) {
  const ref = db.collection("mercado_pago_conexoes").doc(barcoId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("CONTA_NAO_CONECTADA");

  const conexao = snap.data() as ConexaoMercadoPago;
  if (conexao.liveMode !== false) throw new Error("TESTE_EXIGE_CONTA_SELLER_TEST_USER");

  const expiraEm = conexao.expiresAt?.toMillis() || 0;
  if (texto(conexao.accessToken) && expiraEm > Date.now() + 7 * 24 * 60 * 60 * 1000) {
    return {accessToken: texto(conexao.accessToken), sellerUserId: texto(conexao.sellerUserId)};
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
  const token = await resposta.json() as Record<string, unknown>;
  if (!resposta.ok || !texto(token.access_token)) {
    console.error("Falha ao renovar OAuth de teste", resposta.status, texto(token.error));
    throw new Error("TOKEN_OAUTH_NAO_RENOVADO");
  }

  const expiresIn = Math.max(60, Number(token.expires_in) || 15552000);
  await ref.set({
    accessToken: texto(token.access_token),
    refreshToken: texto(token.refresh_token) || refreshToken,
    sellerUserId: texto(token.user_id) || texto(conexao.sellerUserId),
    scope: texto(token.scope),
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + expiresIn * 1000),
    atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
    renovadoEm: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});

  return {
    accessToken: texto(token.access_token),
    sellerUserId: texto(token.user_id) || texto(conexao.sellerUserId),
  };
}

export const gerarPixSplitTeste = onRequest(
  {
    region: REGIAO,
    cors: true,
    secrets: [clientId, clientSecret],
    timeoutSeconds: 60,
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({erro: "METHOD_NOT_ALLOWED"});
      return;
    }

    try {
      const usuario = await autenticarAdmin(req);
      const barcoId = texto(req.body?.embarcacaoId);
      const chaveCliente = texto(req.body?.chaveIdempotencia);

      if (barcoId !== BARCO_TESTE) {
        res.status(403).json({erro: "TESTE_RESTRITO_A_AGUIA_DOURADA"});
        return;
      }
      if (!/^[a-zA-Z0-9_-]{20,150}$/.test(chaveCliente)) {
        res.status(400).json({erro: "CHAVE_IDEMPOTENCIA_INVALIDA"});
        return;
      }

      const barcoSnap = await db.collection("embarcacoes").doc(barcoId).get();
      const financeiro = barcoSnap.data()?.financeiroMercadoPago || {};
      if (!barcoSnap.exists || financeiro.contaConectada !== true || financeiro.status !== "pendente") {
        res.status(409).json({erro: "EMBARCACAO_NAO_ESTA_PENDENTE_PARA_TESTE"});
        return;
      }
      if (financeiro.vendaPassagemHabilitada === true) {
        res.status(409).json({erro: "DESABILITE_A_VENDA_ANTES_DO_TESTE"});
        return;
      }

      const testeId = `SPLIT-${hash(`${usuario.uid}|${barcoId}|${chaveCliente}`).slice(0, 28)}`;
      const testeRef = db.collection("testes_split_mercado_pago").doc(testeId);
      const existente = await testeRef.get();
      if (existente.exists && texto(existente.data()?.pagamentoId)) {
        res.status(200).json(existente.data()?.respostaPublica);
        return;
      }

      await testeRef.set({
        testeId,
        barcoId,
        criadoPorUid: usuario.uid,
        criadoPorEmail: texto(usuario.email).toLowerCase(),
        ambiente: "teste",
        valor: VALOR_TESTE,
        applicationFee: TAXA_TESTE,
        status: "criando",
        criadoEm: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});

      const oauth = await obterTokenValido(barcoId);
      const resposta = await fetch("https://api.mercadopago.com/v1/payments", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${oauth.accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Idempotency-Key": testeId,
        },
        body: JSON.stringify({
          transaction_amount: VALOR_TESTE,
          application_fee: TAXA_TESTE,
          description: "TESTE CONTROLADO PIX SPLIT - NAO PAGAR",
          payment_method_id: "pix",
          external_reference: testeId,
          payer: {
            email: "test_user_br@testuser.com",
            first_name: "Teste",
            last_name: "Split",
            identification: {type: "CPF", number: "19119119100"},
          },
          metadata: {ambiente: "teste", barco_id: barcoId, nao_pagar: true},
        }),
      });
      const pagamento = await resposta.json() as Record<string, any>;

      if (!resposta.ok) {
        const detalhe = texto(pagamento.message || pagamento.error || pagamento.cause?.[0]?.description);
        await testeRef.set({
          status: "rejeitado_pela_api",
          httpStatus: resposta.status,
          erroCodigo: texto(pagamento.error),
          erroDetalhe: detalhe,
          atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
        }, {merge: true});
        res.status(422).json({
          erro: "MERCADO_PAGO_REJEITOU_TESTE",
          detalhe,
          httpStatus: resposta.status,
        });
        return;
      }

      const respostaPublica = {
        testeId,
        pagamentoId: texto(pagamento.id),
        status: texto(pagamento.status),
        statusDetalhe: texto(pagamento.status_detail),
        liveMode: pagamento.live_mode === true,
        valorTotal: VALOR_TESTE,
        applicationFee: TAXA_TESTE,
        valorPrevistoVendedorAntesTarifaMp: Number((VALOR_TESTE - TAXA_TESTE).toFixed(2)),
        sellerUserId: oauth.sellerUserId,
        aviso: "PIX criado somente para validar a API. NAO PAGAR.",
      };

      await testeRef.set({
        pagamentoId: texto(pagamento.id),
        status: texto(pagamento.status),
        statusDetalhe: texto(pagamento.status_detail),
        liveMode: pagamento.live_mode === true,
        feeDetails: Array.isArray(pagamento.fee_details) ? pagamento.fee_details : [],
        respostaPublica,
        atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});

      res.status(200).json(respostaPublica);
    } catch (erro) {
      const codigo = erro instanceof Error ? erro.message : "ERRO_INTERNO";
      console.error("Erro em gerarPixSplitTeste", codigo);
      res.status(codigo === "UNAUTHENTICATED" ? 401 : codigo === "FORBIDDEN" ? 403 : 500)
        .json({erro: codigo});
    }
  },
);
