export const PLANOS_EMBARCACAO = ["basico", "vitrine", "tempo_real"] as const;

export type PlanoEmbarcacao = (typeof PLANOS_EMBARCACAO)[number];
export type StatusPlano =
  | "ativo"
  | "vencido"
  | "suspenso"
  | "cancelado"
  | "cortesia";

export type RecursosPlano = {
  perfilCompleto: boolean;
  mostrarPortoSaida: boolean;
  mostrarDestino: boolean;
  mostrarHorarios: boolean;
  mostrarContato: boolean;
  limiteContatos: number;
  posicaoTempoReal: boolean;
  eta: boolean;
  radar: boolean;
  percurso: boolean;
  alertas: boolean;
  bannerExclusivo: boolean;
};

export const RECURSOS_POR_PLANO: Record<PlanoEmbarcacao, RecursosPlano> = {
  basico: {
    perfilCompleto: false,
    mostrarPortoSaida: false,
    mostrarDestino: false,
    mostrarHorarios: false,
    mostrarContato: false,
    limiteContatos: 0,
    posicaoTempoReal: false,
    eta: false,
    radar: false,
    percurso: false,
    alertas: false,
    bannerExclusivo: false,
  },
  vitrine: {
    perfilCompleto: true,
    mostrarPortoSaida: true,
    mostrarDestino: true,
    mostrarHorarios: true,
    mostrarContato: true,
    limiteContatos: 1,
    posicaoTempoReal: false,
    eta: false,
    radar: false,
    percurso: false,
    alertas: false,
    bannerExclusivo: false,
  },
  tempo_real: {
    perfilCompleto: true,
    mostrarPortoSaida: true,
    mostrarDestino: true,
    mostrarHorarios: true,
    mostrarContato: true,
    limiteContatos: 3,
    posicaoTempoReal: true,
    eta: true,
    radar: true,
    percurso: true,
    alertas: true,
    bannerExclusivo: true,
  },
};

export const ROTULOS_PLANO: Record<PlanoEmbarcacao, string> = {
  basico: "Informações básicas",
  vitrine: "Vitrine Digital",
  tempo_real: "Tempo Real",
};

function dataEmMilissegundos(valor: unknown): number | null {
  if (!valor) return null;
  if (typeof valor === "object" && valor !== null && "toMillis" in valor) {
    const toMillis = (valor as { toMillis?: () => number }).toMillis;
    if (typeof toMillis === "function") return toMillis.call(valor);
  }
  const data = new Date(String(valor));
  const tempo = data.getTime();
  return Number.isFinite(tempo) ? tempo : null;
}

export function normalizarPlano(valor: unknown): PlanoEmbarcacao {
  const plano = String(valor || "")
    .trim()
    .toLowerCase()
    .replace(/[\s+-]+/g, "_");

  if (plano === "basico" || plano === "básico") return "basico";
  if (plano === "vitrine" || plano === "vitrine_digital") return "vitrine";
  if (
    plano === "tempo_real" ||
    plano === "temporeal" ||
    plano === "gps" ||
    plano === "completo"
  ) {
    return "tempo_real";
  }

  // Compatibilidade: a frota anterior à implantação dos planos já era rastreada.
  return "tempo_real";
}

export function planoEfetivo(embarcacao: Record<string, any>): PlanoEmbarcacao {
  const plano = normalizarPlano(
    embarcacao.planoId ||
      embarcacao.plano ||
      embarcacao.planoSistema ||
      embarcacao.categoriaPlano ||
      embarcacao.categoria,
  );
  const status = String(embarcacao.planoStatus || "ativo").toLowerCase();
  const validade = dataEmMilissegundos(embarcacao.planoValidoAte);
  const expirou = validade !== null && validade <= Date.now();

  if (
    plano !== "basico" &&
    (expirou || ["vencido", "suspenso", "cancelado"].includes(status))
  ) {
    return "basico";
  }

  return plano;
}

export function recursosDaEmbarcacao(
  embarcacao: Record<string, any>,
): RecursosPlano {
  return RECURSOS_POR_PLANO[planoEfetivo(embarcacao)];
}

export function statusSinal(
  embarcacao: Record<string, any>,
): "ativo" | "offline" | "desativado" | "sem_tempo_real" {
  if (planoEfetivo(embarcacao) !== "tempo_real") return "sem_tempo_real";
  if (
    embarcacao.rastreadorAtivo === false ||
    embarcacao.ativo === false ||
    embarcacao.statusSinal === "desativado"
  ) {
    return "desativado";
  }
  return embarcacao.online === true ? "ativo" : "offline";
}
