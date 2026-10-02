from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, JSON
from sqlalchemy.orm import relationship

from app.core.database import Base


class Device(Base):
    __tablename__ = "devices"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    ip_address = Column(String, nullable=False, unique=True)
    role = Column(String, nullable=False)  # bubble_machine, flickers, lights, smoke_machine, custom
    is_on = Column(Boolean, default=False)
    is_online = Column(Boolean, default=True)

    sequence_steps = relationship("SequenceStep", back_populates="device", cascade="all, delete-orphan")


class Sequence(Base):
    __tablename__ = "sequences"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)

    steps = relationship("SequenceStep", back_populates="sequence", cascade="all, delete-orphan", order_by="SequenceStep.order")


class SequenceStep(Base):
    __tablename__ = "sequence_steps"

    id = Column(Integer, primary_key=True, index=True)
    sequence_id = Column(Integer, ForeignKey("sequences.id", ondelete="CASCADE"), nullable=False)
    device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False)
    action = Column(String, nullable=False)  # "on" or "off"
    delay_before = Column(Integer, default=0)  # milliseconds delay before this step
    parallel_group = Column(Integer, nullable=True)  # steps with same group run in parallel
    order = Column(Integer, nullable=False)

    sequence = relationship("Sequence", back_populates="steps")
    device = relationship("Device", back_populates="sequence_steps")
