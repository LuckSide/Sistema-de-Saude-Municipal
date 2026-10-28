"""
Módulo de Preparos Clínicos e Diretrizes de Jejum Laboratorial.

Fundamentado nas diretrizes técnicas oficiais da:
- SBPC/ML (Sociedade Brasileira de Patologia Clínica / Medicina Laboratorial)
- SBC / SBPC-ML / SBAC / SBD / SBEM (Consenso Brasileiro para a Normatização da Determinação do Perfil Lipídico)
- Sociedade Brasileira de Endocrinologia e Metabologia (SBEM)
- Sociedade Brasileira de Urologia (SBU - Recomendações de Dosagem do PSA)
"""

import re
from typing import Any
import unicodedata


def _remover_acentos(texto: str) -> str:
    if not texto:
        return ""
    nfkd = unicodedata.normalize("NFKD", str(texto))
    return "".join([c for c in nfkd if not unicodedata.combining(c)]).upper()


# Catálogo Clínico de Diretrizes por Grupo / Procedimento
REGRAS_PREPARO = [
    {
        "id": "totg",
        "nome": "Curva Glicêmica / TOTG",
        "padrao_re": r"(CURVA\s+GLICEMICA|TOLERANCIA\s+A\s+GLICOSE|TOTG|SOBRECARGA\s+DE\s+GLICOSE)",
        "jejum_horas": "8 a 12 horas",
        "nivel_jejum": 12,
        "badge": "Jejum 8-12h · Repouso 2h no laboratório",
        "instrucoes": [
            "Jejum obrigatório de 8 a 12 horas (não ultrapassar 14 horas de jejum).",
            "O paciente permanecerá em repouso nas dependências do laboratório por cerca de 2 horas para ingestão da sobrecarga de glicose (dextrosol) e coletas seriadas de sangue.",
            "Evitar esforços físicos extenuantes na véspera e não fumar antes ou durante a realização do teste.",
        ],
    },
    {
        "id": "glicose",
        "nome": "Glicemia de Jejum e Insulina",
        "padrao_re": r"(GLICOSE|GLICEMIA|INSULIN|HOMA|PEPTIDEO\s+C)",
        "excluir_re": r"(GLICADA|HBA1C|HEMOGLOBINA\s+A1C|CURVA\s+GLICEMICA|TOLERANCIA)",
        "jejum_horas": "8 a 12 horas",
        "nivel_jejum": 10,
        "badge": "Jejum 8 a 12 horas",
        "instrucoes": [
            "Jejum alimentar obrigatório de 8 a 12 horas (não ultrapassar 14 horas para evitar alterações metabólicas ou hipoglicemia).",
            "Ingestão de água pura é permitida em quantidade moderada.",
            "Não ingerir bebidas alcoólicas nas 72 horas que antecedem a coleta.",
        ],
    },
    {
        "id": "hba1c",
        "nome": "Hemoglobina Glicada (HbA1c)",
        "padrao_re": r"(GLICADA|HBA1C|HEMOGLOBINA\s+A1C)",
        "jejum_horas": "Sem jejum obrigatório",
        "nivel_jejum": 0,
        "badge": "Sem jejum obrigatório",
        "instrucoes": [
            "A dosagem de Hemoglobina Glicada (HbA1c) não exige jejum obrigatório (mede a média glicêmica dos últimos 90 a 120 dias).",
        ],
    },
    {
        "id": "psa",
        "nome": "PSA (Antígeno Prostático Específico)",
        "padrao_re": r"(PSA\b|ANTIGENO\s+PROSTATICO)",
        "jejum_horas": "4 horas (ou sem jejum)",
        "nivel_jejum": 4,
        "badge": "Jejum 4h · Abstinência sexual 48-72h",
        "instrucoes": [
            "PSA - Preparo físico obrigatório: Manter abstinência sexual e ausência total de ejaculação por 48 a 72 horas antes da coleta.",
            "Não andar de bicicleta, motocicleta ou praticar equitação (andar a cavalo) nas 48 horas que antecedem a punção.",
            "Aguardar no mínimo 72 horas após exame de toque retal ou sondagem vesical, e 4 semanas após biópsia de próstata.",
        ],
    },
    {
        "id": "tireoide",
        "nome": "Hormônios Tireoidianos (TSH e T4 Livre)",
        "padrao_re": r"(TSH\b|TIREOTROFINA|T4\s+LIVRE|TIROXINA|T3\s+LIVRE|TRIIODOTIRONINA|ANTI[\s\-]TPO|TIREOGLOBULINA)",
        "jejum_horas": "4 horas",
        "nivel_jejum": 4,
        "badge": "Jejum 4h · Tomar Levotiroxina após coleta",
        "instrucoes": [
            "TSH / T4 Livre: Coleta preferencialmente no período matutino (até as 09:30).",
            "Atenção com medicação: Se faz uso de hormônio tireoidiano (Levotiroxina, Puran T4, Levoid, Synthroid, Euthyrox), NÃO tomar o comprimido antes da coleta de sangue. Leve o remédio consigo e tome-o com água imediatamente após o término da punção.",
        ],
    },
    {
        "id": "prolactina",
        "nome": "Prolactina",
        "padrao_re": r"(PROLACTINA)",
        "jejum_horas": "4 horas",
        "nivel_jejum": 4,
        "badge": "Jejum 4h · Repouso 20min no lab",
        "instrucoes": [
            "Prolactina: Exige repouso sentado de 15 a 30 minutos dentro do laboratório antes da realização da punção (estresse e agitação elevam os níveis hormonais).",
            "Evitar exercícios físicos intensos e estimulação mamária ou sexual nas 24 horas prévias.",
        ],
    },
    {
        "id": "cortisol",
        "nome": "Cortisol Matutino (Basal)",
        "padrao_re": r"(CORTISOL)",
        "jejum_horas": "4 a 8 horas",
        "nivel_jejum": 6,
        "badge": "Coleta matutina rigorosa (07h às 09h)",
        "instrucoes": [
            "Cortisol Matutino: Coleta pontual entre 07:00 e 09:00 da manhã (momento de pico do ritmo circadiano).",
            "Dormir bem na véspera; evitar estresse e esforço físico na manhã da coleta.",
            "Informar ao atendente se faz uso de medicamentos com corticoides (comprimidos, pomadas dermatológicas ou inaladores).",
        ],
    },
    {
        "id": "perfil_lipidico",
        "nome": "Perfil Lipídico (Colesterol e Triglicérides)",
        "padrao_re": r"(LIPID|COLESTEROL|TRIGLICER|HDL|LDL|VLDL|APOLIPOPROTEINA)",
        "jejum_horas": "4 horas (ou habitual)",
        "nivel_jejum": 4,
        "badge": "Consenso SBC: Jejum 4h / habitual",
        "instrucoes": [
            "Perfil Lipídico (Consenso Brasileiro SBC/SBPC-ML): O jejum prolongado de 12 horas não é mais obrigatório para colesterol e triglicerídeos na rotina; adota-se jejum leve de 4 horas ou estado alimentar habitual.",
            "Manter alimentação habitual nos dias anteriores (evitar refeições excepcionalmente gordurosas na véspera).",
            "Abster-se totalmente de bebidas alcoólicas nas 72 horas que antecedem o exame.",
        ],
    },
    {
        "id": "urina_rotina",
        "nome": "Urina Tipo 1 (EAS / Sumário)",
        "padrao_re": r"(URINA\s+I\b|URINA\s+TIPO\s+1|EAS\b|SUMARIO\s+DE\s+URINA|SEDIMENTO\s+DE\s+URINA)",
        "excluir_re": r"(URINA\s+24|24\s+HORAS|CULTURA|UROCULTURA)",
        "jejum_horas": "Sem jejum alimentar",
        "nivel_jejum": 0,
        "badge": "1ª urina manhã · Jato médio",
        "instrucoes": [
            "Urina Tipo 1 (EAS): Coletar preferencialmente a primeira urina da manhã (ou urina com retenção na bexiga de no mínimo 2 a 4 horas).",
            "Higiene íntima rigorosa com água e sabão neutro antes de urinar; secar com toalha ou gaze limpa.",
            "Desprezar o primeiro jato de urina no vaso sanitário e recolher o jato médio diretamente no frasco coletor fornecido.",
            "Mulheres: Evitar coleta durante o período menstrual, salvo indicação médica urgente.",
        ],
    },
    {
        "id": "urocultura",
        "nome": "Urocultura com Antibiograma",
        "padrao_re": r"(UROCULTURA|CULTURA\s+DE\s+URINA)",
        "jejum_horas": "Sem jejum alimentar",
        "nivel_jejum": 0,
        "badge": "Frasco estéril · Jato médio",
        "instrucoes": [
            "Urocultura: Realizar assepsia criteriosa da genitália; desprezar o primeiro jato e coletar o jato médio em frasco rigorosamente estéril.",
            "Informar se está em uso de antimicrobianos/antibióticos ou se encerrou o tratamento há menos de 7 dias.",
        ],
    },
    {
        "id": "urina_24h",
        "nome": "Urina de 24 Horas",
        "padrao_re": r"(URINA\s+24|24\s+HORAS|CLEARENCE\s+DE\s+CREATININA|DEPURACAO\s+DE\s+CREATININA|PROTEINURIA\s+24)",
        "jejum_horas": "Sem jejum alimentar",
        "nivel_jejum": 0,
        "badge": "Galão 24h refrigerado",
        "instrucoes": [
            "Urina de 24 Horas: Desprezar totalmente a primeira urina do dia inicial (ex: às 07:00 da manhã).",
            "A partir desse momento, coletar absolutamente TODA a urina eliminada durante 24 horas consecutivas dentro do galão específico fornecido pelo laboratório.",
            "No dia seguinte, exatamente no mesmo horário (às 07:00), colher a última micção no galão para encerrar a coleta.",
            "Manter o recipiente refrigerado na geladeira durante todo o período de coleta até a entrega imediata no laboratório.",
        ],
    },
    {
        "id": "fezes_epf",
        "nome": "Parasitológico de Fezes (EPF)",
        "padrao_re": r"(PARASITOLOGICO|COPROCULTURA|PROTOZOARIOS|HELMINTOS|FEZES)",
        "excluir_re": r"(SANGUE\s+OCULTO)",
        "jejum_horas": "Sem jejum alimentar",
        "nivel_jejum": 0,
        "badge": "Frasco coletor sem urina",
        "instrucoes": [
            "Exame de Fezes (EPF): Coletar porção recente de fezes no coletor limpo fornecido, evitando qualquer contaminação com urina ou água do vaso.",
        ],
    },
    {
        "id": "sangue_oculto",
        "nome": "Pesquisa de Sangue Oculto nas Fezes",
        "padrao_re": r"(SANGUE\s+OCULTO)",
        "jejum_horas": "Sem jejum alimentar",
        "nivel_jejum": 0,
        "badge": "Dieta 3 dias (sem carne vermelha)",
        "instrucoes": [
            "Sangue Oculto nas Fezes: Evitar nos 3 dias que antecedem a coleta o consumo de carne vermelha, beterraba, rabanete, nabo e vitamina C em excesso.",
            "Não usar medicamentos que irritem a mucosa gástrica (como anti-inflamatórios ou ácido acetilsalicílico/AAS), salvo ordem médica expressa.",
            "Não coletar caso haja sangramento de hemorroidas ou sangramento gengival ativo.",
        ],
    },
    {
        "id": "coagulograma",
        "nome": "Coagulograma / TAP / TTPA / INR",
        "padrao_re": r"(COAGULOGRAMA|TAP\b|TTPA\b|INR\b|TEMPO\s+DE\s+PROTROMBINA|FIBRINOGENIO)",
        "jejum_horas": "4 horas",
        "nivel_jejum": 4,
        "badge": "Jejum 4h · Informar anticoagulante",
        "instrucoes": [
            "Coagulograma / TAP / TTPA: Jejum recomendado de 4 horas.",
            "Informar obrigatoriamente se faz uso de medicamentos anticoagulantes ou antiagregantes (Varfarina, Marevan, Heparina, AAS, Clopidogrel, Xarelto, Eliquis).",
        ],
    },
    {
        "id": "bioquimica",
        "nome": "Bioquímica Geral e Função Renal/Hepática",
        "padrao_re": r"(UREIA|CREATININA|ACIDO\s+URICO|TGO|TGP|GAMA\s+GT|TRANSAMINASE|SODIO|POTASSIO|CALCIO|FERRO|FERRITINA|BILIRRUBINA|FOSFATASE|PROTEINAS\s+TOTAIS|ALBUMINA|MAGNESIO|FOSFORO)",
        "jejum_horas": "4 horas",
        "nivel_jejum": 4,
        "badge": "Jejum 4 horas · Água liberada",
        "instrucoes": [
            "Bioquímica Sérica: Jejum de 4 horas. Ingestão de água pura é permitida e benéfica para a hidratação venosa.",
            "Evitar consumo de bebidas alcoólicas nas 72 horas anteriores à coleta.",
        ],
    },
    {
        "id": "hemograma",
        "nome": "Hemograma Completo e Hematologia",
        "padrao_re": r"(HEMOGRAMA|ERITROGRAMA|LEUCOGRAMA|PLAQUETAS|FATOR\s+RH|ABO|VHS\b|RETICULOCITOS)",
        "jejum_horas": "3 a 4 horas (ou sem jejum)",
        "nivel_jejum": 3,
        "badge": "Jejum leve 3-4h (evitar gorduras)",
        "instrucoes": [
            "Hemograma Completo: Não exige jejum rigoroso prolongado; recomenda-se jejum leve de 3 a 4 horas ou evitar refeições gordurosas nas horas prévias à coleta.",
        ],
    },
    {
        "id": "sorologia",
        "nome": "Sorologias, Imunologia e Beta-HCG",
        "padrao_re": r"(HIV|VDRL|SIFILIS|HEPATITE|TOXOPLASMOSE|CHAGAS|DENGUE|BETA\s+HCG|GRAVIDEZ|RUBÉOLA|CITOMEGALOVIRUS)",
        "jejum_horas": "4 horas (ou sem jejum)",
        "nivel_jejum": 2,
        "badge": "Jejum leve 4h",
        "instrucoes": [
            "Sorologias / Testes Imunológicos: Jejum leve de 4 horas é recomendado para evitar lipemia e turvação do soro, embora não impeça a realização da análise.",
        ],
    },
]


