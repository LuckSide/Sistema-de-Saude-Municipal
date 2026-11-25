import re
from datetime import date, datetime
from typing import Any

from fastapi import HTTPException
from sqlmodel import Session, col, func, select

from app.models.cadastros_saude import EquipeSaude, Medico, UnidadeSaude
from app.models.lab_exames import SigtapCbo, SigtapCid, SigtapProcedimento
from app.models.producao_ambulatorial import ProducaoAmbulatorial
from app.models.tfd import Paciente
from app.models.user import User
from app.schemas.producao_ambulatorial import (
    ProducaoAmbulatorialCreate,
    ProducaoAmbulatorialUpdate,
    ResumoCompetenciaOut,
    ResumoTopProcedimento,
)
from app.services.validacoes import so_digitos, valida_cns, valida_cpf


def limpar_numeros(valor: Any) -> str:
    """Remove caracteres não-numéricos."""
    if not valor:
        return ""
    return re.sub(r"\D", "", str(valor))


def calcular_idade_em_anos(data_nascimento: date | None, data_referencia: date | None) -> int:
    """Calcula a idade em anos completos na data de referência."""
    if not data_nascimento:
        return 0
    ref = data_referencia or date.today()
    anos = ref.year - data_nascimento.year
    if (ref.month, ref.day) < (data_nascimento.month, data_nascimento.day):
        anos -= 1
    return max(0, min(anos, 999))


def normalizar_cbo(cbo: str | None) -> str:
    """Normaliza o código CBO para 6 dígitos numéricos sem traços."""
    if not cbo:
        return ""
    return limpar_numeros(cbo)[:6]


def extrair_competencia(dt: date | None, comp_informada: str | None) -> str:
    """Garante competência no formato AAAAMM a partir do valor ou data."""
    if comp_informada:
        digs = limpar_numeros(comp_informada)
        if len(digs) == 6:
            return digs
    if dt:
        return f"{dt.year:04d}{dt.month:02d}"
    hoje = date.today()
    return f"{hoje.year:04d}{hoje.month:02d}"


