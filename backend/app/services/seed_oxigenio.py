import os
import re
from datetime import date, datetime
import openpyxl
from sqlalchemy import inspect as sa_inspect
from sqlalchemy import text
from sqlmodel import Session, select

from app.models.oxigenio import (
    CilindroComodatoMovimentacao,
    CilindroVazioRecolhimento,
    EmprestimoOxigenio,
    EmpresaOxigenio,
    EntradaCompraOxigenio,
    EquipamentoRespiratorio,
    ItemEmprestimoOxigenio,
    LicitacaoContratoOxigenio,
    TrocaCilindroHistorico,
)
from app.models.tfd import Paciente
from app.services.geradores import gerar_prontuario_aleatorio
from app.services.pec_sync import normalizar_nome, normalizar_nome_sem_prep


def _limpar_texto(val) -> str:
    if val is None:
        return ""
    return str(val).strip()


def _converter_data(val, default_data: date | None = None) -> date:
    if isinstance(val, datetime):
        return val.date()
    if isinstance(val, date):
        return val
    if isinstance(val, str) and val.strip():
        s = val.strip()
        # Tenta YYYY-MM-DD
        m = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})", s)
        if m:
            try:
                ano = int(m.group(1))
                # Tratamento para anos digitados incorretamente (ex: 2293 -> 2026, 0206 -> 2026)
                if ano > 2030 or ano < 2000:
                    ano = 2026
                return date(ano, int(m.group(2)), int(m.group(3)))
            except Exception:
                pass
        # Tenta DD/MM/YYYY
        m2 = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{2,4})", s)
        if m2:
            try:
                ano = int(m2.group(3))
                if ano < 100:
                    ano += 2000
                elif ano > 2030 or ano < 2000:
                    ano = 2026
                return date(ano, int(m2.group(2)), int(m2.group(1)))
            except Exception:
                pass
    return default_data or date(2026, 1, 1)


def _prioridade_paciente_seed(p: Paciente) -> tuple:
    sit = (getattr(p, "situacao_cadastral", None) or "ativo").strip().lower()
    eh_ativo = 1 if sit in ("ativo", "") else 0
    tem_pec = 1 if getattr(p, "co_seq_cidadao_pec", None) else 0
    tem_doc = 1 if ((p.cpf or "").strip() or (p.cns or "").strip()) else 0
    return (eh_ativo, tem_pec, tem_doc, -(p.id or 0))


def _obter_ou_criar_paciente(
    db: Session,
    nome: str,
    prontuario: str = "",
    telefone: str = "",
    endereco: str = "",
    cache_pacientes: dict | None = None,
) -> Paciente:
    nome_limpo = " ".join((nome or "").strip().split())
    nome_upper = nome_limpo.upper()
    nome_norm = normalizar_nome(nome_limpo)
    nome_sp = normalizar_nome_sem_prep(nome_limpo)
    pront_norm = (prontuario or "").strip()

    p = None
    if cache_pacientes is not None:
        if pront_norm and pront_norm.upper() in cache_pacientes["por_prontuario"]:
            p = cache_pacientes["por_prontuario"][pront_norm.upper()]
        if not p and nome_norm and nome_norm in cache_pacientes["por_nome"]:
            p = cache_pacientes["por_nome"][nome_norm]
        if not p and nome_sp and nome_sp in cache_pacientes["por_nome_sp"]:
            cands = cache_pacientes["por_nome_sp"][nome_sp]
            if len(cands) == 1:
                p = cands[0]
            elif len(cands) > 1:
                p = max(cands, key=_prioridade_paciente_seed)
    else:
        if pront_norm:
            p = db.exec(select(Paciente).where(Paciente.codigo_prontuario == pront_norm)).first()
        if not p and nome_upper:
            p = db.exec(select(Paciente).where(Paciente.nome == nome_upper)).first()
        if not p and nome_norm:
            todos = db.exec(select(Paciente)).all()
            matches = [
                cand for cand in todos
                if normalizar_nome(cand.nome) == nome_norm
                or (nome_sp and normalizar_nome_sem_prep(cand.nome) == nome_sp)
            ]
            if matches:
                p = max(matches, key=_prioridade_paciente_seed)

    if not p:
        p = Paciente(
            nome=nome_upper[:150],
            codigo_prontuario=pront_norm[:20] if pront_norm else "",
            telefone=telefone[:50],
            endereco=endereco[:255],
            municipio="Guapé",
        )
        db.add(p)
        db.flush()
        if p.id and not p.codigo_prontuario:
            p.codigo_prontuario = gerar_prontuario_aleatorio(db, p.id)
            db.add(p)
            db.flush()
        if cache_pacientes is not None:
            if p.codigo_prontuario:
                cache_pacientes["por_prontuario"][p.codigo_prontuario.upper()] = p
            if nome_norm:
                cache_pacientes["por_nome"].setdefault(nome_norm, p)
            if nome_sp:
                cache_pacientes["por_nome_sp"].setdefault(nome_sp, []).append(p)
    else:
        alterou = False
        if telefone and not p.telefone:
            p.telefone = telefone[:50]
            alterou = True
        if endereco and not p.endereco:
            p.endereco = endereco[:255]
            alterou = True
        if pront_norm and not p.codigo_prontuario:
            p.codigo_prontuario = pront_norm[:20]
            alterou = True
        elif not p.codigo_prontuario and p.id:
            p.codigo_prontuario = gerar_prontuario_aleatorio(db, p.id)
            alterou = True
        if alterou:
            db.add(p)
            db.flush()

    return p


