#!/usr/bin/env node
/**
 * Writes one Homebrew Channel repository per webOS build.
 *
 * There are two files because the channel identifies a package by app ID and
 * repository URL, so one repository cannot list two builds with the same ID.
 * Each TV adds the URL that matches its webOS version.
 *
 * The .ipk files are copied next to the index files, so the branch that holds
 * them needs no login to download from.
 *
 * Usage: generate-homebrew-repo.cjs <ipk folder> <output folder>
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const REPO = 'nikeymikey/litefin-mine';
const APP_ID = 'tv.mikeytv.app';
const ICON = `https://raw.githubusercontent.com/${REPO}/mikeytv/assets/icon-130.png`;

const [ipkDir, outDir] = process.argv.slice(2);
if (!ipkDir || !outDir) {
    console.error('Usage: generate-homebrew-repo.cjs <ipk folder> <output folder>');
    process.exit(1);
}

const version = require(path.join(__dirname, '..', 'package.json')).version;
fs.mkdirSync(outDir, { recursive: true });

for (const tier of ['Modern', 'Legacy']) {
    const file = `MikeyTV-${version}-webOS-${tier}.ipk`;
    const ipk = fs.readFileSync(path.join(ipkDir, file));
    fs.copyFileSync(path.join(ipkDir, file), path.join(outDir, file));
    const description = `MikeyTV ${tier} build for LG TVs. A Jellyfin client based on Litefin.`;
    const repository = {
        paging: { page: 1, maxPage: 1, itemsPerPage: 1, itemsTotal: 1 },
        packages: [
            {
                id: APP_ID,
                title: 'MikeyTV',
                shortDescription: description,
                iconUri: ICON,
                // Inline, so the channel needs no second request for the manifest.
                manifest: {
                    id: APP_ID,
                    version,
                    type: 'web',
                    title: 'MikeyTV',
                    appDescription: description,
                    iconUri: ICON,
                    sourceUrl: `https://github.com/${REPO}`,
                    rootRequired: false,
                    ipkUrl: `https://raw.githubusercontent.com/${REPO}/homebrew/${file}`,
                    ipkHash: { sha256: crypto.createHash('sha256').update(ipk).digest('hex') }
                }
            }
        ]
    };
    fs.writeFileSync(path.join(outDir, `${tier.toLowerCase()}.json`), `${JSON.stringify(repository, null, 2)}\n`);
}
