// main.js - Basement IDE Client

// --- Global State ---
let editor;
let socket;
let terminal;
let fitAddon;
let sessionId = generateSessionId();
let currentFile = 'scratch.py';
let openFiles = new Map(); // filepath -> content
let activeTab = 'scratch.py';

// --- Initialize on Load ---
document.addEventListener('DOMContentLoaded', () => {
    initMonaco();
    initTerminal();
    initFileExplorer();
    initEventListeners();
});

// --- Session ID ---
function generateSessionId() {
    return 'session_' + Math.random().toString(36).substr(2, 9);
}

// --- Monaco Editor Setup ---
function initMonaco() {
    require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs' } });

    require(['vs/editor/editor.main'], function () {
        editor = monaco.editor.create(document.getElementById('editor-container'), {
            value: '# Python Example\nprint("Hello from Basement IDE!")\n',
            language: 'python',
            theme: 'vs-dark',
            automaticLayout: true,
            fontSize: 14,
            fontFamily: 'Fira Code',
            minimap: { enabled: false },
            padding: { top: 16 }
        });

        // Save current file content to memory
        openFiles.set(currentFile, editor.getValue());

        // Auto-save on change
        editor.onDidChangeModelContent(() => {
            if (currentFile) {
                openFiles.set(currentFile, editor.getValue());
            }
        });

        // Keyboard shortcut: Cmd/Ctrl+S to save
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
            saveCurrentFile();
        });
    });
}

// --- Terminal Setup ---
function initTerminal() {
    socket = io('http://localhost:3000');

    // Create xterm instance
    terminal = new Terminal({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: 'Fira Code, monospace',
        theme: {
            background: '#1e1e1e',
            foreground: '#d4d4d4'
        },
        rows: 20
    });

    fitAddon = new FitAddon.FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(document.getElementById('terminal'));
    fitAddon.fit();

    // Request terminal creation
    socket.emit('create-terminal', { sessionId });

    // Handle terminal output
    socket.on('terminal-output', (data) => {
        terminal.write(data);
    });

    socket.on('terminal-created', (data) => {
        console.log('Terminal created:', data.termId);
        terminal.write('\r\n\x1b[1;32mWelcome to Basement IDE!\x1b[0m\r\n');
    });

    socket.on('terminal-exit', () => {
        terminal.write('\r\n\x1b[1;31m[Terminal exited]\x1b[0m\r\n');
    });

    // Send input to terminal
    terminal.onData((data) => {
        socket.emit('terminal-input', { termId: sessionId, input: data });
    });

    // Resize terminal
    window.addEventListener('resize', () => {
        fitAddon.fit();
        socket.emit('terminal-resize', {
            termId: sessionId,
            cols: terminal.cols,
            rows: terminal.rows
        });
    });
}

// --- File Explorer ---
function initFileExplorer() {
    refreshFileList();
}

async function refreshFileList() {
    try {
        const response = await fetch(`http://localhost:3000/api/files/list?sessionId=${sessionId}`);
        const data = await response.json();

        const fileTree = document.getElementById('file-tree');

        if (data.files && data.files.length > 0) {
            fileTree.innerHTML = renderFileTree(data.files);
        } else {
            fileTree.innerHTML = '<div class="empty-state">No files yet. Create one to get started!</div>';
        }

        // Add click listeners
        document.querySelectorAll('.file-item').forEach(el => {
            el.addEventListener('click', () => {
                const filepath = el.dataset.path;
                openFile(filepath);
            });
        });
    } catch (err) {
        console.error('Failed to load file list:', err);
    }
}

function renderFileTree(files, level = 0) {
    let html = '<ul class="file-list">';

    for (const file of files) {
        const indent = level * 16;
        if (file.type === 'directory') {
            html += `<li style="padding-left: ${indent}px">
                <div class="folder-item">📁 ${file.name}</div>
                ${file.children ? renderFileTree(file.children, level + 1) : ''}
            </li>`;
        } else {
            const icon = getFileIcon(file.name);
            html += `<li style="padding-left: ${indent}px">
                <div class="file-item" data-path="${file.path}">${icon} ${file.name}</div>
            </li>`;
        }
    }

    html += '</ul>';
    return html;
}

