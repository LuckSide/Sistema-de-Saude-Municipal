import { useEffect, useRef, useState } from "react";
import { Building2, MapPin, RefreshCw, Search, User } from "lucide-react";
import { tfdPacientes, tfdPaciente, pagData, msgErro, type Paciente } from "../services/api";
import { Label } from "./ui/primitives";

type PacienteComUnidade = Paciente & {
  unidade_nome?: string;
  unidade_cnes?: string;
};

function formatarEnderecoResumido(p: Paciente): string {
  const logradouro = p.endereco
    ? p.endereco_numero
      ? `${p.endereco}, ${p.endereco_numero}`
      : p.endereco
    : "";
  return [logradouro, p.bairro, p.municipio].filter((x) => Boolean(x && x.trim())).join(" · ");
}

interface BuscaPacienteAutocompleteProps {
  pacienteId: string | number;
  onSelect: (paciente: Paciente | null) => void;
  label?: string;
  obrigatorio?: boolean;
  pacienteInicial?: Paciente | null;
  placeholder?: string;
  disabled?: boolean;
}

export default function BuscaPacienteAutocomplete({
  pacienteId,
  onSelect,
  label = "Paciente",
  obrigatorio = true,
  pacienteInicial = null,
  placeholder = "Buscar paciente por nome, CPF, CNS, prontuário ou nascimento (DD/MM/AAAA)…",
  disabled = false,
}: BuscaPacienteAutocompleteProps) {
  const [busca, setBusca] = useState("");
  const [sugestoes, setSugestoes] = useState<Paciente[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [erroBusca, setErroBusca] = useState("");
  const [aberto, setAberto] = useState(false);
  const [pacienteAtivo, setPacienteAtivo] = useState<Paciente | null>(pacienteInicial);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sincroniza se pacienteInicial mudar
  useEffect(() => {
    if (pacienteInicial) {
      setPacienteAtivo(pacienteInicial);
    } else if (!pacienteId) {
      setPacienteAtivo(null);
    }
  }, [pacienteInicial, pacienteId]);

  // Se temos pacienteId mas não temos pacienteAtivo carregado, busca diretamente pelo ID do paciente
  useEffect(() => {
    if (pacienteId && !pacienteAtivo) {
      tfdPaciente(Number(pacienteId))
        .then((p) => {
          if (p) setPacienteAtivo(p);
        })
        .catch(() => {});
    }
  }, [pacienteId, pacienteAtivo]);

  // Debounce na busca sob demanda de pacientes
  useEffect(() => {
    const q = busca.trim();
    if (!q) {
      setSugestoes([]);
      setErroBusca("");
      setBuscando(false);
      return;
    }

    let ativo = true;
    setBuscando(true);
    setErroBusca("");
    const t = setTimeout(() => {
      tfdPacientes(q, 1, 50)
        .then((r) => {
          if (!ativo) return;
          setSugestoes(pagData<Paciente>(r));
          setAberto(true);
        })
        .catch((err) => {
          if (!ativo) return;
          setSugestoes([]);
          setErroBusca(msgErro(err, "Erro ao buscar pacientes."));
          setAberto(true);
        })
        .finally(() => {
          if (ativo) setBuscando(false);
        });
    }, 250);

    return () => {
      ativo = false;
      clearTimeout(t);
    };
  }, [busca]);

  // Click outside fecha o dropdown
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setAberto(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleSelecionar(p: Paciente) {
    setPacienteAtivo(p);
    setBusca("");
    setSugestoes([]);
    setAberto(false);
    onSelect(p);
  }

  function handleRemover() {
    setPacienteAtivo(null);
    setBusca("");
    setSugestoes([]);
    setAberto(false);
    onSelect(null);
  }

  return (
    <div ref={containerRef} className="space-y-1.5">
      {label && (
        <Label>
          {label} {obrigatorio && <span className="text-red-500">*</span>}
        </Label>
      )}

      {pacienteAtivo ? (
        <div className="flex min-h-[44px] items-center justify-between rounded-xl border border-teal/40 bg-teal/5 px-3.5 py-2.5 shadow-xs">
          <div className="flex items-start gap-3 min-w-0">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal/20 text-teal">
              <User className="h-4 w-4" />
            </div>
            <div className="min-w-0 space-y-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-sus-950 text-sm truncate">{pacienteAtivo.nome}</span>
                {(pacienteAtivo.eh_teste || pacienteAtivo.nome?.trim().toLowerCase() === "testes") && (
                  <span className="rounded-md bg-amber-100 border border-amber-300 px-2 py-0.5 text-[10px] font-bold text-amber-800 uppercase tracking-wider shrink-0">
                    Ambiente de Teste
                  </span>
                )}
                {pacienteAtivo.nascimento && (
                  <span className="text-xs text-ink/60 shrink-0">
                    · Nasc. {pacienteAtivo.nascimento.slice(0, 10).split("-").reverse().join("/")}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink/70">
                {pacienteAtivo.cpf && (
                  <span>
                    CPF: <strong>{pacienteAtivo.cpf}</strong>
                  </span>
                )}
                {pacienteAtivo.cns && (
                  <span>
                    CNS: <strong>{pacienteAtivo.cns}</strong>
                  </span>
                )}
                {pacienteAtivo.telefone && (
                  <span>
                    Tel: <strong>{pacienteAtivo.telefone}</strong>
                  </span>
                )}
              </div>
              {(() => {
                const pacExt = pacienteAtivo as PacienteComUnidade;
                const endResumido = formatarEnderecoResumido(pacienteAtivo);
                if (!pacExt.unidade_nome && !endResumido) return null;
                return (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-ink/70 pt-0.5">
                    {pacExt.unidade_nome && (
                      <span className="inline-flex items-center gap-1 font-medium text-teal-900">
                        <Building2 className="h-3 w-3 shrink-0 text-teal" />
                        {pacExt.unidade_nome}
                      </span>
                    )}
                    {endResumido && (
                      <span className="inline-flex items-center gap-1 text-ink/65">
                        <MapPin className="h-3 w-3 shrink-0 text-ink/50" />
                        {endResumido}
                      </span>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
          {!disabled && (
            <button
              type="button"
              onClick={handleRemover}
              className="ml-3 shrink-0 rounded-lg border border-red-200 bg-white px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 transition"
              title="Trocar paciente"
            >
              Trocar
            </button>
          )}
        </div>
      ) : (
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/40 pointer-events-none" />
          <input
            type="text"
            disabled={disabled}
            placeholder={placeholder}
            value={busca}
            onChange={(e) => {
              setBusca(e.target.value);
              setAberto(true);
            }}
            onFocus={() => {
              if (sugestoes.length > 0) setAberto(true);
            }}
            className="w-full h-11 rounded-xl border border-sus-900/15 bg-white pl-10 pr-10 py-2.5 text-sm text-ink outline-none transition placeholder:text-ink/60 focus:border-sus-700 focus-visible:ring-2 focus-visible:ring-sus-700/20"
            autoComplete="off"
          />
          {buscando && (
            <RefreshCw className="absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-teal" />
          )}

          {aberto && sugestoes.length > 0 && (
            <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded-xl border border-sus-900/15 bg-white shadow-xl divide-y divide-sus-900/5">
              {sugestoes.map((p) => {
                const pacExt = p as PacienteComUnidade;
                const prontLimpo = p.codigo_prontuario?.replace(/^PR-0*/, "") || String(p.id);
                const endResumido = formatarEnderecoResumido(p);
                return (
                  <div
                    key={p.id}
                    onClick={() => handleSelecionar(p)}
                    className="flex items-center justify-between gap-2 p-3 text-left hover:bg-sand/60 cursor-pointer transition"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-sm text-sus-950">{p.nome}</span>
                        {(p.eh_teste || p.nome?.trim().toLowerCase() === "testes") && (
                          <span className="rounded-md bg-amber-100 border border-amber-300 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 uppercase tracking-wider shrink-0">
                            Ambiente de Teste
                          </span>
                        )}
                        <span className="font-mono text-[11px] font-bold text-teal bg-teal/10 px-1.5 py-0.5 rounded">
                          Pront. {prontLimpo}
                        </span>
                      </div>
                      <span className="block text-xs text-ink/50 font-mono mt-0.5">
                        {p.cpf ? `CPF: ${p.cpf}` : "Sem CPF"} · {p.cns ? `CNS: ${p.cns}` : "Sem CNS"}
                        {p.nascimento ? ` · Nasc: ${p.nascimento.slice(0, 10).split("-").reverse().join("/")}` : ""}
                      </span>
                      {(pacExt.unidade_nome || endResumido) && (
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-ink/65">
                          {pacExt.unidade_nome && (
                            <span className="inline-flex items-center gap-1 font-medium text-teal-900">
                              <Building2 className="h-3 w-3 shrink-0 text-teal" />
                              {pacExt.unidade_nome}
                            </span>
                          )}
                          {endResumido && (
                            <span className="inline-flex items-center gap-1 truncate">
                              <MapPin className="h-3 w-3 shrink-0 text-ink/45" />
                              {endResumido}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <span className="text-xs font-semibold text-teal bg-teal/10 px-2 py-0.5 rounded-md shrink-0">
                      Selecionar
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {aberto && busca.trim() && !buscando && erroBusca && (
            <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-xl border border-red-200 bg-red-50 p-3 text-center text-xs font-medium text-red-700 shadow-xl">
              {erroBusca}
            </div>
          )}

          {aberto && busca.trim() && !buscando && !erroBusca && sugestoes.length === 0 && (
            <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-xl border border-sus-900/15 bg-white p-4 text-center text-xs text-ink/50 shadow-xl">
              Nenhum paciente encontrado para "{busca}". Digite o nome, CPF, CNS, prontuário ou nascimento (DD/MM/AAAA).
            </div>
          )}
        </div>
      )}
    </div>
  );
}
