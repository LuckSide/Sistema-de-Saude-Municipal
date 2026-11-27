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

from app.models.cadastros_saude import Medico
from app.models.lab_exames import SigtapCbo, SigtapOcupacao
from app.models.tfd import Especialidade, ExameFila, ProcedimentoCatalogo, TipoFila

# (cbo_canonico, nome_canonico, radical_semantico, termos_equivalentes)
# Alinhado estritamente aos códigos oficiais da Tabela Unificada SIGTAP / CBO-2002 DATASUS.
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
    ("225136", "Médico Reumatologista", "reumatologia", ("reumatolog", "reumato")),
    ("225195", "Médico Homeopata", "homeopatia", ("homeopat", "homeopata")),
    ("225127", "Médico Pneumologista", "pneumologia", ("pneumolog", "pneumo", "pnelmolog")),
    ("225103", "Médico Infectologista", "infectologia", ("infectolog", "infecto")),
    ("225109", "Médico Nefrologista", "nefrologia", ("nefrolog", "nefro")),
    ("225185", "Médico Hematologista", "hematologia", ("hematolog", "hemato")),
    ("225210", "Médico Cirurgião Cardiovascular", "cirurgia cardiovascular", ("cirurgia cardiovascular", "cirurgiao cardiovascular")),
    ("225203", "Médico em Cirurgia Vascular", "cirurgia vascular", ("cirurgia vascular", "cirurgiao vascular", "vascular")),
    ("225115", "Médico Angiologista", "angiologia", ("angiologista", "angiologia", "angiolog")),
    ("225255", "Médico Mastologista", "mastologia", ("mastolog", "masto")),
    ("225121", "Médico Oncologista Clínico", "oncologia", ("oncologista clinico", "oncologia clinica", "oncolog", "cancerolog")),
    ("225122", "Médico Cancerologista Pediátrico", "cancerologia pediatrica", ("cancerologista pediatrico", "oncologia pediatrica")),
    ("225290", "Médico Cancerologista Cirúrgico", "cancerologia cirurgica", ("cancerologista cirurgico", "cirurgia oncologica")),
    ("225180", "Médico Geriatra", "geriatria", ("geriatr", "jeriatr", "geriatra")),
    ("225110", "Médico Alergista e Imunologista", "alergia imunologia", ("alerg", "alergolog", "imunolog")),
    ("225230", "Médico Cirurgião Pediátrico", "cirurgia pediatrica", ("cirurgia pediatrica", "cirurgiao pediatrico")),
    ("225235", "Médico Cirurgião Plástico", "cirurgia plastica", ("cirurgia plastica", "cirurgiao plastico")),
    ("225240", "Médico Cirurgião Torácico", "cirurgia toracica", ("cirurgia toracica", "cirurgiao toracico")),
    ("225215", "Médico Cirurgião de Cabeça e Pescoço", "cirurgia cabeca pescoco", ("cabeca e pescoco",)),
    ("225220", "Médico Cirurgião do Aparelho Digestivo", "cirurgia aparelho digestivo", ("aparelho digestivo",)),
    ("225280", "Médico Coloproctologista", "coloproctologia", ("coloproctolog", "proctolog")),
    ("225320", "Médico em Radiologia e Diagnóstico por Imagem", "radiologia imagem", ("radiolog", "ultrassonograf", "diagnostico por imagem", "imagem")),
    ("225310", "Médico em Endoscopia", "endoscopia", ("medico em endoscopia", "endoscopista")),
    ("225335", "Médico Patologista Clínico / Medicina Laboratorial", "patologia clinica", ("patologia clinica", "patologista clinico", "medicina laboratorial")),
    ("225148", "Médico Anatomopatologista", "anatomia patologica", ("anatomia patologica", "anatomopatolog")),
    ("225305", "Médico Citopatologista", "citopatologia", ("citopatolog",)),
    ("225325", "Médico Patologista", "patologia", ("medico patologista",)),
    ("225315", "Médico em Medicina Nuclear", "medicina nuclear", ("medicina nuclear",)),
    ("225142", "Médico da Estratégia de Saúde da Família", "medicina familia", ("estrategia saude familia", "saude familia", "psf", "esf")),
    ("225130", "Médico de Família e Comunidade", "medicina familia comunidade", ("familia e comunidade",)),
    ("225170", "Médico Generalista", "medicina generalista", ("generalista",)),
    ("225151", "Médico Anestesiologista", "anestesiologia", ("anestesiolog", "anestesista")),
    ("225118", "Médico Nutrólogo", "nutrologia", ("nutrolog", "nutrologo")),
    ("225140", "Médico do Trabalho", "medicina do trabalho", ("medico do trabalho", "medicina do trabalho")),
    ("225160", "Médico Fisiatra", "fisiatria", ("fisiatr", "medicina fisica")),
]

