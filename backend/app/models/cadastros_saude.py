from sqlmodel import SQLModel, Field


class Medico(SQLModel, table=True):
    __tablename__ = "medicos"

    id: int | None = Field(default=None, primary_key=True)
    nome: str = Field(max_length=150, index=True)
    cpf: str = Field(default="", max_length=14)
    cns: str = Field(default="", max_length=15, index=True)
    crm: str = Field(default="", max_length=40, index=True)
    conselho_tipo: str = Field(default="CRM", max_length=20)  # CRM, COREN, CRF, CRO, CREFITO, CRP, CRESS, CRN, CRFa, etc.
    conselho_uf: str = Field(default="MG", max_length=2)
    cbo_codigo: str = Field(default="", max_length=10)
    cbo_descricao: str = Field(default="", max_length=120)
    especialidade: str = Field(default="", max_length=120)  # especialidade principal
    especialidades: str = Field(default="", max_length=500)  # csv
    vinculo: str = Field(default="ESTATUTARIO", max_length=50)  # ESTATUTARIO, CLT, TEMPORARIO, AUTONOMO_CREDENCIADO, COOPERADO
    chs_total: int = Field(default=40)
    chs_ambulatorial: int = Field(default=40)
    chs_hospitalar: int = Field(default=0)
    chs_outros: int = Field(default=0)
    telefone: str = Field(default="", max_length=30)
    email: str = Field(default="", max_length=120)
    unidades_ids: str = Field(default="", max_length=500)
    ativo: bool = Field(default=True)


class UnidadeSaude(SQLModel, table=True):
    __tablename__ = "unidades_saude"

    id: int | None = Field(default=None, primary_key=True)
    nome: str = Field(max_length=150, index=True)
    cnes: str = Field(default="", max_length=20, index=True)
    tipo_estabelecimento: str = Field(default="02", max_length=50)  # '01' Posto, '02' Centro/UBS, '04' Policlínica, etc.
    codigo_ibge: str = Field(default="312810", max_length=10)  # 312810 para Guapé/MG
    cnpj: str = Field(default="18239616000185", max_length=20)
    responsavel_tecnico_nome: str = Field(default="", max_length=150)
    responsavel_tecnico_cns: str = Field(default="", max_length=15)
    responsavel_tecnico_conselho: str = Field(default="", max_length=50)
    endereco: str = Field(default="", max_length=200)
    numero: str = Field(default="", max_length=20)
    bairro: str = Field(default="", max_length=100)
    municipio: str = Field(default="", max_length=100)
    cep: str = Field(default="", max_length=10)
    telefone: str = Field(default="", max_length=30)
    ativo: bool = Field(default=True)


class UnidadeServicoEspecializado(SQLModel, table=True):
    """Módulo Conjunto do CNES: Serviços Especializados e Classificações de cada Unidade."""
    __tablename__ = "unidades_servicos_especializados"

    id: int | None = Field(default=None, primary_key=True)
    unidade_saude_id: int = Field(foreign_key="unidades_saude.id", index=True)
    servico_codigo: str = Field(max_length=10, index=True)  # ex: '106', '112', '135'
    servico_descricao: str = Field(default="", max_length=150)
    classificacao_codigo: str = Field(max_length=10, index=True)  # ex: '001', '002'
    classificacao_descricao: str = Field(default="", max_length=150)
    caracteristica: str = Field(default="PROPRIO", max_length=20)  # PROPRIO ou TERCEIRIZADO
    cnes_terceiro: str = Field(default="", max_length=20)
    ativo: bool = Field(default=True)


class EquipeSaude(SQLModel, table=True):
    """Código INE da Atenção Básica / Saúde da Família e Equipes Multidisciplinares."""
    __tablename__ = "equipes_saude"

    id: int | None = Field(default=None, primary_key=True)
    unidade_saude_id: int = Field(foreign_key="unidades_saude.id", index=True)
    ine: str = Field(max_length=10, index=True)  # Código INE de 10 dígitos
    nome_equipe: str = Field(max_length=150, index=True)
    tipo_equipe: str = Field(default="70 - Equipe de Saúde da Família (eSF)", max_length=100)
    area: str = Field(default="", max_length=50)
    ativo: bool = Field(default=True)


class EquipeProfissional(SQLModel, table=True):
    """Vinculação de Profissionais às Equipes de Saúde da Unidade."""
    __tablename__ = "equipes_profissionais"

    id: int | None = Field(default=None, primary_key=True)
    equipe_id: int = Field(foreign_key="equipes_saude.id", index=True)
    medico_id: int = Field(foreign_key="medicos.id", index=True)
    funcao: str = Field(default="MÉDICO", max_length=100)
    chs: int = Field(default=40)


class Prestador(SQLModel, table=True):
    """Entidade prestadora de serviços de saúde conveniada ou contratada (ex: Santa Casa, clínicas, laboratórios externos)."""
    __tablename__ = "prestadores"

    id: int | None = Field(default=None, primary_key=True)
    razao_social: str = Field(max_length=150, index=True)
    nome_fantasia: str = Field(default="", max_length=150, index=True)
    cnpj: str = Field(default="", max_length=20, index=True)
    cnes: str = Field(default="", max_length=20, index=True)
    tipo_entidade: str = Field(default="hospital", max_length=50, index=True)  # hospital | laboratorio | clinica | filantropico
    responsavel_nome: str = Field(default="", max_length=120)
    responsavel_telefone: str = Field(default="", max_length=30)
    email: str = Field(default="", max_length=120)
    telefone: str = Field(default="", max_length=30)
    endereco: str = Field(default="", max_length=200)
    municipio: str = Field(default="Guapé", max_length=100)
    ativo: bool = Field(default=True, index=True)
    observacoes: str = Field(default="", max_length=500)
