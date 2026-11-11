from datetime import date, datetime
from sqlalchemy import Column, Date, DateTime, Text
from sqlmodel import Field, SQLModel


class EmpresaOxigenio(SQLModel, table=True):
    __tablename__ = "oxigenio_empresas"

    id: int | None = Field(default=None, primary_key=True)
    razao_social: str = Field(max_length=200, index=True)
    nome_fantasia: str = Field(default="", max_length=200, index=True)
    cnpj: str = Field(default="", max_length=20, index=True)
    telefone: str = Field(default="", max_length=40)
    email: str = Field(default="", max_length=120)
    contato_responsavel: str = Field(default="", max_length=150)
    endereco: str = Field(default="", max_length=255)
    # Lista de serviços prestados em JSON:
    # ["oxigenio_cilindros", "locacao_concentrador", "locacao_cpap", "locacao_bipap", "manutencao", "insumos"]
    servicos: str = Field(default="[]", sa_column=Column(Text))

    # Valores unitários contratados / fornecidos da empresa
    valor_unitario_10m3: float = Field(default=0.0)
    valor_unitario_3m3: float = Field(default=0.0)
    valor_unitario_1m3: float = Field(default=0.0)
    valor_recarga_m3: float = Field(default=0.0)
    locacao_mensal_concentrador: float = Field(default=0.0)
    locacao_mensal_concentrador_5l: float = Field(default=0.0)
    locacao_mensal_concentrador_10l: float = Field(default=0.0)
    locacao_mensal_cpap: float = Field(default=0.0)
    locacao_mensal_bipap: float = Field(default=0.0)
    locacao_mensal_cilindro: float = Field(default=0.0)

    observacoes: str = Field(default="", sa_column=Column(Text))
    ativo: bool = Field(default=True, index=True)
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(DateTime(timezone=False)),
    )


class LicitacaoContratoOxigenio(SQLModel, table=True):
    __tablename__ = "oxigenio_licitacoes"

    id: int | None = Field(default=None, primary_key=True)
    empresa_id: int = Field(foreign_key="oxigenio_empresas.id", index=True)
    empresa_nome: str = Field(default="", max_length=200)
    numero_licitacao: str = Field(max_length=100, index=True)
    numero_contrato: str = Field(default="", max_length=100, index=True)
    ano: int = Field(default=2026, index=True)
    data_inicio: date | None = Field(default=None, sa_column=Column(Date))
    data_fim: date | None = Field(default=None, sa_column=Column(Date))
    objeto: str = Field(default="", sa_column=Column(Text))

    # Quantidades Contratadas por cilindro
    qtd_contratada_10m3: int = Field(default=0)
    qtd_contratada_3m3: int = Field(default=0)
    qtd_contratada_1m3: int = Field(default=0)

    # Valores unitários
    valor_unitario_10m3: float = Field(default=0.0)
    valor_unitario_3m3: float = Field(default=0.0)
    valor_unitario_1m3: float = Field(default=0.0)
    valor_recarga_m3: float = Field(default=0.0)
    locacao_mensal_concentrador: float = Field(default=0.0)
    locacao_mensal_concentrador_5l: float = Field(default=0.0)
    locacao_mensal_concentrador_10l: float = Field(default=0.0)
    locacao_mensal_cpap: float = Field(default=0.0)
    locacao_mensal_bipap: float = Field(default=0.0)
    locacao_mensal_cilindro: float = Field(default=0.0)
    valor_total_contrato: float = Field(default=0.0)

    # Limite percentual para alerta visual de estoque baixo
    saldo_alerta_minimo_pct: int = Field(default=20)
    ativo: bool = Field(default=True, index=True)
    observacoes: str = Field(default="", sa_column=Column(Text))
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(DateTime(timezone=False)),
    )


class EntradaCompraOxigenio(SQLModel, table=True):
    __tablename__ = "oxigenio_compras"

    id: int | None = Field(default=None, primary_key=True)
    licitacao_id: int = Field(foreign_key="oxigenio_licitacoes.id", index=True)
    empresa_id: int = Field(foreign_key="oxigenio_empresas.id", index=True)
    empresa_nome: str = Field(default="", max_length=200)
    data_compra: date = Field(index=True)
    numero_nf: str = Field(default="", max_length=100, index=True)

    qtd_10m3: int = Field(default=0)
    qtd_3m3: int = Field(default=0)
    qtd_1m3: int = Field(default=0)

    valor_total: float = Field(default=0.0)
    responsavel_recebimento: str = Field(default="", max_length=150)
    observacoes: str = Field(default="", sa_column=Column(Text))
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(DateTime(timezone=False)),
    )