# Códigos fictícios/trocados de versões legadas -> código oficial SIGTAP equivalente
_CBOS_OBSOLETOS_PARA_OFICIAL: dict[str, str] = {
    "225181": "225180",  # Geriatria
    "225271": "225255",  # Mastologia
    "225226": "225225",  # Pequena Cirurgia -> Cirurgia Geral
}

# Correção cirúrgica quando especialidade gravou CBO trocado em relação ao nome
_CORRECAO_ESP_NOME_CBO_INVERTIDO: dict[tuple[str, str], str] = {
    ("reumatologia", "225195"): "225136",
    ("reumatologia", "225145"): "225136",
    ("pneumologia", "225180"): "225127",
    ("geriatria", "225181"): "225180",
    ("mastologia", "225271"): "225255",
    ("cirurgia plastica", "225230"): "225235",
    ("cirurgia pediatrica", "225240"): "225230",
    ("cirurgia pediatrica", "225220"): "225230",
    ("coloproctologia", "225235"): "225280",
    ("nutrologia", "225140"): "225118",
    ("oncologia clinica", "225122"): "225121",
    ("angiologia e cirurgia vascular", "225210"): "225203",
    ("angiologia e cirurgia vascular", "225280"): "225203",
    ("pequena cirurgia", "225226"): "225225",
}

# Códigos de 5 dígitos criados quando versões anteriores removiam letras de CBOs alfanuméricos do CNES
_CBOS_TRUNCADOS_ALFANUM: dict[str, str] = {
    "51511": "515140",
    "22411": "224140",
    "22353": "223580",
    "22311": "2231F1",
    "22318": "2231A1",
    "22319": "2231A2",
    "22361": "2236F1",
    "51521": "5152C1",
    "31352": "3135D2",
}

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
    """Normaliza um código CBO preservando dígitos e sufixos alfanuméricos CNES/SUS (máx. 6 caracteres)."""
    cleaned = re.sub(r"[^A-Za-z0-9]", "", str(cbo or "")).upper()
    return cleaned[:6] if cleaned else ""


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

    # 1. Tenta casar com radicais canônicos explícitos (prioriza termo específico mais longo,
    #    ex.: "cirurgia cardiovascular" antes de "cardio" e "cirurgia plastica" antes de "cirurgiao")
    fonetico = normalizar_fonetica_pt(bruto)
    melhor_rad = ""
    melhor_cbo = ""
    melhor_tam = -1
    for cbo_canon, _desc, radical, termos in CBO_ESPECIALIDADES_CANONICAS:
        for termo in termos:
            t_san = sanitizar_texto_cbo(termo)
            t_fon = normalizar_fonetica_pt(t_san)
            if t_san and (t_san in bruto or (t_fon and t_fon in fonetico)):
                if len(t_san) > melhor_tam:
                    melhor_tam = len(t_san)
                    melhor_rad = radical
                    melhor_cbo = cbo_canon

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


