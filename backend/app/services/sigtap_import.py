"""Importação da Tabela Unificada SIGTAP/DATASUS.

Aceita o .zip mensal oficial (ou .txt/.csv avulsos do layout FTP) com:
- procedimentos: código (10 dígitos), descrição, complexidade, sexo,
  idades, quantidade máxima, pontos, valores SA/SP/SH e instrumento;
- compatibilidades: CBOs autorizados e CID-10 por procedimento.

Detecção de delimitador (; , | tab), encoding (utf-8-sig/latin-1) e
mapeamento por cabeçalho com apelidos. Nada é aplicado em simulação.
"""

import csv
import io
import re
import zipfile

from sqlmodel import select as _select

MAX_LINHAS = 60000
MAX_ERROS = 50

ALIases = {
    "codigo": ["co_procedimento", "codigo", "cod_procedimento", "co_proc", "procedimento"],
    "descricao": ["no_procedimento", "descricao", "nome", "ds_procedimento", "no_proc"],
    "complexidade": ["tp_complexidade", "complexidade", "nivel_complexidade"],
    "sexo": ["tp_sexo", "sexo"],
    "idade_min": ["vl_idade_min", "idade_min", "idade_minima", "qt_idade_min"],
    "idade_max": ["vl_idade_max", "idade_max", "idade_maxima", "qt_idade_max"],
    "qtd_maxima": ["qt_maxima", "qtd_maxima", "quantidade_maxima", "qt_max_execucao"],
    "pontos": ["vl_pontos", "pontos", "nu_pontos"],
    "valor_sa": ["vl_sa", "valor_sa", "vl_servico_ambulatorial"],
    "valor_sp": ["vl_sp", "valor_sp", "vl_servico_profissional"],
    "valor_sh": ["vl_sh", "valor_sh", "vl_servico_hospitalar"],
    "instrumento": ["tp_instrumento", "instrumento", "instrumento_registro"],
    "cbo": ["co_cbo", "cbo", "cod_cbo", "ocupacao"],
    "cbo_desc": ["no_cbo", "cbo_descricao", "descricao_cbo", "no_ocupacao"],
    "cid": ["co_cid", "cid", "cod_cid", "diagnostico"],
    "cid_desc": ["no_cid", "cid_descricao", "descricao_cid", "no_diagnostico"],
}

INSTRUMENTOS = {"BPA-C", "BPA-I", "BPA-F", "AIH", "APAC", "RAAS"}


def _norm_cabeca(s: str) -> str:
    import unicodedata

    s = "".join(
        c for c in unicodedata.normalize("NFD", (s or "").lower())
        if unicodedata.category(c) != "Mn"
    )
    return re.sub(r"[^a-z0-9]+", "_", s).strip("_")


def _mapa_colunas(cabeca: list[str]) -> dict[str, int]:
    norm = [_norm_cabeca(c) for c in cabeca]
    mapa: dict[str, int] = {}
    for campo, apelidos in ALIases.items():
        for i, h in enumerate(norm):
            if h in apelidos and campo not in mapa:
                mapa[campo] = i
    return mapa


def _num(v, inteiro=False):
    if v is None:
        return 0
    s = str(v).strip().replace(".", "").replace(",", ".") if "," in str(v) else str(v).strip()
    # "1.234,56" -> "1234.56"; "1234.56" mantido
    try:
        n = float(s) if s not in ("", "-", ".") else 0
    except ValueError:
        return 0
    return int(n) if inteiro else round(n, 2)


def _ler_texto(raw: bytes) -> tuple[str, str]:
    for enc in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            return raw.decode(enc), enc
        except (UnicodeDecodeError, ValueError):
            continue
    return raw.decode("latin-1", "ignore"), "latin-1"


