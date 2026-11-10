from datetime import date, datetime, timedelta
import json
import re
from fastapi import HTTPException
from sqlmodel import Session, select

from app.models.apac import (
    FaixaNumeracaoAPAC,
    LoteFaturamentoAPAC,
    ProcedimentoSecundarioAPAC,
    SolicitacaoAPAC,
)
from app.models.cadastros_saude import Medico
from app.models.lab_exames import SigtapCid, SigtapProcedimento


def limpar_digitos(v: str | None) -> str:
    return re.sub(r"\D", "", v or "")


def limpar_alfanumerico(v: str | None) -> str:
    return re.sub(r"[^A-Za-z0-9]", "", v or "").upper()


def calcular_flags_vencimento(data_fim_validade: date | None) -> tuple[int, bool, bool]:
    """Retorna (dias_restantes, esta_vencida, proxima_do_vencimento)."""
    if not data_fim_validade:
        return 0, False, False

    hoje = date.today()
    dias = (data_fim_validade - hoje).days
    vencida = dias < 0
    proxima = 0 <= dias <= 30
    return dias, vencida, proxima


def calcular_prazo_validade_dias(codigo_procedimento: str, nome_procedimento: str = "") -> int:
    """Classifica procedimentos pontuais (90 dias) vs contínuos (180 dias).

    Tratamentos contínuos incluem: TRS / Diálise, Quimioterapia, Radioterapia,
    medicamentos especializados / doenças crônicas.
    """
    cod = limpar_digitos(codigo_procedimento)
    nome = (nome_procedimento or "").upper()

    # Códigos de grupos contínuos no SIGTAP:
    # 030501... (TRS / Nefrologia / Diálise)
    # 030401..., 030402..., 030403..., 030404..., 030405..., 030406..., 030407..., 030408... (Oncologia / Quimio / Radio)
    # 030306... (Tratamentos de doenças crônicas)
    prefixos_continuos = ("030501", "030402", "030403", "030404", "030405", "030408", "030306")
    if any(cod.startswith(p) for p in prefixos_continuos):
        return 180

    palavras_continuas = ("DIALISE", "HEMODIALISE", "QUIMIOTERAPIA", "RADIOTERAPIA", "CONTINUO", "CRONIC")
    if any(w in nome for w in palavras_continuas):
        return 180

    return 90


def alocar_proximo_numero_apac(db: Session, tipo_procedimento: str = "TODOS") -> str:
    """Busca faixa de numeração ativa e aloca o próximo número sequencial da APAC."""
    # Tenta faixa específica do tipo ou genérica TODOS
    stmt = (
        select(FaixaNumeracaoAPAC)
        .where(
            FaixaNumeracaoAPAC.ativo == True,  # noqa: E712
            FaixaNumeracaoAPAC.proximo_numero <= FaixaNumeracaoAPAC.numero_final,
        )
        .order_by(FaixaNumeracaoAPAC.ano.asc(), FaixaNumeracaoAPAC.id.asc())
        .with_for_update()
    )
    faixas = db.exec(stmt).all()

    faixa_escolhida = None
    if tipo_procedimento and tipo_procedimento != "TODOS":
        for f in faixas:
            if f.tipo_procedimento == tipo_procedimento:
                faixa_escolhida = f
                break

    if not faixa_escolhida:
        for f in faixas:
            if f.tipo_procedimento in ("TODOS", "", None):
                faixa_escolhida = f
                break

    if not faixa_escolhida and faixas:
        faixa_escolhida = faixas[0]

    if not faixa_escolhida:
        raise HTTPException(
            status_code=400,
            detail="Não há faixa de numeração APAC ativa disponível com saldo. Cadastre uma nova faixa no SIA-SUS.",
        )

    from sqlalchemy import text

    numero_alocado = faixa_escolhida.proximo_numero
    proximo = numero_alocado + 1
    desativar = proximo > faixa_escolhida.numero_final

    res = db.exec(
        text(
            "UPDATE apac_faixas "
            "SET proximo_numero = :prox, "
            "    ativo = :novo_ativo "
            "WHERE id = :fid AND proximo_numero = :num_esp AND proximo_numero <= numero_final AND ativo = true"
        ).bindparams(
            prox=proximo,
            novo_ativo=False if desativar else True,
            fid=faixa_escolhida.id,
            num_esp=numero_alocado,
        )
    )
    if getattr(res, "rowcount", 0) == 0:
        raise HTTPException(
            status_code=400,
            detail="Não há faixa de numeração APAC ativa disponível com saldo. Cadastre uma nova faixa no SIA-SUS.",
        )

    db.refresh(faixa_escolhida)
    return str(numero_alocado)


