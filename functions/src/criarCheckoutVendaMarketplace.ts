import * as admin from "firebase-admin";
import { createHash } from "node:crypto";
import { onRequest } from "firebase-functions/v2/https";
import { calcularVendaNoServidor, type RegraTaxaVenda } from "./motorVendas";
import {
  mercadoPagoMarketplaceClientId,
  mercadoPagoMarketplaceClientSecret,
  obterTokenMarketplaceVenda,
} from "./mercadoPagoMarketplace";
import {
  criarReservaVagasTransacional,
  liberarReservaVagasTransacional,
  type TipoVagaVenda,
} from "./reservasVendas";

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();
const REGIAO = "us-central1";
const PROJETO_ID = "sistema-navegacao";
const BARCO_PILOTO = "AGUIA_DOURADA";
const URL_WEBHOOK =
  `https://${REGIAO}-${PROJETO_ID}.cloudfunctions.net/webhookVendaMarketplace`;

type PassageiroRecebido = {
  nome?: string;
  documento?: string;
  nacionalidade?: string;
  nascimento?: string;
};

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

function numero(valor: unknown, padrao = 0) {
  const resultado = Number(valor);
  return Number.isFinite(resultado) ? resultado : padrao;
}

function cpf(valor: unknown) {
  return texto(valor).replace(/\D/g, "");
}

