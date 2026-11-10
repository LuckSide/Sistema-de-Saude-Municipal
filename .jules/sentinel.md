## 2025-02-09 - Information Leakage via HTTPException

**Vulnerability:** Several parts of the application were leaking raw error messages (such as stack traces or internal structure details from `ValueError` and `Exception` blocks) to the client by directly exposing `str(e)` or `f"{e}"` via `HTTPException` details (e.g. `raise HTTPException(status_code=400, detail=str(e))`).
**Learning:** Returning unhandled exception string representations directly in 4xx or 5xx responses enables attackers to gather internal architecture, ORM structure, or database errors.
**Prevention:** Instead of reflecting internal errors, return generic, safe error strings to the client (e.g., "Falha interna. Consulte os logs." or "Erro de validação ou regra de negócio."). The original `Exception` trace must remain confined to backend standard logging so debugging is still possible.
