"""
Android ADB sync endpoints.
"""

import subprocess
from pathlib import Path

from fastapi import APIRouter, HTTPException

from ..models import AdbPushRequest, AdbStatusResponse
from ..config import get_projects_dir

router = APIRouter()

ANDROID_PATH = "/sdcard/FIRST/trajopt/"


def run_adb_command(args: list[str], timeout: int = 30) -> tuple[bool, str]:
    """Run an adb command and return (success, output)."""
    try:
        result = subprocess.run(
            ["adb"] + args,
            capture_output=True,
            text=True,
            timeout=timeout
        )
        output = result.stdout + result.stderr
        return result.returncode == 0, output.strip()
    except subprocess.TimeoutExpired:
        return False, "Command timed out"
    except FileNotFoundError:
        return False, "ADB not found. Please install Android SDK platform-tools."
    except Exception as e:
        return False, str(e)


@router.get("/adb/status", response_model=AdbStatusResponse)
async def adb_status():
    """Check if an Android device is connected."""
    success, output = run_adb_command(["devices"])

    if not success:
        return AdbStatusResponse(connected=False, device=None)

    # Parse device list (skip header line)
    lines = output.strip().split('\n')
    devices = []
    for line in lines[1:]:
        parts = line.split('\t')
        if len(parts) >= 2 and parts[1] == 'device':
            devices.append(parts[0])

    if devices:
        return AdbStatusResponse(connected=True, device=devices[0])
    return AdbStatusResponse(connected=False, device=None)


@router.post("/adb/push")
async def adb_push(request: AdbPushRequest):
    """Push a project file to the Android device."""
    filename = request.filename
    if not filename.endswith('.json'):
        filename += '.json'

    safe_filename = Path(filename).name
    source_path = get_projects_dir() / safe_filename

    if not source_path.exists():
        raise HTTPException(status_code=404, detail="Project not found")

    # First check if device is connected
    status = await adb_status()
    if not status.connected:
        raise HTTPException(status_code=400, detail="No Android device connected")

    # Create the target directory on the device
    run_adb_command(["shell", "mkdir", "-p", ANDROID_PATH])

    # Push the file
    dest_path = ANDROID_PATH + safe_filename
    success, output = run_adb_command(["push", str(source_path), dest_path])

    if success:
        return {"success": True, "path": dest_path, "message": output}
    else:
        raise HTTPException(status_code=500, detail=f"ADB push failed: {output}")
