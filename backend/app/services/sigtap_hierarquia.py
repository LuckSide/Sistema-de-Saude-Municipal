"""Serviço de Mapeamento Hierárquico do SIGTAP/DATASUS e Validação de CBOs.

Estrutura da Tabela Unificada SIGTAP (10 dígitos):
  - GG: Grupo (2 dígitos)
  - SS: Subgrupo (2 dígitos) -> Código do Subgrupo = GG + SS (4 dígitos)
  - FF: Forma de Organização (2 dígitos)
  - NNN: Sequencial (3 dígitos)
  - D: Dígito Verificador (1 dígito)

Mapeia grupos, subgrupos, formas de organização e regras de compatibilidade
com CBOs (tb_procedimento_cbo / sigtap_cbos).
"""

from sqlmodel import Session, select
from app.models.lab_exames import SigtapProcedimento, SigtapCbo


GRUPOS_SIGTAP: dict[str, str] = {
    "01": "Ações de promoção e prevenção em saúde",
    "02": "Procedimentos com finalidade diagnóstica",
    "03": "Procedimentos clínicos",
    "04": "Procedimentos cirúrgicos",
    "05": "Transplantes de órgãos, tecidos e células",
    "06": "Medicamentos",
    "07": "Órteses, próteses e materiais especiais",
    "08": "Ações complementares da atenção à saúde",
}

SUBGRUPOS_SIGTAP: dict[str, str] = {
    # Grupo 01
    "0101": "Ações coletivas / individuais em saúde e promoção",
    "0102": "Vigilância em saúde",
    # Grupo 02 - Diagnósticos
    "0201": "Coleta de material e biópsias",
    "0202": "Diagnóstico em laboratório clínico (Exames de sangue / urina / fezes)",
    "0203": "Diagnóstico por anatomia patológica e citopatologia",
    "0204": "Diagnóstico por radiologia (Raio-X)",
    "0205": "Diagnóstico por ultrassonografia (USG)",
    "0206": "Diagnóstico por tomografia computadorizada (TC)",
    "0207": "Diagnóstico por ressonância magnética (RM)",
    "0208": "Diagnóstico por medicina nuclear in vivo (Cintilografia)",
    "0209": "Diagnóstico por endoscopia e gastroenterologia",
    "0210": "Radiologia intervencionista e arteriografia",
    "0211": "Métodos diagnósticos em especialidades (Cardio, Neuro, Oftalmo, Otorrino, Uro, Pulmão)",
    # Grupo 03 - Clínicos
    "0301": "Consultas / Atendimentos / Acompanhamentos",
    "0302": "Fisioterapia e reabilitação",
    "0303": "Tratamentos clínicos ambulatoriais",
    "0304": "Tratamento em nefrologia / diálise",
    "0308": "Tratamento de quimioterapia",
    "0309": "Tratamento de radioterapia",
    # Grupo 04 - Cirúrgicos
    "0401": "Pequena cirurgia e cirurgia de pele / tecido subcutâneo",
    "0402": "Cirurgia de glândulas endócrinas",
    "0403": "Cirurgia do sistema nervoso central e periférico",
    "0404": "Cirurgia das vias aéreas superiores, cabeça e pescoço",
    "0405": "Cirurgia do aparelho da visão (Oftalmológica)",
    "0406": "Cirurgia do aparelho circulatório (Cardiovascular / Vascular)",
    "0407": "Cirurgia do aparelho digestivo e órgãos anexos",
    "0408": "Cirurgia do sistema osteomuscular e articulações (Ortopédica)",
    "0409": "Cirurgia do aparelho geniturinário",
    "0410": "Cirurgia de mama",
    "0411": "Cirurgia obstétrica",
    "0412": "Cirurgia torácica",
    "0413": "Cirurgia reparadora",
    "0414": "Cirurgia bucomaxilofacial",
    "0415": "Transplantes de órgãos e tecidos",
    "0416": "Cirurgia em oncologia",
}


def decompor_codigo_sigtap(codigo: str) -> dict:
    """Extrai grupo, subgrupo e identificadores da estrutura oficial do SIGTAP."""
    cod = "".join(c for c in (codigo or "") if c.isdigit())
    if len(cod) < 2:
        return {
            "codigo": codigo,
            "grupo_codigo": "",
            "grupo_nome": "Não identificado",
            "subgrupo_codigo": "",
            "subgrupo_nome": "Não identificado",
            "forma_organizacao": "",
            "eh_laboratorial": False,
            "eh_cirurgico": False,
            "eh_consulta": False,
        }

    grupo_cod = cod[:2]
    subgrupo_cod = cod[:4] if len(cod) >= 4 else ""
    forma_org = cod[:6] if len(cod) >= 6 else ""

    return {
        "codigo": cod,
        "grupo_codigo": grupo_cod,
        "grupo_nome": GRUPOS_SIGTAP.get(grupo_cod, "Outros grupos"),
        "subgrupo_codigo": subgrupo_cod,
        "subgrupo_nome": SUBGRUPOS_SIGTAP.get(subgrupo_cod, "Outros subgrupos"),
        "forma_organizacao": forma_org,
        "eh_laboratorial": subgrupo_cod == "0202",
        "eh_cirurgico": grupo_cod == "04",
        "eh_consulta": subgrupo_cod == "0301",
    }


