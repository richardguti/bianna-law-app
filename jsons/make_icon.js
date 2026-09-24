/**
 * make_icon.js — Crop the AC character and produce icon.ico
 * Run: node make_icon.js
 */

'use strict';

const fs       = require('fs');
const path     = require('path');
const { execSync } = require('child_process');

const SRC     = path.join(__dirname, 'assets', 'Bianna - Law-ac_icon.png');
const OUT     = path.join(__dirname, 'assets', 'icon.ico');
const CROPPED = path.join(__dirname, 'assets', '_ac_cropped.png');
const PS1     = path.join(__dirname, 'assets', '_crop.ps1');

// Write PowerShell crop script to a .ps1 file (avoids inline semicolon issues)
const ps1Content = `
Add-Type -AssemblyName System.Drawing
$src  = [System.Drawing.Image]::FromFile('${SRC.replace(/\\/g, '/')}')
$rect = New-Object System.Drawing.Rectangle(850, 270, 1100, 1100)
$bmp  = New-Object System.Drawing.Bitmap(1100, 1100)
$g    = [System.Drawing.Graphics]::FromImage($bmp)
$g.DrawImage($src, 0, 0, $rect, [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose()
$src.Dispose()
$bmp.Save('${CROPPED.replace(/\\/g, '/')}', [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host 'Crop complete'
`;

fs.writeFileSync(PS1, ps1Content);

console.log('Cropping character from source image…');
execSync(`powershell -ExecutionPolicy Bypass -File "${PS1}"`, { stdio: 'inherit' });

// Clean up ps1
try { fs.unlinkSync(PS1); } catch {}

// Convert cropped PNG → multi-size ICO
console.log('Converting to .ico…');
const { default: pngToIco } = require('png-to-ico');
pngToIco(CROPPED)
  .then((buf) => {
    fs.writeFileSync(OUT, buf);
    try { fs.unlinkSync(CROPPED); } catch {}
    console.log(`icon.ico written → ${OUT}  (${buf.length} bytes)`);

    // Mirror to source app directory
    const srcOut = 'F:\\Bianna - Law\\Bianna-Law-App\\assets\\icon.ico';
    fs.writeFileSync(srcOut, buf);
    console.log(`icon.ico mirrored → ${srcOut}`);
  })
  .catch((err) => {
    console.error('ICO conversion failed:', err.message);
    process.exit(1);
  });
