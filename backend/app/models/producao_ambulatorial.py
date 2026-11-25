from datetime import date, datetime
from sqlalchemy import Column, Date, DateTime
from sqlmodel import Field, SQLModel

from app.models.user import User  # noqa: F401


class ProducaoAmbulatorial(SQLModel, table=True):
    __tablename__ = "producoes_ambulatoriais"

    id: int | None = Field(default=None, primary_key=True)
    unidade_saude_id: int = Field(foreign_key="unidades_saude.id", index=True)
    medico_id: int = Field(foreign_key="medicos.id", index=True)  # profissional executante
    equipe_id: int | None = Field(default=None, foreign_key="equipes_saude.id", index=True)  # INE opcional
    procedimento_id: int = Field(foreign_key="sigtap_procedimentos.id", index=True)
    procedimento_codigo: str = Field(max_length=10, index=True)  # 10 dígitos do SIGTAP
    procedimento_nome: str = Field(max_length=250)
    cbo_codigo: str = Field(max_length=10, index=True)  # CBO do profissional na hora do ato
    competencia: str = Field(max_length=6, index=True)  # formato AAAAMM
    data_atendimento: date = Field(sa_column=Column(Date, index=True, nullable=False))
    instrumento_registro: str = Field(default="BPA-C", max_length=10, index=True)  # 'BPA-C' | 'BPA-I'
    quantidade: int = Field(default=1)
    valor_unitario: float = Field(default=0.0)
    valor_total: float = Field(default=0.0)

    # Campos para BPA-I (Individualizado):
    paciente_id: int | None = Field(default=None, foreign_key="tfd_pacientes.id", index=True)
    paciente_nome: str = Field(default="", max_length=150)
    paciente_cpf: str = Field(default="", max_length=11)
    paciente_cns: str = Field(default="", max_length=15)
    paciente_sexo: str = Field(default="", max_length=1)  # M | F
    paciente_data_nascimento: date | None = Field(default=None, sa_column=Column(Date, nullable=True))
    paciente_municipio_ibge: str = Field(default="312810", max_length=10)
    paciente_raca_cor: str = Field(default="99", max_length=2)
    paciente_etnia: str = Field(default="", max_length=4)
    paciente_nacionalidade: str = Field(default="010", max_length=3)
    carater_atendimento: str = Field(default="01", max_length=2)
    paciente_cep: str = Field(default="", max_length=8)
    paciente_logradouro: str = Field(default="", max_length=100)
    paciente_numero: str = Field(default="", max_length=10)
    paciente_complemento: str = Field(default="", max_length=30)
    paciente_bairro: str = Field(default="", max_length=60)
    paciente_telefone: str = Field(default="", max_length=15)
    paciente_situacao_rua: str = Field(default="N", max_length=1)
    paciente_sem_cpf: str = Field(default="N", max_length=1)
    idade_paciente_informada: int | None = Field(default=None)
    cid10: str = Field(default="", max_length=10)
    numero_autorizacao: str = Field(default="", max_length=20)
    servico_codigo: str = Field(default="", max_length=10)
    classificacao_codigo: str = Field(default="", max_length=10)

    origem: str = Field(default="DIGITACAO_PROFISSIONAL", max_length=50)
    status: str = Field(default="VALIDADO", max_length=20)
    usuario_id: int | None = Field(default=None, foreign_key="usuarios.id")
    criado_em: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(DateTime(timezone=False), nullable=False),
    )
    atualizado_em: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(DateTime(timezone=False), nullable=False),
    )
