import React, {useMemo, useState} from "react";
import {useSearchParams} from "react-router-dom";
import RotasCadastroPublico, {
  type RotaCadastro,
} from "../components/RotasCadastroPublico";

const URL_CONSULTAR =
  "https://us-central1-sistema-navegacao.cloudfunctions.net/consultarEdicaoPublicaEmbarcacao";
const URL_SOLICITAR =
  "https://us-central1-sistema-navegacao.cloudfunctions.net/solicitarAlteracaoPublicaEmbarcacao";

type Contato = {
  nome: string;
  numero: string;
  mensagem: string;
  ativo: boolean;
};

type DadosEdicao = {
  id: string;
  nome: string;
  tipoBarco: string;
  planoId: "basico" | "vitrine" | "tempo_real";
  descricao: string;
  fotos: string[];
  contatosWhatsApp: Contato[];
  instagramBarco: string;
  facebookBarco: string;
  siteBarco: string;
  rotas: RotaCadastro[];
  observacoesInstalacaoGps: string;
};

export default function AlteracaoPublicaEmbarcacao() {
  const [parametros] = useSearchParams();
  const token = parametros.get("token") || "";
  const [telefone, setTelefone] = useState("");
  const [dados, setDados] = useState<DadosEdicao | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState("");
  const limiteContatos = dados?.planoId === "tempo_real" ? 3 :
    dados?.planoId === "vitrine" ? 1 : 0;
  const tituloPlano = useMemo(() => {
    if (dados?.planoId === "tempo_real") return "PLANO TEMPO REAL";
    if (dados?.planoId === "vitrine") return "PLANO VITRINE";
    return "PLANO BÁSICO";
  }, [dados?.planoId]);

  async function consultar() {
    setOcupado(true);
    setMensagem("");
    try {
      const resposta = await fetch(URL_CONSULTAR, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({token, telefone}),
      });
      const resultado = await resposta.json();
      if (!resposta.ok) throw new Error(resultado.erro || "Não foi possível confirmar.");
      const embarcacao = resultado.embarcacao as DadosEdicao;
      embarcacao.contatosWhatsApp = Array.from(
        {length: embarcacao.planoId === "tempo_real" ? 3 :
          embarcacao.planoId === "vitrine" ? 1 : 0},
        (_, indice) => embarcacao.contatosWhatsApp?.[indice] || {
          nome: "", numero: "", mensagem: "", ativo: true,
        },
      );
      setDados(embarcacao);
    } catch (erro) {
      setMensagem(erro instanceof Error ? erro.message : "Não foi possível confirmar.");
    } finally {
      setOcupado(false);
    }
  }

  async function enviar() {
    if (!dados) return;
    setOcupado(true);
    setMensagem("");
    try {
      const resposta = await fetch(URL_SOLICITAR, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({token, telefone, dados}),
      });
      const resultado = await resposta.json();
      if (!resposta.ok) throw new Error(resultado.erro || "Não foi possível enviar.");
      setMensagem(
        `Solicitação ${resultado.solicitacaoId} enviada. A equipe analisará antes de publicar.`,
      );
    } catch (erro) {
      setMensagem(erro instanceof Error ? erro.message : "Não foi possível enviar.");
    } finally {
      setOcupado(false);
    }
  }

  function campoContato(indice: number, campo: keyof Contato, valor: any) {
    setDados((atual) => {
      if (!atual) return atual;
      const contatos = [...atual.contatosWhatsApp];
      contatos[indice] = {...contatos[indice], [campo]: valor};
      return {...atual, contatosWhatsApp: contatos};
    });
  }

  return (
    <main className="min-h-screen bg-[#050b1e] px-4 py-8 text-white">
      <div className="mx-auto max-w-3xl">
        <header className="rounded-[2rem] border border-sky-300/20 bg-gradient-to-br from-[#14295a] to-[#101334] p-5 shadow-2xl">
          <div className="flex items-center gap-4">
            <img src="/logo-cade-meu-barco.png" alt="Cadê Meu Barco"
              className="h-20 w-20 rounded-2xl object-cover" />
            <div>
              <p className="text-xs font-black tracking-[0.2em] text-yellow-300">
                ATUALIZAÇÃO SEGURA
              </p>
              <h1 className="mt-1 text-2xl font-black">
                A navegação da Amazônia mais conectada.
              </h1>
              <p className="mt-1 text-sm text-sky-100/70">
                Revise os dados. Nada será publicado sem a análise da nossa equipe.
              </p>
            </div>
          </div>
        </header>

        {!dados ? (
          <section className="mt-5 rounded-3xl border border-white/10 bg-[#101a36] p-5">
            <h2 className="text-lg font-black">Confirme seu WhatsApp</h2>
            <p className="mt-1 text-sm text-sky-100/60">
              Use o mesmo número cadastrado para abrir os dados da embarcação.
            </p>
            <input value={telefone} onChange={(e) => setTelefone(e.target.value)}
              placeholder="+55 (92) 99999-9999"
              className="mt-4 w-full rounded-2xl border border-white/10 bg-[#091329] px-4 py-4 font-bold outline-none focus:border-sky-400" />
            <button disabled={ocupado || !token} onClick={consultar}
              className="mt-4 w-full rounded-2xl bg-sky-500 px-5 py-4 font-black disabled:opacity-50">
              {ocupado ? "CONFIRMANDO..." : "ABRIR MEUS DADOS"}
            </button>
          </section>
        ) : (
          <section className="mt-5 grid gap-4">
            <div className="rounded-3xl border border-emerald-400/20 bg-[#101a36] p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xl font-black">{dados.nome}</h2>
                <span className="rounded-full border border-emerald-400/40 px-3 py-1 text-xs font-black text-emerald-300">
                  {tituloPlano}
                </span>
              </div>
              <p className="mt-2 text-xs text-sky-100/50">ID operacional: {dados.id}</p>
            </div>
            <Bloco titulo="Dados públicos">
              <Campo label="Nome da embarcação" value={dados.nome}
                onChange={(nome) => setDados({...dados, nome: nome.toUpperCase()})} />
              <Campo label="Tipo" value={dados.tipoBarco}
                onChange={(tipoBarco) => setDados({...dados, tipoBarco: tipoBarco.toUpperCase()})} />
              <Area label="Descrição" value={dados.descricao}
                onChange={(descricao) => setDados({...dados, descricao})} />
              <Area label="Fotos — uma URL por linha" value={dados.fotos.join("\n")}
                onChange={(valor) => setDados({
                  ...dados,
                  fotos: valor.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
                })} />
            </Bloco>
            <Bloco titulo="Rotas, escalas e horários">
              <RotasCadastroPublico value={dados.rotas || []}
                onChange={(rotas) => setDados({...dados, rotas})} />
            </Bloco>
            {limiteContatos > 0 && (
              <Bloco titulo={`Contatos do plano — até ${limiteContatos}`}>
                {dados.contatosWhatsApp.slice(0, limiteContatos).map((contato, indice) => (
                  <div key={indice} className="rounded-2xl border border-white/10 p-4">
                    <Campo label="Nome completo" value={contato.nome}
                      onChange={(valor) => campoContato(indice, "nome", valor.toUpperCase())} />
                    <Campo label="WhatsApp" value={contato.numero}
                      onChange={(valor) => campoContato(indice, "numero", valor)} />
                    <Area label="Mensagem pronta editável" value={contato.mensagem}
                      onChange={(valor) => campoContato(indice, "mensagem", valor)} />
                    <label className="flex gap-2 text-sm font-bold">
                      <input type="checkbox" checked={contato.ativo}
                        onChange={(e) => campoContato(indice, "ativo", e.target.checked)} />
                      Número ativo
                    </label>
                  </div>
                ))}
                <Campo label="Instagram" value={dados.instagramBarco}
                  onChange={(instagramBarco) => setDados({...dados, instagramBarco})} />
                <Campo label="Facebook" value={dados.facebookBarco}
                  onChange={(facebookBarco) => setDados({...dados, facebookBarco})} />
                <Campo label="Site" value={dados.siteBarco}
                  onChange={(siteBarco) => setDados({...dados, siteBarco})} />
              </Bloco>
            )}
            {dados.planoId === "tempo_real" && (
              <Bloco titulo="Instalação do GPS">
                <Area label="Observações para a equipe"
                  value={dados.observacoesInstalacaoGps}
                  onChange={(observacoesInstalacaoGps) =>
                    setDados({...dados, observacoesInstalacaoGps})} />
              </Bloco>
            )}
            <button disabled={ocupado} onClick={enviar}
              className="rounded-2xl bg-emerald-500 px-5 py-4 font-black disabled:opacity-50">
              {ocupado ? "ENVIANDO..." : "ENVIAR PARA ANÁLISE"}
            </button>
          </section>
        )}
        {mensagem && (
          <p className="mt-4 rounded-2xl border border-sky-400/20 bg-sky-400/10 p-4 text-sm font-bold">
            {mensagem}
          </p>
        )}
      </div>
    </main>
  );
}

function Bloco({titulo, children}: {titulo: string; children: React.ReactNode}) {
  return (
    <div className="grid gap-3 rounded-3xl border border-white/10 bg-[#101a36] p-5">
      <h3 className="text-sm font-black uppercase tracking-[0.14em] text-sky-300">
        {titulo}
      </h3>
      {children}
    </div>
  );
}

function Campo({label, value, onChange}: {
  label: string; value: string; onChange: (valor: string) => void;
}) {
  return (
    <label>
      <span className="mb-1.5 block text-xs font-black text-sky-100/60">{label}</span>
      <input value={value || ""} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-white/10 bg-[#091329] px-4 py-3 font-bold outline-none focus:border-sky-400" />
    </label>
  );
}

function Area({label, value, onChange}: {
  label: string; value: string; onChange: (valor: string) => void;
}) {
  return (
    <label>
      <span className="mb-1.5 block text-xs font-black text-sky-100/60">{label}</span>
      <textarea rows={4} value={value || ""} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-white/10 bg-[#091329] px-4 py-3 font-semibold outline-none focus:border-sky-400" />
    </label>
  );
}