def _so_digitos(txt: str) -> str:
    return "".join(c for c in (txt or "") if c.isdigit())


def _obter_ou_criar_empresa(db: Session, **campos) -> EmpresaOxigenio:
    cnpj_dig = _so_digitos(campos.get("cnpj", ""))
    fantasia_norm = normalizar_nome(campos.get("nome_fantasia", ""))
    razao_norm = normalizar_nome(campos.get("razao_social", ""))

    for emp in db.exec(select(EmpresaOxigenio).order_by(EmpresaOxigenio.id.asc())).all():
        if cnpj_dig and _so_digitos(emp.cnpj) == cnpj_dig:
            return emp
        if fantasia_norm and normalizar_nome(emp.nome_fantasia) == fantasia_norm:
            return emp
        if razao_norm and normalizar_nome(emp.razao_social) == razao_norm:
            return emp

    emp = EmpresaOxigenio(**campos)
    db.add(emp)
    db.flush()
    return emp


def _obter_ou_criar_licitacao(db: Session, **campos) -> LicitacaoContratoOxigenio:
    empresa_id = campos.get("empresa_id")
    num_lic = (campos.get("numero_licitacao") or "").strip()
    num_ctr = (campos.get("numero_contrato") or "").strip()
    existente = db.exec(
        select(LicitacaoContratoOxigenio).where(
            LicitacaoContratoOxigenio.empresa_id == empresa_id,
            LicitacaoContratoOxigenio.numero_licitacao == num_lic,
            LicitacaoContratoOxigenio.numero_contrato == num_ctr,
        )
    ).first()
    if existente:
        return existente
    lic = LicitacaoContratoOxigenio(**campos)
    db.add(lic)
    db.flush()
    return lic


def _obter_ou_criar_equipamento(
    db: Session,
    *,
    tipo: str,
    patrimonio: str,
    marca_modelo: str,
    empresa: EmpresaOxigenio,
    status: str,
    data_aquisicao: date,
    observacoes: str,
    cache_eq: dict[tuple[int, str], EquipamentoRespiratorio],
) -> EquipamentoRespiratorio:
    patr_limpo = (patrimonio or "").strip()
    chave = (empresa.id or 0, patr_limpo.upper())
    eq = cache_eq.get(chave)
    if not eq and patr_limpo:
        eq = db.exec(
            select(EquipamentoRespiratorio).where(
                EquipamentoRespiratorio.empresa_id == empresa.id,
                EquipamentoRespiratorio.patrimonio == patr_limpo,
            )
        ).first()
        if eq:
            cache_eq[chave] = eq

    if eq:
        if status == "EM_USO" and eq.status != "EM_USO":
            eq.status = "EM_USO"
            db.add(eq)
            db.flush()
        return eq

    eq = EquipamentoRespiratorio(
        tipo=tipo,
        patrimonio=patr_limpo,
        numero_serie=patr_limpo,
        marca_modelo=marca_modelo[:150],
        propriedade="LOCADO",
        empresa_id=empresa.id,
        empresa_nome=empresa.nome_fantasia or empresa.razao_social,
        status=status,
        data_aquisicao=data_aquisicao,
        observacoes=observacoes,
        ativo=True,
    )
    db.add(eq)
    db.flush()
    cache_eq[chave] = eq
    return eq


