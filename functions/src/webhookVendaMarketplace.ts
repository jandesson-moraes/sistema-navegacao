import * as admin from "firebase-admin";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { defineSecret } from "firebase-functions/params";
import { onRequest } from "firebase-functions/v2/https";
import {
  mercadoPagoMarketplaceClientId,
  mercadoPagoMarketplaceClientSecret,
  obterTokenMarketplaceOperacao,
} from "./mercadoPagoMarketplace";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const webhookSecret = defineSecret("MERCADO_PAGO_WEBHOOK_SECRET");
const REGIAO = "us-central1";
const TOLERANCIA_ASSINATURA_MS = 10 * 60 * 1000;

type TaxaPagamento = {
  type?: string;
  amount?: number;
};

type PagamentoMarketplace = {
  id?: string | number;
  status?: string;
  status_detail?: string;
  live_mode?: boolean;
  collector_id?: string | number;
  external_reference?: string;
  transaction_amount?: number;
  fee_details?: TaxaPagamento[];
  date_created?: string;
  date_approved?: string;
};

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

function numero(valor: unknown) {
  const resultado = Number(valor);
  return Number.isFinite(resultado) ? resultado : 0;
}

function moeda(valor: number) {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
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
  const timestampMs =
    timestampNumero < 1_000_000_000_000 ? timestampNumero * 1000 : timestampNumero;

  if (Math.abs(Date.now() - timestampMs) > TOLERANCIA_ASSINATURA_MS) return false;

  const manifesto = `id:${dataId};request-id:${requestId};ts:${timestamp};`;
  const calculada = createHmac("sha256", segredo).update(manifesto).digest("hex");
  const recebidoBuffer = Buffer.from(assinaturaRecebida, "hex");
  const calculadoBuffer = Buffer.from(calculada, "hex");

  return (
    recebidoBuffer.length === calculadoBuffer.length &&
    timingSafeEqual(recebidoBuffer, calculadoBuffer)
  );
}

function statusVenda(statusPagamento: string) {
  switch (texto(statusPagamento).toLowerCase()) {
    case "approved":
      return "pagamento_aprovado_aguardando_emissao";
    case "refunded":
      return "reembolsada";
    case "cancelled":
      return "cancelada";
    case "rejected":
      return "rejeitada";
    case "charged_back":
      return "contestada";
    default:
      return "aguardando_pagamento";
  }
}

