import { useEffect, useRef, useState } from "react";
import { Check, RefreshCw, Search, User, X } from "lucide-react";
import { tfdPacientes, pagData, type Paciente } from "../services/api";
import { Label } from "./ui/primitives";

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
  placeholder = "Buscar paciente por nome, CPF ou CNS…",
  disabled = false,
}: BuscaPacienteAutocompleteProps) {
  const [busca, setBusca] = useState("");
  const [sugestoes, setSugestoes] = useState<Paciente[]>([]);
  const [buscando, setBuscando] = useState(false);
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

  // Se temos pacienteId mas não temos pacienteAtivo carregado, tenta buscar
  useEffect(() => {
    if (pacienteId && !pacienteAtivo) {
      tfdPacientes(undefined, 1, 100)
        .then((r) => {
          const lista = pagData<Paciente>(r);
          const achou = lista.find((p) => String(p.id) === String(pacienteId));
          if (achou) setPacienteAtivo(achou);
        })
        .catch(() => {});
    }
  }, [pacienteId, pacienteAtivo]);

  // Debounce na busca de pacientes
  useEffect(() => {
    const q = busca.trim();
    if (!q || q.length < 2) {
      setSugestoes([]);
      setBuscando(false);
      return;
    }

    setBuscando(true);
    const t = setTimeout(() => {
      tfdPacientes(q, 1, 50)
        .then((r) => {
          setSugestoes(pagData<Paciente>(r));
          setAberto(true);
        })
        .catch(() => setSugestoes([]))
        .finally(() => setBuscando(false));
    }, 250);

    return () => clearTimeout(t);
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
        <div className="flex min-h-[44px] items-center justify-between rounded-xl border border-teal/40 bg-teal/5 px-3.5 py-2 shadow-xs">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal/20 text-teal">
              <User className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-bold text-sus-950 text-sm truncate">{pacienteAtivo.nome}</span>
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
            className="w-full h-11 rounded-xl border border-sus-900/15 bg-white pl-10 pr-10 py-2.5 text-sm text-ink outline-none transition placeholder:text-ink/35 focus:border-sus-700 focus:ring-2 focus:ring-sus-700/20"
            autoComplete="off"
          />
          {buscando && (
            <RefreshCw className="absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-teal" />
          )}

          {aberto && sugestoes.length > 0 && (
            <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded-xl border border-sus-900/15 bg-white shadow-xl divide-y divide-sus-900/5">
              {sugestoes.map((p) => (
                <div
                  key={p.id}
                  onClick={() => handleSelecionar(p)}
                  className="flex items-center justify-between p-3 text-left hover:bg-sand/60 cursor-pointer transition"
                >
                  <div>
                    <span className="block font-medium text-sm text-sus-950">{p.nome}</span>
                    <span className="block text-xs text-ink/50 font-mono">
                      {p.cpf ? `CPF: ${p.cpf}` : "Sem CPF"} · {p.cns ? `CNS: ${p.cns}` : "Sem CNS"}
                      {p.nascimento ? ` · Nasc: ${p.nascimento.slice(0, 10).split("-").reverse().join("/")}` : ""}
                    </span>
                  </div>
                  <span className="text-xs font-semibold text-teal bg-teal/10 px-2 py-0.5 rounded-md">
                    Selecionar
                  </span>
                </div>
              ))}
            </div>
          )}

          {aberto && busca.trim().length >= 2 && !buscando && sugestoes.length === 0 && (
            <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-xl border border-sus-900/15 bg-white p-4 text-center text-xs text-ink/50 shadow-xl">
              Nenhum paciente encontrado para "{busca}".
            </div>
          )}
        </div>
      )}
    </div>
  );
}
