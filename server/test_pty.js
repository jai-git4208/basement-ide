
const pty = require('node-pty');
try {
    const term = pty.spawn('/bin/zsh', [], {
        name: 'xterm-color',
        cols: 80,
        rows: 30,
        env: process.env
    });
    console.log('Success PID:', term.pid);
    term.write('echo "Hello"\r');
    term.on('data', d => { console.log('Data:', d); process.exit(0); });
} catch (e) {
    console.error('Failed:', e);
}
