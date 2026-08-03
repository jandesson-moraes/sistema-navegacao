import * as admin from "firebase-admin";
import { createHash } from "node:crypto";
import { defineSecret } from "firebase-functions/params";
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
const pilotoCompradorUid = defineSecret("CMB_PILOT_BUYER_UID");
const URL_WEBHOOK =
  `https://${REGIAO}-${PROJETO_ID}.cloudfunctions.net/webhookVendaMarketplace`;

type PassageiroRecebido = {
  nome?: string;
  documento?: string;
  nacionalidade?: string;
  nascimento?: string;
  beneficioId?: string;
  aceiteComprovacao?: boolean;
};

type RegraBeneficio = {
  id: string;
  nome: string;
  ativo: boolean;
  modo: "desconto_percentual" | "valor_fixo" | "gratuidade";
  valor: number;
  vagasPorSaida: number | null;
  idadeMinima: number | null;
  idadeMaxima: number | null;
  exigeComprovante: boolean;
  tiposVaga: TipoVagaVenda[];
  observacao: string;
};

const BENEFICIOS_PERMITIDOS = new Set([
  "crianca",
  "idoso",
  "pcd",
  "acompanhante_pcd",
  "jovem_baixa_renda",
  "estudante",
  "outro",
]);

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

function regrasBeneficios(tarifa: Record<string, unknown> | undefined) {
  const origem = Array.isArray(tarifa?.beneficios) ? tarifa.beneficios : [];
  return origem
    .map((item) => {
      const regra = (item || {}) as Record<string, unknown>;
      const id = texto(regra.id).toLowerCase();
      const modo = texto(regra.modo) as RegraBeneficio["modo"];
      const tiposVaga = Array.isArray(regra.tiposVaga)
        ? regra.tiposVaga
            .map((tipo) => texto(tipo).toLowerCase() as TipoVagaVenda)
            .filter((tipo) => ["rede", "poltrona", "suite"].includes(tipo))
        : [];
      return {
        id,
        nome: texto(regra.nome || id),
        ativo: regra.ativo === true,
        modo: ["desconto_percentual", "valor_fixo", "gratuidade"].includes(modo)
          ? modo
          : "desconto_percentual",
        valor: Math.max(0, numero(regra.valor)),
        vagasPorSaida: regra.vagasPorSaida === null || regra.vagasPorSaida === undefined
          ? null
          : Math.max(0, Math.floor(numero(regra.vagasPorSaida))),
        idadeMinima: regra.idadeMinima === null || regra.idadeMinima === undefined
          ? null
          : Math.max(0, Math.floor(numero(regra.idadeMinima))),
        idadeMaxima: regra.idadeMaxima === null || regra.idadeMaxima === undefined
          ? null
          : Math.max(0, Math.floor(numero(regra.idadeMaxima))),
        exigeComprovante: regra.exigeComprovante !== false,
        tiposVaga,
        observacao: texto(regra.observacao),
      } as RegraBeneficio;
    })
    .filter((regra) => regra.ativo && BENEFICIOS_PERMITIDOS.has(regra.id));
}

function idadeEmAnos(dataNascimento: unknown) {
  const partes = texto(dataNascimento).split("/").map(Number);
  if (partes.length !== 3) return null;
  const [dia, mes, ano] = partes;
  const nascimento = new Date(ano, mes - 1, dia);
  if (
    !Number.isFinite(nascimento.getTime()) ||
    nascimento.getDate() !== dia ||
    nascimento.getMonth() !== mes - 1 ||
    nascimento.getFullYear() !== ano
  ) return null;
  const hoje = new Date();
  let idade = hoje.getFullYear() - ano;
  if (
    hoje.getMonth() < mes - 1 ||
    (hoje.getMonth() === mes - 1 && hoje.getDate() < dia)
  ) idade -= 1;
  return idade;
}

