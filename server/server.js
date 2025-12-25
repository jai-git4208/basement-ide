const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { execFile, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
const port = 3000;

app.use(cors());
app.use(bodyParser.json());

// --- Configuration ---
const PROJECT_ROOT = path.resolve(__dirname, '..');
const EXECUTOR_PATH = path.join(PROJECT_ROOT, 'executor/executor_bin');
const ROOTFS_PATH = path.join(PROJECT_ROOT, 'sandbox/rootfs');
const SANDBOX_UID = process.env.SANDBOX_UID || (os.platform() === 'darwin' ? process.getuid().toString() : '1001');

// Serve static files from the client directory
app.use(express.static(path.join(PROJECT_ROOT, 'client')));

// --- Automatic Setup ---
function initializeSystem() {
    console.log('--- Initializing Remote IDE System ---');
    console.log(`Platform: ${os.platform()} (${os.release()})`);
    console.log(`Project Root: ${PROJECT_ROOT}`);

    try {
        // 1. Compile Executor if it doesn't exist
        if (!fs.existsSync(EXECUTOR_PATH)) {
            console.log('Compiling executor...');
            const srcPath = path.join(PROJECT_ROOT, 'executor/executor.c');
            execSync(`gcc "${srcPath}" -o "${EXECUTOR_PATH}"`);
            console.log('Executor compiled successfully.');
        }

        // 2. Run Sandbox Setup Script
        console.log('Setting up sandbox rootfs...');
        const setupScript = path.join(PROJECT_ROOT, 'scripts/setup_sandbox.sh');
        fs.chmodSync(setupScript, '755');
        execSync(`bash "${setupScript}"`);
        console.log('Sandbox rootfs initialized.');

    } catch (err) {
        console.error('Initialization warning:', err.message);
        console.log('Note: Some setup steps might require manual intervention or sudo.');
    }
    console.log('--------------------------------------');
}

initializeSystem();

// Helper to find interpreter path in host (for copying) or sandbox
function getInterpreterPath(lang) {
    if (lang === 'python') {
        // Try common paths
        const paths = ['/usr/bin/python3', '/usr/local/bin/python3', '/usr/bin/python'];
        for (const p of paths) {
            if (fs.existsSync(path.join(ROOTFS_PATH, p))) return p;
        }
        return '/usr/bin/python3'; // Fallback
    } else if (lang === 'javascript') {
        const paths = ['/usr/bin/node', '/usr/local/bin/node', '/bin/node'];
        for (const p of paths) {
            if (fs.existsSync(path.join(ROOTFS_PATH, p))) return p;
        }
        return '/usr/bin/node'; // Fallback
    }
    return '/bin/sh';
}

app.post('/api/execute', (req, res) => {
    const { language, code } = req.body;

    if (!code) {
        return res.status(400).json({ error: 'No code provided' });
    }

    // 1. Create a temporary file inside the sandbox
    const ext = language === 'python' ? 'py' : (language === 'javascript' ? 'js' : 'sh');
    const filename = `script_${Date.now()}.${ext}`;
    const filePathInSandbox = path.join('/tmp', filename);
    const hostFilePath = path.join(ROOTFS_PATH, 'tmp', filename);

    try {
        fs.writeFileSync(hostFilePath, code);
    } catch (err) {
        return res.status(500).json({ error: `Failed to write file to sandbox: ${err.message}` });
    }

    // 2. Prepare the command based on language
    const cmd = getInterpreterPath(language);
    const args = [filePathInSandbox];


    // 3. run executor via sudo
    const executorArgs = [ROOTFS_PATH, SANDBOX_UID, cmd, ...args];

    console.log(`Executing: sudo ${EXECUTOR_PATH} ${executorArgs.join(' ')}`);

    execFile('sudo', [EXECUTOR_PATH, ...executorArgs], (error, stdout, stderr) => {
        // Cleanup
        if (fs.existsSync(hostFilePath)) {
            fs.unlinkSync(hostFilePath);
        }

        if (error) {
            return res.json({
                error: error.message,
                stdout,
                stderr
            });
        }
        res.json({ stdout, stderr });
    });
});

app.listen(port, () => {
    console.log(`IDE backend listening at http://localhost:${port}`);
});
