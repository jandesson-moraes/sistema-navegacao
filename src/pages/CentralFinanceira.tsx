import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { db } from "../config/firebase";
import { useAppModal } from "../components/AppModal";

type StatusClienteFinanceiro =
  | "ativo"
  | "promocional"
  | "atrasado"
  | "pausado"
  | "cancelado";

type FormaPagamento =
  | "pix"
  | "dinheiro"
  | "cartao"
  | "boleto"
  | "transferencia"
  | "outro";

type HistoricoPagamento = {
  id: string;
  competencia: string;
  valor: number;
  descontoPercentual: number;
  vencimento: string;
  pagoEm: string;
  forma: FormaPagamento;
  observacao: string;
  criadoEmISO: string;
  registradoPorUid: string;
  registradoPorNome: string;
  registradoPorEmail: string;
  registradoEmISO: string;
};

type ClienteFinanceiroGPS = {
  id: string;
  clienteNome: string;
  clienteDocumento: string;
  clienteEmail: string;
  clienteTelefone: string;
  cidade: string;
  estado: string;
  endereco: string;
  responsavel: string;

  embarcacaoId: string;
  embarcacaoNome: string;
  rastreadorId: string;
  tipoPlano: "gps_profissional";

  valorBaseMensalidade: number;
  descontoPercentual: number;
  mesesPromocionais: number;
  cupom: string;
  diaVencimento: number;
  dataInicio: string;
  dataInstalacao: string;
  status: StatusClienteFinanceiro;

  observacoes: string;
  direitos: string[];
  historicoPagamentos: HistoricoPagamento[];
  contrato?: {
    numero: string;
    status: "rascunho" | "gerado" | "assinado" | "cancelado";
    versao: string;
    geradoEmISO: string;
    geradoPorUid: string;
    geradoPorNome: string;
    geradoPorEmail: string;
    html: string;
  };

  criadoEm?: any;
  atualizadoEm?: any;
};

const VALOR_BASE_GPS = 499;
const DESCONTO_LANCAMENTO = 50;

const DIREITOS_PADRAO = [
  "Rastreamento GPS em tempo real",
  "Mapa tático operacional",
  "Alertas e notificações de chegada",
  "Histórico de localização",
  "Configuração remota do rastreador",
  "Suporte técnico inicial",
];

const STATUS_CONFIG: Record<
  StatusClienteFinanceiro,
  { label: string; classe: string; dot: string }
> = {
  ativo: {
    label: "Ativo",
    classe: "border-emerald-400/20 bg-emerald-400/10 text-emerald-300",
    dot: "bg-emerald-400",
  },
  promocional: {
    label: "Promocional",
    classe: "border-sky-300/25 bg-sky-400/10 text-sky-200",
    dot: "bg-sky-300",
  },
  atrasado: {
    label: "Atrasado",
    classe: "border-red-400/20 bg-red-400/10 text-red-300",
    dot: "bg-red-400",
  },
  pausado: {
    label: "Pausado",
    classe: "border-amber-400/20 bg-amber-400/10 text-amber-300",
    dot: "bg-amber-400",
  },
  cancelado: {
    label: "Cancelado",
    classe: "border-slate-500/20 bg-slate-500/10 text-slate-300",
    dot: "bg-slate-400",
  },
};

const FORMAS_PAGAMENTO: { id: FormaPagamento; label: string }[] = [
  { id: "pix", label: "Pix" },
  { id: "dinheiro", label: "Dinheiro" },
  { id: "cartao", label: "Cartão" },
  { id: "boleto", label: "Boleto" },
  { id: "transferencia", label: "Transferência" },
  { id: "outro", label: "Outro" },
];

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

