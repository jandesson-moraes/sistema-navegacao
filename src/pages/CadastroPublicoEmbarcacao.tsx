import React, { useState } from "react";
import RotasCadastroPublico, {type RotaCadastro} from "../components/RotasCadastroPublico";
import {TIPOS_EMBARCACAO} from "../domain/tiposEmbarcacao";

const URL_CADASTRO =
  "https://us-central1-sistema-navegacao.cloudfunctions.net/solicitarCadastroPublicoEmbarcacao";
const WHATSAPP_EQUIPE = "5592991903278";

type RetornoCadastro = {
  sucesso?: boolean;
  codigoProvisorio?: string;
  erro?: string;
};

async function fotoParaBase64(arquivo: File) {
  if (arquivo.size > 4 * 1024 * 1024) throw new Error("A foto deve ter no máximo 4 MB.");
  return await new Promise<string>((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(String(leitor.result ?? ""));
    leitor.onerror = () => reject(new Error("Não foi possível ler a foto."));
    leitor.readAsDataURL(arquivo);
  });
}

export default function CadastroPublicoEmbarcacao() {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [codigo, setCodigo] = useState("");
  const [telefone, setTelefone] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [rotas, setRotas] = useState<RotaCadastro[]>([]);
  const [vinculo, setVinculo] = useState("dono");

  function formatarCnpj(valor: string) {
    const numeros = valor.replace(/\D/g, "").slice(0, 14);
    return numeros
      .replace(/^(\d{2})(\d)/, "$1.$2")
      .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/\.(\d{3})(\d)/, ".$1/$2")
      .replace(/(\d{4})(\d)/, "$1-$2");
  }

  function formatarWhatsApp(valor: string) {
    let numeros = valor.replace(/\D/g, "");
    if (numeros.startsWith("55")) numeros = numeros.slice(2);
    numeros = numeros.slice(0, 11);
    if (numeros.length <= 2) return numeros ? `+55 (${numeros}` : "";
    if (numeros.length <= 7) return `+55 (${numeros.slice(0, 2)}) ${numeros.slice(2)}`;
    if (numeros.length <= 10) {
      return `+55 (${numeros.slice(0, 2)}) ${numeros.slice(2, 6)}-${numeros.slice(6)}`;
    }
    return `+55 (${numeros.slice(0, 2)}) ${numeros.slice(2, 7)}-${numeros.slice(7)}`;
  }

  function nomeCompletoValido(valor: string) {
    return valor.trim().split(/\s+/).filter((parte) => parte.length >= 2).length >= 2;
  }

  async function enviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setErro("");
    setEnviando(true);
    try {
      const formulario = new FormData(evento.currentTarget);
      const foto = formulario.get("foto");
      const corpo: Record<string, unknown> = Object.fromEntries(formulario.entries());
      delete corpo.foto;
      corpo.autorizaMelhoria = formulario.get("autorizaMelhoria") === "on";
      corpo.cnpj = cnpj.replace(/\D/g, "");
      corpo.telefone = telefone.replace(/\D/g, "");
      corpo.vinculo = vinculo;
      corpo.rotas = rotas;
      if (!nomeCompletoValido(String(corpo.nomeSolicitante ?? ""))) {
        throw new Error("Informe seu nome completo, com nome e sobrenome.");
      }
      if (foto instanceof File && foto.size > 0) corpo.fotoBase64 = await fotoParaBase64(foto);

      const resposta = await fetch(URL_CADASTRO, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(corpo),
      });
      const retorno = (await resposta.json()) as RetornoCadastro;
      if (!resposta.ok || !retorno.codigoProvisorio) {
        throw new Error(retorno.erro || "Não foi possível enviar o cadastro.");
      }
      setCodigo(retorno.codigoProvisorio);
      setTelefone(String(corpo.telefone ?? ""));
      window.scrollTo({top: 0, behavior: "smooth"});
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : "Não foi possível enviar.");
    } finally {
      setEnviando(false);
    }
  }

  if (codigo) {
    const mensagem = encodeURIComponent(
      `Olá! Finalizei o cadastro da embarcação no Cadê o Meu Barco. Meu código é ${codigo} e meu telefone é ${telefone}.`,
    );
    return (
      <main className="min-h-screen bg-[#020817] px-4 py-10 text-white">
        <section className="mx-auto max-w-xl rounded-[32px] border border-emerald-400/25 bg-[#071a2f] p-6 shadow-2xl sm:p-9">
          <div className="text-5xl">✅</div>
          <p className="mt-5 text-xs font-black uppercase tracking-[0.22em] text-emerald-300">
            Cadastro recebido
          </p>
          <h1 className="mt-2 text-3xl font-black">Agora confirme pelo WhatsApp</h1>
          <p className="mt-4 text-base leading-7 text-slate-300">
            A embarcação ainda não está publicada. Nossa equipe conferirá os dados antes
            da aprovação.
          </p>
          <div className="mt-6 rounded-3xl bg-white/8 p-5 text-center">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
              Código provisório
            </p>
            <strong className="mt-2 block text-3xl tracking-wider text-amber-300">{codigo}</strong>
          </div>
          <a
            href={`https://wa.me/${WHATSAPP_EQUIPE}?text=${mensagem}`}
            target="_blank"
            rel="noreferrer"
            className="mt-6 flex min-h-14 items-center justify-center rounded-2xl bg-emerald-500 px-5 text-center text-base font-black text-white"
          >
            Confirmar cadastro no WhatsApp
          </a>
          <p className="mt-4 text-center text-xs text-slate-400">
            Guarde este código para acompanhar ou corrigir o cadastro.
          </p>
        </section>
      </main>
    );
  }

  const campo =
    "mt-2 min-h-12 w-full rounded-2xl border border-white/10 bg-white/[0.06] px-4 text-base text-white outline-none placeholder:text-slate-500 focus:border-sky-400";
  return (
    <main className="min-h-screen bg-[#020817] px-4 py-7 text-white sm:py-12">
      <section className="mx-auto max-w-3xl">
        <header className="mb-5 overflow-hidden rounded-[28px] border border-sky-400/15 bg-gradient-to-br from-[#08294b] to-[#041225] p-4 shadow-2xl sm:p-6">
          <div className="flex items-center gap-4">
            <img src="/icone-oficial-cade-meu-barco.png" alt="Cadê Meu Barco"
              className="h-20 w-20 shrink-0 rounded-2xl object-cover shadow-xl sm:h-24 sm:w-24" />
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-300">Cadastro gratuito</p>
              <h1 className="mt-1 text-2xl font-black leading-tight sm:text-4xl">A navegação da Amazônia mais conectada.</h1>
              <p className="mt-2 text-sm leading-5 text-slate-300 sm:text-base">
                Informações, presença digital e acompanhamento em tempo real para aproximar embarcações e passageiros.
              </p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center text-[10px] font-black uppercase tracking-wide text-sky-100">
            <span className="rounded-xl bg-white/[0.07] px-2 py-2">1. Dados</span>
            <span className="rounded-xl bg-white/[0.07] px-2 py-2">2. Revisão</span>
            <span className="rounded-xl bg-white/[0.07] px-2 py-2">3. Publicação</span>
          </div>
        </header>

        <form onSubmit={enviar} className="space-y-5 rounded-[28px] border border-white/10 bg-[#071a2f] p-4 shadow-2xl sm:p-6">
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="font-bold">Nome da embarcação *
              <input name="nomeEmbarcacao" required minLength={2} className={campo} />
            </label>
            <label className="font-bold">Tipo
              <select name="tipoEmbarcacao" className={campo} defaultValue="">
                <option value="" className="text-black">Selecione</option>
                {TIPOS_EMBARCACAO.map((tipo) => <option key={tipo} value={tipo} className="text-black">{tipo}</option>)}
              </select>
            </label>
            <label className="font-bold">CNPJ <span className="font-normal text-slate-400">(opcional)</span>
              <input name="cnpj" inputMode="numeric" value={cnpj}
                onChange={(e) => setCnpj(formatarCnpj(e.target.value))}
                className={campo} placeholder="00.000.000/0000-00" />
              <span className="mt-1.5 block text-xs font-normal leading-5 text-emerald-300">
                Se informado, poderá agilizar a análise e a aprovação.
              </span>
            </label>
            <div className="rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.06] p-4">
              <input type="hidden" name="planoInteresse" value="basico" />
              <p className="text-xs font-black uppercase tracking-wide text-emerald-300">Plano inicial</p>
              <p className="mt-1 font-black">Básico gratuito</p>
              <p className="mt-1 text-xs leading-5 text-slate-300">
                Depois da aprovação, você poderá completar os dados e escolher um plano pago.
              </p>
            </div>
          </div>

          <label className="block font-bold">Descrição da embarcação
            <textarea
              name="descricao"
              rows={3}
              className={`${campo} py-3`}
              placeholder="Conte como é a embarcação e quais informações são úteis ao passageiro."
            />
          </label>
          <div className="border-t border-white/10 pt-5">
            <h2 className="text-lg font-black">Como a embarcação viaja?</h2>
            <p className="mt-1 text-xs leading-5 text-slate-400">
              Informe o percurso, os dias de saída e os dias previstos de passagem nas escalas.
            </p>
            <div className="mt-3">
              <RotasCadastroPublico value={rotas} onChange={setRotas} />
            </div>
          </div>

          <div className="border-t border-white/10 pt-6">
            <h2 className="text-xl font-black">Quem está cadastrando?</h2>
            <div className="mt-4 grid gap-5 sm:grid-cols-2">
              <label className="font-bold">Nome completo *
                <input name="nomeSolicitante" required minLength={5} autoComplete="name"
                  className={campo} placeholder="Ex.: João da Silva"
                  onBlur={(e) => e.currentTarget.setCustomValidity(
                    nomeCompletoValido(e.currentTarget.value) ? "" : "Informe seu nome e sobrenome."
                  )}
                  onInput={(e) => e.currentTarget.setCustomValidity("")} />
              </label>
              <label className="font-bold">WhatsApp *
                <input name="telefone" required inputMode="tel" autoComplete="tel"
                  value={telefone} onChange={(e) => setTelefone(formatarWhatsApp(e.target.value))}
                  className={campo} placeholder="+55 (92) 99999-9999" />
                <span className="mt-1.5 block text-xs font-normal text-slate-400">
                  Inclua o DDD. Usaremos este número para confirmar o cadastro.
                </span>
              </label>
              <label className="font-bold">Tipo da imagem
                <select name="tipoImagem" className={campo} defaultValue="foto_embarcacao">
                  <option value="foto_embarcacao" className="text-black">Foto da embarcação</option>
                  <option value="logo_oficial" className="text-black">Logomarca oficial</option>
                </select>
              </label>
              <label className="font-bold">Imagem principal
                <input name="foto" type="file" accept="image/jpeg,image/png,image/webp" className={`${campo} py-3`} />
              </label>
            </div>
            <div className="mt-4 rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] p-4">
              <p className="text-sm font-black text-amber-200">Atenção à imagem enviada</p>
              <p className="mt-1 text-xs leading-5 text-slate-300">
                Envie preferencialmente uma foto nítida da embarcação ou sua logomarca oficial.
                Selfie, foto de perfil pessoal, print, imagem de outra embarcação ou conteúdo sem relação
                com o cadastro não será aprovado.
              </p>
            </div>
            <fieldset className="mt-5">
              <legend className="font-bold">Qual é sua relação com a embarcação?</legend>
              <p className="mt-1 text-xs text-slate-400">Escolha a opção que melhor representa você.</p>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  ["dono", "⚓", "Proprietário"],
                  ["tripulante", "🧭", "Tripulante"],
                  ["representante", "🤝", "Representante"],
                  ["passageiro", "👤", "Colaborador"],
                ].map(([valor, icone, rotulo]) => (
                  <button key={valor} type="button" onClick={() => setVinculo(valor)}
                    className={`min-h-24 rounded-2xl border p-3 text-left transition ${
                      vinculo === valor
                        ? "border-sky-400 bg-sky-400/15 shadow-lg shadow-sky-950"
                        : "border-white/10 bg-white/[0.04]"
                    }`}>
                    <span className="block text-2xl">{icone}</span>
                    <span className="mt-2 block text-xs font-black text-white">{rotulo}</span>
                    <span className={`mt-1 block text-[10px] font-bold ${
                      vinculo === valor ? "text-sky-300" : "text-slate-500"
                    }`}>{vinculo === valor ? "Selecionado" : "Selecionar"}</span>
                  </button>
                ))}
              </div>
            </fieldset>
          </div>

          <label className="flex items-start gap-3 rounded-2xl bg-sky-400/8 p-4 text-sm leading-6 text-slate-200">
            <input name="autorizaMelhoria" type="checkbox" className="mt-1 h-5 w-5" />
            Autorizo a equipe a melhorar a foto e o texto, sem inventar informações e sem
            alterar a identidade da embarcação.
          </label>
          <label className="block font-bold">Observações
            <textarea name="observacoes" rows={4} className={`${campo} py-3`} />
          </label>
          {erro && <p className="rounded-2xl bg-red-500/15 p-4 font-bold text-red-200">{erro}</p>}
          <button disabled={enviando} className="min-h-14 w-full rounded-2xl bg-sky-500 px-5 text-lg font-black disabled:opacity-60">
            {enviando ? "Enviando..." : "Enviar para análise"}
          </button>
          <p className="text-center text-xs leading-5 text-slate-400">
            O envio não publica automaticamente. A equipe valida telefone, duplicidade,
            imagem e informações antes de liberar no aplicativo.
          </p>
        </form>
      </section>
    </main>
  );
}
