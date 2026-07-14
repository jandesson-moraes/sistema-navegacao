import type {
  ConfiguracaoVendasPassagens,
  EntradaCalculoVenda,
  RegraTaxaVenda,
  ResultadoCalculoVenda,
} from "../types/vendas";

export const REGRA_TAXA_PADRAO: RegraTaxaVenda = {
  ativa: true,
  tipo: "percentual",
  percentual: 8,
  valorFixo: 0,
  responsavel: "passageiro",
  percentualPagoPassageiro: 100,
  baseCalculo: "somente_passagens",
  valorMinimo: null,
  valorMaximo: null,
  vigenciaInicio: null,
  vigenciaFim: null,
};

export const CONFIGURACAO_VENDAS_PADRAO: ConfiguracaoVendasPassagens = {
  ativa: false,
  regraTaxa: REGRA_TAXA_PADRAO,
  pagamento: {
    pixAtivo: true,
    mercadoPagoConectado: false,
    vendedorMercadoPagoId: "",
  },
  limiteHorasAntesSaida: 2,
};

export function arredondarMoeda(valor: number): number {
  const numero = Number(valor || 0);
  return Math.round((numero + Number.EPSILON) * 100) / 100;
}

function numeroSeguro(valor: unknown, padrao = 0): number {
  const numero = Number(String(valor ?? "").replace(",", "."));
  return Number.isFinite(numero) ? numero : padrao;
}

function limitar(valor: number, minimo: number | null, maximo: number | null) {
  let resultado = valor;

  if (minimo !== null && Number.isFinite(minimo)) {
    resultado = Math.max(resultado, minimo);
  }

  if (maximo !== null && Number.isFinite(maximo) && maximo >= 0) {
    resultado = Math.min(resultado, maximo);
  }

  return resultado;
}

export function normalizarRegraTaxa(
  regra?: Partial<RegraTaxaVenda> | null,
): RegraTaxaVenda {
  const percentualPagoPassageiro = Math.min(
    100,
    Math.max(0, numeroSeguro(regra?.percentualPagoPassageiro, 100)),
  );

  return {
    ...REGRA_TAXA_PADRAO,
    ...regra,
    ativa: regra?.ativa !== false,
    percentual: Math.max(0, numeroSeguro(regra?.percentual, 0)),
    valorFixo: Math.max(0, numeroSeguro(regra?.valorFixo, 0)),
    percentualPagoPassageiro,
    valorMinimo:
      regra?.valorMinimo === null ||
      regra?.valorMinimo === undefined ||
      regra?.valorMinimo === ("" as unknown)
        ? null
        : Math.max(0, numeroSeguro(regra.valorMinimo)),
    valorMaximo:
      regra?.valorMaximo === null ||
      regra?.valorMaximo === undefined ||
      regra?.valorMaximo === ("" as unknown)
        ? null
        : Math.max(0, numeroSeguro(regra.valorMaximo)),
    vigenciaInicio: regra?.vigenciaInicio || null,
    vigenciaFim: regra?.vigenciaFim || null,
  };
}

export function normalizarConfiguracaoVendas(
  configuracao?: Partial<ConfiguracaoVendasPassagens> | null,
): ConfiguracaoVendasPassagens {
  return {
    ...CONFIGURACAO_VENDAS_PADRAO,
    ...configuracao,
    ativa: configuracao?.ativa === true,
    regraTaxa: normalizarRegraTaxa(configuracao?.regraTaxa),
    pagamento: {
      ...CONFIGURACAO_VENDAS_PADRAO.pagamento,
      ...(configuracao?.pagamento || {}),
      pixAtivo: configuracao?.pagamento?.pixAtivo !== false,
      mercadoPagoConectado: configuracao?.pagamento?.mercadoPagoConectado === true,
      vendedorMercadoPagoId: configuracao?.pagamento?.vendedorMercadoPagoId || "",
    },
    limiteHorasAntesSaida: Math.max(
      0,
      numeroSeguro(configuracao?.limiteHorasAntesSaida, 2),
    ),
  };
}

