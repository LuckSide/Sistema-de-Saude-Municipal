from datetime import date, datetime
from sqlalchemy import Column, Date, DateTime
from sqlmodel import Field, SQLModel


class FaixaNumeracaoAPAC(SQLModel, table=True):
    __tablename__ = "apac_faixas"

    id: int | None = Field(default=None, primary_key=True)
    ano: int = Field(index=True)
    uf: str = Field(default="MG", max_length=2)
    serie: str = Field(default="01", max_length=10)
    numero_inicial: int = Field(index=True)  # ex: 3126100000001
    numero_final: int = Field(index=True)    # ex: 3126100001000
    proximo_numero: int = Field(index=True)  # número sequencial atual
    tipo_procedimento: str = Field(default="TODOS", max_length=50)
    ativo: bool = Field(default=True, index=True)
    descricao: str = Field(default="", max_length=150)
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(DateTime(timezone=False)),
    )


class SolicitacaoAPAC(SQLModel, table=True):
    __tablename__ = "apac_solicitacoes"

    id: int | None = Field(default=None, primary_key=True)
    numero_apac: str = Field(default="", max_length=20, index=True)  # Atribuído na autorização
    tipo_apac: str = Field(default="inicial", max_length=20, index=True)  # inicial | continuidade
    apac_anterior_id: int | None = Field(default=None, index=True)
    numero_apac_anterior: str = Field(default="", max_length=20)
    status: str = Field(default="SOLICITADO", max_length=25, index=True)
    # Estados: SOLICITADO, EM_ANALISE, PENDENTE, AUTORIZADO, INDEFERIDO, CANCELADO
    carater_atendimento: str = Field(default="01", max_length=2)  # 01: Eletivo, 02: Urgência/Emergência

    # Paciente
    paciente_id: int = Field(foreign_key="tfd_pacientes.id", index=True)
    paciente_nome: str = Field(max_length=150, index=True)
    paciente_cpf: str = Field(default="", max_length=14, index=True)
    paciente_cns: str = Field(default="", max_length=20, index=True)
    paciente_nascimento: date | None = Field(default=None, sa_column=Column(Date))
    paciente_sexo: str = Field(default="", max_length=1)
    paciente_nome_mae: str = Field(default="", max_length=150)
    paciente_telefone: str = Field(default="", max_length=30)
    paciente_endereco: str = Field(default="", max_length=255)
    paciente_bairro: str = Field(default="", max_length=100)
    paciente_municipio: str = Field(default="", max_length=100)
    paciente_cep: str = Field(default="", max_length=10)

    # Estabelecimentos
    estabelecimento_solicitante_id: int | None = Field(default=None, index=True)
    estabelecimento_solicitante_cnes: str = Field(default="", max_length=20)
    estabelecimento_solicitante_nome: str = Field(default="", max_length=150)
    estabelecimento_executante_id: int | None = Field(default=None, index=True)
    estabelecimento_executante_cnes: str = Field(default="", max_length=20)
    estabelecimento_executante_nome: str = Field(default="", max_length=150)

    # Profissionais
    medico_solicitante_id: int = Field(foreign_key="medicos.id", index=True)
    medico_solicitante_nome: str = Field(max_length=150)
    medico_solicitante_cpf: str = Field(default="", max_length=14)
    medico_solicitante_cns: str = Field(default="", max_length=20)
    medico_solicitante_crm: str = Field(default="", max_length=40)
    medico_solicitante_cbo: str = Field(default="", max_length=10)
    medico_autorizador_id: int | None = Field(default=None, index=True)
    medico_autorizador_nome: str = Field(default="", max_length=150)
    medico_autorizador_cpf: str = Field(default="", max_length=14)
    medico_autorizador_cns: str = Field(default="", max_length=20)
    medico_autorizador_crm: str = Field(default="", max_length=40)
    medico_autorizador_cbo: str = Field(default="", max_length=10)
    autorizador_usuario_id: int | None = Field(default=None, index=True)

    # Procedimento Principal SIGTAP
    procedimento_principal_codigo: str = Field(max_length=20, index=True)
    procedimento_principal_nome: str = Field(max_length=255)
    quantidade_mes_1: int = Field(default=1)
    quantidade_mes_2: int = Field(default=0)
    quantidade_mes_3: int = Field(default=0)
    quantidade_total: int = Field(default=1)
    valor_unitario: float = Field(default=0.0)
    valor_total: float = Field(default=0.0)

    # Dados Clínicos
    cid_principal_codigo: str = Field(max_length=10, index=True)
    cid_principal_nome: str = Field(default="", max_length=255)
    cid_secundario_codigo: str = Field(default="", max_length=10)
    cid_secundario_nome: str = Field(default="", max_length=255)
    cid_causas_associadas: str = Field(default="", max_length=10)
    anamnese_diagnostico: str = Field(default="", max_length=3000)
    justificativa_solicitacao: str = Field(default="", max_length=3000)
    estadiamento_grau: str = Field(default="", max_length=50)  # I, II, III, IV
    indicacao_clinica: str = Field(default="", max_length=500)

    # Datas e Vigência
    data_solicitacao: date = Field(sa_column=Column(Date, index=True))
    data_autorizacao: date | None = Field(default=None, sa_column=Column(Date))
    data_inicio_validade: date | None = Field(default=None, sa_column=Column(Date))
    data_fim_validade: date | None = Field(default=None, sa_column=Column(Date, index=True))
    competencia: str = Field(default="", max_length=7, index=True)

    # Regulação
    parecer_regulador: str = Field(default="", max_length=2000)
    motivo_devolucao: str = Field(default="", max_length=1000)
    motivo_indeferimento: str = Field(default="", max_length=1000)
    historico_tramitacao: str = Field(default="[]")  # JSON list de eventos

    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(DateTime(timezone=False)),
    )
    updated_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(DateTime(timezone=False)),
    )