def validar_e_preparar_dados_producao(
    db: Session,
    dados: dict | ProducaoAmbulatorialCreate | ProducaoAmbulatorialUpdate,
    producao_existente: ProducaoAmbulatorial | None = None,
    usuario_atual: User | None = None,
) -> dict:
    """Validação rigorosa de regras SIA/SUS e SIGTAP para produção ambulatorial."""
    d = dados.model_dump(exclude_unset=True) if hasattr(dados, "model_dump") else dict(dados)

    # 1. Unidade de Saúde
    unidade_id = d.get("unidade_saude_id") or (producao_existente.unidade_saude_id if producao_existente else None)
    if not unidade_id:
        raise HTTPException(status_code=422, detail="Unidade de Saúde é obrigatória.")
    unidade = db.get(UnidadeSaude, unidade_id)
    if not unidade or not unidade.ativo:
        raise HTTPException(status_code=422, detail=f"Unidade de Saúde ID {unidade_id} não encontrada ou inativa.")

    # 2. Profissional / Médico Executante
    medico_id = d.get("medico_id") or (producao_existente.medico_id if producao_existente else None)
    if not medico_id:
        raise HTTPException(status_code=422, detail="Profissional executante (médico/profissional) é obrigatório.")
    medico = db.get(Medico, medico_id)
    if not medico or not medico.ativo:
        raise HTTPException(status_code=422, detail=f"Profissional executante ID {medico_id} não encontrado ou inativo.")

    # 3. Equipe de Saúde (opcional)
    equipe_id = d.get("equipe_id") if "equipe_id" in d else (producao_existente.equipe_id if producao_existente else None)
    if equipe_id:
        equipe = db.get(EquipeSaude, equipe_id)
        if not equipe:
            raise HTTPException(status_code=422, detail=f"Equipe de Saúde ID {equipe_id} não encontrada.")

    # 4. Data de Atendimento e Competência
    data_atend = d.get("data_atendimento") or (producao_existente.data_atendimento if producao_existente else None)
    if not data_atend:
        raise HTTPException(status_code=422, detail="Data do atendimento é obrigatória.")

    comp_informada = d.get("competencia") or (producao_existente.competencia if producao_existente else None)
    competencia = extrair_competencia(data_atend, comp_informada)

    # 5. CBO do Profissional
    cbo_raw = d.get("cbo_codigo") or (producao_existente.cbo_codigo if producao_existente else None) or medico.cbo_codigo
    cbo_codigo = normalizar_cbo(cbo_raw)
    if not cbo_codigo:
        raise HTTPException(
            status_code=422,
            detail=f"CBO do profissional executante '{medico.nome}' não está preenchido e é obrigatório para o faturamento do SUS.",
        )

    # 6. Procedimento SIGTAP
    proc_id = d.get("procedimento_id") or (producao_existente.procedimento_id if producao_existente else None)
    proc_cod = limpar_numeros(d.get("procedimento_codigo") or (producao_existente.procedimento_codigo if producao_existente else ""))

    proc: SigtapProcedimento | None = None
    if proc_id:
        proc = db.get(SigtapProcedimento, proc_id)
    if not proc and proc_cod:
        # Busca exata ou pelos 10 dígitos
        proc = db.exec(select(SigtapProcedimento).where(SigtapProcedimento.codigo.like(f"{proc_cod}%"))).first()

    if not proc:
        identificador = proc_cod or str(proc_id)
        raise HTTPException(
            status_code=422,
            detail=f"Procedimento SIGTAP '{identificador}' não encontrado na Tabela Unificada do SUS.",
        )

    proc_codigo_10 = proc.codigo[:10]
    proc_nome = proc.descricao

    # 7. Compatibilidade CBO x Procedimento (se houver restrições cadastradas em sigtap_cbos)
    cbos_permitidos = list(
        db.exec(
            select(SigtapCbo.cbo).where(
                (SigtapCbo.procedimento_codigo == proc.codigo)
                | (SigtapCbo.procedimento_codigo == proc_codigo_10)
            )
        ).all()
    )
    if cbos_permitidos:
        cbos_limpos = {normalizar_cbo(c) for c in cbos_permitidos if c}
        if cbo_codigo not in cbos_limpos:
            lista_permitidos = ", ".join(sorted(list(cbos_limpos)[:5]))
            raise HTTPException(
                status_code=422,
                detail=(
                    f"O CBO '{cbo_codigo}' informado não é compatível com o procedimento "
                    f"'{proc_codigo_10} - {proc_nome}' segundo a Tabela SIGTAP do DATASUS. "
                    f"Exemplos de CBOs autorizados: {lista_permitidos}."
                ),
            )

    # 8. Instrumento de Registro e Validações BPA-C vs BPA-I
    inst_procedimento = (proc.instrumento or "BPA-C").strip().upper()
    insts_perm_raw = (getattr(proc, "instrumentos_permitidos", "") or "").upper()
    insts_permitidos = [x.strip() for x in insts_perm_raw.split(",") if x.strip()] or [inst_procedimento]
    inst_informado = (d.get("instrumento_registro") or (producao_existente.instrumento_registro if producao_existente else inst_procedimento) or "BPA-C").strip().upper()

    if "BPA-I" in inst_procedimento and "BPA-C" not in insts_permitidos and inst_informado != "BPA-I":
        raise HTTPException(
            status_code=422,
            detail=(
                f"O procedimento '{proc_codigo_10} - {proc_nome}' exige instrumento de registro "
                f"BPA-I (Individualizado). Não é permitido o lançamento em BPA-C (Consolidado)."
            ),
        )

    if inst_informado == "BPA-I" or (inst_procedimento == "BPA-I" and "BPA-C" not in insts_permitidos):
        instrumento_registro = "BPA-I"
    else:
        instrumento_registro = "BPA-C"

    # Quantidade
    quantidade = int(d.get("quantidade") or (producao_existente.quantidade if producao_existente else 1))
    if quantidade < 1:
        raise HTTPException(status_code=422, detail="A quantidade deve ser maior ou igual a 1.")

    if proc.qtd_maxima and proc.qtd_maxima > 0 and quantidade > proc.qtd_maxima:
        raise HTTPException(
            status_code=422,
            detail=f"Quantidade informada ({quantidade}) excede a quantidade máxima permitida ({proc.qtd_maxima}) pelo SIGTAP para este procedimento.",
        )

    # Idade no BPA-C quando o procedimento exigir PA_IDEBPA='S'
    idade_informada_raw = d.get("idade_paciente_informada") if "idade_paciente_informada" in d else (producao_existente.idade_paciente_informada if producao_existente else None)
    idade_informada = int(idade_informada_raw) if idade_informada_raw is not None else None
    if instrumento_registro == "BPA-C" and bool(getattr(proc, "exige_idade_bpa", False)):
        if idade_informada is None:
            raise HTTPException(
                status_code=422,
                detail=f"O procedimento '{proc_codigo_10} - {proc_nome}' exige o preenchimento da idade do paciente mesmo no registro consolidado (BPA-C).",
            )
        if proc.idade_max and proc.idade_max > 0:
            idade_min_a = proc.idade_min // 12 if proc.idade_max > 150 else proc.idade_min
            idade_max_a = proc.idade_max // 12 if proc.idade_max > 150 else proc.idade_max
            if idade_informada < idade_min_a or idade_informada > idade_max_a:
                raise HTTPException(
                    status_code=422,
                    detail=f"Idade informada ({idade_informada} anos) fora da faixa permitida ({idade_min_a} a {idade_max_a} anos) para este procedimento.",
                )

    # Campos de Paciente (BPA-I)
    paciente_id = d.get("paciente_id") if "paciente_id" in d else (producao_existente.paciente_id if producao_existente else None)
    paciente_obj: Paciente | None = None
    if paciente_id:
        paciente_obj = db.get(Paciente, paciente_id)

    paciente_nome = (
        d.get("paciente_nome")
        or (paciente_obj.nome if paciente_obj else "")
        or (producao_existente.paciente_nome if producao_existente else "")
    ).strip()

    paciente_cpf_raw = (
        d.get("paciente_cpf")
        if "paciente_cpf" in d
        else (
            (producao_existente.paciente_cpf if producao_existente else "")
            or (paciente_obj.cpf if paciente_obj else "")
        )
    )
    paciente_cpf = so_digitos(paciente_cpf_raw)[:11]

    paciente_cns_raw = (
        d.get("paciente_cns")
        if "paciente_cns" in d
        else (
            (producao_existente.paciente_cns if producao_existente else "")
            or (paciente_obj.cns if paciente_obj else "")
        )
    )
    paciente_cns = so_digitos(paciente_cns_raw)[:15]

    paciente_sexo = (
        d.get("paciente_sexo")
        or (paciente_obj.sexo if paciente_obj else "")
        or (producao_existente.paciente_sexo if producao_existente else "")
    ).strip().upper()
    if paciente_sexo in ("MASCULINO", "M"):
        paciente_sexo = "M"
    elif paciente_sexo in ("FEMININO", "F"):
        paciente_sexo = "F"

    paciente_nasc = (
        d.get("paciente_data_nascimento")
        or (paciente_obj.nascimento if paciente_obj else None)
        or (producao_existente.paciente_data_nascimento if producao_existente else None)
    )

    paciente_ibge = (
        d.get("paciente_municipio_ibge")
        or (getattr(paciente_obj, "municipio", "") if paciente_obj else "")
        or (producao_existente.paciente_municipio_ibge if producao_existente else "")
        or "312810"
    ).strip()

    paciente_raca_cor = (
        d.get("paciente_raca_cor")
        or (producao_existente.paciente_raca_cor if producao_existente else "")
        or "99"
    ).strip()[:2]
    paciente_etnia = (
        d.get("paciente_etnia")
        or (producao_existente.paciente_etnia if producao_existente else "")
        or ""
    ).strip()[:4]
    paciente_nacionalidade = (
        d.get("paciente_nacionalidade")
        or (producao_existente.paciente_nacionalidade if producao_existente else "")
        or "010"
    ).strip()[:3]
    carater_atendimento = (
        d.get("carater_atendimento")
        or (producao_existente.carater_atendimento if producao_existente else "")
        or "01"
    ).strip()[:2]
    paciente_cep = so_digitos(
        d.get("paciente_cep")
        or (getattr(paciente_obj, "cep", "") if paciente_obj else "")
        or (producao_existente.paciente_cep if producao_existente else "")
    )[:8]
    paciente_logradouro = (
        d.get("paciente_logradouro")
        or (getattr(paciente_obj, "endereco", "") if paciente_obj else "")
        or (producao_existente.paciente_logradouro if producao_existente else "")
    ).strip()[:100]
    paciente_numero = (
        d.get("paciente_numero")
        or (getattr(paciente_obj, "endereco_numero", "") if paciente_obj else "")
        or (producao_existente.paciente_numero if producao_existente else "")
    ).strip()[:10]
    paciente_complemento = (
        d.get("paciente_complemento")
        or (getattr(paciente_obj, "complemento", "") if paciente_obj else "")
        or (producao_existente.paciente_complemento if producao_existente else "")
    ).strip()[:30]
    paciente_bairro = (
        d.get("paciente_bairro")
        or (getattr(paciente_obj, "bairro", "") if paciente_obj else "")
        or (producao_existente.paciente_bairro if producao_existente else "")
    ).strip()[:60]
    paciente_telefone = so_digitos(
        d.get("paciente_telefone")
        or (getattr(paciente_obj, "telefone", "") if paciente_obj else "")
        or (producao_existente.paciente_telefone if producao_existente else "")
    )[:15]
    paciente_situacao_rua = (
        (d.get("paciente_situacao_rua") or (producao_existente.paciente_situacao_rua if producao_existente else "N"))
        .strip()
        .upper()[:1]
    )
    if paciente_situacao_rua not in ("S", "N"):
        paciente_situacao_rua = "N"
    paciente_sem_cpf = (
        (d.get("paciente_sem_cpf") or (producao_existente.paciente_sem_cpf if producao_existente else "N"))
        .strip()
        .upper()[:1]
    )
    if paciente_sem_cpf not in ("S", "N"):
        paciente_sem_cpf = "N"

    cid10 = (d.get("cid10") or (producao_existente.cid10 if producao_existente else "")).strip().upper()
    numero_autorizacao = (d.get("numero_autorizacao") or (producao_existente.numero_autorizacao if producao_existente else "")).strip()
    servico_codigo = (d.get("servico_codigo") or (producao_existente.servico_codigo if producao_existente else "")).strip()
    classificacao_codigo = (d.get("classificacao_codigo") or (producao_existente.classificacao_codigo if producao_existente else "")).strip()

    # Validações estritas quando for BPA-I
    if instrumento_registro == "BPA-I":
        if not paciente_nome:
            raise HTTPException(
                status_code=422,
                detail="No registro individualizado (BPA-I), o nome do paciente é obrigatório.",
            )

        if paciente_cpf:
            ok_cpf, mot_cpf = valida_cpf(paciente_cpf)
            if not ok_cpf:
                raise HTTPException(status_code=422, detail=f"CPF do paciente inválido: {mot_cpf}")

        if paciente_cns:
            valido, motivo_cns = valida_cns(paciente_cns)
            if not valido:
                raise HTTPException(status_code=422, detail=f"CNS do paciente inválido: {motivo_cns}")

        if bool(getattr(proc, "exige_cpf", False)) and not paciente_cpf and paciente_sem_cpf != "S":
            raise HTTPException(
                status_code=422,
                detail=f"O procedimento '{proc_codigo_10} - {proc_nome}' exige obrigatoriamente o CPF do paciente no SIA/DATASUS (ou marque 'Paciente sem CPF').",
            )

        if not paciente_cpf and not paciente_cns and paciente_sem_cpf != "S":
            raise HTTPException(
                status_code=422,
                detail="No registro individualizado (BPA-I), informe ao menos o CPF (11 dígitos) ou o Cartão SUS / CNS (15 dígitos) do paciente.",
            )

        if paciente_raca_cor == "05" and not paciente_etnia:
            raise HTTPException(
                status_code=422,
                detail="Quando a Raça/Cor do paciente for 05 (Indígena), o código da Etnia é obrigatório no layout do BPA-I.",
            )

        if bool(getattr(proc, "exige_cid", False)):
            cids_proc = list(
                db.exec(
                    select(SigtapCid.cid).where(
                        (SigtapCid.procedimento_codigo == proc.codigo)
                        | (SigtapCid.procedimento_codigo == proc_codigo_10)
                    )
                ).all()
            )
            if cids_proc:
                if not cid10:
                    raise HTTPException(
                        status_code=422,
                        detail=f"O procedimento '{proc_codigo_10} - {proc_nome}' exige a informação do CID-10 compatível.",
                    )
                cid_norm = cid10.replace(".", "").upper()
                cids_validos = {c.replace(".", "").upper() for c in cids_proc if c}
                if cid_norm not in cids_validos and cid_norm[:3] not in cids_validos:
                    raise HTTPException(
                        status_code=422,
                        detail=f"O CID-10 '{cid10}' informado não é compatível com o procedimento '{proc_codigo_10} - {proc_nome}' segundo o SIGTAP.",
                    )

        if bool(getattr(proc, "exige_servico", False)) and (not servico_codigo or not classificacao_codigo):
            raise HTTPException(
                status_code=422,
                detail=f"O procedimento '{proc_codigo_10} - {proc_nome}' exige a seleção do Serviço e Classificação (CNES/SIGTAP).",
            )

        if paciente_sexo not in ("M", "F"):
            raise HTTPException(
                status_code=422,
                detail="No registro individualizado (BPA-I), o sexo do paciente deve ser 'M' (Masculino) ou 'F' (Feminino).",
            )

        if not paciente_nasc:
            raise HTTPException(
                status_code=422,
                detail="No registro individualizado (BPA-I), a data de nascimento do paciente é obrigatória para apuração de faixa etária.",
            )

        # Regra de compatibilidade de Sexo com SIGTAP
        proc_sexo = (proc.sexo or "").strip().upper()
        if proc_sexo in ("M", "MASCULINO") and paciente_sexo != "M":
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Procedimento '{proc_codigo_10} - {proc_nome}' é exclusivo para o sexo "
                    f"Masculino segundo o SIGTAP, mas o paciente informado é do sexo Feminino."
                ),
            )
        elif proc_sexo in ("F", "FEMININO") and paciente_sexo != "F":
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Procedimento '{proc_codigo_10} - {proc_nome}' é exclusivo para o sexo "
                    f"Feminino segundo o SIGTAP, mas o paciente informado é do sexo Masculino."
                ),
            )

        # Regra de compatibilidade de Idade com SIGTAP
        idade_anos = calcular_idade_em_anos(paciente_nasc, data_atend)
        if proc.idade_max and proc.idade_max > 0:
            if proc.idade_max > 150:
                # SIGTAP em meses
                idade_min_anos = proc.idade_min // 12
                idade_max_anos = proc.idade_max // 12
            else:
                idade_min_anos = proc.idade_min
                idade_max_anos = proc.idade_max

            if idade_anos < idade_min_anos or idade_anos > idade_max_anos:
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"Idade do paciente ({idade_anos} anos) é incompatível com o procedimento "
                        f"'{proc_codigo_10} - {proc_nome}' (Faixa etária permitida pelo SIGTAP: "
                        f"{idade_min_anos} a {idade_max_anos} anos)."
                    ),
                )

    # 9. Cálculo Financeiro
    vl_sa = float(proc.valor_sa or 0.0)
    vl_sp = float(proc.valor_sp or 0.0)
    vl_comb = float(proc.valor_combinado or 0.0)

    # Valor padrão do procedimento ambulatorial no SUS é SA + SP (ou valor_combinado)
    vl_unitario_sigtap = round(vl_sa + vl_sp, 2)
    if vl_unitario_sigtap <= 0.0 and vl_comb > 0.0:
        vl_unitario_sigtap = round(vl_comb, 2)

    # Se usuário enviou valor explicitamente e for > 0, mantém; senão usa o valor calculado do SIGTAP
    vl_unit_inf = d.get("valor_unitario")
    if vl_unit_inf is not None and float(vl_unit_inf) > 0.0:
        valor_unitario = round(float(vl_unit_inf), 2)
    else:
        valor_unitario = vl_unitario_sigtap

    valor_total = round(valor_unitario * quantidade, 2)

    # 10. Monta dicionário final pronto
    preparado = {
        "unidade_saude_id": unidade_id,
        "medico_id": medico_id,
        "equipe_id": equipe_id,
        "procedimento_id": proc.id,
        "procedimento_codigo": proc_codigo_10,
        "procedimento_nome": proc_nome[:250],
        "cbo_codigo": cbo_codigo,
        "competencia": competencia,
        "data_atendimento": data_atend,
        "instrumento_registro": instrumento_registro,
        "quantidade": quantidade,
        "valor_unitario": valor_unitario,
        "valor_total": valor_total,
        "paciente_id": paciente_id,
        "paciente_nome": paciente_nome[:150],
        "paciente_cpf": paciente_cpf[:11],
        "paciente_cns": paciente_cns[:15],
        "paciente_sexo": paciente_sexo[:1],
        "paciente_data_nascimento": paciente_nasc,
        "paciente_municipio_ibge": paciente_ibge[:10],
        "paciente_raca_cor": paciente_raca_cor[:2],
        "paciente_etnia": paciente_etnia[:4],
        "paciente_nacionalidade": paciente_nacionalidade[:3],
        "carater_atendimento": carater_atendimento[:2],
        "paciente_cep": paciente_cep[:8],
        "paciente_logradouro": paciente_logradouro[:100],
        "paciente_numero": paciente_numero[:10],
        "paciente_complemento": paciente_complemento[:30],
        "paciente_bairro": paciente_bairro[:60],
        "paciente_telefone": paciente_telefone[:15],
        "paciente_situacao_rua": paciente_situacao_rua[:1],
        "paciente_sem_cpf": paciente_sem_cpf[:1],
        "idade_paciente_informada": idade_informada,
        "cid10": cid10[:10],
        "numero_autorizacao": numero_autorizacao[:20],
        "servico_codigo": servico_codigo[:10],
        "classificacao_codigo": classificacao_codigo[:10],
        "origem": (d.get("origem") or (producao_existente.origem if producao_existente else "DIGITACAO_PROFISSIONAL"))[:50],
        "status": (d.get("status") or (producao_existente.status if producao_existente else "VALIDADO"))[:20],
        "usuario_id": (producao_existente.usuario_id if producao_existente and producao_existente.usuario_id else (usuario_atual.id if usuario_atual else None)),
        "atualizado_em": datetime.utcnow(),
    }
    return preparado