def obter_filtro_sigtap_por_tipo(tipo_fila: str | None) -> dict:
    """
    Retorna regras de prefixo e filtros contextuais para busca de procedimentos
    conforme o tipo de fila selecionado na interface (baseado na estrutura do Vivver e SIGTAP).
    """
    if not tipo_fila:
        return {
            "prefixos": [],
            "excluir_prefixos": [],
            "categoria": "TODOS",
            "apenas_laboratoriais": False,
        }

    tf = tipo_fila.strip().upper()

    # 1. Filas de Exames Laboratoriais / Sangue (Vivver e APS)
    if "LAB" in tf or "SANGUE" in tf or "ROTINA" in tf or "HIPERDIA" in tf or "PEDIATRIA" in tf or "PRE-NATAL" in tf or "PRÉ-NATAL" in tf or "GINECOLOGIA" in tf or "SECRETARIA" in tf:
        return {
            "prefixos": ["0202"],  # Grupo 02, Subgrupo 02
            "excluir_prefixos": [],
            "categoria": "LABORATORIAL",
            "apenas_laboratoriais": True,
        }

    # 2. Filas de Cirurgias e Pequenas Cirurgias
    if "CIRURG" in tf:
        return {
            "prefixos": ["04", "0301010072", "0301010064"],  # Grupo 04 Cirurgias + Avaliações
            "excluir_prefixos": ["0202"],  # NUNCA traz exame de sangue
            "categoria": "CIRURGICO",
            "apenas_laboratoriais": False,
        }

    # 3. Consultas Especializadas
    if "CONSULTA" in tf or "RETORNO" in tf:
        return {
            "prefixos": ["0301"],  # Consultas médicas
            "excluir_prefixos": ["0202"],
            "categoria": "CONSULTA",
            "apenas_laboratoriais": False,
        }

    # 4. Ultrassonografia
    if "ULTRA" in tf or "USG" in tf:
        return {
            "prefixos": ["0205"],
            "excluir_prefixos": ["0202"],
            "categoria": "ULTRASSONOGRAFIA",
            "apenas_laboratoriais": False,
        }

    # 5. Tomografia
    if "TOMO" in tf or tf == "TC":
        return {
            "prefixos": ["0206"],
            "excluir_prefixos": ["0202"],
            "categoria": "TOMOGRAFIA",
            "apenas_laboratoriais": False,
        }

    # 6. Ressonância Magnética
    if "RESSON" in tf or "RNM" in tf or tf == "RM":
        return {
            "prefixos": ["0207"],
            "excluir_prefixos": ["0202"],
            "categoria": "RESSONANCIA",
            "apenas_laboratoriais": False,
        }

    # 7. Exames Cardiológicos
    if "CARDIO" in tf or "ECG" in tf or "CORACAO" in tf or "CORAÇÃO" in tf:
        return {
            "prefixos": ["021102", "020501", "021001", "0406"],
            "excluir_prefixos": ["0202"],
            "categoria": "CARDIOLOGIA",
            "apenas_laboratoriais": False,
        }

    # 8. Mamografia e Mastologia
    if "MAMO" in tf:
        return {
            "prefixos": ["020403", "0201010585"],
            "excluir_prefixos": ["0202"],
            "categoria": "MAMOGRAFIA",
            "apenas_laboratoriais": False,
        }

    # 9. Exames Neurológicos
    if "NEURO" in tf or "EEG" in tf:
        return {
            "prefixos": ["021105", "020601", "020701", "0210010010"],
            "excluir_prefixos": ["0202"],
            "categoria": "NEUROLOGIA",
            "apenas_laboratoriais": False,
        }

    # 10. Exames Otorrinolaringologia
    if "OTORRINO" in tf or "AUDIO" in tf or "BERA" in tf:
        return {
            "prefixos": ["021107"],
            "excluir_prefixos": ["0202"],
            "categoria": "OTORRINO",
            "apenas_laboratoriais": False,
        }

    # 11. Exames Gastroenterologia e Endoscopia
    if "GASTRO" in tf or "ENDOSCOPIA" in tf or "COLONO" in tf:
        return {
            "prefixos": ["0209"],
            "excluir_prefixos": ["0202"],
            "categoria": "GASTROENTEROLOGIA",
            "apenas_laboratoriais": False,
        }

    # 12. Exames Urológicos
    if "URO" in tf:
        return {
            "prefixos": ["021109", "020902"],
            "excluir_prefixos": ["0202"],
            "categoria": "UROLOGIA",
            "apenas_laboratoriais": False,
        }

    # 13. Biópsia e Punções
    if "BIOPSIA" in tf or "BIÓPSIA" in tf or "PUNCAO" in tf or "PUNÇÃO" in tf:
        return {
            "prefixos": ["0201"],
            "excluir_prefixos": ["0202"],
            "categoria": "BIOPSIA",
            "apenas_laboratoriais": False,
        }

    # 14. Cintilografia e Medicina Nuclear
    if "CINTILO" in tf:
        return {
            "prefixos": ["0208"],
            "excluir_prefixos": ["0202"],
            "categoria": "CINTILOGRAFIA",
            "apenas_laboratoriais": False,
        }

    # 15. Raio-X / Radiologia
    if "RAIO" in tf or "RX" in tf or "RADIOLOG" in tf:
        return {
            "prefixos": ["0204"],
            "excluir_prefixos": ["0202"],
            "categoria": "RADIOLOGIA",
            "apenas_laboratoriais": False,
        }

    # 16. Procedimentos Oftalmológicos
    if "OFTALMO" in tf:
        return {
            "prefixos": ["021106", "0405", "030305"],
            "excluir_prefixos": ["0202"],
            "categoria": "OFTALMOLOGIA",
            "apenas_laboratoriais": False,
        }

    # 17. Macro-categoria: Exames Especializados / Diagnósticos Gerais
    if "EXAME" in tf or "ESPECIALIZ" in tf or "DIAGN" in tf:
        return {
            "prefixos": ["02"],  # Todo o grupo 02 de exames diagnósticos
            "excluir_prefixos": ["0202"],  # Filas de exames especializados não trazem exames laboratoriais simples
            "categoria": "EXAMES_ESPECIALIZADOS",
            "apenas_laboratoriais": False,
        }

    # 18. Outros procedimentos especializados
    return {
        "prefixos": [],
        "excluir_prefixos": ["0202"],  # Filas especializadas não trazem exame de sangue
        "categoria": "ESPECIALIZADOS",
        "apenas_laboratoriais": False,
    }


import unicodedata

def _remover_acentos(texto: str) -> str:
    if not texto:
        return ""
    nfkd = unicodedata.normalize("NFKD", texto)
    return "".join(c for c in nfkd if not unicodedata.combining(c))