class ProcedimentoSecundarioAPAC(SQLModel, table=True):
    __tablename__ = "apac_procedimentos_secundarios"

    id: int | None = Field(default=None, primary_key=True)
    solicitacao_apac_id: int = Field(foreign_key="apac_solicitacoes.id", index=True)
    codigo: str = Field(max_length=20, index=True)
    descricao: str = Field(max_length=255)
    quantidade_mes_1: int = Field(default=1)
    quantidade_mes_2: int = Field(default=0)
    quantidade_mes_3: int = Field(default=0)
    quantidade_total: int = Field(default=1)
    valor_unitario: float = Field(default=0.0)
    valor_total: float = Field(default=0.0)


class AnexoLaudoAPAC(SQLModel, table=True):
    __tablename__ = "apac_anexos"

    id: int | None = Field(default=None, primary_key=True)
    solicitacao_apac_id: int = Field(foreign_key="apac_solicitacoes.id", index=True)
    tipo_documento: str = Field(default="laudo_exame", max_length=50)  # laudo_exame | biopsia | termo | outro
    titulo: str = Field(max_length=150)
    nome_arquivo: str = Field(max_length=255)
    conteudo_base64: str = Field(default="")
    tamanho_bytes: int = Field(default=0)
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(DateTime(timezone=False)),
    )


class LoteFaturamentoAPAC(SQLModel, table=True):
    __tablename__ = "apac_lotes"

    id: int | None = Field(default=None, primary_key=True)
    competencia: str = Field(max_length=7, index=True)  # AAAA-MM
    cnes_executante: str = Field(default="", max_length=20)
    tipo_remessa: str = Field(default="APAC-MAG", max_length=20)
    total_apacs: int = Field(default=0)
    total_procedimentos: int = Field(default=0)
    valor_total: float = Field(default=0.0)
    status: str = Field(default="FECHADO", max_length=20)  # ABERTO | FECHADO | TRANSMITIDO
    conteudo_arquivo: str = Field(default="")
    arquivo_nome: str = Field(default="", max_length=150)
    criado_em: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(DateTime(timezone=False)),
    )
    criado_por: str = Field(default="", max_length=120)
