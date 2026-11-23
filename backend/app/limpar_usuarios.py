"""Script para limpeza segura de contas de usuários importadas em massa no Saúde Guapé.

Mantém exclusivamente os usuários autorizados da equipe e remove os acessos
excedentes (ex: médicos importados que não precisam de login no sistema).
Não afeta o cadastro clínico de médicos na tabela 'medicos'.

Uso no servidor de produção:
  # 1. Simular para conferir a lista de quem será mantido e quem será removido:
  docker exec -it sistema-saude-api python app/limpar_usuarios.py --simular

  # 2. Executar e confirmar a exclusão:
  docker exec -it sistema-saude-api python app/limpar_usuarios.py --confirmar
"""

from __future__ import annotations

import argparse
import re
import sys
import unicodedata

from sqlalchemy import text
from sqlmodel import Session, delete, select

from app.db.session import engine
from app.models.dashboard_prefs import UserDashboardPrefs
from app.models.user import User

# Lista oficial de usuários que DEVEM ser mantidos no sistema
USUARIOS_AUTORIZADOS = [
    "admin",
    "daniel",
    "juliana",
    "marcio henrique rodrigues",
    "jessica aguiar faria",
    "bruno perez azevedo",
    "bruno perez azevvedo",
    "elton neves",
    "henrique pieve tavares",
    "dalcyone fraga",
]


def normalizar(s: str) -> str:
    """Remove acentos, caracteres especiais e converte para minúsculas."""
    if not s:
        return ""
    nfkd = unicodedata.normalize("NFKD", s)
    sem_acento = "".join(c for c in nfkd if not unicodedata.combining(c))
    limpo = re.sub(r"[^a-zA-Z0-9\s]", " ", sem_acento).lower()
    return " ".join(limpo.split())


def deve_manter_usuario(user: User) -> tuple[bool, str]:
    """Verifica se o usuário corresponde a algum da lista permitida (por username ou nome)."""
    # Superuser admin sempre é protegido
    if (user.username or "").strip().lower() == "admin":
        return True, "Administrador principal (admin)"

    u_norm = normalizar(user.username)
    n_norm = normalizar(user.nome)

    for alvo in USUARIOS_AUTORIZADOS:
        alvo_norm = normalizar(alvo)
        # Correspondência exata
        if u_norm == alvo_norm:
            return True, f"Username exato: '{alvo}'"
        if n_norm == alvo_norm:
            return True, f"Nome completo exato: '{alvo}'"
        # Alvo contido no nome (ex: "Dr. Marcio Henrique Rodrigues" ou "Bruno Perez Azevedo")
        if alvo_norm in n_norm:
            return True, f"Nome contém: '{alvo}'"
        if alvo_norm in u_norm:
            return True, f"Username contém: '{alvo}'"

        # Para nomes únicos como 'daniel' ou 'juliana'
        if len(alvo_norm.split()) == 1:
            if alvo_norm in u_norm.split():
                return True, f"Username termo: '{alvo}'"
            if alvo_norm in n_norm.split():
                return True, f"Nome termo: '{alvo}'"
            if u_norm.startswith(alvo_norm):
                return True, f"Username inicia com: '{alvo}'"

    return False, ""


def processar_limpeza(executar: bool = False):
    print("=" * 80)
    print(" SAÚDE GUAPÉ - LIMPEZA DE CONTAS DE USUÁRIOS EXCEDENTES")
    print(f" Modo: {'>>> EXECUÇÃO REAL <<<' if executar else '--- SIMULAÇÃO (NADA SERÁ APAGADO) ---'}")
    print("=" * 80)

    with Session(engine) as db:
        todos_usuarios = db.exec(select(User).order_by(User.id)).all()

        mantidos: list[tuple[User, str]] = []
        removidos: list[User] = []

        for u in todos_usuarios:
            manter, motivo = deve_manter_usuario(u)
            if manter:
                mantidos.append((u, motivo))
            else:
                removidos.append(u)

        print(f"\n[1] USUÁRIOS QUE SERÃO MANTIDOS ({len(mantidos)} contas):")
        print("-" * 80)
        for u, motivo in mantidos:
            med_info = f"[Médico ID: {u.medico_id}]" if u.medico_id else ""
            print(f"  ✓ ID {u.id:<4} | Login: {u.username:<22} | Nome: {u.nome:<30} {med_info}")
            print(f"    └─ Motivo: {motivo}")

        print("\n" + "=" * 80)
        print(f"[2] USUÁRIOS QUE SERÃO REMOVIDOS ({len(removidos)} contas):")
        print("-" * 80)
        if not removidos:
            print("  Nenhum usuário excedente encontrado para remoção.")
        else:
            for u in removidos:
                med_info = f"[Médico ID: {u.medico_id}]" if u.medico_id else ""
                print(f"  ✗ ID {u.id:<4} | Login: {u.username:<22} | Nome: {u.nome:<30} {med_info}")

        print("\n" + "=" * 80)
        print(f"TOTAL NO BANCO: {len(todos_usuarios)} | A MANTER: {len(mantidos)} | A REMOVER: {len(removidos)}")
        print("=" * 80)

        if not executar:
            print("\n>> NENHUMA ALTERAÇÃO FOI REALIZADA (MODO DE SIMULAÇÃO).")
            print(">> Para efetivar a remoção no servidor, execute:")
            print("   docker exec -it sistema-saude-api python app/limpar_usuarios.py --confirmar\n")
            return

        if not removidos:
            print("\nNada a fazer. O banco já está limpo.")
            return

        ids_remover = [u.id for u in removidos if u.id is not None]

        # 1. Limpa preferências do dashboard (FK)
        try:
            db.exec(
                delete(UserDashboardPrefs).where(UserDashboardPrefs.user_id.in_(ids_remover))
            )
        except Exception:
            pass

        # 2. Remove da tabela usuarios
        db.exec(
            delete(User).where(User.id.in_(ids_remover))
        )
        db.commit()

        print(f"\n✅ SUCESSO! {len(ids_remover)} contas de usuários foram removidas com segurança.")
        print(f"   Restam {len(mantidos)} contas ativas no sistema.")
        print("   Nota: O cadastro dos médicos na tabela 'medicos' permanece 100% preservado.\n")


def main():
    parser = argparse.ArgumentParser(description="Limpeza segura de usuários do Saúde Guapé")
    parser.add_argument(
        "--confirmar",
        "--executar",
        action="store_true",
        help="Aplica a exclusão no banco de dados. Sem esta flag, apenas simula.",
    )
    parser.add_argument(
        "--simular",
        action="store_true",
        help="Executa apenas a simulação (comportamento padrão).",
    )
    args = parser.parse_args()

    executar = bool(args.confirmar)
    processar_limpeza(executar=executar)


if __name__ == "__main__":
    main()