function aplicarBeneficio(
  valorIntegral: number,
  passageiro: PassageiroRecebido,
  regras: RegraBeneficio[],
  tipoVaga: TipoVagaVenda,
) {
  const beneficioId = texto(passageiro.beneficioId || "integral").toLowerCase();
  if (!beneficioId || beneficioId === "integral") {
    return { valor: valorIntegral, beneficio: null as RegraBeneficio | null };
  }
  const beneficio = regras.find((regra) => regra.id === beneficioId);
  if (!beneficio) throw new Error("BENEFICIO_NAO_DISPONIVEL_NESTE_TRECHO");
  if (beneficio.tiposVaga.length > 0 && !beneficio.tiposVaga.includes(tipoVaga)) {
    throw new Error("BENEFICIO_NAO_DISPONIVEL_NESTA_ACOMODACAO");
  }
  if (beneficio.exigeComprovante && passageiro.aceiteComprovacao !== true) {
    throw new Error("COMPROVACAO_DO_BENEFICIO_NAO_CONFIRMADA");
  }
  const idade = idadeEmAnos(passageiro.nascimento);
  if (idade === null) throw new Error("DATA_NASCIMENTO_INVALIDA");
  if (beneficio.idadeMinima !== null && idade < beneficio.idadeMinima) {
    throw new Error("IDADE_NAO_ATENDE_AO_BENEFICIO");
  }
  if (beneficio.idadeMaxima !== null && idade > beneficio.idadeMaxima) {
    throw new Error("IDADE_NAO_ATENDE_AO_BENEFICIO");
  }
  const valor = beneficio.modo === "gratuidade"
    ? 0
    : beneficio.modo === "valor_fixo"
      ? Math.min(valorIntegral, beneficio.valor)
      : valorIntegral * (1 - Math.min(100, beneficio.valor) / 100);
  return {
    valor: Math.round(Math.max(0, valor) * 100) / 100,
    beneficio,
  };
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

function localizarTarifaTrecho(
  grade: Record<string, unknown>,
  origem: string,
  destino: string,
) {
  const tarifas = Array.isArray(grade.tarifasTrechos)
    ? grade.tarifasTrechos
    : [];
  if (tarifas.length === 0) return undefined;

  const itinerario = Array.isArray(grade.itinerario)
    ? grade.itinerario
    : Array.isArray(grade.escalas)
      ? grade.escalas
      : [];
  const encontrarPonto = (valor: string) => {
    const procurado = normalizar(valor).split(" - ")[0];
    return itinerario.find((item) => {
      const ponto = item as Record<string, unknown>;
      return [ponto.porto, ponto.nome, ponto.cidade].some(
        (campo) => normalizar(campo).split(" - ")[0] === procurado,
      );
    }) as Record<string, unknown> | undefined;
  };

  const pontoOrigem = encontrarPonto(origem);
  const pontoDestino = encontrarPonto(destino);
  const origemId = texto(pontoOrigem?.portoId || pontoOrigem?.id);
  const destinoId = texto(pontoDestino?.portoId || pontoDestino?.id);
  const origemNormalizada = normalizar(origem).split(" - ")[0];
  const destinoNormalizado = normalizar(destino).split(" - ")[0];

  return tarifas.find((item) => {
    const tarifa = item as Record<string, unknown>;
    if (tarifa.ativo === false) return false;
    const correspondeIds =
      origemId &&
      destinoId &&
      texto(tarifa.origemPortoId) === origemId &&
      texto(tarifa.destinoPortoId) === destinoId;
    const correspondeNomes =
      normalizar(tarifa.origemNome || tarifa.origem).split(" - ")[0] ===
        origemNormalizada &&
      normalizar(tarifa.destinoNome || tarifa.destino).split(" - ")[0] ===
        destinoNormalizado;
    return correspondeIds || correspondeNomes;
  }) as Record<string, unknown> | undefined;
}

function preco(
  grade: Record<string, unknown>,
  parada: Record<string, unknown>,
  tipo: TipoVagaVenda,
  origem: string,
  destino: string,
) {
  const tarifa = localizarTarifaTrecho(grade, origem, destino) || parada;
  if (tipo === "poltrona") {
    return primeiroNumero(tarifa, ["preco_poltrona", "precoPoltrona"]);
  }
  if (tipo === "suite") {
    return primeiroNumero(tarifa, ["preco_suite", "precoSuite"]);
  }
  return primeiroNumero(tarifa, [
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
  const modoPilotoMarketplace = vendas.modoPilotoMarketplace === true;
  return {
    ativa:
      financeiro.status === "ativo" &&
      (
        modoPilotoMarketplace ||
        (vendas.ativa === true && financeiro.vendaPassagemHabilitada === true)
      ),
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
      pilotoCompradorUid,
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
      const uidPiloto = texto(pilotoCompradorUid.value());
      if (!uidPiloto || usuario.uid !== uidPiloto) {
        res.status(403).json({ erro: "PILOTO_RESTRITO_A_USUARIO_AUTORIZADO" });
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
      if (grade.ativo === false || grade.publicadoParaVenda === false) {
        res.status(403).json({ erro: "VIAGEM_SUSPENSA_PARA_VENDA" });
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
      const tarifaTrecho = localizarTarifaTrecho(grade, origem, destino);
      const valorUnitarioPassagem = preco(
        grade,
        parada,
        tipoVaga,
        origem,
        destino,
      );
      const capacidadeOficial = capacidade(grade, tipoVaga);
      if (valorUnitarioPassagem <= 0) throw new Error("PRECO_OFICIAL_NAO_CONFIGURADO");
      if (capacidadeOficial <= 0) throw new Error("CAPACIDADE_OFICIAL_NAO_CONFIGURADA");

      const valorUnitarioRefeicao = incluiRefeicao
        ? primeiroNumero(tarifaTrecho || parada, [
            "preco_refeicao",
            "precoRefeicao",
          ])
        : 0;
      const beneficiosDisponiveis = regrasBeneficios(tarifaTrecho);
      const precosPassageiros = passageiros.map((passageiro) =>
        aplicarBeneficio(
          valorUnitarioPassagem,
          passageiro,
          beneficiosDisponiveis,
          tipoVaga,
        ),
      );
      for (const regra of beneficiosDisponiveis) {
        if (regra.vagasPorSaida === null) continue;
        const solicitadas = precosPassageiros.filter(
          (item) => item.beneficio?.id === regra.id,
        ).length;
        if (solicitadas > regra.vagasPorSaida) {
          throw new Error("LIMITE_DE_VAGAS_DO_BENEFICIO_EXCEDIDO");
        }
      }
      const calculo = calcularVendaNoServidor({
        regra: config.regra,
        quantidade: passageiros.length,
        valorUnitarioPassagem,
        valoresPassagens: precosPassageiros.map((item) => item.valor),
        valorAdicionais: valorUnitarioRefeicao * passageiros.length,
      });
      if (calculo.valorPassagens < 0.01) {
        throw new Error("GRATUIDADE_INTEGRAL_REQUER_VALIDACAO_DA_EQUIPE");
      }
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
        const reservaAindaValida =
          (dados.reservaExpiraEm?.toMillis?.() || 0) > Date.now();
        if (texto(dados.checkoutInitPoint) && reservaAindaValida) {
          res.status(200).json({
            vendaId,
            checkoutUrl: texto(dados.checkoutInitPoint),
            preferenciaId: texto(dados.preferenciaId),
            status: texto(dados.statusVenda),
            expiraEm: dados.reservaExpiraEm.toDate().toISOString(),
          });
          return;
        }
        if (texto(dados.checkoutInitPoint) && !reservaAindaValida) {
          res.status(409).json({ erro: "CHECKOUT_EXPIRADO_GERE_NOVA_TENTATIVA" });
          return;
        }
      }

      const reserva = await criarReservaVagasTransacional({
        reservaId,
        vendaId,
        compradorUid: usuario.uid,
        barcoId,
        gradeId,
        idViagem,
        tipoVaga,
        quantidade: passageiros.length,
        capacidade: capacidadeOficial,
        beneficios: beneficiosDisponiveis
          .filter((regra) => regra.vagasPorSaida !== null)
          .map((regra) => ({
            id: regra.id,
            quantidade: precosPassageiros.filter(
              (item) => item.beneficio?.id === regra.id,
            ).length,
            limitePorSaida: regra.vagasPorSaida || 0,
          }))
          .filter((item) => item.quantidade > 0 && item.limitePorSaida > 0),
        duracaoMinutos: 15,
      });
      if (!reserva.expiraEm) throw new Error("EXPIRACAO_RESERVA_NAO_DEFINIDA");
      const expiraEmIso = reserva.expiraEm.toDate().toISOString();

      const nomeBarco = texto(barco.nome || barco.nome_barco || barcoId);
      const emailComprador = texto(usuario.email || corpo.email);
      await Promise.all([
        vendaRef.set(
          {
            vendaId,
            reservaId,
            reservaExpiraEm: reserva.expiraEm,
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
            beneficiosResumo: precosPassageiros
              .filter((item) => item.beneficio)
              .map((item) => ({
                id: item.beneficio?.id,
                nome: item.beneficio?.nome,
                modo: item.beneficio?.modo,
                valorPassagem: item.valor,
                comprovacaoNoEmbarque: item.beneficio?.exigeComprovante === true,
              })),
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
            beneficioId: texto(item.beneficioId || "integral"),
            aceiteComprovacao: item.aceiteComprovacao === true,
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
          expires: true,
          expiration_date_from: new Date().toISOString(),
          expiration_date_to: expiraEmIso,
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
        expiraEm: expiraEmIso,
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
          codigo.includes("VAGAS_INSUFICIENTES") ||
          codigo.includes("LIMITE_DE_VAGAS") ||
          codigo.includes("GRATUIDADE_INTEGRAL") ? 409 :
            codigo.includes("BENEFICIO") ||
            codigo.includes("COMPROVACAO") ||
            codigo.includes("IDADE_") ||
            codigo.includes("DATA_NASCIMENTO") ? 400 : 500;
      res.status(status).json({ erro: codigo });
    }
  },
);