function getFileIcon(filename) {
    if (filename.endsWith('.py')) return '🐍';
    if (filename.endsWith('.js')) return '📜';
    if (filename.endsWith('.c') || filename.endsWith('.cpp')) return '⚙️';
    if (filename.endsWith('.sh')) return '🔧';
    if (filename.endsWith('.md')) return '📝';
    return '📄';
}

// --- File Operations ---
async function openFile(filepath) {
    try {
        // Check if already open in memory
        if (openFiles.has(filepath)) {
            switchToFile(filepath);
            return;
        }

        // Fetch from server
        const response = await fetch(`http://localhost:3000/api/files/read?sessionId=${sessionId}&filepath=${encodeURIComponent(filepath)}`);
        const data = await response.json();

        if (data.content !== undefined) {
            openFiles.set(filepath, data.content);
            addTab(filepath);
            switchToFile(filepath);
        }
    } catch (err) {
        console.error('Failed to open file:', err);
        appendOutput(`Error opening file: ${err.message}`, 'error-text');
    }
}

async function saveCurrentFile() {
    if (!currentFile) return;

    const content = editor.getValue();

    try {
        const response = await fetch('http://localhost:3000/api/files/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId,
                filepath: currentFile,
                content
            })
        });

        const data = await response.json();
        if (data.success) {
            appendOutput(`✓ Saved: ${currentFile}`, 'success-text');
            refreshFileList();
        }
    } catch (err) {
        appendOutput(`Error saving file: ${err.message}`, 'error-text');
    }
}

function newFile() {
    const filename = prompt('Enter filename (e.g., test.py):');
    if (!filename) return;

    openFiles.set(filename, '');
    addTab(filename);
    switchToFile(filename);
    saveCurrentFile(); // Create empty file on server
}

// --- Tab Management ---
function addTab(filepath) {
    const tabs = document.getElementById('tabs');

    // Check if tab already exists
    if (document.querySelector(`.tab[data-file="${filepath}"]`)) {
        return;
    }

    const tab = document.createElement('div');
    tab.className = 'tab';
    tab.dataset.file = filepath;
    tab.innerHTML = `
        <span class="tab-name">${filepath}</span>
        <button class="tab-close">×</button>
    `;

    tab.querySelector('.tab-name').addEventListener('click', () => {
        switchToFile(filepath);
    });

    tab.querySelector('.tab-close').addEventListener('click', (e) => {
        e.stopPropagation();
        closeTab(filepath);
    });

    tabs.appendChild(tab);
}

function switchToFile(filepath) {
    currentFile = filepath;
    activeTab = filepath;

    // Update editor content
    const content = openFiles.get(filepath) || '';
    editor.setValue(content);

    // Update language based on extension
    const ext = filepath.split('.').pop();
    const langMap = {
        py: 'python',
        js: 'javascript',
        c: 'c',
        cpp: 'cpp',
        sh: 'shell',
        md: 'markdown'
    };
    const lang = langMap[ext] || 'plaintext';
    monaco.editor.setModelLanguage(editor.getModel(), lang);

    // Update language selector
    const select = document.getElementById('language-select');
    if (langMap[ext]) {
        select.value = lang === 'shell' ? 'bash' : lang;
    }

    // Update active tab styling
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.file === filepath);
    });
}

function closeTab(filepath) {
    openFiles.delete(filepath);
    const tab = document.querySelector(`.tab[data-file="${filepath}"]`);
    if (tab) tab.remove();

    // Switch to another tab if this was active
    if (currentFile === filepath) {
        const remaining = document.querySelector('.tab');
        if (remaining) {
            switchToFile(remaining.dataset.file);
        } else {
            currentFile = null;
            editor.setValue('');
        }
    }
}