MAPA_ESPECIALIDADE_PREFIXOS: dict[str, list[str]] = {
    "cardio": ["021102", "020501", "021001", "0406", "0301"],
    "neuro": ["021105", "0403", "020601", "020701", "0301"],
    "oftalmo": ["021106", "0405", "030305", "0301"],
    "otorrino": ["021107", "0404", "0301"],
    "gastro": ["0209", "0407", "0201010216", "0301"],
    "digestiv": ["0209", "0407", "0301"],
    "uro": ["021109", "0409", "020902", "020502", "0301"],
    "ortop": ["0408", "0204", "0205", "0207", "020405", "0301"],
    "traumato": ["0408", "0204", "0205", "0207", "020405", "0301"],
    "pneumo": ["021108", "0204", "0206", "0412", "0301"],
    "torac": ["0412", "0204", "0206", "0301"],
    "masto": ["020403", "0410", "0201010585", "0205", "0301"],
    "gineco": ["0409", "0411", "020403", "020502", "0301"],
    "obstetr": ["0411", "020502", "0301"],
    "cirurg": ["04", "0201", "0301"],
    "plast": ["0413", "04", "0301"],
    "cabeca": ["0404", "04", "0301"],
    "bucomax": ["0414", "04", "0301"],
    "dermato": ["0401", "0201", "0301"],
    "endocrino": ["0402", "020405", "0205", "0301"],
    "vascular": ["0406", "020501", "021001", "0301"],
    "angiolog": ["0406", "020501", "021001", "0301"],
    "radio": ["0204", "0205", "0206", "0207", "0208", "0301"],
    "pediatr": ["0204", "0205", "0206", "0211", "04", "0301"],
    "clinica": ["0204", "0205", "0206", "0207", "0209", "0211", "0301"],
    "clinico": ["0204", "0205", "0206", "0207", "0209", "0211", "0301"],
    "reumato": ["020405", "0204", "0205", "0207", "0301"],
    "nefro": ["0205", "021109", "0304", "0301"],
    "oncol": ["0201", "0206", "0207", "0208", "0416", "0308", "0309", "0301"],
    "cancerol": ["0201", "0206", "0207", "0208", "0416", "0308", "0309", "0301"],
    "hematol": ["0201", "0301"],
    "infecto": ["0204", "0205", "0206", "0301"],
    "geriatr": ["0204", "0205", "0206", "0211", "0301"],
    "psiquiatr": ["021105", "0301"],
    "alerg": ["0211", "0301"],
    "imuno": ["0211", "0301"],
    "coloprocto": ["0209", "0407", "0301"],
    "proct": ["0209", "0407", "0301"],
    "nutrol": ["020405", "0205", "0301"],
    "anestesiolog": ["0301"],
    "fisiatri": ["0302", "0301"],
    "familia": ["0204", "0205", "0211", "0301"],
    "comunidade": ["0204", "0205", "0211", "0301"],
}


def expandir_aliases_busca(termo: str) -> list[str]:
    """Expande siglas e termos comuns para nomes e códigos de procedimentos SUS correspondentes."""
    if not termo:
        return []
    t = termo.strip().lower()
    mapa = {
        "ecg": ["eletrocardiograma", "eletrocardiografia", "ecg com laudo"],
        "eletrocardiograma": ["ecg", "0211020036"],
        "holter": ["holter", "sistema holter", "0211020044"],
        "mapa": ["mapa", "monitorizacao ambulatorial", "pressao arterial", "0211020052"],
        "eco": ["ecocardiograma", "ecocardiografia", "doppler"],
        "ecocardiograma": ["eco", "ecocardiografia", "doppler", "0205010040", "0205010032"],
        "ecocardiograma com doppler": ["ecocardiografia", "doppler", "0205010040", "0205010059"],
        "ergometrico": ["teste de esforco", "teste ergometrico", "0211020060"],
        "teste ergometrico": ["ergometrico", "teste de esforco", "0211020060"],
        "cateterismo": ["cateterismo", "hemodinamica", "cineangiocoronariografia", "021001"],
        "eeg": ["eletroencefalograma", "eletroencefalografia", "021105"],
        "usg": ["ultrassonografia", "ecografia", "0205"],
        "ultrassom": ["ultrassonografia", "ecografia", "0205"],
        "tc": ["tomografia", "0206"],
        "rm": ["ressonancia", "0207"],
        "rnm": ["ressonancia", "0207"],
        "rx": ["radiografia", "raio", "0204"],
        "raio-x": ["radiografia", "raio", "0204"],
        "eda": ["endoscopia", "endoscopia digestiva alta", "020901"],
        "colonoscopia": ["colono", "colonoscopia", "020901"],
        "audiometria": ["audio", "audiometria", "021107"],
        "bera": ["potencial evocado", "bera", "021107"],
        "densitometria": ["densitometria ossea", "020405"],
        "artroplastia": ["artroplastia", "protese de quadril", "protese de joelho", "0408"],
        "catarata": ["facoemulsificacao", "cirurgia de catarata", "040505"],
    }
    resultados = []
    for chave, sinonimos in mapa.items():
        if chave == t or chave in t or t in chave:
            resultados.extend(sinonimos)
    return list(dict.fromkeys(resultados))


def corresponde_especialidade_sigtap(codigo: str, nome_proc: str, especialidade_filtro: str, subgrupo_nome: str = "") -> bool:
    """Verifica se um procedimento SIGTAP corresponde contextualmente à especialidade selecionada."""
    if not especialidade_filtro:
        return True

    cod_str = str(codigo or "").strip()
    # 1. Qualquer consulta médica (0301) é compatível com qualquer especialidade médica
    if cod_str.startswith("0301"):
        return True

    ef = _remover_acentos(especialidade_filtro).strip().lower()
    sn = _remover_acentos(subgrupo_nome or "").strip().lower()
    np = _remover_acentos(nome_proc or "").strip().lower()

    # Se o nome da especialidade ou CBO bate diretamente no subgrupo ou descrição
    if ef in sn or ef in np:
        return True

    # Verifica mapeamento semântico de especialidades
    for chave, prefixos in MAPA_ESPECIALIDADE_PREFIXOS.items():
        if chave in ef:
            if any(cod_str.startswith(p) for p in prefixos):
                return True
            if chave in sn or chave in np:
                return True

    # Se a especialidade for clínica geral / medicina de família / geriatria / pediatria (ambulatorial geral)
    # e o procedimento for um método diagnóstico geral do grupo 02 (não laboratorial):
    if any(k in ef for k in ("clinica", "geriatr", "familia", "comunidade")) and cod_str.startswith("02") and not cod_str.startswith("0202"):
        return True

    return False


