import * as admin from "firebase-admin";
import { createHash, randomBytes } from "node:crypto";
import { defineSecret } from "firebase-functions/params";
import { onRequest } from "firebase-functions/v2/https";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const clientId = defineSecret("MERCADO_PAGO_MARKETPLACE_CLIENT_ID");
const clientSecret = defineSecret("MERCADO_PAGO_MARKETPLACE_CLIENT_SECRET");

const REGIAO = "us-central1";
const PROJETO_ID = "sistema-navegacao";
const REDIRECT_URI = `https://${REGIAO}-${PROJETO_ID}.cloudfunctions.net/mercadoPagoOAuthCallback`;
const TEMPO_STATE_MS = 10 * 60 * 1000;
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

function responderHtml(
  res: { status: (codigo: number) => { send: (html: string) => void } },
  codigo: number,
  titulo: string,
  mensagem: string,
) {
  const escapar = (valor: string) =>
    valor
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");

  res.status(codigo).send(`<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${escapar(titulo)}</title></head>
<body style="font-family:system-ui;max-width:680px;margin:64px auto;padding:24px;color:#10233f">
<h1>${escapar(titulo)}</h1><p>${escapar(mensagem)}</p>
<p>Você já pode fechar esta janela.</p></body></html>`);
}

async function autenticarAdmin(req: { headers: { authorization?: string } }) {
  const cabecalho = texto(req.headers.authorization);
  if (!cabecalho.startsWith("Bearer ")) throw new Error("UNAUTHENTICATED");

  const decoded = await admin.auth().verifyIdToken(cabecalho.slice(7).trim());
  const email = texto(decoded.email).toLowerCase();
  if (decoded.admin !== true && !EMAILS_ADMIN.has(email)) {
    throw new Error("FORBIDDEN");
  }
  return decoded;
}

export const criarLinkOAuthMercadoPago = onRequest(
  { region: REGIAO, cors: true, secrets: [clientId] },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ erro: "METHOD_NOT_ALLOWED" });
      return;
    }

    try {
      const usuario = await autenticarAdmin(req);
      const embarcacaoId = texto(req.body?.embarcacaoId);
      if (!embarcacaoId || embarcacaoId.length > 160) {
        res.status(400).json({ erro: "EMBARCACAO_INVALIDA" });
        return;
      }

      const embarcacaoRef = db.collection("embarcacoes").doc(embarcacaoId);
      const embarcacao = await embarcacaoRef.get();
      if (!embarcacao.exists) {
        res.status(404).json({ erro: "EMBARCACAO_NAO_ENCONTRADA" });
        return;
      }

      const state = randomBytes(32).toString("base64url");
      const stateHash = hash(state);
      const agora = Date.now();
      await db
        .collection("mercado_pago_oauth_states")
        .doc(stateHash)
        .set({
          stateHash,
          embarcacaoId,
          criadoPorUid: usuario.uid,
          criadoPorEmail: texto(usuario.email).toLowerCase(),
          criadoEm: admin.firestore.FieldValue.serverTimestamp(),
          expiraEm: admin.firestore.Timestamp.fromMillis(agora + TEMPO_STATE_MS),
          usado: false,
        });

      const params = new URLSearchParams({
        client_id: clientId.value(),
        response_type: "code",
        platform_id: "mp",
        state,
        redirect_uri: REDIRECT_URI,
      });
      const link = `https://auth.mercadopago.com/authorization?${params}`;

      await embarcacaoRef.set(
        {
          financeiroMercadoPago: {
            gateway: "mercado_pago",
            modelo: "checkout_transparente_split_1a1",
            status: "link_gerado",
            contaConectada: false,
            ultimoLinkGeradoEm: admin.firestore.FieldValue.serverTimestamp(),
            atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
          },
        },
        { merge: true },
      );

      res.status(200).json({ link, expiraEmMs: agora + TEMPO_STATE_MS });
    } catch (erro) {
      const codigo = erro instanceof Error ? erro.message : "ERRO_INTERNO";
      res
        .status(codigo === "UNAUTHENTICATED" ? 401 : codigo === "FORBIDDEN" ? 403 : 500)
        .json({ erro: codigo });
    }
  },
);

