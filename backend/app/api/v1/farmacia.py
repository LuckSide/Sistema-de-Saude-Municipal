import json
import secrets
from datetime import date, datetime
from typing import Any, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session, select, func

from app.db.session import engine
from app.models.user import User
from app.models.farmacia import (
    Medicamento,
    MovimentacaoMedicamento,
    InsumoInterno,
    MovimentacaoInsumo,
    FarmaciaLinkPublico,
)
from app.schemas.farmacia import (
    MedicamentoCriar,
    MedicamentoAtualizar,
    MedicamentoOut,
    MovimentacaoMedicamentoCriar,
    MovimentacaoMedicamentoOut,
    InsumoInternoCriar,
    InsumoInternoAtualizar,
    InsumoInternoOut,
    MovimentacaoInsumoCriar,
    MovimentacaoInsumoOut,
    FarmaciaLinkPublicoCriar,
    FarmaciaLinkPublicoOut,
    FarmaciaPainelPublicoResponse,
    ItemDisponibilidadePublicaOut,
    FarmaciaResumoCardsOut,
    calcular_contagem_regressiva,
)
from app.api.v1.users import get_current_user
from app.services.permissoes import need_any_perm
from app.services.export_xlsx import resposta_xlsx

router = APIRouter()


def get_db():
    with Session(engine) as session:
        yield session


# --- Funções Auxiliares de Enriquecimento ---

