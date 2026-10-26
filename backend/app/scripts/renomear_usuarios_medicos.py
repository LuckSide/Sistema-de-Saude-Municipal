"""Script para renomear os nomes de usuário (username) dos médicos para o CPF
ou sequencial simples (medico101, medico102...) caso não possuam CPF cadastrado.
"""

import sys
sys.path.insert(0, "backend")

from sqlmodel import Session, select
from app.db.session import engine
from app.models.user import User
from app.models.cadastros_saude import Medico


def executar_renomeacao():
    print("Iniciando renomeação dos usuários dos médicos...")
    with Session(engine) as db:
        users = db.exec(select(User)).all()
        
        # Filtra usuários médicos
        medicos_users = []
        for u in users:
            med = db.get(Medico, u.medico_id) if u.medico_id else None
            is_medico = False
            if u.username.startswith("medico."):
                is_medico = True
            elif med and (
                (med.cbo_codigo and str(med.cbo_codigo).startswith("225"))
                or "MEDIC" in (med.cbo_descricao or "").upper()
                or "MÉDIC" in (med.cbo_descricao or "").upper()
            ):
                is_medico = True
                
            if is_medico:
                medicos_users.append((u, med))
                
        print(f"Total de médicos encontrados: {len(medicos_users)}")
        
        com_cpf = []
        sem_cpf = []
        
        for u, med in medicos_users:
            cpf = med.cpf if med else ""
            cpf_digitos = "".join(c for c in (cpf or "") if c.isdigit())
            if not cpf_digitos:
                # Se no username antigo tinha medico.12345678900
                partes = u.username.split(".", 1)
                if len(partes) > 1 and partes[1].isdigit() and len(partes[1]) == 11:
                    cpf_digitos = partes[1]
                    
            if cpf_digitos:
                com_cpf.append((u, med, cpf_digitos))
            else:
                sem_cpf.append((u, med))
                
        print(f"Com CPF: {len(com_cpf)}")
        print(f"Sem CPF: {len(sem_cpf)}")
        
        # 1. Renomeia com CPF
        renomeados_cpf = 0
        for u, med, cpf_digitos in com_cpf:
            antigo = u.username
            if antigo != cpf_digitos:
                u.username = cpf_digitos
                db.add(u)
                renomeados_cpf += 1
                
        # 2. Renomeia sem CPF ordenados alfabeticamente pelo nome do médico
        sem_cpf.sort(key=lambda item: (item[1].nome if item[1] else item[0].nome))
        renomeados_sem_cpf = 0
        seq = 101
        for u, med in sem_cpf:
            novo_username = f"medico{seq}"
            # Garante que não colida com outro existente
            while db.exec(select(User).where(User.username == novo_username, User.id != u.id)).first():
                seq += 1
                novo_username = f"medico{seq}"
                
            antigo = u.username
            if antigo != novo_username:
                print(f"  [Sem CPF] ID={u.id} ({med.nome if med else 'Sem nome'}): {antigo} -> {novo_username}")
                u.username = novo_username
                db.add(u)
                renomeados_sem_cpf += 1
            seq += 1
            
        db.commit()
        print("\nSucesso!")
        print(f"Total com CPF renomeados: {renomeados_cpf}")
        print(f"Total sem CPF renomeados: {renomeados_sem_cpf}")


if __name__ == "__main__":
    executar_renomeacao()