export const mercadoPagoOAuthCallback = onRequest(
  { region: REGIAO, secrets: [clientId, clientSecret] },
  async (req, res) => {
    if (req.method !== "GET") {
      responderHtml(
        res,
        405,
        "Método não permitido",
        "Use o link de autorização gerado pelo painel.",
      );
      return;
    }

    const code = texto(req.query.code);
    const state = texto(req.query.state);
    if (!code || !state) {
      responderHtml(
        res,
        400,
        "Conexão não concluída",
        "O Mercado Pago não devolveu os dados esperados.",
      );
      return;
    }

    const stateRef = db.collection("mercado_pago_oauth_states").doc(hash(state));
    try {
      const embarcacaoId = await db.runTransaction(async (tx) => {
        const snap = await tx.get(stateRef);
        if (!snap.exists) throw new Error("STATE_INVALIDO");
        const dados = snap.data() || {};
        const expiraEm = dados.expiraEm as admin.firestore.Timestamp | undefined;
        if (dados.usado === true) throw new Error("STATE_UTILIZADO");
        if (!expiraEm || expiraEm.toMillis() < Date.now())
          throw new Error("STATE_EXPIRADO");
        tx.update(stateRef, {
          usado: true,
          usadoEm: admin.firestore.FieldValue.serverTimestamp(),
        });
        return texto(dados.embarcacaoId);
      });

      const resposta = await fetch("https://api.mercadopago.com/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId.value(),
          client_secret: clientSecret.value(),
          grant_type: "authorization_code",
          code,
          redirect_uri: REDIRECT_URI,
          test_token: embarcacaoId === "AGUIA_DOURADA" ? "true" : "false",
        }),
      });
      const token = (await resposta.json()) as Record<string, unknown>;
      if (!resposta.ok || !texto(token.access_token) || !texto(token.refresh_token)) {
        console.error("Falha OAuth Mercado Pago", resposta.status, token);
        throw new Error("TOKEN_NAO_GERADO");
      }

      const expiresIn = Math.max(60, Number(token.expires_in) || 15552000);
      const agora = Date.now();
      await db
        .collection("mercado_pago_conexoes")
        .doc(embarcacaoId)
        .set(
          {
            embarcacaoId,
            accessToken: texto(token.access_token),
            refreshToken: texto(token.refresh_token),
            publicKey: texto(token.public_key),
            sellerUserId: texto(token.user_id),
            scope: texto(token.scope),
            liveMode: token.live_mode === true,
            expiresAt: admin.firestore.Timestamp.fromMillis(agora + expiresIn * 1000),
            conectadoEm: admin.firestore.FieldValue.serverTimestamp(),
            atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );

      await db
        .collection("embarcacoes")
        .doc(embarcacaoId)
        .set(
          {
            financeiroMercadoPago: {
              gateway: "mercado_pago",
              modelo: "checkout_transparente_split_1a1",
              status: "pendente",
              contaConectada: true,
              vendedorMercadoPagoId: texto(token.user_id),
              conectadoEm: admin.firestore.FieldValue.serverTimestamp(),
              atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
            },
          },
          { merge: true },
        );

      responderHtml(
        res,
        200,
        "Conta conectada",
        "A conta Mercado Pago foi conectada à embarcação e aguarda conferência.",
      );
    } catch (erro) {
      console.error("Erro no callback OAuth Mercado Pago", erro);
      responderHtml(
        res,
        400,
        "Conexão não concluída",
        "O link é inválido, expirou ou já foi utilizado. Gere um novo link no painel.",
      );
    }
  },
);
