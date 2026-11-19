"""Carga massiva de filas de espera (CSV/XLSX) p/ tfd_pacientes + tfd_exames_fila.

Idempotente: upsert paciente por CPF (ou nome) + dedup exame por
(paciente, exame, data_pedido). Nunca retorna PII — erros usam nº da linha.
"""

import csv
import hashlib
import io
import json
import re
import secrets
import unicodedata
from datetime import date, datetime

from sqlmodel import Session, select

from app.models.tfd import (
    Especialidade,
    ExameFila,
    Paciente,
    ProcedimentoCatalogo,
    TipoFila,
)

MAX_BYTES = 60 * 1024 * 1024
MAX_LINHAS = 200000
MAX_ERROS = 25

STATUS_VALIDOS = {"aguardando", "agendado", "realizado", "cancelado"}
VALORES_PLACEHOLDER = {
    "",
    "desconhecido",
    "desconhecida",
    "n/a",
    "na",
    "nao informado",
    "não informado",
    "nenhum",
    "nenhuma",
    "null",
    "none",
    "-",
    "--",
}
PREFIXOS_SIGTAP_LAB = (
    "DOSAGEM DE ",
    "PESQUISA DE ",
    "DETERMINACAO DE ",
    "EXAME DE ",
    "CONTAGEM DE ",
    "TESTE DE ",
)

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
    "codigo_sigtap": "codigo_procedimento",
    "cod_sigtap": "codigo_procedimento",
    "sigtap": "codigo_procedimento",
    "codigo": "codigo_pedido",
    "codigo_pedido": "codigo_pedido",
    "nome_procedimento": "nome_procedimento",
    "descricao_procedimento": "nome_procedimento",
    "procedimento": "nome_procedimento",
    "nome_exame": "nome_procedimento",
    "exame": "nome_procedimento",
    "exames_realizados": "exames_realizados",
    "exames_solicitados": "exames_realizados",
    "procedimentos": "exames_realizados",
    "quantidade": "quantidade",
    "qtd": "quantidade",
    "servico_tipo_nome": "tipo_fila",
    "tipo_fila": "tipo_fila",
    "tipo": "tipo_fila",
    "servico": "tipo_fila",
    "tipo_servico": "tipo_fila",
    "codigo_especialidade_executante": "cbo",
    "codigo_especialidade": "cbo",
    "cbo": "cbo",
    "codigo_profissional": "cbo",
    "nome_especialidade_executante": "nome_especialidade",
    "cbo_especialidade_nome_executante": "nome_especialidade",
    "nome_especialidade": "nome_especialidade",
    "profissional": "medico_nome",
    "medico": "medico_nome",
    "medico_solicitante": "medico_nome",
    "prontuario": "prontuario",
    "num_prontuario": "prontuario",
    "codigo_prontuario": "prontuario",
    "numero_atendimento": "atendimento",
    "atendimento": "atendimento",
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
    "unidade": "destino",
    "destino": "destino",
    "data_min_agendamento": "data_agendada",
    "data_primeiro_agendamento": "data_agendada",
    "data_agendamento": "data_agendada",
    "data_agendada": "data_agendada",
    "hora_agendamento": "hora_agendada",
    "hora_agendada": "hora_agendada",
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


