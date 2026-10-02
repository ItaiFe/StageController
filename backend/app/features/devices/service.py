import asyncio
import httpx
import socket
from typing import Optional
from sqlalchemy.orm import Session

from .models import Device, Sequence, SequenceStep
from .schemas import DeviceCreate, DeviceUpdate, SequenceCreate, SequenceUpdate, DiscoveredDevice


TASMOTA_TIMEOUT = 5.0


async def tasmota_command(ip: str, command: str) -> dict:
    """Send a command to a Tasmota device."""
    url = f"http://{ip}/cm?cmnd={command}"
    async with httpx.AsyncClient(timeout=TASMOTA_TIMEOUT) as client:
        try:
            response = await client.get(url)
            return response.json()
        except Exception:
            return {"error": "Device unreachable"}


async def get_device_state(ip: str) -> Optional[bool]:
    """Get the current power state of a Tasmota device."""
    result = await tasmota_command(ip, "Power")
    if "POWER" in result:
        return result["POWER"] == "ON"
    return None


async def set_device_state(ip: str, state: bool) -> bool:
    """Set the power state of a Tasmota device."""
    cmd = "Power%20On" if state else "Power%20Off"
    result = await tasmota_command(ip, cmd)
    return "POWER" in result


async def check_device_online(ip: str) -> bool:
    """Check if a Tasmota device is reachable."""
    result = await tasmota_command(ip, "Status")
    return "error" not in result


async def discover_tasmota_devices(subnet: str = "192.168.1") -> list[DiscoveredDevice]:
    """Scan local network for Tasmota devices."""
    discovered = []

    async def check_ip(ip: str):
        try:
            async with httpx.AsyncClient(timeout=1.0) as client:
                response = await client.get(f"http://{ip}/cm?cmnd=Status")
                if response.status_code == 200:
                    data = response.json()
                    hostname = data.get("Status", {}).get("DeviceName", None)
                    return DiscoveredDevice(ip_address=ip, hostname=hostname)
        except Exception:
            pass
        return None

    tasks = [check_ip(f"{subnet}.{i}") for i in range(1, 255)]
    results = await asyncio.gather(*tasks)

    return [d for d in results if d is not None]


def get_all_devices(db: Session) -> list[Device]:
    return db.query(Device).all()


def get_device(db: Session, device_id: int) -> Optional[Device]:
    return db.query(Device).filter(Device.id == device_id).first()


def get_device_by_ip(db: Session, ip: str) -> Optional[Device]:
    return db.query(Device).filter(Device.ip_address == ip).first()


def create_device(db: Session, data: DeviceCreate) -> Device:
    device = Device(**data.model_dump())
    db.add(device)
    db.commit()
    db.refresh(device)
    return device


def update_device(db: Session, device_id: int, data: DeviceUpdate) -> Optional[Device]:
    device = get_device(db, device_id)
    if not device:
        return None

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(device, key, value)

    db.commit()
    db.refresh(device)
    return device


def delete_device(db: Session, device_id: int) -> bool:
    device = get_device(db, device_id)
    if not device:
        return False
    db.delete(device)
    db.commit()
    return True


def update_device_state(db: Session, device_id: int, is_on: bool) -> Optional[Device]:
    device = get_device(db, device_id)
    if device:
        device.is_on = is_on
        db.commit()
        db.refresh(device)
    return device


def update_device_online_status(db: Session, device_id: int, is_online: bool) -> Optional[Device]:
    device = get_device(db, device_id)
    if device:
        device.is_online = is_online
        db.commit()
        db.refresh(device)
    return device


def get_all_sequences(db: Session) -> list[Sequence]:
    return db.query(Sequence).all()


def get_sequence(db: Session, sequence_id: int) -> Optional[Sequence]:
    return db.query(Sequence).filter(Sequence.id == sequence_id).first()


def create_sequence(db: Session, data: SequenceCreate) -> Sequence:
    sequence = Sequence(name=data.name, description=data.description)
    db.add(sequence)
    db.commit()
    db.refresh(sequence)

    for step_data in data.steps:
        step = SequenceStep(
            sequence_id=sequence.id,
            **step_data.model_dump()
        )
        db.add(step)

    db.commit()
    db.refresh(sequence)
    return sequence


def update_sequence(db: Session, sequence_id: int, data: SequenceUpdate) -> Optional[Sequence]:
    sequence = get_sequence(db, sequence_id)
    if not sequence:
        return None

    if data.name is not None:
        sequence.name = data.name
    if data.description is not None:
        sequence.description = data.description

    if data.steps is not None:
        db.query(SequenceStep).filter(SequenceStep.sequence_id == sequence_id).delete()
        for step_data in data.steps:
            step = SequenceStep(
                sequence_id=sequence_id,
                **step_data.model_dump()
            )
            db.add(step)

    db.commit()
    db.refresh(sequence)
    return sequence


def delete_sequence(db: Session, sequence_id: int) -> bool:
    sequence = get_sequence(db, sequence_id)
    if not sequence:
        return False
    db.delete(sequence)
    db.commit()
    return True


async def execute_sequence(db: Session, sequence_id: int) -> dict:
    """Execute a sequence of device commands."""
    sequence = get_sequence(db, sequence_id)
    if not sequence:
        return {"error": "Sequence not found"}

    results = []
    current_parallel_group = None
    parallel_tasks = []

    for step in sequence.steps:
        device = get_device(db, step.device_id)
        if not device:
            results.append({"step": step.order, "error": "Device not found"})
            continue

        if step.parallel_group != current_parallel_group:
            if parallel_tasks:
                await asyncio.gather(*parallel_tasks)
                parallel_tasks = []
            current_parallel_group = step.parallel_group

        async def execute_step(s, d):
            if s.delay_before > 0:
                await asyncio.sleep(s.delay_before / 1000.0)

            state = s.action == "on"
            success = await set_device_state(d.ip_address, state)

            if success:
                update_device_state(db, d.id, state)

            return {
                "step": s.order,
                "device": d.name,
                "action": s.action,
                "success": success
            }

        if step.parallel_group is not None:
            parallel_tasks.append(execute_step(step, device))
        else:
            result = await execute_step(step, device)
            results.append(result)

    if parallel_tasks:
        parallel_results = await asyncio.gather(*parallel_tasks)
        results.extend(parallel_results)

    return {"sequence": sequence.name, "results": results}
