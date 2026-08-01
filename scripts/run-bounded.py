#!/usr/bin/env python3
"""Run one fixed argv with bounded output and POSIX resource limits.

Windows intentionally provides only wall-clock/output enforcement here.  A
stable Windows release remains blocked on a native CI runner that can enforce
and prove Job Object process-tree limits.
"""

import os
import signal
import subprocess
import sys
import threading
import time

MAX_TOTAL_OUTPUT = 64 * 1024 * 1024


def main() -> int:
    if len(sys.argv) < 6 or sys.argv[4] != "--":
        raise ValueError("Usage: run-bounded.py WALL_SECONDS CPU_SECONDS FILE_BYTES -- COMMAND ...")
    wall = int(sys.argv[1])
    cpu = int(sys.argv[2])
    file_bytes = int(sys.argv[3])
    if wall < 1 or cpu < 1 or file_bytes < 1:
        raise ValueError("bounded-run limits must be positive")
    command = sys.argv[5:]
    kwargs = {}
    if os.name == "posix":
        import resource

        def limits():
            os.setsid()
            resource.setrlimit(resource.RLIMIT_CPU, (cpu, cpu))
            resource.setrlimit(resource.RLIMIT_FSIZE, (file_bytes, file_bytes))
            if sys.platform.startswith("linux"):
                address_bytes = min(
                    max(file_bytes * 2, 4 * 1024 * 1024 * 1024),
                    8 * 1024 * 1024 * 1024,
                )
                resource.setrlimit(resource.RLIMIT_AS, (address_bytes, address_bytes))
            _, nofile_hard = resource.getrlimit(resource.RLIMIT_NOFILE)
            resource.setrlimit(resource.RLIMIT_NOFILE, (min(256, nofile_hard), nofile_hard))

        kwargs["preexec_fn"] = limits
    elif os.name == "nt":
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    deadline = time.monotonic() + wall
    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        **kwargs,
    )
    output_lock = threading.Lock()
    output_bytes = 0
    output_exceeded = threading.Event()

    def relay(source, destination):
        nonlocal output_bytes
        try:
            while True:
                chunk = source.read(64 * 1024)
                if not chunk:
                    break
                with output_lock:
                    output_bytes += len(chunk)
                    accepted = output_bytes <= MAX_TOTAL_OUTPUT
                if not accepted:
                    output_exceeded.set()
                    continue
                destination.buffer.write(chunk)
                destination.buffer.flush()
        except (BrokenPipeError, OSError, ValueError):
            pass

    threads = [
        threading.Thread(target=relay, args=(process.stdout, sys.stdout), daemon=True),
        threading.Thread(target=relay, args=(process.stderr, sys.stderr), daemon=True),
    ]
    for thread in threads:
        thread.start()
    reason = None
    while True:
        if output_exceeded.is_set():
            reason = f"command exceeded {MAX_TOTAL_OUTPUT} byte total-output budget"
            break
        if time.monotonic() >= deadline:
            reason = f"command exceeded {wall}s wall-clock budget"
            break
        if process.poll() is not None and all(not thread.is_alive() for thread in threads):
            break
        time.sleep(0.05)
    if reason is not None:
        try:
            if os.name == "posix":
                os.killpg(process.pid, signal.SIGKILL)
            else:
                process.kill()
        except OSError:
            pass
        try:
            process.wait(timeout=max(0.0, deadline - time.monotonic()))
        except subprocess.TimeoutExpired:
            process.kill()
        for thread in threads:
            thread.join(timeout=max(0.0, deadline - time.monotonic()))
        print(reason, file=sys.stderr)
        return 125 if output_exceeded.is_set() else 124
    if output_exceeded.is_set():
        print(f"command exceeded {MAX_TOTAL_OUTPUT} byte total-output budget", file=sys.stderr)
        return 125
    if time.monotonic() >= deadline:
        print(f"command exceeded {wall}s wall-clock budget", file=sys.stderr)
        return 124
    return process.returncode


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
