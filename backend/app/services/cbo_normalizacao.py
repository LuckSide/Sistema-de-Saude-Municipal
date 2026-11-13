"""Normalização semântica/ortográfica e desduplicação de CBOs e especialidades médicas.

Trata variações comuns de digitação, acentuação, abreviações e erros ortográficos
(ex.: "médico gastrologista", "Medico Gastro-Enterologista", "gastrolojista", "cardeologista"),
unificando registros duplicados no catálogo de especialidades (`tfd_especialidades`) e
nas compatibilidades SIGTAP (`sigtap_cbos` / `sigtap_ocupacoes`).
"""

from __future__ import annotations

from difflib import SequenceMatcher
import re
import unicodedata
from typing import Optional

from sqlmodel import Session, select

from app.models.lab_exames import SigtapCbo, SigtapOcupacao
from app.models.tfd import Especialidade, ExameFila, ProcedimentoCatalogo

# (cbo_canonico, nome_canonico, radical_semantico, termos_equivalentes)
CBO_ESPECIALIDADES_CANONICAS: list[tuple[str, str, str, tuple[str, ...]]] = [
    ("225165", "Médico Gastroenterologista", "gastroenterologia", ("gastroenterolog", "gastrolog", "gastroloj", "gastro", "hepatolog")),
    ("225120", "Médico Cardiologista", "cardiologia", ("cardiolog", "cardeolog", "cardio", "cardiologista")),
    ("225125", "Médico Clínico", "clinica medica", ("clinico geral", "clinica geral", "clinica medica", "medico clinico", "clinico")),
    ("225135", "Médico Dermatologista", "dermatologia", ("dermatolog", "dermato", "dermatol")),
    ("225270", "Médico Ortopedista e Traumatologista", "ortopedia traumatologia", ("ortoped", "traumatolog", "ortopedista", "traumato")),
    ("225265", "Médico Oftalmologista", "oftalmologia", ("oftalmolog", "oftamolog", "oftalmo")),
    ("225112", "Médico Neurologista", "neurologia", ("neurolog", "neurologista", "neuroloj")),
    ("225260", "Médico Neurocirurgião", "neurocirurgia", ("neurocirurg", "neurocirurgia")),
    ("225285", "Médico Urologista", "urologia", ("urolog", "urologista", "uroloj")),
    ("225124", "Médico Pediatra", "pediatria", ("pediatr", "pediatra", "pediatria")),
    ("225250", "Médico Ginecologista e Obstetra", "ginecologia obstetricia", ("ginecolog", "gineco", "obstetr", "ginecoobst")),
    ("225155", "Médico Endocrinologista e Metabologista", "endocrinologia metabologia", ("endocrinolog", "endrocrinolog", "endocrino", "metabolog")),
    ("225133", "Médico Psiquiatra", "psiquiatria", ("psiquiatr", "psiquico", "pisiquiatr")),
    ("225225", "Médico Cirurgião Geral", "cirurgia geral", ("cirurgia geral", "cirurgiao geral", "cirurgiao")),
    ("225275", "Médico Otorrinolaringologista", "otorrinolaringologia", ("otorrinolaringolog", "otorinolaringolog", "otorrino")),
    ("225195", "Médico Reumatologista", "reumatologia", ("reumatolog", "reumato")),
    ("225180", "Médico Pneumologista", "pneumologia", ("pneumolog", "pneumo", "pnelmolog")),
    ("225103", "Médico Infectologista", "infectologia", ("infectolog", "infecto")),
    ("225109", "Médico Nefrologista", "nefrologia", ("nefrolog", "nefro")),
    ("225185", "Médico Hematologista", "hematologia", ("hematolog", "hemato")),
    ("225210", "Médico Cirurgião Cardiovascular", "cirurgia cardiovascular", ("cirurgia cardiovascular", "cirurgiao cardiovascular")),
    ("225280", "Médico Cirurgião Vascular", "cirurgia vascular", ("cirurgia vascular", "cirurgiao vascular", "vascular", "angiolog")),
    ("225148", "Médico Angiologista", "angiologia", ("angiologista", "angiologia")),
    ("225271", "Médico Mastologista", "mastologia", ("mastolog", "masto")),
    ("225122", "Médico Cancerologista / Oncologista", "oncologia", ("oncolog", "cancerolog")),
    ("225181", "Médico Geriatra", "geriatria", ("geriatr", "jeriatr", "geriatra")),
    ("225110", "Médico Alergista e Imunologista", "alergia imunologia", ("alerg", "alergolog", "imunolog")),
    ("225240", "Médico Cirurgião Pediátrico", "cirurgia pediatrica", ("cirurgia pediatrica", "cirurgiao pediatrico")),
    ("225230", "Médico Cirurgião Plástico", "cirurgia plastica", ("cirurgia plastica", "cirurgiao plastico")),
    ("225235", "Médico Coloproctologista", "coloproctologia", ("coloproctolog", "proctolog")),
    ("225320", "Médico em Radiologia e Diagnóstico por Imagem", "radiologia imagem", ("radiolog", "ultrassonograf", "diagnostico por imagem", "imagem")),
    ("225310", "Médico Patologista Clínico / Medicina Laboratorial", "patologia clinica", ("patologia clinica", "medicina laboratorial")),
    ("225305", "Médico Anatomopatologista / Citopatologista", "anatomia patologica", ("anatomia patologica", "anatomopatolog", "citopatolog")),
    ("225315", "Médico em Medicina Nuclear", "medicina nuclear", ("medicina nuclear",)),
    ("225142", "Médico da Estratégia de Saúde da Família", "medicina familia", ("estrategia saude familia", "saude familia", "familia comunidade", "psf", "esf")),
    ("225151", "Médico Anestesiologista", "anestesiologia", ("anestesiolog", "anestesista")),
    ("225140", "Médico Nutrólogo", "nutrologia", ("nutrolog", "nutrologo")),
    ("225160", "Médico Fisiatra", "fisiatria", ("fisiatr", "medicina fisica")),
]

