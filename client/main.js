let editor;

require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs' } });

require(['vs/editor/editor.main'], function () {
    editor = monaco.editor.create(document.getElementById('editor-container'), {
        value: [
            '# Cloud IDE Test',
            'print("Hello from the sandbox!")',
            'import sys',
            'print(f"Python version: {sys.version}")'
        ].join('\n'),
        language: 'python',
        theme: 'vs-dark',
        automaticLayout: true,
        fontSize: 14,
        fontFamily: 'Fira Code',
        minimap: { enabled: false },
        padding: { top: 16 }
    });
});

const runBtn = document.getElementById('run-btn');
const outputEl = document.getElementById('output');
const languageSelect = document.getElementById('language-select');

languageSelect.addEventListener('change', () => {
    const lang = languageSelect.value;
    const model = editor.getModel();
    monaco.editor.setModelLanguage(model, lang);


    if (lang === 'javascript') {
        editor.setValue(`console.log("Hello from Node.js!");\nconsole.log("Process UID:", process.getuid());`);
    } else {
        editor.setValue(`print("Hello from Python!")\nimport os\nprint(f"User ID: {os.getuid()}")`);
    }
});

runBtn.addEventListener('click', async () => {
    const code = editor.getValue();
    const language = languageSelect.value;

    appendOutput(`\n> Running ${language} command...`, 'prompt');

    try {
        const response = await fetch('http://localhost:3000/api/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ language, code })
        });

        const data = await response.json();

        if (data.error) {
            appendOutput(data.error, 'error-text');
        }

        if (data.stdout) {
            appendOutput(data.stdout);
        }

        if (data.stderr) {
            appendOutput(data.stderr, 'error-text');
        }

        if (!data.stdout && !data.stderr && !data.error) {
            appendOutput('(No output)');
        }

    } catch (err) {
        appendOutput(`Connection error: ${err.message}`, 'error-text');
    }
});

function appendOutput(text, className = '') {
    const div = document.createElement('div');
    div.className = 'output-line ' + className;
    div.textContent = text;
    outputEl.appendChild(div);
    outputEl.scrollTop = outputEl.scrollHeight;
}


document.getElementById('clear-btn').addEventListener('click', () => {
    outputEl.innerHTML = '<div class="prompt">Cleared. Ready to execute...</div>';
});
//resizer for the terminal
const resizer = document.getElementById('resizer');
const terminal = document.querySelector('.terminal-container');

resizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', () => {
        document.removeEventListener('mousemove', handleMouseMove);
    });
});

function handleMouseMove(e) {
    const h = window.innerHeight - e.clientY;
    if (h > 100 && h < window.innerHeight * 0.8) {
        terminal.style.height = `${h}px`;
    }
}
