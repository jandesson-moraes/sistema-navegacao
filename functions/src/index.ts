import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";
import { createHash } from "node:crypto";
import { defineSecret } from "firebase-functions/params";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { calcularVendaNoServidor, type RegraTaxaVenda } from "./motorVendas";

export { processarVencimentoPlanos } from "./vencimentoPlanos";
export { criarLinkOAuthMercadoPago, mercadoPagoOAuthCallback } from "./oauthMercadoPago";
export { solicitarCadastroPublicoEmbarcacao } from "./cadastroPublicoEmbarcacoes";
export {
  consultarEdicaoPublicaEmbarcacao,
  solicitarAlteracaoPublicaEmbarcacao,
} from "./alteracoesPublicasEmbarcacoes";
export { gerarPixSplitTeste } from "./splitMercadoPagoTeste";
export { criarCheckoutProSplitSandbox } from "./checkoutProSplitSandbox";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const mercadoPagoAccessToken = defineSecret("MERCADO_PAGO_ACCESS_TOKEN");

const PROJETO_ID = "sistema-navegacao";
const REGIAO = "us-central1";
const URL_WEBHOOK_MERCADO_PAGO = `https://${REGIAO}-${PROJETO_ID}.cloudfunctions.net/webhookMercadoPagoCmb`;

type PassageiroRecebido = {
  nome?: string;
  documento?: string;
  nacionalidade?: string;
  nascimento?: string;
};

type DadosPagamentoMercadoPago = {
  id?: number | string;
  status?: string;
  transaction_amount?: number;
  external_reference?: string;
  fee_details?: Array<{
    amount?: number;
    type?: string;
  }>;
  point_of_interaction?: {
    transaction_data?: {
      qr_code?: string;
      qr_code_base64?: string;
      ticket_url?: string;
    };
  };
};

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

function numero(valor: unknown, padrao = 0) {
  const resultado = Number(valor);
  return Number.isFinite(resultado) ? resultado : padrao;
}

function moeda(valor: number) {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}

function cpfLimpo(valor: unknown) {
  return texto(valor).replace(/\D/g, "");
}

function cpfMascarado(valor: unknown) {
  const cpf = cpfLimpo(valor);

  if (cpf.length !== 11) {
    return "***.***.***-**";
  }

  return `***.***.***-${cpf.slice(-2)}`;
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

    if (Number.isFinite(valor)) {
      return valor;
    }
  }

  return 0;
}

function obterIdBarcoDaGrade(grade: Record<string, unknown>) {
  const candidatos = [
    grade.barcoId,
    grade.embarcacaoId,
    grade.idBarco,
    grade.id_barco,
    grade.barco_id,
    grade.embarcacao_id,
  ];

  return texto(candidatos.find((valor) => texto(valor)));
}

function obterNomeBarcoDaGrade(grade: Record<string, unknown>) {
  const candidatos = [
    grade.nome_barco,
    grade.nomeBarco,
    grade.barcoNome,
    grade.embarcacaoNome,
    grade.nomeEmbarcacao,
  ];

  return texto(candidatos.find((valor) => texto(valor)));
}

function obterConfiguracaoVendas(barco: Record<string, unknown>) {
  const vendas = (barco.vendasPassagens as Record<string, unknown>) || {};
  const regra = (vendas.regraTaxa as RegraTaxaVenda) || {};
  const pagamento = (vendas.pagamento as Record<string, unknown>) || {};
  const financeiro = (barco.financeiroMercadoPago as Record<string, unknown>) || {};

  return {
    ativa:
      vendas.ativa === true ||
      barco.vendaPassagemHabilitada === true ||
      financeiro.vendaPassagemHabilitada === true,
    regraTaxa: {
      ...regra,
      percentual: regra.percentual ?? numero(financeiro.taxaPlataformaPercentual),
      valorFixo: regra.valorFixo ?? numero(financeiro.taxaPlataformaValorFixo),
    } as RegraTaxaVenda,
    pagamento: {
      pixAtivo: pagamento.pixAtivo !== false,
      mercadoPagoConectado:
        pagamento.mercadoPagoConectado === true || financeiro.contaConectada === true,
      vendedorMercadoPagoId: texto(
        pagamento.vendedorMercadoPagoId || financeiro.vendedorMercadoPagoId,
      ),
    },
    limiteHorasAntesSaida: Math.max(0, numero(vendas.limiteHorasAntesSaida, 2)),
  };
}

async function autenticarRequisicao(req: {
  headers: {
    authorization?: string | string[];
  };
}) {
  const cabecalho = texto(req.headers.authorization);

  if (!cabecalho.startsWith("Bearer ")) {
    throw new Error("UNAUTHENTICATED");
  }

  const token = cabecalho.slice(7).trim();

  if (!token) {
    throw new Error("UNAUTHENTICATED");
  }

  return admin.auth().verifyIdToken(token);
}

async function localizarBarcoDaGrade(
  grade: Record<string, unknown>,
  barcoIdInformado: string,
) {
  const idDaGrade = obterIdBarcoDaGrade(grade);

  if (idDaGrade) {
    const snap = await db.collection("embarcacoes").doc(idDaGrade).get();

    if (snap.exists) {
      return {
        id: snap.id,
        dados: snap.data() as Record<string, unknown>,
      };
    }
  }

  const nomeGrade = normalizar(obterNomeBarcoDaGrade(grade));

  if (barcoIdInformado) {
    const snap = await db.collection("embarcacoes").doc(barcoIdInformado).get();

    if (snap.exists) {
      const dados = snap.data() as Record<string, unknown>;
      const nomes = [dados.nome, dados.nome_barco, dados.nomeBarco, dados.apelido].map(
        normalizar,
      );

      if (!nomeGrade || nomes.includes(nomeGrade)) {
        return {
          id: snap.id,
          dados,
        };
      }
    }
  }

  const barcosSnap = await db.collection("embarcacoes").get();

  for (const documento of barcosSnap.docs) {
    const dados = documento.data() as Record<string, unknown>;
    const nomes = [dados.nome, dados.nome_barco, dados.nomeBarco, dados.apelido].map(
      normalizar,
    );

    if (nomeGrade && nomes.includes(nomeGrade)) {
      return {
        id: documento.id,
        dados,
      };
    }
  }

  return null;
}

function localizarParadaDestino(grade: Record<string, unknown>, destino: string) {
  const itinerario = Array.isArray(grade.itinerario)
    ? grade.itinerario
    : Array.isArray(grade.escalas)
      ? grade.escalas
      : [];

  const destinoNormalizado = normalizar(destino).split(" - ")[0];

  return itinerario.find((item) => {
    const parada = item as Record<string, unknown>;
    const nome = normalizar(parada.porto || parada.cidade).split(" - ")[0];

    return nome === destinoNormalizado;
  }) as Record<string, unknown> | undefined;
}

function calcularPrecoOficial(parada: Record<string, unknown>, tipoVaga: string) {
  if (tipoVaga === "poltrona") {
    return primeiroNumero(parada, ["preco_poltrona", "precoPoltrona"]);
  }

  if (tipoVaga === "suite") {
    return primeiroNumero(parada, ["preco_suite", "precoSuite"]);
  }

  return primeiroNumero(parada, ["preco_da_origem", "precoRede", "preco_rede", "preco"]);
}

function obterCapacidade(grade: Record<string, unknown>, tipoVaga: string) {
  const camposPorTipo: Record<string, string[]> = {
    rede: ["capacidadeRede", "capacidade_rede", "vagasRede", "vagas_rede", "totalRedes"],
    poltrona: [
      "capacidadePoltrona",
      "capacidade_poltrona",
      "vagasPoltrona",
      "vagas_poltrona",
      "totalPoltronas",
    ],
    suite: [
      "capacidadeSuite",
      "capacidade_suite",
      "vagasSuite",
      "vagas_suite",
      "totalSuites",
    ],
  };

  const especifica = primeiroNumero(grade, camposPorTipo[tipoVaga] || []);

  if (especifica > 0) {
    return Math.floor(especifica);
  }

  const geral = primeiroNumero(grade, [
    "capacidade",
    "capacidadeTotal",
    "capacidade_total",
    "lotacao",
  ]);

  return geral > 0 ? Math.floor(geral) : null;
}

async function contarPassagensOcupadas(idViagem: string, tipoVaga: string) {
  const snapshot = await db
    .collection("passagens")
    .where("idViagem", "==", idViagem)
    .get();

  return snapshot.docs.filter((documento) => {
    const dados = documento.data();
    const status = texto(dados.status).toUpperCase();
    const tipo = texto(dados.tipoVaga).toLowerCase();

    const cancelada = ["CANCELADO", "CANCELADA", "REJEITADO", "REEMBOLSADO"].includes(
      status,
    );

    return !cancelada && (!tipo || tipo === tipoVaga);
  }).length;
}

function statusPassagem(statusPagamento: string) {
  const status = normalizar(statusPagamento);

  if (status === "approved") return "APROVADO";
  if (status === "refunded") return "REEMBOLSADO";
  if (status === "cancelled") return "CANCELADO";
  if (status === "rejected") return "REJEITADO";
  if (status === "charged_back") return "CONTESTADO";

  return "PENDENTE";
}

function statusVenda(statusPagamento: string) {
  const status = normalizar(statusPagamento);

  if (status === "approved") return "confirmada";
  if (status === "refunded") return "reembolsada";
  if (status === "cancelled") return "cancelada";
  if (status === "rejected") return "rejeitada";
  if (status === "charged_back") return "contestada";

  return "aguardando_pagamento";
}

function taxaProcessador(pagamento: DadosPagamentoMercadoPago) {
  return moeda(
    (pagamento.fee_details || []).reduce((total, item) => total + numero(item.amount), 0),
  );
}