_CBO_DESC_CANONICA: dict[str, str] = {cbo: nome for cbo, nome, _, _ in CBO_ESPECIALIDADES_CANONICAS}
_RADICAL_PARA_CBO: dict[str, str] = {rad: cbo for cbo, _, rad, _ in CBO_ESPECIALIDADES_CANONICAS}

_STOPWORDS_CBO = frozenset({
    "medico", "medica", "dr", "dra", "doutor", "doutora", "especialista", "especialidade",
    "clinico", "clinica", "em", "de", "da", "do", "das", "dos", "e", "com", "para", "por",
    "geral",
})

_SUBSTITUICOES_LEXICAS: dict[str, str] = {
    "gastrologista": "gastroenterologia",
    "gastrologia": "gastroenterologia",
    "gastrolojista": "gastroenterologia",
    "gastro": "gastroenterologia",
    "gastroenterologista": "gastroenterologia",
    "gastro-enterologista": "gastroenterologia",
    "gastro-enterologia": "gastroenterologia",
    "cardiologista": "cardiologia",
    "cardeologista": "cardiologia",
    "cardeologia": "cardiologia",
    "oftamologista": "oftalmologia",
    "oftamologia": "oftalmologia",
    "oftalmologista": "oftalmologia",
    "otorino": "otorrinolaringologia",
    "otorrino": "otorrinolaringologia",
    "otorrinolaringologista": "otorrinolaringologia",
    "otorinolaringologista": "otorrinolaringologia",
    "endrocrinologista": "endocrinologia",
    "endocrinologista": "endocrinologia",
    "ortopedista": "ortopedia",
    "traumatologista": "traumatologia",
    "dermatologista": "dermatologia",
    "urologista": "urologia",
    "urolojista": "urologia",
    "neurologista": "neurologia",
    "neurolojista": "neurologia",
    "nefrologista": "nefrologia",
    "hematologista": "hematologia",
    "pneumologista": "pneumologia",
    "reumatologista": "reumatologia",
    "infectologista": "infectologia",
    "mastologista": "mastologia",
    "proctologista": "coloproctologia",
    "coloproctologista": "coloproctologia",
    "oncologista": "oncologia",
    "cancerologista": "oncologia",
    "alergologista": "alergia",
    "alergista": "alergia",
    "imunologista": "imunologia",
    "anestesista": "anestesiologia",
    "anestesiologista": "anestesiologia",
    "radiologista": "radiologia",
    "psiquiatra": "psiquiatria",
    "pisiquiatra": "psiquiatria",
    "pediatra": "pediatria",
    "geriatra": "geriatria",
    "jeriatra": "geriatria",
    "ginecologista": "ginecologia",
    "obstetra": "obstetricia",
    "angiologista": "angiologia",
    "nutrologo": "nutrologia",
    "nutrologa": "nutrologia",
    "fisioterapeuta": "fisioterapia",
    "fonoaudiologo": "fonoaudiologia",
    "fonoaudiologa": "fonoaudiologia",
    "nutricionista": "nutricao",
    "psicologo": "psicologia",
    "psicologa": "psicologia",
}