export function regraEstaVigente(regra: RegraTaxaVenda, dataReferencia = new Date()) {
  if (!regra.ativa) return false;

  const inicio = regra.vigenciaInicio
    ? new Date(`${regra.vigenciaInicio}T00:00:00`)
    : null;
  const fim = regra.vigenciaFim ? new Date(`${regra.vigenciaFim}T23:59:59`) : null;

  if (inicio && dataReferencia < inicio) return false;
  if (fim && dataReferencia > fim) return false;

  return true;
}

export function calcularTaxaVenda(
  regraRecebida: Partial<RegraTaxaVenda> | null | undefined,
  entrada: EntradaCalculoVenda,
): ResultadoCalculoVenda {
  const regra = normalizarRegraTaxa(regraRecebida);

  const quantidadePassagens = Math.max(
    1,
    Math.floor(numeroSeguro(entrada.quantidadePassagens, 1)),
  );
  const valorUnitarioPassagem = Math.max(0, numeroSeguro(entrada.valorUnitarioPassagem));
  const valorPassagens = arredondarMoeda(quantidadePassagens * valorUnitarioPassagem);
  const valorAdicionais = arredondarMoeda(
    Math.max(0, numeroSeguro(entrada.valorAdicionais)),
  );

  const baseCalculoTaxa = arredondarMoeda(
    regra.baseCalculo === "passagens_e_adicionais"
      ? valorPassagens + valorAdicionais
      : valorPassagens,
  );

  let valorTaxaPercentual = 0;
  let valorTaxaFixa = 0;

  if (regra.tipo === "percentual" || regra.tipo === "percentual_mais_fixa") {
    valorTaxaPercentual = arredondarMoeda(baseCalculoTaxa * (regra.percentual / 100));
  }

  if (regra.tipo === "fixa_por_passagem") {
    valorTaxaFixa = arredondarMoeda(regra.valorFixo * quantidadePassagens);
  }

  if (regra.tipo === "fixa_por_venda") {
    valorTaxaFixa = arredondarMoeda(regra.valorFixo);
  }

  if (regra.tipo === "percentual_mais_fixa") {
    // No modelo híbrido, o valor fixo é aplicado por passagem.
    valorTaxaFixa = arredondarMoeda(regra.valorFixo * quantidadePassagens);
  }

  const valorTaxaAntesDosLimites = arredondarMoeda(valorTaxaPercentual + valorTaxaFixa);

  const valorTaxaTotal = regraEstaVigente(regra)
    ? arredondarMoeda(
        limitar(valorTaxaAntesDosLimites, regra.valorMinimo, regra.valorMaximo),
      )
    : 0;

  let taxaPagaPassageiro = 0;
  let taxaDescontadaArmador = 0;

  if (regra.responsavel === "passageiro") {
    taxaPagaPassageiro = valorTaxaTotal;
  } else if (regra.responsavel === "armador") {
    taxaDescontadaArmador = valorTaxaTotal;
  } else {
    taxaPagaPassageiro = arredondarMoeda(
      valorTaxaTotal * (regra.percentualPagoPassageiro / 100),
    );
    taxaDescontadaArmador = arredondarMoeda(valorTaxaTotal - taxaPagaPassageiro);
  }

  const valorBrutoArmador = arredondarMoeda(valorPassagens + valorAdicionais);
  const totalPagoPassageiro = arredondarMoeda(valorBrutoArmador + taxaPagaPassageiro);
  const valorLiquidoArmador = arredondarMoeda(
    Math.max(0, valorBrutoArmador - taxaDescontadaArmador),
  );

  const taxaProcessadorValor = arredondarMoeda(
    Math.max(0, numeroSeguro(entrada.taxaProcessadorValor)),
  );
  const receitaBrutaPlataforma = valorTaxaTotal;
  const receitaLiquidaPlataforma = arredondarMoeda(
    receitaBrutaPlataforma - taxaProcessadorValor,
  );

  return {
    quantidadePassagens,
    valorUnitarioPassagem,
    valorPassagens,
    valorAdicionais,
    baseCalculoTaxa,
    valorTaxaPercentual,
    valorTaxaFixa,
    valorTaxaAntesDosLimites,
    valorTaxaTotal,
    taxaPagaPassageiro,
    taxaDescontadaArmador,
    totalPagoPassageiro,
    valorBrutoArmador,
    valorLiquidoArmador,
    receitaBrutaPlataforma,
    taxaProcessadorValor,
    receitaLiquidaPlataforma,
  };
}