def profissional_atende_cbo(
    medico: Medico,
    cbo_alvo: str,
    desc_cbo: str = "",
) -> bool:
    """Verifica se um profissional possui o CBO principal ou especialidade secundária equivalente ao CBO alvo."""
    alvo = limpar_codigo_cbo(cbo_alvo)
    if not alvo:
        return True

    cbo_med = limpar_codigo_cbo(getattr(medico, "cbo_codigo", ""))
    if cbo_med and cbo_med == alvo:
        return True

    desc_ref = (desc_cbo or _CBO_DESC_CANONICA.get(alvo, "")).strip()
    cbo_desc_med = (getattr(medico, "cbo_descricao", "") or "").strip()
    if not cbo_med and cbo_desc_med and desc_ref and comparar_nomes_cbo(cbo_desc_med, desc_ref) >= 0.88:
        return True

    partes_esp: list[str] = []
    esp_p = (getattr(medico, "especialidade", "") or "").strip()
    if esp_p:
        partes_esp.append(esp_p)
    esps_raw = (getattr(medico, "especialidades", "") or "").strip()
    if esps_raw:
        partes_esp.extend([p.strip() for p in re.split(r"[,;/|]", esps_raw) if p.strip()])

    for esp in partes_esp:
        if desc_ref and sanitizar_texto_cbo(esp) == sanitizar_texto_cbo(desc_ref):
            return True
        _chave, cbo_sug = chave_semantica_cbo(esp)
        if cbo_sug and cbo_sug == alvo:
            return True
        if desc_ref and comparar_nomes_cbo(esp, desc_ref) >= 0.90:
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
    """Identifica, corrige CBOs trocados e unifica registros duplicados mantendo profissionais intactos."""
    # Passo 0: corrige códigos fictícios/invertidos em tfd_especialidades antes do agrupamento
    todas = list(db.exec(select(Especialidade).order_by(Especialidade.id)).all())
    grupos: dict[str, list[Especialidade]] = {}

    for e in todas:
        cbo_norm = limpar_codigo_cbo(e.codigo_cbo)
        nome_san = sanitizar_texto_cbo(e.nome)
        if (nome_san, cbo_norm) in _CORRECAO_ESP_NOME_CBO_INVERTIDO:
            cbo_norm = _CORRECAO_ESP_NOME_CBO_INVERTIDO[(nome_san, cbo_norm)]
        elif cbo_norm in _CBOS_OBSOLETOS_PARA_OFICIAL:
            cbo_norm = _CBOS_OBSOLETOS_PARA_OFICIAL[cbo_norm]
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
        if len(grp_sorted) > 1:
            principal.ativo = any(g.ativo for g in grp_sorted)
            db.add(principal)

        # Uniformiza variações de caixa/equivalência semântica no catálogo de procedimentos para este CBO
        if cbo_canon and principal.nome:
            procs_cbo = db.exec(
                select(ProcedimentoCatalogo).where(ProcedimentoCatalogo.codigo_especialidade == cbo_canon)
            ).all()
            for pr in procs_cbo:
                nome_pr = (pr.nome_especialidade or "").strip()
                if nome_pr and nome_pr != principal.nome and comparar_nomes_cbo(nome_pr, principal.nome) >= 0.88:
                    pr.nome_especialidade = principal.nome
                    db.add(pr)
                    registros_atualizados += 1

        if len(grp_sorted) <= 1:
            continue

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

    # Sincroniza tabela normalizada sigtap_ocupacoes priorizando a descrição oficial de sigtap_cbos
    med_cbos_em_uso: set[str] = set()
    med_cands: list[tuple[str, str]] = []
    for med in db.exec(select(Medico)).all():
        mc = limpar_codigo_cbo(getattr(med, "cbo_codigo", ""))
        if mc:
            med_cbos_em_uso.add(mc)
            md = (getattr(med, "cbo_descricao", "") or "").strip()
            if md:
                med_cands.append((mc, md))

    oficiais_sigtap_cbo: dict[str, str] = {}
    for _eid, sc_cbo, sc_desc in vistos_sigtap.values():
        c = limpar_codigo_cbo(sc_cbo)
        desc_sc = (sc_desc or "").strip()[:150]
        if c and desc_sc and not desc_sc.startswith("CBO "):
            oficiais_sigtap_cbo.setdefault(c, desc_sc)

    vistos_oc: dict[str, SigtapOcupacao] = {}
    for o in db.exec(select(SigtapOcupacao)).all():
        oc_cod = limpar_codigo_cbo(o.cbo)
        if not oc_cod:
            continue
        # Remove ocupações de códigos fictícios (225181, 225271, 225226) ou truncados de 5 dígitos sem médico ativo
        if (oc_cod in _CBOS_OBSOLETOS_PARA_OFICIAL or oc_cod in _CBOS_TRUNCADOS_ALFANUM) and oc_cod not in oficiais_sigtap_cbo and oc_cod not in med_cbos_em_uso:
            db.delete(o)
            continue
        vistos_oc[oc_cod] = o

    # Garante descrições oficiais de sigtap_cbos prevalecendo sobre rótulos antigos incorretos
    for c_of, desc_of in oficiais_sigtap_cbo.items():
        if c_of in vistos_oc:
            oc = vistos_oc[c_of]
            if oc.descricao != desc_of or not oc.ativo:
                oc.descricao = desc_of
                oc.descricao_normalizada = sanitizar_texto_cbo(desc_of)[:150]
                oc.ativo = True
                db.add(oc)
        else:
            oc = SigtapOcupacao(
                cbo=c_of,
                descricao=desc_of,
                descricao_normalizada=sanitizar_texto_cbo(desc_of)[:150],
                ativo=True,
            )
            db.add(oc)
            vistos_oc[c_of] = oc

    candidatos_oc: list[tuple[str, str]] = []
    for cbo_c, nome_c, _rad, _t in CBO_ESPECIALIDADES_CANONICAS:
        if cbo_c not in oficiais_sigtap_cbo:
            candidatos_oc.append((cbo_c, nome_c))
    for mc, md in med_cands:
        if mc not in oficiais_sigtap_cbo:
            candidatos_oc.append((mc, md))
    for esp in db.exec(select(Especialidade)).all():
        c = limpar_codigo_cbo(esp.codigo_cbo)
        if c and esp.nome and c not in oficiais_sigtap_cbo:
            candidatos_oc.append((c, esp.nome))

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

    # Atualiza regras de tipos de serviço que apontavam para códigos fictícios/trocados (sem tocar em médicos)
    try:
        for tf in db.exec(select(TipoFila)).all():
            mudou_tf = False
            tf_nome_san = sanitizar_texto_cbo(tf.nome)
            cbo_pad = limpar_codigo_cbo(tf.cbo_padrao)
            if cbo_pad in _CBOS_OBSOLETOS_PARA_OFICIAL:
                tf.cbo_padrao = _CBOS_OBSOLETOS_PARA_OFICIAL[cbo_pad]
                mudou_tf = True
            elif cbo_pad == "225180" and "espirometria" in tf_nome_san:
                tf.cbo_padrao = "225127"
                mudou_tf = True
            elif cbo_pad == "225310" and "ex lab" in tf_nome_san:
                tf.cbo_padrao = "225335"
                mudou_tf = True
            elif cbo_pad == "225305" and "biopsia" in tf_nome_san:
                tf.cbo_padrao = "225148"
                mudou_tf = True

            raw_perm = (tf.cbos_permitidos or "").strip()
            if raw_perm.startswith("["):
                import json as _json
                try:
                    arr = _json.loads(raw_perm)
                    if isinstance(arr, list):
                        novos_arr: list[str] = []
                        for item_c in arr:
                            c_item = limpar_codigo_cbo(str(item_c))
                            if not c_item:
                                continue
                            if c_item == "225226":
                                c_item = "225225"
                            elif c_item in _CBOS_OBSOLETOS_PARA_OFICIAL:
                                c_item = _CBOS_OBSOLETOS_PARA_OFICIAL[c_item]
                            elif c_item == "225180" and "espirometria" in tf_nome_san:
                                c_item = "225127"
                            elif c_item == "225310" and "ex lab" in tf_nome_san:
                                c_item = "225335"
                            if c_item not in novos_arr:
                                novos_arr.append(c_item)
                        if novos_arr != arr:
                            tf.cbos_permitidos = _json.dumps(novos_arr)
                            mudou_tf = True
                except Exception:
                    pass
            if mudou_tf:
                db.add(tf)
                registros_atualizados += 1
    except Exception:
        pass

    db.commit()
    return {
        "especialidades_mescladas": especialidades_mescladas,
        "sigtap_cbos_removidos": sigtap_cbos_removidos,
        "registros_atualizados": registros_atualizados,
        "ocupacoes_total": len(vistos_oc),
    }
