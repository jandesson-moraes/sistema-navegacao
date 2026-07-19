import React, { useCallback, useEffect, useMemo, useState } from "react";
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import { db } from "../config/firebase";

type MapaNumerico = Record<string, number>;

type MetricaDia = {
  id: string;
  data: string;
  visitas: number;
  visitantesUnicos: number;
  cliquesDownload: number;
  origens: MapaNumerico;
  dispositivos: MapaNumerico;
};

const cardStyle: React.CSSProperties = {
  background: "linear-gradient(145deg, #102744 0%, #0f1f36 100%)",
  border: "1px solid rgba(125, 211, 252, 0.16)",
  borderRadius: 18,
  padding: 18,
};

const thStyle: React.CSSProperties = {
  borderBottom: "1px solid rgba(148, 163, 184, 0.15)",
  padding: "11px 10px",
  textAlign: "left",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  borderBottom: "1px solid rgba(148, 163, 184, 0.1)",
  color: "#cbd5e1",
  fontSize: 13,
  padding: "12px 10px",
  whiteSpace: "nowrap",
};

function numero(valor: unknown) {
  const convertido = Number(valor || 0);
  return Number.isFinite(convertido) ? convertido : 0;
}

function mapaNumerico(valor: unknown): MapaNumerico {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return {};

  return Object.fromEntries(
    Object.entries(valor as Record<string, unknown>).map(([chave, total]) => [
      chave,
      numero(total),
    ]),
  );
}

function formatarInteiro(valor: number) {
  return new Intl.NumberFormat("pt-BR").format(valor);
}