def _linhas_registros(texto: str) -> tuple[list[str], list[list[str]]]:
    amostra = texto[:5000]
    try:
        dialeto = csv.Sniffer().sniff(amostra, delimiters=";,|\t,")
        delim = dialeto.delimiter
    except Exception:
        cont = {d: amostra.count(d) for d in [";", ",", "|", "\t"]}
        delim = max(cont, key=cont.get) or ";"
    rdr = list(csv.reader(io.StringIO(texto), delimiter=delim))
    if not rdr:
        return [], []
    # cabeçalho? primeira célula não-numérica de 10 dígitos
    primeira = [(c or "").strip() for c in rdr[0]]
    tem_codigo = any(re.fullmatch(r"\d{10}", c) for c in primeira)
    if tem_codigo:
        return [], rdr  # sem cabeçalho: posicional não suportado
    return primeira, rdr[1:]


def _eh_compat(nome_arq: str) -> str:
    n = nome_arq.lower()
    if "cbo" in n or "ocup" in n or "profis" in n:
        return "cbo"
    if "cid" in n or "diagnost" in n or "doenca" in n:
        return "cid"
    return ""


def importar_sigtap(db, arquivos: list[tuple[str, bytes]], competencia: str, usuario: str, simular: bool = True, origem: str = "upload") -> dict:
    """arquivos: [(nome, bytes)]. Retorna stats + erros (amostra)."""
    from app.models.lab_exames import (
        SigtapCbo,
        SigtapCid,
        SigtapFormaOrganizacao,
        SigtapGrupo,
        SigtapOcupacao,
        SigtapProcedimento,
        SigtapSubgrupo,
        SigtapVersao,
    )
    from app.services.cbo_normalizacao import limpar_codigo_cbo, sanitizar_texto_cbo
    from app.services.sigtap_hierarquia import GRUPOS_SIGTAP, SUBGRUPOS_SIGTAP, decompor_codigo_sigtap

    stats = {
        "simulacao": simular, "arquivo": ", ".join(n for n, _ in arquivos)[:200],
        "competencia": competencia, "processados": 0, "inseridos": 0,
        "atualizados": 0, "ignorados": 0, "cbo_total": 0, "cid_total": 0,
        "erros": [],
    }

    def erro(linha: int, motivo: str, arq: str):
        stats["ignorados"] += 1
        if len(stats["erros"]) < MAX_ERROS:
            stats["erros"].append({"arquivo": arq[:60], "linha": linha, "motivo": motivo[:160]})

    pend_proc: dict[str, dict] = {}
    pend_cbo: list[dict] = []
    pend_cid: list[dict] = []
    grupos_zip: dict[str, str] = {}
    subgrupos_zip: dict[str, str] = {}
    formas_zip: dict[str, str] = {}
    ocorrencias_zip: dict[str, str] = {}

    COMPLEXIDADE_MAP = {"0": "NA", "1": "AB", "2": "MC", "3": "AC"}
    for nome_arq, raw in arquivos:
        if nome_arq.lower().endswith(".zip"):
            try:
                zf = zipfile.ZipFile(io.BytesIO(raw))
                names = zf.namelist()
            except zipfile.BadZipFile:
                erro(0, "ZIP inválido", nome_arq)
                continue
            # ZIP oficial da Tabela Unificada DATASUS (layout fixo)
            if "tb_procedimento.txt" in names:
                zfiles = {n: zf.read(n) for n in names if not n.endswith("/")}
                # Áreas / Grupos, Subgrupos, Formas de Organização e Ocupações
                if "tb_grupo.txt" in zfiles:
                    for gline in zfiles["tb_grupo.txt"].decode("latin-1", "ignore").splitlines():
                        if len(gline) >= 3:
                            gc = gline[0:2].strip()
                            gn = gline[2:102].strip()
                            if gc.isdigit() and gn:
                                grupos_zip[gc] = gn[:150]
                if "tb_sub_grupo.txt" in zfiles:
                    for sline in zfiles["tb_sub_grupo.txt"].decode("latin-1", "ignore").splitlines():
                        if len(sline) >= 5:
                            sc = sline[0:4].strip()
                            sn = sline[4:104].strip()
                            if sc.isdigit() and sn:
                                subgrupos_zip[sc] = sn[:180]
                if "tb_forma_organizacao.txt" in zfiles:
                    for fline in zfiles["tb_forma_organizacao.txt"].decode("latin-1", "ignore").splitlines():
                        if len(fline) >= 7:
                            fc = fline[0:6].strip()
                            fn = fline[6:106].strip()
                            if fc.isdigit() and fn:
                                formas_zip[fc] = fn[:180]
                # descrições auxiliares
                ocorrencias = {}
                cids = {}
                if "tb_ocupacao.txt" in zfiles:
                    for bline in zfiles["tb_ocupacao.txt"].decode("latin-1", "ignore").splitlines():
                        if len(bline) >= 6:
                            cbo_k = limpar_codigo_cbo(bline[0:6]) or bline[0:6].strip()
                            desc_k = bline[6:156].strip()
                            if cbo_k:
                                ocorrencias[cbo_k] = desc_k
                                ocorrencias_zip[cbo_k] = desc_k
                if "tb_cid.txt" in zfiles:
                    for cline in zfiles["tb_cid.txt"].decode("latin-1", "ignore").splitlines():
                        if len(cline) >= 4:
                            cids[cline[0:4].strip()] = cline[4:104].strip()
                stats["processados"] += 0
                for line in zfiles["tb_procedimento.txt"].decode("latin-1", "ignore").splitlines():
                    if not line.strip():
                        continue
                    if len(line) < 318:
                        continue
                    if stats["processados"] >= MAX_LINHAS:
                        break
                    stats["processados"] += 1
                    cod = line[0:10].strip()
                    if not re.fullmatch(r"\d{10}", cod):
                        continue
                    desc = line[10:260].strip().upper()[:255]
                    if len(desc) < 2:
                        continue
                    comp = COMPLEXIDADE_MAP.get(line[260], (line[260].strip().upper()[:20] or "MC"))
                    if comp not in ("NA", "AB", "MC", "AC"):
                        comp = {"0": "NA", "1": "AB", "2": "MC", "3": "AC"}.get(comp, "NA")
                    sexo = line[261].strip().upper()[:10]
                    qtd_max = int((line[262:266] or "0").strip() or "0")
                    pontos = int((line[270:274] or "0").strip() or "0")
                    idade_min = int((line[274:278] or "0").strip() or "0")
                    idade_max = int((line[278:282] or "0").strip() or "0")
                    valor_sh = int((line[282:294] or "0").strip() or "0") / 100.0
                    valor_sa = int((line[294:306] or "0").strip() or "0") / 100.0
                    valor_sp = int((line[306:318] or "0").strip() or "0") / 100.0
                    hier = decompor_codigo_sigtap(cod)
                    g_cod = hier["grupo_codigo"]
                    sg_cod = hier["subgrupo_codigo"]
                    f_cod = hier["forma_organizacao"]
                    pend_proc[cod] = {
                        "codigo": cod, "descricao": desc, "complexidade": comp or "NA",
                        "instrumento": "BPA-C", "sexo": sexo,
                        "idade_min": idade_min, "idade_max": idade_max,
                        "qtd_maxima": qtd_max, "pontos": pontos,
                        "valor_sa": round(valor_sa, 2),
                        "valor_sp": round(valor_sp, 2),
                        "valor_sh": round(valor_sh, 2),
                        "competencia": competencia,
                        "grupo_codigo": g_cod,
                        "grupo_nome": (grupos_zip.get(g_cod) or GRUPOS_SIGTAP.get(g_cod, hier["grupo_nome"]))[:150],
                        "subgrupo_codigo": sg_cod,
                        "subgrupo_nome": (subgrupos_zip.get(sg_cod) or SUBGRUPOS_SIGTAP.get(sg_cod, hier["subgrupo_nome"]))[:180],
                        "forma_organizacao_codigo": f_cod,
                        "forma_organizacao_nome": formas_zip.get(f_cod, "")[:180],
                    }
                # CBO ocupação compatível
                if "rl_procedimento_ocupacao.txt" in zfiles:
                    vistos = set()
                    for line in zfiles["rl_procedimento_ocupacao.txt"].decode("latin-1", "ignore").splitlines():
                        if len(line) < 16:
                            continue
                        cod = line[0:10].strip()
                        cbo = limpar_codigo_cbo(line[10:16]) or line[10:16].strip()
                        if not re.fullmatch(r"\d{10}", cod) or not cbo:
                            continue
                        chave = (cod, cbo)
                        if chave in vistos:
                            continue
                        vistos.add(chave)
                        pend_cbo.append({"procedimento_codigo": cod, "cbo": cbo, "descricao": ocorrencias.get(cbo, "")[:120]})
                        stats["cbo_total"] += 1
                # CID compatível
                if "rl_procedimento_cid.txt" in zfiles:
                    vistos = set()
                    for line in zfiles["rl_procedimento_cid.txt"].decode("latin-1").splitlines():
                        if len(line) < 14:
                            continue
                        cod = line[0:10].strip()
                        cid = line[10:14].strip()
                        if not re.fullmatch(r"\d{10}", cod) or not cid:
                            continue
                        chave = (cod, cid)
                        if chave in vistos:
                            continue
                        vistos.add(chave)
                        pend_cid.append({"procedimento_codigo": cod, "cid": cid, "descricao": cids.get(cid, "")[:255]})
                        stats["cid_total"] += 1
                stats["simulacao"] = simular
                stats["ignorados"] = 0
                stats["erros"] = []
                # procedimentos pendentes são todos os encontrados
                continue
            membros = [(n, zf.read(n)) for n in names
                       if not n.endswith("/") and n.lower().endswith((".txt", ".csv", ".dat"))]
            if not membros:
                erro(0, "ZIP sem .txt/.csv de dados", nome_arq)
                continue
        else:
            membros = [(nome_arq, raw)]
        for membro_nome, membro_raw in membros:
            texto, _enc = _ler_texto(membro_raw)
            cabeca, linhas = _linhas_registros(texto)
            if not cabeca:
                erro(0, "sem cabeçalho reconhecível (use o layout oficial com nomes de coluna)", membro_nome)
                continue
            mapa = _mapa_colunas(cabeca)
            tipo_compat = _eh_compat(membro_nome)
            if not tipo_compat and "codigo" not in mapa:
                erro(0, f"cabeçalho sem coluna de código (encontradas: {', '.join(cabeca[:8])})", membro_nome)
                continue
            get = lambda lin, campo: (lin[mapa[campo]].strip() if campo in mapa and mapa[campo] < len(lin) else "")

            for i, lin in enumerate(linhas, start=2):
                if stats["processados"] >= MAX_LINHAS:
                    break
                stats["processados"] += 1
                cod = re.sub(r"\D", "", get(lin, "codigo"))
                if tipo_compat == "cbo":
                    if not re.fullmatch(r"\d{10}", cod):
                        erro(i, "código do procedimento inválido", membro_nome)
                        continue
                    cbo = re.sub(r"\D", "", get(lin, "cbo"))[:10]
                    if not cbo:
                        erro(i, "CBO ausente", membro_nome)
                        continue
                    pend_cbo.append({"procedimento_codigo": cod, "cbo": cbo, "descricao": get(lin, "cbo_desc")[:120]})
                    stats["cbo_total"] += 1
                    continue
                if tipo_compat == "cid":
                    if not re.fullmatch(r"\d{10}", cod):
                        erro(i, "código do procedimento inválido", membro_nome)
                        continue
                    cid = get(lin, "cid").upper().replace(".", "")[:10]
                    if not cid:
                        erro(i, "CID ausente", membro_nome)
                        continue
                    pend_cid.append({"procedimento_codigo": cod, "cid": cid, "descricao": get(lin, "cid_desc")[:255]})
                    stats["cid_total"] += 1
                    continue
                # procedimento
                if not re.fullmatch(r"\d{10}", cod):
                    erro(i, "código deve ter 10 dígitos", membro_nome)
                    continue
                desc = get(lin, "descricao").upper()[:255]
                if len(desc) < 2:
                    erro(i, "descrição ausente", membro_nome)
                    continue
                comp = get(lin, "complexidade").upper()[:20] or "MC"
                if comp not in ("AB", "MC", "AC"):
                    comp = {"ATENCAO BASICA": "AB", "MEDIA COMPLEXIDADE": "MC", "ALTA COMPLEXIDADE": "AC"}.get(comp, "MC")
                inst = get(lin, "instrumento").upper()[:10] or "BPA-C"
                if inst not in INSTRUMENTOS:
                    inst = "BPA-C" if "BPA" in inst else (inst if len(inst) <= 10 else "BPA-C")
                    if inst not in INSTRUMENTOS:
                        inst = "BPA-C"
                hier_csv = decompor_codigo_sigtap(cod)
                g_cod_csv = hier_csv["grupo_codigo"]
                sg_cod_csv = hier_csv["subgrupo_codigo"]
                f_cod_csv = hier_csv["forma_organizacao"]
                pend_proc[cod] = {
                    "codigo": cod, "descricao": desc, "complexidade": comp,
                    "instrumento": inst, "sexo": get(lin, "sexo").upper()[:10],
                    "idade_min": _num(get(lin, "idade_min"), True),
                    "idade_max": _num(get(lin, "idade_max"), True),
                    "qtd_maxima": _num(get(lin, "qtd_maxima"), True),
                    "pontos": _num(get(lin, "pontos"), True),
                    "valor_sa": _num(get(lin, "valor_sa")),
                    "valor_sp": _num(get(lin, "valor_sp")),
                    "valor_sh": _num(get(lin, "valor_sh")),
                    "competencia": competencia,
                    "grupo_codigo": g_cod_csv,
                    "grupo_nome": GRUPOS_SIGTAP.get(g_cod_csv, hier_csv["grupo_nome"])[:150],
                    "subgrupo_codigo": sg_cod_csv,
                    "subgrupo_nome": SUBGRUPOS_SIGTAP.get(sg_cod_csv, hier_csv["subgrupo_nome"])[:180],
                    "forma_organizacao_codigo": f_cod_csv,
                    "forma_organizacao_nome": formas_zip.get(f_cod_csv, "")[:180],
                }

    if not simular:
        # Upsert árvore hierárquica SIGTAP (grupos, subgrupos, formas, ocupações normalizadas)
        grupos_db = {g.codigo: g for g in db.exec(_select(SigtapGrupo)).all()}
        for gc, gn in ({**GRUPOS_SIGTAP, **grupos_zip}).items():
            if gc not in grupos_db:
                g_obj = SigtapGrupo(codigo=gc, nome=gn[:150])
                db.add(g_obj)
                grupos_db[gc] = g_obj
            elif grupos_zip.get(gc) and grupos_db[gc].nome != grupos_zip[gc][:150]:
                grupos_db[gc].nome = grupos_zip[gc][:150]
                db.add(grupos_db[gc])

        subgrupos_db = {s.codigo: s for s in db.exec(_select(SigtapSubgrupo)).all()}
        for sc, sn in ({**SUBGRUPOS_SIGTAP, **subgrupos_zip}).items():
            if sc not in subgrupos_db:
                sg_obj = SigtapSubgrupo(codigo=sc, grupo_codigo=sc[:2], nome=sn[:180])
                db.add(sg_obj)
                subgrupos_db[sc] = sg_obj
            elif subgrupos_zip.get(sc) and subgrupos_db[sc].nome != subgrupos_zip[sc][:180]:
                subgrupos_db[sc].nome = subgrupos_zip[sc][:180]
                db.add(subgrupos_db[sc])

        if formas_zip:
            formas_db = {f.codigo: f for f in db.exec(_select(SigtapFormaOrganizacao)).all()}
            for fc, fn in formas_zip.items():
                if fc not in formas_db:
                    db.add(SigtapFormaOrganizacao(codigo=fc, grupo_codigo=fc[:2], subgrupo_codigo=fc[:4], nome=fn[:180]))
                elif formas_db[fc].nome != fn[:180]:
                    formas_db[fc].nome = fn[:180]
                    db.add(formas_db[fc])

        ocup_db = {
            limpar_codigo_cbo(o.cbo): o
            for o in db.exec(_select(SigtapOcupacao)).all()
            if limpar_codigo_cbo(o.cbo)
        }
        for cbo_k, desc_k in ocorrencias_zip.items():
            if cbo_k and desc_k:
                if cbo_k not in ocup_db:
                    oc = SigtapOcupacao(cbo=cbo_k, descricao=desc_k[:150], descricao_normalizada=sanitizar_texto_cbo(desc_k)[:150], ativo=True)
                    db.add(oc)
                    ocup_db[cbo_k] = oc
                elif desc_k[:150] != ocup_db[cbo_k].descricao:
                    ocup_db[cbo_k].descricao = desc_k[:150]
                    ocup_db[cbo_k].descricao_normalizada = sanitizar_texto_cbo(desc_k)[:150]
                    db.add(ocup_db[cbo_k])

        existentes = {p.codigo: p for p in db.exec(
            _select(SigtapProcedimento)
        ).all()} if pend_proc else {}
        for cod, dados in pend_proc.items():
            obj = existentes.get(cod)
            if obj:
                for k, v in dados.items():
                    setattr(obj, k, v)
                db.add(obj)
                stats["atualizados"] += 1
            else:
                db.add(SigtapProcedimento(**dados))
                stats["inseridos"] += 1
        db.commit()
        if pend_cbo:
            cbo_existentes = {
                (row.procedimento_codigo, limpar_codigo_cbo(row.cbo) or row.cbo): row
                for row in db.exec(_select(SigtapCbo)).all()
            }
            vistos = set()
            for c in pend_cbo:
                cbo_norm = limpar_codigo_cbo(c["cbo"]) or c["cbo"]
                chave = (c["procedimento_codigo"], cbo_norm)
                if chave in vistos:
                    continue
                vistos.add(chave)
                if chave in cbo_existentes:
                    ex_cbo = cbo_existentes[chave]
                    if c.get("descricao") and not ex_cbo.descricao:
                        ex_cbo.descricao = c["descricao"]
                        db.add(ex_cbo)
                else:
                    db.add(SigtapCbo(procedimento_codigo=c["procedimento_codigo"], cbo=cbo_norm, descricao=c.get("descricao", "")))
            db.commit()
        if pend_cid:
            cid_existentes = {
                (row.procedimento_codigo, row.cid): row
                for row in db.exec(_select(SigtapCid)).all()
            }
            vistos = set()
            for c in pend_cid:
                chave = (c["procedimento_codigo"], c["cid"])
                if chave in vistos or chave in cid_existentes:
                    continue
                vistos.add(chave)
                db.add(SigtapCid(**c))
            db.commit()
        db.add(SigtapVersao(
            competencia=competencia, origem=origem[:20],
            arquivo=stats["arquivo"][:255], total_proc=len(pend_proc),
            inseridos=stats["inseridos"], atualizados=stats["atualizados"],
            cbo_total=stats["cbo_total"], cid_total=stats["cid_total"],
            ignorados=stats["ignorados"], usuario=(usuario or "")[:120],
        ))
        db.commit()
    else:
        # simulação: estima inseridos x atualizados sem gravar
        if pend_proc:
            existentes = {c for c in db.exec(
                _select(SigtapProcedimento.codigo).where(
                    SigtapProcedimento.codigo.in_(list(pend_proc)[:2000])
                )
            ).all()}
            stats["atualizados"] = sum(1 for c in pend_proc if c in existentes)
            stats["inseridos"] = len(pend_proc) - stats["atualizados"]
    return stats
