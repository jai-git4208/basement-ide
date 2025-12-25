# Makefile for Basement Remote IDE
# Supports both macOS and Linux

OS := $(shell uname -s)
CC := gcc
CFLAGS := -Wall -O2

# Paths
EXECUTOR_SRC := executor/executor.c
EXECUTOR_BIN := executor/executor_bin
SCRIPTS_DIR := scripts
SERVER_DIR := server

.PHONY: all setup build run clean help

all: build

help:
	@echo "Basement Remote IDE Build System"
	@echo "Usage:"
	@echo "  make setup   - Install dependencies and prepare sandbox"
	@echo "  make build   - Compile the executor"
	@echo "  make run     - Start the backend server"
	@echo "  make clean   - Remove binaries and temporary files"

setup:
	@echo "Setting up for $(OS)..."
	cd $(SERVER_DIR) && npm install
	chmod +x $(SCRIPTS_DIR)/setup_sandbox.sh
	./$(SCRIPTS_DIR)/setup_sandbox.sh

build: $(EXECUTOR_BIN)

$(EXECUTOR_BIN): $(EXECUTOR_SRC)
	@echo "Compiling executor on $(OS)..."
	$(CC) $(CFLAGS) $< -o $@
	@echo "Note: You may need to set the setuid bit for the executor to work without sudo."
	@echo "Example: sudo chown root $(EXECUTOR_BIN) && sudo chmod u+s $(EXECUTOR_BIN)"

run: build
	@echo "Starting server..."
	cd $(SERVER_DIR) && npm start

clean:
	rm -f $(EXECUTOR_BIN)
	rm -rf sandbox/rootfs/*
	@echo "Cleaned up."
