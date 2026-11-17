"""Script CLI para importação massiva de exames e filas a partir de XML (Vivver / e-SUS).

Uso:
  python3 backend/scripts/importar_exames_xml.py [--arquivo /caminho/arquivo.xml] [--simular]
"""

import argparse
import sys
import time
from pathlib import Path

# Ajusta path para importar o módulo app
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlmodel import Session

from app.db.session import engine, init_db
from app.services.importacao_filas import ler_xml, processar_linhas


def main():
    parser = argparse.ArgumentParser(description="Importação massiva de exames a partir de XML")
    parser.add_argument(
        "--arquivo",
        "-a",
        default="/home/mateus/Documentos/baixar/exames_laboratorio.xml",
        help="Caminho do arquivo XML de exames (default: /home/mateus/Documentos/baixar/exames_laboratorio.xml)",
    )
    parser.add_argument(
        "--simular",
        "-s",
        action="store_true",
        help="Executa em modo simulação (dry-run, sem gravar no banco de dados)",
    )
    args = parser.parse_args()

    caminho = Path(args.arquivo)
    if not caminho.exists():
        print(f"[ERRO] Arquivo não encontrado: {caminho}")
        sys.exit(1)

    print("=" * 70)
    print("  Importação Massiva de Exames Laboratoriais (XML Vivver / e-SUS)")
    print("=" * 70)
    print(f"[*] Arquivo: {caminho} ({caminho.stat().st_size / (1024 * 1024):.2f} MB)")
    print(f"[*] Modo: {'SIMULAÇÃO (dry-run)' if args.simular else 'PRODUÇÃO (gravação real)'}")

    # Inicializa banco e migrações estruturais
    print("[*] Verificando estrutura e migrações do banco de dados...")
    init_db()

    # Leitura do XML
    print("[*] Lendo e interpretando arquivo XML...")
    t0 = time.time()
    with open(caminho, "rb") as f:
        conteudo = f.read()

    try:
        linhas = ler_xml(conteudo)
    except Exception as e:
        print(f"[ERRO] Falha ao processar XML: {e}")
        sys.exit(1)

    t_leitura = time.time() - t0
    print(f"[OK] {len(linhas)} registros carregados do XML em {t_leitura:.2f}s.")

    # Processamento e carga no banco
    print("[*] Processando pacientes, filas laboratoriais e agendamentos...")
    t1 = time.time()
    with Session(engine) as db:
        res = processar_linhas(linhas, db, simular=args.simular)

    t_proc = time.time() - t1
    print("\n" + "=" * 70)
    print("  Resultado da Carga de Exames")
    print("=" * 70)
    print(f"  Total de registros lidos:     {res['lidas']}")
    print(f"  Pacientes novos cadastrados:  {res['pacientes_novos']}")
    print(f"  Exames novos inseridos:       {res['exames_novos']}")
    print(f"  Registros atualizados:        {res['atualizados']}")
    print(f"  Duplicidades ignoradas:       {res['duplicados']}")
    print(f"  Linhas inválidas/ignoradas:   {res['ignoradas']}")
    print(f"  Catálogo:                     {res.get('catalogo')}")
    if res.get("erros"):
        print(f"  Erros encontrados ({len(res['erros'])}):")
        for err in res["erros"][:5]:
            print(f"    - Linha {err.get('linha')}: {err.get('motivo')}")
    print(f"\n[*] Concluído em {t_proc:.2f}s com sucesso total.")
    print("=" * 70)


if __name__ == "__main__":
    main()