def registrar_evento_tramitacao(
    solicitacao: SolicitacaoAPAC, usuario: str, acao: str, detalhe: str = ""
) -> None:
    """Adiciona evento no histórico de tramitação da APAC."""
    try:
        eventos = json.loads(solicitacao.historico_tramitacao or "[]")
    except Exception:
        eventos = []

    eventos.append(
        {
            "data": datetime.utcnow().isoformat(),
            "usuario": usuario or "Sistema",
            "acao": acao,
            "detalhe": detalhe,
        }
    )
    solicitacao.historico_tramitacao = json.dumps(eventos, ensure_ascii=False)


def duplicar_para_continuidade(
    db: Session,
    apac_id_anterior: int,
    justificativa_atualizada: str,
    usuario_ator: str,
    anamnese_diagnostico: str | None = None,
) -> SolicitacaoAPAC:
    """Gera uma nova solicitação de APAC de continuidade vinculada à anterior."""
    sol_ant = db.get(SolicitacaoAPAC, apac_id_anterior)
    if not sol_ant:
        raise HTTPException(status_code=404, detail="APAC anterior não encontrada.")

    justif_limpa = (justificativa_atualizada or "").strip()
    if len(justif_limpa) < 12:
        raise HTTPException(
            status_code=400,
            detail="Justificativa de continuidade deve conter no mínimo 12 caracteres.",
        )

    hoje = date.today()
    nova_sol = SolicitacaoAPAC(
        numero_apac="",
        tipo_apac="continuidade",
        apac_anterior_id=sol_ant.id,
        numero_apac_anterior=sol_ant.numero_apac or str(sol_ant.id),
        status="SOLICITADO",
        carater_atendimento=sol_ant.carater_atendimento,
        # Paciente
        paciente_id=sol_ant.paciente_id,
        paciente_nome=sol_ant.paciente_nome,
        paciente_cpf=sol_ant.paciente_cpf,
        paciente_cns=sol_ant.paciente_cns,
        paciente_nascimento=sol_ant.paciente_nascimento,
        paciente_sexo=sol_ant.paciente_sexo,
        paciente_nome_mae=sol_ant.paciente_nome_mae,
        paciente_telefone=sol_ant.paciente_telefone,
        paciente_endereco=sol_ant.paciente_endereco,
        paciente_bairro=sol_ant.paciente_bairro,
        paciente_municipio=sol_ant.paciente_municipio,
        paciente_cep=sol_ant.paciente_cep,
        # Estabelecimentos
        estabelecimento_solicitante_id=sol_ant.estabelecimento_solicitante_id,
        estabelecimento_solicitante_cnes=sol_ant.estabelecimento_solicitante_cnes,
        estabelecimento_solicitante_nome=sol_ant.estabelecimento_solicitante_nome,
        estabelecimento_executante_id=sol_ant.estabelecimento_executante_id,
        estabelecimento_executante_cnes=sol_ant.estabelecimento_executante_cnes,
        estabelecimento_executante_nome=sol_ant.estabelecimento_executante_nome,
        # Solicitante mantido, autorizador limpo
        medico_solicitante_id=sol_ant.medico_solicitante_id,
        medico_solicitante_nome=sol_ant.medico_solicitante_nome,
        medico_solicitante_cpf=sol_ant.medico_solicitante_cpf,
        medico_solicitante_cns=sol_ant.medico_solicitante_cns,
        medico_solicitante_crm=sol_ant.medico_solicitante_crm,
        medico_solicitante_cbo=sol_ant.medico_solicitante_cbo,
        medico_autorizador_id=None,
        medico_autorizador_nome="",
        medico_autorizador_cpf="",
        medico_autorizador_cns="",
        medico_autorizador_crm="",
        medico_autorizador_cbo="",
        autorizador_usuario_id=None,
        # Procedimento Principal
        procedimento_principal_codigo=sol_ant.procedimento_principal_codigo,
        procedimento_principal_nome=sol_ant.procedimento_principal_nome,
        quantidade_mes_1=sol_ant.quantidade_mes_1,
        quantidade_mes_2=sol_ant.quantidade_mes_2,
        quantidade_mes_3=sol_ant.quantidade_mes_3,
        quantidade_total=sol_ant.quantidade_total,
        valor_unitario=sol_ant.valor_unitario,
        valor_total=sol_ant.valor_total,
        # Dados Clínicos
        cid_principal_codigo=sol_ant.cid_principal_codigo,
        cid_principal_nome=sol_ant.cid_principal_nome,
        cid_secundario_codigo=sol_ant.cid_secundario_codigo,
        cid_secundario_nome=sol_ant.cid_secundario_nome,
        cid_causas_associadas=sol_ant.cid_causas_associadas,
        anamnese_diagnostico=anamnese_diagnostico if anamnese_diagnostico is not None else sol_ant.anamnese_diagnostico,
        justificativa_solicitacao=justif_limpa,
        estadiamento_grau=sol_ant.estadiamento_grau,
        indicacao_clinica=sol_ant.indicacao_clinica,
        # Datas
        data_solicitacao=hoje,
        data_autorizacao=None,
        data_inicio_validade=None,
        data_fim_validade=None,
        competencia=hoje.strftime("%Y-%m"),
        # Regulação
        parecer_regulador="",
        motivo_devolucao="",
        motivo_indeferimento="",
        historico_tramitacao="[]",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )

    registrar_evento_tramitacao(
        nova_sol,
        usuario_ator,
        "CRIACAO_CONTINUIDADE",
        f"Criada continuidade a partir da APAC {sol_ant.numero_apac or sol_ant.id}",
    )
    db.add(nova_sol)
    db.flush()

    # Clona os procedimentos secundários
    secundarios_ant = db.exec(
        select(ProcedimentoSecundarioAPAC).where(
            ProcedimentoSecundarioAPAC.solicitacao_apac_id == sol_ant.id
        )
    ).all()
    for s in secundarios_ant:
        novo_s = ProcedimentoSecundarioAPAC(
            solicitacao_apac_id=nova_sol.id,
            codigo=s.codigo,
            descricao=s.descricao,
            quantidade_mes_1=s.quantidade_mes_1,
            quantidade_mes_2=s.quantidade_mes_2,
            quantidade_mes_3=s.quantidade_mes_3,
            quantidade_total=s.quantidade_total,
            valor_unitario=s.valor_unitario,
            valor_total=s.valor_total,
        )
        db.add(novo_s)

    db.commit()
    db.refresh(nova_sol)
    return nova_sol