def validar_cbo_procedimento(
    db: Session,
    codigo_procedimento: str,
    cbo_profissional: str | None = None,
    medico_nome: str | None = None,
    tipo_fila: str | None = None,
) -> dict:
    """
    Analisa se o procedimento exige CBO restrito conforme o SIGTAP e se o
    profissional informado possui o CBO compatível.

    Retorna status de compatibilidade, CBOs autorizados e aviso orientativo,
    sempre garantindo o uso do Médico da Unidade / Responsável Técnico
    para máxima flexibilidade na atenção primária.
    """
    cod_limpo = "".join(c for c in (codigo_procedimento or "") if c.isdigit())
    cbo_limpo = "".join(c for c in (cbo_profissional or "") if c.isdigit() or c.isalpha()).upper()
    nome_med = (medico_nome or "").strip()

    info_sigtap = decompor_codigo_sigtap(cod_limpo)
    proc_obj = db.exec(select(SigtapProcedimento).where(SigtapProcedimento.codigo == cod_limpo)).first()
    nome_proc = proc_obj.descricao if proc_obj else ""

    # 1. Médico da Unidade / Responsável Técnico: sempre aceito com flexibilidade total
    eh_resp_tecnico = (
        "RESPONSÁVEL TÉCNICO" in nome_med.upper()
        or "RESPONSAVEL TECNICO" in nome_med.upper()
        or "MÉDICO DA UNIDADE" in nome_med.upper()
        or "MEDICO DA UNIDADE" in nome_med.upper()
        or cbo_limpo in ("225125", "225142", "225124", "225130")  # Clínica Médica / Saúde da Família / Clínico Geral
    )

    # 2. Exames Laboratoriais (Subgrupo 0202): prescrição na atenção primária não tem bloqueio de CBO estrito
    if info_sigtap["eh_laboratorial"] or (tipo_fila and "LAB" in tipo_fila.upper()):
        return {
            "codigo_procedimento": cod_limpo,
            "nome_procedimento": nome_proc,
            "hierarquia": info_sigtap,
            "exige_cbo_estrito": False,
            "cbo_profissional": cbo_limpo,
            "compativel": True,
            "motivo": "Exame laboratorial prescrito na atenção primária. Execução ambulatorial com apoio de laboratório.",
            "alerta": None,
            "permite_responsavel_tecnico": True,
            "cbos_autorizados": [],
        }

    # 3. Procedimentos gerais de atenção primária ou promoção
    if info_sigtap["grupo_codigo"] == "01" or cod_limpo.startswith("0301010064"):
        return {
            "codigo_procedimento": cod_limpo,
            "nome_procedimento": nome_proc,
            "hierarquia": info_sigtap,
            "exige_cbo_estrito": False,
            "cbo_profissional": cbo_limpo,
            "compativel": True,
            "motivo": "Procedimento de atenção primária / saúde básica. Compatível com médicos da rede municipal.",
            "alerta": None,
            "permite_responsavel_tecnico": True,
            "cbos_autorizados": [],
        }

    # 4. Busca CBOs oficiais no SIGTAP (sigtap_cbos)
    cbos_db = db.exec(select(SigtapCbo).where(SigtapCbo.procedimento_codigo == cod_limpo)).all()
    cbos_permitidos = [c.cbo for c in cbos_db]

    # Se o SIGTAP não tem CBOs específicos cadastrados para este procedimento
    if not cbos_permitidos:
        return {
            "codigo_procedimento": cod_limpo,
            "nome_procedimento": nome_proc,
            "hierarquia": info_sigtap,
            "exige_cbo_estrito": False,
            "cbo_profissional": cbo_limpo,
            "compativel": True,
            "motivo": "Procedimento sem amarrações restritivas de CBO fechado na tabela SIGTAP.",
            "alerta": None,
            "permite_responsavel_tecnico": True,
            "cbos_autorizados": [],
        }

    # Lista formatada de todos os CBOs autorizados
    cbos_formatados = [{"cbo": c.cbo, "descricao": c.descricao} for c in cbos_db]

    # Se profissional tem o CBO exato
    if cbo_limpo and cbo_limpo in cbos_permitidos:
        return {
            "codigo_procedimento": cod_limpo,
            "nome_procedimento": nome_proc,
            "hierarquia": info_sigtap,
            "exige_cbo_estrito": True,
            "cbo_profissional": cbo_limpo,
            "compativel": True,
            "motivo": "CBO do profissional perfeitamente compatível com o procedimento conforme o SIGTAP.",
            "alerta": None,
            "permite_responsavel_tecnico": True,
            "cbos_autorizados": cbos_formatados,
        }

    # Se bate a família médica de 4 dígitos (ex: 2251 Médicos clínicos, 2252 Médicos cirurgiões)
    familia_prof = cbo_limpo[:4] if len(cbo_limpo) >= 4 else ""
    familias_permitidas = {c[:4] for c in cbos_permitidos}
    if familia_prof and familia_prof in familias_permitidas:
        return {
            "codigo_procedimento": cod_limpo,
            "nome_procedimento": nome_proc,
            "hierarquia": info_sigtap,
            "exige_cbo_estrito": True,
            "cbo_profissional": cbo_limpo,
            "compativel": True,
            "motivo": f"CBO da mesma família médica ({familia_prof}) autorizada no SIGTAP.",
            "alerta": None,
            "permite_responsavel_tecnico": True,
            "cbos_autorizados": cbos_formatados,
        }

    # Se é o Responsável Técnico da Unidade, permite com aviso orientativo
    if eh_resp_tecnico:
        return {
            "codigo_procedimento": cod_limpo,
            "nome_procedimento": nome_proc,
            "hierarquia": info_sigtap,
            "exige_cbo_estrito": True,
            "cbo_profissional": cbo_limpo,
            "compativel": True,
            "motivo": "Procedimento especializado com autorização por Médico da Unidade / Responsável Técnico.",
            "alerta": "Procedimento especializado requisitado por Responsável Técnico da Unidade.",
            "permite_responsavel_tecnico": True,
            "cbos_autorizados": cbos_formatados,
        }

    # Divergência de CBO: não bateu e não é Responsável Técnico
    primeiros_cbos_str = ", ".join(f"{c['cbo']} ({c['descricao']})" for c in cbos_formatados[:3])
    alerta_msg = (
        f"O profissional selecionado possui CBO {cbo_limpo}, divergente dos CBOs requeridos no SIGTAP "
        f"para este procedimento ({primeiros_cbos_str}...). "
        f"Você pode selecionar o profissional adequado ou utilizar o 'Médico da Unidade / Responsável Técnico'."
    )
    return {
        "codigo_procedimento": cod_limpo,
        "nome_procedimento": nome_proc,
        "hierarquia": info_sigtap,
        "exige_cbo_estrito": True,
        "cbo_profissional": cbo_limpo,
        "compativel": False,
        "motivo": "CBO do profissional não está listado na tabela SIGTAP para este procedimento.",
        "alerta": alerta_msg,
        "permite_responsavel_tecnico": True,
        "cbos_autorizados": cbos_formatados,
    }


