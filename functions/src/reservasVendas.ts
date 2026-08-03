import * as admin from "firebase-admin";
import { createHash } from "node:crypto";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const STATUS_NAO_OCUPAM = new Set([
  "CANCELADO",
  "CANCELADA",
  "REJEITADO",
  "REEMBOLSADO",
  "CONTESTADO",
]);

export type TipoVagaVenda = "rede" | "poltrona" | "suite";

export type CriarReservaVagasParams = {
  reservaId: string;
  vendaId: string;
  compradorUid: string;
  barcoId: string;
  gradeId: string;
  idViagem: string;
  tipoVaga: TipoVagaVenda;
  quantidade: number;
  capacidade: number;
  duracaoMinutos?: number;
};

export type ResultadoReservaVagas = {
  reservaId: string;
  status: "ativa" | "confirmada";
  reutilizada: boolean;
  expiraEm: admin.firestore.Timestamp | null;
  capacidade: number;
  ocupadas: number;
  reservadas: number;
  disponiveisDepoisDaReserva: number;
};

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

function inteiroPositivo(valor: unknown, campo: string) {
  const convertido = Number(valor);

  if (!Number.isInteger(convertido) || convertido <= 0) {
    throw new Error(`${campo}_INVALIDO`);
  }

  return convertido;
}

function chaveInventario(idViagem: string, tipoVaga: TipoVagaVenda) {
  return createHash("sha256")
    .update(`${idViagem}|${tipoVaga}`)
    .digest("hex");
}

function validarParametros(params: CriarReservaVagasParams) {
  const obrigatorios = [
    params.reservaId,
    params.vendaId,
    params.compradorUid,
    params.barcoId,
    params.gradeId,
    params.idViagem,
  ];

  if (obrigatorios.some((valor) => !texto(valor))) {
    throw new Error("DADOS_RESERVA_INCOMPLETOS");
  }

  if (!(["rede", "poltrona", "suite"] as string[]).includes(params.tipoVaga)) {
    throw new Error("TIPO_VAGA_INVALIDO");
  }
}

function passagemOcupaVaga(dados: admin.firestore.DocumentData, tipoVaga: TipoVagaVenda) {
  const status = texto(dados.status).toUpperCase();
  const tipo = texto(dados.tipoVaga).toLowerCase();

  return !STATUS_NAO_OCUPAM.has(status) && (!tipo || tipo === tipoVaga);
}

/**
 * Reserva vagas com uma trava transacional por viagem e acomodação.
 *
 * Este módulo não é uma Cloud Function pública. Ele deve ser chamado somente
 * depois de autenticar o comprador, localizar a grade oficial e obter a
 * capacidade no servidor.
 */
