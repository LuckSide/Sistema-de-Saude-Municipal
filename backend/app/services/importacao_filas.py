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


def _prioridade_paciente_import(p: Paciente, limpar_cpf_fn, limpar_cns_fn) -> tuple:
    sit = (getattr(p, "situacao_cadastral", None) or "ativo").strip().lower()
    return (
        1 if sit in ("ativo", "") else 0,
        1 if getattr(p, "co_seq_cidadao_pec", None) else 0,
        1 if limpar_cpf_fn(p.cpf) else 0,
        1 if limpar_cns_fn(p.cns) else 0,
        1 if getattr(p, "nascimento", None) else 0,
        1 if getattr(p, "codigo_prontuario", "") else 0,
        -(p.id or 0),
    )


def _normalizar_cpf_excel(valor: str, limpar_cpf_fn) -> str:
    dig = so_digitos(valor)[:14]
    if not dig:
        return ""
    c = limpar_cpf_fn(dig)
    if c:
        return c
    if 9 <= len(dig) <= 10:
        c_pad = limpar_cpf_fn(dig.zfill(11))
        if c_pad:
            return c_pad
    return dig


def _normalizar_cns_excel(raw: str, limpar_cns_fn) -> str:
    dig = so_digitos(raw)[:20]
    if not dig:
        return (raw or "").strip()[:20]
    c = limpar_cns_fn(dig)
    if c:
        return c
    if 13 <= len(dig) <= 14:
        c_pad = limpar_cns_fn(dig.zfill(15))
        if c_pad:
            return c_pad
    return (raw or "").strip()[:20]


