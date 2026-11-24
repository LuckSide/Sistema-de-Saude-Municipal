import pytest
from sqlmodel import SQLModel, create_engine, Session, select
from fastapi import HTTPException
from pydantic import ValidationError

from app.core.validators import valida_cns
from app.models.cadastros_saude import (
    Medico,
    UnidadeSaude,
    UnidadeServicoEspecializado,
    EquipeSaude,
    EquipeProfissional,
)
from app.models.user import User
from app.schemas.cadastros_saude import (
    MedicoIn,
    MedicoOut,
    UnidadeIn,
    UnidadeOut,
    UnidadeServicoEspecializadoIn,
    EquipeSaudeIn,
    EquipeProfissionalIn,
)
from app.api.v1.cadastros_saude import (
    listar_medicos,
    criar_medico,
    atualizar_medico,
    listar_unidades,
    criar_unidade,
    atualizar_unidade,
    listar_servicos_unidade,
    criar_servico_unidade,
    remover_servico_unidade,
    listar_equipes,
    listar_equipes_unidade,
    criar_equipe,
    atualizar_equipe,
    inativar_equipe,
    adicionar_profissional_equipe,
    remover_profissional_equipe,
)


@pytest.fixture
def session():
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as db:
        yield db


@pytest.fixture
def mock_admin(session):
    admin = User(
        username="admin",
        password_hash="fake",
        nome="Administrador",
        is_superuser=True,
        is_active=True,
    )
    session.add(admin)
    session.commit()
    session.refresh(admin)
    return admin


# ============================================================================
# 1. TESTES DA VALIDAÇÃO MATEMÁTICA OFICIAL DO CNS (MÓDULO 11)
# ============================================================================
def test_valida_cns_algoritmo_oficial():
    # Definitivo gerado (início 1)
    base = "12345678901"
    soma = sum(int(base[i]) * (15 - i) for i in range(11))
    resto = soma % 11
    dv = 11 - resto
    if dv == 11:
        dv = 0
    if dv == 10:
        soma += 2
        resto = soma % 11
        dv = 11 - resto
        cns_def = base + "001" + str(dv)
    else:
        cns_def = base + "000" + str(dv)

    ok, msg = valida_cns(cns_def)
    assert ok is True
    assert msg == ""

    # Provisório gerado (início 7)
    base_p = "72345678901234"
    soma_p = sum(int(base_p[i]) * (15 - i) for i in range(14))
    resto_p = soma_p % 11
    dv_p = (11 - resto_p) % 11
    cns_prov = base_p + str(dv_p)

    ok_p, msg_p = valida_cns(cns_prov)
    assert ok_p is True
    assert msg_p == ""

    # Vazio / nulo permitido quando opcional
    assert valida_cns("")[0] is True
    assert valida_cns(None)[0] is True

    # Erros de validação
    # Comprimento inválido
    ok, msg = valida_cns("12345")
    assert ok is False
    assert "15 dígitos" in msg

    # Dígito inicial proibido no SUS (ex: 3, 4, 5, 6)
    ok, msg = valida_cns("323456789010000")
    assert ok is False
    assert "iniciar com 1, 2, 7, 8 ou 9" in msg

    # Dígito verificador incorreto para definitivo
    ok, msg = valida_cns("123456789010009")
    assert ok is False
    assert "dígito verificador não confere" in msg

    # Dígito verificador incorreto para provisório
    ok, msg = valida_cns("723456789012349")
    assert ok is False
    assert "soma verificadora não confere" in msg