export const webhookVendaMarketplace = onRequest(
  {
    region: REGIAO,
    cors: false,
    secrets: [
      webhookSecret,
      mercadoPagoMarketplaceClientId,
      mercadoPagoMarketplaceClientSecret,
    ],
    timeoutSeconds: 60,
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("METHOD_NOT_ALLOWED");
      return;
    }

    if (!validarAssinatura(req as never)) {
      console.warn("Webhook de venda Marketplace recusado: assinatura inválida");
      res.status(401).send("INVALID_SIGNATURE");
      return;
    }

    try {
      const barcoId = texto(req.query.barcoId);
      const pagamentoId = texto(req.query["data.id"]);
      const tipo = texto(req.query.type || (req.body as Record<string, unknown>)?.type);

      if (!barcoId || !pagamentoId) {
        res.status(400).send("DADOS_INCOMPLETOS");
        return;
      }

      if (tipo && tipo !== "payment") {
        res.status(200).send("EVENTO_IGNORADO");
        return;
      }

      const { accessToken, sellerUserId } = await obterTokenMarketplaceOperacao(barcoId);
      const resposta = await fetch(
        `https://api.mercadopago.com/v1/payments/${encodeURIComponent(pagamentoId)}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
          },
        },
      );
      const pagamento = (await resposta.json()) as PagamentoMarketplace &
        Record<string, unknown>;

      if (resposta.status === 404) {
        res.status(200).send("PAGAMENTO_NAO_LOCALIZADO");
        return;
      }

      if (!resposta.ok) {
        console.error(
          "Pagamento Marketplace não consultado",
          resposta.status,
          texto(pagamento.message),
        );
        res.status(502).send("PAGAMENTO_NAO_CONSULTADO");
        return;
      }

      const vendaId = texto(pagamento.external_reference);

      if (!/^VND-[a-f0-9]{24}$/.test(vendaId)) {
        res.status(200).send("REFERENCIA_FORA_DAS_VENDAS");
        return;
      }

      const vendaRef = db.collection("vendas").doc(vendaId);
      const vendaSnap = await vendaRef.get();

      if (!vendaSnap.exists) {
        res.status(200).send("VENDA_NAO_LOCALIZADA");
        return;
      }

      const venda = vendaSnap.data() || {};
      const taxas = Array.isArray(pagamento.fee_details) ? pagamento.fee_details : [];
      const taxaMarketplace = moeda(
        taxas
          .filter((taxa) =>
            ["application_fee", "marketplace_fee"].includes(texto(taxa.type)),
          )
          .reduce((total, taxa) => total + numero(taxa.amount), 0),
      );
      const valorEsperado = moeda(
        numero(venda.totalPagoPassageiro || venda.valorTotalCobrado),
      );
      const taxaEsperada = moeda(
        numero(venda.receitaBrutaPlataforma || venda.taxaPlataformaValor),
      );
      const valorRecebido = moeda(numero(pagamento.transaction_amount));
      const pagamentoIdRegistrado = texto(venda.pagamentoId);
      const barcoConfere = texto(venda.barcoId) === barcoId;
      const sellerConfere = texto(pagamento.collector_id) === sellerUserId;
      const ambienteConfere = pagamento.live_mode === true;
      const valorConfere = Math.abs(valorEsperado - valorRecebido) <= 0.01;
      const taxaConfere = Math.abs(taxaEsperada - taxaMarketplace) <= 0.01;
      const pagamentoIdConfere =
        !pagamentoIdRegistrado || pagamentoIdRegistrado === pagamentoId;
      const aprovadoParaProcessar =
        barcoConfere &&
        sellerConfere &&
        ambienteConfere &&
        valorConfere &&
        taxaConfere &&
        pagamentoIdConfere;
      const statusPagamento = texto(pagamento.status) || "desconhecido";
      const eventoId = hash(
        `${pagamentoId}|${statusPagamento}|${texto(req.headers["x-request-id"])}`,
      );

      await db.runTransaction(async (transacao) => {
        const atual = await transacao.get(vendaRef);

        if (!atual.exists) return;

        transacao.set(
          vendaRef,
          {
            pagamentoId,
            statusPagamento: aprovadoParaProcessar
              ? statusPagamento
              : "auditoria_necessaria",
            statusVenda: aprovadoParaProcessar
              ? statusVenda(statusPagamento)
              : "auditoria_necessaria",
            valorRecebido,
            taxaMarketplaceConfirmada: taxaMarketplace,
            validacoesPagamento: {
              barcoConfere,
              sellerConfere,
              ambienteConfere,
              valorConfere,
              taxaConfere,
              pagamentoIdConfere,
            },
            dataAprovacaoMercadoPago: texto(pagamento.date_approved) || null,
            atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );

        transacao.set(
          db.collection("mercado_pago_webhook_eventos").doc(eventoId),
          {
            eventoId,
            vendaId,
            barcoId,
            pagamentoId,
            statusPagamento,
            aprovadoParaProcessar,
            criadoEm: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      });

      res.status(200).send(
        aprovadoParaProcessar ? "OK_AGUARDANDO_EMISSAO" : "AUDITORIA_NECESSARIA",
      );
    } catch (erro) {
      const codigo = erro instanceof Error ? erro.message : "ERRO_INTERNO";
      console.error("Erro em webhookVendaMarketplace", codigo);
      res.status(500).send("ERRO_INTERNO");
    }
  },
);
