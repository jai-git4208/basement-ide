const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const pty = require('node-pty');
const kill = require('tree-kill');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

const port = 3000;

app.use(cors());
app.use(bodyParser.json());

// --- Configuration ---
const PROJECT_ROOT = path.resolve(__dirname, '..');
const WORKSPACES_ROOT = path.join(PROJECT_ROOT, 'workspaces');

// Ensure workspaces directory exists
if (!fs.existsSync(WORKSPACES_ROOT)) {
    fs.mkdirSync(WORKSPACES_ROOT, { recursive: true });
}

// Serve static files from the client directory
app.use(express.static(path.join(PROJECT_ROOT, 'client')));

// --- Terminal Sessions ---
const terminals = {};
const terminalLogs = {};

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('create-terminal', (data) => {
        const { sessionId } = data || {};
        const termId = sessionId || socket.id;

        if (terminals[termId]) {
            socket.emit('terminal-created', { termId });
            return;
        }

        // Create workspace for this session
        const workspaceDir = path.join(WORKSPACES_ROOT, termId);
        if (!fs.existsSync(workspaceDir)) {
            fs.mkdirSync(workspaceDir, { recursive: true });
        }

        // Spawn a shell
        const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
        const term = pty.spawn(shell, [], {
            name: 'xterm-color',
            cols: 80,
            rows: 30,
            cwd: workspaceDir,
            env: process.env
        });

        terminals[termId] = term;
        terminalLogs[termId] = '';

        term.on('data', (data) => {
            terminalLogs[termId] += data;
            socket.emit('terminal-output', data);
        });

        term.on('exit', () => {
            delete terminals[termId];
            socket.emit('terminal-exit');
        });

        socket.emit('terminal-created', { termId });
    });

    socket.on('terminal-input', (data) => {
        const { termId, input } = data;
        if (terminals[termId]) {
            terminals[termId].write(input);
        }
    });

    socket.on('terminal-resize', (data) => {
        const { termId, cols, rows } = data;
        if (terminals[termId]) {
            terminals[termId].resize(cols, rows);
        }
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        // Optional: keep terminals alive or kill them
    });
});

// --- File Management API ---

// Create workspace if it doesn't exist
function ensureWorkspace(sessionId) {
    const workspaceDir = path.join(WORKSPACES_ROOT, sessionId);
    if (!fs.existsSync(workspaceDir)) {
        fs.mkdirSync(workspaceDir, { recursive: true });
    }
    return workspaceDir;
}