def _normalizar_texto_proc(s: str) -> str:
    """Remove acentos, converte para maiúsculas e colapsa espaços extras."""
    if not s:
        return ""
    nfkd = unicodedata.normalize("NFKD", s.strip())
    sem_acento = "".join(c for c in nfkd if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", sem_acento).strip().upper()


def _eh_placeholder(s: str) -> bool:
    return (s or "").strip().lower() in VALORES_PLACEHOLDER


def _parse_procedimentos_texto(raw: str) -> list[dict]:
    """Interpreta listas textuais de exames separadas por ';', '|' ou quebra de linha.

    Suporta:
    - "0202020380 - HEMOGRAMA COMPLETO; 0202010473 - DOSAGEM DE GLICOSE"
    - "HEMOGRAMA COMPLETO; GLICOSE; COLESTEROL TOTAL"
    """
    if _eh_placeholder(raw):
        return []
    partes = re.split(r"[;|\n]+", raw)
    out: list[dict] = []
    for p in partes:
        txt = p.strip()
        if _eh_placeholder(txt):
            continue
        m = re.match(r"^(\d[\d.\-]{7,13})\s*[-–:]\s*(.+)$", txt)
        if m:
            out.append({
                "codigo_procedimento": so_digitos(m.group(1)),
                "nome_procedimento": m.group(2).strip(),
                "quantidade": 1,
            })
        else:
            dig = so_digitos(txt)
            if dig and len(dig) in (9, 10) and dig == re.sub(r"[.\-\s]", "", txt):
                out.append({
                    "codigo_procedimento": dig,
                    "nome_procedimento": "",
                    "quantidade": 1,
                })
            else:
                out.append({
                    "codigo_procedimento": "",
                    "nome_procedimento": txt,
                    "quantidade": 1,
                })
    return out


def normalizar_linha(bruta: dict) -> dict:
    """Mapeia headers variados p/ campos canônicos (case-insensitive)."""
    out: dict = {}
    for k, v in (bruta or {}).items():
        if k == "_procedimentos_lista" and isinstance(v, list):
            out["_procedimentos_lista"] = v
            continue
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


def _extrair_procedimentos_container(container_el) -> list[dict]:
    """Extrai lista de procedimentos individuais a partir de um elemento XML aninhado.

    Suporta:
    - <procedimento><codigo_procedimento>...</codigo_procedimento><nome_procedimento>...</nome_procedimento></procedimento>
    - <procedimento codigo="0202020380" nome="HEMOGRAMA COMPLETO" quantidade="1" />
    - <procedimento>0202020380 - HEMOGRAMA COMPLETO</procedimento>
    """
    procs: list[dict] = []
    for sub in list(container_el):
        sub_filhos = list(sub)
        if sub_filhos or sub.attrib:
            cod = ""
            nome = ""
            qtd = 1
            # Atributos XML
            for ak, av in (sub.attrib or {}).items():
                akl = ak.strip().lower()
                avl = (av or "").strip()
                if akl in ("codigo", "codigo_procedimento", "cod_procedimento", "codigo_sigtap", "sigtap"):
                    cod = avl
                elif akl in ("nome", "nome_procedimento", "descricao", "descricao_procedimento", "exame"):
                    nome = avl
                elif akl in ("quantidade", "qtd"):
                    try:
                        qtd = max(1, int(avl))
                    except ValueError:
                        qtd = 1
            # Sub-elementos XML
            for g in sub_filhos:
                gt = (g.tag or "").strip().lower()
                gv = (g.text or "").strip()
                if gt in ("codigo", "codigo_procedimento", "cod_procedimento", "codigo_sigtap", "cod_sigtap", "sigtap"):
                    if gv:
                        cod = gv
                elif gt in ("nome", "nome_procedimento", "descricao", "descricao_procedimento", "exame", "procedimento"):
                    if gv:
                        nome = gv
                elif gt in ("quantidade", "qtd"):
                    try:
                        qtd = max(1, int(gv))
                    except ValueError:
                        qtd = 1
            if not nome and not sub_filhos and (sub.text or "").strip():
                nome = (sub.text or "").strip()
            if not (_eh_placeholder(cod) and _eh_placeholder(nome)):
                procs.append({
                    "codigo_procedimento": "" if _eh_placeholder(cod) else cod,
                    "nome_procedimento": "" if _eh_placeholder(nome) else nome,
                    "quantidade": qtd,
                })
        else:
            txt = (sub.text or "").strip()
            procs.extend(_parse_procedimentos_texto(txt))
    return procs


def ler_xml(conteudo: bytes) -> list[dict]:
    """Parse tolerante e de alta performance para arquivos XML de filas e exames laboratoriais.

    Suporta:
    1. Formato agrupado/aninhado (<exame> contendo <exames_realizados>/<procedimentos>/<itens> com sub-tags);
    2. Formato achatado/tabular (um nó <exame> por procedimento com <codigo_procedimento>/<nome_procedimento>);
    3. Lista delimitada em texto dentro de <exames_realizados> (separada por ';' ou '|').
    """
    import xml.etree.ElementTree as ET
    try:
        root = ET.fromstring(conteudo)
    except Exception as e:
        raise ValueError(f"XML inválido ou corrompido: {e}")

    # Prioriza filhos diretos (ou 1 nível abaixo de wrapper) para não capturar sub-tags <exame>/<item> internas
    itens = []
    for tag_cand in ("exame", "solicitacao", "registro", "item", "paciente"):
        itens = root.findall(f"./{tag_cand}")
        if itens:
            break
    if not itens:
        for wrapper in ("exames", "solicitacoes", "registros", "itens"):
            w = root.find(f"./{wrapper}")
            if w is not None and len(list(w)) > 0:
                itens = list(w)
                break
    if not itens:
        for tag_cand in ("exame", "registro", "item", "solicitacao", "paciente"):
            itens = root.findall(f".//{tag_cand}")
            if itens:
                break
    if not itens:
        filhos = list(root)
        if filhos and len(filhos) > 1:
            itens = filhos

    if not itens:
        raise ValueError("Nenhum registro encontrado no XML (esperado tags <exame>, <solicitacao>, <registro> ou <item>)")

    CONTAINER_PROCS_TAGS = {"exames_realizados", "exames_solicitados", "procedimentos", "itens", "exames"}

    out: list[dict] = []
    for el in itens:
        d: dict = {}
        procs_lista: list[dict] = []
        for child in el:
            tag = (child.tag or "").strip().lower()
            if tag in CONTAINER_PROCS_TAGS and len(list(child)) > 0:
                procs_lista.extend(_extrair_procedimentos_container(child))
            else:
                val = (child.text or "").strip()
                d[tag] = val
        if procs_lista:
            d["_procedimentos_lista"] = procs_lista
        if d:
            out.append(d)
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
    if 1 <= len(dig) <= 10:
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
    if 1 <= len(dig) <= 14:
        c_pad = limpar_cns_fn(dig.zfill(15))
        if c_pad:
            return c_pad
    return (raw or "").strip()[:20]


def processar_linhas(
    linhas: list[dict],
    db: Session,
    simular: bool = False,
    criar_pacientes_novos: bool = True,
) -> dict:
    """Upsert pacientes (priorizando cidadãos já sincronizados do e-SUS PEC) + exames + catálogo."""
    lidas = len(linhas)
    pacientes_novos = exames_novos = atualizados = duplicados = ignoradas = 0
    itens_lab_novos = sigtap_criados = 0
    pacientes_sincronizados_pec = pacientes_criados_sem_pec = pacientes_nao_encontrados_ignorados = 0
    ids_vinculados_pec: set[int] = set()
    ids_vinculados_locais: set[int] = set()
    avisos_pacientes_novos: list[dict] = []
    avisos_nomes_vistos: set[str] = set()
    erros: list[dict] = []
    tipos_cat: dict[str, str] = {}
    esps_cat: dict[str, str] = {}
    procs_cat: dict[tuple[str, str], tuple[str, str, str]] = {}

    from app.models.cadastros_saude import UnidadeSaude
    from app.models.lab_fase6 import FilaPsf, Laboratorio, SolicitacaoMestre, ItemSolic, VagaLab
    from app.models.lab_exames import SigtapProcedimento
    from sqlmodel import func as sm_func, or_

    lab_padrao_cache: Laboratorio | None = None

    # Cache em memória da tabela SIGTAP (código exato, 10 dígitos, nome normalizado e nome curto sem prefixo)
    sigtap_por_codigo: dict[str, SigtapProcedimento] = {}
    sigtap_por_nome: dict[str, SigtapProcedimento] = {}
    sigtap_por_nome_curto: dict[str, SigtapProcedimento] = {}

    def _eh_sigtap_lab(sp: SigtapProcedimento) -> bool:
        return (sp.grupo_codigo == "02") or (sp.codigo or "").startswith("02")

    def _registrar_sigtap_cache(sp: SigtapProcedimento) -> None:
        cod_u = (sp.codigo or "").strip().upper()
        if cod_u:
            sigtap_por_codigo.setdefault(cod_u, sp)
            dig = so_digitos(cod_u)
            if dig:
                sigtap_por_codigo.setdefault(dig, sp)
                if len(dig) in (9, 10):
                    sigtap_por_codigo.setdefault(dig.zfill(10), sp)
        nome_n = _normalizar_texto_proc(sp.descricao or "")
        if nome_n:
            atual = sigtap_por_nome.get(nome_n)
            if atual is None or (_eh_sigtap_lab(sp) and not _eh_sigtap_lab(atual)):
                sigtap_por_nome[nome_n] = sp
            for pref in PREFIXOS_SIGTAP_LAB:
                if nome_n.startswith(pref):
                    curto = nome_n[len(pref):].strip()
                    if curto:
                        atual_c = sigtap_por_nome_curto.get(curto)
                        if atual_c is None or (_eh_sigtap_lab(sp) and not _eh_sigtap_lab(atual_c)):
                            sigtap_por_nome_curto[curto] = sp
                    break

    for sp_existente in db.exec(select(SigtapProcedimento)).all():
        _registrar_sigtap_cache(sp_existente)

    def _resolver_ou_criar_sigtap(cod_raw: str, nome_raw: str) -> SigtapProcedimento | None:
        nonlocal sigtap_criados
        cod_clean = "" if _eh_placeholder(cod_raw) else (cod_raw or "").strip()
        nome_clean = "" if _eh_placeholder(nome_raw) else (nome_raw or "").strip()
        if not cod_clean and not nome_clean:
            return None

        # 1. Lookup por código (exato, somente dígitos, zero-padded 10 dígitos)
        cod_u = cod_clean.upper()
        cod_dig = so_digitos(cod_clean)
        if cod_u:
            hit = sigtap_por_codigo.get(cod_u)
            if hit:
                return hit
            if cod_dig:
                hit = sigtap_por_codigo.get(cod_dig)
                if hit:
                    return hit
                if len(cod_dig) in (9, 10):
                    hit = sigtap_por_codigo.get(cod_dig.zfill(10))
                    if hit:
                        return hit

        # 2. Fallback por nome normalizado (exato e sem prefixo "DOSAGEM DE "/"PESQUISA DE "...)
        nome_n = _normalizar_texto_proc(nome_clean)
        if nome_n:
            hit = sigtap_por_nome.get(nome_n) or sigtap_por_nome_curto.get(nome_n)
            if hit:
                return hit
            for pref in PREFIXOS_SIGTAP_LAB:
                if nome_n.startswith(pref):
                    curto = nome_n[len(pref):].strip()
                    if curto:
                        hit = sigtap_por_nome_curto.get(curto) or sigtap_por_nome.get(curto)
                        if hit:
                            return hit
                    break

        # 3. Criação controlada (apenas quando há código ou nome real não encontrado)
        if cod_dig and len(cod_dig) in (9, 10):
            codigo_novo = cod_dig.zfill(10)
        elif cod_clean and len(cod_clean) <= 20:
            codigo_novo = cod_u[:20]
        else:
            chave_hash = nome_n or cod_u
            codigo_novo = f"IMP-{hashlib.sha1(chave_hash.encode('utf-8')).hexdigest()[:12].upper()}"

        if codigo_novo in sigtap_por_codigo:
            return sigtap_por_codigo[codigo_novo]

        desc_nova = (nome_clean or f"PROCEDIMENTO {codigo_novo}")[:255]
        grupo_cod = codigo_novo[:2] if len(codigo_novo) >= 2 and codigo_novo[:2].isdigit() else "02"
        subgrupo_cod = codigo_novo[:4] if len(codigo_novo) >= 4 and codigo_novo[:4].isdigit() else "0202"
        novo_sp = SigtapProcedimento(
            codigo=codigo_novo,
            descricao=desc_nova,
            instrumento="BPA-I",
            grupo_codigo=grupo_cod,
            subgrupo_codigo=subgrupo_cod,
            origem_manual=True,
        )
        db.add(novo_sp)
        db.flush()
        _registrar_sigtap_cache(novo_sp)
        sigtap_criados += 1
        return novo_sp

    def _extrair_procs_da_linha(row_norm: dict) -> list[dict]:
        procs_lista = row_norm.get("_procedimentos_lista")
        if isinstance(procs_lista, list) and procs_lista:
            return procs_lista
        cod_l = "" if _eh_placeholder(row_norm.get("codigo_procedimento") or "") else (row_norm.get("codigo_procedimento") or "").strip()
        nome_l = "" if _eh_placeholder(row_norm.get("nome_procedimento") or "") else (row_norm.get("nome_procedimento") or "").strip()
        if cod_l or nome_l:
            try:
                qtd_l = max(1, int((row_norm.get("quantidade") or "1").strip()))
            except ValueError:
                qtd_l = 1
            return [{"codigo_procedimento": cod_l, "nome_procedimento": nome_l, "quantidade": qtd_l}]
        raw_exames = row_norm.get("exames_realizados") or ""
        if raw_exames and not _eh_placeholder(raw_exames):
            return _parse_procedimentos_texto(raw_exames)
        return []

    def _parse_sigtap_ids_json(raw: str | None) -> list[int]:
        if not raw:
            return []
        try:
            arr = json.loads(raw)
            if isinstance(arr, list):
                out_ids: list[int] = []
                for x in arr:
                    try:
                        xi = int(x)
                        if xi not in out_ids:
                            out_ids.append(xi)
                    except (TypeError, ValueError):
                        continue
                return out_ids
        except Exception:
            pass
        return []

    SOLIC_RANK = {"agendado": 1, "coletado": 2, "realizado": 3}
    solic_cache: dict[tuple[int, date], SolicitacaoMestre] = {}
    itens_solic_cache: dict[int, set[int]] = {}
    vagas_afetadas: set[tuple[int, date]] = set()

    filas_map: dict[str, TipoFila] = {
        tf.nome.strip().upper(): tf for tf in db.exec(select(TipoFila)).all() if tf.nome
    }
    unidades_map: dict[str, UnidadeSaude] = {
        u.nome.strip().upper(): u for u in db.exec(select(UnidadeSaude).where(UnidadeSaude.ativo == True)).all() if u.nome
    }

    from app.services.geradores import (
        gerar_exame_curto_aleatorio,
        gerar_numero_pedido_aleatorio,
        gerar_prontuario_aleatorio,
        gerar_protocolo_lab_aleatorio,
    )
    prontuarios_usados: set[str] = set()
    codigos_curtos_usados: set[str] = set()
    numeros_pedido_usados: set[str] = set()
    codigos_solic_usados: set[str] = set()
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

    pec_cidadao_cols: set[str] | None = None

    def _garantir_cols_pec(conn) -> set[str]:
        nonlocal pec_cidadao_cols
        if pec_cidadao_cols is not None:
            return pec_cidadao_cols
        from sqlalchemy import text
        try:
            rows = conn.execute(
                text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_schema IN ('public', current_schema()) AND table_name = 'tb_cidadao'"
                )
            ).all()
            pec_cidadao_cols = {str(r[0]) for r in rows}
        except Exception:
            pec_cidadao_cols = set()
        return pec_cidadao_cols

    def _buscar_pec_cidadao(cpf_val: str, cns_val: str, nome_val: str, nasc_val: date | None) -> dict | None:
        if not pec_engine:
            return None
        from sqlalchemy import text
        try:
            with pec_engine.connect() as conn:
                cols = _garantir_cols_pec(conn)
                col_faleceu = "st_faleceu" if "st_faleceu" in cols else "NULL AS st_faleceu"
                if "st_mudanca" in cols:
                    col_mudou = "st_mudanca AS st_mudou_se"
                elif "st_mudou_se" in cols:
                    col_mudou = "st_mudou_se"
                else:
                    col_mudou = "NULL AS st_mudou_se"
                sel_cols = (
                    f"co_seq_cidadao, no_cidadao, nu_cpf, nu_cns, dt_nascimento, no_mae, "
                    f"nu_telefone_celular, {col_faleceu}, {col_mudou}"
                )
                if cpf_val:
                    row = conn.execute(
                        text(f"SELECT {sel_cols} FROM tb_cidadao WHERE nu_cpf = :cpf LIMIT 1"),
                        {"cpf": cpf_val}
                    ).mappings().first()
                    if row:
                        return dict(row)
                if cns_val:
                    row = conn.execute(
                        text(f"SELECT {sel_cols} FROM tb_cidadao WHERE nu_cns = :cns LIMIT 1"),
                        {"cns": cns_val}
                    ).mappings().first()
                    if row:
                        return dict(row)
                if nome_val and nasc_val:
                    row = conn.execute(
                        text(f"SELECT {sel_cols} FROM tb_cidadao WHERE UPPER(TRIM(no_cidadao)) = :nome AND dt_nascimento = :nasc LIMIT 1"),
                        {"nome": nome_val.strip().upper(), "nasc": nasc_val}
                    ).mappings().first()
                    if row:
                        return dict(row)
                if nome_val and not nasc_val:
                    filtro_ativo = " AND COALESCE(st_ativo::text, '1') IN ('1', 'true', 't', 'TRUE')" if "st_ativo" in cols else ""
                    rows = conn.execute(
                        text(f"SELECT {sel_cols} FROM tb_cidadao WHERE UPPER(TRIM(no_cidadao)) = :nome{filtro_ativo} LIMIT 2"),
                        {"nome": nome_val.strip().upper()}
                    ).mappings().all()
                    if len(rows) == 1:
                        return dict(rows[0])
        except Exception:
            pass
        return None

    pac_cpf_cache: dict[str, Paciente] = {}
    pac_cns_cache: dict[str, Paciente] = {}
    pac_pec_cache: dict[int, Paciente] = {}
    pac_prontuario_cache: dict[str, list[Paciente]] = {}
    pac_nn_cache: dict[tuple[str, str], list[Paciente]] = {}
    pac_nasc_cache: dict[str, list[Paciente]] = {}
    pac_nome_cache: dict[str, list[Paciente]] = {}
    pac_primeiro_nome_cache: dict[str, list[Paciente]] = {}

    def _indexar_paciente_cache(p: Paciente) -> None:
        cpf_p = _limpar_cpf(_normalizar_cpf_excel(p.cpf or "", _limpar_cpf))
        cns_p = _limpar_cns(_normalizar_cns_excel(p.cns or "", _limpar_cns))
        n_sp = _norm_nome_sp(p.nome)
        pront_p = (getattr(p, "codigo_prontuario", "") or "").strip()
        if cpf_p:
            pac_cpf_cache.setdefault(cpf_p, p)
        dig_cpf_p = so_digitos(p.cpf or "")
        if dig_cpf_p:
            pac_cpf_cache.setdefault(dig_cpf_p, p)
            if len(dig_cpf_p) < 11:
                pac_cpf_cache.setdefault(dig_cpf_p.zfill(11), p)
        if cns_p:
            pac_cns_cache.setdefault(cns_p, p)
        dig_cns_p = so_digitos(p.cns or "")
        if dig_cns_p:
            pac_cns_cache.setdefault(dig_cns_p, p)
            if len(dig_cns_p) < 15:
                pac_cns_cache.setdefault(dig_cns_p.zfill(15), p)
        if p.co_seq_cidadao_pec:
            pac_pec_cache.setdefault(p.co_seq_cidadao_pec, p)
        if pront_p:
            for pr_var in {pront_p, pront_p.upper(), pront_p.lstrip("0"), so_digitos(pront_p)}:
                if pr_var:
                    lst = pac_prontuario_cache.setdefault(pr_var, [])
                    if p not in lst:
                        lst.append(p)
        if p.nascimento:
            lst = pac_nasc_cache.setdefault(str(p.nascimento), [])
            if p not in lst:
                lst.append(p)
        if n_sp and p.nascimento:
            lst = pac_nn_cache.setdefault((n_sp, str(p.nascimento)), [])
            if p not in lst:
                lst.append(p)
        if n_sp:
            lst = pac_nome_cache.setdefault(n_sp, [])
            if p not in lst:
                lst.append(p)
            toks = n_sp.split()
            if len(toks) >= 2:
                lst_p = pac_primeiro_nome_cache.setdefault(toks[0], [])
                if p not in lst_p:
                    lst_p.append(p)

    # Prioriza cidadãos ativos sincronizados com o PEC para evitar vincular fila a stubs legados/duplicados
    pacientes_existentes = sorted(
        db.exec(select(Paciente)).all(),
        key=lambda p: _prioridade_paciente_import(p, _limpar_cpf, _limpar_cns),
        reverse=True,
    )
    for p in pacientes_existentes:
        _indexar_paciente_cache(p)

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
            cand_cpf = _limpar_cpf(_normalizar_cpf_excel(cand.cpf or "", _limpar_cpf))
            cand_cns = _limpar_cns(_normalizar_cns_excel(cand.cns or "", _limpar_cns))
            if cpf_limpo_lin and cand_cpf and cand_cpf != cpf_limpo_lin:
                return False
            if cns_limpo_lin and cand_cns and cand_cns != cns_limpo_lin:
                return False
            if nasc_lin and cand.nascimento and cand.nascimento != nasc_lin:
                return False
            return True

        def _escolher_candidato_unico(cands: list[Paciente]) -> Paciente | None:
            validos = [c for c in cands if _sem_conflito_docs(c)]
            if not validos:
                return None
            if len(validos) == 1:
                return validos[0]
            # Prioriza cidadão ativo único vindo do e-SUS PEC
            ativos_pec = [
                c for c in validos
                if c.co_seq_cidadao_pec and (getattr(c, "situacao_cadastral", None) or "ativo").strip().lower() in ("ativo", "")
            ]
            if len(ativos_pec) == 1:
                return ativos_pec[0]
            com_pec = [c for c in validos if c.co_seq_cidadao_pec]
            if len(com_pec) == 1:
                return com_pec[0]
            ativos = [
                c for c in validos
                if (getattr(c, "situacao_cadastral", None) or "ativo").strip().lower() in ("ativo", "")
            ]
            if len(ativos) == 1:
                return ativos[0]
            return None

        pront_lin = (r.get("prontuario") or "").strip()

        # Cascata de busca exaustiva (evita qualquer duplicação)
        pac: Paciente | None = None
        if cpf_limpo_lin and cpf_limpo_lin in pac_cpf_cache:
            pac = pac_cpf_cache[cpf_limpo_lin]
        if not pac:
            dig_cpf_lin = so_digitos(r.get("cpf") or "")
            if dig_cpf_lin:
                if dig_cpf_lin in pac_cpf_cache:
                    pac = pac_cpf_cache[dig_cpf_lin]
                elif len(dig_cpf_lin) < 11 and dig_cpf_lin.zfill(11) in pac_cpf_cache:
                    pac = pac_cpf_cache[dig_cpf_lin.zfill(11)]
        if not pac and cns_limpo_lin and cns_limpo_lin in pac_cns_cache:
            pac = pac_cns_cache[cns_limpo_lin]
        if not pac:
            dig_cns_lin = so_digitos(r.get("cns") or "")
            if dig_cns_lin:
                if dig_cns_lin in pac_cns_cache:
                    pac = pac_cns_cache[dig_cns_lin]
                elif len(dig_cns_lin) < 15 and dig_cns_lin.zfill(15) in pac_cns_cache:
                    pac = pac_cns_cache[dig_cns_lin.zfill(15)]
        if not pac and pront_lin:
            cands_pront: list[Paciente] = []
            for pr_k in {pront_lin, pront_lin.upper(), pront_lin.lstrip("0"), so_digitos(pront_lin)}:
                if pr_k and pr_k in pac_prontuario_cache:
                    for cp in pac_prontuario_cache[pr_k]:
                        if cp not in cands_pront and _nomes_compativeis(nome, cp.nome):
                            cands_pront.append(cp)
            pac = _escolher_candidato_unico(cands_pront)
        if not pac and n_sp_lin and nasc_lin and (n_sp_lin, str(nasc_lin)) in pac_nn_cache:
            pac = _escolher_candidato_unico(pac_nn_cache[(n_sp_lin, str(nasc_lin))])
        if not pac and nome and nasc_lin:
            cands_nasc = [c for c in pac_nasc_cache.get(str(nasc_lin), []) if _nomes_compativeis(nome, c.nome)]
            pac = _escolher_candidato_unico(cands_nasc)
        if not pac and n_sp_lin:
            cands_nome = [c for c in pac_nome_cache.get(n_sp_lin, []) if _sem_conflito_docs(c)]
            pac = _escolher_candidato_unico(cands_nome)
        if not pac and n_sp_lin:
            toks_lin = n_sp_lin.split()
            if len(toks_lin) >= 2:
                cands_compat = [
                    c for c in pac_primeiro_nome_cache.get(toks_lin[0], [])
                    if _nomes_compativeis(nome, c.nome) and _sem_conflito_docs(c)
                ]
                pac = _escolher_candidato_unico(cands_compat)

        if pac is not None:
            # Paciente JÁ EXISTE no banco (prioritariamente sincronizado do PEC) — apenas sincroniza/enriquece dados faltantes
            if pac.id:
                if pac.co_seq_cidadao_pec:
                    ids_vinculados_pec.add(pac.id)
                else:
                    ids_vinculados_locais.add(pac.id)
            alt_pac = False
            if cpf_limpo_lin and not _limpar_cpf(pac.cpf):
                pac.cpf = cpf_limpo_lin
                pac_cpf_cache.setdefault(cpf_limpo_lin, pac)
                alt_pac = True
            if cns_limpo_lin and not _limpar_cns(pac.cns):
                pac.cns = cns_limpo_lin
                pac_cns_cache.setdefault(cns_limpo_lin, pac)
                alt_pac = True
            if nasc_lin and not pac.nascimento:
                pac.nascimento = nasc_lin
                alt_pac = True
            if (r.get("telefone") or "") and not pac.telefone:
                pac.telefone = (r.get("telefone") or "")[:20]
                alt_pac = True
            if alt_pac:
                db.add(pac)
        else:
            # Não encontrado no banco local -> consulta o e-SUS PEC ao vivo antes de criar novo paciente
            pec_cidadao = _buscar_pec_cidadao(cpf_limpo_lin, cns_limpo_lin, nome, nasc_lin)
            if pec_cidadao:
                co_seq = pec_cidadao.get("co_seq_cidadao")
                cpf_pec = _limpar_cpf(pec_cidadao.get("nu_cpf")) or cpf
                cns_pec = _limpar_cns(pec_cidadao.get("nu_cns")) or cns
                # Antes de inserir, verifica se o cidadão do PEC já existe no banco local por co_seq, CPF ou CNS
                if co_seq and co_seq in pac_pec_cache:
                    pac = pac_pec_cache[co_seq]
                elif cpf_pec and cpf_pec in pac_cpf_cache:
                    pac = pac_cpf_cache[cpf_pec]
                elif cns_pec and cns_pec in pac_cns_cache:
                    pac = pac_cns_cache[cns_pec]

                if pac is not None:
                    if co_seq and not pac.co_seq_cidadao_pec:
                        pac.co_seq_cidadao_pec = co_seq
                        pac_pec_cache[co_seq] = pac
                        db.add(pac)
                    if pac.id:
                        ids_vinculados_pec.add(pac.id)
                else:
                    st_f = pec_cidadao.get("st_faleceu")
                    st_m = pec_cidadao.get("st_mudou_se")
                    sit = "obito" if st_f in (1, True, "1") else ("mudanca_municipio" if st_m in (1, True, "1") else "ativo")
                    pac = Paciente(
                        nome=(pec_cidadao.get("no_cidadao") or nome)[:150],
                        cpf=cpf_pec,
                        cns=cns_pec,
                        nascimento=pec_cidadao.get("dt_nascimento") or nasc_lin,
                        nome_mae=(pec_cidadao.get("no_mae") or "")[:150],
                        telefone=(pec_cidadao.get("nu_telefone_celular") or r.get("telefone") or "")[:50],
                        co_seq_cidadao_pec=co_seq,
                        situacao_cadastral=sit,
                        codigo_prontuario=pront_lin or gerar_prontuario_aleatorio(db, usados=prontuarios_usados),
                    )
                    db.add(pac)
                    db.flush()
                    pacientes_novos += 1
                    pacientes_sincronizados_pec += 1
                    if pac.id:
                        ids_vinculados_pec.add(pac.id)
                    if not getattr(pac, "codigo_prontuario", ""):
                        pac.codigo_prontuario = pront_lin or gerar_prontuario_aleatorio(db, usados=prontuarios_usados)
                        db.add(pac)
                    _indexar_paciente_cache(pac)
            else:
                # Paciente realmente NÃO existe no banco local nem no e-SUS PEC
                chave_aviso = n_sp_lin or nome.upper()
                if not criar_pacientes_novos:
                    ignoradas += 1
                    pacientes_nao_encontrados_ignorados += 1
                    if chave_aviso not in avisos_nomes_vistos and len(avisos_pacientes_novos) < 50:
                        avisos_nomes_vistos.add(chave_aviso)
                        avisos_pacientes_novos.append({
                            "linha": i,
                            "nome": nome,
                            "prontuario": pront_lin,
                            "acao": "ignorado",
                            "motivo": "Paciente não encontrado no banco (nem no e-SUS PEC) — linha ignorada conforme configuração",
                        })
                    if len(erros) < MAX_ERROS:
                        erros.append({"linha": i, "motivo": "paciente não encontrado no banco/PEC (criação desabilitada)"})
                    continue

                pac = Paciente(
                    nome=nome, cpf=cpf, cns=cns,
                    nascimento=nasc_lin,
                    telefone=(r.get("telefone") or "")[:20],
                    codigo_prontuario=pront_lin or gerar_prontuario_aleatorio(db, usados=prontuarios_usados),
                )
                db.add(pac)
                db.flush()
                pacientes_novos += 1
                pacientes_criados_sem_pec += 1
                if chave_aviso not in avisos_nomes_vistos and len(avisos_pacientes_novos) < 50:
                    avisos_nomes_vistos.add(chave_aviso)
                    avisos_pacientes_novos.append({
                        "linha": i,
                        "nome": nome,
                        "prontuario": pront_lin,
                        "acao": "criado_sem_pec",
                        "motivo": "Paciente não encontrado no banco local nem no e-SUS PEC — criado como novo cadastro local",
                    })
                if not getattr(pac, "codigo_prontuario", ""):
                    pac.codigo_prontuario = pront_lin or gerar_prontuario_aleatorio(db, usados=prontuarios_usados)
                    db.add(pac)
                _indexar_paciente_cache(pac)

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

        # Resolução da Fila e Tipo
        tipo_u = tipo.upper()
        tf_obj = filas_map.get(tipo_u)
        eh_lab_nome = any(term in tipo_u for term in ("LAB", "SANGUE", "BIOQUIM", "ROTINA", "HIPERDIA", "GINECO", "PEDIAT", "PRÉ-NATAL", "PRE-NATAL", "CAPS"))
        if not tf_obj and tipo:
            cat_tf = "EXAME_LABORATORIAL" if eh_lab_nome else "REGULACAO_GERAL"
            tf_obj = TipoFila(codigo="", nome=tipo[:80].upper(), tipo_fila=cat_tf, ativo=True)
            db.add(tf_obj)
            db.flush()
            filas_map[tipo_u] = tf_obj
            tipos_cat[tipo_u] = cat_tf
        elif tf_obj and eh_lab_nome and getattr(tf_obj, "tipo_fila", None) != "EXAME_LABORATORIAL":
            tf_obj.tipo_fila = "EXAME_LABORATORIAL"
            db.add(tf_obj)
        fila_id = tf_obj.id if tf_obj else None
        eh_lab = bool(
            (tf_obj and tf_obj.tipo_fila == "EXAME_LABORATORIAL")
            or eh_lab_nome
        )

        # Resolução da Unidade de Saúde (RLS e integridade institucional)
        dest_raw = (r.get("destino") or r.get("unidade") or r.get("unidade_referencia") or r.get("nome_unidade") or "").strip()
        dest_u = dest_raw.upper()
        uni_obj = unidades_map.get(dest_u)
        if not uni_obj and dest_u:
            for un, u in unidades_map.items():
                if dest_u in un or un in dest_u:
                    uni_obj = u
                    break
        if not uni_obj and getattr(pac, "unidade_saude_id", None):
            uni_obj = db.get(UnidadeSaude, pac.unidade_saude_id)

        unidade_saude_id = uni_obj.id if uni_obj else None
        unidade_nome = uni_obj.nome if uni_obj else (dest_raw[:150] or "")
        unidade_cnes = getattr(uni_obj, "cnes", "") or ""

        # Mapeamento do status e data agendada
        raw_st = (r.get("status") or "").strip().lower()
        dt_agend_lin = parse_data(r.get("data_agendada") or "")
        hora_agend_lin = (r.get("hora_agendada") or "").strip()[:10]
        if raw_st in ("realizado", "recepcionado", "concluido", "concluído"):
            status = "realizado"
            status_lab = "realizado"
            status_solic: str | None = "realizado"
        elif raw_st in ("coletado",):
            status = "agendado"
            status_lab = "agendado"
            status_solic = "coletado"
        elif raw_st in ("agendado", "marcado") or (dt_agend_lin is not None and raw_st in ("desconhecido", "")):
            status = "agendado"
            status_lab = "agendado"
            status_solic = "agendado"
        elif raw_st in ("cancelado", "obito", "óbito", "desistiu"):
            status = "cancelado"
            status_lab = "cancelado"
            status_solic = "cancelado"
        else:
            status = "aguardando"
            status_lab = "na_fila"
            status_solic = None

        # Alerta cadastral para pacientes com registro de óbito ou mudança de município
        pac_sit_raw = (getattr(pac, "situacao_cadastral", "") or ("obito" if getattr(pac, "data_obito", None) else "")).lower()
        eh_inelegivel = pac_sit_raw in ("obito", "mudanca_municipio", "inativo") or bool(getattr(pac, "data_obito", None))
        tag_alerta_inelegivel = ""
        if eh_inelegivel:
            label_inelegivel = "ÓBITO" if (pac_sit_raw == "obito" or getattr(pac, "data_obito", None)) else ("MUDANÇA DE MUNICÍPIO" if pac_sit_raw == "mudanca_municipio" else "INATIVO")
            tag_alerta_inelegivel = f"[ALERTA CADASTRAL: Paciente com registro de {label_inelegivel}]"
            db.add(
                PacienteHistorico(
                    paciente_id=pac.id,
                    tipo_evento=f"ALERTA_{label_inelegivel.replace(' ', '_')}",
                    motivo=f"Alerta na importação de fila: paciente em {label_inelegivel.lower()}",
                    descricao=f"Solicitação do exame '{exame}' carregada na fila com alerta de pendência cadastral ({label_inelegivel}).",
                    origem="importacao_filas",
                    exames_baixados_qtd=0,
                    registrado_por="Importador de Filas",
                )
            )

        if tipo:
            tipos_cat[tipo.upper()] = tipos_cat.get(tipo.upper(), "")
        if cbo_raw and nome_esp:
            esps_cat[cbo_raw] = nome_esp
        if (cod and not _eh_placeholder(cod)) or (nproc and not _eh_placeholder(nproc)):
            procs_cat[(cod, (nproc or exame).upper())] = (tipo.upper(), cbo_raw, nome_esp)

        # Segregação de filas: exames laboratoriais vão exclusivamente para lab_fila_psf / lab_solic_mestre / lab_solic_itens
        # (evitando cruzamento indevido em tfd_exames_fila). Demais filas continuam em tfd_exames_fila.
        if not eh_lab:
            ja = db.exec(
                select(ExameFila).where(
                    ExameFila.paciente_id == pac.id,
                    ExameFila.exame == exame,
                    ExameFila.data_pedido == data_ped,
                    ExameFila.ativo == True,  # noqa: E712
                )
            ).first()
            if ja:
                houve_alt = False
                if ja.status != status:
                    ja.status = status
                    houve_alt = True
                if dt_agend_lin and not ja.data_agendada:
                    ja.data_agendada = dt_agend_lin
                    houve_alt = True
                if not ja.fila_id and fila_id:
                    ja.fila_id = fila_id
                    houve_alt = True
                if not ja.unidade_saude_id and unidade_saude_id:
                    ja.unidade_saude_id = unidade_saude_id
                    ja.unidade_nome = unidade_nome
                    ja.unidade_cnes = unidade_cnes
                    houve_alt = True
                if tag_alerta_inelegivel and tag_alerta_inelegivel not in (ja.observacoes or ""):
                    ja.observacoes = f"{tag_alerta_inelegivel} {ja.observacoes or ''}".strip()[:500]
                    houve_alt = True
                if houve_alt:
                    db.add(ja)
                    atualizados += 1
                else:
                    duplicados += 1
            else:
                obs_tfd_lin = (r.get("observacao") or "")
                if tag_alerta_inelegivel and tag_alerta_inelegivel not in obs_tfd_lin:
                    obs_tfd_lin = f"{tag_alerta_inelegivel} {obs_tfd_lin}".strip()
                db.add(ExameFila(
                    paciente_id=pac.id, exame=exame,
                    especialidade=tipo[:80], tipo_fila=tipo[:80],
                    fila_id=fila_id,
                    codigo_procedimento=cod[:20],
                    codigo_especialidade=cbo_raw[:10],
                    nome_especialidade=nome_esp[:120],
                    prioridade=prioridade_de(r.get("prioridade") or ""),
                    status=status, data_pedido=data_ped,
                    data_agendada=dt_agend_lin,
                    destino=(dest_raw or "")[:120],
                    unidade_saude_id=unidade_saude_id,
                    unidade_nome=unidade_nome[:150],
                    unidade_cnes=unidade_cnes[:20],
                    observacoes=obs_tfd_lin[:500],
                    codigo_curto=gerar_exame_curto_aleatorio(db, usados=codigos_curtos_usados),
                    numero_pedido=gerar_numero_pedido_aleatorio(db, usados=numeros_pedido_usados),
                    public_token=secrets.token_urlsafe(24),
                ))
                exames_novos += 1
        else:
            # Resolve procedimentos individuais de laboratório via SIGTAP (código -> nome -> criação controlada)
            procs_brutos = _extrair_procs_da_linha(r)
            procs_resolvidos: list[tuple[SigtapProcedimento, int]] = []
            ids_vistos_linha: set[int] = set()
            for p_item in procs_brutos:
                sp_res = _resolver_ou_criar_sigtap(
                    p_item.get("codigo_procedimento") or "",
                    p_item.get("nome_procedimento") or "",
                )
                if sp_res and sp_res.id and sp_res.id not in ids_vistos_linha:
                    try:
                        qtd_item = max(1, int(p_item.get("quantidade", 1)))
                    except (TypeError, ValueError):
                        qtd_item = 1
                    procs_resolvidos.append((sp_res, qtd_item))
                    ids_vistos_linha.add(sp_res.id)
                    procs_cat[(sp_res.codigo, sp_res.descricao.upper())] = (tipo.upper(), cbo_raw, nome_esp)

            novos_sigtap_ids = [sp.id for sp, _ in procs_resolvidos if sp.id]
            data_ref_lab = dt_agend_lin or data_ped
            tipo_lab_label = tipo[:80] or "EXAME_LABORATORIAL"

            cond_data_fila = (
                or_(
                    FilaPsf.data_solicitacao == data_ref_lab,
                    FilaPsf.data_agendada == dt_agend_lin,
                )
                if dt_agend_lin is not None
                else (FilaPsf.data_solicitacao == data_ref_lab)
            )
            cond_fila_match = [
                FilaPsf.tipo_fila == tipo_lab_label,
                FilaPsf.especialidade == tipo_lab_label,
            ]
            if fila_id is not None:
                cond_fila_match.insert(0, FilaPsf.fila_id == fila_id)

            ja_lab = db.exec(
                select(FilaPsf).where(
                    FilaPsf.paciente_id == pac.id,
                    cond_data_fila,
                    or_(*cond_fila_match),
                )
            ).first()

            criou_lab = False
            houve_alt_lab = False

            if ja_lab:
                ids_atuais = _parse_sigtap_ids_json(ja_lab.sigtap_ids_json)
                ids_merged = list(ids_atuais)
                for sid in novos_sigtap_ids:
                    if sid not in ids_merged:
                        ids_merged.append(sid)
                if ids_merged != ids_atuais:
                    ja_lab.sigtap_ids_json = json.dumps(ids_merged)
                    houve_alt_lab = True
                if ja_lab.status != status_lab:
                    ja_lab.status = status_lab
                    houve_alt_lab = True
                if not ja_lab.fila_id and fila_id:
                    ja_lab.fila_id = fila_id
                    houve_alt_lab = True
                if not ja_lab.unidade_saude_id and unidade_saude_id:
                    ja_lab.unidade_saude_id = unidade_saude_id
                    houve_alt_lab = True
                if dt_agend_lin and not ja_lab.data_agendada:
                    ja_lab.data_agendada = dt_agend_lin
                    ja_lab.hora_agendada = hora_agend_lin or "07:00"
                    houve_alt_lab = True
                if tag_alerta_inelegivel and tag_alerta_inelegivel not in (ja_lab.observacoes or ""):
                    ja_lab.observacoes = f"{tag_alerta_inelegivel} {ja_lab.observacoes or ''}".strip()[:500]
                    houve_alt_lab = True
                if houve_alt_lab:
                    db.add(ja_lab)
            else:
                obs_psf_lin = (r.get("observacao") or (f"Código Vivver: {r.get('codigo_pedido') or ''}" if r.get("codigo_pedido") else ""))
                if tag_alerta_inelegivel and tag_alerta_inelegivel not in obs_psf_lin:
                    obs_psf_lin = f"{tag_alerta_inelegivel} {obs_psf_lin}".strip()
                ja_lab = FilaPsf(
                    codigo_solicitacao=gerar_protocolo_lab_aleatorio(data_ref_lab, db=db, usados=codigos_solic_usados),
                    paciente_id=pac.id,
                    especialidade=tipo_lab_label,
                    tipo_fila=tipo_lab_label,
                    fila_id=fila_id,
                    unidade_psf=unidade_nome or dest_raw[:120] or tipo_lab_label or "PSF",
                    unidade_saude_id=unidade_saude_id,
                    medico_solicitante=(r.get("medico_nome") or "")[:120],
                    data_solicitacao=data_ref_lab,
                    data_pedido=data_ped,
                    data_agendada=dt_agend_lin,
                    hora_agendada=hora_agend_lin or ("07:00" if dt_agend_lin else ""),
                    status=status_lab,
                    prioridade=prioridade_de(r.get("prioridade") or ""),
                    justificativa=(r.get("justificativa") or "")[:500],
                    observacoes=obs_psf_lin[:500],
                    sigtap_ids_json=json.dumps(novos_sigtap_ids),
                )
                db.add(ja_lab)
                db.flush()
                criou_lab = True

            # Sincronização automática para SolicitacaoMestre (lab_solic_mestre) e ItemSolic (lab_solic_itens)
            deve_criar_solic = (
                status_solic in ("agendado", "coletado", "realizado")
                and (dt_agend_lin is not None or status_solic in ("coletado", "realizado"))
            )
            if deve_criar_solic:
                dt_solic_mestre = dt_agend_lin or data_ped
                if not lab_padrao_cache:
                    lab_p = db.exec(select(Laboratorio).where(Laboratorio.ativo == True)).first()  # noqa: E712
                    if not lab_p:
                        lab_p = Laboratorio(nome="Laboratório Municipal de Guapé", ativo=True)
                        db.add(lab_p)
                        db.flush()
                    lab_padrao_cache = lab_p

                chave_solic = (pac.id, dt_solic_mestre)
                solic_obj = solic_cache.get(chave_solic)
                if solic_obj is None:
                    solic_obj = db.exec(
                        select(SolicitacaoMestre).where(
                            SolicitacaoMestre.paciente_id == pac.id,
                            SolicitacaoMestre.data_agendada == dt_solic_mestre,
                            SolicitacaoMestre.status != "cancelado",
                        )
                    ).first()
                    if solic_obj is not None:
                        solic_cache[chave_solic] = solic_obj

                if solic_obj is None:
                    cod_ped = (r.get("codigo_pedido") or "").strip()
                    obs_lab = f"Agendamento Vivver #{cod_ped}" if cod_ped else "Importação XML"
                    cod_solic_lab = (getattr(ja_lab, "codigo_solicitacao", "") or "").strip() if ja_lab else ""
                    if not cod_solic_lab:
                        cod_solic_lab = gerar_protocolo_lab_aleatorio(dt_solic_mestre, db=db, usados=codigos_solic_usados)
                    solic_obj = SolicitacaoMestre(
                        codigo_solicitacao=cod_solic_lab,
                        paciente_id=pac.id,
                        data_agendada=dt_solic_mestre,
                        hora_agendada=hora_agend_lin or "07:00",
                        laboratorio_id=lab_padrao_cache.id,
                        status=status_solic or "agendado",
                        agendado_por="Importação XML",
                        origem_fila_id=ja_lab.id if ja_lab else None,
                        unidade_saude_id=unidade_saude_id,
                        medico_solicitante=(r.get("medico_nome") or "")[:150],
                        unidade_psf=(unidade_nome or dest_raw[:120] or tipo_lab_label or "PSF")[:150],
                        observacao_laboratorio=obs_lab[:500],
                        status_auditoria="aprovado" if status_solic == "realizado" else "pendente_conferencia",
                    )
                    db.add(solic_obj)
                    db.flush()
                    solic_cache[chave_solic] = solic_obj
                    itens_solic_cache[solic_obj.id] = set()
                    vagas_afetadas.add((solic_obj.laboratorio_id, solic_obj.data_agendada))
                    if not criou_lab:
                        houve_alt_lab = True
                else:
                    if solic_obj.id not in itens_solic_cache:
                        existentes_ids = db.exec(
                            select(ItemSolic.sigtap_id).where(ItemSolic.solicitacao_id == solic_obj.id)
                        ).all()
                        itens_solic_cache[solic_obj.id] = {int(x) for x in existentes_ids if x is not None}
                    alt_solic = False
                    if SOLIC_RANK.get(status_solic or "", 0) > SOLIC_RANK.get(solic_obj.status or "", 0):
                        solic_obj.status = status_solic or solic_obj.status
                        if solic_obj.status == "realizado":
                            solic_obj.status_auditoria = "aprovado"
                        alt_solic = True
                    if not solic_obj.origem_fila_id and ja_lab and ja_lab.id:
                        solic_obj.origem_fila_id = ja_lab.id
                        alt_solic = True
                    if not solic_obj.unidade_saude_id and unidade_saude_id:
                        solic_obj.unidade_saude_id = unidade_saude_id
                        alt_solic = True
                    if alt_solic:
                        db.add(solic_obj)
                        houve_alt_lab = True

                # Insere itens individuais (deduplicando por (solicitacao_id, sigtap_id))
                itens_set = itens_solic_cache.setdefault(solic_obj.id, set())
                for sp_item, qtd_item in procs_resolvidos:
                    if sp_item.id and sp_item.id not in itens_set:
                        valor_unit = round(float(sp_item.valor_sa or 0.0) + float(sp_item.valor_sp or 0.0), 2)
                        db.add(ItemSolic(
                            solicitacao_id=solic_obj.id,
                            sigtap_id=sp_item.id,
                            quantidade=qtd_item,
                            valor_unitario_aplicado=valor_unit,
                            origem_preco="sigtap_padrao",
                            status_auditoria="aprovado" if solic_obj.status == "realizado" else "pendente_conferencia",
                        ))
                        itens_set.add(sp_item.id)
                        itens_lab_novos += 1
                        houve_alt_lab = True

            if criou_lab:
                exames_novos += 1
            elif houve_alt_lab:
                atualizados += 1
            else:
                duplicados += 1

        if (i % 500) == 0:
            db.flush()

    # Sincroniza contagem de vagas_ocupadas em VagaLab para as datas afetadas (evita divergencia_contagem_vagas)
    if vagas_afetadas:
        db.flush()
        for lab_id_v, dt_v in vagas_afetadas:
            vaga = db.exec(
                select(VagaLab).where(
                    VagaLab.laboratorio_id == lab_id_v,
                    VagaLab.data == dt_v,
                )
            ).first()
            if vaga:
                real_count = db.exec(
                    select(sm_func.count(SolicitacaoMestre.id)).where(
                        SolicitacaoMestre.laboratorio_id == lab_id_v,
                        SolicitacaoMestre.data_agendada == dt_v,
                        SolicitacaoMestre.status != "cancelado",
                    )
                ).one() or 0
                if vaga.vagas_ocupadas != int(real_count):
                    vaga.vagas_ocupadas = int(real_count)
                    db.add(vaga)

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
        db.commit()
        try:
            from app.services.pec_sync import consolidar_pacientes_duplicados
            consolidar_pacientes_duplicados(db, remover_inelegiveis_sem_vinculo=False)
            db.commit()
        except Exception:
            try:
                db.rollback()
            except Exception:
                pass

    aviso_criacao = ""
    if pacientes_criados_sem_pec > 0:
        verbo = "serão criados" if simular else "foram criados"
        aviso_criacao = (
            f"Atenção: {pacientes_criados_sem_pec} paciente(s) não foram encontrados no banco local "
            f"(nem no e-SUS PEC) e {verbo} como novos cadastros sem vínculo PEC."
        )
    elif pacientes_nao_encontrados_ignorados > 0:
        aviso_criacao = (
            f"Atenção: {pacientes_nao_encontrados_ignorados} linha(s) foram ignoradas porque os pacientes "
            f"não existem no banco local/e-SUS PEC e a criação automática de novos pacientes está desativada."
        )

    return {
        "lidas": lidas,
        "pacientes_novos": pacientes_novos,
        "pacientes_vinculados_pec": len(ids_vinculados_pec),
        "pacientes_vinculados_locais": len(ids_vinculados_locais),
        "pacientes_sincronizados_pec": pacientes_sincronizados_pec,
        "pacientes_criados_sem_pec": pacientes_criados_sem_pec,
        "pacientes_nao_encontrados_ignorados": pacientes_nao_encontrados_ignorados,
        "aviso_criacao_pacientes": aviso_criacao,
        "avisos_pacientes_novos": avisos_pacientes_novos,
        "exames_novos": exames_novos,
        "atualizados": atualizados,
        "duplicados": duplicados,
        "ignoradas": ignoradas,
        "itens_lab_novos": itens_lab_novos,
        "sigtap_criados": sigtap_criados,
        "catalogo": {"tipos_novos": n_tipos, "especialidades_novas": n_esps, "procedimentos_novos": n_procs},
        "erros": erros,
    }
