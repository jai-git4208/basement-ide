// main.js - Basement IDE Client

let editor;
let socket;
let terminal;
let fitAddon;
let sessionId = generateSessionId();
let currentFile = 'scratch.py';
let openFiles = new Map(); // filepath -> content
let activeTab = 'scratch.py';


window.addEventListener('load', () => {
    // Check if required libraries are loaded
    if (typeof io === 'undefined') {
        console.error('Socket.io not loaded!');
        return;
    }
    if (typeof Terminal === 'undefined') {
        console.error('Xterm.js not loaded!');
        return;
    }
    if (typeof require === 'undefined') {
        console.error('Monaco loader not loaded!');
        return;
    }


    initMonaco();
    initTerminal();
    initFileExplorer();
    initEventListeners();
});


function generateSessionId() {
    return 'session_' + Math.random().toString(36).substr(2, 9);
}


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

        
        openFiles.set(currentFile, editor.getValue());

        
        editor.onDidChangeModelContent(() => {
            if (currentFile) {
                openFiles.set(currentFile, editor.getValue());
            }
        });

        // keyboard shortcut: Cmd/Ctrl+S to save
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
            saveCurrentFile();
        });
    });
}


function initTerminal() {
    socket = io('http://localhost:3000');

   
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

    
    socket.emit('create-terminal', { sessionId });

    
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

   
    terminal.onData((data) => {
        socket.emit('terminal-input', { termId: sessionId, input: data });
    });

    
    window.addEventListener('resize', () => {
        fitAddon.fit();
        socket.emit('terminal-resize', {
            termId: sessionId,
            cols: terminal.cols,
            rows: terminal.rows
        });
    });
}

// --- file explorer ---
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
            fileTree.innerHTML = '<div class="file-item" style="padding-left: 20px; font-style: italic;">No files found</div>';
        }

        // Add click listeners to files
        document.querySelectorAll('.file-item').forEach(el => {
            el.addEventListener('click', () => {
                // Visual selection
                document.querySelectorAll('.file-item').forEach(i => i.classList.remove('selected'));
                el.classList.add('selected');

                const filepath = el.dataset.path;
                openFile(filepath);
            });
        });

        // Toggle folders (simple implementation)
        const explorer = document.getElementById('file-tree');
        if (!explorer) return;

        explorer.addEventListener('click', async (e) => {
            const el = e.target.closest('.folder-header');
            if (el) {
                const list = el.nextElementSibling;
                const icon = el.querySelector('.fas, .fa');
                if (list) {
                    const isHidden = list.style.display === 'none';
                    list.style.display = isHidden ? 'block' : 'none';
                    if (icon) {
                        icon.classList.toggle('fa-chevron-down', isHidden);
                        icon.classList.toggle('fa-chevron-right', !isHidden);
                    }
                }
                return;
            }
        });
    } catch (err) {
        console.error('Failed to load file list:', err);
    }
}

function renderFileTree(files, level = 0) {
    let html = '<ul class="file-list" style="' + (level > 0 ? 'padding-left: 10px' : '') + '">';

    for (const file of files) {
        if (file.type === 'directory') {
            html += `<li>
                <div class="folder-header folder-item">
                    <i class="fas fa-chevron-right" style="margin-right: 6px; width: 16px; text-align: center;"></i>
                    <span style="font-weight: 600">${file.name}</span>
                </div>
                ${file.children ? renderFileTree(file.children, level + 1) : ''}
            </li>`;
        } else {
            const iconClass = getFileIconClass(file.name);
            html += `<li>
                <div class="file-item" data-path="${file.path}">
                    <i class="${iconClass}" style="margin-right: 6px; width: 16px; text-align: center;"></i>
                    <span>${file.name}</span>
                </div>
            </li>`;
        }
    }

    html += '</ul>';
    return html;
}

