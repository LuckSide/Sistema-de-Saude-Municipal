"""Validações estritas de documentos e contatos (cadastros reais).

Usado pelos schemas de Médicos, Motoristas e Unidades (frontend espelha
as mesmas regras em `src/utils/validacoes.ts`). Mensagens em pt-BR.
"""

from __future__ import annotations

import re
from datetime import date

UFS = frozenset({
    "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG",
    "MS", "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR",
    "RS", "SC", "SE", "SP", "TO",
})

# DDDs válidos ANATEL (11–99, sem os blocos nunca atribuídos).
DDDS = frozenset({
    11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28,
    31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48, 49,
    51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69,
    71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89,
    91, 92, 93, 94, 95, 96, 97, 98, 99,
})

_EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")


def so_digitos(s: str | None) -> str:
    return "".join(c for c in (s or "") if c.isdigit())


def valida_cpf(cpf: str | None) -> tuple[bool, str]:
    """CPF: 11 dígitos, sem sequência repetida, DV módulo 11."""
    d = so_digitos(cpf)
    if len(d) != 11:
        return False, "CPF deve ter 11 dígitos."
    if d == d[0] * 11:
        return False, "CPF inválido. Insira um CPF real."
    for i, peso in ((9, 10), (10, 11)):
        soma = sum(int(d[j]) * (peso - j) for j in range(i))
        resto = soma % 11
        dv = 0 if resto < 2 else 11 - resto
        if int(d[i]) != dv:
            return False, "CPF inválido. Insira um CPF real."
    return True, ""


def valida_cnh(numero: str | None) -> tuple[bool, str]:
    """CNH: 11 dígitos com os dois DVs oficiais (DENATRAN).

    1º DV: Σ(d[0..8] × 9..1) mod 11 (>=10 vira 0); se o resto >= 10,
    a 2ª soma parte de 2. 2º DV: Σ(d[0..8] × 1..9) mod 11 (>=10 vira 0).
    """
    d = so_digitos(numero)
    if len(d) != 11:
        return False, "CNH deve ter 11 dígitos."
    if d == d[0] * 11:
        return False, "CNH com dígito verificador inválido."
    dig = [int(c) for c in d]
    soma1 = sum(dig[i] * (9 - i) for i in range(9))
    resto1 = soma1 % 11
    dv1 = 0 if resto1 >= 10 else resto1
    soma2 = (2 if resto1 >= 10 else 0) + sum(dig[i] * (i + 1) for i in range(9))
    resto2 = soma2 % 11
    dv2 = 0 if resto2 >= 10 else resto2
    if dv1 != dig[9] or dv2 != dig[10]:
        return False, "CNH com dígito verificador inválido."
    return True, ""


def valida_cnh_validade(valor) -> tuple[bool, str]:
    """Validade da CNH: data real, formato válido e não vencida."""
    if valor is None or (isinstance(valor, str) and not valor.strip()):
        return False, "Validade da CNH é obrigatória."
    if isinstance(valor, date):
        data = valor
    else:
        try:
            data = date.fromisoformat(str(valor)[:10])
        except ValueError:
            return False, "Validade da CNH em formato inválido (use AAAA-MM-DD)."
    if data < date.today():
        return False, "CNH vencida. Informe uma validade futura."
    return True, ""


def valida_crm(crm: str | None) -> tuple[bool, str, str]:
    """CRM: número (4–7 dígitos) + UF obrigatória. Retorna (ok, msg, normalizado).

    Aceita "123456", "123456/MG", "CRM/MG 123456" etc. Normaliza p/ "CRM/MG 123456".
    """
    txt = (crm or "").strip().upper()
    if not txt:
        return False, "CRM é obrigatório (ex: CRM/MG 123456).", ""
    sem_prefixo = re.sub(r"^CRM\s*", "", txt).strip().lstrip("/.- ").strip()
    numero, uf = "", ""
    m = re.fullmatch(r"(\d{4,7})\s*[/.\-\s]*\s*([A-Z]{2})", sem_prefixo)
    if m:
        numero, uf = m.group(1), m.group(2)
    else:
        m2 = re.fullmatch(r"([A-Z]{2})\s*[/.\-\s]*\s*(\d{4,7})", sem_prefixo)
        if m2:
            uf, numero = m2.group(1), m2.group(2)
    if not numero:
        # Só número sem UF?
        if re.fullmatch(r"\d{4,7}", sem_prefixo):
            return False, "UF do CRM é obrigatória (ex: CRM/MG 123456).", ""
        return False, "CRM inválido. Use o formato CRM/UF número (ex: CRM/MG 123456).", ""
    if uf not in UFS:
        return False, f"UF '{uf}' inválida para o CRM.", ""
    return True, "", f"CRM/{uf} {numero}"


def valida_cnes(cnes: str | None) -> tuple[bool, str]:
    """CNES: exatamente 7 dígitos numéricos."""
    d = so_digitos(cnes)
    if not d:
        return False, "CNES é obrigatório (7 dígitos)."
    if len(d) != 7:
        return False, "CNES deve ter 7 dígitos numéricos."
    return True, ""


def valida_email(email: str | None) -> tuple[bool, str]:
    """E-mail opcional: se preenchido, exige estrutura usuario@dominio.ext."""
    txt = (email or "").strip()
    if not txt:
        return True, ""
    if ".." in txt or not _EMAIL_RE.fullmatch(txt):
        return False, "E-mail inválido. Use o formato usuario@dominio.ext."
    return True, ""


def valida_telefone(tel: str | None, obrigatorio: bool = False) -> tuple[bool, str]:
    """Telefone: 10 dígitos (fixo) ou 11 (celular com 9 + DDD válido)."""
    d = so_digitos(tel)
    if not d:
        if obrigatorio:
            return False, "Telefone é obrigatório."
        return True, ""
    if d == d[0] * len(d):
        return False, "Telefone inválido."
    if len(d) == 10:
        ddd, numero = int(d[:2]), d[2:]
        if ddd not in DDDS:
            return False, "DDD inválido no telefone."
        if numero[0] not in "2345":
            return False, "Telefone fixo deve ter 10 dígitos (DDD + número iniciado em 2–5)."
        return True, ""
    if len(d) == 11:
        ddd, numero = int(d[:2]), d[2:]
        if ddd not in DDDS:
            return False, "DDD inválido no celular."
        if numero[0] != "9":
            return False, "Celular deve ter 11 dígitos (DDD + 9 + número)."
        return True, ""
    return False, "Telefone deve ter 10 dígitos (fixo) ou 11 dígitos (celular com DDD)."
