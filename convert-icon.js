const { execSync } = require('child_process');
const fs = require('fs');

async function convert() {
    try {
        // Try using sharp
        const sharp = require('sharp');
        const svg = fs.readFileSync('resources/icon.svg');
        await sharp(svg)
            .resize(256, 256)
            .png()
            .toFile('resources/icon.png');
        console.log('Icon converted successfully using sharp!');
    } catch (e) {
        console.log('sharp not available, installing...');
        execSync('npm install sharp --save-dev', { stdio: 'inherit' });
        const sharp = require('sharp');
        const svg = fs.readFileSync('resources/icon.svg');
        await sharp(svg)
            .resize(256, 256)
            .png()
            .toFile('resources/icon.png');
        console.log('Icon converted successfully!');
    }
}

convert().catch(console.error);