ESPECIALIDADES_PADRAO = [
    {"codigo_cbo": "225120", "nome": "Cardiologia"},
    {"codigo_cbo": "225225", "nome": "Cirurgia Geral"},
    {"codigo_cbo": "225125", "nome": "Clínica Médica"},
    {"codigo_cbo": "225135", "nome": "Dermatologia"},
    {"codigo_cbo": "225155", "nome": "Endocrinologia e Metabologia"},
    {"codigo_cbo": "225165", "nome": "Gastroenterologia"},
    {"codigo_cbo": "225250", "nome": "Ginecologia e Obstetrícia"},
    {"codigo_cbo": "225270", "nome": "Ortopedia e Traumatologia"},
    {"codigo_cbo": "225275", "nome": "Otorrinolaringologia"},
    {"codigo_cbo": "225124", "nome": "Pediatria"},
    {"codigo_cbo": "225112", "nome": "Neurologia"},
    {"codigo_cbo": "225260", "nome": "Neurocirurgia"},
    {"codigo_cbo": "225265", "nome": "Oftalmologia"},
    {"codigo_cbo": "225180", "nome": "Pneumologia"},
    {"codigo_cbo": "225133", "nome": "Psiquiatria"},
    {"codigo_cbo": "225320", "nome": "Radiologia e Diagnóstico por Imagem"},
    {"codigo_cbo": "225195", "nome": "Reumatologia"},
    {"codigo_cbo": "225285", "nome": "Urologia"},
    {"codigo_cbo": "225210", "nome": "Angiologia e Cirurgia Vascular"},
    {"codigo_cbo": "225109", "nome": "Nefrologia"},
    {"codigo_cbo": "225181", "nome": "Geriatria"},
    {"codigo_cbo": "225103", "nome": "Infectologia"},
    {"codigo_cbo": "225122", "nome": "Oncologia Clínica"},
    {"codigo_cbo": "225185", "nome": "Hematologia e Hemoterapia"},
    {"codigo_cbo": "225142", "nome": "Medicina de Família e Comunidade"},
    {"codigo_cbo": "225160", "nome": "Fisiatria e Medicina Física"},
    {"codigo_cbo": "225271", "nome": "Mastologia"},
    {"codigo_cbo": "225310", "nome": "Patologia Clínica / Medicina Laboratorial"},
    {"codigo_cbo": "225305", "nome": "Anatomia Patológica e Citopatologia"},
    {"codigo_cbo": "225315", "nome": "Medicina Nuclear"},
    {"codigo_cbo": "225230", "nome": "Cirurgia Plástica"},
    {"codigo_cbo": "225240", "nome": "Cirurgia Pediátrica"},
    {"codigo_cbo": "225215", "nome": "Cirurgia Cardiovascular"},
    {"codigo_cbo": "225235", "nome": "Coloproctologia"},
    {"codigo_cbo": "225110", "nome": "Alergia e Imunologia"},
    {"codigo_cbo": "225151", "nome": "Anestesiologia"},
    {"codigo_cbo": "225140", "nome": "Nutrologia"},
    {"codigo_cbo": "225226", "nome": "Pequena Cirurgia"},
]

MAPA_TIPO_ESPECIALIDADE: dict[str, tuple[str, str]] = {
    "ULTRASSONOGRAFIA": ("Ultrassonografia / Radiologia", "225320"),
    "TOMOGRAFIA": ("Radiologia e Diagnóstico por Imagem", "225320"),
    "RESSONÂNCIA MAGNÉTICA": ("Radiologia e Diagnóstico por Imagem", "225320"),
    "EXAMES CARDIOLOGICOS": ("Cardiologia", "225120"),
    "EXAMES NEUROLOGICOS": ("Neurologia", "225112"),
    "EXAMES OTORRINOLARINGOLOGIA": ("Otorrinolaringologia", "225275"),
    "EXAMES UROLOGICOS": ("Urologia", "225285"),
    "EXAMES GASTROENTEROLOGIA": ("Gastroenterologia", "225165"),
    "PROCEDIMENTOS OFTALMOLOGICOS": ("Oftalmologia", "225265"),
    "CIRURGIAS": ("Cirurgia Geral", "225225"),
    "AVALIAÇÃO CIRURGIA": ("Cirurgia Geral", "225225"),
    "PEQUENA CIRURGIA": ("Cirurgia Geral", "225225"),
    "MAMOGRAFIA E MASTOLOGIA": ("Mastologia", "225271"),
    "DENSITOMETRIA OSSEA": ("Radiologia e Diagnóstico por Imagem", "225320"),
    "ESPIROMETRIA": ("Pneumologia", "225180"),
    "BIOPSIA": ("Anatomia Patológica", "225305"),
    "CINTILOGRAFIA": ("Medicina Nuclear", "225315"),
    "EXAME RADIOLOGICO CONTRASTADO E TFD": ("Radiologia e Diagnóstico por Imagem", "225320"),
    "EX. LAB. GINECOLOGIA": ("Patologia Clínica / Medicina Laboratorial", "225310"),
    "EX. LAB. HIPERDIA": ("Patologia Clínica / Medicina Laboratorial", "225310"),
    "EX. LAB. PEDIATRIA": ("Patologia Clínica / Medicina Laboratorial", "225310"),
    "EX. LAB. PRÉ-NATAL": ("Patologia Clínica / Medicina Laboratorial", "225310"),
    "EX. LAB. PSF ROTINA": ("Patologia Clínica / Medicina Laboratorial", "225310"),
    "EX. LAB. SECRETARIA": ("Patologia Clínica / Medicina Laboratorial", "225310"),
    "CONSULTAS ESPECIALIZADAS": ("Clínica Médica / Especializada", "225125"),
    "RETORNO CONSULTA ESPECIALIZADA": ("Clínica Médica / Especializada", "225125"),
}

