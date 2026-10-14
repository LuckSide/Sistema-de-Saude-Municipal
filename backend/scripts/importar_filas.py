"""Importa filas e-SUS (CSV) p/ tfd_pacientes + tfd_exames_fila.

Uso:
  DATABASE_URL="postgresql://guape:guape123@localhost:5432/saude_guape" \
    python3 backend/scripts/importar_filas.py [--amostra N] [--somente fila|agendado|finalizado|removido]

Idempotente: dedup por (cpf+exame+data_pedido) e upsert paciente por CPF.
Nunca loga PII (só totais).
"""
import csv
import sys
from datetime import date, datetime
from pathlib import Path

BASE = Path("/Users/mateusluck/Documents/ESUS-exportacoes/filas-2026-10-07")

FONTES = [
    ("fila", BASE / "por-procedimento/por-tipo/fila_todos.csv", "aguardando"),
    ("agendado", BASE / "por-procedimento/agendado.csv", "agendado"),
    ("finalizado", BASE / "por-tipo-servico/finalizado.csv", "realizado"),
    ("removido", BASE / "por-procedimento/removido.csv", "cancelado"),
]

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlmodel import Session, select  # noqa: E402

from app.db.session import engine, init_db  # noqa: E402
from app.models.tfd import Especialidade, ExameFila, Paciente, ProcedimentoCatalogo, TipoFila  # noqa: E402


def so_digitos(s: str) -> str:
    return "".join(c for c in (s or "") if c.isdigit())


