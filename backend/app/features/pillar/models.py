from sqlalchemy import Column, Integer, String, JSON

from app.core.database import Base


class PillarPlan(Base):
    """A saved sequence for one slot; slots without a row use the ESP's built-in default."""
    __tablename__ = "pillar_plans"

    slot = Column(String, primary_key=True)
    data = Column(JSON, nullable=False)


class PillarMeta(Base):
    """Single row holding the plans version the ESP watches for changes."""
    __tablename__ = "pillar_meta"

    id = Column(Integer, primary_key=True)
    plans_version = Column(Integer, nullable=False, default=0)