TIPOS_SERVICO_VIVVER: list[dict] = [
    {"id": 22, "nome": "AVALIAÇÃO CIRURGIA", "sigla": "AVPC", "especializada": True, "cirurgico": "N"},
    {"id": 48, "nome": "BIOPSIA", "sigla": "BIO", "especializada": True, "cirurgico": "N"},
    {"id": 36, "nome": "CINTILOGRAFIA", "sigla": "CINT", "especializada": True, "cirurgico": "N"},
    {"id": 9, "nome": "CIRURGIAS", "sigla": "CIR", "especializada": True, "cirurgico": "S"},
    {"id": 2, "nome": "CONSULTAS ESPECIALIZADAS", "sigla": "CES", "especializada": True, "cirurgico": "N"},
    {"id": 39, "nome": "DENSITOMETRIA OSSEA", "sigla": "DEOS", "especializada": True, "cirurgico": "N"},
    {"id": 42, "nome": "ESPIROMETRIA", "sigla": "ESPM", "especializada": True, "cirurgico": "N"},
    {"id": 47, "nome": "EXAME RADIOLOGICO CONTRASTADO E TFD", "sigla": "RXCTS", "especializada": True, "cirurgico": "N"},
    {"id": 35, "nome": "EXAMES CARDIOLOGICOS", "sigla": "CARD", "especializada": True, "cirurgico": "N"},
    {"id": 41, "nome": "EXAMES GASTROENTEROLOGIA", "sigla": "EXGAS", "especializada": True, "cirurgico": "N"},
    {"id": 37, "nome": "EXAMES NEUROLOGICOS", "sigla": "NEU", "especializada": True, "cirurgico": "N"},
    {"id": 38, "nome": "EXAMES OTORRINOLARINGOLOGIA", "sigla": "ORL", "especializada": True, "cirurgico": "N"},
    {"id": 40, "nome": "EXAMES UROLOGICOS", "sigla": "EXURO", "especializada": True, "cirurgico": "N"},
    {"id": 28, "nome": "EX. LAB. GINECOLOGIA", "sigla": "EXGO", "especializada": False, "cirurgico": "N"},
    {"id": 26, "nome": "EX. LAB. HIPERDIA", "sigla": "EXHD", "especializada": False, "cirurgico": "N"},
    {"id": 27, "nome": "EX. LAB. PEDIATRIA", "sigla": "EXPED", "especializada": False, "cirurgico": "N"},
    {"id": 44, "nome": "EX. LAB. PRÉ-NATAL", "sigla": "EXPN", "especializada": False, "cirurgico": "N"},
    {"id": 25, "nome": "EX. LAB. PSF ROTINA", "sigla": "EXPSF", "especializada": False, "cirurgico": "N"},
    {"id": 29, "nome": "EX. LAB. SECRETARIA", "sigla": "EXSEC", "especializada": False, "cirurgico": "N"},
    {"id": 33, "nome": "MAMOGRAFIA E MASTOLOGIA", "sigla": "MAMO", "especializada": False, "cirurgico": "N"},
    {"id": 23, "nome": "PEQUENA CIRURGIA", "sigla": "PCIR", "especializada": True, "cirurgico": "S"},
    {"id": 43, "nome": "PROCEDIMENTOS OFTALMOLOGICOS", "sigla": "POF", "especializada": True, "cirurgico": "N"},
    {"id": 32, "nome": "RESSONÂNCIA MAGNÉTICA", "sigla": "RNM", "especializada": False, "cirurgico": "N"},
    {"id": 30, "nome": "RETORNO CONSULTA ESPECIALIZADA", "sigla": "RCES", "especializada": True, "cirurgico": "N"},
    {"id": 34, "nome": "TOMOGRAFIA", "sigla": "TOMO", "especializada": False, "cirurgico": "N"},
    {"id": 31, "nome": "ULTRASSONOGRAFIA", "sigla": "USG", "especializada": True, "cirurgico": "N"},
]

MAPA_TIPO_SIGLA: dict[str, str] = {t["nome"]: t["sigla"] for t in TIPOS_SERVICO_VIVVER}
MAPA_SIGLA_TIPO: dict[str, str] = {t["sigla"]: t["nome"] for t in TIPOS_SERVICO_VIVVER}


def normalizar_tipo_fila(tipo: str | None) -> tuple[str, str]:
    """
    Retorna a tupla (tipo_canonico, sigla) a partir de qualquer termo, sigla ou variante.
    Ex: 'USG' -> ('ULTRASSONOGRAFIA', 'USG')
        'TC' -> ('TOMOGRAFIA', 'TOMO')
        'Cardiologia' -> ('EXAMES CARDIOLOGICOS', 'CARD')
    """
    if not tipo:
        return ("", "")
    t = _remover_acentos(tipo).strip().upper()
    if t in MAPA_SIGLA_TIPO:
        nome_c = MAPA_SIGLA_TIPO[t]
        return (nome_c, t)

    sinonimos: dict[str, tuple[str, str]] = {
        "RETORNO CONSULTA ESPECIALIZADA": ("RETORNO CONSULTA ESPECIALIZADA", "RCES"),
        "RETORNO": ("RETORNO CONSULTA ESPECIALIZADA", "RCES"),
        "RCES": ("RETORNO CONSULTA ESPECIALIZADA", "RCES"),
        "TC": ("TOMOGRAFIA", "TOMO"),
        "RM": ("RESSONÂNCIA MAGNÉTICA", "RNM"),
        "RNM": ("RESSONÂNCIA MAGNÉTICA", "RNM"),
        "RESSONANCIA": ("RESSONÂNCIA MAGNÉTICA", "RNM"),
        "RESSONANCIA MAGNETICA": ("RESSONÂNCIA MAGNÉTICA", "RNM"),
        "USG": ("ULTRASSONOGRAFIA", "USG"),
        "ULTRA": ("ULTRASSONOGRAFIA", "USG"),
        "ULTRASSOM": ("ULTRASSONOGRAFIA", "USG"),
        "ULTRASSONOGRAFIA": ("ULTRASSONOGRAFIA", "USG"),
        "TOMO": ("TOMOGRAFIA", "TOMO"),
        "TOMOGRAFIA": ("TOMOGRAFIA", "TOMO"),
        "CARD": ("EXAMES CARDIOLOGICOS", "CARD"),
        "CARDIO": ("EXAMES CARDIOLOGICOS", "CARD"),
        "CARDIOLOGIA": ("EXAMES CARDIOLOGICOS", "CARD"),
        "EXAMES CARDIOLOGICOS": ("EXAMES CARDIOLOGICOS", "CARD"),
        "MAMO": ("MAMOGRAFIA E MASTOLOGIA", "MAMO"),
        "MASTO": ("MAMOGRAFIA E MASTOLOGIA", "MAMO"),
        "MAMOGRAFIA": ("MAMOGRAFIA E MASTOLOGIA", "MAMO"),
        "MAMOGRAFIA E MASTOLOGIA": ("MAMOGRAFIA E MASTOLOGIA", "MAMO"),
        "BIO": ("BIOPSIA", "BIO"),
        "BIOPSIA": ("BIOPSIA", "BIO"),
        "CIR": ("CIRURGIAS", "CIR"),
        "CIRURGIA": ("CIRURGIAS", "CIR"),
        "CIRURGIAS": ("CIRURGIAS", "CIR"),
        "CIRURGIAS ESPECIALIZADAS": ("CIRURGIAS", "CIR"),
        "PCIR": ("PEQUENA CIRURGIA", "PCIR"),
        "PEQUENA CIRURGIA": ("PEQUENA CIRURGIA", "PCIR"),
        "AVPC": ("AVALIAÇÃO CIRURGIA", "AVPC"),
        "AVALIACAO CIRURGIA": ("AVALIAÇÃO CIRURGIA", "AVPC"),
        "EXAMES ESPECIALIZADOS": ("EXAMES ESPECIALIZADOS", ""),
        "CES": ("CONSULTAS ESPECIALIZADAS", "CES"),
        "CONSULTA": ("CONSULTAS ESPECIALIZADAS", "CES"),
        "CONSULTAS": ("CONSULTAS ESPECIALIZADAS", "CES"),
        "CONSULTAS ESPECIALIZADAS": ("CONSULTAS ESPECIALIZADAS", "CES"),
        "DEOS": ("DENSITOMETRIA OSSEA", "DEOS"),
        "DENSITOMETRIA": ("DENSITOMETRIA OSSEA", "DEOS"),
        "DENSITOMETRIA OSSEA": ("DENSITOMETRIA OSSEA", "DEOS"),
        "ESPM": ("ESPIROMETRIA", "ESPM"),
        "ESPIROMETRIA": ("ESPIROMETRIA", "ESPM"),
        "RX": ("EXAME RADIOLOGICO CONTRASTADO E TFD", "RXCTS"),
        "RAIO-X": ("EXAME RADIOLOGICO CONTRASTADO E TFD", "RXCTS"),
        "RAIO X": ("EXAME RADIOLOGICO CONTRASTADO E TFD", "RXCTS"),
        "RXCTS": ("EXAME RADIOLOGICO CONTRASTADO E TFD", "RXCTS"),
        "EXAME RADIOLOGICO CONTRASTADO E TFD": ("EXAME RADIOLOGICO CONTRASTADO E TFD", "RXCTS"),
        "CINT": ("CINTILOGRAFIA", "CINT"),
        "CINTILOGRAFIA": ("CINTILOGRAFIA", "CINT"),
        "EXGAS": ("EXAMES GASTROENTEROLOGIA", "EXGAS"),
        "GASTRO": ("EXAMES GASTROENTEROLOGIA", "EXGAS"),
        "ENDOSCOPIA": ("EXAMES GASTROENTEROLOGIA", "EXGAS"),
        "EXAMES GASTROENTEROLOGIA": ("EXAMES GASTROENTEROLOGIA", "EXGAS"),
        "NEU": ("EXAMES NEUROLOGICOS", "NEU"),
        "NEURO": ("EXAMES NEUROLOGICOS", "NEU"),
        "NEUROLOGIA": ("EXAMES NEUROLOGICOS", "NEU"),
        "EXAMES NEUROLOGICOS": ("EXAMES NEUROLOGICOS", "NEU"),
        "ORL": ("EXAMES OTORRINOLARINGOLOGIA", "ORL"),
        "OTORRINO": ("EXAMES OTORRINOLARINGOLOGIA", "ORL"),
        "AUDIOMETRIA": ("EXAMES OTORRINOLARINGOLOGIA", "ORL"),
        "EXAMES OTORRINOLARINGOLOGIA": ("EXAMES OTORRINOLARINGOLOGIA", "ORL"),
        "EXURO": ("EXAMES UROLOGICOS", "EXURO"),
        "URO": ("EXAMES UROLOGICOS", "EXURO"),
        "UROLOGIA": ("EXAMES UROLOGICOS", "EXURO"),
        "EXAMES UROLOGICOS": ("EXAMES UROLOGICOS", "EXURO"),
        "POF": ("PROCEDIMENTOS OFTALMOLOGICOS", "POF"),
        "OFTALMO": ("PROCEDIMENTOS OFTALMOLOGICOS", "POF"),
        "OFTALMOLOGIA": ("PROCEDIMENTOS OFTALMOLOGICOS", "POF"),
        "PROCEDIMENTOS OFTALMOLOGICOS": ("PROCEDIMENTOS OFTALMOLOGICOS", "POF"),
        "EX. LAB. GINECOLOGIA": ("EX. LAB. GINECOLOGIA", "EXGO"),
        "EX. LAB. HIPERDIA": ("EX. LAB. HIPERDIA", "EXHD"),
        "EX. LAB. PEDIATRIA": ("EX. LAB. PEDIATRIA", "EXPED"),
        "EX. LAB. PRE-NATAL": ("EX. LAB. PRÉ-NATAL", "EXPN"),
        "EX. LAB. PSF ROTINA": ("EX. LAB. PSF ROTINA", "EXPSF"),
        "EX. LAB. SECRETARIA": ("EX. LAB. SECRETARIA", "EXSEC"),
    }
    if t in sinonimos:
        return sinonimos[t]
    for nome_p, sigla_p in MAPA_TIPO_SIGLA.items():
        if _remover_acentos(nome_p).upper() == t:
            return (nome_p, sigla_p)
    # Match por substring somente para termos não ambíguos (>= 4 caracteres), evitando siglas curtas ("RM", "TC", "RX")
    for k, v in sinonimos.items():
        if len(k) >= 4 and (k in t or t in k):
            return v
    return (tipo, "")


