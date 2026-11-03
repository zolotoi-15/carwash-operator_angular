const { execSync } = require('child_process');
try {
    console.log('Checking MongoDB...');
    execSync('systemctl is-active --quiet mongod || systemctl start mongod', { stdio: 'inherit' });
    console.log('MongoDB is running.');
} catch (e) {
    console.warn('MongoDB not started, continuing anyway.');
}