function moeda(valor: any) {
  const numero = Number(valor || 0);
  return numero.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function numeroMoeda(valor: any) {
  const texto = String(valor || "")
    .replace(/[R$\s.]/g, "")
    .replace(",", ".");

  const numero = Number(texto);
  return Number.isFinite(numero) ? numero : 0;
}

function calcularMensalidade(valorBase: number, descontoPercentual: number) {
  const base = Number(valorBase || VALOR_BASE_GPS);
  const desconto = Math.max(0, Math.min(100, Number(descontoPercentual || 0)));
  return Math.round(base * (1 - desconto / 100) * 100) / 100;
}

function adicionarMeses(dataISO: string, meses: number) {
  const data = dataISO ? new Date(`${dataISO}T12:00:00`) : new Date();
  data.setMonth(data.getMonth() + meses);
  return data.toISOString().slice(0, 10);
}

function diferencaMeses(inicioISO: string) {
  if (!inicioISO) return 0;

  const inicio = new Date(`${inicioISO}T12:00:00`);
  const agora = new Date();

  if (Number.isNaN(inicio.getTime())) return 0;

  const meses =
    (agora.getFullYear() - inicio.getFullYear()) * 12 +
    (agora.getMonth() - inicio.getMonth());

  return Math.max(0, meses);
}

function vencimentoAtual(dataInicio: string, diaVencimento: number) {
  const hoje = new Date();
  const dia = Math.max(1, Math.min(28, Number(diaVencimento || 10)));

  let vencimento = new Date(hoje.getFullYear(), hoje.getMonth(), dia, 12, 0, 0);

  if (vencimento.getTime() < hoje.getTime()) {
    vencimento = new Date(hoje.getFullYear(), hoje.getMonth() + 1, dia, 12, 0, 0);
  }

  if (dataInicio) {
    const inicio = new Date(`${dataInicio}T12:00:00`);
    if (!Number.isNaN(inicio.getTime()) && vencimento.getTime() < inicio.getTime()) {
      vencimento = new Date(inicio.getFullYear(), inicio.getMonth(), dia, 12, 0, 0);
    }
  }

  return vencimento.toISOString().slice(0, 10);
}

function formatarData(valor: any) {
  try {
    const data =
      typeof valor?.toDate === "function"
        ? valor.toDate()
        : valor
          ? new Date(valor)
          : null;

    if (!data || Number.isNaN(data.getTime())) return "—";

    return data.toLocaleDateString("pt-BR", {
      timeZone: "America/Santarem",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

function formatarMesCompetencia(dataISO = hojeISO()) {
  const data = new Date(`${dataISO}T12:00:00`);
  return data.toLocaleDateString("pt-BR", {
    month: "2-digit",
    year: "numeric",
  });
}

function slugId(valor: string) {
  const base = valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .toUpperCase();

  return base || `CLIENTE_${Date.now()}`;
}

function usuarioAtualAuditoria() {
  const user = getAuth().currentUser;

  return {
    uid: user?.uid || "sem_uid",
    nome: user?.displayName || user?.email || "Usuário não identificado",
    email: user?.email || "sem_email",
  };
}

function novoCliente(): ClienteFinanceiroGPS {
  const hoje = hojeISO();

  return {
    id: "",
    clienteNome: "",
    clienteDocumento: "",
    clienteEmail: "",
    clienteTelefone: "",
    cidade: "",
    estado: "PA",
    endereco: "",
    responsavel: "",

    embarcacaoId: "",
    embarcacaoNome: "",
    rastreadorId: "",
    tipoPlano: "gps_profissional",

    valorBaseMensalidade: VALOR_BASE_GPS,
    descontoPercentual: DESCONTO_LANCAMENTO,
    mesesPromocionais: 3,
    cupom: "LANÇAMENTO50",
    diaVencimento: 10,
    dataInicio: hoje,
    dataInstalacao: hoje,
    status: "promocional",

    observacoes: "",
    direitos: DIREITOS_PADRAO,
    historicoPagamentos: [],
  };
}

function statusAutomatico(cliente: ClienteFinanceiroGPS): StatusClienteFinanceiro {
  if (cliente.status === "cancelado" || cliente.status === "pausado")
    return cliente.status;

  const vencimento = vencimentoAtual(cliente.dataInicio, cliente.diaVencimento);
  const hoje = hojeISO();
  const meses = diferencaMeses(cliente.dataInicio);

  if (vencimento < hoje) return "atrasado";
  if (
    meses < Number(cliente.mesesPromocionais || 0) &&
    Number(cliente.descontoPercentual || 0) > 0
  ) {
    return "promocional";
  }

  return "ativo";
}

function calcularProjecao(cliente: ClienteFinanceiroGPS) {
  const mesesUsados = diferencaMeses(cliente.dataInicio);
  const mesesPromo = Number(cliente.mesesPromocionais || 0);
  const emPromocao =
    mesesUsados < mesesPromo && Number(cliente.descontoPercentual || 0) > 0;

  const descontoAtual = emPromocao ? Number(cliente.descontoPercentual || 0) : 0;
  const valorAtual = calcularMensalidade(cliente.valorBaseMensalidade, descontoAtual);
  const valorCheio = calcularMensalidade(cliente.valorBaseMensalidade, 0);
  const economiaMensal = valorCheio - valorAtual;
  const fimPromocao = adicionarMeses(cliente.dataInicio, mesesPromo);

  return {
    mesesUsados,
    mesesRestantesPromo: Math.max(0, mesesPromo - mesesUsados),
    emPromocao,
    descontoAtual,
    valorAtual,
    valorCheio,
    economiaMensal,
    fimPromocao,
    proximoVencimento: vencimentoAtual(cliente.dataInicio, cliente.diaVencimento),
  };
}

function numeroContrato(cliente: ClienteFinanceiroGPS) {
  const ano = new Date().getFullYear();
  const base = slugId(
    `${cliente.clienteNome}_${cliente.embarcacaoNome || cliente.embarcacaoId}`,
  ).slice(0, 18);
  return `CMB-GPS-${ano}-${base || "CLIENTE"}`;
}

function limparHtml(valor: any) {
  return String(valor ?? "—")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function paragrafoContrato(titulo: string, texto: string) {
  return `
    <section style="margin-bottom: 22px; page-break-inside: avoid;">
      <h2 style="font-size: 15px; color: #082f49; margin: 0 0 8px;">${titulo}</h2>
      <p style="margin: 0; font-size: 13px; color: #0f172a;">${texto}</p>
    </section>
  `;
}

function gerarHtmlContrato(cliente: ClienteFinanceiroGPS) {
  const projecao = calcularProjecao(cliente);
  const numero = cliente.contrato?.numero || numeroContrato(cliente);
  const direitos = cliente.direitos?.length ? cliente.direitos : DIREITOS_PADRAO;
  const dataGeracao = formatarData(new Date().toISOString());
  const valorBase = moeda(cliente.valorBaseMensalidade || VALOR_BASE_GPS);
  const valorPromocional = moeda(projecao.valorAtual);
  const valorCheio = moeda(projecao.valorCheio);
  const desconto = Number(cliente.descontoPercentual || 0);
  const mesesPromo = Number(cliente.mesesPromocionais || 0);
  const taxaConveniencia = "8%";

  const campo = (label: string, valor: any) => `
    <div style="border: 1px solid #dbeafe; background: #f8fafc; border-radius: 10px; padding: 10px;">
      <p style="margin: 0 0 4px; font-size: 9px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; color: #64748b;">${label}</p>
      <p style="margin: 0; font-size: 12px; font-weight: 700; color: #0f172a;">${limparHtml(valor || "—")}</p>
    </div>
  `;

  const pagina = (titulo: string, subtitulo: string, conteudo: string) => `
    <section style="page-break-before: always; padding-top: 16px;">
      <header style="border-bottom: 2px solid #0ea5e9; padding-bottom: 12px; margin-bottom: 18px;">
        <p style="font-size: 10px; letter-spacing: 2.6px; text-transform: uppercase; color: #0369a1; font-weight: 800; margin: 0 0 6px;">
          Cadê o Meu Barco • ${limparHtml(numero)}
        </p>
        <h1 style="font-size: 21px; margin: 0; color: #082f49;">${titulo}</h1>
        <p style="font-size: 12px; margin: 6px 0 0; color: #475569;">${subtitulo}</p>
      </header>
      ${conteudo}
    </section>
  `;

  return `
    <article style="font-family: Arial, sans-serif; color: #0f172a; line-height: 1.55; max-width: 860px; margin: 0 auto; padding: 32px; background: #ffffff;">
      <header style="border-bottom: 3px solid #0ea5e9; padding-bottom: 16px; margin-bottom: 24px;">
        <p style="font-size: 11px; letter-spacing: 3px; text-transform: uppercase; color: #0369a1; font-weight: 800; margin: 0 0 8px;">
          Cadê o Meu Barco • Sistema de Navegação Hidroviária
        </p>
        <h1 style="font-size: 25px; margin: 0; color: #082f49;">
          Contrato de Prestação de Serviços Tecnológicos
        </h1>
        <p style="font-size: 13px; margin: 8px 0 0; color: #475569;">
          Rastreamento GPS • Gestão Hidroviária • Bilhetagem Digital • Plataforma Operacional
        </p>
        <p style="font-size: 13px; margin: 8px 0 0; color: #475569;">
          Contrato nº <strong>${limparHtml(numero)}</strong> • Versão 001 • Gerado em ${dataGeracao}
        </p>
      </header>

      <section style="margin-bottom: 24px;">
        <h2 style="font-size: 16px; color: #082f49; margin: 0 0 10px;">Quadro resumo do contrato</h2>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
          ${campo("Contratante / Armador", cliente.clienteNome)}
          ${campo("CPF/CNPJ", cliente.clienteDocumento)}
          ${campo("Telefone / WhatsApp", cliente.clienteTelefone)}
          ${campo("E-mail", cliente.clienteEmail)}
          ${campo("Cidade / Estado", `${cliente.cidade || "—"} / ${cliente.estado || "—"}`)}
          ${campo("Responsável financeiro", cliente.responsavel || cliente.clienteNome)}
          ${campo("Embarcação", cliente.embarcacaoNome)}
          ${campo("ID da embarcação", cliente.embarcacaoId)}
          ${campo("ID do rastreador GPS", cliente.rastreadorId)}
          ${campo("Data de instalação", formatarData(cliente.dataInstalacao))}
          ${campo("Mensalidade base", valorBase)}
          ${campo("Condição promocional", `${desconto}% por ${mesesPromo} mês(es)`)}
          ${campo("Valor promocional estimado", valorPromocional)}
          ${campo("Valor após promoção", valorCheio)}
          ${campo("Cupom", cliente.cupom)}
          ${campo("Vencimento", `Todo dia ${cliente.diaVencimento || "—"}`)}
        </div>
      </section>

      ${paragrafoContrato(
        "1. Objeto",
        "O presente contrato tem como objeto a prestação de serviços tecnológicos pela plataforma Cadê o Meu Barco, incluindo, conforme configuração contratada, rastreamento GPS, monitoramento de embarcação, gestão operacional hidroviária, bilhetagem digital, notificações, manifesto de passageiros, controle de usuários, área financeira e ferramentas de apoio à venda de passagens.",
      )}

      ${paragrafoContrato(
        "2. Finalidade do sistema",
        "O sistema foi desenvolvido para modernizar a operação de transporte fluvial, reduzindo ligações sobre localização e horário de chegada, organizando embarques, melhorando a previsibilidade financeira do armador, aumentando a segurança contra fraudes e dando visibilidade digital à embarcação no ecossistema do porto.",
      )}

      ${paragrafoContrato(
        "3. Rastreamento GPS e monitoramento",
        "A plataforma poderá exibir localização aproximada da embarcação, velocidade, direção, previsão estimada de chegada, status de sinal, último contato conhecido e demais informações operacionais disponíveis. O rastreamento depende do equipamento GPS, energia, conexão de dados, internet da embarcação e correto funcionamento dos dispositivos envolvidos.",
      )}

      ${paragrafoContrato(
        "4. Conectividade, Starlink e reconexão automática",
        "O sistema é preparado para a realidade dos rios, incluindo áreas de sombra e oscilações de internet. Quando a embarcação utilizar Starlink ou conexão equivalente, o sistema poderá operar enquanto houver sinal disponível. Em caso de falha temporária, o aplicativo poderá registrar o último contato conhecido e, quando a conexão retornar, voltar a enviar coordenadas automaticamente, desde que os equipamentos estejam energizados e funcionando.",
      )}

      ${paragrafoContrato(
        "5. Bilhetagem digital e QR Code",
        "Cada passagem poderá gerar um QR Code único vinculado aos dados da viagem. A validação poderá registrar data, hora, usuário responsável e status do bilhete. Se houver tentativa de reutilização ou duplicidade, o sistema poderá bloquear ou alertar a equipe, contribuindo para evitar fraudes, bilhetes clonados, desvios e desorganização no embarque.",
      )}

      ${paragrafoContrato(
        "6. Manifesto de passageiros",
        "O sistema poderá gerar manifesto em PDF com nome completo, nacionalidade, data de nascimento, data da viagem e rota com origem e destino. O documento poderá ser baixado, impresso ou compartilhado por WhatsApp ou e-mail, auxiliando o armador, comandante ou responsável no atendimento a exigências administrativas e fiscalizatórias.",
      )}

      ${paragrafoContrato(
        "7. Usuários, tripulação e permissões",
        "O armador poderá vincular usuários por e-mail e liberar permissões conforme a função de cada pessoa. O objetivo é evitar senhas compartilhadas, controlar o que cada usuário pode ver ou executar, registrar ações relevantes e permitir remoção instantânea de acessos quando um colaborador sair da operação.",
      )}

      ${paragrafoContrato(
        "8. Taxa administrativa, conveniência e split",
        `Quando houver venda digital de passagem, o armador poderá definir o valor líquido da tarifa. A taxa administrativa ou de conveniência da plataforma, atualmente configurada comercialmente em ${taxaConveniencia}, poderá ser adicionada por fora do valor definido pelo armador. Assim, se a passagem líquida for R$ 100,00, o armador recebe R$ 100,00 e a taxa da plataforma é cobrada separadamente do passageiro, conforme configuração comercial vigente.`,
      )}

      ${paragrafoContrato(
        "9. Mensalidade do sistema GPS",
        `O módulo GPS profissional possui mensalidade base de ${valorBase}. Na condição promocional registrada neste cadastro, poderá ser aplicado desconto de ${desconto}% por ${mesesPromo} mês(es), resultando em valor promocional estimado de ${valorPromocional}. Após o término da promoção, a mensalidade poderá retornar ao valor integral de ${valorCheio}, salvo nova negociação formal.`,
      )}

      ${paragrafoContrato(
        "10. Atraso, bloqueio e reativação",
        "O atraso no pagamento da mensalidade poderá gerar restrição de acesso, bloqueio de funcionalidades ou suspensão temporária do serviço. A reativação poderá ocorrer após regularização financeira, confirmação do pagamento e atualização do status do cliente no sistema.",
      )}

      ${paragrafoContrato(
        "11. Implantação VIP",
        "A contratada poderá realizar implantação assistida, incluindo cadastro da embarcação, fotos, rotas, portos, horários, preços, vinculação do rastreador GPS e treinamento inicial da tripulação, com o objetivo de entregar o sistema pronto para operação.",
      )}

      ${paragrafoContrato(
        "12. Limitações",
        "A plataforma é uma ferramenta de apoio à gestão, rastreamento, vendas e organização operacional. Ela não substitui a responsabilidade do comandante, obrigações legais do armador, manutenção da embarcação, equipamentos de segurança, decisões de navegação, comunicação oficial exigida por autoridades ou conferência física quando necessária.",
      )}

      <footer style="margin-top: 48px;">
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 32px;">
          <div style="border-top: 1px solid #0f172a; padding-top: 8px; text-align: center;">Contratante</div>
          <div style="border-top: 1px solid #0f172a; padding-top: 8px; text-align: center;">Cadê o Meu Barco</div>
        </div>
      </footer>

      ${pagina(
        "ANEXO 1 — Plano contratado e condição comercial",
        "Resumo comercial vinculado ao cadastro financeiro do cliente.",
        `
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 18px;">
            ${campo("Plano", "GPS Profissional")}
            ${campo("Mensalidade base", valorBase)}
            ${campo("Desconto promocional", `${desconto}%`)}
            ${campo("Meses promocionais", `${mesesPromo} mês(es)`)}
            ${campo("Valor promocional", valorPromocional)}
            ${campo("Valor após promoção", valorCheio)}
            ${campo("Cupom", cliente.cupom)}
            ${campo("Dia de vencimento", cliente.diaVencimento)}
            ${campo("Início do contrato", formatarData(cliente.dataInicio))}
            ${campo("Fim previsto da promoção", formatarData(projecao.fimPromocao))}
          </div>
          <p style="font-size: 13px; margin: 0 0 12px;">
            A promoção registrada neste anexo tem caráter comercial temporário. Após o período promocional, o sistema financeiro poderá retornar o cliente ao valor cheio, salvo nova condição registrada pela empresa.
          </p>
          <p style="font-size: 13px; margin: 0;">
            A taxa administrativa/conveniência de ${taxaConveniencia} relacionada à venda digital de passagens poderá ser cobrada por fora do valor líquido definido pelo armador, preservando o valor da tarifa líquida da embarcação.
          </p>
        `,
      )}

      ${pagina(
        "ANEXO 2 — Equipamento GPS, instalação e conectividade",
        "Condições de uso do rastreador e dependências técnicas.",
        `
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 18px;">
            ${campo("Embarcação", cliente.embarcacaoNome)}
            ${campo("ID da embarcação", cliente.embarcacaoId)}
            ${campo("ID do rastreador", cliente.rastreadorId)}
            ${campo("Data de instalação", formatarData(cliente.dataInstalacao))}
          </div>
          <p style="font-size: 13px;">
            O contratante se compromete a manter o equipamento GPS instalado, protegido, energizado e em condições de funcionamento. A retirada, desligamento, dano físico, mau uso, falha elétrica ou falha na internet da embarcação poderá afetar diretamente o rastreamento.
          </p>
          <p style="font-size: 13px;">
            Caso a embarcação utilize Starlink, o contratante reconhece que eventuais falhas da antena, ausência de energia ou instabilidade externa não são de responsabilidade direta da plataforma. Quando o sinal retornar, o sistema poderá retomar o envio de coordenadas automaticamente.
          </p>
        `,
      )}

      ${pagina(
        "ANEXO 3 — Funcionalidades e direitos liberados",
        "Recursos vinculados ao plano e à configuração do cliente.",
        `
          <ul style="font-size: 13px; margin-top: 0;">
            ${direitos.map((direito) => `<li>${limparHtml(direito)}</li>`).join("")}
          </ul>
          <p style="font-size: 13px;">
            Funcionalidades futuras, integrações, módulos adicionais, automações, split de pagamento, assinatura digital, melhorias comerciais ou recursos avançados poderão depender de implantação, liberação técnica, contratação específica ou disponibilidade do provedor externo utilizado.
          </p>
        `,
      )}

      ${pagina(
        "ANEXO 4 — Pagamento, auditoria e segurança financeira",
        "Regras de controle financeiro e registro de ações.",
        `
          <p style="font-size: 13px;">
            A área financeira poderá registrar mensalidades, vencimentos, descontos, cupons, pagamentos e contratos. Cada pagamento manual deverá manter dados como valor, forma de pagamento, observação, competência, vencimento, usuário responsável, e-mail e data/hora do registro.
          </p>
          <p style="font-size: 13px;">
            Por segurança, recomenda-se que pagamentos não sejam apagados definitivamente. Em caso de erro, o procedimento adequado é registrar correção, cancelamento ou estorno com motivo e usuário responsável, preservando a rastreabilidade da operação.
          </p>
          <p style="font-size: 13px;">
            Alterações sensíveis, como desconto, vencimento, status financeiro, contrato, cancelamentos ou alterações de acesso, devem ser restritas a usuários autorizados pela administração.
          </p>
        `,
      )}

      ${pagina(
        "ANEXO 5 — Implantação VIP e treinamento",
        "Entrega assistida do sistema para o armador e sua equipe.",
        `
          <p style="font-size: 13px;">
            A implantação VIP poderá incluir coleta de informações da embarcação, cadastro de fotos, rotas, portos, horários, preços, trechos, acomodações, serviços, configuração inicial do rastreador GPS e orientação da tripulação.
          </p>
          <p style="font-size: 13px;">
            O objetivo é reduzir o trabalho técnico do armador e entregar o sistema configurado para operação, vendas, monitoramento e organização do embarque.
          </p>
          <p style="font-size: 13px;">
            O contratante deverá fornecer dados corretos, imagens, informações comerciais, responsáveis, permissões de equipe e acesso à embarcação/equipamento quando necessário.
          </p>
        `,
      )}

      ${pagina(
        "ANEXO 6 — Manifesto, bilhetagem e operação de embarque",
        "Uso do sistema para controle de passageiros e apoio à fiscalização.",
        `
          <p style="font-size: 13px;">
            O manifesto em PDF poderá conter nome completo, nacionalidade, data de nascimento, data da viagem e rota com origem e destino. O documento poderá ser impresso ou compartilhado digitalmente pelo armador, comandante ou responsável autorizado.
          </p>
          <p style="font-size: 13px;">
            A bilhetagem digital com QR Code visa agilizar o embarque, reduzir papel, diminuir fraudes e registrar validações. O sistema poderá identificar duplicidade de uso, registrar usuário validador e facilitar auditoria operacional.
          </p>
          <p style="font-size: 13px;">
            A responsabilidade pela conferência final de documentação, identidade, requisitos legais e embarque seguro permanece com o contratante e sua equipe operacional.
          </p>
        `,
      )}

      <p style="font-size: 11px; color: #64748b; margin-top: 28px; text-align: center;">
        Documento gerado automaticamente pelo Sistema de Navegação Cadê o Meu Barco.
      </p>
    </article>
  `;
}

export default function FinanceiroGPS() {
  const modal = useAppModal();

  const [clientes, setClientes] = useState<ClienteFinanceiroGPS[]>([]);
  const [selecionadoId, setSelecionadoId] = useState("");
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<"todos" | StatusClienteFinanceiro>(
    "todos",
  );
  const [form, setForm] = useState<ClienteFinanceiroGPS>(novoCliente());
  const [salvando, setSalvando] = useState(false);
  const [pagamentoValor, setPagamentoValor] = useState("");
  const [pagamentoForma, setPagamentoForma] = useState<FormaPagamento>("pix");
  const [pagamentoObs, setPagamentoObs] = useState("");
  const [abaDireita, setAbaDireita] = useState<"cobranca" | "historico" | "contrato">(
    "cobranca",
  );

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "financeiro_clientes_gps"),
      (snapshot) => {
        const lista = snapshot.docs
          .map((docSnap) => {
            const dados = docSnap.data() as any;

            return {
              ...novoCliente(),
              ...dados,
              id: docSnap.id,
              direitos: Array.isArray(dados.direitos) ? dados.direitos : DIREITOS_PADRAO,
              historicoPagamentos: Array.isArray(dados.historicoPagamentos)
                ? dados.historicoPagamentos
                : [],
            } as ClienteFinanceiroGPS;
          })
          .sort((a, b) =>
            String(a.clienteNome || a.id).localeCompare(
              String(b.clienteNome || b.id),
              "pt-BR",
            ),
          );

        setClientes(lista);

        if (!selecionadoId && lista.length > 0) {
          setSelecionadoId(lista[0].id);
          setForm(lista[0]);
          setPagamentoValor(
            String(calcularProjecao(lista[0]).valorAtual).replace(".", ","),
          );
        }
      },
      (error) => {
        console.error("Erro ao ler financeiro_clientes_gps:", error);
        void modal.erro(
          "Erro ao carregar financeiro",
          "Não foi possível ler a coleção financeiro_clientes_gps.",
        );
      },
    );

    return () => unsub();
  }, [selecionadoId]);

  const gerarContrato = async () => {
    try {
      if (!form.clienteNome.trim()) {
        await modal.aviso(
          "Nome obrigatório",
          "Informe o nome do cliente antes de gerar o contrato.",
        );
        return;
      }

      if (!form.embarcacaoNome.trim() && !form.embarcacaoId.trim()) {
        await modal.aviso(
          "Embarcação obrigatória",
          "Informe a embarcação antes de gerar o contrato.",
        );
        return;
      }

      const usuarioAuditoria = usuarioAtualAuditoria();
      const contrato = {
        numero: form.contrato?.numero || numeroContrato(form),
        status: "gerado" as const,
        versao: "001",
        geradoEmISO: new Date().toISOString(),
        geradoPorUid: usuarioAuditoria.uid,
        geradoPorNome: usuarioAuditoria.nome,
        geradoPorEmail: usuarioAuditoria.email,
        html: gerarHtmlContrato(form),
      };

      setForm((atual) => ({ ...atual, contrato }));
      setAbaDireita("contrato");

      if (form.id) {
        await setDoc(
          doc(db, "financeiro_clientes_gps", form.id),
          {
            contrato,
            auditoriaUltimaAlteracao: {
              acao: "contrato_gerado",
              uid: usuarioAuditoria.uid,
              nome: usuarioAuditoria.nome,
              email: usuarioAuditoria.email,
              contratoNumero: contrato.numero,
              dataISO: contrato.geradoEmISO,
            },
            atualizadoEm: serverTimestamp(),
          },
          { merge: true },
        );
      }

      await modal.sucesso(
        "Contrato gerado",
        "O contrato foi criado com os dados atuais do cliente.",
      );
    } catch (error: any) {
      await modal.erro(
        "Erro ao gerar contrato",
        error?.message || "Não foi possível gerar o contrato.",
      );
    }
  };

  const marcarContratoAssinado = async () => {
    if (!form.id || !form.contrato) return;

    const usuarioAuditoria = usuarioAtualAuditoria();

    const contrato = {
      ...form.contrato,
      status: "assinado" as const,
    };

    await setDoc(
      doc(db, "financeiro_clientes_gps", form.id),
      {
        contrato,
        auditoriaUltimaAlteracao: {
          acao: "contrato_marcado_assinado",
          uid: usuarioAuditoria.uid,
          nome: usuarioAuditoria.nome,
          email: usuarioAuditoria.email,
          contratoNumero: contrato.numero,
          dataISO: new Date().toISOString(),
        },
        atualizadoEm: serverTimestamp(),
      },
      { merge: true },
    );

    setForm((atual) => ({ ...atual, contrato }));
    await modal.sucesso("Contrato atualizado", "Contrato marcado como assinado.");
  };

  const imprimirContrato = () => {
    const html = form.contrato?.html || gerarHtmlContrato(form);
    const janela = window.open("", "_blank", "width=900,height=900");

    if (!janela) {
      void modal.aviso(
        "Pop-up bloqueado",
        "Libere pop-ups no navegador para imprimir o contrato.",
      );
      return;
    }

    janela.document.write(`
      <!doctype html>
      <html>
        <head>
          <title>${form.contrato?.numero || "Contrato GPS"}</title>
          <meta charset="utf-8" />
        </head>
        <body>
          ${html}
          <script>
            window.onload = function() {
              window.print();
            };
          </script>
        </body>
      </html>
    `);
    janela.document.close();
  };

  const clientesComStatus = useMemo(() => {
    return clientes.map((cliente) => ({
      ...cliente,
      statusCalculado: statusAutomatico(cliente),
      projecao: calcularProjecao(cliente),
    }));
  }, [clientes]);

  const clientesFiltrados = useMemo(() => {
    const texto = busca.trim().toLowerCase();

    return clientesComStatus.filter((cliente) => {
      const status = cliente.statusCalculado;

      if (filtroStatus === "ativo" && status !== "ativo" && status !== "promocional") {
        return false;
      }

      if (
        filtroStatus !== "todos" &&
        filtroStatus !== "ativo" &&
        status !== filtroStatus
      ) {
        return false;
      }

      if (!texto) return true;

      return [
        cliente.id,
        cliente.clienteNome,
        cliente.clienteDocumento,
        cliente.clienteEmail,
        cliente.clienteTelefone,
        cliente.embarcacaoNome,
        cliente.embarcacaoId,
        cliente.rastreadorId,
        cliente.cidade,
        cliente.estado,
        cliente.cupom,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(texto);
    });
  }, [clientesComStatus, busca, filtroStatus]);

  const resumo = useMemo(() => {
    const ativos = clientesComStatus.filter(
      (c) => c.statusCalculado === "ativo" || c.statusCalculado === "promocional",
    );
    const atrasados = clientesComStatus.filter((c) => c.statusCalculado === "atrasado");
    const promocionais = clientesComStatus.filter(
      (c) => c.statusCalculado === "promocional",
    );

    const receitaAtual = ativos.reduce(
      (total, cliente) => total + cliente.projecao.valorAtual,
      0,
    );
    const receitaCheia = ativos.reduce(
      (total, cliente) => total + cliente.projecao.valorCheio,
      0,
    );

    return {
      total: clientesComStatus.length,
      ativos: ativos.length,
      promocionais: promocionais.length,
      atrasados: atrasados.length,
      receitaAtual,
      receitaCheia,
      descontoTotal: Math.max(0, receitaCheia - receitaAtual),
    };
  }, [clientesComStatus]);

  const clienteSelecionado = useMemo(
    () => clientesComStatus.find((cliente) => cliente.id === selecionadoId) || null,
    [clientesComStatus, selecionadoId],
  );

  const projecaoForm = useMemo(() => calcularProjecao(form), [form]);

  const selecionarCliente = (cliente: ClienteFinanceiroGPS) => {
    setSelecionadoId(cliente.id);
    setForm(cliente);
    setPagamentoValor(String(calcularProjecao(cliente).valorAtual).replace(".", ","));
    setPagamentoObs("");
    setPagamentoForma("pix");
    setAbaDireita("cobranca");
  };

  const alterar = (campo: keyof ClienteFinanceiroGPS, valor: any) => {
    setForm((atual) => ({
      ...atual,
      [campo]: valor,
    }));
  };

  const alternarDireito = (direito: string) => {
    setForm((atual) => {
      const existe = atual.direitos.includes(direito);

      return {
        ...atual,
        direitos: existe
          ? atual.direitos.filter((item) => item !== direito)
          : [...atual.direitos, direito],
      };
    });
  };

  const novoCadastro = () => {
    const inicial = novoCliente();

    // Usa um ID temporário para o onSnapshot não selecionar automaticamente
    // o primeiro cliente da lista enquanto estamos cadastrando um novo.
    setSelecionadoId("__novo_cliente__");
    setForm(inicial);
    setPagamentoValor(String(calcularProjecao(inicial).valorAtual).replace(".", ","));
    setPagamentoObs("");
    setPagamentoForma("pix");
    setAbaDireita("cobranca");
  };

  const salvarCliente = async () => {
    try {
      const nome = form.clienteNome.trim();

      if (!nome) {
        await modal.aviso("Nome obrigatório", "Informe o nome do cliente.");
        return;
      }

      if (!form.embarcacaoNome.trim() && !form.embarcacaoId.trim()) {
        await modal.aviso(
          "Embarcação obrigatória",
          "Informe o nome ou ID da embarcação.",
        );
        return;
      }

      setSalvando(true);

      const id =
        form.id ||
        slugId(
          `${form.clienteNome}_${form.embarcacaoNome || form.embarcacaoId}_${Date.now()}`,
        );
      const statusAtual = statusAutomatico(form);

      const payload: ClienteFinanceiroGPS = {
        ...form,
        id,
        clienteNome: form.clienteNome.trim(),
        clienteDocumento: form.clienteDocumento.trim(),
        clienteEmail: form.clienteEmail.trim().toLowerCase(),
        clienteTelefone: form.clienteTelefone.trim(),
        cidade: form.cidade.trim(),
        estado: form.estado.trim().toUpperCase(),
        endereco: form.endereco.trim(),
        responsavel: form.responsavel.trim(),
        embarcacaoId: form.embarcacaoId.trim(),
        embarcacaoNome: form.embarcacaoNome.trim(),
        rastreadorId: form.rastreadorId.trim(),
        valorBaseMensalidade: Number(form.valorBaseMensalidade || VALOR_BASE_GPS),
        descontoPercentual: Math.max(
          0,
          Math.min(100, Number(form.descontoPercentual || 0)),
        ),
        mesesPromocionais: Math.max(0, Number(form.mesesPromocionais || 0)),
        diaVencimento: Math.max(1, Math.min(28, Number(form.diaVencimento || 10))),
        cupom: form.cupom.trim().toUpperCase(),
        status: statusAtual,
        direitos: form.direitos,
        historicoPagamentos: Array.isArray(form.historicoPagamentos)
          ? form.historicoPagamentos
          : [],
      };

      const usuarioAuditoria = usuarioAtualAuditoria();

      await setDoc(
        doc(db, "financeiro_clientes_gps", id),
        {
          ...payload,
          atualizadoEm: serverTimestamp(),
          criadoEm: form.id ? form.criadoEm || serverTimestamp() : serverTimestamp(),
          auditoriaUltimaAlteracao: {
            acao: form.id ? "cliente_atualizado" : "cliente_criado",
            uid: usuarioAuditoria.uid,
            nome: usuarioAuditoria.nome,
            email: usuarioAuditoria.email,
            dataISO: new Date().toISOString(),
          },
        },
        { merge: true },
      );

      setSelecionadoId(id);
      setForm(payload);

      await modal.sucesso("Cadastro salvo", "Cliente financeiro salvo com sucesso.");
    } catch (error: any) {
      await modal.erro(
        "Erro ao salvar",
        error?.message || "Não foi possível salvar o cliente.",
      );
    } finally {
      setSalvando(false);
    }
  };

  const registrarPagamento = async () => {
    try {
      if (!form.id) {
        await modal.aviso(
          "Salve primeiro",
          "Salve o cliente antes de registrar pagamento.",
        );
        return;
      }

      const valor = numeroMoeda(pagamentoValor);

      if (valor <= 0) {
        await modal.aviso("Valor obrigatório", "Informe o valor pago.");
        return;
      }

      const usuarioAuditoria = usuarioAtualAuditoria();
      const agoraISO = new Date().toISOString();

      const pagamento: HistoricoPagamento = {
        id: `pag_${Date.now()}`,
        competencia: formatarMesCompetencia(),
        valor,
        descontoPercentual: projecaoForm.descontoAtual,
        vencimento: projecaoForm.proximoVencimento,
        pagoEm: hojeISO(),
        forma: pagamentoForma,
        observacao: pagamentoObs.trim(),
        criadoEmISO: agoraISO,
        registradoPorUid: usuarioAuditoria.uid,
        registradoPorNome: usuarioAuditoria.nome,
        registradoPorEmail: usuarioAuditoria.email,
        registradoEmISO: agoraISO,
      };

      const historico = [pagamento, ...(form.historicoPagamentos || [])].slice(0, 36);

      await setDoc(
        doc(db, "financeiro_clientes_gps", form.id),
        {
          historicoPagamentos: historico,
          status: statusAutomatico(form),
          ultimoPagamento: pagamento,
          auditoriaUltimaAlteracao: {
            acao: "pagamento_registrado",
            uid: usuarioAuditoria.uid,
            nome: usuarioAuditoria.nome,
            email: usuarioAuditoria.email,
            pagamentoId: pagamento.id,
            valor: pagamento.valor,
            forma: pagamento.forma,
            dataISO: agoraISO,
          },
          atualizadoEm: serverTimestamp(),
        },
        { merge: true },
      );

      setForm((atual) => ({
        ...atual,
        historicoPagamentos: historico,
      }));

      setPagamentoObs("");
      setPagamentoValor(String(projecaoForm.valorAtual).replace(".", ","));
      setAbaDireita("historico");

      await modal.sucesso(
        "Pagamento registrado",
        "Pagamento adicionado ao histórico do cliente.",
      );
    } catch (error: any) {
      await modal.erro(
        "Erro ao registrar pagamento",
        error?.message || "Não foi possível registrar o pagamento.",
      );
    }
  };

  const removerCliente = async () => {
    if (!form.id) return;

    const confirmou = await modal.confirmar({
      tipo: "warning",
      titulo: "Remover cadastro financeiro?",
      mensagem:
        "Essa ação remove o cadastro financeiro deste cliente. Os dados operacionais do barco não serão alterados.",
      confirmarTexto: "Remover",
      cancelarTexto: "Cancelar",
    });

    if (!confirmou) return;

    try {
      await deleteDoc(doc(db, "financeiro_clientes_gps", form.id));
      novoCadastro();
      await modal.sucesso("Cadastro removido", "O cadastro financeiro foi removido.");
    } catch (error: any) {
      await modal.erro(
        "Erro ao remover",
        error?.message || "Não foi possível remover o cadastro.",
      );
    }
  };

  return (
    <div className="flex h-full min-h-[calc(100vh-74px)] flex-col overflow-hidden bg-[#0d0c2c] p-4 text-white">
      <header className="mb-3 flex shrink-0 flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-sky-300">
            Central financeira GPS
          </p>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-white">
            Clientes, mensalidades e contratos
          </h1>
          <p className="mt-1 text-xs text-sky-100/50">
            Controle mensalidades, descontos, cupons, vencimentos e direitos liberados.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={novoCadastro}
            className="h-10 rounded-xl border border-[#7ba6d4]/25 bg-[#143760] px-4 text-xs font-black uppercase text-sky-100 transition hover:bg-[#17345e]"
          >
            Novo cliente
          </button>

          <button
            onClick={salvarCliente}
            disabled={salvando}
            className="h-10 rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-4 text-xs font-black uppercase text-emerald-300 transition hover:bg-emerald-400/20 disabled:opacity-60"
          >
            {salvando ? "Salvando..." : "Salvar cadastro"}
          </button>
        </div>
      </header>

      <section className="mb-3 grid shrink-0 gap-2 md:grid-cols-2 xl:grid-cols-6">
        <ResumoCard label="Clientes" valor={resumo.total} sub="Base GPS" />
        <ResumoCard
          label="Ativos"
          valor={resumo.ativos}
          sub="Pagando ou promocional"
          destaque="emerald"
        />
        <ResumoCard
          label="Promoção"
          valor={resumo.promocionais}
          sub="Com desconto ativo"
          destaque="sky"
        />
        <ResumoCard
          label="Atrasados"
          valor={resumo.atrasados}
          sub="Revisar cobrança"
          destaque="red"
        />
        <ResumoCard
          label="Receita atual"
          valor={moeda(resumo.receitaAtual)}
          sub="Com descontos"
          destaque="emerald"
        />
        <ResumoCard
          label="Receita cheia"
          valor={moeda(resumo.receitaCheia)}
          sub="Após promoção"
          destaque="sky"
        />
      </section>

      <main className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[330px_minmax(0,1fr)_390px]">
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[#7ba6d4]/20 bg-[#0f2240]">
          <div className="shrink-0 border-b border-[#7ba6d4]/15 p-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-black">Clientes GPS</h2>
              <span className="rounded-full border border-[#7ba6d4]/20 bg-[#143760] px-2.5 py-1 text-[9px] font-black uppercase text-sky-100/55">
                {clientesFiltrados.length}/{clientes.length}
              </span>
            </div>

            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar cliente, barco, cupom..."
              className="mt-3 h-9 w-full rounded-xl border border-[#7ba6d4]/20 bg-[#17345e] px-3 text-xs font-bold text-white outline-none placeholder:text-sky-100/35 focus:border-sky-300/60"
            />

            <div className="mt-2 grid grid-cols-3 gap-1.5">
              {[
                { id: "todos", label: "Todos" },
                { id: "ativo", label: "Ativos" },
                { id: "atrasado", label: "Atraso" },
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setFiltroStatus(item.id as any)}
                  className={[
                    "h-8 rounded-lg border text-[9px] font-black uppercase transition",
                    filtroStatus === item.id
                      ? "border-sky-300/40 bg-sky-400/15 text-sky-100"
                      : "border-[#7ba6d4]/20 bg-[#143760] text-sky-100/55 hover:bg-[#17345e]",
                  ].join(" ")}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2.5 scrollbar-none">
            {clientesFiltrados.map((cliente) => {
              const ativo = cliente.id === selecionadoId;
              const status = STATUS_CONFIG[cliente.statusCalculado];
              const projecao = cliente.projecao;

              return (
                <button
                  key={cliente.id}
                  type="button"
                  onClick={() => selecionarCliente(cliente)}
                  className={[
                    "mb-2 w-full rounded-xl border p-3 text-left transition",
                    ativo
                      ? "border-sky-300/45 bg-[#2b5b91]/45"
                      : "border-[#7ba6d4]/15 bg-[#143760] hover:border-sky-300/30 hover:bg-[#17345e]",
                  ].join(" ")}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-white">
                        {cliente.clienteNome || "Cliente sem nome"}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-sky-100/50">
                        {cliente.embarcacaoNome ||
                          cliente.embarcacaoId ||
                          "Barco não informado"}
                      </p>
                    </div>

                    <span
                      className={[
                        "rounded-full border px-2 py-1 text-[8px] font-black uppercase",
                        status.classe,
                      ].join(" ")}
                    >
                      {status.label}
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Mini label="Mensalidade" valor={moeda(projecao.valorAtual)} />
                    <Mini
                      label="Vencimento"
                      valor={formatarData(projecao.proximoVencimento)}
                    />
                  </div>
                </button>
              );
            })}

            {clientesFiltrados.length === 0 && (
              <div className="rounded-xl border border-[#7ba6d4]/20 bg-[#143760] p-6 text-center text-sm text-sky-100/50">
                Nenhum cliente encontrado.
              </div>
            )}
          </div>
        </aside>

        <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[#7ba6d4]/20 bg-[#0f2240]">
          <div className="shrink-0 border-b border-[#7ba6d4]/15 p-3">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <h2 className="text-base font-black">Cadastro financeiro</h2>
                <p className="mt-1 text-xs text-sky-100/45">
                  Plano GPS profissional com mensalidade base de {moeda(VALOR_BASE_GPS)}.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {form.id && (
                  <button
                    onClick={removerCliente}
                    className="h-9 rounded-xl border border-red-400/20 bg-red-400/10 px-3 text-[10px] font-black uppercase text-red-300 transition hover:bg-red-400/20"
                  >
                    Remover
                  </button>
                )}

                <button
                  onClick={salvarCliente}
                  disabled={salvando}
                  className="h-9 rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-4 text-[10px] font-black uppercase text-emerald-300 transition hover:bg-emerald-400/20 disabled:opacity-60"
                >
                  {salvando ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3 scrollbar-none">
            <div className="grid gap-3 xl:grid-cols-2">
              <Campo
                label="Nome do cliente / empresa"
                value={form.clienteNome}
                onChange={(v) => alterar("clienteNome", v)}
              />
              <Campo
                label="CPF/CNPJ"
                value={form.clienteDocumento}
                onChange={(v) => alterar("clienteDocumento", v)}
              />
              <Campo
                label="Telefone / WhatsApp"
                value={form.clienteTelefone}
                onChange={(v) => alterar("clienteTelefone", v)}
              />
              <Campo
                label="E-mail"
                value={form.clienteEmail}
                onChange={(v) => alterar("clienteEmail", v)}
              />
              <Campo
                label="Cidade"
                value={form.cidade}
                onChange={(v) => alterar("cidade", v)}
              />
              <Campo
                label="Estado"
                value={form.estado}
                onChange={(v) => alterar("estado", v)}
              />
              <Campo
                label="Endereço / referência"
                value={form.endereco}
                onChange={(v) => alterar("endereco", v)}
              />
              <Campo
                label="Responsável financeiro"
                value={form.responsavel}
                onChange={(v) => alterar("responsavel", v)}
              />
            </div>

            <div className="mt-3 rounded-2xl border border-[#7ba6d4]/20 bg-[#143760] p-3">
              <h3 className="text-sm font-black">Barco e rastreador</h3>

              <div className="mt-3 grid gap-3 xl:grid-cols-3">
                <Campo
                  label="ID da embarcação"
                  value={form.embarcacaoId}
                  onChange={(v) => alterar("embarcacaoId", v)}
                />
                <Campo
                  label="Nome da embarcação"
                  value={form.embarcacaoNome}
                  onChange={(v) => alterar("embarcacaoNome", v)}
                />
                <Campo
                  label="ID do rastreador GPS"
                  value={form.rastreadorId}
                  onChange={(v) => alterar("rastreadorId", v)}
                />
              </div>
            </div>

            <div className="mt-3 rounded-2xl border border-[#7ba6d4]/20 bg-[#143760] p-3">
              <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
                <div>
                  <h3 className="text-sm font-black">Plano e promoção</h3>
                  <p className="mt-1 text-xs text-sky-100/45">
                    Oferta de lançamento com desconto temporário e retorno automático ao
                    valor cheio.
                  </p>
                </div>

                <span className="rounded-full border border-sky-300/25 bg-sky-400/10 px-3 py-1 text-[10px] font-black uppercase text-sky-100">
                  {projecaoForm.emPromocao
                    ? `${projecaoForm.descontoAtual}% ativo`
                    : "Valor cheio"}
                </span>
              </div>

              <div className="mt-3 grid gap-3 xl:grid-cols-4">
                <Campo
                  label="Mensalidade base"
                  value={String(form.valorBaseMensalidade).replace(".", ",")}
                  onChange={(v) => alterar("valorBaseMensalidade", numeroMoeda(v))}
                />
                <Campo
                  label="Desconto %"
                  value={String(form.descontoPercentual)}
                  onChange={(v) => alterar("descontoPercentual", Number(v))}
                />
                <Campo
                  label="Meses promocionais"
                  value={String(form.mesesPromocionais)}
                  onChange={(v) => alterar("mesesPromocionais", Number(v))}
                />
                <Campo
                  label="Cupom"
                  value={form.cupom}
                  onChange={(v) => alterar("cupom", v)}
                />
                <Campo
                  label="Dia de vencimento"
                  value={String(form.diaVencimento)}
                  onChange={(v) => alterar("diaVencimento", Number(v))}
                />
                <Campo
                  label="Início do contrato"
                  type="date"
                  value={form.dataInicio}
                  onChange={(v) => alterar("dataInicio", v)}
                />
                <Campo
                  label="Data de instalação"
                  type="date"
                  value={form.dataInstalacao}
                  onChange={(v) => alterar("dataInstalacao", v)}
                />

                <label>
                  <p className="mb-1 text-[9px] font-black uppercase tracking-wide text-sky-100/45">
                    Status manual
                  </p>
                  <select
                    value={form.status}
                    onChange={(e) => alterar("status", e.target.value)}
                    className="h-10 w-full rounded-xl border border-[#7ba6d4]/20 bg-[#17345e] px-3 text-sm font-bold text-white outline-none focus:border-sky-300/60"
                  >
                    <option value="promocional">Promocional</option>
                    <option value="ativo">Ativo</option>
                    <option value="atrasado">Atrasado</option>
                    <option value="pausado">Pausado</option>
                    <option value="cancelado">Cancelado</option>
                  </select>
                </label>
              </div>

              <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                <Mini
                  label="Valor atual"
                  valor={moeda(projecaoForm.valorAtual)}
                  destaque
                />
                <Mini label="Valor cheio" valor={moeda(projecaoForm.valorCheio)} />
                <Mini
                  label="Fim da promoção"
                  valor={formatarData(projecaoForm.fimPromocao)}
                />
                <Mini
                  label="Próximo vencimento"
                  valor={formatarData(projecaoForm.proximoVencimento)}
                />
              </div>
            </div>

            <div className="mt-3 rounded-2xl border border-[#7ba6d4]/20 bg-[#143760] p-3">
              <h3 className="text-sm font-black">Direitos liberados</h3>
              <p className="mt-1 text-xs text-sky-100/45">
                Marque exatamente o que o cliente tem direito neste plano.
              </p>

              <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {DIREITOS_PADRAO.map((direito) => {
                  const marcado = form.direitos.includes(direito);

                  return (
                    <button
                      key={direito}
                      type="button"
                      onClick={() => alternarDireito(direito)}
                      className={[
                        "rounded-xl border p-3 text-left text-xs font-bold transition",
                        marcado
                          ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200"
                          : "border-[#7ba6d4]/20 bg-[#17345e] text-sky-100/50 hover:text-sky-100",
                      ].join(" ")}
                    >
                      <span className="mr-2">{marcado ? "✅" : "⬚"}</span>
                      {direito}
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="mt-3 block rounded-2xl border border-[#7ba6d4]/20 bg-[#143760] p-3">
              <p className="mb-1 text-[9px] font-black uppercase tracking-wide text-sky-100/45">
                Observações internas
              </p>
              <textarea
                value={form.observacoes}
                onChange={(e) => alterar("observacoes", e.target.value)}
                rows={3}
                placeholder="Ex: cliente entrou na promoção de lançamento; revisar desconto em 90 dias..."
                className="w-full resize-none rounded-xl border border-[#7ba6d4]/20 bg-[#17345e] px-3 py-2 text-sm font-bold text-white outline-none placeholder:text-sky-100/35 focus:border-sky-300/60"
              />
            </label>
          </div>
        </section>

        <aside className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[#7ba6d4]/20 bg-[#0f2240]">
          <div className="shrink-0 border-b border-[#7ba6d4]/15 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-black leading-none">
                  Financeiro do cliente
                </h2>
                <p className="mt-1 text-[11px] text-sky-100/45">
                  Cobrança, histórico e contrato.
                </p>
              </div>

              <span
                className={[
                  "rounded-full border px-2.5 py-1 text-[9px] font-black uppercase",
                  STATUS_CONFIG[statusAutomatico(form)].classe,
                ].join(" ")}
              >
                {STATUS_CONFIG[statusAutomatico(form)].label}
              </span>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl border border-[#7ba6d4]/15 bg-[#143760] p-1">
              {[
                { id: "cobranca", label: "Cobrança" },
                {
                  id: "historico",
                  label: `Histórico ${(form.historicoPagamentos || []).length}`,
                },
                { id: "contrato", label: "Contrato" },
              ].map((aba) => (
                <button
                  key={aba.id}
                  type="button"
                  onClick={() =>
                    setAbaDireita(aba.id as "cobranca" | "historico" | "contrato")
                  }
                  className={[
                    "h-9 rounded-lg text-[10px] font-black uppercase transition",
                    abaDireita === aba.id
                      ? "bg-sky-400/15 text-sky-100 shadow-sm"
                      : "text-sky-100/45 hover:bg-[#17345e] hover:text-sky-100",
                  ].join(" ")}
                >
                  {aba.label}
                </button>
              ))}
            </div>
          </div>

          {abaDireita === "cobranca" && (
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 scrollbar-none">
              <section className="rounded-2xl border border-[#7ba6d4]/20 bg-[#143760] p-3">
                <h3 className="text-sm font-black">Previsão da mensalidade</h3>
                <p className="mt-1 text-xs text-sky-100/45">
                  Valor atual, desconto e retorno ao plano cheio.
                </p>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Mini label="Agora" valor={moeda(projecaoForm.valorAtual)} destaque />
                  <Mini label="Depois" valor={moeda(projecaoForm.valorCheio)} />
                  <Mini label="Desconto" valor={`${projecaoForm.descontoAtual}%`} />
                  <Mini
                    label="Restam"
                    valor={`${projecaoForm.mesesRestantesPromo} mês(es)`}
                  />
                  <Mini
                    label="Vencimento"
                    valor={formatarData(projecaoForm.proximoVencimento)}
                  />
                  <Mini
                    label="Fim promoção"
                    valor={formatarData(projecaoForm.fimPromocao)}
                  />
                </div>
              </section>

              <section className="mt-3 rounded-2xl border border-[#7ba6d4]/20 bg-[#143760] p-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-black">Registrar pagamento</h3>
                    <p className="mt-1 text-[11px] text-sky-100/45">
                      Baixe a mensalidade no histórico do cliente.
                    </p>
                  </div>
                  <span className="rounded-full border border-[#7ba6d4]/20 bg-[#17345e] px-2.5 py-1 text-[9px] font-black uppercase text-sky-100/55">
                    {formatarMesCompetencia()}
                  </span>
                </div>

                <div className="grid gap-2">
                  <div className="grid grid-cols-[1fr_135px] gap-2">
                    <Campo
                      label="Valor pago"
                      value={pagamentoValor}
                      onChange={setPagamentoValor}
                    />
                    <label>
                      <p className="mb-1 text-[9px] font-black uppercase tracking-wide text-sky-100/45">
                        Forma
                      </p>
                      <select
                        value={pagamentoForma}
                        onChange={(e) =>
                          setPagamentoForma(e.target.value as FormaPagamento)
                        }
                        className="h-10 w-full rounded-xl border border-[#7ba6d4]/20 bg-[#17345e] px-3 text-sm font-bold text-white outline-none focus:border-sky-300/60"
                      >
                        {FORMAS_PAGAMENTO.map((forma) => (
                          <option key={forma.id} value={forma.id}>
                            {forma.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <Campo
                    label="Observação"
                    value={pagamentoObs}
                    onChange={setPagamentoObs}
                  />
                  <button
                    onClick={registrarPagamento}
                    className="h-10 rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-4 text-xs font-black uppercase text-emerald-300 transition hover:bg-emerald-400/20"
                  >
                    Confirmar pagamento
                  </button>
                </div>
              </section>
            </div>
          )}

          {abaDireita === "historico" && (
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 scrollbar-none">
              <div className="mb-3 rounded-2xl border border-[#7ba6d4]/20 bg-[#143760] p-3">
                <h3 className="text-sm font-black">Resumo do cliente</h3>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Mini label="Cliente" valor={form.clienteNome || "—"} />
                  <Mini
                    label="Barco"
                    valor={form.embarcacaoNome || form.embarcacaoId || "—"}
                  />
                  <Mini label="Cupom" valor={form.cupom || "—"} />
                  <Mini label="Vencimento" valor={`Dia ${form.diaVencimento || "—"}`} />
                </div>
              </div>

              {(form.historicoPagamentos || []).map((pagamento) => (
                <div
                  key={pagamento.id}
                  className="mb-2 rounded-xl border border-[#7ba6d4]/15 bg-[#143760] p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-base font-black text-white">
                        {moeda(pagamento.valor)}
                      </p>
                      <p className="mt-0.5 text-[11px] text-sky-100/45">
                        Competência {pagamento.competencia}
                      </p>
                    </div>
                    <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-[9px] font-black uppercase text-emerald-300">
                      {pagamento.forma}
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Mini label="Pago em" valor={formatarData(pagamento.pagoEm)} />
                    <Mini label="Vencimento" valor={formatarData(pagamento.vencimento)} />
                    <Mini
                      label="Desconto"
                      valor={`${pagamento.descontoPercentual || 0}%`}
                    />
                    <Mini label="ID" valor={pagamento.id} />
                  </div>

                  <div className="mt-3 rounded-lg border border-[#7ba6d4]/15 bg-[#17345e] p-3">
                    <p className="text-[9px] font-black uppercase tracking-wide text-sky-100/40">
                      Registrado por
                    </p>
                    <p className="mt-1 truncate text-xs font-black text-sky-100">
                      {pagamento.registradoPorNome ||
                        pagamento.registradoPorEmail ||
                        "Não informado"}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-sky-100/45">
                      {pagamento.registradoPorEmail || "sem e-mail"} •{" "}
                      {formatarData(pagamento.registradoEmISO || pagamento.criadoEmISO)}
                    </p>
                  </div>

                  {pagamento.observacao && (
                    <div className="mt-3 rounded-lg border border-[#7ba6d4]/15 bg-[#17345e] p-3">
                      <p className="text-[9px] font-black uppercase tracking-wide text-sky-100/40">
                        Observação do pagamento
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-sky-100/70">
                        {pagamento.observacao}
                      </p>
                    </div>
                  )}
                </div>
              ))}

              {(!form.historicoPagamentos || form.historicoPagamentos.length === 0) && (
                <div className="rounded-xl border border-[#7ba6d4]/20 bg-[#143760] p-6 text-center text-sm text-sky-100/50">
                  Nenhum pagamento registrado para este cliente.
                </div>
              )}
            </div>
          )}

          {abaDireita === "contrato" && (
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 scrollbar-none">
              <section className="rounded-2xl border border-[#7ba6d4]/20 bg-[#143760] p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-black">Contrato automático</h3>
                    <p className="mt-1 text-xs text-sky-100/45">
                      Gere o contrato com os dados atuais do cliente.
                    </p>
                  </div>
                  <span
                    className={[
                      "rounded-full border px-2.5 py-1 text-[9px] font-black uppercase",
                      form.contrato?.status === "assinado"
                        ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
                        : form.contrato?.status === "gerado"
                          ? "border-sky-400/20 bg-sky-400/10 text-sky-200"
                          : "border-slate-500/20 bg-slate-500/10 text-slate-300",
                    ].join(" ")}
                  >
                    {form.contrato?.status || "rascunho"}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Mini
                    label="Número"
                    valor={form.contrato?.numero || numeroContrato(form)}
                  />
                  <Mini label="Versão" valor={form.contrato?.versao || "001"} />
                  <Mini
                    label="Gerado em"
                    valor={formatarData(form.contrato?.geradoEmISO)}
                  />
                  <Mini label="Gerado por" valor={form.contrato?.geradoPorNome || "—"} />
                </div>

                <div className="mt-3 grid gap-2">
                  <button
                    type="button"
                    onClick={gerarContrato}
                    className="h-10 rounded-xl border border-sky-300/25 bg-sky-400/10 px-4 text-xs font-black uppercase text-sky-100 transition hover:bg-sky-400/20"
                  >
                    Gerar / atualizar contrato
                  </button>
                  <button
                    type="button"
                    onClick={imprimirContrato}
                    className="h-10 rounded-xl border border-[#7ba6d4]/20 bg-[#17345e] px-4 text-xs font-black uppercase text-sky-100 transition hover:bg-[#2b5b91]"
                  >
                    Visualizar / imprimir PDF
                  </button>
                  {form.contrato && form.contrato.status !== "assinado" && (
                    <button
                      type="button"
                      onClick={marcarContratoAssinado}
                      className="h-10 rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-4 text-xs font-black uppercase text-emerald-300 transition hover:bg-emerald-400/20"
                    >
                      Marcar como assinado
                    </button>
                  )}
                </div>
              </section>

              <section className="mt-3 rounded-2xl border border-[#7ba6d4]/20 bg-[#143760] p-3">
                <h3 className="text-sm font-black">Prévia do contrato</h3>
                <p className="mt-1 text-xs text-sky-100/45">
                  Esta prévia usa os dados atuais do cadastro.
                </p>
                <div className="mt-3 max-h-[520px] overflow-y-auto rounded-xl border border-[#7ba6d4]/20 bg-white p-3 text-slate-900">
                  <div
                    className="prose prose-sm max-w-none"
                    dangerouslySetInnerHTML={{
                      __html: form.contrato?.html || gerarHtmlContrato(form),
                    }}
                  />
                </div>
              </section>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}

function ResumoCard({
  label,
  valor,
  sub,
  destaque = "default",
}: {
  label: string;
  valor: string | number;
  sub: string;
  destaque?: "default" | "emerald" | "sky" | "red";
}) {
  const cor =
    destaque === "emerald"
      ? "text-emerald-300"
      : destaque === "sky"
        ? "text-sky-200"
        : destaque === "red"
          ? "text-red-300"
          : "text-white";

  return (
    <div className="rounded-2xl border border-[#7ba6d4]/20 bg-[#0f2240] p-3">
      <p className="text-[9px] font-black uppercase tracking-wide text-sky-100/40">
        {label}
      </p>
      <p className={["mt-1 truncate text-lg font-black", cor].join(" ")}>{valor}</p>
      <p className="mt-0.5 truncate text-[10px] text-sky-100/35">{sub}</p>
    </div>
  );
}

function Campo({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (valor: string) => void;
  type?: string;
}) {
  return (
    <label>
      <p className="mb-1 text-[9px] font-black uppercase tracking-wide text-sky-100/45">
        {label}
      </p>
      <input
        type={type}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full rounded-xl border border-[#7ba6d4]/20 bg-[#17345e] px-3 text-sm font-bold text-white outline-none placeholder:text-sky-100/35 focus:border-sky-300/60"
      />
    </label>
  );
}

function Mini({
  label,
  valor,
  destaque = false,
}: {
  label: string;
  valor: React.ReactNode;
  destaque?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-[#7ba6d4]/15 bg-[#17345e] p-2.5">
      <p className="text-[8px] font-black uppercase text-sky-100/40">{label}</p>
      <p
        className={[
          "mt-0.5 truncate text-xs font-black",
          destaque ? "text-emerald-300" : "text-sky-100",
        ].join(" ")}
      >
        {valor}
      </p>
    </div>
  );
}
