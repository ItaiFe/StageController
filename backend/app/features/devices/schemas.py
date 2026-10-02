from pydantic import BaseModel
from typing import Optional


class DeviceBase(BaseModel):
    name: str
    ip_address: str
    role: str


class DeviceCreate(DeviceBase):
    pass


class DeviceUpdate(BaseModel):
    name: Optional[str] = None
    ip_address: Optional[str] = None
    role: Optional[str] = None


class DeviceResponse(DeviceBase):
    id: int
    is_on: bool
    is_online: bool

    class Config:
        from_attributes = True


class DeviceToggleRequest(BaseModel):
    state: bool  # True = on, False = off


class SequenceStepBase(BaseModel):
    device_id: int
    action: str  # "on" or "off"
    delay_before: int = 0
    parallel_group: Optional[int] = None
    order: int


class SequenceStepCreate(SequenceStepBase):
    pass


class SequenceStepResponse(SequenceStepBase):
    id: int
    device_name: Optional[str] = None

    class Config:
        from_attributes = True


class SequenceBase(BaseModel):
    name: str
    description: Optional[str] = None


class SequenceCreate(SequenceBase):
    steps: list[SequenceStepCreate] = []


class SequenceUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    steps: Optional[list[SequenceStepCreate]] = None


class SequenceResponse(SequenceBase):
    id: int
    steps: list[SequenceStepResponse] = []

    class Config:
        from_attributes = True


class DiscoveredDevice(BaseModel):
    ip_address: str
    name: Optional[str] = None
    hostname: Optional[str] = None