// List files in workspace
app.get('/api/files/list', (req, res) => {
    const { sessionId } = req.query;
    if (!sessionId) {
        return res.status(400).json({ error: 'sessionId required' });
    }

    const workspaceDir = ensureWorkspace(sessionId);

    function readDirRecursive(dir, base = '') {
        const files = [];
        const items = fs.readdirSync(dir);

        for (const item of items) {
            const fullPath = path.join(dir, item);
            const relativePath = path.join(base, item);
            const stat = fs.statSync(fullPath);

            if (stat.isDirectory()) {
                files.push({
                    name: item,
                    path: relativePath,
                    type: 'directory',
                    children: readDirRecursive(fullPath, relativePath)
                });
            } else {
                files.push({
                    name: item,
                    path: relativePath,
                    type: 'file',
                    size: stat.size
                });
            }
        }

        return files;
    }

    try {
        const files = readDirRecursive(workspaceDir);
        res.json({ files });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Read file content
app.get('/api/files/read', (req, res) => {
    const { sessionId, filepath } = req.query;
    if (!sessionId || !filepath) {
        return res.status(400).json({ error: 'sessionId and filepath required' });
    }

    const workspaceDir = ensureWorkspace(sessionId);
    const fullPath = path.join(workspaceDir, filepath);

    // Security check: ensure file is within workspace
    if (!fullPath.startsWith(workspaceDir)) {
        return res.status(403).json({ error: 'Access denied' });
    }

    try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        res.json({ content });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create or update file
app.post('/api/files/save', (req, res) => {
    const { sessionId, filepath, content } = req.body;
    if (!sessionId || !filepath) {
        return res.status(400).json({ error: 'sessionId and filepath required' });
    }

    const workspaceDir = ensureWorkspace(sessionId);
    const fullPath = path.join(workspaceDir, filepath);

    // Security check
    if (!fullPath.startsWith(workspaceDir)) {
        return res.status(403).json({ error: 'Access denied' });
    }

    try {
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(fullPath, content || '');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete file
app.delete('/api/files/delete', (req, res) => {
    const { sessionId, filepath } = req.body;
    if (!sessionId || !filepath) {
        return res.status(400).json({ error: 'sessionId and filepath required' });
    }

    const workspaceDir = ensureWorkspace(sessionId);
    const fullPath = path.join(workspaceDir, filepath);

    if (!fullPath.startsWith(workspaceDir)) {
        return res.status(403).json({ error: 'Access denied' });
    }

    try {
        fs.unlinkSync(fullPath);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Code Execution API ---

function findInterpreter(lang) {
    const interpreters = {
        python: ['/usr/bin/python3', '/usr/local/bin/python3', '/opt/homebrew/bin/python3'],
        javascript: ['/usr/local/bin/node', '/opt/homebrew/bin/node', '/usr/bin/node'],
        bash: ['/bin/bash'],
        sh: ['/bin/sh']
    };

    const paths = interpreters[lang] || [];
    for (const p of paths) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

app.post('/api/execute', (req, res) => {
    const { sessionId, language, code, filepath } = req.body;

    if (!sessionId) {
        return res.status(400).json({ error: 'sessionId required' });
    }

    const workspaceDir = ensureWorkspace(sessionId);
    let fileToExecute;

    // If filepath provided, use that, otherwise create temp file
    if (filepath) {
        fileToExecute = path.join(workspaceDir, filepath);
        if (!fs.existsSync(fileToExecute)) {
            return res.status(404).json({ error: 'File not found' });
        }
    } else {
        // Create temporary file
        const ext = language === 'python' ? 'py' : (language === 'javascript' ? 'js' : 'sh');
        const filename = `temp_${Date.now()}.${ext}`;
        fileToExecute = path.join(workspaceDir, filename);
        fs.writeFileSync(fileToExecute, code || '');
    }

    const interpreter = findInterpreter(language);
    if (!interpreter) {
        return res.status(400).json({ error: `Interpreter for ${language} not found` });
    }

    const proc = spawn(interpreter, [fileToExecute], {
        cwd: workspaceDir,
        timeout: 30000, // 30 seconds
        env: process.env
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
        stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
        stderr += data.toString();
    });

    proc.on('close', (code) => {
        // Clean up temp file if we created it
        if (!filepath && fs.existsSync(fileToExecute)) {
            try { fs.unlinkSync(fileToExecute); } catch (e) { }
        }

        res.json({
            stdout,
            stderr,
            exitCode: code
        });
    });

    proc.on('error', (err) => {
        if (!filepath && fs.existsSync(fileToExecute)) {
            try { fs.unlinkSync(fileToExecute); } catch (e) { }
        }
        res.status(500).json({ error: err.message });
    });

    // Kill process after timeout
    setTimeout(() => {
        if (!proc.killed) {
            kill(proc.pid, 'SIGKILL');
        }
    }, 31000);
});

// Compile C/C++ code
app.post('/api/compile', (req, res) => {
    const { sessionId, filepath, language } = req.body;

    if (!sessionId || !filepath) {
        return res.status(400).json({ error: 'sessionId and filepath required' });
    }

    const workspaceDir = ensureWorkspace(sessionId);
    const sourceFile = path.join(workspaceDir, filepath);

    if (!fs.existsSync(sourceFile)) {
        return res.status(404).json({ error: 'Source file not found' });
    }

    const compiler = language === 'cpp' ? 'g++' : 'gcc';
    const outputFile = path.join(workspaceDir, 'a.out');

    const proc = spawn(compiler, [sourceFile, '-o', outputFile], {
        cwd: workspaceDir,
        timeout: 30000
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
        stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
        stderr += data.toString();
    });

    proc.on('close', (code) => {
        if (code === 0) {
            res.json({ success: true, output: outputFile.replace(workspaceDir, ''), stdout, stderr });
        } else {
            res.json({ success: false, stdout, stderr, exitCode: code });
        }
    });

    proc.on('error', (err) => {
        res.status(500).json({ error: err.message });
    });
});

server.listen(port, () => {
    console.log('========================================');
    console.log('🚀 Basement Remote IDE Server');
    console.log('========================================');
    console.log(`Platform: ${process.platform}`);
    console.log(`Server: http://localhost:${port}`);
    console.log(`Workspaces: ${WORKSPACES_ROOT}`);
    console.log('========================================');
});
