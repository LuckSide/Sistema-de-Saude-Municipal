"""Carga massiva de filas de espera (CSV/XLSX) p/ tfd_pacientes + tfd_exames_fila.

Idempotente: upsert paciente por CPF (ou nome) + dedup exame por
(paciente, exame, data_pedido). Nunca retorna PII — erros usam nº da linha.
"""

import csv
import io
import secrets
from datetime import date, datetime

from sqlmodel import Session, select

from app.models.tfd import (
    Especialidade,
    ExameFila,
    Paciente,
    ProcedimentoCatalogo,
    TipoFila,
)

MAX_BYTES = 10 * 1024 * 1024
MAX_LINHAS = 20000
MAX_ERROS = 25

STATUS_VALIDOS = {"aguardando", "agendado", "realizado", "cancelado"}

# header normalizado -> campo canônico
ALIASES = {
    "nome": "nome",
    "nome_paciente": "nome",
    "paciente": "nome",
    "cpf": "cpf",
    "cpf_paciente": "cpf",
    "num_cpf": "cpf",
    "cns": "cns",
    "numero_cartao": "cns",
    "num_cns": "cns",
    "cartao_sus": "cns",
    "data_nascimento": "nascimento",
    "nascimento": "nascimento",
    "telefone": "telefone",
    "fone": "telefone",
    "codigo_procedimento": "codigo_procedimento",
    "cod_procedimento": "codigo_procedimento",
    "codigo": "codigo_procedimento",
    "nome_procedimento": "nome_procedimento",
    "procedimento": "nome_procedimento",
    "servico_tipo_nome": "tipo_fila",
    "tipo_fila": "tipo_fila",
    "tipo": "tipo_fila",
    "servico": "tipo_fila",
    "codigo_especialidade_executante": "cbo",
    "codigo_especialidade": "cbo",
    "cbo": "cbo",
    "nome_especialidade_executante": "nome_especialidade",
    "cbo_especialidade_nome_executante": "nome_especialidade",
    "nome_especialidade": "nome_especialidade",
    "data_hora_solicitacao": "data_pedido",
    "data_pedido": "data_pedido",
    "data_solicitacao": "data_pedido",
    "urgencia": "prioridade",
    "prioridade": "prioridade",
    "observacao": "observacao",
    "observacoes": "observacao",
    "justificativa": "justificativa",
    "unidade_referencia": "destino",
    "nome_unidade": "destino",
    "destino": "destino",
    "data_min_agendamento": "data_agendada",
    "data_primeiro_agendamento": "data_agendada",
    "data_agendada": "data_agendada",
    "status": "status",
}


def so_digitos(s: str) -> str:
    return "".join(c for c in (s or "") if c.isdigit())


def parse_data(s: str) -> date | None:
    s = (s or "").strip()
    if not s:
        return None
    for fmt in ("%d/%m/%Y %H:%M", "%d/%m/%Y", "%Y-%m-%d", "%Y-%m-%d %H:%M:%S"):
        try:
            pedaco = s[:16] if "%H" in fmt else s[:10]
            return datetime.strptime(pedaco, fmt).date()
        except ValueError:
            continue
    return None


def normalizar_linha(bruta: dict) -> dict:
    """Mapeia headers variados p/ campos canônicos (case-insensitive)."""
    out: dict[str, str] = {}
    for k, v in (bruta or {}).items():
        chave = (str(k) if k is not None else "").strip().lower()
        campo = ALIASES.get(chave)
        if not campo:
            continue
        txt = "" if v is None else str(v).strip()
        if campo == "observacao" and "observacao" in out and txt:
            out[campo] = f"{out[campo]} | {txt}" if out[campo] else txt
        elif campo == "justificativa":
            # justificativa complementa observacao
            base = out.get("observacao", "")
            out["observacao"] = f"{base} | {txt}" if base and txt else (base or txt)
        else:
            out[campo] = txt
    return out


def detectar_delimitador(texto: str) -> str:
    """Sniffer é instável com `;` uniforme — conta ocorrência por linha."""
    linhas = [ln for ln in texto.splitlines() if ln.strip()][:5]
    if not linhas:
        return ","
    for cand in (";", ",", "|", "\t"):
        contagens = [ln.count(cand) for ln in linhas]
        if contagens[0] > 0 and all(c == contagens[0] for c in contagens):
            return cand
    if ";" in linhas[0]:
        return ";"
    return ","


def ler_csv(conteudo: bytes) -> list[dict]:
    texto = None
    for enc in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            texto = conteudo.decode(enc)
            break
        except (UnicodeDecodeError, ValueError):
            continue
    if texto is None:
        raise ValueError("encoding ilegível (use UTF-8 ou Latin-1)")
    delim = detectar_delimitador(texto)
    return list(csv.DictReader(io.StringIO(texto), delimiter=delim))


def ler_xlsx(conteudo: bytes) -> list[dict]:
    try:
        import openpyxl
    except ImportError:
        raise ValueError("Excel indisponível no servidor (openpyxl ausente) — envie CSV")
    try:
        wb = openpyxl.load_workbook(io.BytesIO(conteudo), read_only=True, data_only=True)
        ws = wb.active
        linhas = list(ws.iter_rows(values_only=True))
    except Exception:
        raise ValueError("planilha ilegível (use .xlsx com cabeçalho na 1ª linha)")
    if not linhas or not any(linhas[0]):
        raise ValueError("planilha sem cabeçalho")
    headers = [(str(h).strip() if h is not None else "") for h in linhas[0]]
    out = []
    for vals in linhas[1:]:
        if not any(v not in (None, "") for v in vals):
            continue
        out.append({h: ("" if v is None else str(v)) for h, v in zip(headers, vals)})
    return out


