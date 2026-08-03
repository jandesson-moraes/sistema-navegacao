import * as admin from "firebase-admin";
import {defineSecret} from "firebase-functions/params";
import {onRequest} from "firebase-functions/v2/https";

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();
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
  sellerUserId?: string;
  expiresAt?: admin.firestore.Timestamp;
};

type FeeDetail = {
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
  fee_details?: FeeDetail[];
  transaction_details?: {
    net_received_amount?: number;
  };
  date_created?: string;
  date_approved?: string;
};

export const consultarCheckoutSplitSandbox = onRequest(
  {
    region: REGIAO,
    cors: true,
    secrets: [sellerTestUserId],
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
      const testeId = texto(req.body?.testeId);

      if (barcoId !== BARCO_TESTE) {
        res.status(403).json({erro: "CONSULTA_RESTRITA_A_AGUIA_DOURADA"});
        return;
      }
      if (!/^PRO-[a-f0-9]{28}$/.test(testeId)) {
        res.status(400).json({erro: "TESTE_ID_INVALIDO"});
        return;
      }

      const [barcoSnap, conexaoSnap, testeSnap] = await Promise.all([
        db.collection("embarcacoes").doc(barcoId).get(),
        db.collection("mercado_pago_conexoes").doc(barcoId).get(),
        db.collection("testes_split_mercado_pago").doc(testeId).get(),
      ]);

      if (!barcoSnap.exists || !conexaoSnap.exists || !testeSnap.exists) {
        res.status(404).json({erro: "TESTE_OU_CONEXAO_NAO_ENCONTRADO"});
        return;
      }

      const financeiro = barcoSnap.data()?.financeiroMercadoPago || {};
      if (
        financeiro.contaConectada !== true ||
        financeiro.status !== "pendente" ||
        financeiro.vendaPassagemHabilitada === true
      ) {
        res.status(409).json({erro: "EMBARCACAO_FORA_DO_MODO_SEGURO_DE_TESTE"});
        return;
      }

      const teste = testeSnap.data() || {};
      if (texto(teste.barcoId) !== barcoId || teste.tipo !== "checkout_pro_split_sandbox") {
        res.status(403).json({erro: "TESTE_NAO_PERTENCE_A_EMBARCACAO"});
        return;
      }

      const conexao = conexaoSnap.data() as ConexaoMercadoPago;
      const accessToken = texto(conexao.accessToken);
      const sellerEsperado = texto(sellerTestUserId.value());

      if (!accessToken.startsWith("TEST-")) throw new Error("TOKEN_OAUTH_NAO_E_SANDBOX");
      if (!/^\d{6,20}$/.test(sellerEsperado)) {
        throw new Error("SELLER_TEST_USER_ID_NAO_CONFIGURADO");
      }
      if (texto(conexao.sellerUserId) !== sellerEsperado) {
        throw new Error("CONTA_OAUTH_NAO_E_SELLER_TEST_USER_AUTORIZADO");
      }
      if ((conexao.expiresAt?.toMillis() || 0) <= Date.now() + 5 * 60 * 1000) {
        throw new Error("TOKEN_SANDBOX_EXPIRADO_REFAZER_OAUTH");
      }

      const url = new URL("https://api.mercadopago.com/v1/payments/search");
      url.searchParams.set("external_reference", testeId);
      url.searchParams.set("sort", "date_created");
      url.searchParams.set("criteria", "desc");
      url.searchParams.set("limit", "10");

      const resposta = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      });
      const busca = (await resposta.json()) as Record<string, unknown>;

      if (!resposta.ok) {
        console.error("Falha ao consultar pagamento sandbox", resposta.status, busca);
        res.status(502).json({
          erro: "MERCADO_PAGO_REJEITOU_CONSULTA_SANDBOX",
          httpStatus: resposta.status,
        });
        return;
      }

      const resultados = Array.isArray(busca.results) ? busca.results as PagamentoMercadoPago[] : [];
      const pagamento = resultados.find((item) =>
        texto(item.external_reference) === testeId &&
        item.live_mode === false &&
        texto(item.collector_id) === sellerEsperado,
      );

      if (!pagamento) {
        const respostaPublica = {
          testeId,
          encontrado: false,
          status: "nao_encontrado",
          mensagem: "Nenhum pagamento sandbox foi criado para esta preferência.",
          ambiente: "sandbox",
        };

        await testeSnap.ref.set({
          ultimaConsulta: respostaPublica,
          consultadoPorUid: usuario.uid,
          consultadoEm: admin.firestore.FieldValue.serverTimestamp(),
          atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
        }, {merge: true});

        res.status(200).json(respostaPublica);
        return;
      }

      const taxas = Array.isArray(pagamento.fee_details) ? pagamento.fee_details : [];
      const taxaMarketplace = taxas
        .filter((taxa) => ["application_fee", "marketplace_fee"].includes(texto(taxa.type)))
        .reduce((total, taxa) => total + numero(taxa.amount), 0);
      const taxasMercadoPago = taxas
        .filter((taxa) => !["application_fee", "marketplace_fee"].includes(texto(taxa.type)))
        .reduce((total, taxa) => total + numero(taxa.amount), 0);

      const respostaPublica = {
        testeId,
        encontrado: true,
        pagamentoId: texto(pagamento.id),
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
      };

      await testeSnap.ref.set({
        status: `pagamento_${respostaPublica.status}`,
        pagamentoId: respostaPublica.pagamentoId,
        ultimaConsulta: respostaPublica,
        consultadoPorUid: usuario.uid,
        consultadoEm: admin.firestore.FieldValue.serverTimestamp(),
        atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});

      res.status(200).json(respostaPublica);
    } catch (erro) {
      const codigo = erro instanceof Error ? erro.message : "ERRO_INTERNO";
      console.error("Erro em consultarCheckoutSplitSandbox", codigo);
      const httpStatus = codigo === "UNAUTHENTICATED" ? 401 : codigo === "FORBIDDEN" ? 403 : 500;
      res.status(httpStatus).json({erro: codigo});
    }
  },
);