async function consultarPagamentoMercadoPago(pagamentoId: string, accessToken: string) {
  const resposta = await fetch(
    `https://api.mercadopago.com/v1/payments/${encodeURIComponent(pagamentoId)}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    },
  );

  const dados = (await resposta.json()) as DadosPagamentoMercadoPago;

  if (!resposta.ok) {
    throw new Error(`Mercado Pago respondeu ${resposta.status}.`);
  }

  return dados;
}

export const receberDadosGPS = functions.https.onRequest(async (req, res) => {
  try {
    const dados = req.body;

    if (!dados.idBarco || !dados.lat || !dados.lng) {
      res.status(400).send("Dados incompletos.");
      return;
    }

    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    const pontoGeografico = new admin.firestore.GeoPoint(dados.lat, dados.lng);

    await db
      .collection("embarcacoes")
      .doc(dados.idBarco)
      .set(
        {
          ultima_posicao: pontoGeografico,
          velocidade: dados.vel || 0,
          rumo: dados.rumo || 0,
          ultima_atualizacao: timestamp,
        },
        { merge: true },
      );

    await db
      .collection("embarcacoes")
      .doc(dados.idBarco)
      .collection("rastros_viagem")
      .add({
        posicao: pontoGeografico,
        timestamp,
        velocidade: dados.vel || 0,
      });

    res.status(200).send("Posição e rastro gravados!");
  } catch (error) {
    console.error(error);
    res.status(500).send("Erro ao processar sinal.");
  }
});

export const gerarPixSeguro = onRequest(
  {
    region: REGIAO,
    cors: true,
    secrets: [mercadoPagoAccessToken],
    timeoutSeconds: 60,
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ erro: "Método não permitido." });
      return;
    }

    try {
      const usuario = await autenticarRequisicao(req);
      const corpo = (req.body || {}) as Record<string, unknown>;

      const gradeId = texto(corpo.gradeId);
      const idViagem = texto(corpo.idViagem);
      const barcoIdInformado = texto(corpo.barcoId);
      const origem = texto(corpo.origem);
      const destino = texto(corpo.destino);
      const tipoVaga = texto(corpo.tipoVaga).toLowerCase();
      const dataViagem = texto(corpo.dataViagem);
      const horarioSaida = texto(corpo.horarioSaida);
      const incluiRefeicao = corpo.refeicao === true;
      const chaveCliente = texto(corpo.chaveIdempotencia).slice(0, 150);
      const passageiros = Array.isArray(corpo.passageiros)
        ? (corpo.passageiros as PassageiroRecebido[])
        : [];

      if (
        !gradeId ||
        !idViagem ||
        !origem ||
        !destino ||
        !["rede", "poltrona", "suite"].includes(tipoVaga)
      ) {
        res.status(400).json({
          erro: "Dados da viagem incompletos.",
        });
        return;
      }

      if (passageiros.length < 1 || passageiros.length > 20) {
        res.status(400).json({
          erro: "A compra deve ter entre 1 e 20 passageiros.",
        });
        return;
      }

      const passageiroInvalido = passageiros.find(
        (passageiro) =>
          texto(passageiro.nome).split(/\s+/).length < 2 ||
          cpfLimpo(passageiro.documento).length !== 11,
      );

      if (passageiroInvalido) {
        res.status(400).json({
          erro: "Confira o nome completo e o CPF dos passageiros.",
        });
        return;
      }

      const gradeSnap = await db.collection("grades_viagens").doc(gradeId).get();

      if (!gradeSnap.exists) {
        res.status(404).json({
          erro: "Viagem não encontrada.",
        });
        return;
      }

      const grade = gradeSnap.data() as Record<string, unknown>;
      const barcoLocalizado = await localizarBarcoDaGrade(grade, barcoIdInformado);

      if (!barcoLocalizado) {
        res.status(404).json({
          erro: "Não foi possível vincular a viagem à embarcação.",
        });
        return;
      }

      const configuracao = obterConfiguracaoVendas(barcoLocalizado.dados);

      if (!configuracao.ativa || !configuracao.pagamento.pixAtivo) {
        res.status(403).json({
          erro: "A venda de passagens não está habilitada para esta embarcação.",
        });
        return;
      }

      const parada = localizarParadaDestino(grade, destino);

      if (!parada) {
        res.status(400).json({
          erro: "O destino não foi localizado no itinerário.",
        });
        return;
      }

      const valorUnitarioPassagem = calcularPrecoOficial(parada, tipoVaga);
      const valorUnitarioRefeicao = incluiRefeicao
        ? primeiroNumero(parada, ["preco_refeicao", "precoRefeicao"])
        : 0;

      if (valorUnitarioPassagem <= 0) {
        res.status(400).json({
          erro: "O preço oficial desta acomodação não está configurado.",
        });
        return;
      }

      const capacidade = obterCapacidade(grade, tipoVaga);

      if (capacidade !== null) {
        const ocupadas = await contarPassagensOcupadas(idViagem, tipoVaga);

        if (ocupadas + passageiros.length > capacidade) {
          res.status(409).json({
            erro: "Não há vagas suficientes para esta compra.",
            capacidade,
            ocupadas,
            solicitadas: passageiros.length,
          });
          return;
        }
      }

      const calculo = calcularVendaNoServidor({
        regra: configuracao.regraTaxa,
        quantidade: passageiros.length,
        valorUnitarioPassagem,
        valorAdicionais: valorUnitarioRefeicao * passageiros.length,
      });

      const chaveBase = [usuario.uid, chaveCliente || `${idViagem}-${Date.now()}`].join(
        "|",
      );
      const hash = createHash("sha256").update(chaveBase).digest("hex");
      const vendaId = `VND-${hash.slice(0, 24)}`;
      const vendaRef = db.collection("vendas").doc(vendaId);
      const existente = await vendaRef.get();

      if (existente.exists) {
        const dadosExistentes = existente.data() || {};
        const pagamentoExistente = (dadosExistentes.pagamento || {}) as Record<
          string,
          unknown
        >;

        if (dadosExistentes.compradorUid !== usuario.uid) {
          res.status(403).json({
            erro: "Venda não pertence ao usuário.",
          });
          return;
        }

        if (texto(pagamentoExistente.id) && texto(pagamentoExistente.qrCode)) {
          res.status(200).json({
            vendaId,
            id_transacao: texto(pagamentoExistente.id),
            qr_code_copia_cola: texto(pagamentoExistente.qrCode),
            qr_code_base64: texto(pagamentoExistente.qrCodeBase64),
            status: texto(pagamentoExistente.status),
            financeiro: dadosExistentes.financeiro || calculo,
          });
          return;
        }
      }

      const nomeBarco = texto(
        barcoLocalizado.dados.nome ||
          barcoLocalizado.dados.nome_barco ||
          obterNomeBarcoDaGrade(grade) ||
          barcoLocalizado.id,
      );
      const emailComprador = texto(usuario.email || corpo.email);

      await vendaRef.set(
        {
          vendaId,
          chaveIdempotenciaCliente: chaveCliente || null,
          compradorUid: usuario.uid,
          compradorEmail: emailComprador,
          compradorCidadeResidencia: texto(
            corpo.compradorCidadeResidenciaCompleta || corpo.compradorCidadeResidencia,
          ),
          barcoId: barcoLocalizado.id,
          barcoNome: nomeBarco,
          ownerId: texto(barcoLocalizado.dados.ownerId),
          ownerEmail: texto(
            barcoLocalizado.dados.ownerEmail || barcoLocalizado.dados.emailDono,
          ),
          gradeId,
          viagemId: idViagem,
          origem,
          destino,
          dataViagem,
          horarioSaida,
          tipoVaga,
          incluiRefeicao,
          quantidadePassagens: passageiros.length,
          quantidadePassageiros: passageiros.length,
          valorUnitarioPassagem,
          valorUnitarioRefeicao,
          valorPassagens: calculo.valorPassagens,
          valorAdicionais: calculo.valorAdicionais,
          valorTotalCobrado: calculo.totalPagoPassageiro,
          totalPagoPassageiro: calculo.totalPagoPassageiro,
          valorBrutoArmador: calculo.valorBrutoArmador,
          valorLiquidoArmador: calculo.valorLiquidoArmador,
          taxaPlataformaValor: calculo.receitaBrutaPlataforma,
          receitaBrutaPlataforma: calculo.receitaBrutaPlataforma,
          taxaProcessadorValor: 0,
          receitaLiquidaPlataforma: calculo.receitaLiquidaPlataforma,
          taxaAplicada: calculo.taxaAplicada,
          financeiro: calculo,
          formaPagamento: "pix",
          statusPagamento: "criando_pagamento",
          statusVenda: "criando_pagamento",
          bilhetesEmitidos: 0,
          criadoEm: admin.firestore.FieldValue.serverTimestamp(),
          atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      const accessToken = mercadoPagoAccessToken.value();

      if (!accessToken) {
        throw new Error("O segredo MERCADO_PAGO_ACCESS_TOKEN não está configurado.");
      }

      const pagamentoResposta = await fetch("https://api.mercadopago.com/v1/payments", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Idempotency-Key": vendaId,
        },
        body: JSON.stringify({
          transaction_amount: calculo.totalPagoPassageiro,
          description: `Passagem ${nomeBarco}: ${origem} para ${destino}`,
          payment_method_id: "pix",
          external_reference: vendaId,
          notification_url: URL_WEBHOOK_MERCADO_PAGO,
          payer: {
            email: emailComprador,
            first_name: texto(passageiros[0].nome).split(/\s+/)[0] || "Passageiro",
            identification: {
              type: "CPF",
              number: cpfLimpo(passageiros[0].documento),
            },
          },
          metadata: {
            venda_id: vendaId,
            barco_id: barcoLocalizado.id,
            viagem_id: idViagem,
          },
        }),
      });

      const pagamento = (await pagamentoResposta.json()) as DadosPagamentoMercadoPago;

      if (!pagamentoResposta.ok) {
        await vendaRef.set(
          {
            statusPagamento: "erro_ao_criar_pagamento",
            statusVenda: "erro_ao_criar_pagamento",
            erroPagamento: pagamento,
            atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );

        res.status(502).json({
          erro: "O Mercado Pago não conseguiu criar o Pix.",
          detalhes: pagamento,
        });
        return;
      }

      const pagamentoId = texto(pagamento.id);
      const dadosQr = pagamento.point_of_interaction?.transaction_data;
      const qrCode = texto(dadosQr?.qr_code);
      const qrCodeBase64 = texto(dadosQr?.qr_code_base64);
      const taxaMp = taxaProcessador(pagamento);
      const receitaLiquida = moeda(calculo.receitaBrutaPlataforma - taxaMp);

      if (!pagamentoId || !qrCode) {
        await vendaRef.set(
          {
            statusPagamento: "resposta_pix_incompleta",
            statusVenda: "resposta_pix_incompleta",
            pagamentoResposta: pagamento,
            atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );

        res.status(502).json({
          erro: "O Mercado Pago retornou um Pix incompleto.",
        });
        return;
      }

      const batch = db.batch();

      batch.set(
        vendaRef,
        {
          pagamentoId,
          statusPagamento: texto(pagamento.status) || "pending",
          statusVenda: statusVenda(texto(pagamento.status)),
          taxaProcessadorValor: taxaMp,
          receitaLiquidaPlataforma: receitaLiquida,
          pagamento: {
            id: pagamentoId,
            status: texto(pagamento.status) || "pending",
            qrCode,
            qrCodeBase64,
            ticketUrl: texto(dadosQr?.ticket_url),
          },
          atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      passageiros.forEach((passageiro, indice) => {
        const ticketId = `TKT-${pagamentoId}-${indice}`;
        const ticketRef = db.collection("passagens").doc(ticketId);
        const rateio = passageiros.length || 1;

        batch.set(
          ticketRef,
          {
            ticketId,
            vendaId,
            pagamentoId,
            barco: nomeBarco,
            barcoId: barcoLocalizado.id,
            ownerId: texto(barcoLocalizado.dados.ownerId),
            ownerEmail: texto(
              barcoLocalizado.dados.ownerEmail || barcoLocalizado.dados.emailDono,
            ),
            compradorUid: usuario.uid,
            compradorEmail: emailComprador,
            compradorCidadeResidencia: texto(corpo.compradorCidadeResidencia),
            compradorEstadoResidencia: texto(corpo.compradorEstadoResidencia),
            compradorEstadoResidenciaNome: texto(corpo.compradorEstadoResidenciaNome),
            compradorCidadeResidenciaCompleta: texto(
              corpo.compradorCidadeResidenciaCompleta,
            ),
            compradorCidadeResidenciaCodigoIbge: texto(
              corpo.compradorCidadeResidenciaCodigoIbge,
            ),
            compradorCidadeResidenciaFonte: texto(
              corpo.compradorCidadeResidenciaFonte || "ibge",
            ),
            dataCompra: admin.firestore.FieldValue.serverTimestamp(),
            dataViagem,
            horarioSaida,
            gradeId,
            idViagem,
            origem,
            destino,
            passageiro: texto(passageiro.nome),
            documento: cpfMascarado(passageiro.documento),
            documentoMascarado: cpfMascarado(passageiro.documento),
            documentoFinal: cpfLimpo(passageiro.documento).slice(-4),
            nacionalidade: texto(passageiro.nacionalidade || "Brasileira"),
            nascimento: "",
            nascimentoInformado: Boolean(texto(passageiro.nascimento)),
            dadosSensiveisProtegidos: true,
            status: statusPassagem(texto(pagamento.status)),
            tipoVaga,
            refeicao: incluiRefeicao,
            valorPassagem: moeda(calculo.valorPassagens / rateio),
            valorRefeicao: moeda(calculo.valorAdicionais / rateio),
            taxaPlataformaRateada: moeda(calculo.receitaBrutaPlataforma / rateio),
            taxaPagaPassageiroRateada: moeda(calculo.taxaPagaPassageiro / rateio),
            taxaDescontadaArmadorRateada: moeda(calculo.taxaDescontadaArmador / rateio),
            valorTotalRateado: moeda(calculo.totalPagoPassageiro / rateio),
            valor: moeda(calculo.totalPagoPassageiro / rateio),
            validado: false,
          },
          { merge: true },
        );
      });

      batch.set(
        vendaRef,
        {
          bilhetesEmitidos: passageiros.length,
        },
        { merge: true },
      );

      await batch.commit();

      res.status(200).json({
        vendaId,
        id_transacao: pagamentoId,
        qr_code_copia_cola: qrCode,
        qr_code_base64: qrCodeBase64,
        status: texto(pagamento.status) || "pending",
        financeiro: {
          ...calculo,
          taxaProcessadorValor: taxaMp,
          receitaLiquidaPlataforma: receitaLiquida,
        },
      });
    } catch (error) {
      console.error("Erro em gerarPixSeguro:", error);

      if (error instanceof Error && error.message === "UNAUTHENTICATED") {
        res.status(401).json({
          erro: "Faça login novamente antes de comprar.",
        });
        return;
      }

      res.status(500).json({
        erro: error instanceof Error ? error.message : "Falha interna ao gerar o Pix.",
      });
    }
  },
);

export const webhookMercadoPagoCmb = onRequest(
  {
    region: REGIAO,
    cors: false,
    secrets: [mercadoPagoAccessToken],
    timeoutSeconds: 60,
  },
  async (req, res) => {
    try {
      const pagamentoId = texto(
        (req.body as Record<string, any>)?.data?.id ||
          req.query["data.id"] ||
          req.query.id,
      );

      if (!pagamentoId) {
        res.status(200).send("Ignorado");
        return;
      }

      const pagamento = await consultarPagamentoMercadoPago(
        pagamentoId,
        mercadoPagoAccessToken.value(),
      );
      const vendaId = texto(pagamento.external_reference);

      if (!vendaId) {
        res.status(200).send("Sem referência");
        return;
      }

      const vendaRef = db.collection("vendas").doc(vendaId);
      const vendaSnap = await vendaRef.get();

      if (!vendaSnap.exists) {
        res.status(200).send("Venda não localizada");
        return;
      }

      const venda = vendaSnap.data() || {};
      const valorEsperado = numero(venda.totalPagoPassageiro || venda.valorTotalCobrado);
      const valorRecebido = numero(pagamento.transaction_amount);
      const valorConfere = Math.abs(valorEsperado - valorRecebido) <= 0.01;
      const statusMp = texto(pagamento.status) || "pending";
      const taxaMp = taxaProcessador(pagamento);
      const receitaBruta = numero(
        venda.receitaBrutaPlataforma || venda.taxaPlataformaValor,
      );

      const atualizacaoVenda: Record<string, unknown> = {
        pagamentoId,
        statusPagamento: valorConfere ? statusMp : "valor_inconsistente",
        statusVenda: valorConfere ? statusVenda(statusMp) : "auditoria_necessaria",
        taxaProcessadorValor: taxaMp,
        receitaLiquidaPlataforma: moeda(receitaBruta - taxaMp),
        valorRecebido,
        valorPagamentoConfere: valorConfere,
        atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
      };

      if (statusMp === "approved" && valorConfere) {
        atualizacaoVenda.pagoEm = admin.firestore.FieldValue.serverTimestamp();
      }

      const passagensSnap = await db
        .collection("passagens")
        .where("vendaId", "==", vendaId)
        .get();
      const batch = db.batch();

      batch.set(vendaRef, atualizacaoVenda, { merge: true });

      passagensSnap.docs.forEach((documento) => {
        batch.set(
          documento.ref,
          {
            status: valorConfere ? statusPassagem(statusMp) : "AUDITORIA",
            pagamentoStatus: statusMp,
            atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      });

      await batch.commit();

      res.status(200).send("OK");
    } catch (error) {
      console.error("Erro no webhook Mercado Pago:", error);
      res.status(500).send("Erro");
    }
  },
);

export const sincronizarVendaPorPassagem = onDocumentWritten(
  {
    region: REGIAO,
    document: "passagens/{ticketId}",
  },
  async (event) => {
    const depois = event.data?.after;

    if (!depois?.exists) {
      return;
    }

    const passagem = depois.data() || {};
    const vendaId = texto(passagem.vendaId);

    if (!vendaId) {
      return;
    }

    const vendaRef = db.collection("vendas").doc(vendaId);
    const vendaSnap = await vendaRef.get();

    if (!vendaSnap.exists) {
      return;
    }

    const venda = vendaSnap.data() || {};
    const statusAtualVenda = normalizar(venda.statusPagamento);
    const statusAtualPassagem = texto(passagem.status).toUpperCase();

    if (statusAtualVenda === "approved" && statusAtualPassagem !== "APROVADO") {
      await depois.ref.set(
        {
          status: "APROVADO",
          atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return;
    }

    const passagensSnap = await db
      .collection("passagens")
      .where("vendaId", "==", vendaId)
      .get();

    await vendaRef.set(
      {
        bilhetesEmitidos: passagensSnap.size,
        atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  },
);

// ============================================================
// MÉTRICAS DA LANDING PAGE
// Registra somente dados agregados. IP, user-agent e identificador
// recebido são usados apenas para gerar um hash diário e não são salvos.
// ============================================================
const ORIGEM_LANDING_PERMITIDA =
  "https://cade-meu-barco-empresas.jandessonmoraes.chatgpt.site";

type EventoLanding = "visita" | "clique_download";
type OrigemLanding =
  | "instagram"
  | "whatsapp"
  | "facebook"
  | "google"
  | "direto"
  | "outros";
type DispositivoLanding = "celular" | "tablet" | "computador";

function dataManaus() {
  const partes = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Manaus",
    year: "numeric",
  }).formatToParts(new Date());
  const valor = Object.fromEntries(partes.map((parte) => [parte.type, parte.value]));
  return `${valor.year}-${valor.month}-${valor.day}`;
}

function origemLandingValida(valor: unknown): OrigemLanding {
  const origem = normalizar(valor).replace(/[^a-z]/g, "");
  const permitidas: OrigemLanding[] = [
    "instagram",
    "whatsapp",
    "facebook",
    "google",
    "direto",
    "outros",
  ];
  return permitidas.includes(origem as OrigemLanding)
    ? (origem as OrigemLanding)
    : "outros";
}

function dispositivoLandingValido(valor: unknown): DispositivoLanding {
  const dispositivo = normalizar(valor);
  if (dispositivo === "celular" || dispositivo === "tablet") {
    return dispositivo;
  }
  return "computador";
}

function primeiroIp(req: { ip?: string; headers: Record<string, unknown> }) {
  const encaminhado = texto(req.headers["x-forwarded-for"]);
  return encaminhado.split(",")[0]?.trim() || texto(req.ip) || "sem-ip";
}

export const registrarMetricaLanding = onRequest(
  {
    cors: [ORIGEM_LANDING_PERMITIDA],
    maxInstances: 10,
    region: REGIAO,
    timeoutSeconds: 15,
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ erro: "Método não permitido." });
      return;
    }

    const origemRequisicao = texto(req.headers.origin);
    if (origemRequisicao !== ORIGEM_LANDING_PERMITIDA) {
      res.status(403).json({ erro: "Origem não autorizada." });
      return;
    }

    const corpo = (req.body || {}) as Record<string, unknown>;
    const eventoInformado = texto(corpo.evento);
    if (eventoInformado !== "visita" && eventoInformado !== "clique_download") {
      res.status(400).json({ erro: "Evento inválido." });
      return;
    }

    const evento = eventoInformado as EventoLanding;
    const origem = origemLandingValida(corpo.origem);
    const dispositivo = dispositivoLandingValido(corpo.dispositivo);
    const identificadorCliente = texto(corpo.visitanteId).slice(0, 120);
    const agente = texto(req.headers["user-agent"]).slice(0, 300);
    const data = dataManaus();
    const visitanteHash = createHash("sha256")
      .update(
        [
          "CMB_METRICAS_LANDING_V1",
          data,
          primeiroIp(req),
          agente,
          identificadorCliente,
        ].join("|"),
      )
      .digest("hex");
    const janelaDezMinutos = Math.floor(Date.now() / 600000);
    const eventoId = createHash("sha256")
      .update(`${data}|${evento}|${visitanteHash}|${janelaDezMinutos}`)
      .digest("hex");

    const diaRef = db.collection("metricas_landing_diarias").doc(data);
    const visitanteRef = db
      .collection("metricas_landing_visitantes")
      .doc(`${data}_${visitanteHash}`);
    const eventoRef = db.collection("metricas_landing_eventos").doc(eventoId);

    try {
      const resultado = await db.runTransaction(async (transacao) => {
        const [eventoSnap, visitanteSnap] = await Promise.all([
          transacao.get(eventoRef),
          transacao.get(visitanteRef),
        ]);

        if (eventoSnap.exists) {
          return { duplicado: true };
        }

        const incremento = admin.firestore.FieldValue.increment(1);
        const dadosDia: Record<string, unknown> = {
          atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
          data,
        };

        if (evento === "visita") {
          dadosDia.visitas = incremento;
          dadosDia.origens = { [origem]: incremento };
          dadosDia.dispositivos = { [dispositivo]: incremento };

          if (!visitanteSnap.exists) {
            dadosDia.visitantesUnicos = incremento;
            transacao.create(visitanteRef, {
              criadoEm: admin.firestore.FieldValue.serverTimestamp(),
              data,
            });
          }
        } else {
          dadosDia.cliquesDownload = incremento;
        }

        transacao.set(diaRef, dadosDia, { merge: true });
        transacao.create(eventoRef, {
          criadoEm: admin.firestore.FieldValue.serverTimestamp(),
          data,
          evento,
        });
        return { duplicado: false };
      });

      res.status(200).json({ ok: true, ...resultado });
    } catch (error) {
      console.error("Erro ao registrar métrica da landing page:", error);
      res.status(500).json({ erro: "Não foi possível registrar a métrica." });
    }
  },
);

// =========================================================================
// 🧭 TRAJETO COMPLETO COMPACTADO PARA O APP
// Lê os pontos históricos no servidor, simplifica a linha e grava um cache.
// O celular recebe somente algumas centenas de coordenadas.
// =========================================================================

type CmbPontoTrajetoCompacto = {
  latitude: number;
  longitude: number;
  criadoEmMs: number;
};

function cmbNumeroSeguro(valor: any) {
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

function cmbDataMsTrajeto(valor: any): number {
  try {
    if (typeof valor?.toMillis === "function") return valor.toMillis();
    if (typeof valor?.toDate === "function") return valor.toDate().getTime();
    if (typeof valor?.seconds === "number") return valor.seconds * 1000;

    const data = new Date(valor);
    return Number.isNaN(data.getTime()) ? 0 : data.getTime();
  } catch {
    return 0;
  }
}

function cmbExtrairPontoTrajeto(
  dados: any,
  campoData: string,
): CmbPontoTrajetoCompacto | null {
  const latitude = cmbNumeroSeguro(dados?.latitude ?? dados?.lat);
  const longitude = cmbNumeroSeguro(dados?.longitude ?? dados?.lng);

  if (latitude === null || longitude === null || latitude === 0 || longitude === 0) {
    return null;
  }

  const criadoEmMs = cmbDataMsTrajeto(
    dados?.[campoData] ?? dados?.criado_em ?? dados?.criadoEm ?? dados?.timestamp,
  );

  return { latitude, longitude, criadoEmMs };
}

function cmbDistanciaTrajetoKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) {
  const raioTerraKm = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;

  const valor =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return raioTerraKm * 2 * Math.atan2(Math.sqrt(valor), Math.sqrt(1 - valor));
}

function cmbDistanciaPontoSegmentoKm(
  ponto: CmbPontoTrajetoCompacto,
  inicio: CmbPontoTrajetoCompacto,
  fim: CmbPontoTrajetoCompacto,
) {
  const x = ponto.longitude;
  const y = ponto.latitude;
  const x1 = inicio.longitude;
  const y1 = inicio.latitude;
  const x2 = fim.longitude;
  const y2 = fim.latitude;

  const dx = x2 - x1;
  const dy = y2 - y1;

  if (dx === 0 && dy === 0) {
    return cmbDistanciaTrajetoKm(ponto, inicio);
  }

  const t = Math.max(
    0,
    Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)),
  );

  return cmbDistanciaTrajetoKm(ponto, {
    latitude: y1 + t * dy,
    longitude: x1 + t * dx,
  });
}

function cmbSimplificarRdp(
  pontos: CmbPontoTrajetoCompacto[],
  toleranciaKm: number,
): CmbPontoTrajetoCompacto[] {
  if (pontos.length <= 2) return pontos;

  const primeiro = pontos[0];
  const ultimo = pontos[pontos.length - 1];
  let maiorDistancia = 0;
  let indiceMaior = 0;

  for (let i = 1; i < pontos.length - 1; i += 1) {
    const distancia = cmbDistanciaPontoSegmentoKm(pontos[i], primeiro, ultimo);

    if (distancia > maiorDistancia) {
      maiorDistancia = distancia;
      indiceMaior = i;
    }
  }

  if (maiorDistancia <= toleranciaKm) {
    return [primeiro, ultimo];
  }

  const esquerda = cmbSimplificarRdp(pontos.slice(0, indiceMaior + 1), toleranciaKm);
  const direita = cmbSimplificarRdp(pontos.slice(indiceMaior), toleranciaKm);

  return [...esquerda.slice(0, -1), ...direita];
}

function cmbPrepararTrajetoCompacto(
  pontosOriginais: CmbPontoTrajetoCompacto[],
  limite = 320,
) {
  if (pontosOriginais.length <= 2) return pontosOriginais;

  const filtrados: CmbPontoTrajetoCompacto[] = [pontosOriginais[0]];

  for (let i = 1; i < pontosOriginais.length; i += 1) {
    const atual = pontosOriginais[i];
    const anterior = filtrados[filtrados.length - 1];
    const distanciaKm = cmbDistanciaTrajetoKm(anterior, atual);
    const intervaloMs = Math.max(0, atual.criadoEmMs - anterior.criadoEmMs);

    // Mantém curvas e alterações relevantes, descartando pontos praticamente
    // idênticos. Um ponto temporal é preservado ao menos a cada cinco minutos.
    if (
      distanciaKm >= 0.025 ||
      intervaloMs >= 5 * 60 * 1000 ||
      i === pontosOriginais.length - 1
    ) {
      // Descarta um salto impossível ocorrido em pouco tempo.
      if (distanciaKm > 30 && intervaloMs > 0 && intervaloMs < 10 * 60 * 1000) {
        continue;
      }

      filtrados.push(atual);
    }
  }

  let simplificados = cmbSimplificarRdp(filtrados, 0.045);

  if (simplificados.length > limite) {
    const reduzidos: CmbPontoTrajetoCompacto[] = [];
    const passo = (simplificados.length - 1) / (limite - 1);

    for (let i = 0; i < limite; i += 1) {
      reduzidos.push(simplificados[Math.round(i * passo)]);
    }

    simplificados = reduzidos;
  }

  return simplificados.filter(
    (ponto, indice, lista) =>
      indice === 0 ||
      ponto.latitude !== lista[indice - 1].latitude ||
      ponto.longitude !== lista[indice - 1].longitude,
  );
}

async function cmbBuscarPontosPaginados({
  barcoId,
  campoData,
  inicioViagemMs,
  limiteDocumentos,
}: {
  barcoId: string;
  campoData: string;
  inicioViagemMs: number;
  limiteDocumentos: number;
}) {
  const referencia = db.collection("rastreamento").doc(barcoId).collection("pontos");

  const pontos: CmbPontoTrajetoCompacto[] = [];
  let cursor: any = null;
  let paginas = 0;
  const tamanhoPagina = 1000;
  const limiteInicio = inicioViagemMs
    ? inicioViagemMs - 30 * 60 * 1000
    : Date.now() - 10 * 24 * 60 * 60 * 1000;

  while (pontos.length < limiteDocumentos && paginas < 80) {
    let consulta: any = referencia.orderBy(campoData, "desc").limit(tamanhoPagina);

    if (cursor) consulta = consulta.startAfter(cursor);

    const snapshot = await consulta.get();
    if (snapshot.empty) break;

    for (const documento of snapshot.docs) {
      const ponto = cmbExtrairPontoTrajeto(documento.data(), campoData);
      if (ponto) pontos.push(ponto);
    }

    cursor = snapshot.docs[snapshot.docs.length - 1];
    paginas += 1;

    const pontoMaisAntigoPagina = pontos[pontos.length - 1];

    if (
      pontoMaisAntigoPagina?.criadoEmMs &&
      pontoMaisAntigoPagina.criadoEmMs <= limiteInicio
    ) {
      break;
    }

    if (snapshot.docs.length < tamanhoPagina) break;
  }

  return pontos;
}

function cmbSelecionarViagemAtual({
  pontos,
  inicioViagemMs,
  origemReferencia,
}: {
  pontos: CmbPontoTrajetoCompacto[];
  inicioViagemMs: number;
  origemReferencia: { latitude: number; longitude: number } | null;
}) {
  const ordenados = [...pontos].sort((a, b) => a.criadoEmMs - b.criadoEmMs);

  if (ordenados.length <= 2) return ordenados;

  if (inicioViagemMs) {
    const filtrados = ordenados.filter(
      (ponto) => !ponto.criadoEmMs || ponto.criadoEmMs >= inicioViagemMs - 30 * 60 * 1000,
    );

    if (filtrados.length > 1) return filtrados;
  }

  if (origemReferencia) {
    const ultimoMs = ordenados[ordenados.length - 1].criadoEmMs;
    let indiceOrigem = -1;

    for (let i = ordenados.length - 2; i >= 0; i -= 1) {
      const ponto = ordenados[i];

      if (ultimoMs && ponto.criadoEmMs && ultimoMs - ponto.criadoEmMs < 30 * 60 * 1000) {
        continue;
      }

      if (cmbDistanciaTrajetoKm(ponto, origemReferencia) <= 5) {
        indiceOrigem = i;
        break;
      }
    }

    if (indiceOrigem >= 0) return ordenados.slice(indiceOrigem);
  }

  // Sem programação ou origem oficial, considera como início da viagem o
  // ponto posterior ao último intervalo muito longo sem coordenadas.
  let indiceAposUltimaPausa = 0;

  for (let i = 1; i < ordenados.length; i += 1) {
    const intervalo = ordenados[i].criadoEmMs - ordenados[i - 1].criadoEmMs;

    if (intervalo >= 12 * 60 * 60 * 1000) {
      indiceAposUltimaPausa = i;
    }
  }

  return ordenados.slice(indiceAposUltimaPausa);
}

export const obterTrajetoCompletoEmbarcacao = onRequest(
  {
    region: "us-central1",
    cors: true,
    timeoutSeconds: 300,
    memory: "1GiB",
    invoker: "public",
  },
  async (req, res) => {
    try {
      if (req.method !== "POST") {
        res.status(405).json({ erro: "Use POST." });
        return;
      }

      const corpo = req.body || {};
      const idsRecebidos = [
        corpo.barcoId,
        ...(Array.isArray(corpo.barcoIds) ? corpo.barcoIds : []),
      ]
        .map((valor: any) => String(valor || "").trim())
        .filter(
          (valor: string) =>
            valor.length > 0 && valor.length <= 150 && !valor.includes("/"),
        );

      const barcoIds = Array.from(new Set(idsRecebidos)) as string[];

      if (barcoIds.length === 0) {
        res.status(400).json({ erro: "barcoId obrigatório." });
        return;
      }

      const inicioViagemMs = Math.max(0, Number(corpo.inicioViagemMs) || 0);
      const origemLat = cmbNumeroSeguro(
        corpo.origemReferencia?.latitude ?? corpo.origemReferencia?.lat,
      );
      const origemLng = cmbNumeroSeguro(
        corpo.origemReferencia?.longitude ?? corpo.origemReferencia?.lng,
      );
      const origemReferencia =
        origemLat !== null && origemLng !== null
          ? { latitude: origemLat, longitude: origemLng }
          : null;

      for (const barcoId of barcoIds) {
        const cacheRef = db.collection("trajetos_compactados").doc(barcoId);
        const cacheSnapshot = await cacheRef.get();

        if (cacheSnapshot.exists) {
          const cache = cacheSnapshot.data() || {};
          const atualizadoEmMs = Number(cache.atualizadoEmMs || 0);
          const mesmoInicio = Number(cache.inicioViagemMs || 0) === inicioViagemMs;
          const pontosCache = Array.isArray(cache.pontos) ? cache.pontos : [];

          if (
            mesmoInicio &&
            pontosCache.length > 1 &&
            Date.now() - atualizadoEmMs < 3 * 60 * 1000
          ) {
            res.status(200).json({
              barcoIdUsado: barcoId,
              pontos: pontosCache,
              cache: true,
              totalOriginal: Number(cache.totalOriginal || pontosCache.length),
            });
            return;
          }
        }

        let pontos: CmbPontoTrajetoCompacto[] = [];

        for (const campoData of ["criado_em", "criadoEm", "timestamp"]) {
          try {
            pontos = await cmbBuscarPontosPaginados({
              barcoId,
              campoData,
              inicioViagemMs,
              limiteDocumentos: 80000,
            });
          } catch (erroCampo) {
            console.log(
              `Trajeto ${barcoId}: campo ${campoData} indisponível.`,
              erroCampo,
            );
            pontos = [];
          }

          if (pontos.length > 1) break;
        }

        if (pontos.length <= 1) continue;

        const viagemAtual = cmbSelecionarViagemAtual({
          pontos,
          inicioViagemMs,
          origemReferencia,
        });

        const compactados = cmbPrepararTrajetoCompacto(viagemAtual, 320);

        if (compactados.length <= 1) continue;

        const respostaPontos = compactados.map((ponto) => ({
          latitude: ponto.latitude,
          longitude: ponto.longitude,
          criadoEmMs: ponto.criadoEmMs,
        }));

        await cacheRef.set(
          {
            barcoId,
            inicioViagemMs,
            atualizadoEmMs: Date.now(),
            atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
            totalOriginal: viagemAtual.length,
            totalCompactado: respostaPontos.length,
            pontos: respostaPontos,
          },
          { merge: true },
        );

        res.status(200).json({
          barcoIdUsado: barcoId,
          pontos: respostaPontos,
          cache: false,
          totalOriginal: viagemAtual.length,
        });
        return;
      }

      res.status(404).json({
        erro: "Nenhum ponto de rastreamento encontrado para os IDs enviados.",
        barcoIds,
      });
    } catch (error: any) {
      console.error("Erro ao montar trajeto completo:", error);
      res.status(500).json({
        erro: "Não foi possível montar o trajeto completo.",
      });
    }
  },
);

// =====================================================
// CMB — TRAJETO UNIVERSAL PARA TODAS AS EMBARCAÇÕES
// =====================================================
type CmbUniversalPonto = {
  latitude: number;
  longitude: number;
  criadoEmMs: number;
  ordem: number;
};

function cmbUniversalNumero(valor: any): number | null {
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

function cmbUniversalNormalizarId(valor: any): string {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function cmbUniversalVariantesIds(valores: any[]): string[] {
  const conjunto = new Set<string>();

  for (const valorBruto of valores) {
    const original = String(valorBruto || "").trim();
    if (!original || original.includes("/") || original.length > 150) continue;

    const normalizado = cmbUniversalNormalizarId(original);
    const semSeparador = normalizado.replace(/_/g, "");

    [
      original,
      original.toUpperCase(),
      original.toLowerCase(),
      normalizado,
      normalizado.replace(/_/g, " "),
      normalizado.replace(/_/g, "-"),
      semSeparador,
    ].forEach((item) => {
      const limpo = String(item || "").trim();
      if (limpo && !limpo.includes("/") && limpo.length <= 150) {
        conjunto.add(limpo);
      }
    });
  }

  return Array.from(conjunto).slice(0, 30);
}

function cmbUniversalDataDocumentoId(documentoId: string): number {
  const match = String(documentoId || "").match(
    /^(\d{4})(\d{2})(\d{2})[_-]?(\d{2})(\d{2})(\d{2})/,
  );

  if (!match) return 0;

  const [, ano, mes, dia, hora, minuto, segundo] = match;
  const valor = Date.UTC(
    Number(ano),
    Number(mes) - 1,
    Number(dia),
    Number(hora),
    Number(minuto),
    Number(segundo),
  );

  return Number.isFinite(valor) ? valor : 0;
}

function cmbUniversalDataMs(valor: any, documentoId = ""): number {
  try {
    if (typeof valor?.toMillis === "function") return valor.toMillis();
    if (typeof valor?.toDate === "function") return valor.toDate().getTime();
    if (typeof valor?.seconds === "number") return valor.seconds * 1000;
    if (typeof valor === "number" && Number.isFinite(valor)) {
      return valor < 10_000_000_000 ? valor * 1000 : valor;
    }

    const texto = String(valor || "").trim();
    if (texto && !texto.startsWith("sem_data_")) {
      const data = new Date(texto);
      if (!Number.isNaN(data.getTime())) return data.getTime();
    }
  } catch {
    // Continua para o ID do documento.
  }

  return cmbUniversalDataDocumentoId(documentoId);
}

function cmbUniversalExtrairPonto(
  dados: any,
  documentoId: string,
  ordem: number,
): CmbUniversalPonto | null {
  const latitude = cmbUniversalNumero(
    dados?.latitude ??
      dados?.lat ??
      dados?.posicao?.latitude ??
      dados?.posicao?.lat ??
      dados?.coordenadas?.latitude ??
      dados?.coordenadas?.lat,
  );
  const longitude = cmbUniversalNumero(
    dados?.longitude ??
      dados?.lng ??
      dados?.lon ??
      dados?.posicao?.longitude ??
      dados?.posicao?.lng ??
      dados?.posicao?.lon ??
      dados?.coordenadas?.longitude ??
      dados?.coordenadas?.lng ??
      dados?.coordenadas?.lon,
  );

  if (
    latitude === null ||
    longitude === null ||
    latitude === 0 ||
    longitude === 0 ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  ) {
    return null;
  }

  const criadoEmMs = cmbUniversalDataMs(
    dados?.criado_em ??
      dados?.criadoEm ??
      dados?.timestamp ??
      dados?.data ??
      dados?.salvoEm ??
      dados?.atualizadoEm,
    documentoId,
  );

  return { latitude, longitude, criadoEmMs, ordem };
}

function cmbUniversalDistanciaKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const raio = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const valor =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return raio * 2 * Math.atan2(Math.sqrt(valor), Math.sqrt(1 - valor));
}

function cmbUniversalDistanciaSegmentoKm(
  ponto: CmbUniversalPonto,
  inicio: CmbUniversalPonto,
  fim: CmbUniversalPonto,
): number {
  const x = ponto.longitude;
  const y = ponto.latitude;
  const x1 = inicio.longitude;
  const y1 = inicio.latitude;
  const x2 = fim.longitude;
  const y2 = fim.latitude;
  const dx = x2 - x1;
  const dy = y2 - y1;

  if (dx === 0 && dy === 0) return cmbUniversalDistanciaKm(ponto, inicio);

  const t = Math.max(
    0,
    Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)),
  );

  return cmbUniversalDistanciaKm(ponto, {
    latitude: y1 + t * dy,
    longitude: x1 + t * dx,
  });
}

function cmbUniversalRdp(
  pontos: CmbUniversalPonto[],
  toleranciaKm: number,
): CmbUniversalPonto[] {
  if (pontos.length <= 2) return pontos;

  const primeiro = pontos[0];
  const ultimo = pontos[pontos.length - 1];
  let maiorDistancia = 0;
  let indiceMaior = 0;

  for (let indice = 1; indice < pontos.length - 1; indice += 1) {
    const distancia = cmbUniversalDistanciaSegmentoKm(pontos[indice], primeiro, ultimo);

    if (distancia > maiorDistancia) {
      maiorDistancia = distancia;
      indiceMaior = indice;
    }
  }

  if (maiorDistancia <= toleranciaKm) return [primeiro, ultimo];

  const esquerda = cmbUniversalRdp(pontos.slice(0, indiceMaior + 1), toleranciaKm);
  const direita = cmbUniversalRdp(pontos.slice(indiceMaior), toleranciaKm);

  return [...esquerda.slice(0, -1), ...direita];
}

function cmbUniversalOrdenar(pontos: CmbUniversalPonto[]) {
  return [...pontos].sort((a, b) => {
    if (a.criadoEmMs && b.criadoEmMs && a.criadoEmMs !== b.criadoEmMs) {
      return a.criadoEmMs - b.criadoEmMs;
    }
    return a.ordem - b.ordem;
  });
}

function cmbUniversalSelecionarViagem({
  pontos,
  inicioViagemMs,
  origemReferencia,
}: {
  pontos: CmbUniversalPonto[];
  inicioViagemMs: number;
  origemReferencia: { latitude: number; longitude: number } | null;
}) {
  const ordenados = cmbUniversalOrdenar(pontos);
  if (ordenados.length <= 2) return ordenados;

  if (inicioViagemMs > 0) {
    const filtrados = ordenados.filter(
      (ponto) =>
        !ponto.criadoEmMs || ponto.criadoEmMs >= inicioViagemMs - 2 * 60 * 60 * 1000,
    );
    if (filtrados.length > 1) return filtrados;
  }

  if (origemReferencia) {
    let melhorIndice = -1;
    let menorDistancia = Number.POSITIVE_INFINITY;
    const ultimoMs = ordenados[ordenados.length - 1]?.criadoEmMs || 0;

    for (let indice = 0; indice < ordenados.length - 1; indice += 1) {
      const ponto = ordenados[indice];
      if (ultimoMs && ponto.criadoEmMs && ultimoMs - ponto.criadoEmMs < 20 * 60 * 1000) {
        continue;
      }

      const distancia = cmbUniversalDistanciaKm(ponto, origemReferencia);
      if (distancia < menorDistancia) {
        menorDistancia = distancia;
        melhorIndice = indice;
      }
    }

    if (melhorIndice >= 0 && menorDistancia <= 20) {
      return ordenados.slice(melhorIndice);
    }
  }

  let indiceAposPausa = 0;
  for (let indice = 1; indice < ordenados.length; indice += 1) {
    const anterior = ordenados[indice - 1];
    const atual = ordenados[indice];
    if (!anterior.criadoEmMs || !atual.criadoEmMs) continue;

    if (atual.criadoEmMs - anterior.criadoEmMs >= 8 * 60 * 60 * 1000) {
      indiceAposPausa = indice;
    }
  }

  return ordenados.slice(indiceAposPausa);
}

function cmbUniversalCompactar(pontosOriginais: CmbUniversalPonto[], limite = 400) {
  if (pontosOriginais.length <= 2) return pontosOriginais;

  const filtrados: CmbUniversalPonto[] = [pontosOriginais[0]];

  for (let indice = 1; indice < pontosOriginais.length; indice += 1) {
    const atual = pontosOriginais[indice];
    const anterior = filtrados[filtrados.length - 1];
    const distancia = cmbUniversalDistanciaKm(anterior, atual);
    const intervalo =
      atual.criadoEmMs && anterior.criadoEmMs
        ? atual.criadoEmMs - anterior.criadoEmMs
        : 0;

    if (distancia > 35 && intervalo > 0 && intervalo < 10 * 60 * 1000) {
      continue;
    }

    if (
      distancia >= 0.012 ||
      intervalo >= 3 * 60 * 1000 ||
      indice === pontosOriginais.length - 1
    ) {
      filtrados.push(atual);
    }
  }

  let simplificados = cmbUniversalRdp(filtrados, 0.025);

  if (simplificados.length > limite) {
    const reduzidos: CmbUniversalPonto[] = [];
    const passo = (simplificados.length - 1) / (limite - 1);
    for (let indice = 0; indice < limite; indice += 1) {
      reduzidos.push(simplificados[Math.round(indice * passo)]);
    }
    simplificados = reduzidos;
  }

  return simplificados.filter(
    (ponto, indice, lista) =>
      indice === 0 ||
      ponto.latitude !== lista[indice - 1].latitude ||
      ponto.longitude !== lista[indice - 1].longitude,
  );
}

async function cmbUniversalLerColecaoDireta({
  parentId,
  inicioViagemMs,
  limiteDocumentos,
}: {
  parentId: string;
  inicioViagemMs: number;
  limiteDocumentos: number;
}) {
  const referencia = db.collection("rastreamento").doc(parentId).collection("pontos");

  const pontos: CmbUniversalPonto[] = [];
  let cursor: any = null;
  let paginas = 0;
  let ordem = 0;
  const tamanhoPagina = 1000;
  const limiteAntigo = inicioViagemMs
    ? inicioViagemMs - 3 * 60 * 60 * 1000
    : Date.now() - 30 * 24 * 60 * 60 * 1000;

  while (pontos.length < limiteDocumentos && paginas < 120) {
    let consulta: any = referencia
      .orderBy(admin.firestore.FieldPath.documentId(), "desc")
      .limit(tamanhoPagina);

    if (cursor) consulta = consulta.startAfter(cursor);

    const snapshot = await consulta.get();
    if (snapshot.empty) break;

    let maisAntigoPagina = Number.POSITIVE_INFINITY;

    for (const documento of snapshot.docs) {
      const ponto = cmbUniversalExtrairPonto(documento.data(), documento.id, ordem);
      ordem += 1;
      if (!ponto) continue;
      pontos.push(ponto);
      if (ponto.criadoEmMs > 0) {
        maisAntigoPagina = Math.min(maisAntigoPagina, ponto.criadoEmMs);
      }
    }

    cursor = snapshot.docs[snapshot.docs.length - 1];
    paginas += 1;

    if (
      Number.isFinite(maisAntigoPagina) &&
      maisAntigoPagina <= limiteAntigo &&
      pontos.length > 1
    ) {
      break;
    }

    if (snapshot.docs.length < tamanhoPagina) break;
  }

  return pontos;
}

async function cmbUniversalDescobrirParentsPorCampos(aliases: string[]) {
  const encontrados = new Set<string>();
  const campos = ["barco_id", "barcoId", "embarcacaoId", "embarcacao_id"];

  for (const campo of campos) {
    for (let inicio = 0; inicio < aliases.length; inicio += 10) {
      const lote = aliases.slice(inicio, inicio + 10);
      if (lote.length === 0) continue;

      try {
        const snapshot = await db
          .collectionGroup("pontos")
          .where(campo, "in", lote)
          .limit(25)
          .get();

        for (const documento of snapshot.docs) {
          const parent = documento.ref.parent.parent;
          if (parent?.id) encontrados.add(parent.id);
        }
      } catch (error) {
        console.log(`Descoberta de trajeto pelo campo ${campo} falhou.`, error);
      }
    }
  }

  return Array.from(encontrados);
}

async function cmbUniversalDescobrirParentsPorNome(aliases: string[]) {
  const normalizados = new Set(aliases.map(cmbUniversalNormalizarId));
  const encontrados: string[] = [];

  try {
    const referencias = await db.collection("rastreamento").listDocuments();
    for (const referencia of referencias) {
      if (normalizados.has(cmbUniversalNormalizarId(referencia.id))) {
        encontrados.push(referencia.id);
      }
    }
  } catch (error) {
    console.log("Não foi possível listar os documentos de rastreamento.", error);
  }

  return encontrados;
}

export const obterTrajetoUniversalEmbarcacao = onRequest(
  {
    region: "us-central1",
    cors: true,
    timeoutSeconds: 300,
    memory: "1GiB",
    invoker: "public",
  },
  async (req, res) => {
    try {
      if (req.method !== "POST") {
        res.status(405).json({ erro: "Use POST." });
        return;
      }

      const corpo = req.body || {};
      const aliases = cmbUniversalVariantesIds([
        corpo.barcoId,
        ...(Array.isArray(corpo.barcoIds) ? corpo.barcoIds : []),
      ]);

      if (aliases.length === 0) {
        res.status(400).json({ erro: "Identificador da embarcação obrigatório." });
        return;
      }

      const inicioViagemMs = Math.max(0, Number(corpo.inicioViagemMs) || 0);
      const origemLat = cmbUniversalNumero(
        corpo.origemReferencia?.latitude ?? corpo.origemReferencia?.lat,
      );
      const origemLng = cmbUniversalNumero(
        corpo.origemReferencia?.longitude ?? corpo.origemReferencia?.lng,
      );
      const origemReferencia =
        origemLat !== null && origemLng !== null
          ? { latitude: origemLat, longitude: origemLng }
          : null;

      const chaveCache = cmbUniversalNormalizarId(aliases[0]);
      const cacheRef = db
        .collection("trajetos_compactados")
        .doc(`universal_${chaveCache}`);
      const cacheSnapshot = await cacheRef.get();

      if (cacheSnapshot.exists) {
        const cache = cacheSnapshot.data() || {};
        const pontosCache = Array.isArray(cache.pontos) ? cache.pontos : [];
        const mesmoInicio = Number(cache.inicioViagemMs || 0) === inicioViagemMs;
        const atualizadoEmMs = Number(cache.atualizadoEmMs || 0);

        if (
          mesmoInicio &&
          pontosCache.length > 1 &&
          Date.now() - atualizadoEmMs < 5 * 60 * 1000
        ) {
          res.status(200).json({
            pontos: pontosCache,
            cache: true,
            barcoIdUsado: String(cache.barcoIdUsado || aliases[0]),
            estrategia: String(cache.estrategia || "cache"),
            aliasesTestados: aliases,
            totalOriginal: Number(cache.totalOriginal || pontosCache.length),
          });
          return;
        }
      }

      const parents = new Set<string>(aliases);
      const encontradosCampo = await cmbUniversalDescobrirParentsPorCampos(aliases);
      encontradosCampo.forEach((id) => parents.add(id));
      const encontradosNome = await cmbUniversalDescobrirParentsPorNome(aliases);
      encontradosNome.forEach((id) => parents.add(id));

      const parentsTestados: string[] = [];
      let melhor: {
        parentId: string;
        pontos: CmbUniversalPonto[];
        viagem: CmbUniversalPonto[];
      } | null = null;

      for (const parentId of parents) {
        parentsTestados.push(parentId);
        let pontos = await cmbUniversalLerColecaoDireta({
          parentId,
          inicioViagemMs,
          limiteDocumentos: 100000,
        });

        if (pontos.length <= 1 && inicioViagemMs > 0) {
          pontos = await cmbUniversalLerColecaoDireta({
            parentId,
            inicioViagemMs: 0,
            limiteDocumentos: 100000,
          });
        }

        if (pontos.length <= 1) continue;

        const viagem = cmbUniversalSelecionarViagem({
          pontos,
          inicioViagemMs,
          origemReferencia,
        });

        if (viagem.length <= 1) continue;

        if (!melhor || viagem.length > melhor.viagem.length) {
          melhor = { parentId, pontos, viagem };
        }
      }

      if (!melhor) {
        res.status(404).json({
          erro: "Pontos existem, mas nenhum caminho compatível foi localizado.",
          aliasesTestados: aliases,
          parentsTestados,
        });
        return;
      }

      const compactados = cmbUniversalCompactar(melhor.viagem, 400);
      if (compactados.length <= 1) {
        res.status(404).json({
          erro: "Foram localizados pontos, mas não houve deslocamento suficiente.",
          barcoIdUsado: melhor.parentId,
          totalLido: melhor.pontos.length,
        });
        return;
      }

      const respostaPontos = compactados.map((ponto) => ({
        latitude: ponto.latitude,
        longitude: ponto.longitude,
        criadoEmMs: ponto.criadoEmMs,
      }));

      await cacheRef.set(
        {
          barcoIdUsado: melhor.parentId,
          inicioViagemMs,
          atualizadoEmMs: Date.now(),
          atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
          totalOriginal: melhor.viagem.length,
          totalCompactado: respostaPontos.length,
          estrategia: encontradosCampo.includes(melhor.parentId)
            ? "descoberta_por_barco_id_do_ponto"
            : "caminho_direto_ou_alias",
          aliasesTestados: aliases,
          parentsTestados,
          pontos: respostaPontos,
        },
        { merge: true },
      );

      res.status(200).json({
        pontos: respostaPontos,
        cache: false,
        barcoIdUsado: melhor.parentId,
        estrategia: encontradosCampo.includes(melhor.parentId)
          ? "descoberta_por_barco_id_do_ponto"
          : "caminho_direto_ou_alias",
        aliasesTestados: aliases,
        parentsTestados,
        totalLido: melhor.pontos.length,
        totalOriginal: melhor.viagem.length,
        totalCompactado: respostaPontos.length,
      });
    } catch (error: any) {
      console.error("Erro no trajeto universal:", error);
      res.status(500).json({
        erro: "Não foi possível localizar e compactar o trajeto.",
        detalhe: String(error?.message || error || "erro desconhecido"),
      });
    }
  },
);

// =========================================================================
// CMB — HISTÓRICO AUTOMÁTICO DOS RASTREADORES NOVOS
//
// O firmware LITE atualiza somente embarcacoes/{barcoId}. Esta função observa
// a posição oficial e cria o histórico em:
// rastreamento/{barcoId}/pontos/{pontoId}
//
// Não exige alteração no Arduino.
// =========================================================================

type CmbHistoricoPosicaoEmbarcacao = {
  latitude: number;
  longitude: number;
  velocidade: number;
  direcao: number;
  satelites: number;
  dataMs: number;
  dataOriginal: unknown;
};

function cmbHistoricoExtrairPosicao(
  dados: Record<string, any> | undefined,
  fallbackMs: number,
): CmbHistoricoPosicaoEmbarcacao | null {
  if (!dados) return null;

  const posicao = dados.ultima_posicao;
  const latitude = cmbUniversalNumero(
    posicao?.latitude ??
      posicao?.lat ??
      posicao?._latitude ??
      dados.latitude ??
      dados.lat,
  );
  const longitude = cmbUniversalNumero(
    posicao?.longitude ??
      posicao?.lng ??
      posicao?.lon ??
      posicao?._longitude ??
      dados.longitude ??
      dados.lng ??
      dados.lon,
  );

  if (
    latitude === null ||
    longitude === null ||
    latitude === 0 ||
    longitude === 0 ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  ) {
    return null;
  }

  const dataOriginal =
    dados.ultima_atualizacao ??
    posicao?.visto_por_ultimo ??
    dados.atualizadoEm ??
    dados.updatedAt;

  const dataMs = cmbUniversalDataMs(dataOriginal) || fallbackMs;

  return {
    latitude,
    longitude,
    velocidade:
      cmbUniversalNumero(
        posicao?.velocidade ?? posicao?.speed ?? dados.velocidade ?? dados.vel,
      ) ?? 0,
    direcao:
      cmbUniversalNumero(
        posicao?.direcao ??
          posicao?.rumo ??
          posicao?.course ??
          dados.direcao ??
          dados.rumo,
      ) ?? 0,
    satelites: cmbUniversalNumero(posicao?.satelites ?? dados.satelites) ?? 0,
    dataMs,
    dataOriginal,
  };
}

function cmbHistoricoMesmoPonto(
  a: CmbHistoricoPosicaoEmbarcacao | null,
  b: CmbHistoricoPosicaoEmbarcacao | null,
) {
  if (!a || !b) return false;

  return (
    Math.abs(a.latitude - b.latitude) < 0.0000001 &&
    Math.abs(a.longitude - b.longitude) < 0.0000001 &&
    a.dataMs === b.dataMs
  );
}

function cmbHistoricoAtualizarPontosCache(
  dadosCache: Record<string, any>,
  pontoNovo: CmbHistoricoPosicaoEmbarcacao,
) {
  const pontosOriginais = Array.isArray(dadosCache.pontos) ? dadosCache.pontos : [];

  if (pontosOriginais.length < 2) {
    return null;
  }

  const pontosValidos: CmbUniversalPonto[] = pontosOriginais
    .map((ponto: any, ordem: number) => {
      const latitude = cmbUniversalNumero(ponto?.latitude ?? ponto?.lat);
      const longitude = cmbUniversalNumero(ponto?.longitude ?? ponto?.lng ?? ponto?.lon);

      if (latitude === null || longitude === null || latitude === 0 || longitude === 0) {
        return null;
      }

      return {
        latitude,
        longitude,
        criadoEmMs:
          cmbUniversalDataMs(
            ponto?.criadoEmMs ?? ponto?.criado_em ?? ponto?.criadoEm ?? ponto?.timestamp,
          ) || ordem,
        ordem,
      };
    })
    .filter(
      (ponto: CmbUniversalPonto | null): ponto is CmbUniversalPonto => ponto !== null,
    );

  if (pontosValidos.length < 2) {
    return null;
  }

  const ultimo = pontosValidos[pontosValidos.length - 1];
  const distanciaUltimoKm = cmbUniversalDistanciaKm(ultimo, pontoNovo);

  if (
    distanciaUltimoKm < 0.004 &&
    Math.abs(pontoNovo.dataMs - ultimo.criadoEmMs) < 5 * 60 * 1000
  ) {
    return pontosOriginais;
  }

  const comNovoPonto: CmbUniversalPonto[] = [
    ...pontosValidos,
    {
      latitude: pontoNovo.latitude,
      longitude: pontoNovo.longitude,
      criadoEmMs: pontoNovo.dataMs,
      ordem: pontosValidos.length,
    },
  ];

  return cmbUniversalCompactar(cmbUniversalOrdenar(comNovoPonto), 400).map((ponto) => ({
    latitude: ponto.latitude,
    longitude: ponto.longitude,
    criadoEmMs: ponto.criadoEmMs,
  }));
}

export const registrarHistoricoAutomaticoGps = onDocumentWritten(
  {
    region: REGIAO,
    document: "embarcacoes/{barcoId}",
    maxInstances: 50,
  },
  async (event) => {
    const depois = event.data?.after;

    if (!depois?.exists) {
      return;
    }

    const barcoId = texto(event.params.barcoId);

    if (!barcoId || barcoId.length > 150 || barcoId.includes("/")) {
      console.log("Histórico GPS ignorado: barcoId inválido.", barcoId);
      return;
    }

    const eventoMs = cmbUniversalDataMs((event as any).time) || Date.now();
    const dadosDepois = (depois.data() || {}) as Record<string, any>;
    const dadosAntes = event.data?.before.exists
      ? ((event.data.before.data() || {}) as Record<string, any>)
      : undefined;

    const pontoDepois = cmbHistoricoExtrairPosicao(dadosDepois, eventoMs);
    const pontoAntes = cmbHistoricoExtrairPosicao(dadosAntes, eventoMs);

    if (!pontoDepois) {
      return;
    }

    // Alterações administrativas, de Wi-Fi ou de configuração não devem
    // criar pontos repetidos quando a posição oficial não mudou.
    if (cmbHistoricoMesmoPonto(pontoAntes, pontoDepois)) {
      return;
    }

    const distanciaAnteriorKm = pontoAntes
      ? cmbUniversalDistanciaKm(pontoAntes, pontoDepois)
      : Number.POSITIVE_INFINITY;
    const intervaloAnteriorMs = pontoAntes
      ? Math.abs(pontoDepois.dataMs - pontoAntes.dataMs)
      : Number.POSITIVE_INFINITY;

    const eventoId = texto((event as any).id);
    const hashPonto = createHash("sha256")
      .update(
        [
          barcoId,
          pontoDepois.latitude.toFixed(7),
          pontoDepois.longitude.toFixed(7),
          String(pontoDepois.dataMs),
          eventoId,
        ].join("|"),
      )
      .digest("hex")
      .slice(0, 24);
    const pontoId = `P_${pontoDepois.dataMs}_${hashPonto}`;

    const rastreamentoRef = db.collection("rastreamento").doc(barcoId);
    const pontoRef = rastreamentoRef.collection("pontos").doc(pontoId);
    const criadoEm = admin.firestore.Timestamp.fromMillis(pontoDepois.dataMs);
    const agoraServidor = admin.firestore.FieldValue.serverTimestamp();

    const cacheDiretoRef = db.collection("trajetos_compactados").doc(barcoId);
    const cacheUniversalRef = db
      .collection("trajetos_compactados")
      .doc(`universal_${cmbUniversalNormalizarId(barcoId)}`);

    const [rastreamentoSnap, cacheDiretoSnap, cacheUniversalSnap] = await Promise.all([
      rastreamentoRef.get(),
      cacheDiretoRef.get(),
      cacheUniversalRef.get(),
    ]);

    // Quando o barco estiver parado, preserva um ponto de referência a cada
    // cinco minutos. O primeiro ponto sempre é criado, mesmo sem deslocamento.
    if (
      distanciaAnteriorKm < 0.008 &&
      intervaloAnteriorMs > 0 &&
      intervaloAnteriorMs < 5 * 60 * 1000 &&
      rastreamentoSnap.exists
    ) {
      const ultimoPontoMs = cmbUniversalDataMs(rastreamentoSnap.data()?.ultimoPontoEm);

      if (ultimoPontoMs > 0 && pontoDepois.dataMs - ultimoPontoMs < 5 * 60 * 1000) {
        return;
      }
    }

    const batch = db.batch();

    // Cria também o documento-pai. Assim o ID passa a aparecer normalmente
    // na coleção rastreamento no Console do Firebase.
    batch.set(
      rastreamentoRef,
      {
        barcoId,
        barco_id: barcoId,
        nome:
          texto(
            dadosDepois.nome ||
              dadosDepois.nome_barco ||
              dadosDepois.nomeBarco ||
              dadosDepois.apelido,
          ) || barcoId,
        deviceId: texto(dadosDepois.deviceId || dadosDepois.rastreadorDeviceId),
        origemHistorico: "CLOUD_FUNCTION_EMBARCACOES",
        ativo: dadosDepois.ativo !== false,
        ultimoPontoId: pontoId,
        ultimoPontoEm: criadoEm,
        ultima_posicao: {
          latitude: pontoDepois.latitude,
          longitude: pontoDepois.longitude,
        },
        atualizadoEm: agoraServidor,
      },
      { merge: true },
    );

    batch.set(
      pontoRef,
      {
        barco_id: barcoId,
        barcoId,
        embarcacaoId: barcoId,
        latitude: pontoDepois.latitude,
        longitude: pontoDepois.longitude,
        velocidade: pontoDepois.velocidade,
        direcao: pontoDepois.direcao,
        satelites: Math.round(pontoDepois.satelites),
        criado_em: criadoEm,
        criadoEm,
        timestamp: criadoEm,
        dataOrigem: pontoDepois.dataOriginal ?? null,
        origem: "CLOUD_FUNCTION_EMBARCACOES",
        deviceId: texto(dadosDepois.deviceId || dadosDepois.rastreadorDeviceId),
        eventoId: eventoId || null,
        gravadoEm: agoraServidor,
      },
      { merge: false },
    );

    const caches = [
      {
        ref: cacheDiretoRef,
        snap: cacheDiretoSnap,
      },
      {
        ref: cacheUniversalRef,
        snap: cacheUniversalSnap,
      },
    ];

    for (const cache of caches) {
      if (!cache.snap.exists) {
        continue;
      }

      const dadosCache = (cache.snap.data() || {}) as Record<string, any>;
      const pontosAtualizados = cmbHistoricoAtualizarPontosCache(dadosCache, pontoDepois);

      if (!pontosAtualizados) {
        batch.set(
          cache.ref,
          {
            atualizadoEmMs: 0,
            invalidadoEm: agoraServidor,
            motivoInvalidacao: "novo_ponto_historico",
          },
          { merge: true },
        );
        continue;
      }

      batch.set(
        cache.ref,
        {
          pontos: pontosAtualizados,
          atualizadoEmMs: Date.now(),
          atualizadoEm: agoraServidor,
          ultimoPontoEm: criadoEm,
          totalCompactado: pontosAtualizados.length,
          totalOriginal: Math.max(
            (Number(dadosCache.totalOriginal) || 0) + 1,
            pontosAtualizados.length,
          ),
          cacheIncremental: true,
        },
        { merge: true },
      );
    }

    await batch.commit();

    console.log("Histórico GPS gravado.", {
      barcoId,
      pontoId,
      latitude: pontoDepois.latitude,
      longitude: pontoDepois.longitude,
    });
  },
);

// =========================================================================
// CMB — TRAJETO INTELIGENTE V3
// Cache durável, seleção da viagem atual e remoção de saltos de GPS.
// =========================================================================
type CmbV3CandidatoTrajeto = {
  parentId: string;
  pontosLidos: CmbUniversalPonto[];
  viagem: CmbUniversalPonto[];
  ultimoMs: number;
  distanciaAtualKm: number;
  idDireto: boolean;
};

function cmbV3RemoverPontosIsolados(pontos: CmbUniversalPonto[]) {
  if (pontos.length < 3) return pontos;

  const resultado: CmbUniversalPonto[] = [pontos[0]];

  for (let indice = 1; indice < pontos.length - 1; indice += 1) {
    const anterior = resultado[resultado.length - 1];
    const atual = pontos[indice];
    const proximo = pontos[indice + 1];

    const distanciaAnteriorAtual = cmbUniversalDistanciaKm(anterior, atual);
    const distanciaAtualProximo = cmbUniversalDistanciaKm(atual, proximo);
    const distanciaAnteriorProximo = cmbUniversalDistanciaKm(anterior, proximo);

    const isolado =
      distanciaAnteriorAtual > 3 &&
      distanciaAtualProximo > 3 &&
      distanciaAnteriorProximo <
        Math.min(2, Math.max(distanciaAnteriorAtual, distanciaAtualProximo) * 0.25);

    if (!isolado) {
      resultado.push(atual);
    }
  }

  resultado.push(pontos[pontos.length - 1]);
  return resultado;
}

function cmbV3SepararTrechos(pontosOriginais: CmbUniversalPonto[]) {
  const pontos = cmbV3RemoverPontosIsolados(cmbUniversalOrdenar(pontosOriginais));

  if (pontos.length < 2) return [];

  const trechos: CmbUniversalPonto[][] = [];
  let trechoAtual: CmbUniversalPonto[] = [pontos[0]];

  for (let indice = 1; indice < pontos.length; indice += 1) {
    const anterior = pontos[indice - 1];
    const atual = pontos[indice];
    const distanciaKm = cmbUniversalDistanciaKm(anterior, atual);
    const intervaloMs =
      anterior.criadoEmMs && atual.criadoEmMs
        ? Math.max(0, atual.criadoEmMs - anterior.criadoEmMs)
        : 0;
    const velocidadeCalculadaKmh =
      intervaloMs > 0 ? distanciaKm / (intervaloMs / 3_600_000) : 0;

    const saltoImpossivel =
      distanciaKm > 35 ||
      (intervaloMs <= 0 && distanciaKm > 8) ||
      (intervaloMs > 0 && distanciaKm > 1 && velocidadeCalculadaKmh > 95) ||
      (intervaloMs > 0 && intervaloMs < 60_000 && distanciaKm > 2.5);

    const novaViagem = intervaloMs >= 8 * 60 * 60 * 1000;

    if (saltoImpossivel || novaViagem) {
      if (trechoAtual.length > 1) {
        trechos.push(trechoAtual);
      }

      trechoAtual = [atual];
      continue;
    }

    trechoAtual.push(atual);
  }

  if (trechoAtual.length > 1) {
    trechos.push(trechoAtual);
  }

  return trechos;
}

function cmbV3SelecionarTrechoAtual({
  pontos,
  inicioViagemMs,
  origemReferencia,
  posicaoAtual,
}: {
  pontos: CmbUniversalPonto[];
  inicioViagemMs: number;
  origemReferencia: { latitude: number; longitude: number } | null;
  posicaoAtual: { latitude: number; longitude: number } | null;
}) {
  const viagemBase = cmbUniversalSelecionarViagem({
    pontos,
    inicioViagemMs,
    origemReferencia,
  });
  const trechos = cmbV3SepararTrechos(viagemBase);

  if (trechos.length === 0) return [];
  if (trechos.length === 1) return trechos[0];

  return [...trechos].sort((a, b) => {
    const ultimoA = a[a.length - 1];
    const ultimoB = b[b.length - 1];
    const distanciaA = posicaoAtual
      ? cmbUniversalDistanciaKm(ultimoA, posicaoAtual)
      : Number.POSITIVE_INFINITY;
    const distanciaB = posicaoAtual
      ? cmbUniversalDistanciaKm(ultimoB, posicaoAtual)
      : Number.POSITIVE_INFINITY;
    const pertoA = posicaoAtual && distanciaA <= 25 ? 1 : 0;
    const pertoB = posicaoAtual && distanciaB <= 25 ? 1 : 0;

    if (pertoA !== pertoB) {
      return pertoB - pertoA;
    }

    if (ultimoA.criadoEmMs !== ultimoB.criadoEmMs) {
      return ultimoB.criadoEmMs - ultimoA.criadoEmMs;
    }

    return distanciaA - distanciaB;
  })[0];
}

function cmbV3CandidatoMelhor(
  novo: CmbV3CandidatoTrajeto,
  atual: CmbV3CandidatoTrajeto | null,
  temPosicaoAtual: boolean,
) {
  if (!atual) return true;

  if (temPosicaoAtual) {
    const novoPerto = novo.distanciaAtualKm <= 25;
    const atualPerto = atual.distanciaAtualKm <= 25;

    if (novoPerto !== atualPerto) {
      return novoPerto;
    }

    if (Math.abs(novo.ultimoMs - atual.ultimoMs) > 5 * 60 * 1000) {
      return novo.ultimoMs > atual.ultimoMs;
    }

    if (Math.abs(novo.distanciaAtualKm - atual.distanciaAtualKm) > 1) {
      return novo.distanciaAtualKm < atual.distanciaAtualKm;
    }
  } else if (novo.ultimoMs !== atual.ultimoMs) {
    return novo.ultimoMs > atual.ultimoMs;
  }

  if (novo.idDireto !== atual.idDireto) {
    return novo.idDireto;
  }

  return novo.viagem.length > atual.viagem.length;
}

export const obterTrajetoInteligenteEmbarcacao = onRequest(
  {
    region: REGIAO,
    cors: true,
    timeoutSeconds: 300,
    memory: "1GiB",
    invoker: "public",
  },
  async (req, res) => {
    try {
      if (req.method !== "POST") {
        res.status(405).json({
          erro: "Use POST.",
        });
        return;
      }

      const corpo = (req.body || {}) as Record<string, any>;
      const aliases = cmbUniversalVariantesIds([
        corpo.barcoId,
        ...(Array.isArray(corpo.barcoIds) ? corpo.barcoIds : []),
      ]);

      if (aliases.length === 0) {
        res.status(400).json({
          erro: "Identificador da embarcação obrigatório.",
        });
        return;
      }

      const inicioViagemMs = Math.max(0, Number(corpo.inicioViagemMs) || 0);
      const origemLat = cmbUniversalNumero(
        corpo.origemReferencia?.latitude ?? corpo.origemReferencia?.lat,
      );
      const origemLng = cmbUniversalNumero(
        corpo.origemReferencia?.longitude ?? corpo.origemReferencia?.lng,
      );
      const origemReferencia =
        origemLat !== null && origemLng !== null
          ? {
              latitude: origemLat,
              longitude: origemLng,
            }
          : null;
      const atualLat = cmbUniversalNumero(
        corpo.posicaoAtual?.latitude ?? corpo.posicaoAtual?.lat,
      );
      const atualLng = cmbUniversalNumero(
        corpo.posicaoAtual?.longitude ?? corpo.posicaoAtual?.lng,
      );
      const posicaoAtual =
        atualLat !== null && atualLng !== null
          ? {
              latitude: atualLat,
              longitude: atualLng,
            }
          : null;

      const idOficialNormalizado = cmbUniversalNormalizarId(aliases[0]);
      const cacheRef = db
        .collection("trajetos_compactados")
        .doc(`universal_${idOficialNormalizado}`);
      const cacheSnapshot = await cacheRef.get();

      if (cacheSnapshot.exists) {
        const cache = (cacheSnapshot.data() || {}) as Record<string, any>;
        const pontosCache = Array.isArray(cache.pontos) ? cache.pontos : [];
        const mesmoInicio = Number(cache.inicioViagemMs || 0) === inicioViagemMs;
        const versao = Number(cache.versao || 0);
        const ultimoCache = pontosCache[pontosCache.length - 1];
        const distanciaCacheAtual =
          posicaoAtual && ultimoCache
            ? cmbUniversalDistanciaKm(
                {
                  latitude: Number(ultimoCache.latitude),
                  longitude: Number(ultimoCache.longitude),
                },
                posicaoAtual,
              )
            : 0;

        if (
          versao === 3 &&
          mesmoInicio &&
          pontosCache.length > 1 &&
          (!posicaoAtual ||
            (Number.isFinite(distanciaCacheAtual) && distanciaCacheAtual <= 25))
        ) {
          res.status(200).json({
            pontos: pontosCache,
            cache: true,
            versao: 3,
            barcoIdUsado: String(cache.barcoIdUsado || aliases[0]),
            estrategia: "cache_incremental_v3",
            totalOriginal: Number(cache.totalOriginal || pontosCache.length),
          });
          return;
        }
      }

      const parents = new Set<string>(aliases);
      const encontradosCampo = await cmbUniversalDescobrirParentsPorCampos(aliases);
      encontradosCampo.forEach((id) => parents.add(id));
      const encontradosNome = await cmbUniversalDescobrirParentsPorNome(aliases);
      encontradosNome.forEach((id) => parents.add(id));

      const parentsTestados: string[] = [];
      let melhor: CmbV3CandidatoTrajeto | null = null;

      for (const parentId of parents) {
        parentsTestados.push(parentId);

        let pontos = await cmbUniversalLerColecaoDireta({
          parentId,
          inicioViagemMs,
          limiteDocumentos: 30000,
        });

        if (pontos.length <= 1 && inicioViagemMs > 0) {
          pontos = await cmbUniversalLerColecaoDireta({
            parentId,
            inicioViagemMs: 0,
            limiteDocumentos: 30000,
          });
        }

        if (pontos.length <= 1) {
          continue;
        }

        const viagem = cmbV3SelecionarTrechoAtual({
          pontos,
          inicioViagemMs,
          origemReferencia,
          posicaoAtual,
        });

        if (viagem.length <= 1) {
          continue;
        }

        const ultimo = viagem[viagem.length - 1];
        const candidato: CmbV3CandidatoTrajeto = {
          parentId,
          pontosLidos: pontos,
          viagem,
          ultimoMs: Number(ultimo.criadoEmMs) || 0,
          distanciaAtualKm: posicaoAtual
            ? cmbUniversalDistanciaKm(ultimo, posicaoAtual)
            : Number.POSITIVE_INFINITY,
          idDireto: cmbUniversalNormalizarId(parentId) === idOficialNormalizado,
        };

        if (cmbV3CandidatoMelhor(candidato, melhor, Boolean(posicaoAtual))) {
          melhor = candidato;
        }
      }

      if (!melhor) {
        res.status(404).json({
          erro: "Nenhum trecho atual compatível foi localizado.",
          aliasesTestados: aliases,
          parentsTestados,
        });
        return;
      }

      const compactados = cmbUniversalCompactar(melhor.viagem, 180);

      if (compactados.length <= 1) {
        res.status(404).json({
          erro: "O trecho atual não possui deslocamento suficiente.",
          barcoIdUsado: melhor.parentId,
        });
        return;
      }

      const respostaPontos = compactados.map((ponto) => ({
        latitude: ponto.latitude,
        longitude: ponto.longitude,
        criadoEmMs: ponto.criadoEmMs,
      }));
      const ultimoPonto = compactados[compactados.length - 1];

      await cacheRef.set(
        {
          versao: 3,
          barcoIdUsado: melhor.parentId,
          inicioViagemMs,
          atualizadoEmMs: Date.now(),
          atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
          ultimoPontoMs: Number(ultimoPonto.criadoEmMs) || 0,
          totalOriginal: melhor.viagem.length,
          totalCompactado: respostaPontos.length,
          estrategia: melhor.idDireto
            ? "id_oficial_atual"
            : encontradosCampo.includes(melhor.parentId)
              ? "barco_id_do_ponto_atual"
              : "alias_mais_recente",
          aliasesTestados: aliases,
          parentsTestados,
          pontos: respostaPontos,
        },
        { merge: true },
      );

      res.status(200).json({
        pontos: respostaPontos,
        cache: false,
        versao: 3,
        barcoIdUsado: melhor.parentId,
        estrategia: melhor.idDireto
          ? "id_oficial_atual"
          : encontradosCampo.includes(melhor.parentId)
            ? "barco_id_do_ponto_atual"
            : "alias_mais_recente",
        totalOriginal: melhor.viagem.length,
        totalCompactado: respostaPontos.length,
        ultimoPontoMs: Number(ultimoPonto.criadoEmMs) || 0,
        distanciaAtualKm: melhor.distanciaAtualKm,
      });
    } catch (error) {
      console.error("Erro no trajeto inteligente V3:", error);
      res.status(500).json({
        erro: "Não foi possível montar o trajeto inteligente.",
      });
    }
  },
);