def parse_data(s: str) -> date | None:
    s = (s or "").strip()
    if not s:
        return None
    for fmt in ("%d/%m/%Y %H:%M", "%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s[:16] if "%H" in fmt else s[:10], fmt).date()
        except ValueError:
            continue
    return None


def get_fontes(somente: str | None):
    if not somente:
        return FONTES
    return [f for f in FONTES if f[0] == somente]


def parse_especialidade(r: dict) -> tuple[str, str]:
    cbo = (r.get("codigo_especialidade_executante") or "").strip()[:10]
    nome_raw = (r.get("nome_especialidade_executante") or "").strip()
    nome = nome_raw
    if " - " in nome_raw:
        nome = nome_raw.split(" - ", 1)[1].strip()
    if not nome:
        cbo_nome = (r.get("cbo_especialidade_nome_executante") or "").strip()
        if " - " in cbo_nome:
            nome = cbo_nome.split(" - ", 1)[1].strip()
        else:
            nome = cbo_nome
    return cbo[:10], nome[:120]


def main() -> int:
    amostra = 0
    somente = None
    for i, a in enumerate(sys.argv[1:]):
        if a == "--amostra" and i + 2 <= len(sys.argv[1:]):
            amostra = int(sys.argv[2 + i] if False else sys.argv[sys.argv.index("--amostra") + 1])
        if a == "--somente" and sys.argv.index("--somente") + 1 < len(sys.argv):
            somente = sys.argv[sys.argv.index("--somente") + 1]
    init_db()
    total_lidas = total_pac = total_exames = 0
    tipos_cat: dict[str, str] = {}
    esps_cat: dict[str, str] = {}
    procs_cat: dict[tuple[str, str], tuple[str, str, str]] = {}
    print("[1/3] início importação filas e-SUS", flush=True)
    with Session(engine) as db:
        pac_cache: dict[str, Paciente] = {}
        for p in db.exec(select(Paciente)).all():
            if p.cpf:
                pac_cache[f"cpf:{p.cpf}"] = p
            pac_cache[f"nome:{p.nome.strip().upper()}"] = p

        for nome_fonte, caminho, status in get_fontes(somente):
            if not caminho.exists():
                print(f"fonte {nome_fonte} ausente, pulo", flush=True)
                continue
            with open(caminho, encoding="utf-8-sig") as fh:
                linhas = list(csv.DictReader(fh))
            if amostra:
                linhas = linhas[:amostra]
            n = len(linhas)
            print(f"[2/3] fonte={nome_fonte} regs={n} status={status}", flush=True)
            for i, r in enumerate(linhas, 1):
                total_lidas += 1
                cpf = so_digitos(r.get("cpf_paciente") or r.get("num_cpf") or "")[:14]
                cns = (r.get("numero_cartao") or r.get("num_cns") or "").strip()[:20]
                nome = (r.get("nome_paciente") or "").strip()[:150]
                if not nome:
                    continue
                chave = f"cpf:{cpf}" if cpf else f"nome:{nome.upper()}"
                pac = pac_cache.get(chave)
                nasc = parse_data(r.get("data_nascimento") or "")
                tel = (r.get("telefone") or "").strip()[:20]
                if not pac:
                    pac = Paciente(
                        nome=nome, cpf=cpf, cns=cns,
                        nascimento=nasc, telefone=tel,
                    )
                    db.add(pac)
                    db.flush()
                    pac_cache[chave] = pac
                    total_pac += 1
                elif tel and not pac.telefone:
                    pac.telefone = tel
                    db.add(pac)

                cod = (r.get("codigo_procedimento") or "").strip()
                nproc = (r.get("nome_procedimento") or "").strip()
                tipo = (r.get("servico_tipo_nome") or "").strip()
                tipo_id = (r.get("servico_tipo_id") or "").strip()
                cbo, nome_esp = parse_especialidade(r)
                exame = (f"{cod} - {nproc}" if cod and nproc else (nproc or tipo or "EXAME"))[:120]
                data_ped = parse_data(r.get("data_hora_solicitacao") or "") or date.today()
                # Catálogo dinâmico (todas as linhas, não só dedup)
                if tipo:
                    tipos_cat[tipo.strip().upper()] = tipo_id.strip() or tipos_cat.get(tipo.strip().upper(), "")
                if cbo and nome_esp:
                    esps_cat[cbo.strip()] = nome_esp.strip()
                if cod or nproc:
                    procs_cat[(cod.strip(), nproc.strip().upper() or exame.strip().upper())] = (
                        tipo.strip().upper(), cbo.strip(), nome_esp.strip(),
                    )
                # dedup: mesmo paciente + exame + data_pedido
                ja = db.exec(
                    select(ExameFila).where(
                        ExameFila.paciente_id == pac.id,
                        ExameFila.exame == exame,
                        ExameFila.data_pedido == data_ped,
                    )
                ).first()
                if ja:
                    mudou = False
                    if ja.status != status:
                        ja.status = status
                        mudou = True
                    # Preenche filtros avançados em linhas legadas
                    if not (ja.tipo_fila or "").strip() and tipo:
                        ja.tipo_fila = tipo[:80]
                        mudou = True
                    if not (ja.codigo_procedimento or "").strip() and cod:
                        ja.codigo_procedimento = cod[:20]
                        mudou = True
                    if not (ja.codigo_especialidade or "").strip() and cbo:
                        ja.codigo_especialidade = cbo[:10]
                        mudou = True
                    if not (ja.nome_especialidade or "").strip() and nome_esp:
                        ja.nome_especialidade = nome_esp[:120]
                        mudou = True
                    if mudou:
                        db.add(ja)
                    continue
                urg = (r.get("urgencia") or "").strip().lower() == "sim"
                obs = (r.get("observacao") or "").strip()
                just = (r.get("justificativa") or "").strip()
                obs_full = (obs + (" | " + just if just and just not in obs else ""))[:500]
                dest = (r.get("unidade_referencia") or r.get("nome_unidade") or "")[:120]
                data_ag = parse_data(
                    r.get("data_min_agendamento") or r.get("data_primeiro_agendamento") or ""
                )
                db.add(ExameFila(
                    paciente_id=pac.id, exame=exame,
                    especialidade=tipo[:80],
                    tipo_fila=tipo[:80],
                    codigo_procedimento=cod[:20],
                    codigo_especialidade=cbo[:10],
                    nome_especialidade=nome_esp[:120],
                    prioridade="urgente" if urg else "rotina",
                    status=status, data_pedido=data_ped,
                    data_agendada=data_ag, destino=dest,
                    observacoes=obs_full,
                ))
                total_exames += 1
                if i % 500 == 0:
                    db.commit()
                    print(f"  {nome_fonte}: {i}/{n}", flush=True)
            db.commit()
            print(f"  {nome_fonte} fim: {n} lidas", flush=True)
        # Upsert catálogo dinâmico (idempotente)
        n_tipos = n_esps = n_procs = 0
        for nome_u, cod_id in tipos_cat.items():
            if not nome_u:
                continue
            ja_t = db.exec(select(TipoFila).where(TipoFila.nome == nome_u)).first()
            if ja_t:
                if cod_id and not (ja_t.codigo or "").strip():
                    ja_t.codigo = cod_id[:10]
                    db.add(ja_t)
                continue
            db.add(TipoFila(codigo=(cod_id or "")[:10], nome=nome_u[:80], ativo=True))
            n_tipos += 1
        for cbo_k, nome_e in esps_cat.items():
            if not cbo_k:
                continue
            if db.exec(select(Especialidade).where(Especialidade.codigo_cbo == cbo_k)).first():
                continue
            db.add(Especialidade(codigo_cbo=cbo_k[:10], nome=(nome_e or f"CBO {cbo_k}")[:120], ativo=True))
            n_esps += 1
        for (cod_p, nome_p), (tipo_p, cbo_p, nome_e) in procs_cat.items():
            if not (cod_p or nome_p):
                continue
            dup = db.exec(
                select(ProcedimentoCatalogo).where(
                    ProcedimentoCatalogo.codigo == (cod_p or ""),
                    ProcedimentoCatalogo.nome == (nome_p or "")[:150],
                )
            ).first()
            if dup:
                continue
            db.add(ProcedimentoCatalogo(
                codigo=(cod_p or "")[:20], nome=(nome_p or "")[:150],
                tipo_fila=(tipo_p or "")[:80],
                codigo_especialidade=(cbo_p or "")[:10],
                nome_especialidade=(nome_e or "")[:120],
                codigo_curto="", ativo=True,
            ))
            n_procs += 1
        db.commit()
        print(f"[catálogo] tipos_novos={n_tipos} esps_novas={n_esps} procs_novos={n_procs}", flush=True)
    print(f"[3/3] fim lidas={total_lidas} pacientes_novos={total_pac} exames_novos={total_exames}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