def obter_preparo_exame(nome_ou_codigo: str) -> dict[str, Any]:
    """Determina o preparo clínico individual e o badge específico para um único exame."""
    texto = _remover_acentos(str(nome_ou_codigo or ""))
    for regra in REGRAS_PREPARO:
        if re.search(regra["padrao_re"], texto):
            excl = regra.get("excluir_re")
            if excl and re.search(excl, texto):
                continue
            return {
                "id": regra["id"],
                "nome_regra": regra["nome"],
                "jejum_horas": regra["jejum_horas"],
                "nivel_jejum": regra["nivel_jejum"],
                "badge": regra["badge"],
                "instrucoes": list(regra["instrucoes"]),
            }

    # Padrão genérico quando não coincide com regra específica
    return {
        "id": "generico",
        "nome_regra": "Exame Laboratorial Geral",
        "jejum_horas": "4 horas",
        "nivel_jejum": 4,
        "badge": "Jejum 4 horas",
        "instrucoes": [
            "Jejum alimentar recomendado de 4 horas.",
            "Ingestão de água pura é permitida em quantidade moderada.",
            "Evitar bebidas alcoólicas nas 72 horas que antecedem a coleta.",
        ],
    }


def determinar_preparo(nomes_procedimentos: list[str]) -> tuple[str, list[str], list[str]]:
    """Calcula o preparo consolidado para uma lista de exames laboratoriais.

    Retorna:
        tuple[str, list[str], list[str]]:
            - jejum_horas (ex: "8 a 12 horas", "4 horas", "Sem necessidade de jejum alimentar")
            - preparo_instrucoes (instruções específicas pertinentes aos exames solicitados)
            - orientacoes_gerais (horários de atendimento, documentos necessários, regras de coleta)
    """
    if not nomes_procedimentos:
        return (
            "8 a 12 horas",
            [
                "Jejum alimentar recomendado: 8 a 12 horas antes da coleta.",
                "Ingestão de água pura é permitida em quantidade moderada.",
                "Evitar bebidas alcoólicas nas 72 horas que antecedem o exame.",
            ],
            [
                "Horário de atendimento para coleta matinal: de Segunda a Sexta, das 07:00 às 09:30.",
                "Apresentar obrigatoriamente: Documento Oficial com Foto (RG/CNH), Cartão Nacional de Saúde (SUS) e este Comprovante de Agendamento.",
            ],
        )

    max_nivel = 0
    regras_aplicadas: list[dict[str, Any]] = []
    ids_vistos: set[str] = set()

    apenas_amostras_nao_sanguineas = True

    for nome in nomes_procedimentos:
        p = obter_preparo_exame(nome)
        if p["nivel_jejum"] > max_nivel:
            max_nivel = p["nivel_jejum"]
        if p["id"] not in ids_vistos:
            ids_vistos.add(p["id"])
            regras_aplicadas.append(p)

        if p["id"] not in ("urina_rotina", "urocultura", "urina_24h", "fezes_epf", "sangue_oculto"):
            apenas_amostras_nao_sanguineas = False

    # Define o tempo consolidado de jejum com base no exame mais exigente do pedido
    if apenas_amostras_nao_sanguineas and max_nivel == 0:
        jejum_horas = "Sem necessidade de jejum alimentar"
    elif max_nivel >= 10:
        jejum_horas = "8 a 12 horas"
    elif max_nivel >= 6:
        jejum_horas = "4 a 8 horas (coleta matutina 07h-09h)"
    elif max_nivel >= 4:
        jejum_horas = "4 horas"
    elif max_nivel >= 3:
        jejum_horas = "3 a 4 horas"
    else:
        jejum_horas = "Sem jejum obrigatório"

    # Monta a lista consolidada e deduplicada de preparo clínico
    instrucoes_finais: list[str] = []

    # Linha principal de jejum
    if jejum_horas != "Sem necessidade de jejum alimentar":
        instrucoes_finais.append(f"Jejum alimentar recomendado: {jejum_horas} antes da coleta.")
        instrucoes_finais.append("Ingestão de água pura é permitida em quantidade moderada.")
    else:
        instrucoes_finais.append("Para exames de urina/fezes isolados, não é necessário jejum alimentar.")

    # Instruções específicas por procedimento solicitado
    for r in regras_aplicadas:
        for inst in r["instrucoes"]:
            if inst not in instrucoes_finais:
                instrucoes_finais.append(inst)

    # Recomendações de medicamentos e estilo de vida
    instrucoes_finais.append("🍷 Evitar consumo de bebidas alcoólicas nas 72 horas que antecedem a coleta.")
    instrucoes_finais.append("💊 Manter medicações de uso contínuo (pressão alta, diabetes, coração), exceto quando houver orientação médica ou regra específica de jejum prévio indicada acima.")

    orientacoes_gerais = [
        "Horário de atendimento para coleta matinal: de Segunda a Sexta, das 07:00 às 09:30.",
        "Documentos obrigatórios: Apresentar RG/CNH original, Cartão Nacional do SUS e este Comprovante de Agendamento.",
        "Para exames de urina ou fezes, utilize exclusivamente os frascos esterilizados fornecidos pelo laboratório conveniado ou UBS de referência.",
        "Chegue ao laboratório com 10 a 15 minutos de antecedência para abertura de ficha e triagem da recepção.",
    ]

    return jejum_horas, instrucoes_finais, orientacoes_gerais
