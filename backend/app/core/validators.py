"""Validadores centrais do sistema (CNS módulo 11, CPF, CNH, CRM, CNES, Telefone, E-mail).

Módulo canônico conforme diretrizes do Ministério da Saúde / SUS.
"""

from app.services.validacoes import (
    so_digitos,
    valida_cnes,
    valida_cnh,
    valida_cnh_validade,
    valida_cns,
    valida_cpf,
    valida_crm,
    valida_email,
    valida_telefone,
    UFS,
    DDDS,
)

__all__ = [
    "so_digitos",
    "valida_cnes",
    "valida_cnh",
    "valida_cnh_validade",
    "valida_cns",
    "valida_cpf",
    "valida_crm",
    "valida_email",
    "valida_telefone",
    "UFS",
    "DDDS",
]