class EquipamentoRespiratorio(SQLModel, table=True):
    __tablename__ = "oxigenio_equipamentos"

    id: int | None = Field(default=None, primary_key=True)
    tipo: str = Field(max_length=50, index=True)  # CPAP, BiPAP, CONCENTRADOR
    patrimonio: str = Field(default="", max_length=100, index=True)
    numero_serie: str = Field(default="", max_length=100, index=True)
    marca_modelo: str = Field(default="", max_length=150)
    propriedade: str = Field(default="PROPRIO", max_length=30)  # PROPRIO, LOCADO
    empresa_id: int | None = Field(default=None, foreign_key="oxigenio_empresas.id", index=True)
    empresa_nome: str = Field(default="", max_length=200)
    status: str = Field(default="DISPONIVEL", max_length=30, index=True)  # DISPONIVEL, EM_USO, MANUTENCAO, INATIVO_BAIXADO
    data_aquisicao: date | None = Field(default=None)
    tensao_eletrica: str = Field(default="Bivolt", max_length=30)
    horas_uso: float = Field(default=0.0)
    observacoes: str = Field(default="", sa_column=Column(Text))
    ativo: bool = Field(default=True, index=True)
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(DateTime(timezone=False)),
    )


class EmprestimoOxigenio(SQLModel, table=True):
    __tablename__ = "oxigenio_emprestimos"

    id: int | None = Field(default=None, primary_key=True)
    codigo_termo: str = Field(default="", max_length=50, index=True)

    # Dados do Paciente
    paciente_id: int = Field(foreign_key="tfd_pacientes.id", index=True)
    paciente_nome: str = Field(max_length=150, index=True)
    paciente_cpf: str = Field(default="", max_length=20, index=True)
    paciente_cns: str = Field(default="", max_length=30)
    paciente_prontuario: str = Field(default="", max_length=50)
    paciente_telefone: str = Field(default="", max_length=40)
    paciente_endereco: str = Field(default="", max_length=255)

    # Tipo de Serviço
    tipo_servico: str = Field(max_length=30, index=True)  # MAQUINA ou OXIGENIO

    # Se MAQUINA
    equipamento_id: int | None = Field(default=None, foreign_key="oxigenio_equipamentos.id", index=True)
    tipo_equipamento: str | None = Field(default=None, max_length=50)  # CPAP, BiPAP, CONCENTRADOR
    equipamento_patrimonio: str | None = Field(default=None, max_length=100)
    equipamento_serie: str | None = Field(default=None, max_length=100)

    # Se OXIGENIO ou Cilindro associado
    tipo_cilindro: str | None = Field(default=None, max_length=30)  # 10m3, 3m3, 1m3
    # Finalidade: FIXO_CONCENTRADOR (3m³), SEMANAL_CONCENTRADOR (10m³), TRANSPORTE_ESPECIAL (1m³), USO_CONTINUO, OUTRO
    finalidade_cilindro: str | None = Field(default=None, max_length=50)
    quantidade: int = Field(default=1)
    posse_cilindro: str = Field(default="PROPRIO", max_length=30)  # PROPRIO, COMODATO
    itens_resumo: str = Field(default="", sa_column=Column(Text))

    # Empresa / Licitação
    empresa_id: int | None = Field(default=None, foreign_key="oxigenio_empresas.id", index=True)
    empresa_nome: str | None = Field(default=None, max_length=200)
    licitacao_id: int | None = Field(default=None, foreign_key="oxigenio_licitacoes.id", index=True)

    # Datas e Prazos
    data_instalacao: date = Field(index=True)
    data_prevista_troca: date | None = Field(default=None, index=True)
    data_ultima_troca: date | None = Field(default=None)

    # Status e Inativação
    status: str = Field(default="ATIVO", max_length=30, index=True)  # ATIVO, INATIVO, DEVOLVIDO, CANCELADO
    data_devolucao: date | None = Field(default=None)
    # Motivo: OBITO, ALTA, TRANSFERENCIA, MELHORA_CLINICA, OUTRO
    motivo_inativacao: str | None = Field(default=None, max_length=100)

    # Retirada / Responsável
    responsavel_retirada_nome: str = Field(default="", max_length=150)
    responsavel_retirada_cpf: str = Field(default="", max_length=20)
    responsavel_retirada_parentesco: str = Field(default="", max_length=50)

    # Informações Médicas
    medico_prescritor: str = Field(default="", max_length=150)
    cid_diagnostico: str = Field(default="", max_length=50)
    fluxo_oxigenio_litros_min: float | None = Field(default=None)
    pressao_cpap_bipap: str | None = Field(default=None, max_length=100)
    termo_assinado: bool = Field(default=False)

    observacoes: str = Field(default="", sa_column=Column(Text))
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(DateTime(timezone=False)),
    )
    updated_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=False), default=None),
    )


