import React from "react";

type EtapaChecklist = {
  numero: string;
  titulo: string;
  prioridade: string;
  descricao: string;
  verificar: string[];
  ausentes: string[];
  problema: string;
  acao: string;
};

export default function ChecklistRastreadorGPS() {
  const etapas: EtapaChecklist[] = [
    {
      numero: "01",
      titulo: "Verificar status no Firebase",
      prioridade: "Primeiro passo",
      descricao:
        "Antes de mexer no equipamento físico, verifique no Firebase se o rastreador está aparecendo como online.",
      verificar: [
        "Campo online está como true",
        "Última atualização é recente",
        "Latitude e longitude estão chegando",
        "O rastreador está vinculado à embarcação correta",
        "O documento do rastreador existe no Firebase",
      ],
      ausentes: [
        "online aparece como false",
        "Última atualização ausente",
        "Latitude ausente",
        "Longitude ausente",
        "Documento do rastreador não encontrado",
      ],
      problema:
        "Se o rastreador estiver offline ou sem atualização recente, ele pode estar sem internet, sem energia, com falha no Wi-Fi ou sem comunicação com o Firebase.",
      acao: "Confirmar se o equipamento está ligado, conectado ao Wi-Fi e enviando dados corretamente.",
    },
    {
      numero: "02",
      titulo: "Verificar conexão Wi-Fi",
      prioridade: "Conexão",
      descricao:
        "Confirmar se o rastreador está recebendo sinal de Wi-Fi e tentando conectar corretamente.",
      verificar: [
        "Wi-Fi está ligado",
        "O sinal chega até o local onde o rastreador está instalado",
        "A senha do Wi-Fi está correta",
        "O roteador está com internet",
        "O rastreador está tentando conectar",
      ],
      ausentes: [
        "Wi-Fi ausente",
        "Internet ausente",
        "Sinal fraco",
        "Senha incorreta",
        "Rastreador não conecta à rede",
      ],
      problema:
        "Se o Wi-Fi estiver fraco, sem internet ou com senha incorreta, o GPS pode ligar, mas não conseguirá enviar dados para o Firebase.",
      acao: "Reiniciar o roteador, aproximar o rastreador do sinal ou revisar as configurações de Wi-Fi.",
    },
    {
      numero: "03",
      titulo: "Verificar provisionamento",
      prioridade: "Configuração",
      descricao:
        "Verificar se o equipamento está tentando enviar o provisionamento para ficar online no sistema.",
      verificar: [
        "O rastreador recebeu as configurações corretas",
        "O ID do rastreador está correto",
        "O ID da embarcação está correto",
        "O dispositivo está tentando se registrar no sistema",
        "O envio para o Firebase não está bloqueado",
      ],
      ausentes: [
        "Provisionamento ausente",
        "ID do rastreador ausente",
        "ID da embarcação ausente",
        "Configuração do Wi-Fi ausente",
        "Rastreador não aparece no sistema",
      ],
      problema:
        "Sem provisionamento correto, o rastreador pode até ligar e conectar no Wi-Fi, mas não será identificado corretamente pelo sistema.",
      acao: "Reenviar o provisionamento e confirmar se o rastreador aparece online no Firebase.",
    },
    {
      numero: "04",
      titulo: "Verificar fonte de energia",
      prioridade: "Energia",
      descricao:
        "Confirmar se a fonte está ligada corretamente e se o equipamento está recebendo energia suficiente.",
      verificar: [
        "Fonte ligada na tomada",
        "Tomada funcionando corretamente",
        "Cabo de energia bem encaixado",
        "Fonte fornecendo energia suficiente",
        "Rastreador ligando normalmente",
      ],
      ausentes: [
        "Energia ausente",
        "Fonte desligada",
        "Tomada sem energia",
        "Cabo de energia solto",
        "Fonte fraca ou com defeito",
      ],
      problema:
        "Se a fonte não estiver ligada na tomada ou estiver com energia fraca, o rastreador pode travar, desligar, perder Wi-Fi ou não conseguir enviar localização.",
      acao: "Testar outra tomada, revisar a fonte e confirmar se a energia está chegando de forma estável.",
    },
    {
      numero: "05",
      titulo: "Verificar fios e conexões",
      prioridade: "Instalação",
      descricao:
        "Conferir se os fios do ESP32, módulo GPS e alimentação estão bem conectados.",
      verificar: [
        "Fios de energia bem conectados",
        "Fios do módulo GPS conectados corretamente",
        "Conexões do ESP32 firmes",
        "Nenhum cabo solto ou quebrado",
        "Sem umidade, oxidação ou mau contato",
      ],
      ausentes: [
        "Fio solto",
        "Mau contato",
        "Cabo rompido",
        "Conexão oxidada",
        "Módulo GPS desconectado",
      ],
      problema:
        "Fio frouxo, mau contato, cabo desconectado ou oxidação pode impedir o GPS de funcionar corretamente.",
      acao: "Reencaixar os fios com cuidado e verificar se o equipamento volta a enviar localização.",
    },
    {
      numero: "06",
      titulo: "Verificar sinal do GPS",
      prioridade: "Localização",
      descricao:
        "O GPS pode demorar alguns minutos para encontrar satélites, principalmente em local fechado ou com interferência.",
      verificar: [
        "Rastreador está em local aberto",
        "Não está dentro de caixa metálica",
        "Não está coberto por estrutura que bloqueia o sinal",
        "Número de satélites aparece no sistema",
        "Latitude e longitude estão atualizando",
      ],
      ausentes: [
        "Satélites ausentes",
        "Latitude ausente",
        "Longitude ausente",
        "Velocidade ausente",
        "Localização travada ou antiga",
      ],
      problema:
        "Em local fechado, coberto ou com interferência, o GPS pode demorar mais para encontrar sinal.",
      acao: "Deixar o equipamento ligado por alguns minutos em área aberta até captar os satélites.",
    },
    {
      numero: "07",
      titulo: "Reiniciar o equipamento",
      prioridade: "Último teste simples",
      descricao:
        "Se tudo estiver aparentemente correto, reiniciar o rastreador pode resolver falhas temporárias.",
      verificar: [
        "Desligar a fonte",
        "Aguardar alguns segundos",
        "Ligar novamente",
        "Esperar conectar ao Wi-Fi",
        "Verificar novamente no Firebase se ficou online",
      ],
      ausentes: [
        "Rastreador continua offline",
        "Não voltou para online true",
        "Não atualizou localização",
        "Não conectou ao Wi-Fi",
        "Não enviou dados ao Firebase",
      ],
      problema:
        "Às vezes o equipamento pode travar temporariamente por queda de energia, sinal fraco ou falha de conexão.",
      acao: "Após reiniciar, verificar se o campo online voltou para true e se a localização voltou a atualizar.",
    },
  ];

  const resumoRapido: string[] = [
    "Verificar se está online true no Firebase",
    "Verificar se a última atualização é recente",
    "Conferir se o Wi-Fi está funcionando",
    "Verificar se existe internet no roteador",
    "Confirmar se o provisionamento foi enviado",
    "Conferir se a fonte está ligada na tomada",
    "Verificar se a energia está forte e estável",
    "Conferir fios e conexões",
    "Verificar se o GPS está em local aberto",
    "Reiniciar o equipamento",
    "Se não resolver, encaminhar para manutenção técnica",
  ];

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <p style={styles.label}>Suporte do Rastreador</p>
          <h1 style={styles.title}>Checklist do Rastreador GPS</h1>
          <p style={styles.subtitle}>
            Use este checklist quando o GPS demorar para aparecer no mapa, ficar offline
            ou parar de enviar localização.
          </p>
        </div>

        <div style={styles.statusBox}>
          <span style={styles.statusDot} />
          Verificação técnica
        </div>
      </div>

      <div style={styles.alertBox}>
        <strong>Atenção:</strong> antes de considerar defeito no rastreador, siga todos os
        passos abaixo. Muitas falhas podem ser causadas por Wi-Fi fraco, fonte desligada,
        energia insuficiente, provisionamento ausente ou fios mal conectados.
      </div>

      <div style={styles.grid}>
        {etapas.map((etapa) => (
          <div key={etapa.numero} style={styles.card}>
            <div style={styles.cardTop}>
              <span style={styles.number}>{etapa.numero}</span>
              <span style={styles.badge}>{etapa.prioridade}</span>
            </div>

            <h2 style={styles.cardTitle}>{etapa.titulo}</h2>
            <p style={styles.description}>{etapa.descricao}</p>

            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>O que verificar</h3>
              <ul style={styles.list}>
                {etapa.verificar.map((item) => (
                  <li key={item} style={styles.listItem}>
                    <span style={styles.check}>✓</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>Itens que podem aparecer como ausentes</h3>
              <ul style={styles.list}>
                {etapa.ausentes.map((item) => (
                  <li key={item} style={styles.listItem}>
                    <span style={styles.warning}>!</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div style={styles.problemBox}>
              <strong>Possível causa:</strong>
              <p style={styles.boxText}>{etapa.problema}</p>
            </div>

            <div style={styles.actionBox}>
              <strong>Ação recomendada:</strong>
              <p style={styles.boxText}>{etapa.acao}</p>
            </div>
          </div>
        ))}
      </div>

      <div style={styles.summaryCard}>
        <h2 style={styles.summaryTitle}>Resumo rápido do checklist</h2>

        <div style={styles.summaryList}>
          {resumoRapido.map((item, index) => (
            <div key={item} style={styles.summaryItem}>
              <span style={styles.summaryNumber}>{index + 1}</span>
              <span>{item}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    width: "100%",
    minHeight: "100vh",
    padding: "28px",
    background: "#f4f7fb",
    color: "#0f172a",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    gap: "20px",
    alignItems: "flex-start",
    marginBottom: "22px",
  },
  label: {
    margin: 0,
    fontSize: "13px",
    fontWeight: 700,
    color: "#0284c7",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },
  title: {
    margin: "6px 0 8px",
    fontSize: "30px",
    fontWeight: 800,
    color: "#0f172a",
  },
  subtitle: {
    margin: 0,
    maxWidth: "720px",
    fontSize: "15px",
    color: "#475569",
    lineHeight: 1.6,
  },
  statusBox: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "10px 14px",
    borderRadius: "999px",
    background: "#e0f2fe",
    color: "#0369a1",
    fontSize: "13px",
    fontWeight: 700,
    whiteSpace: "nowrap",
  },
  statusDot: {
    width: "9px",
    height: "9px",
    borderRadius: "50%",
    background: "#0ea5e9",
  },
  alertBox: {
    marginBottom: "24px",
    padding: "16px 18px",
    borderRadius: "16px",
    background: "#fff7ed",
    border: "1px solid #fed7aa",
    color: "#9a3412",
    fontSize: "14px",
    lineHeight: 1.6,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: "18px",
  },
  card: {
    background: "#ffffff",
    borderRadius: "20px",
    padding: "20px",
    boxShadow: "0 12px 30px rgba(15, 23, 42, 0.08)",
    border: "1px solid #e2e8f0",
  },
  cardTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "14px",
  },
  number: {
    width: "42px",
    height: "42px",
    borderRadius: "14px",
    background: "#0f172a",
    color: "#ffffff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 800,
    fontSize: "14px",
  },
  badge: {
    padding: "7px 10px",
    borderRadius: "999px",
    background: "#e0f2fe",
    color: "#0369a1",
    fontSize: "12px",
    fontWeight: 700,
  },
  cardTitle: {
    margin: "0 0 8px",
    fontSize: "19px",
    color: "#0f172a",
  },
  description: {
    margin: "0 0 16px",
    color: "#475569",
    fontSize: "14px",
    lineHeight: 1.6,
  },
  section: {
    marginTop: "14px",
  },
  sectionTitle: {
    margin: "0 0 10px",
    fontSize: "14px",
    color: "#1e293b",
  },
  list: {
    margin: 0,
    padding: 0,
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  listItem: {
    display: "flex",
    alignItems: "flex-start",
    gap: "8px",
    fontSize: "14px",
    color: "#334155",
    lineHeight: 1.4,
  },
  check: {
    color: "#16a34a",
    fontWeight: 800,
  },
  warning: {
    width: "18px",
    height: "18px",
    minWidth: "18px",
    borderRadius: "50%",
    background: "#f97316",
    color: "#ffffff",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "12px",
    fontWeight: 900,
    marginTop: "1px",
  },
  problemBox: {
    marginTop: "16px",
    padding: "13px",
    borderRadius: "14px",
    background: "#fef2f2",
    color: "#991b1b",
    fontSize: "13px",
    lineHeight: 1.5,
  },
  actionBox: {
    marginTop: "10px",
    padding: "13px",
    borderRadius: "14px",
    background: "#f0fdf4",
    color: "#166534",
    fontSize: "13px",
    lineHeight: 1.5,
  },
  boxText: {
    margin: "6px 0 0",
  },
  summaryCard: {
    marginTop: "24px",
    padding: "22px",
    borderRadius: "20px",
    background: "#0f172a",
    color: "#ffffff",
    boxShadow: "0 14px 35px rgba(15, 23, 42, 0.18)",
  },
  summaryTitle: {
    margin: "0 0 16px",
    fontSize: "21px",
  },
  summaryList: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
    gap: "10px",
  },
  summaryItem: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "10px",
    borderRadius: "12px",
    background: "rgba(255,255,255,0.08)",
    fontSize: "14px",
  },
  summaryNumber: {
    width: "26px",
    height: "26px",
    minWidth: "26px",
    borderRadius: "50%",
    background: "#38bdf8",
    color: "#082f49",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 800,
    fontSize: "13px",
  },
};