def autorizar_apac(
    db: Session,
    solicitacao_id: int,
    medico_autorizador_id: int,
    parecer: str,
    usuario_ator: str,
    data_autorizacao: date | None = None,
    validade_meses: int | None = None,
) -> SolicitacaoAPAC:
    """Executa a autorização técnica da APAC com validação de vínculo e numeração."""
    sol = db.exec(
        select(SolicitacaoAPAC)
        .where(SolicitacaoAPAC.id == solicitacao_id)
        .with_for_update()
    ).first()
    if not sol:
        raise HTTPException(status_code=404, detail="Solicitação de APAC não encontrada.")

    if sol.status in ("AUTORIZADO", "CANCELADO"):
        raise HTTPException(
            status_code=400,
            detail=f"Não é possível autorizar uma solicitação com status '{sol.status}'.",
        )

    # Incompatibilidade de vínculo: solicitante não pode autorizar
    if sol.medico_solicitante_id == medico_autorizador_id:
        raise HTTPException(
            status_code=400,
            detail="Incompatibilidade: O profissional solicitante não pode ser o mesmo que autoriza a APAC.",
        )

    med_aut = db.get(Medico, medico_autorizador_id)
    if not med_aut:
        raise HTTPException(status_code=404, detail="Médico autorizador não encontrado.")

    if not med_aut.ativo:
        raise HTTPException(status_code=400, detail="Médico autorizador informado está inativo.")

    dt_aut = data_autorizacao or date.today()

    # Cálculo da validade
    if validade_meses and validade_meses > 0:
        dias_validade = validade_meses * 30
    else:
        dias_validade = calcular_prazo_validade_dias(
            sol.procedimento_principal_codigo, sol.procedimento_principal_nome
        )

    dt_ini = dt_aut
    dt_fim = dt_ini + timedelta(days=dias_validade)

    # Alocação de número da APAC
    numero_gerado = alocar_proximo_numero_apac(db, tipo_procedimento="TODOS")

    sol.numero_apac = numero_gerado
    sol.status = "AUTORIZADO"
    sol.data_autorizacao = dt_aut
    sol.data_inicio_validade = dt_ini
    sol.data_fim_validade = dt_fim
    sol.competencia = dt_aut.strftime("%Y-%m")

    sol.medico_autorizador_id = med_aut.id
    sol.medico_autorizador_nome = med_aut.nome
    sol.medico_autorizador_cpf = med_aut.cpf or ""
    sol.medico_autorizador_crm = med_aut.crm or ""
    sol.medico_autorizador_cbo = med_aut.cbo_codigo or ""
    sol.parecer_regulador = parecer or "Autorizado conforme diretrizes técnicas e comprovação documental."
    sol.updated_at = datetime.utcnow()

    registrar_evento_tramitacao(
        sol,
        usuario_ator,
        "AUTORIZACAO",
        f"APAC autorizada com número {numero_gerado} por Dr(a). {med_aut.nome}. Validade até {dt_fim.strftime('%d/%m/%Y')}.",
    )

    db.add(sol)
    db.commit()
    db.refresh(sol)
    return sol


