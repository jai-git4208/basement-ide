const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { execFile, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const port = 3000;

app.use(cors());
app.use(bodyParser.json());

const EXECUTOR_PATH = path.join(__dirname, '../executor/executor_bin');
const ROOTFS_PATH = path.join(__dirname, '../sandbox/rootfs');
const SANDBOX_UID = process.env.SANDBOX_UID || '1001';


function initializeSystem() {
    console.log('--- Initializing Remote IDE System ---');

    try {
        //Compile Executor if it doesn't exist
        if (!fs.existsSync(EXECUTOR_PATH)) {
            console.log('Compiling executor...');
            const srcPath = path.join(__dirname, '../executor/executor.c');
            execSync(`gcc "${srcPath}" -o "${EXECUTOR_PATH}"`);
            console.log('Executor compiled successfully.');
        }

        //Run Sandbox Setup Script
        console.log('Setting up sandbox rootfs...');
        const setupScript = path.join(__dirname, '../scripts/setup_sandbox.sh');
        fs.chmodSync(setupScript, '755');
        execSync(`bash "${setupScript}"`);
        console.log('Sandbox rootfs initialized.');

    } catch (err) {
        console.error('Initialization failed:', err.message);
         }
    console.log('--------------------------------------');
}

initializeSystem();

app.post('/api/execute', (req, res) => {
    const { language, code } = req.body;

    if (!code) {
        return res.status(400).json({ error: 'No code provided' });
    }

    // 1. Create a temporary file inside the sandbox
    const filename = `script_${Date.now()}.${language === 'python' ? 'py' : 'js'}`;
    const filePathInSandbox = path.join('/tmp', filename);
    const hostFilePath = path.join(ROOTFS_PATH, 'tmp', filename);

    fs.writeFileSync(hostFilePath, code);

    // 2. Prepare the command based on language
    let cmd = '';
    let args = [];

    if (language === 'python') {
        cmd = '/usr/bin/python3';
        args = [filePathInSandbox];
    } else if (language === 'javascript') {
        cmd = '/usr/bin/node';
        args = [filePathInSandbox];
    } else {
        // Default to shell
        cmd = '/bin/sh';
        args = [filePathInSandbox];
    }

    // 3. run executor via sudo (sudo is needed for chroot and setuid)
    // In production, you'd configure sudoers or use setuid bit on the executor binary.
    const executorArgs = [ROOTFS_PATH, SANDBOX_UID, cmd, ...args];

    execFile('sudo', [EXECUTOR_PATH, ...executorArgs], (error, stdout, stderr) => {
        // Cleanup
        fs.unlinkSync(hostFilePath);

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
