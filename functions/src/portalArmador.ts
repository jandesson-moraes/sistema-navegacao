import * as admin from "firebase-admin";
import { randomBytes } from "node:crypto";
import { onRequest } from "firebase-functions/v2/https";

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();
const ADMIN_FIXOS = new Set([
  "jandessonmoraes@gmail.com",
  "escdecastrousinagen@gmail.com",
]);
const PAPEIS = new Set([
  "proprietario",
  "gestor",
  "financeiro",
  "atendimento",
  "consulta",
]);

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

function email(valor: unknown) {
  return texto(valor).toLowerCase();
}

function listaIds(valor: unknown) {
  return Array.from(
    new Set(
      (Array.isArray(valor) ? valor : [])
        .map(texto)
        .filter((id) => /^[A-Za-z0-9_-]{2,100}$/.test(id)),
    ),
  ).slice(0, 100);
}

async function autenticarAdministrador(req: {
  headers: { authorization?: string | string[] };
}) {
  const cabecalho = texto(req.headers.authorization);
  if (!cabecalho.startsWith("Bearer ")) throw new Error("UNAUTHENTICATED");
  const token = await admin.auth().verifyIdToken(cabecalho.slice(7).trim());
  const emailToken = email(token.email);
  if (ADMIN_FIXOS.has(emailToken)) return token;

  const funcionario = await db.collection("funcionarios").doc(emailToken).get();
  const dados = funcionario.data() || {};
  if (
    !funcionario.exists ||
    dados.ativo === false ||
    dados.excluido === true ||
    dados.tipo !== "admin"
  ) {
    throw new Error("FORBIDDEN");
  }
  return token;
}

async function validarEmbarcacoes(ids: string[]) {
  if (!ids.length) throw new Error("SELECIONE_AO_MENOS_UMA_EMBARCACAO");
  const snapshots = await db.getAll(
    ...ids.map((id) => db.collection("embarcacoes").doc(id)),
  );
  const inexistentes = snapshots.filter((item) => !item.exists).map((item) => item.id);
  if (inexistentes.length) {
    throw new Error(`EMBARCACAO_NAO_ENCONTRADA:${inexistentes.join(",")}`);
  }
}

async function usuarioPorEmail(emailUsuario: string, nome: string) {
  try {
    return { usuario: await admin.auth().getUserByEmail(emailUsuario), criado: false };
  } catch (erro: any) {
    if (erro?.code !== "auth/user-not-found") throw erro;
  }
  const usuario = await admin.auth().createUser({
    email: emailUsuario,
    displayName: nome,
    emailVerified: false,
    password: randomBytes(32).toString("base64url"),
  });
  return { usuario, criado: true };
}

async function auditar(params: {
  acao: string;
  adminUid: string;
  adminEmail: string;
  alvoUid?: string;
  alvoEmail?: string;
  embarcacaoIds?: string[];
}) {
  await db.collection("auditoria_portal_armador").add({
    ...params,
    criadoEm: admin.firestore.FieldValue.serverTimestamp(),
  });
}

export const gerenciarAcessoPortalArmador = onRequest(
  { region: "us-central1", cors: true, timeoutSeconds: 60 },
  async (req, res) => {
    try {
      if (req.method !== "POST") {
        res.status(405).json({ erro: "METHOD_NOT_ALLOWED" });
        return;
      }
      const administrador = await autenticarAdministrador(req);
      const corpo = (req.body || {}) as Record<string, unknown>;
      const acao = texto(corpo.acao);

      if (acao === "criar" || acao === "atualizar") {
        const nome = texto(corpo.nome);
        const emailUsuario = email(corpo.email);
        const papel = texto(corpo.papel || "proprietario");
        const embarcacaoIds = listaIds(corpo.embarcacaoIds);

        if (nome.length < 3 || !/^\S+@\S+\.\S+$/.test(emailUsuario)) {
          throw new Error("NOME_OU_EMAIL_INVALIDO");
        }
        if (!PAPEIS.has(papel)) throw new Error("PAPEL_INVALIDO");
        await validarEmbarcacoes(embarcacaoIds);

        const { usuario, criado } = await usuarioPorEmail(emailUsuario, nome);
        if (acao === "atualizar" && texto(corpo.uid) && texto(corpo.uid) !== usuario.uid) {
          throw new Error("UID_NAO_CORRESPONDE_AO_EMAIL");
        }

        const permissoesRecebidas = (corpo.permissoes || {}) as Record<string, unknown>;
        const permissoes = {
          dashboard: permissoesRecebidas.dashboard !== false,
          frota: permissoesRecebidas.frota !== false,
          programacao: permissoesRecebidas.programacao !== false,
          vendas: permissoesRecebidas.vendas !== false,
          financeiro: permissoesRecebidas.financeiro === true,
        };

        await db.collection("acessos_armadores").doc(usuario.uid).set(
          {
            uid: usuario.uid,
            nome,
            email: emailUsuario,
            papel,
            embarcacaoIds,
            permissoes,
            ativo: corpo.ativo !== false,
            ...(criado
              ? { criadoEm: admin.firestore.FieldValue.serverTimestamp() }
              : {}),
            atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
            atualizadoPorUid: administrador.uid,
            atualizadoPorEmail: email(administrador.email),
          },
          { merge: true },
        );

        const linkDefinirSenha = criado
          ? await admin.auth().generatePasswordResetLink(emailUsuario)
          : "";
        await auditar({
          acao,
          adminUid: administrador.uid,
          adminEmail: email(administrador.email),
          alvoUid: usuario.uid,
          alvoEmail: emailUsuario,
          embarcacaoIds,
        });
        res.status(200).json({
          ok: true,
          uid: usuario.uid,
          usuarioCriado: criado,
          linkDefinirSenha,
        });
        return;
      }

      if (acao === "desativar" || acao === "ativar") {
        const uid = texto(corpo.uid);
        if (!uid) throw new Error("UID_OBRIGATORIO");
        const ref = db.collection("acessos_armadores").doc(uid);
        const snapshot = await ref.get();
        if (!snapshot.exists) throw new Error("ACESSO_NAO_ENCONTRADO");
        await ref.set(
          {
            ativo: acao === "ativar",
            atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
            atualizadoPorUid: administrador.uid,
          },
          { merge: true },
        );
        await auditar({
          acao,
          adminUid: administrador.uid,
          adminEmail: email(administrador.email),
          alvoUid: uid,
          alvoEmail: email(snapshot.data()?.email),
        });
        res.status(200).json({ ok: true });
        return;
      }

      if (acao === "redefinir_senha") {
        const emailUsuario = email(corpo.email);
        await admin.auth().getUserByEmail(emailUsuario);
        const linkDefinirSenha = await admin.auth().generatePasswordResetLink(emailUsuario);
        await auditar({
          acao,
          adminUid: administrador.uid,
          adminEmail: email(administrador.email),
          alvoEmail: emailUsuario,
        });
        res.status(200).json({ ok: true, linkDefinirSenha });
        return;
      }

      throw new Error("ACAO_INVALIDA");
    } catch (erro: any) {
      const codigo = texto(erro?.message || erro);
      console.error("Erro em gerenciarAcessoPortalArmador", codigo);
      const status = codigo === "UNAUTHENTICATED" ? 401 : codigo === "FORBIDDEN" ? 403 : 400;
      res.status(status).json({ erro: codigo || "ERRO_INTERNO" });
    }
  },
);