def limpar_codigo_cbo(cbo: Optional[str]) -> str:
    """Normaliza um código CBO mantendo apenas dígitos (máx. 6 caracteres)."""
    digits = re.sub(r"\D", "", str(cbo or ""))
    return digits[:6] if digits else ""


def sanitizar_texto_cbo(texto: Optional[str]) -> str:
    """Remove acentos, pontuação e espaços excedentes em minúsculas."""
    if not texto:
        return ""
    sem_acento = unicodedata.normalize("NFKD", str(texto))
    sem_acento = "".join(c for c in sem_acento if not unicodedata.combining(c))
    limpo = re.sub(r"[^a-zA-Z0-9]+", " ", sem_acento).lower()
    return re.sub(r"\s+", " ", limpo).strip()


def normalizar_fonetica_pt(texto: Optional[str]) -> str:
    """Aplica redução fonética básica em português para absorver pequenos erros de digitação."""
    s = sanitizar_texto_cbo(texto)
    if not s:
        return ""
    s = s.replace("ph", "f").replace("y", "i").replace("w", "v")
    s = re.sub(r"qu([ei])", r"k\1", s)
    s = s.replace("ch", "x")
    s = re.sub(r"g([ei])", r"j\1", s)
    s = re.sub(r"c([ei])", r"s\1", s)
    s = re.sub(r"(ss|sc|sç|xc)", "s", s)
    s = s.replace("z", "s")
    s = re.sub(r"([a-z])\1+", r"\1", s)
    return s


def _radical_palavra(token: str) -> str:
    if token in _SUBSTITUICOES_LEXICAS:
        return _SUBSTITUICOES_LEXICAS[token]
    for suf in ("ologista", "ologia", "ojista", "ojia", "iatria", "iatra", "ista"):
        if len(token) > len(suf) + 2 and token.endswith(suf):
            if suf in ("ologista", "ologia", "ojista", "ojia"):
                return token[: -len(suf)] + "ologia"
            if suf in ("iatria", "iatra"):
                return token[: -len(suf)] + "iatria"
    return token