def gerar_arquivo_apac_mag(
    db: Session,
    competencia: str,
    cnes_executante: str | None = None,
    usuario_ator: str = "Sistema",
) -> LoteFaturamentoAPAC:
    """Gera remessa no padrão magnético DATASUS SIA-SUS (APAC-Mag posicional)."""
    # Busca APACs autorizadas elegíveis
    stmt = (
        select(SolicitacaoAPAC)
        .where(
            SolicitacaoAPAC.status == "AUTORIZADO",
            SolicitacaoAPAC.competencia == competencia,
        )
        .order_by(SolicitacaoAPAC.id.asc())
    )
    apacs = list(db.exec(stmt).all())

    if cnes_executante:
        cnes_limpo = cnes_executante.strip()
        apacs = [a for a in apacs if (a.estabelecimento_executante_cnes or "").strip() == cnes_limpo]

    if not apacs:
        raise HTTPException(
            status_code=400,
            detail=f"Nenhuma APAC autorizada encontrada para a competência {competencia}.",
        )

    # Identifica o CNES executante do lote
    cnes_lote = cnes_executante or apacs[0].estabelecimento_executante_cnes or "2121345"
    cnes_lote = cnes_lote.strip()

    total_apacs = len(apacs)
    total_procs = 0
    valor_total = 0.0

    linhas_arquivo: list[str] = []
    comp_digits = competencia.replace("-", "")

    # Tipo 02 e 03 registros
    linhas_corpo: list[str] = []
    for sol in apacs:
        total_procs += sol.quantidade_total
        valor_total += float(sol.valor_total or 0.0)

        # Registro Tipo 02: Laudo / Principal APAC
        num_apac = (sol.numero_apac or str(sol.id)).ljust(15)[:15]
        carater = (sol.carater_atendimento or "01").zfill(2)[:2]
        cns_pac = limpar_digitos(sol.paciente_cns).ljust(15)[:15]
        nome_pac = (sol.paciente_nome or "").upper().ljust(30)[:30]
        sexo_pac = (sol.paciente_sexo or "M").upper()[:1]
        nasc_pac = sol.paciente_nascimento.strftime("%Y%m%d") if sol.paciente_nascimento else "19800101"
        ibge_mun = "312810"  # Guapé MG
        proc_prin = limpar_digitos(sol.procedimento_principal_codigo).zfill(10)[:10]
        qtd_m1 = f"{sol.quantidade_mes_1:04d}"
        qtd_m2 = f"{sol.quantidade_mes_2:04d}"
        qtd_m3 = f"{sol.quantidade_mes_3:04d}"
        cid_prin = limpar_alfanumerico(sol.cid_principal_codigo).ljust(4)[:4]
        cid_sec = limpar_alfanumerico(sol.cid_secundario_codigo).ljust(4)[:4]
        cnes_sol = (sol.estabelecimento_solicitante_cnes or cnes_lote).ljust(7)[:7]
        cnes_exe = (sol.estabelecimento_executante_cnes or cnes_lote).ljust(7)[:7]
        cns_sol = limpar_digitos(sol.medico_solicitante_cns).ljust(15)[:15]
        cns_aut = limpar_digitos(sol.medico_autorizador_cns).ljust(15)[:15]
        dt_aut = sol.data_autorizacao.strftime("%Y%m%d") if sol.data_autorizacao else datetime.now().strftime("%Y%m%d")
        dt_ini = sol.data_inicio_validade.strftime("%Y%m%d") if sol.data_inicio_validade else dt_aut
        dt_fim = sol.data_fim_validade.strftime("%Y%m%d") if sol.data_fim_validade else dt_aut

        linha_02 = (
            f"02"
            f"{num_apac}"
            f"{carater}"
            f"{cns_pac}"
            f"{nome_pac}"
            f"{sexo_pac}"
            f"{nasc_pac}"
            f"{ibge_mun}"
            f"{proc_prin}"
            f"{qtd_m1}"
            f"{qtd_m2}"
            f"{qtd_m3}"
            f"{cid_prin}"
            f"{cid_sec}"
            f"{cnes_sol}"
            f"{cnes_exe}"
            f"{cns_sol}"
            f"{cns_aut}"
            f"{dt_aut}"
            f"{dt_ini}"
            f"{dt_fim}"
        )
        linha_02 = linha_02.ljust(180)[:180]
        linhas_corpo.append(linha_02)

        # Procedimentos Secundários Tipo 03
        secs = db.exec(
            select(ProcedimentoSecundarioAPAC).where(
                ProcedimentoSecundarioAPAC.solicitacao_apac_id == sol.id
            )
        ).all()
        for s in secs:
            total_procs += s.quantidade_total
            valor_total += float(s.valor_total or 0.0)
            cod_sec = limpar_digitos(s.codigo).zfill(10)[:10]
            sqtd_1 = f"{s.quantidade_mes_1:04d}"
            sqtd_2 = f"{s.quantidade_mes_2:04d}"
            sqtd_3 = f"{s.quantidade_mes_3:04d}"
            linha_03 = (
                f"03"
                f"{num_apac}"
                f"{cod_sec}"
                f"{sqtd_1}"
                f"{sqtd_2}"
                f"{sqtd_3}"
            )
            linha_03 = linha_03.ljust(180)[:180]
            linhas_corpo.append(linha_03)

    # Tipo 01: Header da Remessa
    nome_orgao = "SEC MUNICIPAL SAUDE GUAPE".ljust(40)[:40]
    dt_geracao = datetime.now().strftime("%Y%m%d")
    val_cents = f"{int(round(valor_total * 100)):012d}"
    tot_apacs_str = f"{total_apacs:06d}"
    tot_procs_str = f"{total_procs:08d}"

    linha_01 = (
        f"01"
        f"APACMG"
        f"{comp_digits}"
        f"{cnes_lote.ljust(7)[:7]}"
        f"{nome_orgao}"
        f"{dt_geracao}"
        f"{tot_apacs_str}"
        f"{tot_procs_str}"
        f"{val_cents}"
    )
    linha_01 = linha_01.ljust(180)[:180]

    linhas_arquivo.append(linha_01)
    linhas_arquivo.extend(linhas_corpo)

    conteudo_txt = "\r\n".join(linhas_arquivo) + "\r\n"
    nome_arquivo = f"APAC_{cnes_lote}_{comp_digits}.TXT"

    lote = LoteFaturamentoAPAC(
        competencia=competencia,
        cnes_executante=cnes_lote,
        tipo_remessa="APAC-MAG",
        total_apacs=total_apacs,
        total_procedimentos=total_procs,
        valor_total=round(valor_total, 2),
        status="FECHADO",
        conteudo_arquivo=conteudo_txt,
        arquivo_nome=nome_arquivo,
        criado_em=datetime.utcnow(),
        criado_por=usuario_ator,
    )
    db.add(lote)
    db.commit()
    db.refresh(lote)
    return lote