export async function criarReservaVagasTransacional(
  params: CriarReservaVagasParams,
): Promise<ResultadoReservaVagas> {
  validarParametros(params);

  const quantidade = inteiroPositivo(params.quantidade, "QUANTIDADE");
  const capacidade = inteiroPositivo(params.capacidade, "CAPACIDADE");
  const duracaoMinutos = Math.min(
    30,
    Math.max(5, Math.floor(Number(params.duracaoMinutos) || 15)),
  );
  const reservaRef = db.collection("reservas_vendas").doc(texto(params.reservaId));
  const inventarioRef = db
    .collection("inventarios_vagas")
    .doc(chaveInventario(params.idViagem, params.tipoVaga));

  return db.runTransaction(async (transacao) => {
    const agoraMs = Date.now();
    const [inventarioSnap, reservaSnap] = await Promise.all([
      transacao.get(inventarioRef),
      transacao.get(reservaRef),
    ]);

    if (reservaSnap.exists) {
      const existente = reservaSnap.data() || {};

      if (
        texto(existente.compradorUid) !== params.compradorUid ||
        texto(existente.vendaId) !== params.vendaId ||
        texto(existente.idViagem) !== params.idViagem ||
        texto(existente.tipoVaga) !== params.tipoVaga ||
        Number(existente.quantidade) !== quantidade
      ) {
        throw new Error("CHAVE_RESERVA_JA_UTILIZADA");
      }

      if (existente.status === "confirmada") {
        return {
          reservaId: reservaRef.id,
          status: "confirmada",
          reutilizada: true,
          expiraEm: null,
          capacidade,
          ocupadas: Number(existente.ocupadasNoMomento) || 0,
          reservadas: Number(existente.reservadasNoMomento) || 0,
          disponiveisDepoisDaReserva:
            Number(existente.disponiveisDepoisDaReserva) || 0,
        };
      }

      const expiraEmExistente = existente.expiraEm?.toMillis?.() || 0;

      if (existente.status === "ativa" && expiraEmExistente > agoraMs) {
        return {
          reservaId: reservaRef.id,
          status: "ativa",
          reutilizada: true,
          expiraEm: existente.expiraEm,
          capacidade,
          ocupadas: Number(existente.ocupadasNoMomento) || 0,
          reservadas: Number(existente.reservadasNoMomento) || 0,
          disponiveisDepoisDaReserva:
            Number(existente.disponiveisDepoisDaReserva) || 0,
        };
      }
    }

    const passagensQuery = db
      .collection("passagens")
      .where("idViagem", "==", params.idViagem);
    const reservasQuery = db
      .collection("reservas_vendas")
      .where("idViagem", "==", params.idViagem);
    const [passagensSnap, reservasSnap] = await Promise.all([
      transacao.get(passagensQuery),
      transacao.get(reservasQuery),
    ]);

    const ocupadas = passagensSnap.docs.filter((documento) =>
      passagemOcupaVaga(documento.data(), params.tipoVaga),
    ).length;
    const reservadas = reservasSnap.docs.reduce((total, documento) => {
      if (documento.id === reservaRef.id) return total;

      const dados = documento.data();
      const expiraEm = dados.expiraEm?.toMillis?.() || 0;
      const ativa =
        dados.status === "ativa" &&
        expiraEm > agoraMs &&
        texto(dados.tipoVaga) === params.tipoVaga;

      return ativa ? total + Math.max(0, Number(dados.quantidade) || 0) : total;
    }, 0);
    const disponiveis = capacidade - ocupadas - reservadas;

    if (quantidade > disponiveis) {
      throw new Error("VAGAS_INSUFICIENTES");
    }

    const expiraEm = admin.firestore.Timestamp.fromMillis(
      agoraMs + duracaoMinutos * 60 * 1000,
    );
    const disponiveisDepoisDaReserva = disponiveis - quantidade;

    transacao.set(
      inventarioRef,
      {
        barcoId: params.barcoId,
        gradeId: params.gradeId,
        idViagem: params.idViagem,
        tipoVaga: params.tipoVaga,
        capacidade,
        revisao: (Number(inventarioSnap.data()?.revisao) || 0) + 1,
        atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    transacao.set(
      reservaRef,
      {
        reservaId: reservaRef.id,
        vendaId: params.vendaId,
        compradorUid: params.compradorUid,
        barcoId: params.barcoId,
        gradeId: params.gradeId,
        idViagem: params.idViagem,
        tipoVaga: params.tipoVaga,
        quantidade,
        capacidade,
        status: "ativa",
        ocupadasNoMomento: ocupadas,
        reservadasNoMomento: reservadas,
        disponiveisDepoisDaReserva,
        expiraEm,
        criadoEm: reservaSnap.exists
          ? reservaSnap.data()?.criadoEm || admin.firestore.FieldValue.serverTimestamp()
          : admin.firestore.FieldValue.serverTimestamp(),
        atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return {
      reservaId: reservaRef.id,
      status: "ativa",
      reutilizada: false,
      expiraEm,
      capacidade,
      ocupadas,
      reservadas,
      disponiveisDepoisDaReserva,
    };
  });
}

export async function liberarReservaVagasTransacional({
  reservaId,
  motivo,
}: {
  reservaId: string;
  motivo: "expirada" | "pagamento_rejeitado" | "cancelada" | "erro_pagamento";
}) {
  const reservaRef = db.collection("reservas_vendas").doc(texto(reservaId));

  return db.runTransaction(async (transacao) => {
    const reservaSnap = await transacao.get(reservaRef);

    if (!reservaSnap.exists) return false;

    const reserva = reservaSnap.data() || {};

    if (reserva.status !== "ativa") return false;

    const tipoVaga = texto(reserva.tipoVaga) as TipoVagaVenda;
    const idViagem = texto(reserva.idViagem);
    const inventarioRef = db
      .collection("inventarios_vagas")
      .doc(chaveInventario(idViagem, tipoVaga));
    const inventarioSnap = await transacao.get(inventarioRef);

    transacao.set(
      inventarioRef,
      {
        revisao: (Number(inventarioSnap.data()?.revisao) || 0) + 1,
        atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    transacao.set(
      reservaRef,
      {
        status: "liberada",
        motivoLiberacao: motivo,
        liberadaEm: admin.firestore.FieldValue.serverTimestamp(),
        atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return true;
  });
}
