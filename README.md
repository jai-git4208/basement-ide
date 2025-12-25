# Basement Remote IDE

A self-hosted, simplified remote IDE/code execution environment similar to Replit. Designed for personal home servers, but now compatible with both **macOS** and **Linux**.

## Features

- **Web-based Editor**: Powered by Monaco (the core of VS Code).
- **Sandboxed Execution**: Uses `chroot` and privilege dropping to isolate code execution.
- **Multi-language Support**: Python and JavaScript (Node.js) support out of the box.
- **Cross-Platform**: Works on Linux (optimized) and macOS (development/testing).

## Architecture

1. **Client**: A modern web interface with a code editor and terminal output.
2. **Server**: A Node.js backend that manages file I/O and triggers execution.
3. **Executor**: A small C program that performs `chroot` and drops privileges to a non-root user before executing code.
4. **Sandbox**: A minimal root filesystem (`rootfs`) where code is executed.

## Setup & Installation

### Prerequisites

- **Node.js**: v14 or later.
- **GCC**: Required to compile the executor.
- **sudo**: Required for `chroot` and `setuid` operations.
- **Unix-like OS**: macOS or any Linux distribution.

### Quick Start

1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd basement
   ```

2. **Run the setup**:
   This will install npm dependencies, compile the `executor`, and initialize the sandbox `rootfs`.
   ```bash
   make setup
   ```

3. **Start the server**:
   ```bash
   make run
   ```

4. **Access the IDE**:
   Open `client/index.html` in your browser (or use a local web server to serve the `client` directory).

## Platform-Specific Notes

### Linux (Target Environment)
- Full isolation via `chroot`.
- In production, it is recommended to use Linux Namespaces (unshare) for even better isolation (not yet implemented in this version).

### macOS (Development Environment)
- **SIP (System Integrity Protection)**: macOS prevents copying system libraries into the `rootfs`. The setup script handles this by identifying skipped libraries.
- **chroot**: On macOS, `chroot` is restricted. Ensure you run the server with appropriate permissions or configure `sudoers`.

## Security

> [!WARNING]
> This is a project intended for **internal/home use**. While it uses `chroot` and privilege dropping, it is NOT a bulletproof sandbox. Do not expose this to the public internet without additional layers of security (e.g., Docker, virtual machines, or specific network isolation).

### Improving Isolation
To allow the executor to run without typing `sudo` every time:
```bash
sudo chown root executor/executor_bin
sudo chmod u+s executor/executor_bin
```

## License
MIT
