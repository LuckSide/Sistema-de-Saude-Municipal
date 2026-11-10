"""Script de importação e sincronização de Unidades de Saúde e Médicos/Profissionais a partir dos dados do Vivver / e-SUS.

Executa:
1. Cadastro/atualização de Unidades de Saúde (174 unidades com CNES, endereço, município, telefone, CEP).
2. Cadastro/atualização de Médicos e Profissionais de Saúde (437 profissionais com CPF, CBO, especialidades).
3. Criação automática de contas de acesso (User) vinculadas aos profissionais com perfil de telas e painel customizado.
"""

import csv
import re
import sys
from collections import defaultdict

from sqlmodel import Session, select

from app.core.deps import get_db
from app.core.security import hash_password
from app.models.cadastros_saude import Medico, UnidadeSaude
from app.models.user import User
from app.services.dashboard_default import criar_dashboard_padrao_se_ausente
from app.services.validacoes import so_digitos

IBGE_MUNIS = {
    "3128105": "Guapé",
    "3147907": "Passos",
    "3151503": "Piumhi",
    "3106200": "Belo Horizonte",
    "3107109": "Boa Esperança",
    "3169406": "Três Pontas",
    "3543402": "Ribeirão Preto",
    "3164704": "São Sebastião do Paraíso",
    "3550308": "São Paulo",
    "3151800": "Poços de Caldas",
    "3170701": "Varginha",
    "3505500": "Barretos",
    "3506003": "Bauru",
    "3509502": "Campinas",
}

SENHA_PADRAO_HASH = hash_password("Guape@2026")