def seed_especialidades(db: Session) -> int:
    """Garante que a tabela tfd_especialidades contenha todas as especialidades médicas padrão."""
    from app.models.tfd import Especialidade

    existentes = {e.nome.strip().upper(): e for e in db.exec(select(Especialidade)).all()}
    cbos_existentes = {e.codigo_cbo.strip() for e in existentes.values() if e.codigo_cbo}

    inseridos = 0
    for esp in ESPECIALIDADES_PADRAO:
        nome_norm = esp["nome"].strip().upper()
        if nome_norm not in existentes and esp["codigo_cbo"] not in cbos_existentes:
            db.add(Especialidade(
                nome=esp["nome"],
                codigo_cbo=esp["codigo_cbo"],
                ativo=True,
            ))
            cbos_existentes.add(esp["codigo_cbo"])
            inseridos += 1

    if inseridos:
        db.commit()
    return inseridos


def seed_vivver_procedimentos(db: Session, caminho_csv: str | None = None) -> dict:
    """
    Importa procedimentos categorizados a partir das exportações do sistema Vivver
    para alimentar o catálogo dinâmico de procedimentos e tipos de fila, cruzando
    com os dados oficiais do SIGTAP (códigos, CBOs autorizados e siglas).
    """
    import os
    import csv
    from app.models.tfd import ProcedimentoCatalogo, TipoFila
    from app.models.lab_exames import SigtapProcedimento, SigtapCbo

    # Garante primeiro que as especialidades médicas estejam na base
    try:
        seed_especialidades(db)
    except Exception:
        pass

    caminhos_tentativas = [
        caminho_csv,
        os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "data", "vivver", "procedimentos.csv")),
        os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "data", "vivver", "procedimentos_por_tipo.csv")),
        os.path.join(os.getcwd(), "backend", "app", "data", "vivver", "procedimentos.csv"),
        os.path.join(os.getcwd(), "backend", "app", "data", "vivver", "procedimentos_por_tipo.csv"),
        "/Users/mateusluck/Documents/ESUS-exportacoes/vivver_procedimentos_por_tipo_2026-11-06/procedimentos_por_tipo.csv",
        "/Users/mateusluck/Documents/ESUS-exportacoes/vivver_procedimentos_por_tipo/procedimentos.csv",
        os.path.join(os.getcwd(), "data", "vivver_procedimentos.csv"),
    ]
    arquivo_encontrado = None
    for c in caminhos_tentativas:
        if c and os.path.exists(c):
            arquivo_encontrado = c
            break

    if not arquivo_encontrado:
        return {"ok": False, "mensagem": "Arquivo CSV do Vivver não encontrado.", "inseridos": 0}

    # 1. Garante o cadastro prévio de todos os 26 Tipos de Serviço do Vivver com siglas oficiais
    tipos_existentes = {t.nome.strip().upper(): t for t in db.exec(select(TipoFila)).all()}
    caminho_tipos = os.path.join(os.path.dirname(arquivo_encontrado), "tipos_servico.csv")
    if os.path.exists(caminho_tipos):
        try:
            with open(caminho_tipos, "r", encoding="utf-8") as ft:
                for row_t in csv.DictReader(ft):
                    t_id = (row_t.get("servico_tipo_id") or "").strip()
                    t_nome = (row_t.get("nome") or "").strip().upper()
                    if t_nome and t_nome not in tipos_existentes:
                        novo_tipo = TipoFila(codigo=t_id, nome=t_nome, ativo=True)
                        db.add(novo_tipo)
                        tipos_existentes[t_nome] = novo_tipo
        except Exception:
            pass
    # Garante via lista estática TIPOS_SERVICO_VIVVER se faltar algum
    for t_info in TIPOS_SERVICO_VIVVER:
        t_nome = t_info["nome"]
        if t_nome not in tipos_existentes:
            novo_tipo = TipoFila(codigo=str(t_info["id"]), nome=t_nome, ativo=True)
            db.add(novo_tipo)
            tipos_existentes[t_nome] = novo_tipo

    # 2. Pré-carrega mapa de CBOs médicos oficiais do SIGTAP para enriquecer especialidades
    todos_cbos_db = db.exec(select(SigtapCbo)).all()
    cbos_por_proc: dict[str, list[tuple[str, str]]] = {}
    for c in todos_cbos_db:
        cod_p = c.procedimento_codigo.strip()
        if cod_p not in cbos_por_proc:
            cbos_por_proc[cod_p] = []
        cbos_por_proc[cod_p].append((c.cbo.strip(), c.descricao.strip()))

    # Carrega existentes
    existentes = {
        (p.codigo.strip(), (p.tipo_fila or "").strip().upper())
        for p in db.exec(select(ProcedimentoCatalogo)).all()
        if p.codigo
    }

    inseridos = 0
    with open(arquivo_encontrado, "r", encoding="utf-8") as f:
        rdr = csv.DictReader(f)
        for row in rdr:
            cod = (row.get("codprocedimento") or "").strip()
            nome = (row.get("nomprocedimento") or "").strip().upper()
            tipo_nome = (row.get("servico_tipo_nome") or "").strip().upper()
            tipo_id = (row.get("servico_tipo_id") or "").strip()

            if not cod or not nome:
                continue

            # Garante tipo de fila
            if tipo_nome and tipo_nome not in tipos_existentes:
                novo_tipo = TipoFila(codigo=tipo_id, nome=tipo_nome, ativo=True)
                db.add(novo_tipo)
                tipos_existentes[tipo_nome] = novo_tipo

            chave = (cod, tipo_nome)
            sigla_tipo = MAPA_TIPO_SIGLA.get(tipo_nome, "")

            # Cruzamento de especialidade médica:
            esp_nome, esp_cbo = MAPA_TIPO_ESPECIALIDADE.get(tipo_nome, ("", ""))
            # Se houver CBOs específicos do SIGTAP para este procedimento, busca o primeiro médico
            if cod in cbos_por_proc:
                cbos_cand = cbos_por_proc[cod]
                # Prefere médico (família 225)
                med_cbo = next((item for item in cbos_cand if item[0].startswith("225")), None)
                if med_cbo:
                    esp_cbo = med_cbo[0]
                    if not esp_nome:
                        esp_nome = med_cbo[1]

            if chave not in existentes:
                proc = ProcedimentoCatalogo(
                    codigo=cod,
                    nome=nome[:150],
                    tipo_fila=tipo_nome[:80],
                    nome_especialidade=esp_nome[:120],
                    codigo_especialidade=esp_cbo[:10],
                    codigo_curto=sigla_tipo[:12],
                    ativo=True,
                )
                db.add(proc)
                existentes.add(chave)
                inseridos += 1

    # 3. Atualiza procedimentos existentes sem sigla/código curto ou especialidade
    atualizados = 0
    todos_procs = db.exec(select(ProcedimentoCatalogo)).all()
    for p in todos_procs:
        tf = (p.tipo_fila or "").strip().upper()
        sigla_esperada = MAPA_TIPO_SIGLA.get(tf, "")
        alterou = False
        if sigla_esperada and not p.codigo_curto:
            p.codigo_curto = sigla_esperada[:12]
            alterou = True
        if (not p.nome_especialidade or not p.codigo_especialidade) and tf in MAPA_TIPO_ESPECIALIDADE:
            esp_nome, esp_cbo = MAPA_TIPO_ESPECIALIDADE[tf]
            if not p.nome_especialidade:
                p.nome_especialidade = esp_nome
            if not p.codigo_especialidade:
                p.codigo_especialidade = esp_cbo
            alterou = True
        if alterou:
            db.add(p)
            atualizados += 1

    if inseridos > 0 or atualizados > 0:
        db.commit()

    return {"ok": True, "arquivo": arquivo_encontrado, "inseridos": inseridos, "atualizados": atualizados}


