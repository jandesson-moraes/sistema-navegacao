import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  collection,
  collectionGroup,
  getCountFromServer,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  where,
} from "firebase/firestore";
import { db } from "../config/firebase";

type UsuarioMetrica = {
  id: string;
  uid?: string;
  primeiroAcessoEm?: any;
  primeiroAcessoData?: string;
  ultimoAcessoEm?: any;
  ultimoAcessoData?: string;
  totalAberturas?: number;
  totalTempoUsoSegundos?: number;
  diasAtivos?: number;
  plataforma?: string;
  appVersion?: string;
  buildVersion?: string;
  modeloDispositivo?: string;
  sistemaOperacional?: string;
  versaoSistema?: string;
  ambiente?: string;
};

type AcessoDia = {
  id: string;
  uid?: string;
  data?: string;
  primeiroAcessoEm?: any;
  ultimoAcessoEm?: any;
  aberturas?: number;
  tempoUsoSegundos?: number;
  plataforma?: string;
  appVersion?: string;
  buildVersion?: string;
  ambiente?: string;
};

type SessaoMetrica = {
  id: string;
  uid?: string;
  data?: string;
  iniciadoEm?: any;
  encerradoEm?: any;
  duracaoSegundos?: number;
  appVersion?: string;
  plataforma?: string;
  modeloDispositivo?: string;
  ambiente?: string;
};

type ResumoDia = {
  data: string;
  usuarios: number;
  aberturas: number;
  tempoUsoSegundos: number;
};

const cardStyle: React.CSSProperties = {
  background: "linear-gradient(145deg, #102744 0%, #0f1f36 100%)",
  border: "1px solid rgba(125, 211, 252, 0.16)",
  borderRadius: 18,
  padding: 18,
};