# ============================================================================
# 2. TESTES DE CADASTRO DE PROFISSIONAIS (CNS, CONSELHO, VÍNCULO, CHS)
# ============================================================================
def test_cadastro_medico_campos_cnes(session, mock_admin):
    # Gerar CNS válido
    base = "10020030040"
    soma = sum(int(base[i]) * (15 - i) for i in range(11))
    resto = soma % 11
    dv = 11 - resto
    if dv == 11:
        dv = 0
    cns_valido = base + ("001" if dv == 10 else "000") + str(dv if dv != 10 else 8)

    med_in = MedicoIn(
        nome="Dra. Ana Paula Silva",
        cpf="11144477735",
        cns=cns_valido,
        crm="CRM/MG 123456",
        conselho_tipo="CRM",
        conselho_uf="MG",
        cbo_codigo="225125",
        cbo_descricao="Médico Clínico",
        vinculo="ESTATUTARIO",
        chs_total=40,
        chs_ambulatorial=30,
        chs_hospitalar=10,
        chs_outros=0,
    )

    med_out = criar_medico(med_in, db=session, _ator=mock_admin)
    assert med_out.id is not None
    assert med_out.cns == cns_valido
    assert med_out.conselho_tipo == "CRM"
    assert med_out.conselho_uf == "MG"
    assert med_out.vinculo == "ESTATUTARIO"
    assert med_out.chs_total == 40
    assert med_out.chs_ambulatorial == 30
    assert med_out.chs_hospitalar == 10

    # Busca por CNS
    resultado = listar_medicos(q=cns_valido, db=session, _ator=mock_admin)
    assert len(resultado) == 1
    assert resultado[0].nome == "Dra. Ana Paula Silva"

    # Atualização de campos
    med_in.chs_total = 20
    med_in.vinculo = "CLT"
    atualizado = atualizar_medico(med_out.id, med_in, db=session, _ator=mock_admin)
    assert atualizado.chs_total == 20
    assert atualizado.vinculo == "CLT"


def test_medico_cns_invalido_rejeitado():
    with pytest.raises(ValidationError):
        MedicoIn(
            nome="Dr. Invalido",
            cpf="11144477735",
            cns="123456789010009",  # DV errado
            crm="CRM/MG 123456",
        )


# ============================================================================
# 3. TESTES DE UNIDADES DE SAÚDE (TIPO ESTABELECIMENTO, IBGE, RT, CNPJ)
# ============================================================================
def test_cadastro_unidade_campos_cnes(session, mock_admin):
    uni_in = UnidadeIn(
        nome="UBS Central Guapé",
        cnes="2123456",
        tipo_estabelecimento="02",
        codigo_ibge="312810",
        cnpj="18239616000185",
        responsavel_tecnico_nome="Dra. Ana Paula Silva",
        responsavel_tecnico_conselho="CRM/MG 123456",
        endereco="Praça Central, 100",
        municipio="Guapé",
    )

    uni_out = criar_unidade(uni_in, db=session, _ator=mock_admin)
    assert uni_out.id is not None
    assert uni_out.tipo_estabelecimento == "02"
    assert uni_out.codigo_ibge == "312810"
    assert uni_out.cnpj == "18239616000185"
    assert uni_out.responsavel_tecnico_nome == "Dra. Ana Paula Silva"

    # Busca por tipo ou responsável
    res = listar_unidades(q="Ana Paula", db=session, _ator=mock_admin)
    assert len(res) >= 1
    assert res[0].nome == "UBS Central Guapé"


# ============================================================================
# 4. TESTES DE SERVIÇOS ESPECIALIZADOS CNES
# ============================================================================
def test_modulo_servicos_especializados(session, mock_admin):
    uni = UnidadeSaude(nome="Policlínica Municipal", cnes="2123457")
    session.add(uni)
    session.commit()
    session.refresh(uni)

    srv_in = UnidadeServicoEspecializadoIn(
        unidade_saude_id=uni.id,
        servico_codigo="106",
        servico_descricao="Serviço de Apoio Diagnóstico",
        classificacao_codigo="001",
        classificacao_descricao="Patologia Clínica",
        caracteristica="PROPRIO",
    )
    criado = criar_servico_unidade(uni.id, srv_in, db=session, _ator=mock_admin)
    assert criado.id is not None
    assert criado.servico_codigo == "106"
    assert criado.classificacao_codigo == "001"

    # Listar serviços da unidade
    lista = listar_servicos_unidade(uni.id, db=session, _ator=mock_admin)
    assert len(lista) == 1
    assert lista[0].servico_codigo == "106"

    # Remover serviço
    remover_servico_unidade(uni.id, criado.id, db=session, _ator=mock_admin)
    lista_pos = listar_servicos_unidade(uni.id, db=session, _ator=mock_admin)
    assert len(lista_pos) == 0