def enriquecer_medicamento(m: Medicamento) -> MedicamentoOut:
    status_val, texto_val, dias_restantes = calcular_contagem_regressiva(m.validade)

    minimo = m.estoque_minimo if m.estoque_minimo is not None else 10
    if m.estoque_atual <= 0:
        status_est = "ZERADO"
    elif minimo > 0 and m.estoque_atual <= (minimo // 2):
        status_est = "CRITICO"
    elif m.estoque_atual <= minimo:
        status_est = "BAIXO"
    else:
        status_est = "NORMAL"

    return MedicamentoOut(
        id=m.id,
        codigo=m.codigo,
        nome=m.nome,
        principio_ativo=m.principio_ativo or "",
        dosagem=m.dosagem or "",
        forma_farmaceutica=m.forma_farmaceutica or "Comprimido",
        unidade_medida=m.unidade_medida or "comprimido",
        categoria=m.categoria or "Básico / Atenção Primária",
        fabricante=m.fabricante or "",
        lote=m.lote or "",
        validade=m.validade,
        estoque_atual=m.estoque_atual,
        estoque_minimo=minimo,
        requer_receita=m.requer_receita,
        controlado=m.controlado,
        localizacao_prateleira=m.localizacao_prateleira or "",
        observacoes=m.observacoes or "",
        ativo=m.ativo,
        status_estoque=status_est,
        status_validade=status_val,
        contagem_regressiva_texto=texto_val,
        dias_para_vencer=dias_restantes,
        created_at=m.created_at,
        updated_at=m.updated_at,
    )


def enriquecer_insumo(ins: InsumoInterno) -> InsumoInternoOut:
    status_val, texto_val, dias_restantes = calcular_contagem_regressiva(ins.validade)

    minimo = ins.estoque_minimo if ins.estoque_minimo is not None else 10
    if ins.estoque_atual <= 0:
        status_est = "ZERADO"
    elif minimo > 0 and ins.estoque_atual <= (minimo // 2):
        status_est = "CRITICO"
    elif ins.estoque_atual <= minimo:
        status_est = "BAIXO"
    else:
        status_est = "NORMAL"

    return InsumoInternoOut(
        id=ins.id,
        codigo=ins.codigo,
        nome=ins.nome,
        categoria=ins.categoria or "Material de Consumo",
        unidade_medida=ins.unidade_medida or "unidade",
        lote=ins.lote or "",
        validade=ins.validade,
        estoque_atual=ins.estoque_atual,
        estoque_minimo=ins.estoque_minimo,
        local_armazenamento=ins.local_armazenamento or "",
        observacoes=ins.observacoes or "",
        ativo=ins.ativo,
        status_estoque=status_est,
        status_validade=status_val,
        contagem_regressiva_texto=texto_val,
        dias_para_vencer=dias_restantes,
        created_at=ins.created_at,
        updated_at=ins.updated_at,
    )


def garantir_dados_iniciais(db: Session):
    """Insere medicamentos e insumos padrão se as tabelas estiverem vazias."""
    qtd_meds = db.exec(select(func.count(Medicamento.id))).one()
    if qtd_meds == 0:
        hoje = date.today()
        from datetime import timedelta

        itens_iniciais = [
            Medicamento(
                codigo="MED-001",
                nome="Dipirona Monoidratada",
                principio_ativo="Dipirona",
                dosagem="500 mg",
                forma_farmaceutica="Comprimido",
                unidade_medida="comprimido",
                categoria="Básico / Atenção Primária",
                fabricante="Medley / Prati-Donaduzzi",
                lote="L-2026A1",
                validade=hoje + timedelta(days=220),
                estoque_atual=1450,
                estoque_minimo=300,
                requer_receita=False,
                controlado=False,
                localizacao_prateleira="Armário A · Prateleira 1",
                ativo=True,
            ),
            Medicamento(
                codigo="MED-002",
                nome="Paracetamol",
                principio_ativo="Paracetamol",
                dosagem="750 mg",
                forma_farmaceutica="Comprimido",
                unidade_medida="comprimido",
                categoria="Básico / Atenção Primária",
                fabricante="EMS",
                lote="L-2026B3",
                validade=hoje + timedelta(days=18),  # Próximo do vencimento (amarelo)
                estoque_atual=340,
                estoque_minimo=200,
                requer_receita=False,
                controlado=False,
                localizacao_prateleira="Armário A · Prateleira 2",
                ativo=True,
            ),
            Medicamento(
                codigo="MED-003",
                nome="Losartana Potássica",
                principio_ativo="Losartana",
                dosagem="50 mg",
                forma_farmaceutica="Comprimido Revestido",
                unidade_medida="comprimido",
                categoria="Hipertensão / Diabetes",
                fabricante="Eurofarma",
                lote="L-2025Z9",
                validade=hoje - timedelta(days=4),  # Vencido (vermelho)
                estoque_atual=85,
                estoque_minimo=150,
                requer_receita=True,
                controlado=False,
                localizacao_prateleira="Armário B · Prateleira 1",
                ativo=True,
            ),
            Medicamento(
                codigo="MED-004",
                nome="Amoxicilina + Clavulanato de Potássio",
                principio_ativo="Amoxicilina / Clavulanato",
                dosagem="500 mg + 125 mg",
                forma_farmaceutica="Comprimido",
                unidade_medida="comprimido",
                categoria="Antibióticos",
                fabricante="Aché",
                lote="L-2026C4",
                validade=hoje + timedelta(days=180),
                estoque_atual=12,
                estoque_minimo=80,  # Estoque crítico
                requer_receita=True,
                controlado=False,
                localizacao_prateleira="Armário C · Prateleira 1",
                ativo=True,
            ),
            Medicamento(
                codigo="MED-005",
                nome="Clonazepam",
                principio_ativo="Clonazepam",
                dosagem="2 mg",
                forma_farmaceutica="Comprimido",
                unidade_medida="comprimido",
                categoria="Controlado / Portaria 344",
                fabricante="Roche / EMS",
                lote="L-2026D7",
                validade=hoje + timedelta(days=320),
                estoque_atual=210,
                estoque_minimo=50,
                requer_receita=True,
                controlado=True,
                localizacao_prateleira="Armário Trancado / Psicotrópicos",
                ativo=True,
            ),
            Medicamento(
                codigo="MED-006",
                nome="Omeprazol",
                principio_ativo="Omeprazol",
                dosagem="20 mg",
                forma_farmaceutica="Cápsula",
                unidade_medida="cápsula",
                categoria="Básico / Atenção Primária",
                fabricante="Medley",
                lote="L-2026E2",
                validade=hoje + timedelta(days=26),  # Próximo vencimento (amarelo)
                estoque_atual=0,  # Zerado
                estoque_minimo=100,
                requer_receita=False,
                controlado=False,
                localizacao_prateleira="Armário A · Prateleira 3",
                ativo=True,
            ),
        ]
        db.add_all(itens_iniciais)
        db.commit()

    qtd_insumos = db.exec(select(func.count(InsumoInterno.id))).one()
    if qtd_insumos == 0:
        hoje = date.today()
        from datetime import timedelta

        insumos_iniciais = [
            InsumoInterno(
                codigo="INS-001",
                nome="Seringa Descartável 5ml c/ Agulha",
                categoria="Injetáveis / Acesso",
                unidade_medida="unidade",
                lote="SR-2026A",
                validade=hoje + timedelta(days=400),
                estoque_atual=850,
                estoque_minimo=200,
                local_armazenamento="Almoxarifado Central · Setor Injetáveis",
                ativo=True,
            ),
            InsumoInterno(
                codigo="INS-002",
                nome="Luvas de Procedimento Não Cirúrgico Tam. M",
                categoria="EPI / Proteção",
                unidade_medida="caixa c/ 100",
                lote="LV-2026M",
                validade=hoje + timedelta(days=700),
                estoque_atual=45,
                estoque_minimo=15,
                local_armazenamento="Almoxarifado Central · Prateleira 4",
                ativo=True,
            ),
            InsumoInterno(
                codigo="INS-003",
                nome="Máscara Cirúrgica Tripla c/ Elástico",
                categoria="EPI / Proteção",
                unidade_medida="caixa c/ 50",
                lote="MS-2026X",
                validade=hoje + timedelta(days=500),
                estoque_atual=80,
                estoque_minimo=20,
                local_armazenamento="Almoxarifado Central · Prateleira 3",
                ativo=True,
            ),
            InsumoInterno(
                codigo="INS-004",
                nome="Álcool em Gel 70% Frasco 500ml",
                categoria="Higiene & Assepsia",
                unidade_medida="frasco",
                lote="ALC-2026",
                validade=hoje + timedelta(days=22),  # Próximo vencimento
                estoque_atual=8,
                estoque_minimo=25,  # Estoque crítico
                local_armazenamento="Almoxarifado Central · Produtos Químicos",
                ativo=True,
            ),
            InsumoInterno(
                codigo="INS-005",
                nome="Gaze Estéril 7,5cm x 7,5cm",
                categoria="Curativos",
                unidade_medida="pacote c/ 10",
                lote="GZ-2026B",
                validade=hoje + timedelta(days=300),
                estoque_atual=620,
                estoque_minimo=150,
                local_armazenamento="Almoxarifado Central · Setor Curativos",
                ativo=True,
            ),
        ]
        db.add_all(insumos_iniciais)
        db.commit()


# ==========================================
# 1. Resumo Geral e Dashboard
# ==========================================

@router.get("/resumo", response_model=FarmaciaResumoCardsOut)
def obter_resumo_farmacia(
    db: Session = Depends(get_db),
    ator: User = Depends(need_any_perm("farmacia_estoque", "farmacia", "usuarios")),
):
    garantir_dados_iniciais(db)

    meds = db.exec(select(Medicamento).where(Medicamento.ativo == True)).all()
    hoje = date.today()

    total_meds = len(meds)
    total_baixo = 0
    total_zerado = 0
    total_prox_venc = 0
    total_venc = 0

    for m in meds:
        if m.estoque_atual <= 0:
            total_zerado += 1
            total_baixo += 1
        elif m.estoque_atual <= m.estoque_minimo:
            total_baixo += 1

        if m.validade:
            dias = (m.validade - hoje).days
            if dias < 0:
                total_venc += 1
            elif dias <= 30:
                total_prox_venc += 1

    # Movimentações do mês
    inicio_mes_dt = datetime(hoje.year, hoje.month, 1)
    try:
        movs = db.exec(
            select(MovimentacaoMedicamento).where(
                MovimentacaoMedicamento.created_at >= inicio_mes_dt
            )
        ).all()
    except Exception:
        movs = []

    total_dispensacoes = sum(1 for mv in movs if mv.tipo.startswith("SAIDA"))
    total_entradas = sum(1 for mv in movs if mv.tipo.startswith("ENTRADA"))

    # Insumos
    insumos = db.exec(select(InsumoInterno).where(InsumoInterno.ativo == True)).all()
    total_insumos = len(insumos)
    total_insumos_baixo = sum(1 for i in insumos if i.estoque_atual <= i.estoque_minimo)

    return FarmaciaResumoCardsOut(
        total_medicamentos=total_meds,
        total_estoque_baixo=total_baixo,
        total_estoque_zerado=total_zerado,
        total_proximos_vencimento=total_prox_venc,
        total_vencidos=total_venc,
        total_dispensacoes_mes=total_dispensacoes,
        total_entradas_mes=total_entradas,
        total_insumos=total_insumos,
        total_insumos_baixo=total_insumos_baixo,
    )


# ==========================================
# 2. Gestão de Medicamentos & Estoque
# ==========================================

@router.get("/medicamentos", response_model=List[MedicamentoOut])
def listar_medicamentos(
    q: Optional[str] = Query(None, description="Busca por nome, código ou princípio ativo"),
    categoria: Optional[str] = Query(None),
    status_estoque: Optional[str] = Query(None),  # "ZERADO", "BAIXO", "NORMAL"
    status_validade: Optional[str] = Query(None),  # "VENCIDO", "PROXIMO_VENCIMENTO", "VALIDO"
    somente_ativos: bool = True,
    db: Session = Depends(get_db),
    ator: User = Depends(need_any_perm("farmacia_estoque", "farmacia", "usuarios")),
):
    garantir_dados_iniciais(db)

    query = select(Medicamento)
    if somente_ativos:
        query = query.where(Medicamento.ativo == True)

    meds = db.exec(query.order_by(Medicamento.nome.asc())).all()
    resultado = [enriquecer_medicamento(m) for m in meds]

    if q and q.strip():
        termo = q.strip().lower()
        resultado = [
            r for r in resultado
            if termo in r.nome.lower()
            or termo in (r.principio_ativo or "").lower()
            or termo in r.codigo.lower()
            or termo in (r.fabricante or "").lower()
            or termo in (r.lote or "").lower()
        ]

    if categoria and categoria.strip():
        cat_norm = categoria.strip().lower()
        resultado = [r for r in resultado if cat_norm in (r.categoria or "").lower()]

    if status_estoque:
        if status_estoque.upper() == "ZERADO":
            resultado = [r for r in resultado if r.status_estoque == "ZERADO"]
        elif status_estoque.upper() == "BAIXO":
            resultado = [r for r in resultado if r.status_estoque in ("BAIXO", "CRITICO", "ZERADO")]
        elif status_estoque.upper() == "NORMAL":
            resultado = [r for r in resultado if r.status_estoque == "NORMAL"]

    if status_validade:
        alvo = status_validade.upper()
        resultado = [r for r in resultado if r.status_validade == alvo]

    return resultado


@router.post("/medicamentos", response_model=MedicamentoOut)
def cadastrar_medicamento(
    dados: MedicamentoCriar,
    db: Session = Depends(get_db),
    ator: User = Depends(need_any_perm("farmacia_estoque", "farmacia", "usuarios")),
):
    med = Medicamento(**dados.model_dump())
    db.add(med)
    db.commit()
    db.refresh(med)
    return enriquecer_medicamento(med)


@router.get("/medicamentos/{id}", response_model=MedicamentoOut)
def obter_medicamento(
    id: int,
    db: Session = Depends(get_db),
    ator: User = Depends(need_any_perm("farmacia_estoque", "farmacia", "usuarios")),
):
    med = db.get(Medicamento, id)
    if not med:
        raise HTTPException(status_code=404, detail="Medicamento não encontrado")
    return enriquecer_medicamento(med)


@router.put("/medicamentos/{id}", response_model=MedicamentoOut)
def atualizar_medicamento(
    id: int,
    dados: MedicamentoAtualizar,
    db: Session = Depends(get_db),
    ator: User = Depends(need_any_perm("farmacia_estoque", "farmacia", "usuarios")),
):
    med = db.get(Medicamento, id)
    if not med:
        raise HTTPException(status_code=404, detail="Medicamento não encontrado")

    campos = dados.model_dump(exclude_unset=True)
    for chave, valor in campos.items():
        setattr(med, chave, valor)

    med.updated_at = datetime.utcnow()
    db.add(med)
    db.commit()
    db.refresh(med)
    return enriquecer_medicamento(med)


@router.delete("/medicamentos/{id}")
def excluir_medicamento(
    id: int,
    db: Session = Depends(get_db),
    ator: User = Depends(need_any_perm("farmacia_estoque", "farmacia", "usuarios")),
):
    med = db.get(Medicamento, id)
    if not med:
        raise HTTPException(status_code=404, detail="Medicamento não encontrado")

    med.ativo = False
    med.updated_at = datetime.utcnow()
    db.add(med)
    db.commit()
    return {"sucesso": True, "mensagem": f"Medicamento {med.nome} inativado com sucesso."}


# ==========================================
# 3. Movimentações (Entrada e Dispensação)
# ==========================================

@router.post("/medicamentos/movimentar", response_model=MovimentacaoMedicamentoOut)
def registrar_movimentacao_medicamento(
    dados: MovimentacaoMedicamentoCriar,
    db: Session = Depends(get_db),
    ator: User = Depends(need_any_perm("farmacia_estoque", "farmacia", "usuarios")),
):
    if dados.quantidade <= 0:
        raise HTTPException(status_code=400, detail="A quantidade movimentada deve ser maior que zero.")

    med = db.get(Medicamento, dados.medicamento_id)
    if not med or not med.ativo:
        raise HTTPException(status_code=404, detail="Medicamento não encontrado ou inativo.")

    saldo_anterior = med.estoque_atual

    if dados.tipo.startswith("SAIDA"):
        if med.estoque_atual < dados.quantidade:
            raise HTTPException(
                status_code=400,
                detail=f"Saldo insuficiente em estoque. Saldo atual: {med.estoque_atual} {med.unidade_medida}(s), tentativa de baixa: {dados.quantidade}."
            )
        saldo_posterior = med.estoque_atual - dados.quantidade
    else:  # ENTRADA
        saldo_posterior = med.estoque_atual + dados.quantidade

    med.estoque_atual = saldo_posterior
    if dados.lote:
        med.lote = dados.lote
    if dados.validade:
        med.validade = dados.validade
    med.updated_at = datetime.utcnow()
    db.add(med)

    mov = MovimentacaoMedicamento(
        medicamento_id=med.id,
        medicamento_nome=med.nome,
        tipo=dados.tipo,
        quantidade=dados.quantidade,
        lote=dados.lote or med.lote or "",
        validade=dados.validade or med.validade,
        saldo_anterior=saldo_anterior,
        saldo_posterior=saldo_posterior,
        documento_referencia=dados.documento_referencia or "",
        paciente_nome=dados.paciente_nome or "",
        paciente_cpf=dados.paciente_cpf or "",
        paciente_cns=dados.paciente_cns or "",
        prescritor_nome=dados.prescritor_nome or "",
        prescritor_crm=dados.prescritor_crm or "",
        motivo_descarte=dados.motivo_descarte or "",
        responsavel_usuario=ator.nome,
        observacoes=dados.observacoes or "",
    )
    db.add(mov)
    db.commit()
    db.refresh(mov)

    return mov


@router.get("/medicamentos/movimentacoes", response_model=List[MovimentacaoMedicamentoOut])
def listar_movimentacoes_medicamento(
    medicamento_id: Optional[int] = Query(None),
    tipo: Optional[str] = Query(None),
    termo_paciente: Optional[str] = Query(None),
    limite: int = 100,
    db: Session = Depends(get_db),
    ator: User = Depends(need_any_perm("farmacia_estoque", "farmacia", "usuarios")),
):
    query = select(MovimentacaoMedicamento)
    if medicamento_id:
        query = query.where(MovimentacaoMedicamento.medicamento_id == medicamento_id)
    if tipo:
        query = query.where(MovimentacaoMedicamento.tipo == tipo)
    if termo_paciente and termo_paciente.strip():
        tp = f"%{termo_paciente.strip().lower()}%"
        query = query.where(
            func.lower(MovimentacaoMedicamento.paciente_nome).like(tp) |
            func.lower(MovimentacaoMedicamento.paciente_cpf).like(tp)
        )

    movs = db.exec(
        query.order_by(MovimentacaoMedicamento.created_at.desc()).limit(limite)
    ).all()
    return movs


# ==========================================
# 4. Controle de Validade & Contagem Regressiva
# ==========================================

@router.get("/validade", response_model=List[MedicamentoOut])
def listar_painel_validade(
    dias_corte: int = Query(30, description="Corte para alerta de proximidade"),
    apenas_atencao: bool = Query(False, description="Exibir apenas vencidos ou próximos do vencimento"),
    db: Session = Depends(get_db),
    ator: User = Depends(need_any_perm("farmacia_validade", "farmacia", "usuarios")),
):
    garantir_dados_iniciais(db)

    meds = db.exec(
        select(Medicamento)
        .where(Medicamento.ativo == True)
        .where(Medicamento.validade != None)
        .order_by(Medicamento.validade.asc())
    ).all()

    enriquecidos = [enriquecer_medicamento(m) for m in meds]

    if apenas_atencao:
        enriquecidos = [
            m for m in enriquecidos
            if m.status_validade in ("VENCIDO", "PROXIMO_VENCIMENTO")
        ]

    return enriquecidos


@router.get("/validade/exportar")
def exportar_validade_xlsx(
    db: Session = Depends(get_db),
    ator: User = Depends(need_any_perm("farmacia_validade", "farmacia", "usuarios")),
):
    meds = db.exec(
        select(Medicamento)
        .where(Medicamento.ativo == True)
        .order_by(Medicamento.validade.asc())
    ).all()

    linhas: list[dict[str, Any]] = []
    for m in meds:
        status_val, texto_val, dias = calcular_contagem_regressiva(m.validade)
        linhas.append({
            "codigo": m.codigo,
            "nome": m.nome,
            "principio_ativo": m.principio_ativo or "—",
            "dosagem": m.dosagem or "—",
            "categoria": m.categoria or "—",
            "lote": m.lote or "—",
            "validade": m.validade,
            "status_validade": status_val,
            "contagem_regressiva": texto_val,
            "estoque_atual": m.estoque_atual,
            "unidade": m.unidade_medida,
            "localizacao": m.localizacao_prateleira or "—",
        })

    colunas = [
        {"chave": "codigo", "rotulo": "Código", "largura": 12},
        {"chave": "nome", "rotulo": "Medicamento", "largura": 28},
        {"chave": "principio_ativo", "rotulo": "Princípio Ativo", "largura": 22},
        {"chave": "dosagem", "rotulo": "Dosagem", "largura": 14},
        {"chave": "categoria", "rotulo": "Categoria", "largura": 20},
        {"chave": "lote", "rotulo": "Lote", "largura": 14},
        {"chave": "validade", "rotulo": "Data de Validade", "formato": "data", "largura": 16},
        {"chave": "status_validade", "rotulo": "Situação", "largura": 18},
        {"chave": "contagem_regressiva", "rotulo": "Contagem Regressiva", "largura": 22},
        {"chave": "estoque_atual", "rotulo": "Saldo Atual", "largura": 14},
        {"chave": "unidade", "rotulo": "Unidade", "largura": 12},
        {"chave": "localizacao", "rotulo": "Localização", "largura": 24},
    ]

    return resposta_xlsx(
        titulo="Relatório de Controle de Validade e Lotes da Farmácia",
        usuario_nome=ator.nome,
        colunas=colunas,
        linhas=linhas,
        nome_arquivo="farmacia_controle_validade",
    )


# ==========================================
# 5. Insumos e Materiais Internos (Não Medicamentos)
# ==========================================

@router.get("/insumos", response_model=List[InsumoInternoOut])
def listar_insumos(
    q: Optional[str] = Query(None),
    categoria: Optional[str] = Query(None),
    somente_ativos: bool = True,
    db: Session = Depends(get_db),
    ator: User = Depends(need_any_perm("farmacia_insumos", "farmacia", "usuarios")),
):
    garantir_dados_iniciais(db)

    query = select(InsumoInterno)
    if somente_ativos:
        query = query.where(InsumoInterno.ativo == True)

    insumos = db.exec(query.order_by(InsumoInterno.nome.asc())).all()
    resultado = [enriquecer_insumo(i) for i in insumos]

    if q and q.strip():
        termo = q.strip().lower()
        resultado = [
            r for r in resultado
            if termo in r.nome.lower()
            or termo in r.codigo.lower()
            or termo in (r.lote or "").lower()
            or termo in (r.local_armazenamento or "").lower()
        ]

    if categoria and categoria.strip():
        cat_norm = categoria.strip().lower()
        resultado = [r for r in resultado if cat_norm in (r.categoria or "").lower()]

    return resultado


@router.post("/insumos", response_model=InsumoInternoOut)
def cadastrar_insumo(
    dados: InsumoInternoCriar,
    db: Session = Depends(get_db),
    ator: User = Depends(need_any_perm("farmacia_insumos", "farmacia", "usuarios")),
):
    ins = InsumoInterno(**dados.model_dump())
    db.add(ins)
    db.commit()
    db.refresh(ins)
    return enriquecer_insumo(ins)


@router.get("/insumos/{id}", response_model=InsumoInternoOut)
def obter_insumo(
    id: int,
    db: Session = Depends(get_db),
    ator: User = Depends(need_any_perm("farmacia_insumos", "farmacia", "usuarios")),
):
    ins = db.get(InsumoInterno, id)
    if not ins:
        raise HTTPException(status_code=404, detail="Insumo não encontrado")
    return enriquecer_insumo(ins)


@router.put("/insumos/{id}", response_model=InsumoInternoOut)
def atualizar_insumo(
    id: int,
    dados: InsumoInternoAtualizar,
    db: Session = Depends(get_db),
    ator: User = Depends(need_any_perm("farmacia_insumos", "farmacia", "usuarios")),
):
    ins = db.get(InsumoInterno, id)
    if not ins:
        raise HTTPException(status_code=404, detail="Insumo não encontrado")

    campos = dados.model_dump(exclude_unset=True)
    for chave, valor in campos.items():
        setattr(ins, chave, valor)

    ins.updated_at = datetime.utcnow()
    db.add(ins)
    db.commit()
    db.refresh(ins)
    return enriquecer_insumo(ins)


@router.delete("/insumos/{id}")
def excluir_insumo(
    id: int,
    db: Session = Depends(get_db),
    ator: User = Depends(need_any_perm("farmacia_insumos", "farmacia", "usuarios")),
):
    ins = db.get(InsumoInterno, id)
    if not ins:
        raise HTTPException(status_code=404, detail="Insumo não encontrado")

    ins.ativo = False
    ins.updated_at = datetime.utcnow()
    db.add(ins)
    db.commit()
    return {"sucesso": True, "mensagem": f"Insumo {ins.nome} inativado com sucesso."}


@router.post("/insumos/movimentar", response_model=MovimentacaoInsumoOut)
def registrar_movimentacao_insumo(
    dados: MovimentacaoInsumoCriar,
    db: Session = Depends(get_db),
    ator: User = Depends(need_any_perm("farmacia_insumos", "farmacia", "usuarios")),
):
    if dados.quantidade <= 0:
        raise HTTPException(status_code=400, detail="A quantidade movimentada deve ser maior que zero.")

    ins = db.get(InsumoInterno, dados.insumo_id)
    if not ins or not ins.ativo:
        raise HTTPException(status_code=404, detail="Insumo não encontrado ou inativo.")

    saldo_anterior = ins.estoque_atual

    if dados.tipo.startswith("SAIDA"):
        if ins.estoque_atual < dados.quantidade:
            raise HTTPException(
                status_code=400,
                detail=f"Saldo insuficiente de insumo. Saldo atual: {ins.estoque_atual} {ins.unidade_medida}(s), tentativa de saída: {dados.quantidade}."
            )
        saldo_posterior = ins.estoque_atual - dados.quantidade
    else:  # ENTRADA
        saldo_posterior = ins.estoque_atual + dados.quantidade

    ins.estoque_atual = saldo_posterior
    ins.updated_at = datetime.utcnow()
    db.add(ins)

    mov = MovimentacaoInsumo(
        insumo_id=ins.id,
        insumo_nome=ins.nome,
        tipo=dados.tipo,
        quantidade=dados.quantidade,
        saldo_anterior=saldo_anterior,
        saldo_posterior=saldo_posterior,
        unidade_destino=dados.unidade_destino or "",
        responsavel_recebimento=dados.responsavel_recebimento or "",
        documento_referencia=dados.documento_referencia or "",
        responsavel_usuario=ator.nome,
        observacoes=dados.observacoes or "",
    )
    db.add(mov)
    db.commit()
    db.refresh(mov)

    return mov


@router.get("/insumos/movimentacoes", response_model=List[MovimentacaoInsumoOut])
def listar_movimentacoes_insumos(
    insumo_id: Optional[int] = Query(None),
    tipo: Optional[str] = Query(None),
    limite: int = 100,
    db: Session = Depends(get_db),
    ator: User = Depends(need_any_perm("farmacia_insumos", "farmacia", "usuarios")),
):
    query = select(MovimentacaoInsumo)
    if insumo_id:
        query = query.where(MovimentacaoInsumo.insumo_id == insumo_id)
    if tipo:
        query = query.where(MovimentacaoInsumo.tipo == tipo)

    movs = db.exec(
        query.order_by(MovimentacaoInsumo.created_at.desc()).limit(limite)
    ).all()
    return movs


@router.get("/insumos/exportar")
def exportar_insumos_xlsx(
    db: Session = Depends(get_db),
    ator: User = Depends(need_any_perm("farmacia_insumos", "farmacia", "usuarios")),
):
    insumos = db.exec(
        select(InsumoInterno)
        .where(InsumoInterno.ativo == True)
        .order_by(InsumoInterno.categoria.asc(), InsumoInterno.nome.asc())
    ).all()

    linhas: list[dict[str, Any]] = []
    for i in insumos:
        status_val, texto_val, _ = calcular_contagem_regressiva(i.validade)
        linhas.append({
            "codigo": i.codigo,
            "nome": i.nome,
            "categoria": i.categoria or "—",
            "unidade": i.unidade_medida,
            "estoque_atual": i.estoque_atual,
            "estoque_minimo": i.estoque_minimo,
            "lote": i.lote or "—",
            "validade": i.validade,
            "situacao_validade": texto_val,
            "local": i.local_armazenamento or "—",
            "observacoes": i.observacoes or "—",
        })

    colunas = [
        {"chave": "codigo", "rotulo": "Código", "largura": 12},
        {"chave": "nome", "rotulo": "Insumo / Material", "largura": 30},
        {"chave": "categoria", "rotulo": "Categoria", "largura": 22},
        {"chave": "unidade", "rotulo": "Unidade", "largura": 14},
        {"chave": "estoque_atual", "rotulo": "Saldo Atual", "largura": 14},
        {"chave": "estoque_minimo", "rotulo": "Estoque Mínimo", "largura": 14},
        {"chave": "lote", "rotulo": "Lote", "largura": 14},
        {"chave": "validade", "rotulo": "Validade", "formato": "data", "largura": 16},
        {"chave": "situacao_validade", "rotulo": "Situação Validade", "largura": 20},
        {"chave": "local", "rotulo": "Local de Armazenamento", "largura": 24},
        {"chave": "observacoes", "rotulo": "Observações", "largura": 26},
    ]

    return resposta_xlsx(
        titulo="Controle de Insumos e Materiais Internos",
        usuario_nome=ator.nome,
        colunas=colunas,
        linhas=linhas,
        nome_arquivo="farmacia_insumos_internos",
    )


# ==========================================
# 6. Gerador de Links Públicos & Painéis TV / Paciente
# ==========================================

@router.get("/links", response_model=List[FarmaciaLinkPublicoOut])
def listar_links_publicos(
    db: Session = Depends(get_db),
    ator: User = Depends(need_any_perm("farmacia_links", "farmacia", "usuarios")),
):
    links = db.exec(
        select(FarmaciaLinkPublico)
        .where(FarmaciaLinkPublico.ativo == True)
        .order_by(FarmaciaLinkPublico.created_at.desc())
    ).all()

    res = []
    for l in links:
        try:
            ids = json.loads(l.medicamentos_ids or "[]")
        except Exception:
            ids = []
        res.append(
            FarmaciaLinkPublicoOut(
                id=l.id,
                token=l.token,
                url_publica=f"/farmacia/publico/{l.token}",
                titulo=l.titulo,
                tipo_perfil=l.tipo_perfil,
                mostrar_quantidade=l.mostrar_quantidade,
                filtro_tipo=l.filtro_tipo,
                medicamentos_ids=ids,
                categoria_filtro=l.categoria_filtro,
                tempo_atualizacao_segundos=l.tempo_atualizacao_segundos,
                mensagem_rodape=l.mensagem_rodape,
                ativo=l.ativo,
                visualizacoes_count=l.visualizacoes_count,
                created_by=l.created_by,
                created_at=l.created_at,
            )
        )
    return res


@router.post("/links", response_model=FarmaciaLinkPublicoOut)
def criar_link_publico(
    dados: FarmaciaLinkPublicoCriar,
    db: Session = Depends(get_db),
    ator: User = Depends(need_any_perm("farmacia_links", "farmacia", "usuarios")),
):
    token = secrets.token_urlsafe(16)
    med_ids_json = json.dumps(dados.medicamentos_ids or [])

    link = FarmaciaLinkPublico(
        token=token,
        titulo=dados.titulo or "Disponibilidade de Medicamentos",
        tipo_perfil=dados.tipo_perfil,
        mostrar_quantidade=dados.mostrar_quantidade if dados.tipo_perfil == "tv" else False,
        filtro_tipo=dados.filtro_tipo,
        medicamentos_ids=med_ids_json,
        categoria_filtro=dados.categoria_filtro or "",
        tempo_atualizacao_segundos=dados.tempo_atualizacao_segundos or 30,
        mensagem_rodape=dados.mensagem_rodape or "Secretaria Municipal de Saúde · Guapé / MG",
        ativo=True,
        visualizacoes_count=0,
        created_by=ator.nome,
    )
    db.add(link)
    db.commit()
    db.refresh(link)

    return FarmaciaLinkPublicoOut(
        id=link.id,
        token=link.token,
        url_publica=f"/farmacia/publico/{link.token}",
        titulo=link.titulo,
        tipo_perfil=link.tipo_perfil,
        mostrar_quantidade=link.mostrar_quantidade,
        filtro_tipo=link.filtro_tipo,
        medicamentos_ids=dados.medicamentos_ids or [],
        categoria_filtro=link.categoria_filtro,
        tempo_atualizacao_segundos=link.tempo_atualizacao_segundos,
        mensagem_rodape=link.mensagem_rodape,
        ativo=link.ativo,
        visualizacoes_count=link.visualizacoes_count,
        created_by=link.created_by,
        created_at=link.created_at,
    )


@router.delete("/links/{id}")
def revogar_link_publico(
    id: int,
    db: Session = Depends(get_db),
    ator: User = Depends(need_any_perm("farmacia_links", "farmacia", "usuarios")),
):
    link = db.get(FarmaciaLinkPublico, id)
    if not link:
        raise HTTPException(status_code=404, detail="Link público não encontrado")

    link.ativo = False
    db.add(link)
    db.commit()
    return {"sucesso": True, "mensagem": "Link revogado com sucesso."}


# ==========================================
# 7. Endpoint Público de Consulta (Sem Auth)
# ==========================================

@router.get("/publico/{token}", response_model=FarmaciaPainelPublicoResponse)
def consultar_painel_publico(
    token: str,
    db: Session = Depends(get_db),
):
    """Consulta pública tokenizada para Modo Paciente ou Modo TV (SEM necessidade de login)."""
    link = db.exec(
        select(FarmaciaLinkPublico).where(
            FarmaciaLinkPublico.token == token,
            FarmaciaLinkPublico.ativo == True,
        )
    ).first()

    if not link:
        raise HTTPException(status_code=404, detail="Painel ou Link de consulta inexistente ou desativado.")

    # Incrementa contador de visualizações
    link.visualizacoes_count += 1
    db.add(link)
    db.commit()

    # Busca medicamentos ativos
    query = select(Medicamento).where(Medicamento.ativo == True)

    try:
        med_ids = json.loads(link.medicamentos_ids or "[]")
    except Exception:
        med_ids = []

    if link.filtro_tipo == "especificos" and med_ids:
        query = query.where(Medicamento.id.in_(med_ids))
    elif link.filtro_tipo == "categoria" and link.categoria_filtro:
        query = query.where(func.lower(Medicamento.categoria).like(f"%{link.categoria_filtro.lower()}%"))

    meds = db.exec(query.order_by(Medicamento.nome.asc())).all()

    itens_out: List[ItemDisponibilidadePublicaOut] = []
    total_disp = 0
    total_indisp = 0

    for m in meds:
        disponivel = m.estoque_atual > 0
        if disponivel:
            total_disp += 1
            status_rot = "Disponível"
        else:
            total_indisp += 1
            status_rot = "Indisponível (Em Falta)"

        # Regra de Segurança:
        # Se perfil == 'paciente', quantidade_disponivel é estritamente None (omitida).
        # Se perfil == 'tv' e mostrar_quantidade == True, envia a quantidade.
        qtd_publica = None
        if link.tipo_perfil == "tv" and link.mostrar_quantidade:
            qtd_publica = m.estoque_atual

        itens_out.append(
            ItemDisponibilidadePublicaOut(
                id=m.id,
                nome=m.nome,
                principio_ativo=m.principio_ativo or "",
                dosagem=m.dosagem or "",
                forma_farmaceutica=m.forma_farmaceutica or "Comprimido",
                categoria=m.categoria or "Básico",
                disponivel=disponivel,
                status_rotulo=status_rot,
                requer_receita=m.requer_receita,
                quantidade_disponivel=qtd_publica,
            )
        )

    return FarmaciaPainelPublicoResponse(
        token=link.token,
        titulo=link.titulo,
        tipo_perfil=link.tipo_perfil,
        mostrar_quantidade=link.mostrar_quantidade,
        tempo_atualizacao_segundos=link.tempo_atualizacao_segundos,
        mensagem_rodape=link.mensagem_rodape,
        total_itens=len(itens_out),
        total_disponiveis=total_disp,
        total_indisponiveis=total_indisp,
        itens=itens_out,
        horario_servidor=datetime.utcnow(),
    )
