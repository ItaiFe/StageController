from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from . import service
from .schemas import (
    DeviceCreate, DeviceUpdate, DeviceResponse, DeviceToggleRequest,
    SequenceCreate, SequenceUpdate, SequenceResponse, SequenceStepResponse,
    DiscoveredDevice
)

router = APIRouter(prefix="/devices", tags=["devices"])
sequences_router = APIRouter(prefix="/sequences", tags=["sequences"])


@router.get("", response_model=list[DeviceResponse])
def list_devices(db: Session = Depends(get_db)):
    return service.get_all_devices(db)


@router.get("/discover", response_model=list[DiscoveredDevice])
async def discover_devices(subnet: str = "192.168.1"):
    """Scan network for Tasmota devices."""
    return await service.discover_tasmota_devices(subnet)


@router.get("/{device_id}", response_model=DeviceResponse)
def get_device(device_id: int, db: Session = Depends(get_db)):
    device = service.get_device(db, device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    return device


@router.post("", response_model=DeviceResponse)
def create_device(data: DeviceCreate, db: Session = Depends(get_db)):
    existing = service.get_device_by_ip(db, data.ip_address)
    if existing:
        raise HTTPException(status_code=400, detail="Device with this IP already exists")
    return service.create_device(db, data)


@router.put("/{device_id}", response_model=DeviceResponse)
def update_device(device_id: int, data: DeviceUpdate, db: Session = Depends(get_db)):
    device = service.update_device(db, device_id, data)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    return device


@router.delete("/{device_id}")
def delete_device(device_id: int, db: Session = Depends(get_db)):
    if not service.delete_device(db, device_id):
        raise HTTPException(status_code=404, detail="Device not found")
    return {"message": "Device deleted"}


@router.post("/{device_id}/toggle", response_model=DeviceResponse)
async def toggle_device(device_id: int, data: DeviceToggleRequest, db: Session = Depends(get_db)):
    device = service.get_device(db, device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    success = await service.set_device_state(device.ip_address, data.state)
    if not success:
        service.update_device_online_status(db, device_id, False)
        raise HTTPException(status_code=503, detail="Device unreachable")

    service.update_device_online_status(db, device_id, True)
    return service.update_device_state(db, device_id, data.state)


@router.post("/{device_id}/refresh", response_model=DeviceResponse)
async def refresh_device_state(device_id: int, db: Session = Depends(get_db)):
    """Refresh the state of a device from the actual hardware."""
    device = service.get_device(db, device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    is_online = await service.check_device_online(device.ip_address)
    service.update_device_online_status(db, device_id, is_online)

    if is_online:
        state = await service.get_device_state(device.ip_address)
        if state is not None:
            service.update_device_state(db, device_id, state)

    return service.get_device(db, device_id)


@router.post("/all/on")
async def all_devices_on(db: Session = Depends(get_db)):
    """Turn all devices on."""
    devices = service.get_all_devices(db)
    results = []
    for device in devices:
        success = await service.set_device_state(device.ip_address, True)
        if success:
            service.update_device_state(db, device.id, True)
        results.append({"device": device.name, "success": success})
    return {"results": results}


@router.post("/all/off")
async def all_devices_off(db: Session = Depends(get_db)):
    """Turn all devices off."""
    devices = service.get_all_devices(db)
    results = []
    for device in devices:
        success = await service.set_device_state(device.ip_address, False)
        if success:
            service.update_device_state(db, device.id, False)
        results.append({"device": device.name, "success": success})
    return {"results": results}


@sequences_router.get("", response_model=list[SequenceResponse])
def list_sequences(db: Session = Depends(get_db)):
    sequences = service.get_all_sequences(db)
    result = []
    for seq in sequences:
        steps = []
        for step in seq.steps:
            device = service.get_device(db, step.device_id)
            steps.append(SequenceStepResponse(
                id=step.id,
                device_id=step.device_id,
                device_name=device.name if device else None,
                action=step.action,
                delay_before=step.delay_before,
                parallel_group=step.parallel_group,
                order=step.order
            ))
        result.append(SequenceResponse(
            id=seq.id,
            name=seq.name,
            description=seq.description,
            steps=steps
        ))
    return result


@sequences_router.get("/{sequence_id}", response_model=SequenceResponse)
def get_sequence(sequence_id: int, db: Session = Depends(get_db)):
    sequence = service.get_sequence(db, sequence_id)
    if not sequence:
        raise HTTPException(status_code=404, detail="Sequence not found")

    steps = []
    for step in sequence.steps:
        device = service.get_device(db, step.device_id)
        steps.append(SequenceStepResponse(
            id=step.id,
            device_id=step.device_id,
            device_name=device.name if device else None,
            action=step.action,
            delay_before=step.delay_before,
            parallel_group=step.parallel_group,
            order=step.order
        ))

    return SequenceResponse(
        id=sequence.id,
        name=sequence.name,
        description=sequence.description,
        steps=steps
    )


@sequences_router.post("", response_model=SequenceResponse)
def create_sequence(data: SequenceCreate, db: Session = Depends(get_db)):
    return service.create_sequence(db, data)


@sequences_router.put("/{sequence_id}", response_model=SequenceResponse)
def update_sequence(sequence_id: int, data: SequenceUpdate, db: Session = Depends(get_db)):
    sequence = service.update_sequence(db, sequence_id, data)
    if not sequence:
        raise HTTPException(status_code=404, detail="Sequence not found")
    return sequence


@sequences_router.delete("/{sequence_id}")
def delete_sequence(sequence_id: int, db: Session = Depends(get_db)):
    if not service.delete_sequence(db, sequence_id):
        raise HTTPException(status_code=404, detail="Sequence not found")
    return {"message": "Sequence deleted"}


@sequences_router.post("/{sequence_id}/execute")
async def execute_sequence(sequence_id: int, db: Session = Depends(get_db)):
    """Execute a sequence."""
    result = await service.execute_sequence(db, sequence_id)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result
