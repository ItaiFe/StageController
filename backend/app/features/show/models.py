from sqlalchemy import JSON, Column, String

from app.core.database import Base


class ShowTunable(Base):
    """An operator's override of a spec tunable; no row = the spec's default."""
    __tablename__ = "show_tunables"

    id = Column(String, primary_key=True)
    value = Column(JSON, nullable=False)