function formatarPercentual(valor: number) {
  return `${valor.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

function formatarData(dataIso: string) {
  const [ano, mes, dia] = dataIso.split("-");
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : dataIso || "—";
}

function somarMapas(dias: MetricaDia[], campo: "origens" | "dispositivos") {
  const totais = new Map<string, number>();

  dias.forEach((dia) => {
    Object.entries(dia[campo]).forEach(([chave, valor]) => {
      totais.set(chave, (totais.get(chave) || 0) + numero(valor));
    });
  });

  return Array.from(totais.entries())
    .map(([nome, total]) => ({ nome, total }))
    .sort((a, b) => b.total - a.total);
}

function Card({
  titulo,
  valor,
  detalhe,
  destaque = false,
}: {
  titulo: string;
  valor: React.ReactNode;
  detalhe: string;
  destaque?: boolean;
}) {
  return (
    <div
      style={{
        ...cardStyle,
        borderColor: destaque
          ? "rgba(52, 211, 153, 0.45)"
          : "rgba(125, 211, 252, 0.16)",
      }}
    >
      <div
        style={{
          color: destaque ? "#34d399" : "#7dd3fc",
          fontSize: 11,
          fontWeight: 900,
          letterSpacing: 1.2,
          textTransform: "uppercase",
        }}
      >
        {titulo}
      </div>
      <div style={{ color: "#fff", fontSize: 32, fontWeight: 900, marginTop: 7 }}>
        {valor}
      </div>
      <div style={{ color: "#8fa9c4", fontSize: 12, marginTop: 4 }}>{detalhe}</div>
    </div>
  );
}

export default function MetricasLandingPage() {
  const [dias, setDias] = useState<MetricaDia[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro("");

    try {
      const consulta = query(
        collection(db, "metricas_landing_diarias"),
        orderBy("data", "desc"),
        limit(90),
      );
      const snapshot = await getDocs(consulta);

      setDias(
        snapshot.docs.map((documento) => {
          const dados = documento.data() as Record<string, unknown>;
          return {
            id: documento.id,
            data: String(dados.data || documento.id),
            visitas: numero(dados.visitas),
            visitantesUnicos: numero(dados.visitantesUnicos),
            cliquesDownload: numero(dados.cliquesDownload),
            origens: mapaNumerico(dados.origens),
            dispositivos: mapaNumerico(dados.dispositivos),
          };
        }),
      );
    } catch (error: any) {
      console.error("Erro ao carregar métricas da landing page:", error);
      setErro(error?.message || "Não foi possível carregar as métricas da landing page.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const hoje = new Date().toLocaleDateString("sv-SE");
  const hojeDados = dias.find((dia) => dia.data === hoje);
  const ultimos30 = dias.slice(0, 30);

  const totais = useMemo(
    () =>
      ultimos30.reduce(
        (acumulado, dia) => ({
          visitas: acumulado.visitas + dia.visitas,
          visitantesUnicos: acumulado.visitantesUnicos + dia.visitantesUnicos,
          cliquesDownload: acumulado.cliquesDownload + dia.cliquesDownload,
        }),
        { visitas: 0, visitantesUnicos: 0, cliquesDownload: 0 },
      ),
    [ultimos30],
  );

  const conversao =
    totais.visitantesUnicos > 0
      ? (totais.cliquesDownload / totais.visitantesUnicos) * 100
      : 0;
  const origens = useMemo(() => somarMapas(ultimos30, "origens"), [ultimos30]);
  const dispositivos = useMemo(
    () => somarMapas(ultimos30, "dispositivos"),
    [ultimos30],
  );
  const maiorVisitas = Math.max(1, ...ultimos30.map((dia) => dia.visitas));

  return (
    <div
      style={{
        background: "#070b22",
        color: "#fff",
        fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
        minHeight: "100vh",
        padding: 22,
      }}
    >
      <div
        style={{
          ...cardStyle,
          alignItems: "center",
          display: "flex",
          flexWrap: "wrap",
          gap: 20,
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <div>
          <div
            style={{
              color: "#34d399",
              fontSize: 11,
              fontWeight: 900,
              letterSpacing: 1.6,
              textTransform: "uppercase",
            }}
          >
            Cadê Meu Barco • Aquisição
          </div>
          <h1 style={{ fontSize: 30, margin: "6px 0" }}>Métricas da landing page</h1>
          <div style={{ color: "#8fa9c4", fontSize: 14 }}>
            Visitas, intenção de download, conversão, origem do tráfego e dispositivo.
          </div>
        </div>

        <button
          disabled={carregando}
          onClick={carregar}
          style={{
            background: "#0ea5e9",
            border: "none",
            borderRadius: 12,
            color: "#fff",
            cursor: carregando ? "default" : "pointer",
            fontWeight: 800,
            opacity: carregando ? 0.65 : 1,
            padding: "12px 18px",
          }}
        >
          {carregando ? "Atualizando..." : "Atualizar relatório"}
        </button>
      </div>

      {erro ? (
        <div
          style={{
            ...cardStyle,
            borderColor: "rgba(248, 113, 113, 0.4)",
            color: "#fecaca",
            marginBottom: 16,
          }}
        >
          {erro}
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
        }}
      >
        <Card
          titulo="Visitas hoje"
          valor={formatarInteiro(hojeDados?.visitas || 0)}
          detalhe="Total de entradas na landing page"
        />
        <Card
          titulo="Visitantes hoje"
          valor={formatarInteiro(hojeDados?.visitantesUnicos || 0)}
          detalhe="Pessoas diferentes estimadas hoje"
        />
        <Card
          titulo="Cliques hoje"
          valor={formatarInteiro(hojeDados?.cliquesDownload || 0)}
          detalhe="Cliques para abrir a Google Play"
          destaque
        />
        <Card
          titulo="Visitas em 30 dias"
          valor={formatarInteiro(totais.visitas)}
          detalhe="Movimento acumulado no período"
        />
        <Card
          titulo="Cliques em 30 dias"
          valor={formatarInteiro(totais.cliquesDownload)}
          detalhe="Intenções de download no período"
          destaque
        />
        <Card
          titulo="Conversão"
          valor={formatarPercentual(conversao)}
          detalhe="Cliques divididos por visitantes únicos"
          destaque
        />
      </div>

      <div
        style={{
          display: "grid",
          gap: 14,
          gridTemplateColumns: "minmax(0, 2fr) minmax(260px, 1fr)",
          marginTop: 14,
        }}
      >
        <section style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Últimos 30 dias</h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", minWidth: 650, width: "100%" }}>
              <thead>
                <tr style={{ color: "#7dd3fc", fontSize: 12 }}>
                  <th style={thStyle}>Dia</th>
                  <th style={thStyle}>Visitas</th>
                  <th style={thStyle}>Visitantes</th>
                  <th style={thStyle}>Cliques</th>
                  <th style={thStyle}>Conversão</th>
                  <th style={thStyle}>Movimento</th>
                </tr>
              </thead>
              <tbody>
                {ultimos30.map((dia) => (
                  <tr key={dia.id}>
                    <td style={tdStyle}>{formatarData(dia.data)}</td>
                    <td style={tdStyle}>{formatarInteiro(dia.visitas)}</td>
                    <td style={tdStyle}>{formatarInteiro(dia.visitantesUnicos)}</td>
                    <td style={tdStyle}>{formatarInteiro(dia.cliquesDownload)}</td>
                    <td style={tdStyle}>
                      {formatarPercentual(
                        dia.visitantesUnicos > 0
                          ? (dia.cliquesDownload / dia.visitantesUnicos) * 100
                          : 0,
                      )}
                    </td>
                    <td style={{ ...tdStyle, minWidth: 130 }}>
                      <div
                        style={{
                          background: "rgba(148, 163, 184, 0.15)",
                          borderRadius: 20,
                          height: 8,
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            background: "#38bdf8",
                            borderRadius: 20,
                            height: "100%",
                            width: `${Math.max(4, (dia.visitas / maiorVisitas) * 100)}%`,
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}

                {!carregando && ultimos30.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={tdStyle}>
                      Nenhuma métrica registrada ainda.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <div style={{ display: "grid", gap: 14 }}>
          <section style={cardStyle}>
            <h2 style={{ marginTop: 0 }}>Origem dos acessos</h2>
            {origens.slice(0, 8).map((item) => (
              <div
                key={item.nome}
                style={{
                  borderBottom: "1px solid rgba(148, 163, 184, 0.12)",
                  display: "flex",
                  gap: 12,
                  justifyContent: "space-between",
                  padding: "11px 0",
                }}
              >
                <span style={{ color: "#cbd5e1" }}>{item.nome}</span>
                <strong style={{ color: "#38bdf8" }}>{formatarInteiro(item.total)}</strong>
              </div>
            ))}
            {!origens.length ? <div style={{ color: "#8fa9c4" }}>Sem dados ainda.</div> : null}
          </section>

          <section style={cardStyle}>
            <h2 style={{ marginTop: 0 }}>Dispositivos</h2>
            {dispositivos.map((item) => (
              <div
                key={item.nome}
                style={{
                  borderBottom: "1px solid rgba(148, 163, 184, 0.12)",
                  display: "flex",
                  gap: 12,
                  justifyContent: "space-between",
                  padding: "11px 0",
                }}
              >
                <span style={{ color: "#cbd5e1" }}>{item.nome}</span>
                <strong style={{ color: "#34d399" }}>{formatarInteiro(item.total)}</strong>
              </div>
            ))}
            {!dispositivos.length ? (
              <div style={{ color: "#8fa9c4" }}>Sem dados ainda.</div>
            ) : null}
          </section>
        </div>
      </div>

      <div
        style={{
          ...cardStyle,
          color: "#8fa9c4",
          fontSize: 12,
          lineHeight: 1.6,
          marginTop: 14,
        }}
      >
        <strong style={{ color: "#f8fafc" }}>Importante:</strong> “Cliques para baixar”
        mede quantas pessoas abriram a página do aplicativo na Google Play. A instalação
        concluída deve ser conferida no Google Play Console.
      </div>
    </div>
  );
}
