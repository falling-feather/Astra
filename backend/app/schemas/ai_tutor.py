from pydantic import BaseModel, Field, field_validator


class AiTutorConfigRead(BaseModel):
    enabled: bool
    provider: str
    model: str | None = None


class AiTutorChatCreate(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    context: dict[str, str] | None = None

    @field_validator("message")
    @classmethod
    def non_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("问题不能为空")
        return value


class AiTutorChatRead(BaseModel):
    answer: str
    provider: str
    model: str