def chave_semantica_cbo(nome: Optional[str]) -> tuple[str, str]:
    """Retorna (chave_semantica_canonica, codigo_cbo_sugerido) para uma descrição de CBO/especialidade.

    Reconhece variações como "médico gastrologista", "Medico Gastroenterologista",
    "gastrolojista", "MEDICO EM GASTROENTEROLOGIA" como o mesmo conceito semântico.
    """
    bruto = sanitizar_texto_cbo(nome)
    if not bruto:
        return "", ""

    # 1. Tenta casar com radicais canônicos explícitos (inclui sinônimos e erros comuns)
    fonetico = normalizar_fonetica_pt(bruto)
    melhor_rad = ""
    melhor_cbo = ""
    for cbo_canon, _desc, radical, termos in CBO_ESPECIALIDADES_CANONICAS:
        for termo in termos:
            t_san = sanitizar_texto_cbo(termo)
            t_fon = normalizar_fonetica_pt(t_san)
            if t_san and (t_san in bruto or (t_fon and t_fon in fonetico)):
                melhor_rad = radical
                melhor_cbo = cbo_canon
                break
        if melhor_rad:
            break

    # Caso especial: Clínica Geral / Médico Clínico sem especialidade focal (ex: "Clinica Geral", "Medico Clinico")
    if not melhor_rad and any(x in bruto for x in ("clinica geral", "clinico geral", "clinica medica", "medico clinico")):
        return "clinica medica", "225125"

    # Fuzzy contra termos conhecidos caso haja erro ortográfico pequeno em uma palavra
    if not melhor_rad:
        palavras_raw = [p for p in bruto.split() if p and p not in _STOPWORDS_CBO and len(p) >= 5]
        melhor_score = 0.0
        for p in palavras_raw:
            p_fon = normalizar_fonetica_pt(p)
            for lex_err, lex_ok in _SUBSTITUICOES_LEXICAS.items():
                score = max(
                    SequenceMatcher(None, p, lex_err).ratio(),
                    SequenceMatcher(None, p_fon, normalizar_fonetica_pt(lex_err)).ratio(),
                )
                if score >= 0.86 and score > melhor_score:
                    melhor_score = score
                    for cbo_canon, _desc, radical, termos in CBO_ESPECIALIDADES_CANONICAS:
                        if lex_ok == radical or any(t in lex_ok for t in termos):
                            melhor_rad = radical
                            melhor_cbo = cbo_canon
                            break

    if melhor_rad:
        return melhor_rad, melhor_cbo

    # 2. Normalização lexical genérica para especialidades não-médicas ou customizadas
    tokens = [_radical_palavra(t) for t in bruto.split() if t and t not in _STOPWORDS_CBO]
    if not tokens:
        tokens = [_radical_palavra(t) for t in bruto.split() if t]
    chave = " ".join(dict.fromkeys(sorted(tokens)))
    return chave, ""


def comparar_nomes_cbo(nome_a: Optional[str], nome_b: Optional[str]) -> float:
    """Retorna pontuação de equivalência entre 0.0 e 1.0 considerando semântica, fonética e digitação."""
    sa = sanitizar_texto_cbo(nome_a)
    sb = sanitizar_texto_cbo(nome_b)
    if not sa or not sb:
        return 0.0
    if sa == sb:
        return 1.0

    ka, cbo_a = chave_semantica_cbo(sa)
    kb, cbo_b = chave_semantica_cbo(sb)
    if ka and ka == kb:
        return 1.0
    if cbo_a and cbo_b and cbo_a == cbo_b:
        return 0.98

    # Remove prefixo genérico "medico/a" antes da comparação fuzzy
    pa = " ".join(t for t in sa.split() if t not in _STOPWORDS_CBO) or sa
    pb = " ".join(t for t in sb.split() if t not in _STOPWORDS_CBO) or sb
    if pa == pb:
        return 0.97

    fa = normalizar_fonetica_pt(pa)
    fb = normalizar_fonetica_pt(pb)
    if fa and fa == fb:
        return 0.95

    return max(
        SequenceMatcher(None, pa, pb).ratio(),
        SequenceMatcher(None, fa, fb).ratio(),
    )


