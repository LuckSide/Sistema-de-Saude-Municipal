#!/usr/bin/env python3
"""Script de migração e carga limpa de dados do módulo de Oxigênio e Equipamentos

a partir da planilha oficial 'Oxigênio (1)(1).xlsx'.
"""
import sys
import os

# Adiciona o diretório backend ao PYTHONPATH
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from app.db.session import engine
from sqlmodel import Session
from app.services.seed_oxigenio import seed_oxigenio_dados_reais


def main():
    print("Iniciando migração e carga limpa dos dados reais de oxigênio...")
    with Session(engine) as db:
        res = seed_oxigenio_dados_reais(db, force_clean=True)
        print(f"Resultado da carga: {res}")
        if res.get("ok"):
            print("Carga de dados de Oxigênio e Equipamentos concluída com sucesso!")
        else:
            print(f"Falha na carga: {res.get('erro')}")


if __name__ == "__main__":
    main()