function dataLocalHoje() {
  const agora = new Date();
  const ano = agora.getFullYear();
  const mes = String(agora.getMonth() + 1).padStart(2, "0");
  const dia = String(agora.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

function dataDiasAtras(dias: number) {
  const data = new Date();
  data.setHours(0, 0, 0, 0);
  data.setDate(data.getDate() - dias + 1);
  return data;
}

function formatarData(valor: any) {
  try {
    const data = typeof valor?.toDate === "function" ? valor.toDate() : new Date(valor);

    if (Number.isNaN(data.getTime())) return "—";

    return data.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function formatarDuracao(segundosValor: number) {
  const segundos = Math.max(0, Number(segundosValor || 0));

  if (segundos < 60) return `${Math.round(segundos)}s`;

  const minutos = Math.floor(segundos / 60);

  if (minutos < 60) return `${minutos}min`;

  const horas = Math.floor(minutos / 60);
  const minutosRestantes = minutos % 60;

  return minutosRestantes > 0 ? `${horas}h ${minutosRestantes}min` : `${horas}h`;
}

function formatarDataCurta(dataIso: string) {
  const [ano, mes, dia] = dataIso.split("-");
  return `${dia}/${mes}`;
}

function Card({
  titulo,
  valor,
  detalhe,
}: {
  titulo: string;
  valor: React.ReactNode;
  detalhe: string;
}) {
  return (
    <div style={cardStyle}>
      <div
        style={{
          color: "#7dd3fc",
          fontSize: 11,
          fontWeight: 900,
          letterSpacing: 1.2,
          textTransform: "uppercase",
        }}
      >
        {titulo}
      </div>

      <div
        style={{
          color: "#ffffff",
          fontSize: 32,
          fontWeight: 900,
          marginTop: 7,
        }}
      >
        {valor}
      </div>

      <div
        style={{
          color: "#8fa9c4",
          fontSize: 12,
          marginTop: 4,
        }}
      >
        {detalhe}
      </div>
    </div>
  );
}

export default function RelatoriosApp() {
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [usuariosRecentes, setUsuariosRecentes] = useState<UsuarioMetrica[]>([]);
  const [sessoesRecentes, setSessoesRecentes] = useState<SessaoMetrica[]>([]);
  const [dias, setDias] = useState<ResumoDia[]>([]);
  const [totais, setTotais] = useState({
    totalUsuarios: 0,
    usuariosHoje: 0,
    aberturasHoje: 0,
    novosHoje: 0,
    ativos7Dias: 0,
    ativos30Dias: 0,
    tempoHojeSegundos: 0,
  });

  const hoje = dataLocalHoje();

  const carregarResumo = useCallback(async () => {
    setCarregando(true);
    setErro("");

    try {
      const inicio30Dias = dataDiasAtras(30);
      const inicio7Dias = dataDiasAtras(7);
      const dataInicio30 = dataLocalHojeFromDate(inicio30Dias);

      const usuariosRef = collection(db, "metricas_app_usuarios");
      const hojeRef = collection(db, "metricas_app_diarias", hoje, "acessos_usuarios");

      const [
        totalUsuariosSnap,
        ativos7Snap,
        ativos30Snap,
        novosHojeSnap,
        acessosHojeSnap,
        acessos30DiasSnap,
      ] = await Promise.all([
        getCountFromServer(usuariosRef),
        getCountFromServer(
          query(
            usuariosRef,
            where("ultimoAcessoEm", ">=", Timestamp.fromDate(inicio7Dias)),
          ),
        ),
        getCountFromServer(
          query(
            usuariosRef,
            where("ultimoAcessoEm", ">=", Timestamp.fromDate(inicio30Dias)),
          ),
        ),
        getCountFromServer(query(usuariosRef, where("primeiroAcessoData", "==", hoje))),
        getDocs(hojeRef),
        getDocs(
          query(
            collectionGroup(db, "acessos_usuarios"),
            where("data", ">=", dataInicio30),
            orderBy("data", "desc"),
          ),
        ),
      ]);

      const acessosHoje = acessosHojeSnap.docs.map((documento) => ({
        id: documento.id,
        ...documento.data(),
      })) as AcessoDia[];

      const aberturasHoje = acessosHoje.reduce(
        (total, item) => total + Number(item.aberturas || 0),
        0,
      );

      const tempoHojeSegundos = acessosHoje.reduce(
        (total, item) => total + Number(item.tempoUsoSegundos || 0),
        0,
      );

      const agrupados = new Map<string, ResumoDia>();

      acessos30DiasSnap.docs.forEach((documento) => {
        const dados = documento.data() as AcessoDia;
        const data = String(dados.data || "");

        if (!data) return;

        const atual = agrupados.get(data) || {
          data,
          usuarios: 0,
          aberturas: 0,
          tempoUsoSegundos: 0,
        };

        atual.usuarios += 1;
        atual.aberturas += Number(dados.aberturas || 0);
        atual.tempoUsoSegundos += Number(dados.tempoUsoSegundos || 0);

        agrupados.set(data, atual);
      });

      const listaDias = Array.from(agrupados.values()).sort((a, b) =>
        b.data.localeCompare(a.data),
      );

      setDias(listaDias);

      setTotais({
        totalUsuarios: totalUsuariosSnap.data().count,
        usuariosHoje: acessosHoje.length,
        aberturasHoje,
        novosHoje: novosHojeSnap.data().count,
        ativos7Dias: ativos7Snap.data().count,
        ativos30Dias: ativos30Snap.data().count,
        tempoHojeSegundos,
      });
    } catch (error: any) {
      console.error(error);
      setErro(error?.message || "Não foi possível carregar os relatórios do aplicativo.");
    } finally {
      setCarregando(false);
    }
  }, [hoje]);

  useEffect(() => {
    carregarResumo();
  }, [carregarResumo]);

  useEffect(() => {
    const usuariosQuery = query(
      collection(db, "metricas_app_usuarios"),
      orderBy("ultimoAcessoEm", "desc"),
      limit(100),
    );

    const unsubscribe = onSnapshot(
      usuariosQuery,
      (snapshot) => {
        setUsuariosRecentes(
          snapshot.docs.map((documento) => ({
            id: documento.id,
            ...documento.data(),
          })) as UsuarioMetrica[],
        );
      },
      (error) => console.error(error),
    );

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const sessoesQuery = query(
      collection(db, "metricas_app_sessoes"),
      orderBy("iniciadoEm", "desc"),
      limit(50),
    );

    const unsubscribe = onSnapshot(
      sessoesQuery,
      (snapshot) => {
        setSessoesRecentes(
          snapshot.docs.map((documento) => ({
            id: documento.id,
            ...documento.data(),
          })) as SessaoMetrica[],
        );
      },
      (error) => console.error(error),
    );

    return () => unsubscribe();
  }, []);

  const distribuicaoVersoes = useMemo(() => {
    const mapa = new Map<string, number>();

    usuariosRecentes.forEach((usuario) => {
      const versao = `${usuario.appVersion || "desconhecida"} (${usuario.buildVersion || "—"})`;
      mapa.set(versao, (mapa.get(versao) || 0) + 1);
    });

    return Array.from(mapa.entries())
      .map(([versao, quantidade]) => ({ versao, quantidade }))
      .sort((a, b) => b.quantidade - a.quantidade);
  }, [usuariosRecentes]);

  const maiorUsuariosDia = Math.max(1, ...dias.map((dia) => dia.usuarios));

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#070b22",
        color: "#ffffff",
        padding: 22,
        fontFamily:
          "Inter, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
      }}
    >
      <div
        style={{
          ...cardStyle,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 20,
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div
            style={{
              color: "#38bdf8",
              fontSize: 11,
              fontWeight: 900,
              letterSpacing: 1.6,
              textTransform: "uppercase",
            }}
          >
            Cadê Meu Barco
          </div>

          <h1 style={{ margin: "6px 0", fontSize: 30 }}>Relatórios do aplicativo</h1>

          <div style={{ color: "#8fa9c4", fontSize: 14 }}>
            Usuários únicos, acessos por dia, sessões, versões e tempo de utilização.
          </div>
        </div>

        <button
          onClick={carregarResumo}
          disabled={carregando}
          style={{
            background: "#0ea5e9",
            color: "#ffffff",
            border: "none",
            borderRadius: 12,
            padding: "12px 18px",
            fontWeight: 800,
            cursor: carregando ? "default" : "pointer",
            opacity: carregando ? 0.65 : 1,
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
          gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
          gap: 12,
        }}
      >
        <Card
          titulo="Usuários hoje"
          valor={totais.usuariosHoje}
          detalhe="Pessoas únicas que abriram hoje"
        />
        <Card
          titulo="Aberturas hoje"
          valor={totais.aberturasHoje}
          detalhe="Quantidade total de entradas no app"
        />
        <Card
          titulo="Novos hoje"
          valor={totais.novosHoje}
          detalhe="Primeiro acesso registrado hoje"
        />
        <Card
          titulo="Ativos em 7 dias"
          valor={totais.ativos7Dias}
          detalhe="Usuários únicos no período"
        />
        <Card
          titulo="Ativos em 30 dias"
          valor={totais.ativos30Dias}
          detalhe="Usuários únicos no período"
        />
        <Card
          titulo="Total de usuários"
          valor={totais.totalUsuarios}
          detalhe="Contas que já abriram esta versão"
        />
        <Card
          titulo="Tempo de uso hoje"
          valor={formatarDuracao(totais.tempoHojeSegundos)}
          detalhe="Tempo acumulado de todas as sessões"
        />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 2fr) minmax(260px, 1fr)",
          gap: 14,
          marginTop: 14,
        }}
      >
        <section style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Acessos dos últimos 30 dias</h2>

          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                minWidth: 610,
              }}
            >
              <thead>
                <tr style={{ color: "#7dd3fc", fontSize: 12 }}>
                  <th style={thStyle}>Dia</th>
                  <th style={thStyle}>Usuários</th>
                  <th style={thStyle}>Aberturas</th>
                  <th style={thStyle}>Tempo de uso</th>
                  <th style={thStyle}>Movimento</th>
                </tr>
              </thead>

              <tbody>
                {dias.map((dia) => (
                  <tr key={dia.data}>
                    <td style={tdStyle}>{formatarDataCurta(dia.data)}</td>
                    <td style={tdStyle}>{dia.usuarios}</td>
                    <td style={tdStyle}>{dia.aberturas}</td>
                    <td style={tdStyle}>{formatarDuracao(dia.tempoUsoSegundos)}</td>
                    <td style={{ ...tdStyle, minWidth: 150 }}>
                      <div
                        style={{
                          height: 8,
                          background: "rgba(148, 163, 184, 0.15)",
                          borderRadius: 20,
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            width: `${Math.max(
                              4,
                              (dia.usuarios / maiorUsuariosDia) * 100,
                            )}%`,
                            background: "#38bdf8",
                            borderRadius: 20,
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}

                {!carregando && dias.length === 0 ? (
                  <tr>
                    <td style={tdStyle} colSpan={5}>
                      Nenhum acesso registrado ainda.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Versões em uso</h2>

          {distribuicaoVersoes.map((item) => (
            <div
              key={item.versao}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                padding: "11px 0",
                borderBottom: "1px solid rgba(148, 163, 184, 0.12)",
              }}
            >
              <span style={{ color: "#cbd5e1" }}>{item.versao}</span>
              <strong style={{ color: "#38bdf8" }}>{item.quantidade}</strong>
            </div>
          ))}

          {distribuicaoVersoes.length === 0 ? (
            <div style={{ color: "#8fa9c4" }}>Nenhuma versão registrada.</div>
          ) : null}
        </section>
      </div>

      <section style={{ ...cardStyle, marginTop: 14 }}>
        <h2 style={{ marginTop: 0 }}>Últimos usuários ativos</h2>

        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              minWidth: 850,
            }}
          >
            <thead>
              <tr style={{ color: "#7dd3fc", fontSize: 12 }}>
                <th style={thStyle}>Último acesso</th>
                <th style={thStyle}>Usuário</th>
                <th style={thStyle}>Versão</th>
                <th style={thStyle}>Dispositivo</th>
                <th style={thStyle}>Aberturas</th>
                <th style={thStyle}>Dias ativos</th>
                <th style={thStyle}>Tempo total</th>
              </tr>
            </thead>

            <tbody>
              {usuariosRecentes.map((usuario) => (
                <tr key={usuario.id}>
                  <td style={tdStyle}>{formatarData(usuario.ultimoAcessoEm)}</td>
                  <td style={tdStyle}>{usuario.id.slice(0, 12)}…</td>
                  <td style={tdStyle}>
                    {usuario.appVersion || "—"} ({usuario.buildVersion || "—"})
                  </td>
                  <td style={tdStyle}>{usuario.modeloDispositivo || "—"}</td>
                  <td style={tdStyle}>{Number(usuario.totalAberturas || 0)}</td>
                  <td style={tdStyle}>{Number(usuario.diasAtivos || 0)}</td>
                  <td style={tdStyle}>
                    {formatarDuracao(Number(usuario.totalTempoUsoSegundos || 0))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section style={{ ...cardStyle, marginTop: 14 }}>
        <h2 style={{ marginTop: 0 }}>Sessões mais recentes</h2>

        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              minWidth: 760,
            }}
          >
            <thead>
              <tr style={{ color: "#7dd3fc", fontSize: 12 }}>
                <th style={thStyle}>Início</th>
                <th style={thStyle}>Usuário</th>
                <th style={thStyle}>Duração</th>
                <th style={thStyle}>Versão</th>
                <th style={thStyle}>Plataforma</th>
                <th style={thStyle}>Ambiente</th>
              </tr>
            </thead>

            <tbody>
              {sessoesRecentes.map((sessao) => (
                <tr key={sessao.id}>
                  <td style={tdStyle}>{formatarData(sessao.iniciadoEm)}</td>
                  <td style={tdStyle}>{String(sessao.uid || "").slice(0, 12)}…</td>
                  <td style={tdStyle}>
                    {formatarDuracao(Number(sessao.duracaoSegundos || 0))}
                  </td>
                  <td style={tdStyle}>{sessao.appVersion || "—"}</td>
                  <td style={tdStyle}>{sessao.plataforma || "—"}</td>
                  <td style={tdStyle}>{sessao.ambiente || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function dataLocalHojeFromDate(data: Date) {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "11px 10px",
  borderBottom: "1px solid rgba(148, 163, 184, 0.15)",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "12px 10px",
  borderBottom: "1px solid rgba(148, 163, 184, 0.1)",
  color: "#cbd5e1",
  fontSize: 13,
  whiteSpace: "nowrap",
};
