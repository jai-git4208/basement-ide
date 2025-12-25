#!/bin/bash

# setup_sandbox.sh
# Initializes a minimal rootfs for chroot.
# Cross-platform: supports both Linux and macOS. 

set -e

#detect os
OS_TYPE="$(uname -s)"
echo "Detected OS: $OS_TYPE"

# Get the project root directory (parent of scripts/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ROOTFS="$PROJECT_ROOT/sandbox/rootfs"

echo "Setting up sandbox at $ROOTFS..."

# Create base directories
mkdir -p "$ROOTFS/bin"
mkdir -p "$ROOTFS/usr/bin"
mkdir -p "$ROOTFS/usr/local/bin"
mkdir -p "$ROOTFS/tmp"
chmod 1777 "$ROOTFS/tmp"

# Create library directories based on OS
if [[ "$OS_TYPE" == "Linux" ]]; then
    mkdir -p "$ROOTFS/lib"
    mkdir -p "$ROOTFS/lib64"
    mkdir -p "$ROOTFS/usr/lib"
    mkdir -p "$ROOTFS/usr/lib64"
elif [[ "$OS_TYPE" == "Darwin" ]]; then
    mkdir -p "$ROOTFS/usr/lib"
    mkdir -p "$ROOTFS/usr/lib/system"
    # Note: macOS uses dyld and has different library structure
fi

#helper function to copy a binary and its shared library dependencies
copy_bin() {
    local bin_name=$1
    local bin_path=""
    
    # find the binary
    if [ -f "$bin_name" ]; then
        bin_path="$bin_name"
    else
        bin_path=$(which "$bin_name" 2>/dev/null || true)
    fi

    if [ -z "$bin_path" ] || [ ! -x "$bin_path" ]; then
        echo "Warning: Could not find or execute $bin_name"
        return 1
    fi

    echo "Copying $bin_path..."
    
    #create target directory and copy binary
    local target_dir="$ROOTFS$(dirname "$bin_path")"
    mkdir -p "$target_dir"
    cp -f "$bin_path" "$ROOTFS$bin_path"

    # Copy dependencies based on OS
    if [[ "$OS_TYPE" == "Linux" ]]; then
        # Linux: use ldd to find shared libraries
        ldd "$bin_path" 2>/dev/null | grep -oE '/[^ ]+' | while read -r lib; do
            if [ -f "$lib" ]; then
                local lib_dir="$ROOTFS$(dirname "$lib")"
                mkdir -p "$lib_dir"
                if [ ! -f "$ROOTFS$lib" ]; then
                    cp -v "$lib" "$ROOTFS$lib"
                fi
            fi
        done
    elif [[ "$OS_TYPE" == "Darwin" ]]; then
        # macOS: use otool to find dylibs
        # Note: macOS has System Integrity Protection (SIP) which prevents
        # copying system libraries. This is for informational purposes.
        echo "  macOS libraries (informational - SIP may prevent copying):"
        otool -L "$bin_path" 2>/dev/null | tail -n +2 | awk '{print $1}' | while read -r lib; do
            if [[ "$lib" == /usr/lib/* ]] || [[ "$lib" == /System/* ]]; then
                echo "    System library: $lib (skipped due to SIP)"
            elif [ -f "$lib" ]; then
                local lib_dir="$ROOTFS$(dirname "$lib")"
                mkdir -p "$lib_dir"
                if [ ! -f "$ROOTFS$lib" ]; then
                    cp -v "$lib" "$ROOTFS$lib" 2>/dev/null || echo "    Could not copy: $lib"
                fi
            fi
        done
    fi
    
    return 0
}

# copy essential binaries (uncomment as needed)
echo ""
echo "Copying essential binaries..."
echo "(Uncomment the lines in the script for binaries you need)"
echo ""

# basic shell utilities
# copy_bin "/bin/sh"
# copy_bin "/bin/ls"
# copy_bin "/bin/cat"
# copy_bin "/bin/echo"

# Programming interpreters
# copy_bin "/usr/bin/python3"
# copy_bin "/usr/bin/node"
# copy_bin "/usr/local/bin/python3"  # Common on macOS with Homebrew

echo ""
echo "========================================"
echo "Sandbox setup complete!"
echo "Rootfs location: $ROOTFS"
echo ""

if [[ "$OS_TYPE" == "Darwin" ]]; then
    echo "NOTE: macOS Limitations"
    echo "  - System Integrity Protection (SIP) prevents copying system libraries"
    echo "  - chroot on macOS is more restrictive than Linux"
    echo "  - Consider using this setup primarily for development/testing"
    echo "  - For production, deploy to a Linux server"
fi

echo ""
echo "To add binaries, edit this script and uncomment the copy_bin lines."
echo "========================================"
