import * as admin from "firebase-admin";
import { defineSecret } from "firebase-functions/params";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

export const mercadoPagoMarketplaceClientId = defineSecret(
  "MERCADO_PAGO_MARKETPLACE_CLIENT_ID",
);
export const mercadoPagoMarketplaceClientSecret = defineSecret(
  "MERCADO_PAGO_MARKETPLACE_CLIENT_SECRET",
);

type ConexaoMercadoPago = {
  accessToken?: string;
  refreshToken?: string;
  sellerUserId?: string;
  liveMode?: boolean;
  expiresAt?: admin.firestore.Timestamp;
};

type TokenOAuth = Record<string, unknown> & {
  access_token?: string;
  refresh_token?: string;
  user_id?: string | number;
  expires_in?: string | number;
  scope?: string;
};

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

function numero(valor: unknown) {
  const resultado = Number(valor);
  return Number.isFinite(resultado) ? resultado : 0;
}

function tokenPareceProducao(token: string) {
  return token.startsWith("APP_USR-") && !token.startsWith("TEST-");
}

export type TokenMarketplaceVenda = {
  accessToken: string;
  sellerUserId: string;
  renovado: boolean;
};

/**
 * Retorna um token OAuth de produção pertencente à embarcação.
 *
 * Nunca use este helper no frontend e nunca devolva accessToken na resposta
 * de uma Cloud Function. A função chamadora também deve validar preço,
 * disponibilidade, prazo da viagem e feature flag antes de criar pagamento.
 */
async function obterTokenMarketplace({
  barcoId,
  exigirVendaLiberada,
}: {
  barcoId: string;
  exigirVendaLiberada: boolean;
}): Promise<TokenMarketplaceVenda> {
  const id = texto(barcoId);

  if (!id) throw new Error("EMBARCACAO_INVALIDA");

  const [barcoSnap, conexaoSnap] = await Promise.all([
    db.collection("embarcacoes").doc(id).get(),
    db.collection("mercado_pago_conexoes").doc(id).get(),
  ]);

  if (!barcoSnap.exists) throw new Error("EMBARCACAO_NAO_ENCONTRADA");
  if (!conexaoSnap.exists) throw new Error("CONTA_MERCADO_PAGO_NAO_CONECTADA");

  const financeiro = barcoSnap.data()?.financeiroMercadoPago || {};
  const conexao = conexaoSnap.data() as ConexaoMercadoPago;
  const sellerEsperado = texto(financeiro.vendedorMercadoPagoId);
  const sellerConectado = texto(conexao.sellerUserId);

  if (financeiro.contaConectada !== true) {
    throw new Error("CONTA_MERCADO_PAGO_NAO_CONECTADA");
  }

  if (
    exigirVendaLiberada &&
    (financeiro.status !== "ativo" ||
      financeiro.vendaPassagemHabilitada !== true)
  ) {
    throw new Error("EMBARCACAO_NAO_LIBERADA_PARA_VENDA");
  }

  if (!sellerEsperado || sellerConectado !== sellerEsperado) {
    throw new Error("CONTA_MERCADO_PAGO_DIVERGENTE");
  }

  if (conexao.liveMode !== true) {
    throw new Error("CONEXAO_MERCADO_PAGO_NAO_E_PRODUCAO");
  }

  const accessTokenAtual = texto(conexao.accessToken);
  const expiraEm = conexao.expiresAt?.toMillis() || 0;

  if (tokenPareceProducao(accessTokenAtual) && expiraEm > Date.now() + 5 * 60 * 1000) {
    return {
      accessToken: accessTokenAtual,
      sellerUserId: sellerConectado,
      renovado: false,
    };
  }

  const refreshToken = texto(conexao.refreshToken);

  if (!refreshToken) throw new Error("REFRESH_TOKEN_MERCADO_PAGO_AUSENTE");

  const resposta = await fetch("https://api.mercadopago.com/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      client_id: mercadoPagoMarketplaceClientId.value(),
      client_secret: mercadoPagoMarketplaceClientSecret.value(),
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  const token = (await resposta.json()) as TokenOAuth;
  const accessTokenRenovado = texto(token.access_token);
  const sellerRenovado = texto(token.user_id) || sellerConectado;

  if (!resposta.ok || !tokenPareceProducao(accessTokenRenovado)) {
    console.error(
      "Falha ao renovar OAuth Marketplace",
      resposta.status,
      texto(token.error),
    );
    throw new Error("TOKEN_MERCADO_PAGO_NAO_RENOVADO");
  }

  if (sellerRenovado !== sellerEsperado) {
    throw new Error("TOKEN_RENOVADO_PERTENCE_A_OUTRO_VENDEDOR");
  }

  const expiresIn = Math.max(60, numero(token.expires_in) || 15552000);

  await conexaoSnap.ref.set(
    {
      accessToken: accessTokenRenovado,
      refreshToken: texto(token.refresh_token) || refreshToken,
      sellerUserId: sellerRenovado,
      scope: texto(token.scope),
      liveMode: true,
      expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + expiresIn * 1000),
      renovadoEm: admin.firestore.FieldValue.serverTimestamp(),
      atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return {
    accessToken: accessTokenRenovado,
    sellerUserId: sellerRenovado,
    renovado: true,
  };
}

/** Usado somente antes de criar uma nova venda. */
export function obterTokenMarketplaceVenda(barcoId: string) {
  return obterTokenMarketplace({
    barcoId,
    exigirVendaLiberada: true,
  });
}

/**
 * Usado por webhook, consulta, cancelamento e reembolso de venda existente.
 * Não exige que novas vendas continuem habilitadas.
 */
export function obterTokenMarketplaceOperacao(barcoId: string) {
  return obterTokenMarketplace({
    barcoId,
    exigirVendaLiberada: false,
  });
}