from functools import lru_cache


@lru_cache(maxsize=1)
def _ler_vivver_catalogo_csv_cached() -> tuple[dict, ...]:
    import csv
    import os

    caminho = os.path.normpath(
        os.path.join(os.path.dirname(__file__), "..", "data", "vivver", "procedimentos.csv")
    )
    if not os.path.exists(caminho):
        return ()
    itens: list[dict] = []
    with open(caminho, "r", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            cod = (row.get("codprocedimento") or "").strip()
            nome = (row.get("nomprocedimento") or "").strip().upper()
            tipo_nome = (row.get("servico_tipo_nome") or "").strip().upper()
            if not cod or not nome:
                continue
            esp_nome, esp_cod = MAPA_TIPO_ESPECIALIDADE.get(tipo_nome, ("", ""))
            sigla = MAPA_TIPO_SIGLA.get(tipo_nome, "")
            itens.append({
                "codigo": cod,
                "nome": nome[:150],
                "tipo_fila": tipo_nome[:80],
                "nome_especialidade": esp_nome,
                "codigo_especialidade": esp_cod,
                "codigo_curto": sigla,
            })
    return tuple(itens)


def carregar_vivver_catalogo_csv() -> list[dict]:
    """Lê em memória (cacheado) o catálogo oficial exportado do Vivver para fallback caso tfd_procedimentos esteja incompleto."""
    return [dict(item) for item in _ler_vivver_catalogo_csv_cached()]