def seed_oxigenio_dados_reais(db: Session, caminho_xlsx: str | None = None, force_clean: bool = True) -> dict:
    """Realiza a limpeza de dados de teste e faz a carga inicial completa

    a partir da planilha oficial de oxigênio e equipamentos.
    """
    if not caminho_xlsx:
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        caminho_xlsx = os.path.join(base_dir, "data", "oxigenio", "Oxigenio_Oficial.xlsx")

    if not os.path.exists(caminho_xlsx):
        # Tenta caminho alternativo
        alt_path = "/Users/mateusluck/.gemini/antigravity/brain/1eb23bc9-e3db-486b-9ecb-39cd7002539a/.user_uploaded/media_1793987397258_cfa370c3.xlsx"
        if os.path.exists(alt_path):
            caminho_xlsx = alt_path
        else:
            return {"ok": False, "erro": f"Planilha oficial não encontrada em {caminho_xlsx}"}

    wb = openpyxl.load_workbook(caminho_xlsx, data_only=True)

    # 1. LIMPEZA DOS DADOS FICTÍCIOS ATUAIS
    if force_clean:
        tabelas_existentes = set(sa_inspect(db.get_bind()).get_table_names())
        for tbl in [
            "oxigenio_cilindros_vazios",
            "oxigenio_comodato_movimentacoes",
            "oxigenio_trocas_historico",
            "oxigenio_emprestimo_itens",
            "oxigenio_emprestimos",
            "oxigenio_equipamentos",
            "oxigenio_compras",
            "oxigenio_licitacoes",
            "oxigenio_empresas",
        ]:
            if tbl in tabelas_existentes:
                db.exec(text(f"DELETE FROM {tbl}"))
        db.commit()
        db.expire_all()

    # Pré-carrega cache de pacientes e equipamentos para evitar duplicidades e N+1
    cache_pacientes: dict = {"por_prontuario": {}, "por_nome": {}, "por_nome_sp": {}}
    for p_ex in sorted(db.exec(select(Paciente)).all(), key=_prioridade_paciente_seed, reverse=True):
        pr = (p_ex.codigo_prontuario or "").strip().upper()
        if pr and pr not in cache_pacientes["por_prontuario"]:
            cache_pacientes["por_prontuario"][pr] = p_ex
        nn = normalizar_nome(p_ex.nome)
        if nn and nn not in cache_pacientes["por_nome"]:
            cache_pacientes["por_nome"][nn] = p_ex
        nsp = normalizar_nome_sem_prep(p_ex.nome)
        if nsp:
            cache_pacientes["por_nome_sp"].setdefault(nsp, []).append(p_ex)

    cache_eq: dict[tuple[int, str], EquipamentoRespiratorio] = {}
    termos_existentes = {
        (t.codigo_termo or "").strip()
        for t in db.exec(select(EmprestimoOxigenio)).all()
        if (t.codigo_termo or "").strip()
    }

    # 2. CARGA DAS EMPRESAS FORNECEDORAS REAIS (idempotente por CNPJ/nome)
    # Empresa 1: RESPMED
    emp_respmed = _obter_ou_criar_empresa(
        db,
        razao_social="RESPMED HOSPITALAR E CIRURGICA LTDA",
        nome_fantasia="RESPMED",
        cnpj="14.285.912/0001-34",
        telefone="(35) 3521-4400",
        email="contato@respmed.com.br",
        contato_responsavel="Depto Comercial / Suporte",
        endereco="Av. Principal, 1000 - Passos / MG",
        servicos='["locacao_concentrador", "locacao_bipap"]',
        valor_unitario_10m3=0.0,
        valor_unitario_3m3=0.0,
        valor_unitario_1m3=0.0,
        locacao_mensal_concentrador=85.00,
        locacao_mensal_concentrador_5l=85.00,
        locacao_mensal_concentrador_10l=299.00,
        locacao_mensal_bipap=800.00,
        locacao_mensal_cpap=0.0,
        observacoes="Fornecedora de Concentradores de Oxigênio (5L e 10L) e aparelhos BiPAP conforme ATA 265/2025 e Contrato 220-2024 / 274-2025.",
        ativo=True,
    )

    # Empresa 2: SUPERARMED
    emp_superarmed = _obter_ou_criar_empresa(
        db,
        razao_social="SUPERARMED COMERCIO E LOCACAO DE EQUIPAMENTOS MEDICOS LTDA",
        nome_fantasia="SUPERARMED",
        cnpj="28.913.411/0001-82",
        telefone="(35) 3522-8899",
        email="atendimento@superarmed.com.br",
        contato_responsavel="Depto Respiratório",
        endereco="Rua dos Médicos, 250 - Alfenas / MG",
        servicos='["locacao_cpap"]',
        valor_unitario_10m3=0.0,
        valor_unitario_3m3=0.0,
        valor_unitario_1m3=0.0,
        locacao_mensal_concentrador=0.0,
        locacao_mensal_concentrador_5l=0.0,
        locacao_mensal_concentrador_10l=0.0,
        locacao_mensal_bipap=0.0,
        locacao_mensal_cpap=49.99,
        observacoes="Fornecedora de aparelhos CPAP automáticos com umidificador (R$ 49,99/mês ou R$ 1,67/dia) conforme ATA 265/2025 Contrato 264.",
        ativo=True,
    )

    # Empresa 3: COMERCIAL PITIA LTDA (Fornecedora de Oxigênio Medicinal)
    emp_pitia = _obter_ou_criar_empresa(
        db,
        razao_social="COMERCIAL PITIA LTDA",
        nome_fantasia="COMERCIAL PITIA",
        cnpj="21.942.511/0001-00",
        telefone="(35) 3531-1200",
        email="oxigenio@comercialpitia.com.br",
        contato_responsavel="Logística e Entrega de Gases Medicinais",
        endereco="Rodovia MG-050, Km 12 - Minas Gerais",
        servicos='["oxigenio_cilindros"]',
        valor_unitario_10m3=99.00,
        valor_unitario_3m3=115.00,
        valor_unitario_1m3=65.00,
        locacao_mensal_concentrador=0.0,
        locacao_mensal_concentrador_5l=0.0,
        locacao_mensal_concentrador_10l=0.0,
        locacao_mensal_bipap=0.0,
        locacao_mensal_cpap=0.0,
        observacoes="Fornecedora oficial de recargas e abastecimento contínuo de oxigênio medicinal em cilindros de 10m³, 3m³ e 1m³.",
        ativo=True,
    )

    # 3. LICITAÇÕES E ATAS REAIS
    # Licitação Pitia - Oxigênio
    lic_pitia = _obter_ou_criar_licitacao(
        db,
        empresa_id=emp_pitia.id,
        empresa_nome=emp_pitia.nome_fantasia,
        numero_licitacao="PREGÃO ELETRÔNICO Nº 12/2025",
        numero_contrato="CONTRATO Nº 58/2025",
        ano=2026,
        data_inicio=date(2025, 11, 5),
        data_fim=date(2026, 11, 5),
        qtd_contratada_10m3=246,
        qtd_contratada_3m3=215,
        qtd_contratada_1m3=233,
        valor_unitario_10m3=99.00,
        valor_unitario_3m3=115.00,
        valor_unitario_1m3=65.00,
        valor_total_contrato=round(246 * 99.0 + 215 * 115.0 + 233 * 65.0, 2),
        ativo=True,
    )

    # Licitação Respmed - Concentradores e BiPAP
    lic_respmed = _obter_ou_criar_licitacao(
        db,
        empresa_id=emp_respmed.id,
        empresa_nome=emp_respmed.nome_fantasia,
        numero_licitacao="PREGÃO Nº 64/2025 | PROCESSO Nº 191/2025",
        numero_contrato="ATA REGISTRO DE PREÇOS Nº 265/2025",
        ano=2026,
        data_inicio=date(2025, 11, 5),
        data_fim=date(2026, 11, 5),
        qtd_contratada_10m3=0,
        qtd_contratada_3m3=0,
        qtd_contratada_1m3=0,
        locacao_mensal_concentrador=85.00,
        locacao_mensal_concentrador_5l=85.00,
        locacao_mensal_concentrador_10l=299.00,
        locacao_mensal_bipap=800.00,
        valor_total_contrato=60000.00,
        ativo=True,
    )

    # Licitação Superarmed - CPAP
    lic_superarmed = _obter_ou_criar_licitacao(
        db,
        empresa_id=emp_superarmed.id,
        empresa_nome=emp_superarmed.nome_fantasia,
        numero_licitacao="PREGÃO Nº 64/2025 | PROCESSO Nº 191/2025",
        numero_contrato="ATA REGISTRO DE PREÇOS Nº 265/2025 | CONTRATO 264",
        ano=2026,
        data_inicio=date(2025, 11, 5),
        data_fim=date(2026, 11, 5),
        qtd_contratada_10m3=0,
        qtd_contratada_3m3=0,
        qtd_contratada_1m3=0,
        locacao_mensal_cpap=49.99,
        valor_total_contrato=25000.00,
        ativo=True,
    )

    # 4. CARGA DE CPAP (Aba 'CPAP')
    total_cpap = 0
    if "CPAP" in wb.sheetnames:
        ws_cpap = wb["CPAP"]
        for r in range(10, ws_cpap.max_row + 1):
            nome_pac = _limpar_texto(ws_cpap.cell(r, 2).value)
            if not nome_pac or "TOTAL" in nome_pac.upper():
                continue

            endereco = _limpar_texto(ws_cpap.cell(r, 3).value)
            telefone = _limpar_texto(ws_cpap.cell(r, 4).value)
            produto = _limpar_texto(ws_cpap.cell(r, 5).value) or "CPAP AUTOMÁTICO COM UMIDIFICADOR"
            patrimonio_raw = ws_cpap.cell(r, 6).value
            patrimonio = _limpar_texto(int(patrimonio_raw) if isinstance(patrimonio_raw, (int, float)) else patrimonio_raw)
            if not patrimonio:
                patrimonio = f"CPAP-{r}"

            data_impl = _converter_data(ws_cpap.cell(r, 7).value, default_data=date(2026, 1, 20))
            situacao_raw = _limpar_texto(ws_cpap.cell(r, 9).value).upper()
            status_ativo = "INATIVO" if "INATIV" in situacao_raw else "ATIVO"
            obs = _limpar_texto(ws_cpap.cell(r, 10).value)

            codigo_termo = f"TRM-CPAP-{r:03d}"
            if codigo_termo in termos_existentes:
                continue

            eq = _obter_ou_criar_equipamento(
                db,
                tipo="CPAP",
                patrimonio=patrimonio,
                marca_modelo=produto[:100],
                empresa=emp_superarmed,
                status="EM_USO" if status_ativo == "ATIVO" else "DISPONIVEL",
                data_aquisicao=data_impl,
                observacoes=obs,
                cache_eq=cache_eq,
            )

            # Paciente e Empréstimo
            pac = _obter_ou_criar_paciente(
                db, nome=nome_pac, telefone=telefone, endereco=endereco, cache_pacientes=cache_pacientes
            )
            termo = EmprestimoOxigenio(
                codigo_termo=codigo_termo,
                paciente_id=pac.id,
                paciente_nome=pac.nome,
                paciente_cpf=pac.cpf or "",
                paciente_cns=pac.cns or "",
                paciente_prontuario=pac.codigo_prontuario or "",
                paciente_telefone=pac.telefone,
                paciente_endereco=pac.endereco,
                tipo_servico="MAQUINA",
                equipamento_id=eq.id,
                tipo_equipamento="CPAP",
                equipamento_patrimonio=patrimonio,
                equipamento_serie=patrimonio,
                itens_resumo=f"1x CPAP ({produto[:60]})",
                empresa_id=emp_superarmed.id,
                empresa_nome=emp_superarmed.nome_fantasia,
                licitacao_id=lic_superarmed.id,
                data_instalacao=data_impl,
                status=status_ativo,
                data_devolucao=date.today() if status_ativo == "INATIVO" else None,
                motivo_inativacao=obs if status_ativo == "INATIVO" else None,
                observacoes=f"{produto} · {obs}".strip(" ·"),
            )
            db.add(termo)
            db.flush()
            termos_existentes.add(codigo_termo)

            # Item do Empréstimo
            item = ItemEmprestimoOxigenio(
                emprestimo_id=termo.id,
                tipo_servico="MAQUINA",
                equipamento_id=eq.id,
                tipo_equipamento="CPAP",
                equipamento_patrimonio=patrimonio,
                equipamento_serie=patrimonio,
                quantidade=1,
                status=status_ativo,
            )
            db.add(item)
            total_cpap += 1

    # 5. CARGA DE BIPAP (Aba 'BIPAP')
    total_bipap = 0
    if "BIPAP" in wb.sheetnames:
        ws_bipap = wb["BIPAP"]
        for r in range(2, ws_bipap.max_row + 1):
            nome_pac = _limpar_texto(ws_bipap.cell(r, 3).value)
            if not nome_pac or "TOTAL" in nome_pac.upper():
                continue

            data_contr = _converter_data(ws_bipap.cell(r, 2).value, default_data=date(2025, 11, 26))
            endereco = _limpar_texto(ws_bipap.cell(r, 4).value)
            telefone = _limpar_texto(ws_bipap.cell(r, 5).value)
            patrimonio_prod = _limpar_texto(ws_bipap.cell(r, 6).value) or "BIPAP AIRCURVE VPAP"
            identificador = _limpar_texto(ws_bipap.cell(r, 7).value) or f"EP-{r}"
            codigo_termo = f"TRM-BIPAP-{r:03d}"
            if codigo_termo in termos_existentes:
                continue

            eq = _obter_ou_criar_equipamento(
                db,
                tipo="BiPAP",
                patrimonio=identificador,
                marca_modelo=patrimonio_prod[:100],
                empresa=emp_respmed,
                status="EM_USO",
                data_aquisicao=data_contr,
                observacoes="Locação mensal BiPAP R$ 800,00",
                cache_eq=cache_eq,
            )

            pac = _obter_ou_criar_paciente(
                db, nome=nome_pac, telefone=telefone, endereco=endereco, cache_pacientes=cache_pacientes
            )
            termo = EmprestimoOxigenio(
                codigo_termo=codigo_termo,
                paciente_id=pac.id,
                paciente_nome=pac.nome,
                paciente_cpf=pac.cpf or "",
                paciente_cns=pac.cns or "",
                paciente_prontuario=pac.codigo_prontuario or "",
                paciente_telefone=pac.telefone,
                paciente_endereco=pac.endereco,
                tipo_servico="MAQUINA",
                equipamento_id=eq.id,
                tipo_equipamento="BiPAP",
                equipamento_patrimonio=identificador,
                equipamento_serie=identificador,
                itens_resumo=f"1x BiPAP ({patrimonio_prod[:60]})",
                empresa_id=emp_respmed.id,
                empresa_nome=emp_respmed.nome_fantasia,
                licitacao_id=lic_respmed.id,
                data_instalacao=data_contr,
                status="ATIVO",
                observacoes=f"{patrimonio_prod} · Identificador: {identificador}",
            )
            db.add(termo)
            db.flush()
            termos_existentes.add(codigo_termo)

            item = ItemEmprestimoOxigenio(
                emprestimo_id=termo.id,
                tipo_servico="MAQUINA",
                equipamento_id=eq.id,
                tipo_equipamento="BiPAP",
                equipamento_patrimonio=identificador,
                equipamento_serie=identificador,
                quantidade=1,
                status="ATIVO",
            )
            db.add(item)
            total_bipap += 1

    # 6. CARGA DE CONCENTRADOR ATIVO (Aba 'Concentrador ATIVO')
    total_conc_ativos = 0
    if "Concentrador ATIVO" in wb.sheetnames:
        ws_ca = wb["Concentrador ATIVO"]
        for r in range(3, ws_ca.max_row + 1):
            nome_pac = _limpar_texto(ws_ca.cell(r, 4).value)
            if not nome_pac or "TOTAL" in nome_pac.upper():
                continue

            pront_raw = ws_ca.cell(r, 3).value
            prontuario = _limpar_texto(int(pront_raw) if isinstance(pront_raw, (int, float)) else pront_raw)
            data_inst = _converter_data(ws_ca.cell(r, 9).value or ws_ca.cell(r, 2).value, default_data=date(2025, 1, 15))
            telefone = _limpar_texto(ws_ca.cell(r, 5).value)
            endereco = _limpar_texto(ws_ca.cell(r, 6).value)

            patrimonio_prod = _limpar_texto(ws_ca.cell(r, 7).value) or "CONCENTRADOR DE OXIGENIO"
            ident_raw = ws_ca.cell(r, 8).value
            identificador = _limpar_texto(int(ident_raw) if isinstance(ident_raw, (int, float)) else ident_raw) or f"EP-CA-{r}"
            codigo_termo = f"TRM-CONC-{r:03d}"
            if codigo_termo in termos_existentes:
                continue

            # Verifica se é 10 Litros
            eh_10l = "10L" in identificador.upper() or "10 LITROS" in patrimonio_prod.upper() or "10L" in patrimonio_prod.upper()
            tipo_conc = "CONCENTRADOR_10L" if eh_10l else "CONCENTRADOR_5L"
            rotulo_conc = "Concentrador 10L" if eh_10l else "Concentrador 5L"

            situacao_raw = _limpar_texto(ws_ca.cell(r, 10).value).upper()
            status_empr = "INATIVO" if "INATIV" in situacao_raw else "ATIVO"
            obs = _limpar_texto(ws_ca.cell(r, 12).value)

            c1_raw = ws_ca.cell(r, 13).value
            c3_raw = ws_ca.cell(r, 14).value
            c10_raw = ws_ca.cell(r, 15).value

            def _parse_qtd(v):
                try:
                    return int(float(v)) if v is not None and str(v).strip() and float(v) > 0 else 0
                except Exception:
                    return 0

            qtd_1m3 = _parse_qtd(c1_raw)
            qtd_3m3 = _parse_qtd(c3_raw)
            qtd_10m3 = _parse_qtd(c10_raw)

            partes_apoio = []
            if qtd_10m3 > 0:
                partes_apoio.append(f"{qtd_10m3}x 10m³")
            if qtd_3m3 > 0:
                partes_apoio.append(f"{qtd_3m3}x 3m³")
            if qtd_1m3 > 0:
                partes_apoio.append(f"{qtd_1m3}x 1m³")
            resumo_conc = f"1x {rotulo_conc} (Patr: {identificador})"
            if partes_apoio:
                resumo_conc += f" + Cilindro de apoio ({', '.join(partes_apoio)})"

            # Equipamento (sempre com tipo_servico="MAQUINA")
            eq = _obter_ou_criar_equipamento(
                db,
                tipo=tipo_conc,
                patrimonio=identificador,
                marca_modelo=patrimonio_prod[:100],
                empresa=emp_respmed,
                status="EM_USO" if status_empr == "ATIVO" else "DISPONIVEL",
                data_aquisicao=data_inst,
                observacoes=obs,
                cache_eq=cache_eq,
            )

            pac = _obter_ou_criar_paciente(
                db, nome=nome_pac, prontuario=prontuario, telefone=telefone, endereco=endereco, cache_pacientes=cache_pacientes
            )
            termo = EmprestimoOxigenio(
                codigo_termo=codigo_termo,
                paciente_id=pac.id,
                paciente_nome=pac.nome,
                paciente_cpf=pac.cpf or "",
                paciente_cns=pac.cns or "",
                paciente_prontuario=pac.codigo_prontuario or "",
                paciente_telefone=pac.telefone,
                paciente_endereco=pac.endereco,
                tipo_servico="MAQUINA",
                equipamento_id=eq.id,
                tipo_equipamento=tipo_conc,
                equipamento_patrimonio=identificador,
                equipamento_serie=identificador,
                itens_resumo=resumo_conc,
                empresa_id=emp_respmed.id,
                empresa_nome=emp_respmed.nome_fantasia,
                licitacao_id=lic_respmed.id,
                data_instalacao=data_inst,
                status=status_empr,
                observacoes=f"{patrimonio_prod} · {obs}".strip(" ·"),
            )
            db.add(termo)
            db.flush()
            termos_existentes.add(codigo_termo)

            # Item do concentrador
            db.add(ItemEmprestimoOxigenio(
                emprestimo_id=termo.id,
                tipo_servico="MAQUINA",
                equipamento_id=eq.id,
                tipo_equipamento=tipo_conc,
                equipamento_patrimonio=identificador,
                equipamento_serie=identificador,
                quantidade=1,
                status=status_empr,
            ))

            # Cilindros de apoio que acompanham o concentrador (não são cilindros avulsos de estoque)
            if qtd_10m3 > 0:
                db.add(ItemEmprestimoOxigenio(
                    emprestimo_id=termo.id,
                    tipo_servico="OXIGENIO",
                    tipo_cilindro="10m3",
                    finalidade_cilindro="SEMANAL_CONCENTRADOR",
                    quantidade=qtd_10m3,
                    posse_cilindro="COMODATO",
                    acompanha_equipamento=True,
                    status=status_empr,
                    observacoes="Cilindro de apoio vinculado ao concentrador",
                ))
            if qtd_3m3 > 0:
                db.add(ItemEmprestimoOxigenio(
                    emprestimo_id=termo.id,
                    tipo_servico="OXIGENIO",
                    tipo_cilindro="3m3",
                    finalidade_cilindro="FIXO_CONCENTRADOR",
                    quantidade=qtd_3m3,
                    posse_cilindro="COMODATO",
                    acompanha_equipamento=True,
                    status=status_empr,
                    observacoes="Cilindro de apoio vinculado ao concentrador",
                ))
            if qtd_1m3 > 0:
                db.add(ItemEmprestimoOxigenio(
                    emprestimo_id=termo.id,
                    tipo_servico="OXIGENIO",
                    tipo_cilindro="1m3",
                    finalidade_cilindro="TRANSPORTE_ESPECIAL",
                    quantidade=qtd_1m3,
                    posse_cilindro="COMODATO",
                    acompanha_equipamento=True,
                    status=status_empr,
                    observacoes="Cilindro de transporte vinculado ao concentrador",
                ))

            total_conc_ativos += 1

    # 7. CARGA DE CONCENTRADOR INATIVO (Aba 'Concentrador INATIVOS')
    total_conc_inativos = 0
    if "Concentrador INATIVOS" in wb.sheetnames:
        ws_ci = wb["Concentrador INATIVOS"]
        for r in range(3, ws_ci.max_row + 1):
            nome_pac = _limpar_texto(ws_ci.cell(r, 4).value)
            if not nome_pac or "TOTAL" in nome_pac.upper():
                continue

            pront_raw = ws_ci.cell(r, 2).value
            prontuario = _limpar_texto(int(pront_raw) if isinstance(pront_raw, (int, float)) else pront_raw)
            data_inst = _converter_data(ws_ci.cell(r, 9).value or ws_ci.cell(r, 3).value, default_data=date(2025, 1, 1))
            data_enc = _converter_data(ws_ci.cell(r, 10).value, default_data=date(2026, 5, 1))
            telefone = _limpar_texto(ws_ci.cell(r, 5).value)
            endereco = _limpar_texto(ws_ci.cell(r, 6).value)

            patrimonio_prod = _limpar_texto(ws_ci.cell(r, 7).value) or "CONCENTRADOR DE OXIGENIO"
            ident_raw = ws_ci.cell(r, 8).value
            identificador = _limpar_texto(int(ident_raw) if isinstance(ident_raw, (int, float)) else ident_raw) or f"EP-CI-{r}"
            codigo_termo = f"TRM-INAT-{r:03d}"
            if codigo_termo in termos_existentes:
                continue
            obs = _limpar_texto(ws_ci.cell(r, 12).value) or "Óbito / Encerramento do tratamento"

            eh_10l_in = "10L" in identificador.upper() or "10 LITROS" in patrimonio_prod.upper() or "10L" in patrimonio_prod.upper()
            tipo_conc_in = "CONCENTRADOR_10L" if eh_10l_in else "CONCENTRADOR_5L"

            eq = _obter_ou_criar_equipamento(
                db,
                tipo=tipo_conc_in,
                patrimonio=identificador,
                marca_modelo=patrimonio_prod[:100],
                empresa=emp_respmed,
                status="DISPONIVEL",
                data_aquisicao=data_inst,
                observacoes=f"Inativo: {obs}",
                cache_eq=cache_eq,
            )

            pac = _obter_ou_criar_paciente(
                db, nome=nome_pac, prontuario=prontuario, telefone=telefone, endereco=endereco, cache_pacientes=cache_pacientes
            )
            termo = EmprestimoOxigenio(
                codigo_termo=codigo_termo,
                paciente_id=pac.id,
                paciente_nome=pac.nome,
                paciente_cpf=pac.cpf or "",
                paciente_cns=pac.cns or "",
                paciente_prontuario=pac.codigo_prontuario or "",
                paciente_telefone=pac.telefone,
                paciente_endereco=pac.endereco,
                tipo_servico="MAQUINA",
                equipamento_id=eq.id,
                tipo_equipamento=tipo_conc_in,
                equipamento_patrimonio=identificador,
                equipamento_serie=identificador,
                itens_resumo=f"1x {'Concentrador 10L' if eh_10l_in else 'Concentrador 5L'} (Patr: {identificador})",
                empresa_id=emp_respmed.id,
                empresa_nome=emp_respmed.nome_fantasia,
                licitacao_id=lic_respmed.id,
                data_instalacao=data_inst,
                status="INATIVO",
                data_devolucao=data_enc,
                motivo_inativacao=obs,
                observacoes=f"{patrimonio_prod} · Inativo ({obs})",
            )
            db.add(termo)
            db.flush()
            termos_existentes.add(codigo_termo)

            db.add(ItemEmprestimoOxigenio(
                emprestimo_id=termo.id,
                tipo_servico="MAQUINA",
                equipamento_id=eq.id,
                tipo_equipamento=tipo_conc_in,
                equipamento_patrimonio=identificador,
                equipamento_serie=identificador,
                quantidade=1,
                status="INATIVO",
            ))

            total_conc_inativos += 1

    # 8. CARGA DE ABASTECIMENTOS REAIS DE OXIGÊNIO (Aba 'Abastecimento Oxigênio')
    nfs_existentes = {
        (c.numero_nf or "").strip()
        for c in db.exec(select(EntradaCompraOxigenio).where(EntradaCompraOxigenio.empresa_id == emp_pitia.id)).all()
        if (c.numero_nf or "").strip()
    }
    total_abastecimentos = 0
    if "Abastecimento Oxigênio" in wb.sheetnames:
        ws_ab = wb["Abastecimento Oxigênio"]
        curr_data = date(2026, 5, 6)
        curr_mes_nome = "MAIO DE 2026"

        for r in range(2, 60):
            val_b = ws_ab.cell(r, 2).value
            val_c = ws_ab.cell(r, 3).value
            val_d = ws_ab.cell(r, 4).value
            val_e = ws_ab.cell(r, 5).value

            if val_b and isinstance(val_b, str) and ("DE 202" in val_b.upper() or "ABASTECIMENTO" in val_b.upper()):
                curr_mes_nome = val_b.strip()
            if isinstance(val_b, (datetime, date)):
                curr_data = val_b.date() if isinstance(val_b, datetime) else val_b

            if val_c and val_d and ("10M" in str(val_d).upper() or "3M" in str(val_d).upper() or "1M" in str(val_d).upper()):
                try:
                    num_nf = f"NF-ABAST-{r:02d}"
                    if num_nf in nfs_existentes:
                        continue
                    qtd = int(float(val_c))
                    desc = str(val_d).strip()
                    val_tot = float(val_e) if val_e is not None else 0.0

                    q10 = qtd if "10M" in desc.upper() else 0
                    q3 = qtd if "3M" in desc.upper() else 0
                    q1 = qtd if "1M" in desc.upper() else 0

                    if val_tot <= 0:
                        val_tot = (q10 * 99.0) + (q3 * 115.0) + (q1 * 65.0)

                    db.add(EntradaCompraOxigenio(
                        licitacao_id=lic_pitia.id,
                        empresa_id=emp_pitia.id,
                        empresa_nome=emp_pitia.nome_fantasia,
                        data_compra=curr_data,
                        numero_nf=num_nf,
                        qtd_10m3=q10,
                        qtd_3m3=q3,
                        qtd_1m3=q1,
                        valor_total=val_tot,
                        responsavel_recebimento="Almoxarifado Central / SMS Guapé",
                        observacoes=f"Abastecimento {curr_mes_nome} ({desc}) conforme planilha oficial",
                    ))
                    nfs_existentes.add(num_nf)
                    total_abastecimentos += 1
                except Exception:
                    pass

    # Abastecimentos adicionais registrados em 'Oxigenio fechamento' para Setembro/2026
    if "Oxigenio fechamento" in wb.sheetnames:
        for num_nf_set, dt_set, q10_s, q3_s, q1_s, desc_set in [
            ("NF-ABAST-SET-01", date(2026, 9, 4), 3, 3, 3, "04/09/2026"),
            ("NF-ABAST-SET-02", date(2026, 9, 25), 5, 3, 4, "25/09/2026"),
        ]:
            if num_nf_set in nfs_existentes:
                continue
            db.add(EntradaCompraOxigenio(
                licitacao_id=lic_pitia.id,
                empresa_id=emp_pitia.id,
                empresa_nome=emp_pitia.nome_fantasia,
                data_compra=dt_set,
                numero_nf=num_nf_set,
                qtd_10m3=q10_s,
                qtd_3m3=q3_s,
                qtd_1m3=q1_s,
                valor_total=round(q10_s * 99.0 + q3_s * 115.0 + q1_s * 65.0, 2),
                responsavel_recebimento="Almoxarifado Central / SMS Guapé",
                observacoes=f"Abastecimento Setembro/2026 ({desc_set}) conforme planilha oficial",
            ))
            nfs_existentes.add(num_nf_set)
            total_abastecimentos += 1

    # 9. CARGA DOS SALDOS DE COMODATO OFICIAIS (Aba 'Oxigenio fechamento')
    # Registra a entrada inicial dos cilindros emprestados pela Comercial Pitia Ltda
    comodatos_existentes = {
        m.tipo_cilindro
        for m in db.exec(
            select(CilindroComodatoMovimentacao).where(
                CilindroComodatoMovimentacao.empresa_id == emp_pitia.id,
                CilindroComodatoMovimentacao.numero_documento == "TERMO-COMODATO-OFICIAL",
            )
        ).all()
    }
    comodatos = [
        ("10m3", 28, "Cilindros de 10m³ em comodato cedidos pela fornecedora para suporte municipal"),
        ("3m3", 15, "Cilindros de 3m³ em comodato cedidos pela fornecedora"),
        ("1m3", 15, "Cilindros de 1m³ em comodato cedidos pela fornecedora para transporte"),
    ]
    comodatos_inseridos = 0
    for tipo_c, qtd, obs in comodatos:
        if tipo_c in comodatos_existentes:
            continue
        db.add(CilindroComodatoMovimentacao(
            empresa_id=emp_pitia.id,
            empresa_nome=emp_pitia.nome_fantasia,
            tipo_movimentacao="ENTRADA_COMODATO",
            tipo_cilindro=tipo_c,
            quantidade=qtd,
            data_movimento=date(2026, 5, 1),
            numero_documento="TERMO-COMODATO-OFICIAL",
            responsavel="Coordenação de Oxigenoterapia",
            observacoes=obs,
        ))
        comodatos_inseridos += 1

    db.commit()

    return {
        "ok": True,
        "empresas": 3,
        "licitacoes": 3,
        "cpap_importados": total_cpap,
        "bipap_importados": total_bipap,
        "concentradores_ativos_importados": total_conc_ativos,
        "concentradores_inativos_importados": total_conc_inativos,
        "abastecimentos_oxigenio_importados": total_abastecimentos,
        "comodato_movimentacoes_iniciais": len(comodatos),
    }