def especialidade_pertence_ao_cbo(
    esp_nome: str,
    esp_cbo: str,
    cbo_alvo: str,
    autorizados_cbo_desc: str = "",
) -> bool:
    """Verifica se uma especialidade corresponde ou é autorizada para o CBO informado."""
    alvo = limpar_codigo_cbo(cbo_alvo)
    if not alvo:
        return True
    cbo_item = limpar_codigo_cbo(esp_cbo)
    if cbo_item and cbo_item == alvo:
        return True

    _chave, cbo_sugerido = chave_semantica_cbo(esp_nome)
    if cbo_sugerido and cbo_sugerido == alvo:
        return True

    desc_alvo = autorizados_cbo_desc or _CBO_DESC_CANONICA.get(alvo, "")
    if desc_alvo and comparar_nomes_cbo(esp_nome, desc_alvo) >= 0.85:
        return True

    return False


def encontrar_especialidade_equivalente(
    db: Session,
    nome: str,
    codigo_cbo: str = "",
    exclude_id: Optional[int] = None,
) -> tuple[Optional[Especialidade], str]:
    """Procura especialidade/CBO já existente por código normalizado ou equivalência semântica/digitação."""
    cbo_limpo = limpar_codigo_cbo(codigo_cbo)
    todas = list(db.exec(select(Especialidade)).all())

    if cbo_limpo:
        for e in todas:
            if exclude_id is not None and e.id == exclude_id:
                continue
            if limpar_codigo_cbo(e.codigo_cbo) == cbo_limpo:
                return e, f"CBO {cbo_limpo} já cadastrado ({e.nome})."

    chave_nova, cbo_sugerido = chave_semantica_cbo(nome)
    for e in todas:
        if exclude_id is not None and e.id == exclude_id:
            continue
        cbo_existente = limpar_codigo_cbo(e.codigo_cbo)
        # Se ambos informam códigos CBO diferentes explicitamente, respeita códigos distintos
        if cbo_limpo and cbo_existente and cbo_limpo != cbo_existente:
            continue

        score = comparar_nomes_cbo(nome, e.nome)
        chave_ex, _ = chave_semantica_cbo(e.nome)
        mesmo_cbo_canonico = bool(cbo_sugerido and cbo_existente and cbo_sugerido == cbo_existente)
        if score >= 0.86 or (chave_nova and chave_nova == chave_ex) or mesmo_cbo_canonico:
            return e, f"Especialidade/CBO equivalente já cadastrada como '{e.nome}'{f' (CBO {cbo_existente})' if cbo_existente else ''}."

    return None, ""


def _melhor_chave_ordenacao_esp(e: Especialidade) -> tuple[int, int, int, int]:
    cbo = limpar_codigo_cbo(e.codigo_cbo)
    return (
        0 if e.ativo else 1,
        0 if cbo else 1,
        0 if (e.nome or "").strip()[:1].isupper() else 1,
        e.id or 999999999,
    )