def prioridade_de(raw: str) -> str:
    v = (raw or "").strip().lower()
    if v in ("sim", "urgente", "urgencia", "urgência"):
        return "urgente"
    if v in ("prioritaria", "prioritária"):
        return "rotina"  # categoria extinta: colapsa p/ Eletivo
    if v in ("rotina", "normal", "eletiva", ""):
        return "rotina"
    return "rotina"


def processar_linhas(linhas: list[dict], db: Session) -> dict:
    """Upsert pacientes + exames + catálogo. Retorna só contadores (sem PII)."""
    lidas = len(linhas)
    pacientes_novos = exames_novos = atualizados = duplicados = ignoradas = 0
    erros: list[dict] = []
    tipos_cat: dict[str, str] = {}
    esps_cat: dict[str, str] = {}
    procs_cat: dict[tuple[str, str], tuple[str, str, str]] = {}

    pac_cache: dict[str, Paciente] = {}
    for p in db.exec(select(Paciente)).all():
        if p.cpf:
            pac_cache[f"cpf:{p.cpf}"] = p
        pac_cache[f"nome:{p.nome.strip().upper()}"] = p

    for i, bruta in enumerate(linhas, start=2):  # linha 1 = cabeçalho
        r = normalizar_linha(bruta)
        nome = (r.get("nome") or "")[:150]
        if not nome:
            ignoradas += 1
            if len(erros) < MAX_ERROS:
                erros.append({"linha": i, "motivo": "nome ausente"})
            continue
        cpf = so_digitos(r.get("cpf") or "")[:14]
        cns = (r.get("cns") or "")[:20]
        chave = f"cpf:{cpf}" if cpf else f"nome:{nome.upper()}"
        pac = pac_cache.get(chave)
        if not pac:
            pac = Paciente(
                nome=nome, cpf=cpf, cns=cns,
                nascimento=parse_data(r.get("nascimento") or ""),
                telefone=(r.get("telefone") or "")[:20],
            )
            db.add(pac)
            db.flush()
            pac_cache[chave] = pac
            pacientes_novos += 1
        elif (r.get("telefone") or "") and not pac.telefone:
            pac.telefone = (r.get("telefone") or "")[:20]
            db.add(pac)

        cod = (r.get("codigo_procedimento") or "").strip()
        nproc = (r.get("nome_procedimento") or "").strip()
        tipo = (r.get("tipo_fila") or "").strip()
        cbo_raw = (r.get("cbo") or "").strip()[:10]
        nome_esp = (r.get("nome_especialidade") or "").strip()
        if " - " in nome_esp:
            nome_esp = nome_esp.split(" - ", 1)[1].strip()
        nome_esp = nome_esp[:120]
        exame = (f"{cod} - {nproc}" if cod and nproc else (nproc or tipo or "EXAME"))[:120]
        data_ped = parse_data(r.get("data_pedido") or "") or date.today()
        status = (r.get("status") or "aguardando").strip().lower()
        if status not in STATUS_VALIDOS:
            status = "aguardando"

        if tipo:
            tipos_cat[tipo.upper()] = tipos_cat.get(tipo.upper(), "")
        if cbo_raw and nome_esp:
            esps_cat[cbo_raw] = nome_esp
        if cod or nproc:
            procs_cat[(cod, (nproc or exame).upper())] = (tipo.upper(), cbo_raw, nome_esp)

        ja = db.exec(
            select(ExameFila).where(
                ExameFila.paciente_id == pac.id,
                ExameFila.exame == exame,
                ExameFila.data_pedido == data_ped,
                ExameFila.ativo == True,  # noqa: E712
            )
        ).first()
        if ja:
            if ja.status != status:
                ja.status = status
                db.add(ja)
                atualizados += 1
            else:
                duplicados += 1
            continue

        db.add(ExameFila(
            paciente_id=pac.id, exame=exame,
            especialidade=tipo[:80], tipo_fila=tipo[:80],
            codigo_procedimento=cod[:20],
            codigo_especialidade=cbo_raw[:10],
            nome_especialidade=nome_esp[:120],
            prioridade=prioridade_de(r.get("prioridade") or ""),
            status=status, data_pedido=data_ped,
            data_agendada=parse_data(r.get("data_agendada") or ""),
            destino=(r.get("destino") or "")[:120],
            observacoes=(r.get("observacao") or "")[:500],
            public_token=secrets.token_urlsafe(24),
        ))
        exames_novos += 1
        if (exames_novos + atualizados) % 500 == 0:
            db.commit()

    n_tipos = n_esps = n_procs = 0
    for nome_u in tipos_cat:
        if nome_u and not db.exec(select(TipoFila).where(TipoFila.nome == nome_u)).first():
            db.add(TipoFila(codigo="", nome=nome_u[:80], ativo=True))
            n_tipos += 1
    for cbo_k, nome_e in esps_cat.items():
        if cbo_k and not db.exec(select(Especialidade).where(Especialidade.codigo_cbo == cbo_k)).first():
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

    return {
        "lidas": lidas,
        "pacientes_novos": pacientes_novos,
        "exames_novos": exames_novos,
        "atualizados": atualizados,
        "duplicados": duplicados,
        "ignoradas": ignoradas,
        "catalogo": {"tipos_novos": n_tipos, "especialidades_novas": n_esps, "procedimentos_novos": n_procs},
        "erros": erros,
    }
