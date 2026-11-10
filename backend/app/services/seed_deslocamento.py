"""Seed dos 62 procedimentos de deslocamento SIGTAP (paciente + acompanhante).

Cada código = fração de 50 km; a quantidade indica os lançamentos de
faturamento por viagem para o destino.
"""

from sqlmodel import select

# (destino, cod_pac, qtd_pac, cod_acomp, qtd_acomp)
DESLOCAMENTOS = [
    ("ALFENAS", "9999900100", 6, "9999900101", 6),
    ("PASSOS", "9999900102", 6, "9999900103", 6),
    ("POÇOS DE CALDAS", "9999900104", 10, "9999900105", 10),
    ("SÃO SEBASTIÃO DO PARAÍSO", "9999900106", 8, "9999900107", 8),
    ("BELO HORIZONTE", "9999900108", 12, "9999900109", 12),
    ("BAURU", "9999900110", 20, "9999900111", 20),
    ("SÃO PAULO", "9999900112", 18, "9999900113", 18),
    ("RIBEIRÃO PRETO", "9999900114", 13, "9999900115", 13),
    ("PIUMHI", "9999900116", 2, "9999900117", 2),
    ("VARGINHA", "9999900118", 6, "9999900119", 6),
    ("CAMPINAS", "9999900120", 17, "9999900121", 17),
    ("PIMENTA", "9999900122", 1, "9999900123", 1),
    ("TRÊS PONTAS", "9999900124", 2, "9999900126", 2),
    ("SOROCABA", "9999900127", 9, "9999900128", 9),
    ("ILICÍNEA", "9999900129", 1, "9999900130", 1),
    ("CAMPO BELO", "9999900131", 2, "9999900132", 2),
    ("NEPOMUCENO", "9999900133", 2, "9999900134", 2),
    ("CÁSSIA", "9999900135", 3, "9999900136", 3),
    ("CARMO DO RIO CLARO", "9999900137", 1, "9999900138", 1),
    ("POÇO FUNDO", "9999900139", 4, "9999900140", 4),
    ("MUZAMBINHO", "9999900141", 4, "9999900142", 4),
    ("CONCEIÇÃO DA APARECIDA", "9999900143", 2, "9999900144", 2),
    ("UBERLÂNDIA", "9999900145", 8, "9999900146", 8),
    ("SERRANA", "9999900152", 6, "9999900153", 6),
    ("LAVRAS", "9999900224", 4, "9999900225", 4),
    ("DIVINÓPOLIS", "9999900241", 7, "9999900242", 7),
    ("AREADO", "9999900243", 5, "9999900244", 5),
    ("CABO VERDE", "9999900023", 8, "9999900024", 8),
    ("DORESÓPOLIS", "9999900025", 4, "9999900026", 4),
    ("PARAGUAÇU", "9999900027", 7, "9999900028", 7),
    ("BARRETOS", "9999900029", 15, "9999900030", 15),
]


def seed_deslocamento(db) -> dict:
    """Upsert idempotente: 62 procedimentos + vínculo nos destinos."""
    from app.models.lab_exames import SigtapProcedimento
    from app.models.tfd import Destino

    proc_novos = proc_ok = dest_ok = 0
    for destino, cod_p, qtd_p, cod_a, qtd_a in DESLOCAMENTOS:
        for cod, papel, qtd in ((cod_p, "PACIENTE", qtd_p), (cod_a, "ACOMPANHANTE", qtd_a)):
            obj = db.exec(
                select(SigtapProcedimento).where(
                    SigtapProcedimento.codigo == cod
                )
            ).first()
            dados = {
                "descricao": f"DESLOCAMENTO {papel} - {destino} ({qtd} X 50KM)",
                "complexidade": "MC",
                "instrumento": "BPA-C",
                "qtd_maxima": qtd,
                "competencia": "",
            }
            if obj:
                for k, v in dados.items():
                    setattr(obj, k, v)
                db.add(obj)
            else:
                db.add(SigtapProcedimento(codigo=cod, **dados))
                proc_novos += 1
            proc_ok += 1
        d = db.exec(
            select(Destino).where(Destino.nome_destino == destino)
        ).first()
        vinc = {
            "codigo_desloc_pac": cod_p, "qtd_desloc_pac": qtd_p,
            "codigo_desloc_acomp": cod_a, "qtd_desloc_acomp": qtd_a,
        }
        if d:
            for k, v in vinc.items():
                setattr(d, k, v)
            db.add(d)
        else:
            db.add(Destino(nome_destino=destino, ativo=True, **vinc))
        dest_ok += 1
    db.commit()
    return {"procedimentos": proc_ok, "procedimentos_novos": proc_novos, "destinos": dest_ok}
