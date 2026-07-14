export type TipoTaxaVenda =
  | "percentual"
  | "fixa_por_passagem"
  | "fixa_por_venda"
  | "percentual_mais_fixa";

export type ResponsavelTaxaVenda = "passageiro" | "armador" | "dividida";

export type BaseCalculoTaxa = "somente_passagens" | "passagens_e_adicionais";

export type RegraTaxaVenda = {
  ativa: boolean;
  tipo: TipoTaxaVenda;
  percentual: number;
  valorFixo: number;
  responsavel: ResponsavelTaxaVenda;

  /**
   * Usado somente quando responsavel === "dividida".
   * Indica quanto da taxa total será pago pelo passageiro.
   * O restante será descontado do armador.
   */
  percentualPagoPassageiro: number;

  baseCalculo: BaseCalculoTaxa;
  valorMinimo: number | null;
  valorMaximo: number | null;
  vigenciaInicio: string | null;
  vigenciaFim: string | null;
};

export type ConfiguracaoVendasPassagens = {
  ativa: boolean;
  regraTaxa: RegraTaxaVenda;
  pagamento: {
    pixAtivo: boolean;
    mercadoPagoConectado: boolean;
    vendedorMercadoPagoId: string;
  };
  limiteHorasAntesSaida: number;
  atualizadoEm?: unknown;
  atualizadoPor?: {
    uid: string;
    email: string;
    nome: string;
  };
};

export type EntradaCalculoVenda = {
  quantidadePassagens: number;
  valorUnitarioPassagem: number;
  valorAdicionais: number;
  taxaProcessadorValor?: number;
};

export type ResultadoCalculoVenda = {
  quantidadePassagens: number;
  valorUnitarioPassagem: number;
  valorPassagens: number;
  valorAdicionais: number;
  baseCalculoTaxa: number;

  valorTaxaPercentual: number;
  valorTaxaFixa: number;
  valorTaxaAntesDosLimites: number;
  valorTaxaTotal: number;

  taxaPagaPassageiro: number;
  taxaDescontadaArmador: number;

  totalPagoPassageiro: number;
  valorBrutoArmador: number;
  valorLiquidoArmador: number;

  receitaBrutaPlataforma: number;
  taxaProcessadorValor: number;
  receitaLiquidaPlataforma: number;
};