function getFileIconClass(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const map = {
        'js': 'fas fa-file-code',
        'py': 'fas fa-file-code',
        'html': 'fas fa-file-code',
        'css': 'fas fa-file-code',
        'json': 'fas fa-file-code',
        'md': 'fas fa-file-alt',
        'txt': 'fas fa-file-alt',
        'c': 'fas fa-file-code',
        'cpp': 'fas fa-file-code',
        'h': 'fas fa-file-code'
    };
    return map[ext] || 'fas fa-file';
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

    const iconClass = getFileIconClass(filepath);

    tab.innerHTML = `
        <div class="tab-icon"><i class="${iconClass}"></i></div>
        <div class="tab-label">${filepath}</div>
        <button class="tab-close"><i class="fas fa-times"></i></button>
    `;

    tab.addEventListener('click', () => {
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

    // Update tabs visual state
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    const tab = document.querySelector(`.tab[data-file="${filepath}"]`);
    if (tab) tab.classList.add('active');

    // Update editor content
    const content = openFiles.get(filepath) || '';
    editor.setValue(content);

    // Update language
    const ext = filepath.split('.').pop();
    const langMap = {
        py: 'python',
        js: 'javascript',
        c: 'c',
        cpp: 'cpp',
        sh: 'shell',
        md: 'markdown',
        html: 'html',
        css: 'css',
        json: 'json'
    };
    const lang = langMap[ext] || 'plaintext';
    monaco.editor.setModelLanguage(editor.getModel(), lang);

    // Update Status Bar
    document.getElementById('lang-status').textContent = lang.charAt(0).toUpperCase() + lang.slice(1);

    // Update Breadcrumbs
    document.getElementById('breadcrumb-filename').textContent = filepath;
    document.getElementById('breadcrumb-icon').className = `${getFileIconClass(filepath)}`;
}

function closeTab(filepath) {
    const tab = document.querySelector(`.tab[data-file="${filepath}"]`);
    if (tab) tab.remove();

    openFiles.delete(filepath);

    if (currentFile === filepath) {
        const remaining = Array.from(openFiles.keys());
        if (remaining.length > 0) {
            switchToFile(remaining[remaining.length - 1]);
        } else {
            currentFile = null;
            editor.setValue('');
            document.getElementById('breadcrumb-filename').textContent = '';
            document.getElementById('lang-status').textContent = 'Plain Text';
        }
    }
}

// --- Execution ---
async function runCode() {
    if (!currentFile) {
        alert('Please create or open a file first.');
        return;
    }

    const lang = monaco.editor.getModel(editor.getModel()).getLanguageId();

    // Auto-save before running
    await saveCurrentFile();

    // Use terminal to run code
    let command = '';
    switch (lang) {
        case 'python': command = `python3 "${currentFile}"`; break;
        case 'javascript': command = `node "${currentFile}"`; break;
        case 'c':
            // Compile then run
            command = `gcc "${currentFile}" -o "${currentFile}.out" && "./${currentFile}.out"`;
            break;
        case 'cpp':
            command = `g++ "${currentFile}" -o "${currentFile}.out" && "./${currentFile}.out"`;
            break;
        case 'shell': command = `bash "${currentFile}"`; break;
    }

    if (command) {
        // Focus terminal
        document.querySelector('[data-tab="terminal"]').click();
        socket.emit('terminal-input', {
            termId: sessionId,
            input: command + '\r'
        });
    } else {
        alert(`Execution for language '${lang}' is not supported yet.`);
    }
}

function appendOutput(text, className) {
    // Legacy output handler - now we use terminal primarily
    const outputPanel = document.getElementById('output');
    if (outputPanel) {
        const line = document.createElement('div');
        line.className = 'output-line ' + (className || '');
        line.textContent = text;
        outputPanel.appendChild(line);
        outputPanel.scrollTop = outputPanel.scrollHeight;
    }
}

// --- Event Listeners ---
function initEventListeners() {
    // Run Button (Icon)
    const runBtn = document.getElementById('run-btn');
    if (runBtn) runBtn.addEventListener('click', runCode);

    // Clear Terminal
    const clearBtn = document.getElementById('clear-terminal-btn');
    if (clearBtn) clearBtn.addEventListener('click', () => {
        if (terminal) terminal.clear();
    });

    if (editor) {
        editor.onDidChangeCursorPosition((e) => {
            const pos = e.position;
            const el = document.getElementById('cursor-position');
            if (el) el.textContent = `Ln ${pos.lineNumber}, Col ${pos.column}`;
        });
    }

    // Activity Bar switching
    document.querySelectorAll('.action-item').forEach(item => {
        item.addEventListener('click', () => {
            if (item.closest('.activity-top')) {
                document.querySelectorAll('.activity-top .action-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');

                // Toggle views based on title or data-view
                const title = item.getAttribute('title') || '';
                const sidebar = document.querySelector('.sidebar');
                if (title.includes('Explorer')) {
                    if (sidebar) sidebar.style.display = 'flex';
                } else {
                    // Hide sidebar for other views (search, source control, etc.)
                    if (sidebar) sidebar.style.display = 'none';
                }
            }
        });
    });

    // Panel Tabs
    document.querySelectorAll('.panel-tabs li').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.panel-tabs li').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            const target = tab.dataset.tab;
            document.querySelectorAll('.panel-content > div').forEach(div => div.classList.remove('active'));

            const map = {
                'terminal': 'terminal',
                'output': 'output',
                'debug': 'output', // fallback
                'problems': 'output' // fallback
            };

            const targetId = map[target];
            if (targetId) {
                const el = document.getElementById(targetId);
                if (el) el.classList.add('active');
                if (target === 'terminal' && fitAddon) fitAddon.fit();
            }
        });
    });

    // Panel Actions
    const newTerminalBtn = document.querySelector('.panel-actions i[title="New Terminal"]');
    if (newTerminalBtn) {
        newTerminalBtn.addEventListener('click', () => {
            terminal.clear();
            socket.emit('create-terminal', { sessionId });
        });
    }

    const closePanelBtn = document.querySelector('.panel-actions i[title="Close Panel"]');
    if (closePanelBtn) {
        closePanelBtn.addEventListener('click', () => {
            const panel = document.querySelector('.panel-container');
            if (panel) panel.style.display = 'none';
        });
    }

    // Initialize Command Palette
    initCommandPalette();
}