def processar_linhas(linhas: list[dict], db: Session, simular: bool = False) -> dict:
    """Upsert pacientes + exames + catálogo. Retorna só contadores (sem PII)."""
    lidas = len(linhas)
    pacientes_novos = exames_novos = atualizados = duplicados = ignoradas = 0
    erros: list[dict] = []
    tipos_cat: dict[str, str] = {}
    esps_cat: dict[str, str] = {}
    procs_cat: dict[tuple[str, str], tuple[str, str, str]] = {}

    from app.services.geradores import gerar_prontuario_aleatorio
    from app.services.pec_sync import (
        limpar_cns as _limpar_cns,
        limpar_cpf as _limpar_cpf,
        nomes_sao_compativeis as _nomes_compativeis,
        normalizar_nome_sem_prep as _norm_nome_sp,
        classificar_situacao_pec as _classificar_situacao_pec,
    )
    from app.models.tfd import PacienteHistorico

    pec_engine = None
    try:
        from app.models.integracoes import IntegrationSettings
        from app.services.pec_tunnel import garantir_tunel_db
        from sqlalchemy import create_engine
        cfg_pec = db.exec(select(IntegrationSettings).where(IntegrationSettings.id == 1)).first()
        if cfg_pec:
            conectado, dsn = garantir_tunel_db(cfg_pec)
            if conectado and dsn:
                pec_engine = create_engine(dsn, pool_pre_ping=True, connect_args={"connect_timeout": 4})
    except Exception:
        pec_engine = None

    def _buscar_pec_cidadao(cpf_val: str, cns_val: str, nome_val: str, nasc_val: date | None) -> dict | None:
        if not pec_engine:
            return None
        from sqlalchemy import text
        try:
            with pec_engine.connect() as conn:
                if cpf_val:
                    row = conn.execute(
                        text("SELECT co_seq_cidadao, no_cidadao, nu_cpf, nu_cns, dt_nascimento, no_mae, nu_telefone_celular, st_faleceu, st_mudou_se FROM tb_cidadao WHERE nu_cpf = :cpf LIMIT 1"),
                        {"cpf": cpf_val}
                    ).mappings().first()
                    if row:
                        return dict(row)
                if cns_val:
                    row = conn.execute(
                        text("SELECT co_seq_cidadao, no_cidadao, nu_cpf, nu_cns, dt_nascimento, no_mae, nu_telefone_celular, st_faleceu, st_mudou_se FROM tb_cidadao WHERE nu_cns = :cns LIMIT 1"),
                        {"cns": cns_val}
                    ).mappings().first()
                    if row:
                        return dict(row)
                if nome_val and nasc_val:
                    row = conn.execute(
                        text("SELECT co_seq_cidadao, no_cidadao, nu_cpf, nu_cns, dt_nascimento, no_mae, nu_telefone_celular, st_faleceu, st_mudou_se FROM tb_cidadao WHERE UPPER(TRIM(no_cidadao)) = :nome AND dt_nascimento = :nasc LIMIT 1"),
                        {"nome": nome_val.strip().upper(), "nasc": nasc_val}
                    ).mappings().first()
                    if row:
                        return dict(row)
        except Exception:
            pass
        return None

    pac_cpf_cache: dict[str, Paciente] = {}
    pac_cns_cache: dict[str, Paciente] = {}
    pac_pec_cache: dict[int, Paciente] = {}
    pac_nn_cache: dict[tuple[str, str], Paciente] = {}
    pac_nasc_cache: dict[str, list[Paciente]] = {}
    pac_nome_cache: dict[str, list[Paciente]] = {}

    # Prioriza cidadãos ativos sincronizados com o PEC para evitar vincular fila a stubs legados/duplicados
    pacientes_existentes = sorted(
        db.exec(select(Paciente)).all(),
        key=lambda p: _prioridade_paciente_import(p, _limpar_cpf, _limpar_cns),
        reverse=True,
    )
    for p in pacientes_existentes:
        cpf_p = _limpar_cpf(p.cpf)
        cns_p = _limpar_cns(p.cns)
        n_sp = _norm_nome_sp(p.nome)
        if cpf_p:
            pac_cpf_cache.setdefault(cpf_p, p)
        if cns_p:
            pac_cns_cache.setdefault(cns_p, p)
        if p.co_seq_cidadao_pec:
            pac_pec_cache.setdefault(p.co_seq_cidadao_pec, p)
        if p.nascimento:
            pac_nasc_cache.setdefault(str(p.nascimento), []).append(p)
        if n_sp and p.nascimento:
            pac_nn_cache.setdefault((n_sp, str(p.nascimento)), p)
        if n_sp:
            pac_nome_cache.setdefault(n_sp, []).append(p)

    for i, bruta in enumerate(linhas, start=2):  # linha 1 = cabeçalho
        r = normalizar_linha(bruta)
        nome = (r.get("nome") or "")[:150]
        if not nome:
            ignoradas += 1
            if len(erros) < MAX_ERROS:
                erros.append({"linha": i, "motivo": "nome ausente"})
            continue
        cpf = _normalizar_cpf_excel(r.get("cpf") or "", _limpar_cpf)
        cns = _normalizar_cns_excel(r.get("cns") or "", _limpar_cns)
        cpf_limpo_lin = _limpar_cpf(cpf)
        cns_limpo_lin = _limpar_cns(cns)
        nasc_lin = parse_data(r.get("nascimento") or "")
        n_sp_lin = _norm_nome_sp(nome)

        def _sem_conflito_docs(cand: Paciente) -> bool:
            cand_cpf = _limpar_cpf(cand.cpf)
            cand_cns = _limpar_cns(cand.cns)
            if cpf_limpo_lin and cand_cpf and cand_cpf != cpf_limpo_lin:
                return False
            if cns_limpo_lin and cand_cns and cand_cns != cns_limpo_lin:
                return False
            return True

        pac = None
        if cpf_limpo_lin and cpf_limpo_lin in pac_cpf_cache:
            pac = pac_cpf_cache[cpf_limpo_lin]
        elif cns_limpo_lin and cns_limpo_lin in pac_cns_cache:
            pac = pac_cns_cache[cns_limpo_lin]
        elif n_sp_lin and nasc_lin and (n_sp_lin, str(nasc_lin)) in pac_nn_cache:
            cand = pac_nn_cache[(n_sp_lin, str(nasc_lin))]
            if _sem_conflito_docs(cand):
                pac = cand
        elif nome and nasc_lin:
            # Fallback tolerante a variações de preposição/abreviação com mesma data de nascimento
            for cand in pac_nasc_cache.get(str(nasc_lin), []):
                if _sem_conflito_docs(cand) and _nomes_compativeis(nome, cand.nome):
                    pac = cand
                    break
        elif n_sp_lin and not nasc_lin:
            cands = [cand for cand in pac_nome_cache.get(n_sp_lin, []) if _sem_conflito_docs(cand)]
            if len(cands) == 1:
                pac = cands[0]

        if not pac:
            # Consulta o e-SUS PEC prioritariamente antes de criar um novo paciente
            pec_cidadao = _buscar_pec_cidadao(cpf_limpo_lin, cns_limpo_lin, nome, nasc_lin)
            if pec_cidadao:
                co_seq = pec_cidadao.get("co_seq_cidadao")
                if co_seq and co_seq in pac_pec_cache:
                    pac = pac_pec_cache[co_seq]
                else:
                    st_f = pec_cidadao.get("st_faleceu")
                    st_m = pec_cidadao.get("st_mudou_se")
                    sit = "obito" if st_f in (1, True, "1") else ("mudanca_municipio" if st_m in (1, True, "1") else "ativo")
                    cpf_pec = _limpar_cpf(pec_cidadao.get("nu_cpf")) or cpf
                    cns_pec = _limpar_cns(pec_cidadao.get("nu_cns")) or cns
                    pac = Paciente(
                        nome=(pec_cidadao.get("no_cidadao") or nome)[:150],
                        cpf=cpf_pec,
                        cns=cns_pec,
                        nascimento=pec_cidadao.get("dt_nascimento") or nasc_lin,
                        nome_mae=(pec_cidadao.get("no_mae") or "")[:150],
                        telefone=(pec_cidadao.get("nu_telefone_celular") or r.get("telefone") or "")[:50],
                        co_seq_cidadao_pec=co_seq,
                        situacao_cadastral=sit,
                    )
                    db.add(pac)
                    db.flush()
                    if co_seq:
                        pac_pec_cache[co_seq] = pac
                    pacientes_novos += 1
            else:
                pac = Paciente(
                    nome=nome, cpf=cpf, cns=cns,
                    nascimento=nasc_lin,
                    telefone=(r.get("telefone") or "")[:20],
                )
                db.add(pac)
                db.flush()
                pacientes_novos += 1

            if not getattr(pac, "codigo_prontuario", ""):
                pac.codigo_prontuario = gerar_prontuario_aleatorio(db, pac.id)
                db.add(pac)
            if _limpar_cpf(pac.cpf):
                pac_cpf_cache.setdefault(_limpar_cpf(pac.cpf), pac)
            if _limpar_cns(pac.cns):
                pac_cns_cache.setdefault(_limpar_cns(pac.cns), pac)
            if pac.nascimento:
                pac_nasc_cache.setdefault(str(pac.nascimento), []).append(pac)
            if n_sp_lin and pac.nascimento:
                pac_nn_cache.setdefault((n_sp_lin, str(pac.nascimento)), pac)
            if n_sp_lin:
                pac_nome_cache.setdefault(n_sp_lin, []).append(pac)
        else:
            if cpf_limpo_lin and not _limpar_cpf(pac.cpf):
                pac.cpf = cpf_limpo_lin
                pac_cpf_cache.setdefault(cpf_limpo_lin, pac)
            if cns_limpo_lin and not _limpar_cns(pac.cns):
                pac.cns = cns_limpo_lin
                pac_cns_cache.setdefault(cns_limpo_lin, pac)
            if (r.get("telefone") or "") and not pac.telefone:
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

        # Baixa automática imediata se o paciente for óbito ou mudança de município no PEC
        if (getattr(pac, "situacao_cadastral", "") or "").lower() in ("obito", "mudanca_municipio"):
            status = "cancelado"
            db.add(
                PacienteHistorico(
                    paciente_id=pac.id,
                    tipo_evento=f"BAIXA_{(pac.situacao_cadastral or 'INATIVO').upper()}",
                    motivo=f"Baixa automática na importação de fila devido a registro de {pac.situacao_cadastral} no e-SUS PEC",
                    descricao=f"Solicitação do exame '{exame}' arquivada automaticamente na carga de fila.",
                    origem="importacao_filas",
                    exames_baixados_qtd=1,
                    registrado_por="Sistema e-SUS PEC Sync",
                )
            )

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
        if not simular and (exames_novos + atualizados) % 500 == 0:
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

    if not simular:
        try:
            from app.services.pec_sync import consolidar_pacientes_duplicados
            consolidar_pacientes_duplicados(db, remover_inelegiveis_sem_vinculo=False)
        except Exception:
            pass

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