def seed_apac(db: Session) -> None:
    """Executa o seed inicial de faixas de numeração e procedimentos SIGTAP APAC."""
    # 1. Seed da Faixa de Numeração Padrão 2026 MG
    try:
        faixa_existente = db.exec(
            select(FaixaNumeracaoAPAC).where(
                FaixaNumeracaoAPAC.ano == 2026,
                FaixaNumeracaoAPAC.serie == "MG01",
            )
        ).first()

        if not faixa_existente:
            db.add(
                FaixaNumeracaoAPAC(
                    ano=2026,
                    uf="MG",
                    serie="MG01",
                    numero_inicial=3126100000001,
                    numero_final=3126100010000,
                    proximo_numero=3126100000001,
                    tipo_procedimento="TODOS",
                    ativo=True,
                    descricao="Faixa Padrão SES-MG 2026 Alta Complexidade Guapé",
                    created_at=datetime.utcnow(),
                )
            )
            db.commit()
    except Exception:
        db.rollback()

    # 2. Seed de Procedimentos SIGTAP Alta Complexidade / APAC
    procedimentos_apac = [
        {
            "codigo": "0305010107",
            "descricao": "HEMODIALISE (MAXIMO 3 SESSOES POR SEMANA)",
            "complexidade": "Alta Complexidade",
            "instrumento": "APAC",
            "valor_sa": 194.20,
            "valor_sp": 0.0,
            "valor_sh": 0.0,
        },
        {
            "codigo": "0305010115",
            "descricao": "HEMODIALISE EM PACIENTE C/ SOROLOGIA POSITIVA HEPATITE B",
            "complexidade": "Alta Complexidade",
            "instrumento": "APAC",
            "valor_sa": 210.50,
            "valor_sp": 0.0,
            "valor_sh": 0.0,
        },
        {
            "codigo": "0305010131",
            "descricao": "DIALISE PERITONEAL AMBULATORIAL CONTINUA (CAPD)",
            "complexidade": "Alta Complexidade",
            "instrumento": "APAC",
            "valor_sa": 1650.00,
            "valor_sp": 0.0,
            "valor_sh": 0.0,
        },
        {
            "codigo": "0304020220",
            "descricao": "QUIMIOTERAPIA PALIATIVA - ADULTO",
            "complexidade": "Alta Complexidade",
            "instrumento": "APAC",
            "valor_sa": 1420.00,
            "valor_sp": 0.0,
            "valor_sh": 0.0,
        },
        {
            "codigo": "0304020239",
            "descricao": "QUIMIOTERAPIA ADJUVANTE - ADULTO",
            "complexidade": "Alta Complexidade",
            "instrumento": "APAC",
            "valor_sa": 1850.00,
            "valor_sp": 0.0,
            "valor_sh": 0.0,
        },
        {
            "codigo": "0304020247",
            "descricao": "QUIMIOTERAPIA CURATIVA - ADULTO",
            "complexidade": "Alta Complexidade",
            "instrumento": "APAC",
            "valor_sa": 2200.00,
            "valor_sp": 0.0,
            "valor_sh": 0.0,
        },
        {
            "codigo": "0304080039",
            "descricao": "RADIOTERAPIA COM ACELERADOR LINEAR",
            "complexidade": "Alta Complexidade",
            "instrumento": "APAC",
            "valor_sa": 3100.00,
            "valor_sp": 0.0,
            "valor_sh": 0.0,
        },
        {
            "codigo": "0207010064",
            "descricao": "RESSONANCIA MAGNETICA DE COLUNA LOMBO-SACRA",
            "complexidade": "Alta Complexidade",
            "instrumento": "APAC",
            "valor_sa": 268.75,
            "valor_sp": 0.0,
            "valor_sh": 0.0,
        },
        {
            "codigo": "0207010030",
            "descricao": "RESSONANCIA MAGNETICA DE ENCEFALO",
            "complexidade": "Alta Complexidade",
            "instrumento": "APAC",
            "valor_sa": 268.75,
            "valor_sp": 0.0,
            "valor_sh": 0.0,
        },
        {
            "codigo": "0206010079",
            "descricao": "TOMOGRAFIA COMPUTADORIZADA DE TORAX",
            "complexidade": "Alta Complexidade",
            "instrumento": "APAC",
            "valor_sa": 136.40,
            "valor_sp": 0.0,
            "valor_sh": 0.0,
        },
        {
            "codigo": "0206010010",
            "descricao": "TOMOGRAFIA COMPUTADORIZADA DE CRANIO",
            "complexidade": "Alta Complexidade",
            "instrumento": "APAC",
            "valor_sa": 118.50,
            "valor_sp": 0.0,
            "valor_sh": 0.0,
        },
        {
            "codigo": "0407010173",
            "descricao": "GASTROPLASTIA COM DERIVACAO INTESTINAL (CIRURGIA BARIATRICA)",
            "complexidade": "Alta Complexidade",
            "instrumento": "APAC",
            "valor_sa": 5600.00,
            "valor_sp": 0.0,
            "valor_sh": 0.0,
        },
        {
            "codigo": "0303060280",
            "descricao": "TRATAMENTO DE DOENCA DE CROHN / ARTRITE C/ IMUNOBIOLOGICO",
            "complexidade": "Alta Complexidade",
            "instrumento": "APAC",
            "valor_sa": 3400.00,
            "valor_sp": 0.0,
            "valor_sh": 0.0,
        },
    ]

    try:
        for p in procedimentos_apac:
            existente = db.exec(
                select(SigtapProcedimento).where(SigtapProcedimento.codigo == p["codigo"])
            ).first()
            if not existente:
                db.add(SigtapProcedimento(**p, competencia="2026-01"))
            else:
                # Garante classificação APAC e Alta Complexidade
                if existente.instrumento != "APAC":
                    existente.instrumento = "APAC"
                    existente.complexidade = "Alta Complexidade"
                    db.add(existente)
        db.commit()
    except Exception:
        db.rollback()

    # 3. Seed de CIDs frequentes em APAC
    cids_iniciais = [
        {"procedimento_codigo": "0305010107", "cid": "N180", "descricao": "Doença renal em estágio terminal"},
        {"procedimento_codigo": "0305010107", "cid": "N189", "descricao": "Insuficiência renal crônica não especificada"},
        {"procedimento_codigo": "0304020220", "cid": "C509", "descricao": "Neoplasia maligna da mama, não especificada"},
        {"procedimento_codigo": "0304020220", "cid": "C189", "descricao": "Neoplasia maligna do cólon, não especificado"},
        {"procedimento_codigo": "0304080039", "cid": "C61", "descricao": "Neoplasia maligna da próstata"},
        {"procedimento_codigo": "0207010064", "cid": "M511", "descricao": "Transtornos de discos lombares e outros com radiculopatia"},
        {"procedimento_codigo": "0206010079", "cid": "C349", "descricao": "Neoplasia maligna dos brônquios ou pulmões"},
        {"procedimento_codigo": "0407010173", "cid": "E660", "descricao": "Obesidade devida a excesso de calorias"},
        {"procedimento_codigo": "0303060280", "cid": "K509", "descricao": "Doença de Crohn não especificada"},
    ]

    try:
        for c in cids_iniciais:
            cid_ex = db.exec(
                select(SigtapCid).where(
                    SigtapCid.cid == c["cid"],
                    SigtapCid.procedimento_codigo == c["procedimento_codigo"],
                )
            ).first()
            if not cid_ex:
                db.add(SigtapCid(**c))
        db.commit()
    except Exception:
        db.rollback()
