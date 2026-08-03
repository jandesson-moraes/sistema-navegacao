import * as admin from "firebase-admin";
import { createHash } from "node:crypto";
import { defineSecret } from "firebase-functions/params";
import { onRequest } from "firebase-functions/v2/https";

if (!admin.apps.length) admin.initializeApp();

const URL_WEBHOOK_MARKETPLACE =
  "https://us-central1-sistema-navegacao.cloudfunctions.net/webhookMercadoPagoMarketplace";

const db = admin.firestore();
const sellerTestUserId = defineSecret("MERCADO_PAGO_SELLER_TEST_USER_ID");

const REGIAO = "us-central1";
const BARCO_TESTE = "AGUIA_DOURADA";
const VALOR_TESTE = 1;
const TAXA_MARKETPLACE_TESTE = 0.08;
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

async function autenticarAdmin(req: { headers: { authorization?: string } }) {
  const cabecalho = texto(req.headers.authorization);
  if (!cabecalho.startsWith("Bearer ")) throw new Error("UNAUTHENTICATED");

  const decoded = await admin.auth().verifyIdToken(cabecalho.slice(7).trim());
  const email = texto(decoded.email).toLowerCase();
  if (decoded.admin !== true && !EMAILS_ADMIN.has(email)) throw new Error("FORBIDDEN");
  return decoded;
}

type ConexaoMercadoPago = {
  accessToken?: string;
  sellerUserId?: string;
  expiresAt?: admin.firestore.Timestamp;
};

