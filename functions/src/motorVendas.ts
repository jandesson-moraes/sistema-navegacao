/**
 * Motor financeiro do backend.
 *
 * Este arquivo não cria o pagamento sozinho. Ele deve ser chamado pela
 * Cloud Function responsável por:
 * 1. autenticar o passageiro;
 * 2. buscar o preço verdadeiro no Firestore;
 * 3. verificar a capacidade;
 * 4. buscar a regra da embarcação;
 * 5. calcular a venda;
 * 6. criar o Pix/Checkout;
 * 7. salvar a venda com o snapshot imutável da taxa.
 */

export type TipoTaxaVenda =
  | "percentual"
  | "fixa_por_passagem"
  | "fixa_por_venda"
  | "percentual_mais_fixa";

export type RegraTaxaVenda = {
  ativa?: boolean;
  tipo?: TipoTaxaVenda;
  percentual?: number;
  valorFixo?: number;
  responsavel?: "passageiro" | "armador" | "dividida";
  percentualPagoPassageiro?: number;
  baseCalculo?: "somente_passagens" | "passagens_e_adicionais";
  valorMinimo?: number | null;
  valorMaximo?: number | null;
  vigenciaInicio?: string | null;
  vigenciaFim?: string | null;
};

function numero(valor: unknown, padrao = 0) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : padrao;
}

function moeda(valor: number) {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}

function regraVigente(regra: RegraTaxaVenda) {
  if (regra.ativa === false) return false;

  const agora = new Date();
  const inicio = regra.vigenciaInicio
    ? new Date(`${regra.vigenciaInicio}T00:00:00`)
    : null;
  const fim = regra.vigenciaFim
    ? new Date(`${regra.vigenciaFim}T23:59:59`)
    : null;

  if (inicio && agora < inicio) return false;
  if (fim && agora > fim) return false;

  return true;
}

export function calcularVendaNoServidor({
  regra,
  quantidade,
  valorUnitarioPassagem,
  valorAdicionais,
  taxaProcessadorValor = 0,
}: {
  regra: RegraTaxaVenda;
  quantidade: number;
  valorUnitarioPassagem: number;
  valorAdicionais: number;
  taxaProcessadorValor?: number;
}) {
  const quantidadePassagens = Math.max(1, Math.floor(numero(quantidade, 1)));
  const valorUnitario = Math.max(0, numero(valorUnitarioPassagem));
  const valorPassagens = moeda(quantidadePassagens * valorUnitario);
  const adicionais = moeda(Math.max(0, numero(valorAdicionais)));

  const baseCalculoTaxa = moeda(
    regra.baseCalculo === "passagens_e_adicionais"
      ? valorPassagens + adicionais
      : valorPassagens,
  );

  const tipo = regra.tipo || "percentual";
  const percentual = Math.max(0, numero(regra.percentual));
  const fixo = Math.max(0, numero(regra.valorFixo));
  const aplicarTaxa = regraVigente(regra);

  const percentualCalculado =
    aplicarTaxa &&
    (tipo === "percentual" || tipo === "percentual_mais_fixa")
      ? moeda(baseCalculoTaxa * (percentual / 100))
      : 0;

  let fixoCalculado = 0;

  if (aplicarTaxa && tipo === "fixa_por_passagem") {
    fixoCalculado = moeda(fixo * quantidadePassagens);
  } else if (aplicarTaxa && tipo === "fixa_por_venda") {
    fixoCalculado = moeda(fixo);
  } else if (aplicarTaxa && tipo === "percentual_mais_fixa") {
    fixoCalculado = moeda(fixo * quantidadePassagens);
  }

  let valorTaxaTotal = moeda(percentualCalculado + fixoCalculado);

  if (aplicarTaxa && regra.valorMinimo !== null && regra.valorMinimo !== undefined) {
    valorTaxaTotal = Math.max(valorTaxaTotal, numero(regra.valorMinimo));
  }

  if (aplicarTaxa && regra.valorMaximo !== null && regra.valorMaximo !== undefined) {
    valorTaxaTotal = Math.min(valorTaxaTotal, numero(regra.valorMaximo));
  }

  valorTaxaTotal = moeda(valorTaxaTotal);

  let taxaPagaPassageiro = 0;
  let taxaDescontadaArmador = 0;
  const responsavel = regra.responsavel || "passageiro";

  if (responsavel === "passageiro") {
    taxaPagaPassageiro = valorTaxaTotal;
  } else if (responsavel === "armador") {
    taxaDescontadaArmador = valorTaxaTotal;
  } else {
    const partePassageiro = Math.min(
      100,
      Math.max(0, numero(regra.percentualPagoPassageiro, 100)),
    );

    taxaPagaPassageiro = moeda(valorTaxaTotal * (partePassageiro / 100));
    taxaDescontadaArmador = moeda(valorTaxaTotal - taxaPagaPassageiro);
  }

  const valorBrutoArmador = moeda(valorPassagens + adicionais);
  const totalPagoPassageiro = moeda(valorBrutoArmador + taxaPagaPassageiro);
  const valorLiquidoArmador = moeda(
    Math.max(0, valorBrutoArmador - taxaDescontadaArmador),
  );
  const taxaProcessador = moeda(Math.max(0, numero(taxaProcessadorValor)));
  const receitaLiquidaPlataforma = moeda(valorTaxaTotal - taxaProcessador);

  return {
    quantidadePassagens,
    valorUnitarioPassagem: valorUnitario,
    valorPassagens,
    valorAdicionais: adicionais,
    baseCalculoTaxa,

    valorTaxaPercentual: percentualCalculado,
    valorTaxaFixa: fixoCalculado,
    valorTaxaTotal,
    taxaPagaPassageiro,
    taxaDescontadaArmador,

    valorBrutoArmador,
    totalPagoPassageiro,
    valorLiquidoArmador,

    receitaBrutaPlataforma: valorTaxaTotal,
    taxaProcessadorValor: taxaProcessador,
    receitaLiquidaPlataforma,

    taxaAplicada: {
      ativa: aplicarTaxa,
      tipo,
      percentual,
      valorFixo: fixo,
      responsavel,
      percentualPagoPassageiro: regra.percentualPagoPassageiro ?? 100,
      baseCalculo: regra.baseCalculo || "somente_passagens",
      valorMinimo: regra.valorMinimo ?? null,
      valorMaximo: regra.valorMaximo ?? null,
      vigenciaInicio: regra.vigenciaInicio ?? null,
      vigenciaFim: regra.vigenciaFim ?? null,

      baseCalculoTaxa,
      valorTaxaPercentual: percentualCalculado,
      valorTaxaFixa: fixoCalculado,
      valorTaxaTotal,
      taxaPagaPassageiro,
      taxaDescontadaArmador,
    },
  };
}
