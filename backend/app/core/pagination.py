"""Helper paginação padrão: ?page=1&limit=100 → {data,total,page,pages}."""

from math import ceil
from typing import Generic, TypeVar

from fastapi import Query
from pydantic import BaseModel

T = TypeVar("T")


class Pagina(BaseModel, Generic[T]):
    data: list[T] = []
    total: int = 0
    page: int = 1
    pages: int = 1


def page_params(
    page: int = Query(default=1, ge=1, le=100000),
    limit: int = Query(default=100, ge=1, le=100000),
) -> tuple[int, int]:
    return page, limit


def paginar(total: int, page: int, limit: int) -> dict:
    pages = max(1, ceil(total / limit)) if total else 1
    page = min(max(1, page), pages)
    return {"total": total, "page": page, "pages": pages, "offset": (page - 1) * limit}