def criar_producao(
    db: Session,
    dados: ProducaoAmbulatorialCreate,
    usuario_atual: User | None = None,
) -> ProducaoAmbulatorial:
    """Cria novo registro de produção ambulatorial após validação rigorosa."""
    valores = validar_e_preparar_dados_producao(db, dados, usuario_atual=usuario_atual)
    registro = ProducaoAmbulatorial(**valores)
    registro.criado_em = datetime.utcnow()
    db.add(registro)
    db.commit()
    db.refresh(registro)
    return registro


def atualizar_producao(
    db: Session,
    producao_id: int,
    dados: ProducaoAmbulatorialUpdate,
    usuario_atual: User | None = None,
) -> ProducaoAmbulatorial:
    """Atualiza registro de produção ambulatorial existente."""
    registro = db.get(ProducaoAmbulatorial, producao_id)
    if not registro:
        raise HTTPException(status_code=404, detail="Registro de produção ambulatorial não encontrado.")

    valores = validar_e_preparar_dados_producao(
        db, dados, producao_existente=registro, usuario_atual=usuario_atual
    )
    for chave, val in valores.items():
        setattr(registro, chave, val)

    db.add(registro)
    db.commit()
    db.refresh(registro)
    return registro


def excluir_producao(db: Session, producao_id: int) -> None:
    """Exclui um registro de produção ambulatorial."""
    registro = db.get(ProducaoAmbulatorial, producao_id)
    if not registro:
        raise HTTPException(status_code=404, detail="Registro de produção ambulatorial não encontrado.")
    db.delete(registro)
    db.commit()