# ============================================================================
# 5. TESTES DE EQUIPES DE SAÚDE (INE) E VINCULAÇÃO DE PROFISSIONAIS
# ============================================================================
def test_modulo_equipes_saude_ine(session, mock_admin):
    uni = UnidadeSaude(nome="PSF Bela Vista", cnes="2123458")
    session.add(uni)
    session.commit()
    session.refresh(uni)

    med = Medico(
        nome="Dr. Roberto Carlos",
        cpf="11144477735",
        crm="CRM/MG 654321",
        conselho_tipo="CRM",
        conselho_uf="MG",
        cbo_codigo="225125",
        cbo_descricao="Médico de Família",
    )
    session.add(med)
    session.commit()
    session.refresh(med)

    # 1. Criar equipe com INE de 10 dígitos
    eq_in = EquipeSaudeIn(
        unidade_saude_id=uni.id,
        ine="0001234567",
        nome_equipe="ESF 01 Bela Vista",
        tipo_equipe="70 - Equipe de Saúde da Família (eSF)",
        area="Área 01",
        profissionais=[
            EquipeProfissionalIn(
                medico_id=med.id,
                funcao="MÉDICO DE FAMÍLIA",
                chs=40,
            )
        ],
    )
    eq_criada = criar_equipe(eq_in, uid=uni.id, db=session, _ator=mock_admin)
    assert eq_criada.id is not None
    assert eq_criada.ine == "0001234567"
    assert eq_criada.unidade_nome == "PSF Bela Vista"
    assert len(eq_criada.profissionais) == 1
    assert eq_criada.profissionais[0].medico_nome == "Dr. Roberto Carlos"
    assert eq_criada.profissionais[0].funcao == "MÉDICO DE FAMÍLIA"

    # 2. Rejeição de INE duplicado
    with pytest.raises(HTTPException) as exc:
        criar_equipe(eq_in, uid=uni.id, db=session, _ator=mock_admin)
    assert exc.value.status_code == 400
    assert "Já existe uma equipe cadastrada com o INE" in exc.value.detail

    # 3. Adicionar outro profissional via endpoint específico
    med2 = Medico(nome="Enfermeira Juliana", crm="COREN/MG 778899")
    session.add(med2)
    session.commit()
    session.refresh(med2)

    novo_prof = adicionar_profissional_equipe(
        eq_criada.id,
        EquipeProfissionalIn(medico_id=med2.id, funcao="ENFERMEIRO", chs=40),
        db=session,
        _ator=mock_admin,
    )
    assert novo_prof.id is not None
    assert novo_prof.medico_nome == "Enfermeira Juliana"

    # Listar equipes da unidade
    eqs = listar_equipes_unidade(uni.id, db=session, _ator=mock_admin)
    assert len(eqs) == 1
    assert len(eqs[0].profissionais) == 2

    # 4. Remover profissional da equipe
    remover_profissional_equipe(eq_criada.id, novo_prof.id, db=session, _ator=mock_admin)
    eqs_pos = listar_equipes_unidade(uni.id, db=session, _ator=mock_admin)
    assert len(eqs_pos[0].profissionais) == 1

    # 5. Inativar equipe
    inativar_equipe(eq_criada.id, db=session, _ator=mock_admin)
    eqs_ativas = listar_equipes_unidade(uni.id, somente_ativas=True, db=session, _ator=mock_admin)
    assert len(eqs_ativas) == 0


def test_equipe_ine_invalido_rejeitado():
    with pytest.raises(ValidationError):
        EquipeSaudeIn(
            unidade_saude_id=1,
            ine="123",  # Deve ter 10 dígitos
            nome_equipe="ESF Teste",
        )