function initCommandPalette() {
    const palette = document.getElementById('command-palette');
    const input = document.getElementById('palette-input');
    const results = document.getElementById('palette-results');

    if (!palette || !input || !results) return;

    // Define available commands
    const commands = [
        { id: 'new-file', label: 'New File', icon: 'fas fa-plus' },
        { id: 'save-file', label: 'Save File', icon: 'fas fa-save' },
        { id: 'run-code', label: 'Run Code', icon: 'fas fa-play' },
        { id: 'clear-terminal', label: 'Clear Terminal', icon: 'fas fa-trash' },
        { id: 'sidebar-toggle', label: 'Toggle Sidebar', icon: 'fas fa-columns' },
        { id: 'open-terminal', label: 'Open Terminal', icon: 'fas fa-terminal' }
    ];

    function renderCommands(filter = '') {
        results.innerHTML = '';
        const filtered = commands.filter(c => c.label.toLowerCase().includes(filter.toLowerCase()));

        filtered.forEach(cmd => {
            const div = document.createElement('div');
            div.className = 'palette-item';
            div.innerHTML = `
                <i class="${cmd.icon}" style="margin-right: 8px; width: 16px; text-align: center;"></i>
                <span>${cmd.label}</span>
            `;
            div.addEventListener('click', () => {
                executeCommand(cmd.id);
                togglePalette();
            });
            results.appendChild(div);
        });
    }

    // Toggle Palette with Cmd+Shift+P / Ctrl+Shift+P
    window.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'p') {
            e.preventDefault();
            togglePalette();
        }
        if (e.key === 'Escape' && palette.style.display !== 'none') {
            togglePalette();
        }
    });

    function togglePalette() {
        const isHidden = palette.style.display === 'none';
        palette.style.display = isHidden ? 'block' : 'none';

        if (isHidden) {
            input.value = '';
            renderCommands();
            input.focus();
        } else {
            if (editor) editor.focus();
        }
    }

    input.addEventListener('input', (e) => {
        renderCommands(e.target.value);
    });

    function executeCommand(id) {
        switch (id) {
            case 'new-file':
                newFile();
                break;
            case 'save-file':
                saveCurrentFile();
                break;
            case 'run-code':
                runCode();
                break;
            case 'clear-terminal':
                if (terminal) terminal.clear();
                break;
            case 'sidebar-toggle':
                const sb = document.querySelector('.sidebar');
                if (sb) sb.style.display = sb.style.display === 'none' ? 'flex' : 'none';
                break;
            case 'open-terminal':
                const panel = document.querySelector('.panel-container');
                if (panel) panel.style.display = 'flex';
                document.querySelector('[data-tab="terminal"]').click();
                break;
        }
    }
}