class TrocaCilindroHistorico(SQLModel, table=True):
    __tablename__ = "oxigenio_trocas_historico"

    id: int | None = Field(default=None, primary_key=True)
    emprestimo_id: int = Field(foreign_key="oxigenio_emprestimos.id", index=True)
    paciente_id: int = Field(foreign_key="tfd_pacientes.id", index=True)
    paciente_nome: str = Field(default="", max_length=150)
    data_troca: date = Field(index=True)
    tipo_cilindro: str = Field(max_length=30)  # 10m3, 3m3, 1m3
    quantidade: int = Field(default=1)
    empresa_id: int | None = Field(default=None, foreign_key="oxigenio_empresas.id", index=True)
    empresa_nome: str | None = Field(default=None, max_length=200)
    responsavel_entrega: str = Field(default="", max_length=150)
    observacoes: str = Field(default="", sa_column=Column(Text))
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(DateTime(timezone=False)),
    )


class ItemEmprestimoOxigenio(SQLModel, table=True):
    __tablename__ = "oxigenio_emprestimo_itens"

    id: int | None = Field(default=None, primary_key=True)
    emprestimo_id: int = Field(foreign_key="oxigenio_emprestimos.id", index=True)
    tipo_servico: str = Field(max_length=30, index=True)  # MAQUINA ou OXIGENIO
    equipamento_id: int | None = Field(default=None, foreign_key="oxigenio_equipamentos.id", index=True)
    tipo_equipamento: str | None = Field(default=None, max_length=50)
    equipamento_patrimonio: str | None = Field(default=None, max_length=100)
    equipamento_serie: str | None = Field(default=None, max_length=100)
    tipo_cilindro: str | None = Field(default=None, max_length=30)
    finalidade_cilindro: str | None = Field(default=None, max_length=50)
    quantidade: int = Field(default=1)
    posse_cilindro: str = Field(default="PROPRIO", max_length=30)  # PROPRIO, COMODATO
    status: str = Field(default="ATIVO", max_length=30, index=True)
    observacoes: str = Field(default="", sa_column=Column(Text))
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(DateTime(timezone=False)),
    )


class CilindroVazioRecolhimento(SQLModel, table=True):
    __tablename__ = "oxigenio_cilindros_vazios"

    id: int | None = Field(default=None, primary_key=True)
    paciente_id: int = Field(foreign_key="tfd_pacientes.id", index=True)
    paciente_nome: str = Field(max_length=150, index=True)
    emprestimo_id: int | None = Field(default=None, foreign_key="oxigenio_emprestimos.id", index=True)
    empresa_id: int | None = Field(default=None, foreign_key="oxigenio_empresas.id", index=True)
    tipo_cilindro: str = Field(max_length=30, index=True)  # 10m3, 3m3, 1m3
    quantidade: int = Field(default=1)
    posse: str = Field(default="PROPRIO", max_length=30)  # PROPRIO, COMODATO
    status: str = Field(default="PENDENTE", max_length=30, index=True)  # PENDENTE, RECOLHIDO
    data_geracao: date = Field(index=True)
    data_recolhimento: date | None = Field(default=None, index=True)
    responsavel_recolhimento: str | None = Field(default=None, max_length=150)
    observacoes: str = Field(default="", sa_column=Column(Text))
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(DateTime(timezone=False)),
    )


class CilindroComodatoMovimentacao(SQLModel, table=True):
    __tablename__ = "oxigenio_comodato_movimentacoes"

    id: int | None = Field(default=None, primary_key=True)
    empresa_id: int = Field(foreign_key="oxigenio_empresas.id", index=True)
    empresa_nome: str = Field(default="", max_length=200)
    tipo_movimentacao: str = Field(max_length=30, index=True)  # ENTRADA_COMODATO, DEVOLUCAO_EMPRESA
    tipo_cilindro: str = Field(max_length=30, index=True)  # 10m3, 3m3, 1m3
    quantidade: int = Field(default=1)
    data_movimento: date = Field(index=True)
    numero_documento: str = Field(default="", max_length=100)
    responsavel: str = Field(default="", max_length=150)
    observacoes: str = Field(default="", sa_column=Column(Text))
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(DateTime(timezone=False)),
    )