def obter_resumo_competencia(
    db: Session,
    competencia: str,
    medico_id: int | None = None,
    unidade_saude_id: int | None = None,
    usuario_id: int | None = None,
) -> ResumoCompetenciaOut:
    """Calcula totais, valores financeiros e distribuição BPA-C vs BPA-I na competência."""
    comp_limpa = extrair_competencia(None, competencia)

    stmt = select(ProducaoAmbulatorial).where(ProducaoAmbulatorial.competencia == comp_limpa)
    if medico_id:
        stmt = stmt.where(ProducaoAmbulatorial.medico_id == medico_id)
    if unidade_saude_id:
        stmt = stmt.where(ProducaoAmbulatorial.unidade_saude_id == unidade_saude_id)
    if usuario_id:
        stmt = stmt.where(ProducaoAmbulatorial.usuario_id == usuario_id)

    registros = list(db.exec(stmt).all())

    total_procedimentos = sum(r.quantidade for r in registros)
    total_lancamentos = len(registros)
    valor_total = round(sum(r.valor_total for r in registros), 2)

    registros_bpac = [r for r in registros if r.instrumento_registro == "BPA-C"]
    total_bpac = sum(r.quantidade for r in registros_bpac)
    valor_bpac = round(sum(r.valor_total for r in registros_bpac), 2)

    registros_bpai = [r for r in registros if r.instrumento_registro == "BPA-I"]
    total_bpai = sum(r.quantidade for r in registros_bpai)
    valor_bpai = round(sum(r.valor_total for r in registros_bpai), 2)

    profissionais_unicos = {r.medico_id for r in registros}
    unidades_unicas = {r.unidade_saude_id for r in registros}

    # Top procedimentos
    grupos: dict[str, dict] = {}
    for r in registros:
        cod = r.procedimento_codigo
        if cod not in grupos:
            grupos[cod] = {
                "procedimento_codigo": cod,
                "procedimento_nome": r.procedimento_nome,
                "instrumento": r.instrumento_registro,
                "quantidade": 0,
                "valor_total": 0.0,
            }
        grupos[cod]["quantidade"] += r.quantidade
        grupos[cod]["valor_total"] = round(grupos[cod]["valor_total"] + r.valor_total, 2)

    top_procedimentos = [
        ResumoTopProcedimento(**item)
        for item in sorted(grupos.values(), key=lambda x: x["quantidade"], reverse=True)[:10]
    ]

    return ResumoCompetenciaOut(
        competencia=comp_limpa,
        total_procedimentos=total_procedimentos,
        total_lancamentos=total_lancamentos,
        valor_total=valor_total,
        total_bpac=total_bpac,
        valor_bpac=valor_bpac,
        total_bpai=total_bpai,
        valor_bpai=valor_bpai,
        total_profissionais=len(profissionais_unicos),
        total_unidades=len(unidades_unicas),
        top_procedimentos=top_procedimentos,
    )