// --- Code Execution ---
async function runCode() {
    const code = editor.getValue();
    const language = document.getElementById('language-select').value;

    switchToOutputPanel();
    appendOutput(`\n▶ Running ${language}...\n`, 'prompt');

    try {
        const response = await fetch('http://localhost:3000/api/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId,
                language,
                code,
                filepath: currentFile // If file exists, run from file
            })
        });

        const data = await response.json();

        if (data.stdout) {
            appendOutput(data.stdout, 'stdout-text');
        }

        if (data.stderr) {
            appendOutput(data.stderr, 'stderr-text');
        }

        if (data.error) {
            appendOutput(`Error: ${data.error}`, 'error-text');
        }

        if (data.exitCode !== undefined) {
            appendOutput(`\nExited with code ${data.exitCode}`, 'prompt');
        }

    } catch (err) {
        appendOutput(`Connection error: ${err.message}`, 'error-text');
    }
}

// --- Terminal Panel Switching ---
function switchToTerminalPanel() {
    document.querySelectorAll('.terminal-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === 'terminal');
    });
    document.getElementById('terminal').classList.add('active');
    document.getElementById('output').classList.remove('active');
    fitAddon.fit();
}

function switchToOutputPanel() {
    document.querySelectorAll('.terminal-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === 'output');
    });
    document.getElementById('terminal').classList.remove('active');
    document.getElementById('output').classList.add('active');
}

function appendOutput(text, className = '') {
    const outputEl = document.getElementById('output');
    const div = document.createElement('div');
    div.className = 'output-line ' + className;
    div.textContent = text;
    outputEl.appendChild(div);
    outputEl.scrollTop = outputEl.scrollHeight;
}

// --- Event Listeners ---
function initEventListeners() {
    // Run button
    document.getElementById('run-btn').addEventListener('click', runCode);

    // New file
    document.getElementById('new-file-btn').addEventListener('click', newFile);

    // Save file
    document.getElementById('save-file-btn').addEventListener('click', saveCurrentFile);

    // Refresh files
    document.getElementById('refresh-files-btn').addEventListener('click', refreshFileList);

    // Terminal tabs
    document.querySelectorAll('.terminal-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            if (tab.dataset.tab === 'terminal') {
                switchToTerminalPanel();
            } else {
                switchToOutputPanel();
            }
        });
    });

    // Clear terminal
    document.getElementById('clear-terminal-btn').addEventListener('click', () => {
        const activePanel = document.querySelector('.terminal-tab.active').dataset.tab;
        if (activePanel === 'terminal') {
            terminal.clear();
        } else {
            document.getElementById('output').innerHTML = '<div class="prompt">Output cleared.</div>';
        }
    });

    // New terminal instance
    document.getElementById('new-terminal-btn').addEventListener('click', () => {
        // Reinitialize terminal
        terminal.clear();
        socket.emit('create-terminal', { sessionId });
    });

    // Language selector
    document.getElementById('language-select').addEventListener('change', (e) => {
        const lang = e.target.value;
        if (editor) {
            const langMap = {
                python: 'python',
                javascript: 'javascript',
                c: 'c',
                cpp: 'cpp',
                bash: 'shell'
            };
            monaco.editor.setModelLanguage(editor.getModel(), langMap[lang] || 'plaintext');
        }
    });

    // Resizer for terminal
    const resizer = document.getElementById('resizer');
    const terminalContainer = document.querySelector('.terminal-container');

    resizer.addEventListener('mousedown', (e) => {
        e.preventDefault();
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', () => {
            document.removeEventListener('mousemove', handleMouseMove);
            fitAddon.fit();
        });
    });

    function handleMouseMove(e) {
        const h = window.innerHeight - e.clientY - 40;
        if (h > 100 && h < window.innerHeight * 0.7) {
            terminalContainer.style.height = `${h}px`;
        }
    }
}