def carregar_unidades(caminho_csv: str) -> list[dict]:
    with open(caminho_csv, encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    unidades = []
    for r in rows:
        nome = r["nomfantasia"].strip()
        if nome.upper() == "TESTE":
            continue
        muni = IBGE_MUNIS.get(r["codmunicipio"], r["codmunicipio"])
        cnes = r["codcnes"].strip()
        cnes = "" if cnes == "0" else cnes
        end = re.sub(r"^[•\-\s]+", "", r["desendereco"].strip())[:200]
        tel = r["numtelefone"].strip()[:30]
        cep = r["codcep"].strip()[:10]

        if nome.upper() in ("UNIDADE DE SAUDE", "SANTA CASA", "BENEFICIENCIA PORTUGUESA"):
            nome_completo = f"{nome} ({muni})"[:150]
        else:
            nome_completo = nome[:150]

        unidades.append({
            "nome": nome_completo,
            "cnes": cnes,
            "endereco": end,
            "municipio": muni,
            "telefone": tel,
            "cep": cep,
            "ativo": True,
        })
    return unidades


def carregar_profissionais(caminho_todos: str, caminho_medicos: str | None = None) -> list[dict]:
    profs_map = defaultdict(list)
    with open(caminho_todos, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            cpf = so_digitos(r["cpf"]).zfill(11) if r["cpf"].strip() else ""
            key = cpf if cpf else r["nome"].strip().upper()
            profs_map[key].append(r)

    profissionais = []
    usernames_seen = set()
    medico_sem_cpf_seq = 101

    for key, rows in profs_map.items():
        # Preferência por registros ativos e cargos médicos como CBO principal
        def sort_key(x):
            is_ativo = 1 if x["ativo"].strip().lower() == "sim" else 0
            is_med = 1 if (x["codigo"].startswith("225") or "médico" in x["profissao_funcao"].lower()) else 0
            return (is_ativo, is_med)

        sorted_rows = sorted(rows, key=sort_key, reverse=True)
        primeiro = sorted_rows[0]
        nome = primeiro["nome"].strip()[:150]

        cpf_raw = so_digitos(primeiro["cpf"]).zfill(11) if primeiro["cpf"].strip() else ""
        if cpf_raw and len(cpf_raw) == 11:
            cpf_fmt = f"{cpf_raw[:3]}.{cpf_raw[3:6]}.{cpf_raw[6:9]}-{cpf_raw[9:]}"
        else:
            cpf_fmt = ""

        ativo = any(r["ativo"].strip().lower() == "sim" for r in rows)
        is_med = any(r["codigo"].startswith("225") or "médico" in r["profissao_funcao"].lower() for r in rows)
        is_mot = any("motorista" in r["profissao_funcao"].lower() for r in rows)

        cbo_cod = primeiro["codigo"].strip()[:10]
        cbo_desc = primeiro["profissao_funcao"].strip()[:120]

        esps = []
        for r in rows:
            fn = r["profissao_funcao"].strip()
            if fn and fn not in esps:
                esps.append(fn)
        esps_str = ", ".join(esps)[:500]

        # Prefixo e username do usuário
        if is_med:
            if cpf_raw:
                uname = cpf_raw
            else:
                uname = f"medico{medico_sem_cpf_seq}"
                medico_sem_cpf_seq += 1
        elif is_mot:
            prefix = "motorista"
            if cpf_raw:
                uname = f"{prefix}.{cpf_raw}"
            else:
                partes = [re.sub(r"[^a-z0-9]", "", p.lower()) for p in nome.split() if p]
                uname_base = f"{prefix}.{partes[0]}.{partes[-1]}" if len(partes) > 1 else f"{prefix}.{partes[0]}"
                uname = uname_base[:45]
                suf = 1
                while uname in usernames_seen:
                    uname = f"{uname_base[:40]}.{suf}"
                    suf += 1
        else:
            prefix = "pro"
            if cpf_raw:
                uname = f"{prefix}.{cpf_raw}"
            else:
                partes = [re.sub(r"[^a-z0-9]", "", p.lower()) for p in nome.split() if p]
                uname_base = f"{prefix}.{partes[0]}.{partes[-1]}" if len(partes) > 1 else f"{prefix}.{partes[0]}"
                uname = uname_base[:45]
                suf = 1
                while uname in usernames_seen:
                    uname = f"{uname_base[:40]}.{suf}"
                    suf += 1
        usernames_seen.add(uname)

        profissionais.append({
            "nome": nome,
            "cpf": cpf_fmt,
            "cbo_codigo": cbo_cod,
            "cbo_descricao": cbo_desc,
            "especialidades": esps_str,
            "ativo": ativo,
            "is_medico": is_med,
            "is_motorista": is_mot,
            "username": uname,
        })

    return profissionais


def executar_importacao(
    caminho_unidades: str,
    caminho_profissionais: str,
    caminho_medicos: str | None = None,
    dry_run: bool = False,
):
    print("=" * 60)
    print("INICIANDO IMPORTAÇÃO VIVVER -> SAÚDE GUAPÉ")
    print("=" * 60)

    unidades_data = carregar_unidades(caminho_unidades)
    profissionais_data = carregar_profissionais(caminho_profissionais, caminho_medicos)

    print(f"Total de Unidades a processar: {len(unidades_data)}")
    print(f"Total de Profissionais a processar: {len(profissionais_data)}")
    if dry_run:
        print("[MODO SIMULAÇÃO (DRY-RUN) - Nenhuma alteração será gravada]")
        return

    db: Session = next(get_db())

    # 1. PROCESSAR UNIDADES DE SAÚDE
    print("\n--- 1. Importando Unidades de Saúde ---")
    uni_criadas = 0
    uni_atualizadas = 0

    for u_in in unidades_data:
        # Busca existente por CNES (se houver) ou por (nome, municipio)
        obj: UnidadeSaude | None = None
        if u_in["cnes"]:
            obj = db.exec(select(UnidadeSaude).where(UnidadeSaude.cnes == u_in["cnes"])).first()
        if not obj:
            obj = db.exec(
                select(UnidadeSaude).where(
                    UnidadeSaude.nome == u_in["nome"],
                    UnidadeSaude.municipio == u_in["municipio"],
                )
            ).first()

        if obj:
            obj.nome = u_in["nome"]
            if u_in["cnes"]:
                obj.cnes = u_in["cnes"]
            obj.endereco = u_in["endereco"]
            obj.municipio = u_in["municipio"]
            obj.telefone = u_in["telefone"]
            obj.cep = u_in["cep"]
            obj.ativo = u_in["ativo"]
            db.add(obj)
            uni_atualizadas += 1
        else:
            obj = UnidadeSaude(**u_in)
            db.add(obj)
            uni_criadas += 1

    db.commit()
    print(f"Unidades concluídas: {uni_criadas} criadas, {uni_atualizadas} atualizadas.")

    # 2. PROCESSAR MÉDICOS E PROFISSIONAIS DE SAÚDE
    print("\n--- 2. Importando Médicos e Profissionais de Saúde ---")
    med_criados = 0
    med_atualizados = 0
    users_criados = 0
    users_atualizados = 0

    for p_in in profissionais_data:
        # Busca por CPF ou por nome
        med_obj: Medico | None = None
        if p_in["cpf"]:
            med_obj = db.exec(select(Medico).where(Medico.cpf == p_in["cpf"])).first()
        if not med_obj:
            med_obj = db.exec(select(Medico).where(Medico.nome == p_in["nome"])).first()

        if med_obj:
            med_obj.nome = p_in["nome"]
            if p_in["cpf"]:
                med_obj.cpf = p_in["cpf"]
            med_obj.cbo_codigo = p_in["cbo_codigo"]
            med_obj.cbo_descricao = p_in["cbo_descricao"]
            med_obj.especialidades = p_in["especialidades"]
            med_obj.ativo = p_in["ativo"]
            db.add(med_obj)
            med_atualizados += 1
        else:
            med_obj = Medico(
                nome=p_in["nome"],
                cpf=p_in["cpf"],
                crm="",
                cbo_codigo=p_in["cbo_codigo"],
                cbo_descricao=p_in["cbo_descricao"],
                especialidades=p_in["especialidades"],
                telefone="",
                email="",
                ativo=p_in["ativo"],
            )
            db.add(med_obj)
            med_criados += 1

        db.flush()

        # 3. CRIAÇÃO / ATUALIZAÇÃO DO USUÁRIO CORRESPONDENTE
        # Determina perfil e telas
        if p_in["is_medico"]:
            area = "saude"
            telas = "tfd,tfd_medico,tfd_exames,tfd_agenda"
        elif p_in["is_motorista"]:
            area = "motorista"
            telas = "tfd,tfd_viagens,tfd_frota"
        else:
            area = "saude"
            telas = "tfd,tfd_exames,tfd_agenda,aps"

        user_obj: User | None = None
        if med_obj.id:
            user_obj = db.exec(select(User).where(User.medico_id == med_obj.id)).first()
        if not user_obj:
            user_obj = db.exec(select(User).where(User.username == p_in["username"])).first()

        if user_obj:
            user_obj.nome = p_in["nome"]
            user_obj.area = area
            user_obj.medico_id = med_obj.id
            user_obj.is_active = p_in["ativo"]
            # Não sobrescreve telas se o usuário já tiver sido customizado
            if not user_obj.telas:
                user_obj.telas = telas
            db.add(user_obj)
            users_atualizados += 1
        else:
            user_obj = User(
                username=p_in["username"],
                password_hash=SENHA_PADRAO_HASH,
                nome=p_in["nome"],
                area=area,
                telas=telas,
                acoes="{}",
                medico_id=med_obj.id,
                permite_retroativo=True,
                is_superuser=False,
                is_active=p_in["ativo"],
                must_change_password=True,
            )
            db.add(user_obj)
            users_criados += 1

        db.flush()

        # Criação de dashboard padrão personalizado para o usuário
        try:
            criar_dashboard_padrao_se_ausente(db, user_obj)
        except Exception:
            pass

    db.commit()

    print(f"\nProfissionais concluídos: {med_criados} criados, {med_atualizados} atualizados.")
    print(f"Usuários de acesso concluídos: {users_criados} criados, {users_atualizados} atualizados.")
    print("\nSenha temporária inicial padrão definida para novos usuários: Guape@2026 (troca obrigatória no primeiro acesso).")
    print("=" * 60)
    print("IMPORTAÇÃO CONCLUÍDA COM SUCESSO!")
    print("=" * 60)


if __name__ == "__main__":
    c_unidades = "/Users/mateusluck/Documents/ESUS-exportacoes/vivver_medicos_unidades_2026-10-19/unidades_saude.csv"
    c_profissionais = "/Users/mateusluck/Documents/ESUS-exportacoes/vivver_medicos_unidades_2026-10-19/todos_profissionais.csv"
    c_medicos = "/Users/mateusluck/Documents/ESUS-exportacoes/vivver_medicos_unidades_2026-10-19/medicos.csv"
    dry = "--dry-run" in sys.argv
    executar_importacao(c_unidades, c_profissionais, c_medicos, dry_run=dry)