function normalizar(valor: unknown) {
  return texto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function primeiroNumero(objeto: Record<string, unknown>, campos: string[]) {
  for (const campo of campos) {
    const valor = numero(objeto[campo], Number.NaN);
    if (Number.isFinite(valor)) return valor;
  }
  return 0;
}

async function autenticar(req: { headers: { authorization?: string | string[] } }) {
  const cabecalho = texto(req.headers.authorization);
  if (!cabecalho.startsWith("Bearer ")) throw new Error("UNAUTHENTICATED");
  return admin.auth().verifyIdToken(cabecalho.slice(7).trim());
}

function idBarcoGrade(grade: Record<string, unknown>) {
  return texto(
    [
      grade.barcoId,
      grade.embarcacaoId,
      grade.idBarco,
      grade.id_barco,
      grade.barco_id,
      grade.embarcacao_id,
    ].find((valor) => texto(valor)),
  );
}

function localizarDestino(grade: Record<string, unknown>, destino: string) {
  const itinerario = Array.isArray(grade.itinerario)
    ? grade.itinerario
    : Array.isArray(grade.escalas)
      ? grade.escalas
      : [];
  const procurado = normalizar(destino).split(" - ")[0];
  return itinerario.find((item) => {
    const parada = item as Record<string, unknown>;
    return normalizar(parada.porto || parada.cidade).split(" - ")[0] === procurado;
  }) as Record<string, unknown> | undefined;
}

function preco(parada: Record<string, unknown>, tipo: TipoVagaVenda) {
  if (tipo === "poltrona") {
    return primeiroNumero(parada, ["preco_poltrona", "precoPoltrona"]);
  }
  if (tipo === "suite") {
    return primeiroNumero(parada, ["preco_suite", "precoSuite"]);
  }
  return primeiroNumero(parada, [
    "preco_da_origem",
    "precoRede",
    "preco_rede",
    "preco",
  ]);
}

function capacidade(grade: Record<string, unknown>, tipo: TipoVagaVenda) {
  const campos: Record<TipoVagaVenda, string[]> = {
    rede: ["capacidadeRede", "capacidade_rede", "vagasRede", "vagas_rede", "totalRedes"],
    poltrona: [
      "capacidadePoltrona",
      "capacidade_poltrona",
      "vagasPoltrona",
      "vagas_poltrona",
      "totalPoltronas",
    ],
    suite: ["capacidadeSuite", "capacidade_suite", "vagasSuite", "vagas_suite", "totalSuites"],
  };
  const especifica = primeiroNumero(grade, campos[tipo]);
  const geral = primeiroNumero(grade, [
    "capacidade",
    "capacidadeTotal",
    "capacidade_total",
    "lotacao",
  ]);
  const valor = especifica > 0 ? especifica : geral;
  return valor > 0 ? Math.floor(valor) : 0;
}

function configuracao(barco: Record<string, unknown>) {
  const vendas = (barco.vendasPassagens as Record<string, unknown>) || {};
  const financeiro = (barco.financeiroMercadoPago as Record<string, unknown>) || {};
  const regra = (vendas.regraTaxa as RegraTaxaVenda) || {};
  return {
    ativa:
      vendas.ativa === true &&
      financeiro.status === "ativo" &&
      financeiro.vendaPassagemHabilitada === true,
    regra: {
      ...regra,
      percentual: regra.percentual ?? numero(financeiro.taxaPlataformaPercentual),
      valorFixo: regra.valorFixo ?? numero(financeiro.taxaPlataformaValorFixo),
    } as RegraTaxaVenda,
    limiteHoras: Math.max(0, numero(vendas.limiteHorasAntesSaida, 2)),
  };
}

function validarPrazo(data: string, horario: string, limiteHoras: number) {
  const partes = data.includes("/") ? data.split("/").reverse() : data.split("-");
  if (partes.length !== 3 || !/^\d{2}:\d{2}/.test(horario)) {
    throw new Error("DATA_HORARIO_VIAGEM_INVALIDOS");
  }
  const instante = new Date(`${partes.join("-")}T${horario.slice(0, 5)}:00-04:00`);
  if (!Number.isFinite(instante.getTime())) throw new Error("DATA_HORARIO_VIAGEM_INVALIDOS");
  if (instante.getTime() <= Date.now() + limiteHoras * 60 * 60 * 1000) {
    throw new Error("PRAZO_DE_COMPRA_ENCERRADO");
  }
}

export const criarCheckoutVendaMarketplace = onRequest(
  {
    region: REGIAO,
    cors: true,
    secrets: [
      mercadoPagoMarketplaceClientId,
      mercadoPagoMarketplaceClientSecret,
    ],
    timeoutSeconds: 60,
  },
  async (req, res) => {
    let reservaId = "";
    let checkoutCriado = false;
    try {
      if (req.method !== "POST") {
        res.status(405).json({ erro: "METHOD_NOT_ALLOWED" });
        return;
      }

      const usuario = await autenticar(req);
      const corpo = (req.body || {}) as Record<string, unknown>;
      const gradeId = texto(corpo.gradeId);
      const idViagem = texto(corpo.idViagem);
      const barcoId = texto(corpo.barcoId);
      const origem = texto(corpo.origem);
      const destino = texto(corpo.destino);
      const dataViagem = texto(corpo.dataViagem);
      const horarioSaida = texto(corpo.horarioSaida);
      const tipoVaga = texto(corpo.tipoVaga).toLowerCase() as TipoVagaVenda;
      const chaveCliente = texto(corpo.chaveIdempotencia);
      const incluiRefeicao = corpo.refeicao === true;
      const passageiros = Array.isArray(corpo.passageiros)
        ? (corpo.passageiros as PassageiroRecebido[])
        : [];

      if (
        !gradeId ||
        !idViagem ||
        !barcoId ||
        !origem ||
        !destino ||
        !["rede", "poltrona", "suite"].includes(tipoVaga) ||
        !/^[a-zA-Z0-9_-]{20,150}$/.test(chaveCliente)
      ) {
        res.status(400).json({ erro: "DADOS_DA_COMPRA_INVALIDOS" });
        return;
      }
      if (barcoId !== BARCO_PILOTO) {
        res.status(403).json({ erro: "PILOTO_RESTRITO_A_AGUIA_DOURADA" });
        return;
      }
      if (passageiros.length < 1 || passageiros.length > 20) {
        res.status(400).json({ erro: "QUANTIDADE_PASSAGEIROS_INVALIDA" });
        return;
      }
      if (
        passageiros.some(
          (item) => texto(item.nome).split(/\s+/).length < 2 || cpf(item.documento).length !== 11,
        )
      ) {
        res.status(400).json({ erro: "DADOS_DOS_PASSAGEIROS_INVALIDOS" });
        return;
      }

      const [gradeSnap, barcoSnap] = await Promise.all([
        db.collection("grades_viagens").doc(gradeId).get(),
        db.collection("embarcacoes").doc(barcoId).get(),
      ]);
      if (!gradeSnap.exists || !barcoSnap.exists) {
        res.status(404).json({ erro: "VIAGEM_OU_EMBARCACAO_NAO_ENCONTRADA" });
        return;
      }

      const grade = gradeSnap.data() as Record<string, unknown>;
      const barco = barcoSnap.data() as Record<string, unknown>;
      if (idBarcoGrade(grade) && idBarcoGrade(grade) !== barcoId) {
        res.status(409).json({ erro: "VIAGEM_NAO_PERTENCE_A_EMBARCACAO" });
        return;
      }

      const config = configuracao(barco);
      if (!config.ativa) {
        res.status(403).json({ erro: "EMBARCACAO_NAO_LIBERADA_PARA_VENDA" });
        return;
      }
      validarPrazo(dataViagem, horarioSaida, config.limiteHoras);

      const parada = localizarDestino(grade, destino);
      if (!parada) throw new Error("DESTINO_FORA_DO_ITINERARIO");
      const valorUnitarioPassagem = preco(parada, tipoVaga);
      const capacidadeOficial = capacidade(grade, tipoVaga);
      if (valorUnitarioPassagem <= 0) throw new Error("PRECO_OFICIAL_NAO_CONFIGURADO");
      if (capacidadeOficial <= 0) throw new Error("CAPACIDADE_OFICIAL_NAO_CONFIGURADA");

      const valorUnitarioRefeicao = incluiRefeicao
        ? primeiroNumero(parada, ["preco_refeicao", "precoRefeicao"])
        : 0;
      const calculo = calcularVendaNoServidor({
        regra: config.regra,
        quantidade: passageiros.length,
        valorUnitarioPassagem,
        valorAdicionais: valorUnitarioRefeicao * passageiros.length,
      });
      if (calculo.receitaBrutaPlataforma < 0.01) {
        throw new Error("TAXA_MARKETPLACE_NAO_CONFIGURADA");
      }
      if (calculo.receitaBrutaPlataforma > calculo.totalPagoPassageiro) {
        throw new Error("TAXA_MARKETPLACE_SUPERIOR_AO_TOTAL");
      }

      const hash = createHash("sha256")
        .update(`${usuario.uid}|${chaveCliente}`)
        .digest("hex");
      const vendaId = `VND-${hash.slice(0, 24)}`;
      reservaId = `RSV-${hash.slice(0, 24)}`;
      const vendaRef = db.collection("vendas").doc(vendaId);
      const privadaRef = db.collection("vendas_dados_privados").doc(vendaId);
      const existente = await vendaRef.get();
      if (existente.exists) {
        const dados = existente.data() || {};
        if (texto(dados.compradorUid) !== usuario.uid) {
          res.status(403).json({ erro: "VENDA_NAO_PERTENCE_AO_USUARIO" });
          return;
        }
        if (texto(dados.checkoutInitPoint)) {
          res.status(200).json({
            vendaId,
            checkoutUrl: texto(dados.checkoutInitPoint),
            preferenciaId: texto(dados.preferenciaId),
            status: texto(dados.statusVenda),
          });
          return;
        }
      }

      await criarReservaVagasTransacional({
        reservaId,
        vendaId,
        compradorUid: usuario.uid,
        barcoId,
        gradeId,
        idViagem,
        tipoVaga,
        quantidade: passageiros.length,
        capacidade: capacidadeOficial,
        duracaoMinutos: 15,
      });

      const nomeBarco = texto(barco.nome || barco.nome_barco || barcoId);
      const emailComprador = texto(usuario.email || corpo.email);
      await Promise.all([
        vendaRef.set(
          {
            vendaId,
            reservaId,
            compradorUid: usuario.uid,
            compradorEmail: emailComprador,
            barcoId,
            barcoNome: nomeBarco,
            ownerId: texto(barco.ownerId),
            ownerEmail: texto(barco.ownerEmail || barco.emailDono),
            gradeId,
            viagemId: idViagem,
            origem,
            destino,
            dataViagem,
            horarioSaida,
            tipoVaga,
            incluiRefeicao,
            quantidadePassageiros: passageiros.length,
            valorUnitarioRefeicao,
            ...calculo,
            valorTotalCobrado: calculo.totalPagoPassageiro,
            taxaPlataformaValor: calculo.receitaBrutaPlataforma,
            formaPagamento: "checkout_pro_marketplace",
            ambiente: "producao",
            statusPagamento: "criando_checkout",
            statusVenda: "criando_checkout",
            bilhetesEmitidos: 0,
            criadoEm: admin.firestore.FieldValue.serverTimestamp(),
            atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        ),
        privadaRef.set({
          vendaId,
          compradorUid: usuario.uid,
          passageiros: passageiros.map((item) => ({
            nome: texto(item.nome),
            documento: cpf(item.documento),
            nacionalidade: texto(item.nacionalidade || "Brasileira"),
            nascimento: texto(item.nascimento),
          })),
          criadoEm: admin.firestore.FieldValue.serverTimestamp(),
          atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
        }),
      ]);

      const { accessToken, sellerUserId } = await obterTokenMarketplaceVenda(barcoId);
      const resposta = await fetch("https://api.mercadopago.com/checkout/preferences", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Idempotency-Key": vendaId,
        },
        body: JSON.stringify({
          items: [{
            id: vendaId,
            title: `Passagem ${nomeBarco}`,
            description: `${origem} para ${destino}`,
            currency_id: "BRL",
            quantity: 1,
            unit_price: calculo.totalPagoPassageiro,
          }],
          marketplace_fee: calculo.receitaBrutaPlataforma,
          external_reference: vendaId,
          notification_url: `${URL_WEBHOOK}?barcoId=${encodeURIComponent(barcoId)}`,
          statement_descriptor: "CADE MEU BARCO",
          payer: { email: emailComprador },
          metadata: { venda_id: vendaId, reserva_id: reservaId, barco_id: barcoId },
        }),
      });
      const preferencia = (await resposta.json()) as Record<string, unknown>;
      const preferenciaId = texto(preferencia.id);
      const initPoint = texto(preferencia.init_point);
      if (!resposta.ok || !preferenciaId || !initPoint) {
        await liberarReservaVagasTransacional({ reservaId, motivo: "erro_pagamento" });
        await vendaRef.set({
          statusPagamento: "erro_ao_criar_checkout",
          statusVenda: "erro_ao_criar_checkout",
          erroPagamentoCodigo: texto(preferencia.error || preferencia.message),
          atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        res.status(502).json({ erro: "MERCADO_PAGO_NAO_CRIOU_CHECKOUT" });
        return;
      }

      checkoutCriado = true;

      await vendaRef.set({
        sellerUserId,
        preferenciaId,
        checkoutInitPoint: initPoint,
        statusPagamento: "pending",
        statusVenda: "aguardando_pagamento",
        atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      res.status(200).json({
        vendaId,
        preferenciaId,
        checkoutUrl: initPoint,
        status: "aguardando_pagamento",
        expiraReservaEmMinutos: 15,
      });
    } catch (erro) {
      const codigo = erro instanceof Error ? erro.message : "ERRO_INTERNO";
      if (reservaId && !checkoutCriado) {
        await liberarReservaVagasTransacional({ reservaId, motivo: "erro_pagamento" })
          .catch(() => undefined);
      }
      console.error("Erro em criarCheckoutVendaMarketplace", codigo);
      const status = codigo === "UNAUTHENTICATED" ? 401 :
        codigo.includes("NAO_LIBERADA") || codigo.includes("PILOTO") ? 403 :
          codigo.includes("VAGAS_INSUFICIENTES") ? 409 : 500;
      res.status(status).json({ erro: codigo });
    }
  },
);
