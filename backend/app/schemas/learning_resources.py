from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class ResourceDto(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, strict=True)


class FunctionParameter(ResourceDto):
    key: str = Field(pattern=r"^[a-z][a-z0-9_]{0,15}$")
    label: str = Field(min_length=1, max_length=80)
    value: float = Field(ge=-1000, le=1000, allow_inf_nan=False)
    minimum: float = Field(ge=-1000, le=1000, allow_inf_nan=False)
    maximum: float = Field(ge=-1000, le=1000, allow_inf_nan=False)
    step: float = Field(gt=0, le=1000, allow_inf_nan=False)

    @model_validator(mode="after")
    def validate_range(self):
        if self.key in {"x", "pi", "e", "sin", "cos", "abs", "sqrt", "log", "exp"}:
            raise ValueError("参数名与保留变量或函数冲突")
        if not self.minimum < self.maximum or not self.minimum <= self.value <= self.maximum or self.step > self.maximum - self.minimum:
            raise ValueError("参数范围、当前值或步长无效")
        return self


class FunctionGraphConfig(ResourceDto):
    formula: str = Field(min_length=1, max_length=240)
    parameters: list[FunctionParameter] = Field(default_factory=list, max_length=8)
    x_min: float = Field(default=-5, ge=-1000, le=1000, allow_inf_nan=False)
    x_max: float = Field(default=5, ge=-1000, le=1000, allow_inf_nan=False)
    y_min: float = Field(default=-10, ge=-1e6, le=1e6, allow_inf_nan=False)
    y_max: float = Field(default=10, ge=-1e6, le=1e6, allow_inf_nan=False)
    samples: int = Field(default=121, ge=21, le=301)

    @model_validator(mode="after")
    def validate_ranges(self):
        if self.x_min >= self.x_max or self.y_min >= self.y_max:
            raise ValueError("坐标范围须从小到大")
        if len({parameter.key for parameter in self.parameters}) != len(self.parameters):
            raise ValueError("参数名不能重复")
        return self


class ChartSeries(ResourceDto):
    name: str = Field(min_length=1, max_length=80)
    values: list[float] = Field(min_length=1, max_length=48)

    @field_validator("values")
    @classmethod
    def finite_values(cls, values):
        import math
        if any(not math.isfinite(value) or abs(value) > 1e9 for value in values):
            raise ValueError("图表数值超出范围")
        return values


class DataChartConfig(ResourceDto):
    kind: Literal["bar", "line"] = "bar"
    title: str = Field(min_length=1, max_length=160)
    labels: list[str] = Field(min_length=1, max_length=48)
    series: list[ChartSeries] = Field(min_length=1, max_length=4)
    y_label: str = Field(default="数值", max_length=80)

    @model_validator(mode="after")
    def validate_dimensions(self):
        if any(not value.strip() or len(value) > 80 for value in self.labels):
            raise ValueError("每个数据标签须为 1—80 个字符")
        if any(len(series.values) != len(self.labels) for series in self.series):
            raise ValueError("每组数据须与标签一一对应")
        return self


class LegacyResourceConfig(ResourceDto):
    """Legacy resources expose no editable configuration until explicitly declared."""


TemplateConfiguration = FunctionGraphConfig | DataChartConfig | LegacyResourceConfig


class ResourcePreview(ResourceDto):
    configuration: TemplateConfiguration = Field(default_factory=LegacyResourceConfig)

    @field_validator("configuration")
    @classmethod
    def bounded_configuration(cls, value):
        import json
        if len(json.dumps(value.model_dump(mode="json"), ensure_ascii=False, allow_nan=False)) > 32_000:
            raise ValueError("模板配置过大")
        return value


class ResourceVersionRead(ResourceDto):
    id: int
    resource_key: str
    space_key: str
    subject_key: str
    kind: Literal["activity", "template", "media"]
    version_number: int
    title: str
    renderer: str
    definition: dict[str, Any]
    capabilities: dict[str, Any]
    provenance: dict[str, Any]
    content_sha256: str


class ResourcePage(ResourceDto):
    items: list[ResourceVersionRead]
    total: int
    limit: int
    offset: int
    next_offset: int | None


class ResourcePreviewRead(ResourceDto):
    resource_version_id: int
    renderer: str
    configuration: dict[str, Any]
    view: dict[str, Any]


class LearningSpaceRead(ResourceDto):
    key: str
    view: str
    title: str
    entry: str
    kind: Literal["legacy", "bundle"]
    accent: str


class LearningLevelRead(ResourceDto):
    key: str
    title: str


class LearningSpacesRead(ResourceDto):
    schema_version: Literal["astra-learning-spaces-v1"]
    spaces: list[LearningSpaceRead]
    levels: list[LearningLevelRead]


class ResourceInstallationRead(ResourceDto):
    installed_versions: int
    catalogue_size: int
