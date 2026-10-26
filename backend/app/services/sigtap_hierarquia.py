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
    if "CARDIO" in tf or "ECG" in tf:
        return {
            "prefixos": ["021102", "020501", "021001"],
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
            "prefixos": ["021105", "0210010010"],
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

    # 17. Outros procedimentos especializados
    return {
        "prefixos": [],
        "excluir_prefixos": ["0202"],  # Filas especializadas não trazem exame de sangue
        "categoria": "ESPECIALIZADOS",
        "apenas_laboratoriais": False,
    }


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

    # Lista formatada dos primeiros CBOs autorizados
    cbos_formatados = [{"cbo": c.cbo, "descricao": c.descricao} for c in cbos_db[:10]]

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


def seed_vivver_procedimentos(db: Session, caminho_csv: str | None = None) -> dict:
    """
    Importa procedimentos categorizados a partir das exportações do sistema Vivver
    para alimentar o catálogo dinâmico de procedimentos e tipos de fila.
    """
    import os
    import csv
    from app.models.tfd import ProcedimentoCatalogo, TipoFila

    caminhos_tentativas = [
        caminho_csv,
        os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "data", "vivver", "procedimentos.csv")),
        os.path.join(os.getcwd(), "backend", "app", "data", "vivver", "procedimentos.csv"),
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

    # Carrega existentes
    existentes = {
        (p.codigo.strip(), (p.tipo_fila or "").strip().upper())
        for p in db.exec(select(ProcedimentoCatalogo)).all()
        if p.codigo
    }
    tipos_existentes = {t.nome.strip().upper(): t for t in db.exec(select(TipoFila)).all()}

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
            if chave not in existentes:
                proc = ProcedimentoCatalogo(
                    codigo=cod,
                    nome=nome[:150],
                    tipo_fila=tipo_nome[:80],
                    ativo=True,
                )
                db.add(proc)
                existentes.add(chave)
                inseridos += 1

    if inseridos > 0:
        db.commit()

    return {"ok": True, "arquivo": arquivo_encontrado, "inseridos": inseridos}