def unificar_cbos_duplicados(db: Session) -> dict:
    """Identifica e unifica registros duplicados/variantes de CBOs e especialidades no banco."""
    todas = list(db.exec(select(Especialidade).order_by(Especialidade.id)).all())
    grupos: dict[str, list[Especialidade]] = {}

    for e in todas:
        cbo_norm = limpar_codigo_cbo(e.codigo_cbo)
        if cbo_norm != (e.codigo_cbo or "").strip():
            e.codigo_cbo = cbo_norm
            db.add(e)
        chave_sem, cbo_sug = chave_semantica_cbo(e.nome)
        # Se o registro tem CBO explícito diferente de outros, mantém agrupado pelo CBO;
        # se não tem CBO mas casa semanticamente com um grupo que tem, agrupa junto para unificar.
        chave_grupo = f"CBO:{cbo_norm}" if cbo_norm else (f"CBO:{cbo_sug}" if cbo_sug else f"SEM:{chave_sem or sanitizar_texto_cbo(e.nome)}")
        grupos.setdefault(chave_grupo, []).append(e)

    # Segundo passo: agrupa variações com score >= 0.88 que não possuam CBOs conflitantes distintos
    lista_grupos = list(grupos.values())
    mesclados_indices: set[int] = set()
    grupos_finais: list[list[Especialidade]] = []
    for i, grp_i in enumerate(lista_grupos):
        if i in mesclados_indices:
            continue
        atual = list(grp_i)
        cbo_i = next((limpar_codigo_cbo(x.codigo_cbo) for x in atual if limpar_codigo_cbo(x.codigo_cbo)), "")
        for j in range(i + 1, len(lista_grupos)):
            if j in mesclados_indices:
                continue
            grp_j = lista_grupos[j]
            cbo_j = next((limpar_codigo_cbo(x.codigo_cbo) for x in grp_j if limpar_codigo_cbo(x.codigo_cbo)), "")
            if cbo_i and cbo_j and cbo_i != cbo_j:
                continue
            if any(comparar_nomes_cbo(a.nome, b.nome) >= 0.88 for a in atual for b in grp_j):
                atual.extend(grp_j)
                mesclados_indices.add(j)
                if not cbo_i and cbo_j:
                    cbo_i = cbo_j
        grupos_finais.append(atual)

    especialidades_mescladas = 0
    registros_atualizados = 0

    for grp in grupos_finais:
        if len(grp) <= 1:
            continue
        grp_sorted = sorted(grp, key=_melhor_chave_ordenacao_esp)
        principal = grp_sorted[0]
        cbo_canon = limpar_codigo_cbo(principal.codigo_cbo)
        for cand in grp_sorted[1:]:
            if not cbo_canon and limpar_codigo_cbo(cand.codigo_cbo):
                cbo_canon = limpar_codigo_cbo(cand.codigo_cbo)
        if not cbo_canon:
            _, cbo_canon = chave_semantica_cbo(principal.nome)
        if cbo_canon and principal.codigo_cbo != cbo_canon:
            principal.codigo_cbo = cbo_canon
        principal.ativo = any(g.ativo for g in grp_sorted)
        db.add(principal)

        for dup in grp_sorted[1:]:
            nome_dup = (dup.nome or "").strip()
            cbo_dup = limpar_codigo_cbo(dup.codigo_cbo)
            if nome_dup:
                cond_pr = ProcedimentoCatalogo.nome_especialidade == nome_dup
                if cbo_dup:
                    cond_pr = cond_pr | (ProcedimentoCatalogo.codigo_especialidade == cbo_dup)
                procs = db.exec(select(ProcedimentoCatalogo).where(cond_pr)).all()
                for pr in procs:
                    if pr.nome_especialidade != principal.nome or (cbo_canon and pr.codigo_especialidade != cbo_canon):
                        pr.nome_especialidade = principal.nome
                        if cbo_canon:
                            pr.codigo_especialidade = cbo_canon
                        db.add(pr)
                        registros_atualizados += 1

                filas = db.exec(
                    select(ExameFila).where(
                        (ExameFila.nome_especialidade == nome_dup)
                        | (ExameFila.especialidade == nome_dup)
                    )
                ).all()
                for fx in filas:
                    fx.nome_especialidade = principal.nome
                    if sanitizar_texto_cbo(fx.especialidade) == sanitizar_texto_cbo(nome_dup):
                        fx.especialidade = principal.nome
                    if cbo_canon and not limpar_codigo_cbo(fx.codigo_especialidade):
                        fx.codigo_especialidade = cbo_canon
                    db.add(fx)
                    registros_atualizados += 1

            db.delete(dup)
            especialidades_mescladas += 1

    # Deduplicação em sigtap_cbos por (procedimento_codigo, cbo_normalizado) via projeção de tuplas + lote
    from sqlalchemy import text as _sa_text

    sigtap_cbos_removidos = 0
    vistos_sigtap: dict[tuple[str, str], tuple[int, str, str]] = {}
    ids_cbos_excluir: list[int] = []
    cbos_atualizar: list[tuple[int, str, str]] = []
    rows_cbo = db.exec(
        select(SigtapCbo.id, SigtapCbo.procedimento_codigo, SigtapCbo.cbo, SigtapCbo.descricao).order_by(SigtapCbo.id)
    ).all()
    for row_id, proc_cod_r, cbo_r, desc_r in rows_cbo:
        if not row_id:
            continue
        cbo_norm = limpar_codigo_cbo(cbo_r) or (cbo_r or "").strip()
        cod_proc = (proc_cod_r or "").strip()
        desc_s = (desc_r or "").strip()
        chave = (cod_proc, cbo_norm)
        if chave in vistos_sigtap:
            ex_id, ex_cbo, ex_desc = vistos_sigtap[chave]
            if not ex_desc and desc_s:
                vistos_sigtap[chave] = (ex_id, ex_cbo, desc_s)
                cbos_atualizar.append((ex_id, cbo_norm, desc_s[:120]))
            ids_cbos_excluir.append(int(row_id))
            sigtap_cbos_removidos += 1
        else:
            if (cbo_r or "").strip() != cbo_norm:
                cbos_atualizar.append((int(row_id), cbo_norm, desc_s[:120]))
            vistos_sigtap[chave] = (int(row_id), cbo_norm, desc_s)

    for uid_c, u_cbo, u_desc in cbos_atualizar:
        db.execute(
            _sa_text("UPDATE sigtap_cbos SET cbo = :cbo, descricao = :desc WHERE id = :id"),
            {"cbo": u_cbo, "desc": u_desc, "id": uid_c},
        )
    for ini in range(0, len(ids_cbos_excluir), 500):
        bloco = ids_cbos_excluir[ini : ini + 500]
        in_clause = ", ".join(f":d{i}" for i in range(len(bloco)))
        params = {f"d{i}": v for i, v in enumerate(bloco)}
        db.execute(_sa_text(f"DELETE FROM sigtap_cbos WHERE id IN ({in_clause})"), params)

    # Sincroniza tabela normalizada sigtap_ocupacoes
    vistos_oc: dict[str, SigtapOcupacao] = {
        limpar_codigo_cbo(o.cbo): o for o in db.exec(select(SigtapOcupacao)).all() if limpar_codigo_cbo(o.cbo)
    }
    candidatos_oc: list[tuple[str, str]] = []
    for esp in db.exec(select(Especialidade)).all():
        c = limpar_codigo_cbo(esp.codigo_cbo)
        if c and esp.nome:
            candidatos_oc.append((c, esp.nome))
    for _eid, sc_cbo, sc_desc in vistos_sigtap.values():
        c = limpar_codigo_cbo(sc_cbo)
        if c:
            candidatos_oc.append((c, sc_desc or _CBO_DESC_CANONICA.get(c, f"CBO {c}")))
    for cbo_c, nome_c, _rad, _t in CBO_ESPECIALIDADES_CANONICAS:
        candidatos_oc.append((cbo_c, nome_c))

    for cbo_cod, desc_raw in candidatos_oc:
        desc_limpa = (desc_raw or "").strip()[:150]
        if not cbo_cod or not desc_limpa:
            continue
        desc_norm = sanitizar_texto_cbo(desc_limpa)[:150]
        if cbo_cod not in vistos_oc:
            oc = SigtapOcupacao(
                cbo=cbo_cod,
                descricao=desc_limpa,
                descricao_normalizada=desc_norm,
                ativo=True,
            )
            db.add(oc)
            vistos_oc[cbo_cod] = oc
        else:
            oc = vistos_oc[cbo_cod]
            if len(desc_limpa) > len(oc.descricao or "") and not desc_limpa.startswith("CBO "):
                oc.descricao = desc_limpa
                oc.descricao_normalizada = desc_norm
                db.add(oc)

    db.commit()
    return {
        "especialidades_mescladas": especialidades_mescladas,
        "sigtap_cbos_removidos": sigtap_cbos_removidos,
        "registros_atualizados": registros_atualizados,
        "ocupacoes_total": len(vistos_oc),
    }
