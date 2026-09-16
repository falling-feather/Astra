"""Bound SQL expression for integer membership in a JSON array on supported DBs."""
from sqlalchemy import Boolean
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.sql.functions import FunctionElement


class JsonArrayHasInteger(FunctionElement):
    type = Boolean()
    inherit_cache = True


@compiles(JsonArrayHasInteger, "sqlite")
def _sqlite(element, compiler, **kwargs):
    array, value = list(element.clauses)
    return f"EXISTS (SELECT 1 FROM json_each({compiler.process(array, **kwargs)}) AS evidence_item WHERE evidence_item.value = {compiler.process(value, **kwargs)})"


@compiles(JsonArrayHasInteger, "mysql")
def _mysql(element, compiler, **kwargs):
    array, value = list(element.clauses)
    return f"JSON_CONTAINS({compiler.process(array, **kwargs)}, CAST({compiler.process(value, **kwargs)} AS JSON))"