export const criarCheckoutProSplitSandbox = onRequest(
  {
    region: REGIAO,
    cors: true,
    secrets: [sellerTestUserId],
    timeoutSeconds: 60,
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ erro: "METHOD_NOT_ALLOWED" });
      return;
    }

    try {
      const usuario = await autenticarAdmin(req);
      const barcoId = texto(req.body?.embarcacaoId);
      const chaveCliente = texto(req.body?.chaveIdempotencia);

      if (barcoId !== BARCO_TESTE) {
        res.status(403).json({ erro: "TESTE_RESTRITO_A_AGUIA_DOURADA" });
        return;
      }
      if (!/^[a-zA-Z0-9_-]{20,150}$/.test(chaveCliente)) {
        res.status(400).json({ erro: "CHAVE_IDEMPOTENCIA_INVALIDA" });
        return;
      }

      const sellerEsperado = texto(sellerTestUserId.value());
      if (!/^\d{6,20}$/.test(sellerEsperado)) {
        throw new Error("SELLER_TEST_USER_ID_NAO_CONFIGURADO");
      }

      const [barcoSnap, conexaoSnap] = await Promise.all([
        db.collection("embarcacoes").doc(barcoId).get(),
        db.collection("mercado_pago_conexoes").doc(barcoId).get(),
      ]);

      const financeiro = barcoSnap.data()?.financeiroMercadoPago || {};
      if (
        !barcoSnap.exists ||
        financeiro.contaConectada !== true ||
        financeiro.status !== "pendente"
      ) {
        res.status(409).json({ erro: "EMBARCACAO_NAO_ESTA_PENDENTE_PARA_TESTE" });
        return;
      }
      if (financeiro.vendaPassagemHabilitada === true) {
        res.status(409).json({ erro: "DESABILITE_A_VENDA_ANTES_DO_TESTE" });
        return;
      }
      if (!conexaoSnap.exists) throw new Error("CONTA_NAO_CONECTADA");

      const conexao = conexaoSnap.data() as ConexaoMercadoPago;
      const accessToken = texto(conexao.accessToken);
      if (!accessToken.startsWith("TEST-")) throw new Error("TOKEN_OAUTH_NAO_E_SANDBOX");
      if (texto(conexao.sellerUserId) !== sellerEsperado) {
        throw new Error("CONTA_OAUTH_NAO_E_SELLER_TEST_USER_AUTORIZADO");
      }
      if ((conexao.expiresAt?.toMillis() || 0) <= Date.now() + 5 * 60 * 1000) {
        throw new Error("TOKEN_SANDBOX_EXPIRADO_REFAZER_OAUTH");
      }

      const testeId = `PRO-${hash(`${usuario.uid}|${barcoId}|${chaveCliente}`).slice(0, 28)}`;
      const testeRef = db.collection("testes_split_mercado_pago").doc(testeId);
      const existente = await testeRef.get();
      const respostaAnterior = existente.data()?.respostaPublica;
      if (existente.exists && respostaAnterior?.sandboxInitPoint) {
        res.status(200).json(respostaAnterior);
        return;
      }

      const resposta = await fetch("https://api.mercadopago.com/checkout/preferences", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Idempotency-Key": testeId,
        },
        body: JSON.stringify({
          items: [
            {
              id: testeId,
              title: "Teste controlado split Cadê Meu Barco",
              description: "Ambiente sandbox - sem dinheiro real",
              currency_id: "BRL",
              quantity: 1,
              unit_price: VALOR_TESTE,
            },
          ],
          marketplace_fee: TAXA_MARKETPLACE_TESTE,
          external_reference: testeId,
          notification_url: `${URL_WEBHOOK_MARKETPLACE}?barcoId=${encodeURIComponent(barcoId)}`,
          statement_descriptor: "CADE MEU BARCO",
          metadata: {
            ambiente: "sandbox",
            barco_id: barcoId,
            nao_usar_cartao_real: true,
          },
        }),
      });

      const preferencia = (await resposta.json()) as Record<string, unknown>;
      if (
        !resposta.ok ||
        !texto(preferencia.id) ||
        !texto(preferencia.sandbox_init_point)
      ) {
        const detalhe = texto(preferencia.message || preferencia.error);
        await testeRef.set(
          {
            testeId,
            barcoId,
            tipo: "checkout_pro_split_sandbox",
            status: "rejeitado_pela_api",
            httpStatus: resposta.status,
            erroDetalhe: detalhe,
            atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        res.status(422).json({
          erro: "MERCADO_PAGO_REJEITOU_PREFERENCIA_SANDBOX",
          detalhe,
          httpStatus: resposta.status,
        });
        return;
      }

      const respostaPublica = {
        testeId,
        preferenciaId: texto(preferencia.id),
        sandboxInitPoint: texto(preferencia.sandbox_init_point),
        valorTotal: VALOR_TESTE,
        marketplaceFee: TAXA_MARKETPLACE_TESTE,
        valorPrevistoVendedorAntesTarifaMp: Number(
          (VALOR_TESTE - TAXA_MARKETPLACE_TESTE).toFixed(2),
        ),
        sellerTestUserValidado: true,
        ambiente: "sandbox",
        aviso: "Use somente Buyer Test User e cartão oficial de teste.",
      };

      await testeRef.set(
        {
          testeId,
          barcoId,
          tipo: "checkout_pro_split_sandbox",
          preferenciaId: texto(preferencia.id),
          status: "preferencia_criada",
          valor: VALOR_TESTE,
          marketplaceFee: TAXA_MARKETPLACE_TESTE,
          criadoPorUid: usuario.uid,
          criadoPorEmail: texto(usuario.email).toLowerCase(),
          respostaPublica,
          criadoEm: admin.firestore.FieldValue.serverTimestamp(),
          atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      res.status(200).json(respostaPublica);
    } catch (erro) {
      const codigo = erro instanceof Error ? erro.message : "ERRO_INTERNO";
      console.error("Erro em criarCheckoutProSplitSandbox", codigo);
      const httpStatus =
        codigo === "UNAUTHENTICATED" ? 401 : codigo === "FORBIDDEN" ? 403 : 500;
      res.status(httpStatus).json({ erro: codigo });
    }
  },
);
